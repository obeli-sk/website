+++
title = "Stub RPC (Typed Oneshot Channels)"
template = "docs.html"
weight = 20
+++

Use a {{ doc_link(title="stub activity", path="concepts/activities/stub.md") }} as a **typed,
oneshot channel** between a workflow and an external party (typically a webhook). One side awaits
the stub; the other fulfils it by execution id. Pair two stubs playing opposite roles and you have
request/response RPC that bridges a synchronous HTTP handler onto a durable, long-running workflow.

This is the primitive behind bridging a stateless HTTP endpoint (for example an OpenAI-compatible
`/v1/chat/completions` handler) onto one warm, stateful workflow per conversation: the webhook must
hand a request to the right running workflow and block for its reply, without either side holding
in-memory state across a crash. For a complete worked example, see
{{ target_link(title="agent-backed-llm-server", href="https://github.com/obeli-sk/agent-backed-llm-server") }},
which backs an OpenAI-compatible endpoint with warm Claude/Codex CLI sessions using exactly this
stub pair.

## Why a stub, not a plain child

A stub activity has no implementation, only a WIT signature. A workflow creates one as a child
execution and obtains its execution id; from there **either side can drive it by id**:

- an **external party (including a webhook)** can _inject_ the result
  (`PUT /v1/executions/<id>/stub`) and _await_ it (`GET /v1/executions/<id>?follow=true`, which
  blocks and streams);
- the **owning workflow** can _await_ it, _inject_ a result itself (the `-obelisk-stub` import), or
  _cancel_ it.

Which side injects and which side awaits is your choice per stub, not a direction the primitive
imposes. That is what makes a stub a general oneshot channel rather than only a "human input"
signal.

## The two directions

**Inbound (external to workflow).** The workflow submits the stub into a join set and awaits it; the
external party fulfils it. This is the
{{ doc_link(title="human-in-the-loop", path="concepts/activities/stub.md") }} direction generalized
to any producer: an approval, an operator value, or an HTTP request payload.

**Outbound (workflow to external).** The workflow submits the stub, then **self-fulfils** it via the
`-obelisk-stub` import once it has a value; the external party reads it with
`GET /v1/executions/<id>?follow=true`. This is how a workflow returns a value to a caller that is
blocked on an HTTP request.

Combine both and one request/response turn uses **two stubs**:

```wit
package example:session;

interface turn {
  // INBOUND: workflow submits(response-id, ...) & awaits; the webhook injects the result.
  //   ok = JSON payload delivered by the caller for this turn
  request: func(response-id: string) -> result<string, string>;

  // OUTBOUND: workflow submits, then self-fulfils; the webhook follows the result.
  //   ok = JSON reply produced by the workflow
  response: func() -> result<string, string>;
}
```

The inbound stub's params carry the routing the webhook needs _before_ it fulfils, including the
paired outbound `response-id`, so the webhook can deliver the request and then immediately block on
the matching reply.

```toml
[[activity_stub]]
ffqn = "example:session/turn.request"
params = [{ name = "response-id", type = "string" }]
return_type = "result<string, string>"

[[activity_stub]]
ffqn = "example:session/turn.response"
params = []
return_type = "result<string, string>"
```

## Workflow side

The workflow creates both stubs, hands the caller a way to reach it (the inbound stub, tagged with
the outbound id in its params), awaits the request, does the work, then self-fulfils the reply. It
races the inbound await against a durable sleep so an abandoned session is reclaimed even across a
server restart.

```javascript
// example:session/workflow.loop
import { requestSubmit, responseSubmit } from "example:session-obelisk-ext/turn";
import { responseStub } from "example:session-obelisk-stub/turn";

export default function loop() {
  while (true) {
    const race = obelisk.createJoinSet({ name: "turn" });

    const respId = responseSubmit(race); // outbound reply channel, created first
    const reqId = requestSubmit(race, respId); // inbound request channel exposes respId
    race.submitDelay({ minutes: 5 }); // durable idle timeout

    // joinNext returns the winning stub's ok value, or null for the delay.
    const request = race.joinNext();
    if (race.lastId !== reqId) return; // idle timeout won: reclaim the session

    const reply = doWork(request); // your activities / session logic
    responseStub(respId, { ok: reply }); // self-fulfil the outbound reply
  }
}
```

## Webhook side

The webhook never creates a stub. It does two things: (1) **locate** the right session workflow, and
(2) read that workflow's **execution log** to find its current pending `turn.request` stub, inject
the request, and block on the paired reply.

Locating is deliberately kept trivial below: the client echoes the workflow's execution id in a
header. A more dynamic approach derives the session from the request content (for a header-less
protocol like Chat Completions, hash the prior history and match it against pending stubs); see
{{ target_link(title="agent-backed-llm-server", href="https://github.com/obeli-sk/agent-backed-llm-server") }}.

The interesting part is reading the log. A stub child submission is recorded in the parent
workflow's log as a `join_set_request` / `child_execution_request` history event carrying the child
execution id and the submit params. Each turn submits its reply stub then its request stub, so
scanning the log **from the end** finds the current turn: the newest `turn.request` submission gives
the request stub's id, and its first param is the paired `response-id`.

These are raw `fetch` calls to the API port, so they need a bearer token (see
{{ doc_link(title="Authentication", path="authentication.md") }}). Declare the token as an
allowed-host secret so Obelisk swaps the opaque placeholder into the outgoing `authorization`
header; never put the plaintext token in the component's `env_vars`:

```toml
[[webhook_endpoint_js]]
name = "handle"
location = "webhook/handle.js"
routes = [{ methods = ["POST"], route = "/" }]
env_vars = [
  { key = "OBELISK_API_URL", value = "${OBELISK_API_URL:-http://127.0.0.1:5005}" },
]
[[webhook_endpoint_js.allowed_host]]
pattern = "${OBELISK_API_URL:-http://127.0.0.1:5005}"
methods = ["PUT", "GET"]
secrets = ["OBELISK__API__TOKEN"]
replace_in = ["headers"]
```

Register `OBELISK__API__TOKEN` in the server's `[secrets]` table and add a matching
`[[outbound_http.allowed_host]]` entry to `server.toml`.

```javascript
// example:session/webhook.handle
const REQUEST_FFQN = "example:session/turn.request";
const WINDOW = 50; // how many trailing log events to scan
const apiBase = process.env["OBELISK_API_URL"];
const tokenPlaceholder = process.env["OBELISK__API__TOKEN"]; // placeholder; Obelisk substitutes the real token
const authHeaders = { accept: "application/json", authorization: `Bearer ${tokenPlaceholder}` };

export default async function handle(request) {
  if (!tokenPlaceholder) throw new Error("OBELISK__API__TOKEN is required");
  const body = await request.json();

  // (1) Locate the session workflow. Simplest form: the client echoes its id.
  // Dynamic alternative: derive it from `body` (e.g. a history hash) and match.
  const workflowExecId = request.headers.get("x-obelisk-session");
  if (!workflowExecId) return new Response("missing x-obelisk-session", { status: 400 });

  // (2) Read the log for the current pending request stub.
  const turn = await latestPendingRequest(workflowExecId);
  if (!turn) return new Response("no pending turn", { status: 409 });

  // Inbound: deliver the payload into the request stub.
  await fetch(`${apiBase}/v1/executions/${turn.reqId}/stub`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders },
    body: JSON.stringify({ ok: JSON.stringify(body) }),
  });

  // Outbound: block until the workflow self-fulfils the paired reply stub.
  const reply = obelisk.get(turn.respId); // blocking; throws obelisk.ChildError on failure
  return new Response(reply, { headers: { "content-type": "application/json" } });
}

// Scan the workflow's execution log from the end for the newest turn.request
// child submission, returning { reqId, respId }.
async function latestPendingRequest(workflowExecId) {
  const base = `/v1/executions/${encodeURIComponent(workflowExecId)}/events`;
  const { max_version } = await apiGetJson(`${base}?version_from=0&length=1`);
  const from = Math.max(0, max_version - WINDOW);
  const { events } = await apiGetJson(`${base}?version_from=${from}&length=${WINDOW}`);

  for (let i = events.length - 1; i >= 0; i--) {
    // A child submission is a join_set_request / child_execution_request history event.
    const hist = events[i].event?.history_event?.event;
    if (hist?.type !== "join_set_request") continue;
    const req = hist.request;
    if (req?.type !== "child_execution_request" || req.target_ffqn !== REQUEST_FFQN) continue;
    // requestSubmit(race, respId) recorded respId as the stub's first param.
    return { reqId: req.child_execution_id, respId: String(req.params[0]) };
  }
  return null;
}

async function apiGetJson(path) {
  const resp = await fetch(`${apiBase}${path}`, { headers: authHeaders });
  if (!resp.ok) throw new Error(`GET ${path} -> HTTP ${resp.status}`);
  return resp.json();
}
```

On first contact there is no session yet: schedule the workflow with
`obelisk.schedule(sessionId, "example:session/workflow.loop", [])`, return `sessionId` to the client
(it becomes the `x-obelisk-session` header), and poll `latestPendingRequest` until the loop has
submitted its first `turn.request`.

`obelisk.get(stub.respId)` is an in-runtime host call, so it needs no manual `authorization` header;
only the raw `fetch` calls to the API port do. The REST equivalent of the blocking read for a non-JS
client is `GET /v1/executions/<respId>?follow=true` (also bearer-authenticated).

## Notes and pitfalls

- **The webhook holds an HTTP connection open** for the whole `obelisk.get`. That is the point (it
  makes the async workflow look synchronous to the client), but a slow turn, a retry, or a durable
  sleep inside the workflow keeps that connection parked. Size your HTTP timeouts accordingly.
- **Injection is idempotent** as long as the value is identical; a retried request that re-pairs to
  the same stub and re-reads the same reply is safe. See
  {{ doc_link(title="Stub Activities", path="concepts/activities/stub.md") }}.
- **Cancellation releases blocked readers.** If the workflow's join set closes (including when a
  `-cancellable` workflow is cancelled), a still-pending stub is cancelled and any external reader
  blocked on it is released with a failure. Keep the reply stub inside a join set owned by the
  workflow whose cancellation should unblock the caller. See
  {{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }}.
- **Routing without a session id.** When the caller sends no session id (as with stateless Chat
  Completions), key the inbound stub's params on something derivable from the request itself (for
  example a hash of prior history) so the webhook can pair a request to the right session, and fail
  closed on a miss rather than starting a duplicate.
