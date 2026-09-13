+++
title = "JS Patterns & Examples"
template = "docs.html"
weight = 26
+++

Practical patterns for building JS components — activities, workflows, and webhooks. For API
reference see {{ doc_link(title="JS Activities", path="js/js-activities.md") }},
{{ doc_link(title="JS Workflows", path="js/js-workflows.md") }}, and
{{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }}. For WIT types and JSON encoding see
{{ doc_link(title="WIT reference", path="concepts/wit-reference.md") }}.

## Ready made activities

Repository [obeli-sk/components](https://github.com/obeli-sk/components/) contains ready-made
components that are published to Docker Hub. They can be added to a `deployment.toml` either by
copying `obelisk-oci.toml` from their respective folder or by using `obelisk component add`
{{ doc_link(title="CLI", path="cli.md#adding-a-component-to-the-deployment-configuration") }}.

## Activities: Variant errors — permanent vs retryable

An activity's `return_type` can use a `variant` for the error arm instead of a plain `string`. Any
variant case whose name **contains the word `permanent`** is treated as a non-retryable failure —
Obelisk finishes the execution immediately without consuming retries. All other cases are retried up
to `max_retries`. The `execution-failed` case is reserved by Obelisk for trap/timeout escalation and
must always be present.

```toml
[[activity_js]]
name = "fetch_dev_deps"
location = "activity/fetch_dev_deps.js"
ffqn = "myorg:monitor/repos.fetch-dev-deps" # Every function must have Function Fully Qualified Name
params = [{ name = "repo", type = "string" }]
return_type = "result<string, variant { permanent-not-found, transient-error(string), execution-failed }>"
[[activity_js.allowed_host]]
pattern = "https://raw.githubusercontent.com"
methods = ["GET"]
```

The server also needs a matching `[[outbound_http.allowed_host]]` entry for this destination and
method.

Throw a snake_case string to select a no-payload case; throw `{ case_name: payload }` for a case
with payload:

```javascript
// myorg:monitor/repos.fetch-dev-deps: func(repo: string) -> result<string, variant { permanent-not-found, transient-error(string), execution-failed }>
export default async function fetch_dev_deps(repo) {
  const branches = ["main", "master"];
  for (const branch of branches) {
    const url = `https://raw.githubusercontent.com/myorg/${repo}/${branch}/dev-deps.txt`;
    const resp = await fetch(url, { headers: { "user-agent": "my-monitor" } });
    if (resp.ok) return await resp.text();
    if (resp.status !== 404) {
      const msg = `HTTP ${resp.status} fetching ${url}`;
      throw { transient_error: msg }; // retried; payload = diagnostic string
    }
  }
  throw "permanent_not_found"; // not retried; no payload
}
```

A workflow calling this activity receives the failure as a thrown `obelisk.ChildError`. Its
`e.value` holds the decoded err payload, e.g. `"permanent_not_found"` or
`{ transient_error: "HTTP 503 …" }`; `e.value` is `undefined` for a platform failure (inspect
`e.failureKind` instead). See
{{ doc_link(title="Handling child failures", path="js/js-workflows.md") }}.

## Workflows: Parallel fan-out with named join sets

Create **one named join set per item** so the execution log labels each child by its input. Submit
all children, then drain in submission order via `joinNext()`.

```javascript
// myorg:monitor/monitor.run: func() -> result<list<tuple<string, string>>, string>
import { listRepos } from "myorg:monitor/repos";
import { fetchDevDepsSubmit, fetchDevDepsAwaitNext } from "myorg:monitor-obelisk-ext/repos";

export default function run() {
  const repos = listRepos();

  // Submit one fetch per repo.  Named join sets make the event log
  // self-describing (the WebUI shows "join-set: my-repo" instead of an
  // opaque generated id).  Join set names allow only [A-Za-z0-9\-\/].
  const perRepo = [];
  for (const repo of repos) {
    const js = obelisk.createJoinSet({ name: sanitizeJoinSetName(repo) });
    fetchDevDepsSubmit(js, repo);
    perRepo.push({ repo, js });
  }

  // `awaitNext` drains the join set - ordered based on responses.
  // It returns the child's ok value directly and throws on failure.
  const versions = [];
  for (const { repo, js } of perRepo) {
    try {
      const value = fetchDevDepsAwaitNext(js);
      const version = parseVersion(value);
      if (version !== null) versions.push([repo, version]);
    } catch (e) {
      if (!(e instanceof obelisk.ChildError)) throw e;
      console.warn("fetch failed for", repo, e.message);
    }
  }

  versions.sort((a, b) => a[0].localeCompare(b[0]));
  return versions;
}

function sanitizeJoinSetName(s) {
  return s.replace(/[^A-Za-z0-9\-\/]/g, "-");
}
```

**Join set name constraints:**

- Allowed characters: `A-Z`, `a-z`, `0-9`, `-`, `/`
- Must be unique within the workflow execution (reuse → `conflict` error)
- Omit `{ name }` to get an auto-generated name

For simpler cases where every child maps to an execution ID, index results via `js.lastId`, which
holds the ID of the response just consumed. `joinNext()` returns the ok value directly and throws
`obelisk.ChildError` on failure:

```javascript
const js = obelisk.createJoinSet();
const idToInput = {};
for (const item of items) {
  const execId = js.submit("ns:pkg/iface.process", [item]);
  idToInput[execId] = item;
}
for (let i = 0; i < items.length; i++) {
  let result;
  try {
    result = js.joinNext(); // ok value; null for a completed delay
  } catch (e) {
    if (!(e instanceof obelisk.ChildError)) throw e;
    continue; // child failed
  }
  const item = idToInput[js.lastId];
}
```

## Workflows: Saga pattern — crash-safe compensation

For the reusable parent/child lifecycle pattern, including an operator teardown race and child
workflow shutdown semantics, see
{{ doc_link(title="Cleanup supervisor (saga)", path="patterns/cleanup-supervisor.md") }}.

Wrap the main action in `try/catch`, capture any error, run the compensation unconditionally, then
re-throw. The compensation always runs because Obelisk replays the execution log on restart and
continues from the last completed step.

Keep the outer saga workflow **minimal** — move complex logic into a child workflow so a bug in
complex logic fails the child (catchable), not the outer saga itself:

```javascript
// demo:fly-agent/workflow.run: func(app-name: string, org-slug: string, prompt: string) -> result<string, string>
import { agent } from "demo:fly-agent/workflow";
import * as apps from "obelisk-flyio:activity-fly-http/apps@1.0.0-beta";

export default function run(app_name, org_slug, prompt) {
  let result = null,
    error = null;

  // Execute inner workflow; capture failure so cleanup still runs.
  try {
    result = agent(app_name, org_slug, prompt);
  } catch (e) {
    error = String(e);
    console.log(`Agent workflow failed: ${error}`);
  }

  // Compensation: always delete the app — even if the server crashed between
  // the try/catch above and here, Obelisk replays from this point on restart.
  try {
    apps.delete(app_name, true);
  } catch (e) {
    console.log(`Cleanup failed (manual action may be needed): ${e}`);
  }

  if (error !== null) throw error;
  return result;
}
```

The `try/catch` branch taken is recorded in the execution log — on replay, Obelisk always follows
the same branch.

## Workflows Polling external state

Use a bounded `for` loop with `obelisk.sleep` between probes. The sleep position is durable: a
server crash during the loop resumes from the last completed step on restart.

```javascript
// demo:fly-agent/workflow.agent: func(app-name: string, org-slug: string, prompt: string) -> result<string, string>
import * as machines from "obelisk-flyio:activity-fly-http/machines@1.0.0-beta";

export default function agent(app_name, org_slug, prompt) {
  // ... create VM ...

  // Poll until the VM is in the 'started' state.
  let started = false;
  for (let i = 0; i < 20; i++) {
    const machine = machines.get(app_name, machine_id);
    if (machine !== null && machine.state === "started") {
      started = true;
      break;
    }
    console.log(`VM state: ${machine ? machine.state : "unknown"}, retrying in 3s`);
    obelisk.sleep({ seconds: 3 });
  }
  if (!started) throw "VM did not reach 'started' state within timeout";

  // Poll until the result file appears.
  let output = null;
  for (let i = 0; i < 30; i++) {
    const cat = machines.exec(app_name, machine_id, ["cat", "/result.txt"], {
      timeout_secs: 10,
      stdin: null,
    });
    if (cat.exit_code === 0) {
      output = (cat.stdout || "").trim();
      break;
    }
    console.log(`Result not ready yet (attempt ${i + 1}/30)`);
    obelisk.sleep({ seconds: 5 });
  }
  if (output === null) throw "Agent did not produce a result within timeout";
  return output;
}
```

Keep the activity probe **cheap and idempotent**. Always set a hard loop ceiling and an explicit
timeout error so the workflow terminates rather than looping forever.

## Webhooks: Querying past executions

A webhook can query the Obelisk Web API directly via `fetch` to render the result of a previously
completed workflow run. The API is on `:5005` by default; inject the URL via `env_vars` so it is
configurable. The API port also requires a bearer token (see
{{ doc_link(title="Authentication", path="authentication.md") }}). Declare the token under the
allowed host's `secrets` instead of exposing its plaintext value through the component's `env_vars`.
The webhook sees only an opaque placeholder; Obelisk replaces it with the real token in the outgoing
header after the request matches the host and method allowlist:

```toml
[[webhook_endpoint_js]]
name = "show"
location = "webhook/show.js"
routes = [{ methods = ["GET"], route = "/" }]
env_vars = [
  { key = "OBELISK_API_URL", value = "${OBELISK_API_URL:-http://127.0.0.1:5005}" },
]
[[webhook_endpoint_js.allowed_host]]
pattern = "${OBELISK_API_URL:-http://127.0.0.1:5005}"
methods = ["GET"]
secrets = ["OBELISK__API__TOKEN"]
replace_in = ["headers"]
```

Register `OBELISK__API__TOKEN` in the server's `[secrets]` table and mirror this policy in a
matching `[[outbound_http.allowed_host]]` entry.

```javascript
// webhook/show.js
const WORKFLOW_FFQN = "myorg:monitor/monitor.run";

export default async function handle(_request) {
  const apiBase = process.env["OBELISK_API_URL"];
  const tokenPlaceholder = process.env["OBELISK__API__TOKEN"];
  if (!tokenPlaceholder) throw new Error("OBELISK__API__TOKEN is required");
  const authHeaders = {
    accept: "application/json",
    authorization: `Bearer ${tokenPlaceholder}`,
  };

  // List recent executions, newest first (default).  Find the latest finished one.
  const listResp = await fetch(
    `${apiBase}/v1/executions?ffqn_prefix=${encodeURIComponent(WORKFLOW_FFQN)}&length=50`,
    { headers: authHeaders },
  );
  if (!listResp.ok) {
    return new Response(`Failed to list executions: HTTP ${listResp.status}`, {
      status: 502,
    });
  }
  const executions = await listResp.json();
  const finished = executions.find((e) => e.pending_state?.status === "finished");
  if (!finished) {
    return new Response("No finished execution found.", { status: 200 });
  }

  // Fetch the return value.
  const retResp = await fetch(
    `${apiBase}/v1/executions/${encodeURIComponent(finished.execution_id)}`,
    { headers: authHeaders },
  );
  if (!retResp.ok) {
    return new Response(`Failed to fetch result: HTTP ${retResp.status}`, {
      status: 502,
    });
  }
  // RetVal shape: { ok: <value> } | { err: <value> } | { execution_failed: ... }
  const retVal = await retResp.json();
  if ("ok" in retVal) {
    return Response.json(retVal.ok);
  } else if ("err" in retVal) {
    return new Response(`Workflow error: ${JSON.stringify(retVal.err)}`, {
      status: 200,
    });
  } else {
    return new Response(`Execution failure: ${JSON.stringify(retVal.execution_failed)}`, {
      status: 200,
    });
  }
}
```

`pending_state.status` values: `locked`, `pending_at`, `blocked_by_join_set`, `paused`,
`cancelling`, `finished`. Pass `?follow=true` to `GET /v1/executions/{id}` instead of
`425 Too Early` while still running. See
{{ doc_link(title="Programmatic access", path="programmatic-access.md") }} for the full API.

## Workflow import API (preferred)

| Import pattern                                                   | Description                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `import { fn } from "ns:pkg/ifc"`                                | Call and await a child execution (returns ok, throws err) |
| `import * as ns from "ns:pkg/ifc"`                               | Namespace import for all functions in an interface        |
| `import { fnSubmit, fnAwaitNext } from "ns:pkg-obelisk-ext/ifc"` | Submit to a join set and await next result (typed)        |
| `import { fnSchedule } from "ns:pkg-obelisk-schedule/ifc"`       | Schedule a fire-and-forget execution                      |
| `import { fnStub } from "ns:pkg-obelisk-stub/ifc"`               | Inject a result for a stub activity                       |

Function names are converted from kebab-case (WIT) to camelCase (JS): `get-temperature` becomes
`getTemperature`.

## Workflow `obelisk.*` API (dynamic)

Prefer imports when the target function is known statically; imports are verified when the
deployment starts. Use these dynamic calls only when the FFQN is constructed at runtime:

| Call                                                     | Returns                                                           | Description                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `obelisk.call(ffqn, argArray)`                           | returns ok value, throws `obelisk.ChildError` on failure | Call and await a child execution                                                    |
| `obelisk.executionIdGenerate()`                          | `executionId` (string)                                            | Generate a unique execution ID                                                      |
| `obelisk.executionIdCurrent()`                           | `executionId` (string)                                            | Get the execution ID of the current workflow                                        |
| `obelisk.schedule(execId, ffqn, argArray)`               | `executionId` (string)                                            | Schedule a top-level execution immediately                                          |
| `obelisk.schedule(execId, ffqn, [arg1], scheduleAt)`    | `executionId` (string)                                            | Schedule with a relative duration or absolute `Date`                                |
| `obelisk.sleep(scheduleAt)`                              | `Date` object                                                     | Persistent blocking sleep using a relative duration object or absolute `Date`       |
| `obelisk.stub(execId, result)`                           |                                                                   | Supplies a result to a stub activity execution                                      |
| `obelisk.randomU64(min, max)`                            | u64                                                               |                                                                                     |
| `obelisk.randomString(minLen, maxLen)`                   | string                                                            |                                                                                     |

## Workflow join set API (dynamic)

Prefer extension imports when the target function is known statically; imports are verified when the
deployment starts. Use this dynamic join set API only when the FFQN is constructed at runtime:

| Call                               | Returns                                                                                   | Description                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `let js = obelisk.createJoinSet()` | join set object                                                                           | Create a new join set (optionally `{ name: "…" }`)                                                                                                               |
| `js.submit(ffqn, argArray)`        | childExecId (string)                                                                      | Submit a child execution without blocking                                                                                                                        |
| `js.submitDelay(scheduleAt)`       | `delayId` (string)                                                                        | Submit a timer using a relative duration object or absolute `Date`                                                                                               |
| `js.joinNext()`                    | ok value directly; `null` for a completed delay (throws `ChildError` on failure) | Block until the next result in this join set                                                                                                                     |
| `js.joinNextTry()`                 | same as `joinNext()`, but returns `undefined` while requests are still pending            | Non-blocking: attempt to get next result without waiting                                                                                                         |
| `js.lastId`                        | string                                                                                    | ID of the last child completed via `joinNext*` or `awaitNext`                                                                                                    |
| `js.close()`                       | `undefined`                                                                               | Cancel activities, delays, and `-cancellable` child workflows; await non-cancellable child workflows. Does not report close failures; repeated closes are no-ops |
| `obelisk.getResult(childExecId)`   | ok value (throws `ChildError` on failure)                                        | Fetch a result of a child already consumed with `joinNext*` / `awaitNext`                                                                                        |

`joinNext()` / `joinNextTry()` throw `obelisk.ChildError` on a child business err, platform
failure, or cancelled delay (`cancelled === true`), and `obelisk.JoinSetExhaustedError` when the
join set is exhausted. See
{{ doc_link(title="Handling child failures", path="js/js-workflows.md") }}.

## Webhook import API (preferred)

| Import pattern                                             | Description                          |
| ---------------------------------------------------------- | ------------------------------------ |
| `import { fn } from "ns:pkg/ifc"`                          | Call and await a child execution     |
| `import { fnSchedule } from "ns:pkg-obelisk-schedule/ifc"` | Schedule a fire-and-forget execution |

## Webhook `obelisk.*` API (dynamic)

Prefer imports when the target function is known statically; imports are verified when the
deployment starts. Use these dynamic calls only when the FFQN is constructed at runtime:

| Call                                                       | Returns                                                                                                                              | Description                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `obelisk.call(ffqn, argArray)`                             | returns ok value, throws `obelisk.ChildError` on failure                                                                    | Call and await a child execution                         |
| `obelisk.executionIdGenerate()`                            | `executionId` (string)                                                                                                               | Generate a unique execution ID                           |
| `obelisk.executionIdCurrent()`                             | `executionId` (string)                                                                                                               | Get the execution ID of the current webhook invocation   |
| `obelisk.schedule(execId, ffqn, argArray)`                 | `executionId` (string)                                                                                                               | Schedule a top-level execution immediately               |
| `obelisk.schedule(execId, ffqn, argArray, scheduleAt)`     | `executionId` (string)                                                                                                               | Schedule with a relative duration or absolute `Date`     |
| `obelisk.getStatus(execId)`                                | `{ status: "pendingAt"/"locked"/"paused"/"blockedByJoinSet"/"cancelling"/"finished", finishedStatus:"ok"/"err"/"executionFailure" }` |
| `obelisk.get(execId)`                                      | ok value (throws `obelisk.ChildError` on failure)                                                                           | Blocking: waits until execution finishes                 |
| `obelisk.tryGet(execId)`                                   | ok value (throws `obelisk.ChildError` on failure), `undefined` if not finished yet                                          | Non-blocking result fetch                                |

Webhooks also have `fetch`, `Response`, `Request`, `process.env`, `crypto.subtle` — same as
{{ doc_link(title="JS Activities", path="js/js-activities.md") }}.

## Structured concurrency on join set close

When a join set is closed (via `js.close()` or implicitly when the workflow returns or throws):

- Unpolled child **activities** and **delays** are **cancelled**.
- Unpolled child **workflows** are **awaited** unless their exported function name ends in
  `-cancellable`, in which case they are cancelled.

An imported direct call and `obelisk.call` both create and close a join set internally — the same
rules apply. If you submit to a join set and return without draining it, any pending activities are
cancelled, cancellable sub-workflows are cancelled recursively, and non-cancellable sub-workflows
continue running until they finish. To wait for them, drain the join set before returning. See
{{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }}.

## Running an Obelisk application

### Verify before starting

Check that the deployment configuration is valid — compiles all JS components and resolves all types
— without requiring real credentials:

```sh
obelisk server verify --allow-unavailable-runtime-config -d deployment.toml
```

### Start the server

```sh
obelisk server run --deployment deployment.toml
```

After the first run the deployment is persisted to the database; subsequent restarts (e.g. after a
crash) can omit `--deployment`:

```sh
obelisk server run
```

### Submit a one-off execution and follow it

```sh
obelisk execution submit my-namespace:my-pkg/my-iface.my-fn '["arg1", 42]'
# prints: E_01KN...
```

Execution IDs are `E_`-prefixed ULIDs (e.g. `E_01KN2X...`).

Block until finished and print the result:

```sh
obelisk execution submit --follow my-namespace:my-pkg/my-iface.my-fn '[]'
```

Or follow a previously submitted execution by ID:

```sh
obelisk execution status --follow E_01KN2X...
obelisk execution result --follow E_01KN2X...
```

Use `status` when you want the current lifecycle state, and `result` when you want the final return
value once the execution finishes.

## Common pitfalls

- **Workflows cannot use `fetch`.** Push all I/O (HTTP, file, database) into activities.
- **`max_retries=0` does not mean idempotency is optional.** A server restart before an activity
  finishes will retry it regardless. Use `permanent-*` variant cases to disable retry on specific
  errors without losing retries for transient ones.
- **`Math.random()` and `Date.now()` are deterministic in workflows.** Their values are recorded in
  the execution log on first call and replayed identically on crash-recovery.
- **Join set names must be unique per execution.** Derive them from stable inputs (IDs, keys) and
  sanitize to `[A-Za-z0-9\-\/]`.
- **`425 Too Early`** from `GET /v1/executions/{id}` means the execution is still running; use
  `?follow=true` to long-poll, or poll `getStatus` / `tryGet` from the webhook side.
- **Component and cron names must use only `[a-zA-Z0-9_]`** — hyphens are not allowed. Use
  underscores instead (e.g. `daily_monitor`, not `daily-monitor`).
- **Put registered token names in the allowed host's `secrets` field, not component `env_vars`.** The component receives only
  an opaque placeholder through `process.env`; Obelisk replaces it in an allowed outbound header. A
  secret key must not also appear in the component-level `env_vars`, or deployment verification
  fails with a "collides with an `env_vars` entry" error.

```

```
