+++
title = "Durable Mailbox and Notification Channel"
template = "docs.html"
weight = 40
+++

A long-running workflow often needs two durable channels that ordinary child activities do not
provide: an **inbox** for input that arrives at unpredictable times (a user message, an operator
command), and an **outbox** that notifies observers of progress while the workflow is still running.
{{ doc_link(title="Stub activities", path="concepts/activities/stub.md") }} give both. A stub is
addressed by {{ doc_link(title="execution id", path="concepts/identifiers.md#execution-id") }} and
recorded in the parent's execution log, so either channel survives a crash and replays
deterministically.

This is the structure behind
{{ target_link(title="workflow-agent", href="https://github.com/obeli-sk/workflow-agent") }}, a
durable agent session whose Web UI feeds user input into a running workflow and streams the agent's
output back, with no in-memory state held across a restart.

## Mailbox: an always-outstanding offer

To act as an inbox, the workflow keeps **exactly one pending stub of the inbox function outstanding
at all times**. An external party delivers a message by fulfilling that specific pending execution
id; the workflow consumes the value, then immediately opens a fresh offer so there is always
somewhere to deliver the next message.

```wit
package example:session;

interface session {
  // The mailbox: the workflow submits & awaits it; the UI fulfils it to deliver input.
  injection: func() -> result<session-input, string>;
}
```

The offer is submitted into a named join set and **raced against the workflow's real work**, so an
injected message can interrupt or steer an in-flight step rather than waiting for it to finish.

```javascript
import { injectionSubmit } from "example:session-obelisk-ext/session";
import * as obelisk from "obelisk:workflow@1.0.0";

const user = obelisk.createJoinSet({ name: "user" });
let offerId = injectionSubmit(user); // one outstanding offer

while (true) {
  llmSubmit(user, request); // the real work, same join set

  // joinNext returns the winning child's ok value; lastId says which child won.
  const winner = user.joinNext();
  if (user.lastId === offerId) {
    appendUserMessage(winner); // UI delivered input
    offerId = injectionSubmit(user); // reopen the mailbox immediately
  } else {
    handleCompletion(winner); // the work finished first
  }
}
```

The UI delivers a message by fulfilling the pending offer it discovers in the workflow's log
(`PUT /v1/executions/<offerId>/stub`), exactly as an external party fulfils any inbound stub.
Because only one offer is ever pending, the UI never has to choose between competing inboxes, and
injection is idempotent: a retried delivery that re-targets the same offer with the same value is
safe.

## Notifications: a self-fulfilled outbox

To publish progress, the workflow uses a second stub as a typed event envelope that it
**self-fulfils** — no external producer is involved. For each event it submits the stub with an
event id, fulfils it from the same workflow with the typed payload, and consumes the completion. An
observer reads the parent's join-set responses to render the stream.

```wit
interface session {
  // The outbox: the workflow submits & self-fulfils it; observers read the event stream.
  record-output: func(event-id: string) -> result<session-event, string>;
}
```

This is the
{{ doc_link(title="self-fulfilled stub events", path="patterns/self-fulfilled-stub-events.md") }}
pattern used as a durable notification channel: the event id is the correlation key, and the stub's
return value carries the structured `session-event`.

For the request/response variant, where a synchronous webhook hands a request to the workflow and
blocks for its reply, see {{ doc_link(title="Stub RPC", path="patterns/stub-rpc.md") }}.

## One WIT folder as the single source of truth

The mailbox and outbox functions live in one WIT interface. The workflow **exports** that interface,
and each stub declares its signature by pointing at the **same WIT folder** rather than restating
`params` and `return_type` inline (see
{{ doc_link(title="Function Signatures", path="configuration.md#function-signatures") }}):

```toml
[[activity_stub]]
name = "session_injection"
ffqn = "example:session/session.injection"
wit = "wit"

[[activity_stub]]
name = "session_record_output"
ffqn = "example:session/session.record-output"
wit = "wit"

[[workflow_wasm]]
name = "session_workflow"
location = "target/wasm32-unknown-unknown/release/session_workflow.wasm"
```

With `wit = "wit"`, the stub's signature, the workflow's generated bindings, and the `session-input`
/ `session-event` payload types all resolve from that one folder. Changing a field in the WIT
updates every side at once, so the inbox schema the workflow awaits, the outbox schema it publishes,
and the types the UI reads can never drift apart.

## Notes and pitfalls

- **Keep the offer inside a workflow-owned join set.** A pending stub is a member of the join set
  its workflow submitted it to; when that join set closes (including when a `-cancellable` workflow
  is cancelled), the still-pending offer is cancelled and any external reader blocked on it is
  released with a failure. See
  {{ doc_link(title="Cancellation and pending stubs", path="concepts/activities/stub.md#cancellation-and-pending-stubs") }}.
- **Exactly one offer at a time.** Reopen the mailbox immediately after consuming a message so the
  UI always has a single, unambiguous target; do not leave two `injection` stubs pending at once.
- **Each event is one child execution.** The notification channel records durable history, one child
  per event. For high-volume telemetry use normal logs instead.
