+++
title = "Workflows"
template = "docs.html"
+++

Workflows are the core of Obelisk's functionality, allowing you to define functions that orchestrate
your application's processes by spawning sequences of child executions – such as
{{ doc_link(title="activities", path="concepts/activities/_index.md") }} or other workflows. Obelisk
takes responsibility for managing the reliable execution of these sequences, handling factors like
retries, and timeouts to ensure the entire process completes correctly, even in the face of
interruptions like server restarts.

## Determinism and Replayability

This reliability is fundamentally enabled by ensuring **deterministic execution** and thus
**replayability**. JavaScript workflows run on the
{{ doc_link(title="JS runtime", path="js/js-runtime.md") }}, Rust workflows run in Wasmtime. Both
restrict nondeterministic access so the same inputs and event history produce the same outputs and
sequence of operations. To support this, Obelisk persistently records every child execution
submission and its eventual result, forming a **durable
{{ doc_link(title="execution log", path="concepts/execution-log.md") }}**. This log allows a
workflow's state to be precisely reconstructed and resumed after any interruption, ensuring it can
reliably continue from where it left off without duplicating or skipping steps.

In JavaScript, `Date.now()`, `new Date()`, and `Math.random()` are safe to use: their values come
from the execution log and replay identically.

A direct consequence of determinism is that a workflow must not read anything that could differ
between the original run and a replay. In particular, workflows cannot read environment variables
(`process.env`), make HTTP requests, or access other ambient host state. Supply runtime
configuration as workflow **parameters** instead: a component that can read the environment (a
webhook, an activity, or a parent execution) reads the value and passes it in when it schedules or
calls the workflow, so the value is recorded in the execution log and replays identically.

## How Workflows Are Executed in Obelisk

1. The Obelisk runtime starts the workflow and calls the requested function.
1. When the workflow calls an activity or a child workflow, Obelisk persists the request: the
   {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} and the parameters.
1. The Obelisk runtime schedules the child execution in the background.
1. The child execution runs, performs its work, and returns a result to the workflow. Obelisk
   handles retries on errors and timeouts for activities.
1. The workflow continues processing. This may involve replaying its state from the execution log.
1. **Completion/Failure:** The workflow continues until it either completes successfully or
   encounters an unrecoverable error. The final state of the workflow is recorded.

## Calling an activity

A workflow calls an activity like a regular function. The import path is the activity's interface,
and the function name is converted from kebab-case to camelCase:

```javascript
// myapp:demo/workflow.serial: func() -> result<string, string>
import { step } from "myapp:demo/activity";

export default function serial() {
  let acc = 0;
  for (let i = 0; i < 10; i++) {
    // Pauses the workflow, submits the activity and waits for its result.
    acc += Number(step(i, 200));
  }
  return String(acc);
}
```

```toml
[[workflow_js]]
name = "serial"
location = "workflow/serial.js"
ffqn = "myapp:demo/workflow.serial"
params = []
return_type = "result<string, string>"
```

Like every exported function in Obelisk, a workflow's `return_type` must be a `result`: returning a
value produces `ok`, throwing produces `err`. See
{{ doc_link(title="WIT Basics", path="concepts/wit-reference.md") }}.

Each call is persisted before the activity runs. If the server crashes in the middle of the loop,
the workflow is replayed: finished steps return their recorded results immediately and the loop
continues with the first unfinished one.

## Concurrent child executions

To run several children at once, submit them to a
{{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} and await the results. The
`-obelisk-ext` import suffix provides a `Submit` and `AwaitNext` variant of every function:

```javascript
// myapp:demo/workflow.parallel: func() -> result<string, string>
import { stepSubmit, stepAwaitNext } from "myapp:demo-obelisk-ext/activity";
import * as obelisk from "obelisk:workflow@1.0.0";

export default function parallel() {
  const js = obelisk.createJoinSet();
  for (let i = 0; i < 10; i++) {
    stepSubmit(js, i, 200); // does not block
  }
  let acc = 0;
  for (let i = 0; i < 10; i++) {
    acc += Number(stepAwaitNext(js)); // in completion order
  }
  return String(acc);
}
```

The submit call persists the execution request and returns its execution ID. The parent is not
blocked and can keep submitting. `AwaitNext` blocks until the next child in the join set finishes,
in completion order rather than submission order.

## Scheduling child executions

Scheduling is suitable when the workflow does not need the result of the submitted execution, or
wants to start it at a future time. Scheduled executions are not part of a join set, so they are not
bound by {{ doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }}:

```javascript
import { sendEmailSchedule } from "myapp:demo-obelisk-schedule/activity";

sendEmailSchedule({ minutes: 5 }, "user@example.com"); // returns the execution ID
```

See {{ doc_link(title="JS Workflows", path="js/js-workflows.md") }} for the complete API, including
{{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }} and error
handling. Rust workflows are covered in
{{ doc_link(title="Rust Workflows", path="wasm/workflows.md") }}.

## Logging and debugging

To understand the internal state of a workflow, you can use the following:

- Read the execution log. It contains workflow parameters, each child execution and the final
  result. The execution log is available in the Web UI.
- `console.log` and friends, see {{ doc_link(title="Logging", path="concepts/logging.md") }}. Logs
  are stored in the database and shown in the Web UI.
- Backtraces: the Web UI can show the source line that submitted each child execution. Backtraces
  are captured when an execution is replayed; `obelisk execution persist-backtraces <execution-id>`
  replays an execution and stores them.

Adding logging does not change the execution log, so you can add it to an in-progress or a finished
execution and trigger the replay.

## Blocking Strategy

You can control what happens to the workflow instance while it waits for a child execution:

- **`await`** (default) - keep the instance waiting for the result, until the execution lock
  expires.
- **`interrupt`** - unload the instance from memory immediately.

```toml
[[workflow_js]]
name = "myworkflow"
# ...
exec.lock_expiry.seconds = 1
blocking_strategy = "await"
```

With this configuration, a workflow instance that calls an activity is kept in memory for up to 1
second. If the activity finishes before the lock expires, the workflow receives the result and
continues.

If the activity result is delayed, the execution is unloaded from memory. Once the activity
finishes, it marks the parent workflow as pending. The workflow executor locks it again, fetches its
execution log and replays all the steps that the execution went through.

With the `interrupt` strategy, each call to an activity or
{{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }} unloads the
execution and later replays the execution log.
