+++
title = "JS Workflows"
template = "docs.html"
weight = 24
+++

Workflows orchestrate activities (and other workflows). They must be **deterministic** — given the
same inputs and event history they always produce the same sequence of calls. Obelisk records every
call and its result; on crash-recovery it replays the log, skipping already-completed calls. See
{{ doc_link(title="Workflows", path="concepts/workflows/_index.md") }} for the general model.

```toml
[[workflow_js]]
name        = "my_workflow"
location    = "workflow/my_workflow.js"
ffqn        = "myapp:demo/workflow.my-workflow"
params      = []
return_type = "result<string, string>"
```

Use `obelisk.sleep` for delays instead of `setTimeout`. `Date.now()` and `Math.random()` are safe to
use — their values are recorded in the execution log on first call and replayed deterministically on
recovery.

## Configuration via parameters (no environment access)

Workflows cannot read environment variables — a consequence of
{{ doc_link(title="determinism", path="concepts/workflows/_index.md") }} that applies to every
language. In JS specifically, `process.env` is available in
{{ doc_link(title="activities", path="js/js-activities.md") }} and
{{ doc_link(title="webhooks", path="js/js-webhooks.md") }} but not in workflow code. Pass runtime
configuration in as workflow parameters instead, read by a webhook or parent execution that supplies
it when scheduling or calling the workflow.

## Calling activities and workflows

The recommended way to call child executions is via ES module imports. Import the function by its
WIT interface path, and call it directly — Obelisk resolves the import to a `call` that submits the
child execution, blocks until it completes, and returns the ok payload. If the child permanently
fails it throws `obelisk.ChildExecutionError` (see
{{ doc_link(title="Handling child failures", path="js/js-workflows.md#handling-child-failures-with-obelisk-childexecutionerror") }});
the decoded err payload is on `e.value`.

```javascript
// myapp:demo/workflow.serial: func() -> result<string, string>
import { step } from "myapp:demo/activity";

export default function serial() {
  let acc = 0;
  for (let i = 0; i < 10; i++) {
    obelisk.sleep({ seconds: 1 });
    const result = step(i, i * 200);
    acc += Number(result);
    console.log(`step(${i})=${result}`);
  }
  return String(acc);
}
```

Star imports are also supported:

```javascript
// myapp:demo/workflow.serial: func() -> result<string, string>
import * as activity from "myapp:demo/activity";

export default function serial() {
  const result = activity.step(1, 200);
  return String(result);
}
```

Function names are converted from kebab-case (WIT) to camelCase (JS) automatically: a WIT function
`get-temperature` becomes `getTemperature` in the import.

Imports are verified when the deployment starts, so prefer them whenever the target function is
known statically. Only use `obelisk.call(ffqn, argArray)` when the function name is constructed at
runtime and cannot be imported statically:

```javascript
const result = obelisk.call("myapp:demo/activity.step", [i, i * 200]);
```

## `obelisk.sleep` — persistent sleep

Pauses the workflow durably — the sleep position is saved to the execution log. If the server
crashes mid-sleep and restarts, the sleep resumes where it left off. Returns a `Date` object
representing the time at which the sleep expired.

```javascript
obelisk.sleep({ milliseconds: 300 });
obelisk.sleep({ seconds: 1 });
const wakeTime = obelisk.sleep({ minutes: 5 }); // returns Date of wake-up
console.log(`Resumed at ${wakeTime.toISOString()}`);
```

## Join sets — parallel submission

{{ doc_link(title="Join sets", path="concepts/workflows/join-sets.md") }} let you submit multiple
child executions concurrently and await their results individually.

For join sets, use the extension imports with the `-obelisk-ext` suffix. These provide typed
`submit` and `awaitNext` functions for each activity. `awaitNext` returns the ok value directly (or
throws `obelisk.ChildExecutionError` on failure), matching the semantics of direct calls. The
execution ID of the child that completed is available via `js.lastId`:

```javascript
// myapp:demo/workflow.parallel: func() -> result<string, string>
import { stepSubmit, stepAwaitNext } from "myapp:demo-obelisk-ext/activity";

export default function parallel() {
  const handles = [];
  for (let i = 0; i < 10; i++) {
    const js = obelisk.createJoinSet(); // optional: { name: "my-set" }
    stepSubmit(js, i, i * 200);
    handles.push({ i, js });
  }
  let acc = 0;
  for (const { i, js } of handles) {
    const result = stepAwaitNext(js);
    acc = 10 * acc + Number(result);
    obelisk.sleep({ milliseconds: 300 });
  }
  return String(acc);
}
```

You can also use the lower-level join set API with string FFQNs when the function is constructed at
runtime and cannot be imported statically:

**Join set API:**

| Call                               | Returns                                                                        | Description                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `let js = obelisk.createJoinSet()` | join set object                                                                | Create a new join set (optionally `{ name: "…" }`)                                                                                                               |
| `js.submit(ffqn, argArray)`        | childExecId (string)                                                           | Submit a child execution without blocking                                                                                                                        |
| `js.submitDelay(duration)`         | `delayId` (string)                                                             | Submit a timer (e.g. `{ milliseconds: 500 }`). Duration key is one of: milliseconds/seconds/minutes/hours/days                                                   |
| `js.joinNext()`                    | ok value directly; `null` for a completed delay (throws on failure, see below) | Block until the next result in this join set                                                                                                                     |
| `js.joinNextTry()`                 | same as `joinNext()`, but returns `undefined` while requests are still pending | Non-blocking: attempt to get next result without waiting                                                                                                         |
| `js.lastId`                        | string                                                                         | ID (execution or delay) of the last child completed via `joinNext*` or `awaitNext`                                                                               |
| `js.close()`                       | `undefined`                                                                    | Cancel activities, delays, and `-cancellable` child workflows; await non-cancellable child workflows. Does not report close failures; repeated closes are no-ops |
| `obelisk.getResult(childExecId)`   | ok value (throws on failure, see below)                                        | Fetch a result of a child already consumed with `joinNext*` / `awaitNext`                                                                                        |

### Blocking join with `joinNext`

`js.joinNext()` blocks until a join-set response is available, then returns the completed value
**directly** (there is no winner object):

- a completed child execution returns the child's decoded ok value;
- a completed delay returns `null`;
- a child err arm or platform failure throws `obelisk.ChildExecutionError` (see below);
- a cancelled delay throws `obelisk.ChildExecutionError` with `cancelled === true`;
- an exhausted join set (all requests already processed) throws `obelisk.JoinSetExhaustedError`.

`js.lastId` is set to the consumed execution ID or delay ID before `joinNext` returns or throws, so
compare it against the IDs you submitted to tell which response you got:

```javascript
const js = obelisk.createJoinSet();
const execId = js.submit("myapp:demo/activity.step", [payload]);
const delayId = js.submitDelay({ seconds: 30 });

const result = js.joinNext();
if (result === null && js.lastId === delayId) {
  return "timed out";
}
if (js.lastId !== execId) {
  throw `unexpected completed response: ${js.lastId}`;
}
return result;
```

`js.joinNextTry()` has the same completed-response behavior but returns `undefined` (instead of
blocking) while requests are still pending and no response is ready.

> **Migration note:** earlier releases returned a winner object and required a follow-up
> `obelisk.getResult(response.id)`. Replace
> `const r = js.joinNext(); const v = obelisk.getResult(r.id);` with
> `const v = js.joinNext(); const completedId = js.lastId;`.

### Handling child failures with `obelisk.ChildExecutionError`

Any awaited child failure from `joinNext`, `joinNextTry`, generated `awaitNext` proxies,
`obelisk.call`, or `obelisk.getResult` throws `obelisk.ChildExecutionError`. It carries:

- `e.value`: the decoded business err payload; `undefined` for a unit err or a platform failure;
- `e.childId`: the completed child execution ID, when known;
- `e.cancelled`: `true` for a cancelled child or cancelled delay, otherwise `false`;
- `e.failureKind`: the platform failure kind string (`timed-out`, `nondeterminism-detected`,
  `out-of-fuel`, `cancelled`, `uncategorized`) or `undefined` for a business error;
- `e.message`: a human-readable diagnostic; do not parse it.

```javascript
try {
  const value = stepAwaitNext(js);
  // handle success
} catch (e) {
  if (!(e instanceof obelisk.ChildExecutionError)) throw e; // host/setup error
  if (e.failureKind !== undefined) {
    // platform failure (timeout, cancellation, nondeterminism, …)
  } else {
    // business err payload in e.value
  }
}
```

Rethrowing a `ChildExecutionError` transparently reuses the original err payload as this workflow's
err result (metadata like `failureKind` is not preserved):

```javascript
} catch (e) {
  if (e instanceof obelisk.ChildExecutionError) throw e; // same payload as `throw e.value`
  throw e;
}
```

## Random values and time

`Math.random()` and `Date.now()` are safe to use in workflow code. Their values are recorded in the
execution log on first execution and replayed identically on crash-recovery, preserving determinism.

```javascript
const rand = Math.random(); // deterministic on replay
const now = Date.now(); // deterministic on replay
```

Obelisk also provides explicit workflow-safe helpers:

```javascript
const n = obelisk.randomU64(0, 100); // u64 in [0, 100)
const n2 = obelisk.randomU64Inclusive(1, 6); // u64 in [1, 6]
const s = obelisk.randomString(8, 16); // alphanumeric, length in [8, 16)
```

## Schedule imports — fire-and-forget submission

Import from the `-obelisk-schedule` suffix to schedule a new top-level execution without blocking.
The function returns the execution ID immediately; the scheduled execution runs independently.

```javascript
import { sendEmailSchedule } from "myapp:demo-obelisk-schedule/activity";

const execId = sendEmailSchedule(null, "user@example.com");
// With a delay: sendEmailSchedule({ seconds: 60 }, "user@example.com");
```

The first argument is the schedule timing: `null` for immediate, or a duration object.

For FFQNs constructed at runtime, use `obelisk.schedule` directly:

```javascript
const execId = obelisk.executionIdGenerate();
obelisk.schedule(execId, "myapp:demo/activity.send-email", ["user@example.com"]);
// optional schedule-at: obelisk.schedule(execId, ffqn, args, { seconds: 60 });
```

## Stub imports — inject a result for a stub activity

{{ doc_link(title="Stub activities", path="concepts/activities/stub.md") }} have no implementation —
the result is supplied externally (via the CLI, Web UI, or from workflow code). Use `-obelisk-ext`
imports to submit and await the stub activity, and the `-obelisk-stub` import to inject the result:

```javascript
import { approveSubmit, approveAwaitNext } from "myapp:stubs-obelisk-ext/approval";
import { approveStub } from "myapp:stubs-obelisk-stub/approval";

const js = obelisk.createJoinSet();
const execId = approveSubmit(js, requestId);
approveStub(execId, { ok: "approved" }); // inject result (idempotent for same value)
const result = approveAwaitNext(js);
```

For FFQNs constructed at runtime, use `obelisk.stub` directly:

```javascript
obelisk.stub(execId, { ok: "approved" });
```

## `obelisk.executionIdCurrent` — get the current execution ID

Returns the execution ID of the currently running workflow:

```javascript
const myId = obelisk.executionIdCurrent();
console.log(`Running as ${myId}`);
```
