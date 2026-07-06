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

## Calling activities and workflows

The recommended way to call child executions is via ES module imports. Import the function by its
WIT interface path, and call it directly — Obelisk resolves the import to a `call` that submits the
child execution, blocks until it completes, and returns the ok payload (or throws the err payload if
it permanently fails).

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
throws the err value), matching the semantics of direct calls. The execution ID of the child that
completed is available via `js.lastId`:

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

| Call                               | Returns                                                                                          | Description                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `let js = obelisk.createJoinSet()` | join set object                                                                                  | Create a new join set (optionally `{ name: "…" }`)                                                             |
| `js.submit(ffqn, argArray)`        | childExecId (string)                                                                             | Submit a child execution without blocking                                                                      |
| `js.submitDelay(duration)`         | `delayId` (string)                                                                               | Submit a timer (e.g. `{ milliseconds: 500 }`). Duration key is one of: milliseconds/seconds/minutes/hours/days |
| `js.joinNext()`                    | `{ ok: bool, id: childExecId / delayId, type: "execution"/"delay" }`                             | Block until the next result in this join set                                                                   |
| `js.joinNextTry()`                 | ok value (throws err value), `undefined` if pending, throws `JoinSetExhaustedError` if exhausted | Non-blocking: attempt to get next result without waiting                                                       |
| `js.lastId`                        | string                                                                                           | ID (execution or delay) of the last child completed via `joinNext*` or `awaitNext`                             |
| `js.close()`                       |                                                                                                  | Cancel activities, delays, and `-cancellable` child workflows; await non-cancellable child workflows           |
| `obelisk.getResult(childExecId)`   | ok value (throws err value)                                                                      | Fetch a result after child execution was submitted and consumed with `joinNext*`                               |

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
