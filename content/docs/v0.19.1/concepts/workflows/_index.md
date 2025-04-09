+++
title = "Workflows"
template = "docs.html"
+++

Workflows are the core of Obelisk's functionality, allowing you to define and execute functions that orchestrate your {{ doc_link(title="activities", path="concepts/activities.md") }}.
Workflows are run in WASM sandbox, which ensures deterministic execution, a key requirement for replayability.

## What is a Workflow?

A workflow is a function that spawns a sequence of child executions – {{ doc_link(title="activities", path="concepts/activities.md") }} or other workflows.
Obelisk manages the execution order of these child executions, handles retries, timeouts, and ensures that the entire process runs reliably to completion, even in the face of server restarts.

## How Workflows Work in Obelisk

1.  **Definition:** You define a workflow as code. Any language that is supported by [wit-bindgen](https://github.com/bytecodealliance/wit-bindgen/blob/main/README.md#supported-guest-languages) including Rust and Go can be used. This code describes the activities or sub workflows to be executed and the order in which they should run. Workflow function must be exported by the [WASM Component](https://component-model.bytecodealliance.org) using [WIT format](https://component-model.bytecodealliance.org/design/wit.html).

2.  **Compilation to WASM:** Your workflow code is compiled into a WebAssembly Component.

3.  **Deployment:** Create a new `[[workflow]]` table with the compiled WASM file location in the {{ doc_link(title="Obelisk configuration", path="configuration.md") }} file.

4.  **Triggering:** A workflow instance is started, typically by an external event (e.g., an API call, a message on a queue, or a timer). You can trigger the execution using CLI, Web UI, [gRPC](https://github.com/obeli-sk/obelisk/tree/main/proto/) or using a {{ doc_link(title="Webhook Endpoint", path="concepts/webhook-endpoints.md") }}.

5.  **Execution:**
    *   The Obelisk runtime loads the WASM component.
    *   The workflow logic begins executing within the secure WASM sandbox.
    *   When the workflow needs to execute an activity, it makes a request to store the child execution submission.
    *   The Obelisk runtime schedules the activity for execution.
    *   The activity runs, performs its work, and returns a result to the workflow. Obelisk handles retries on errors and timeouts.
    *   The workflow continues processing. This may involve replaying the state form its execution log (see next sections).

6.  **Completion/Failure:** The workflow continues until it either completes successfully or encounters an unrecoverable error. The final state of the workflow is recorded.

## Directly calling an activity

The following example is a simple workflow that takes two arguments and calls an activity.
First we need to define an interface with the function signature in WIT format. We also need to import the
activity interface.

### Activity WIT
```wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo-activity: func(n: u8) -> u64;
}
```

### Workflow WIT
```wit
package template-fibo:workflow;

interface fibo-workflow-ifc {
    fiboa: func(n: u8, iterations: u32) -> u64;
}
world any {
    // Activity import, the WIT file must be placed in `wit/deps/`.
    import template-fibo:activity/fibo-activity-ifc;
    // Export the interface
    export fibo-workflow-ifc;
}
```

Implementing the workflow is straight forward. In Rust, the interface will be turned into `Guest` trait
by [wit-bindgen](https://crates.io/crates/wit-bindgen). Bindings for the imported interfaces will be generated as well.

```rust
impl Guest for Component {
    fn fiboa(n: u8, iterations: u32) -> u64 {
        let mut last = 0;
        for _ in 0..iterations {
            // This line will pause the workflow,
            // submit new activity execution and wait for the result.
            last = fibo_activity(n);
        }
        last
    }
}
```

In order to simplify creating the `Cargo` project, you can use [cargo-generate](https://crates.io/crates/cargo-generate) and the following template:
```sh
cargo generate obeli-sk/obelisk-templates fibo/workflow --name myworkflow
cd myworkflow
cargo build --release
obelisk server run
```
Follow the template's [README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/workflow/README.md) to execute the workflow.

## Concurrently submitting multiple child executions
Using the same activity WIT, let's now submit all executions concurrently and then await their results:

### Extended Activity WIT
Obelisk can generate several helper functions for every exported activity or workflow function. See {{ doc_link(title="Extension Functions", path="concepts/workflows/extension-functions.md") }} for details.
```wit
// Generated
package template-fibo:activity-obelisk-ext;

interface fibo-activity-ifc {
    use obelisk:types/execution@1.0.0.{execution-id, join-set-id};
    use obelisk:types/time@1.0.0.{schedule-at};
    use obelisk:types/execution@1.0.0.{execution-error};

    fibo-submit: func(join-set-id: borrow<join-set-id>, n: u8) -> execution-id;

    fibo-await-next: func(join-set-id: borrow<join-set-id>) ->
        result<tuple<execution-id, u64>, tuple<execution-id, execution-error>>;

    fibo-schedule: func(schedule-at: schedule-at, n: u8) -> execution-id;
}
```

### Workflow WIT
Let's add a new function signature to the exported interface:
```wit
interface fibo-workflow-ifc {
    fiboa-concurrent: func(n: u8, iterations: u32) -> u64;
}
```
### Workflow implementation
```rust
fn fiboa_concurrent(n: u8, iterations: u32) -> u64 {
    let join_set_id = new_join_set_generated(ClosingStrategy::Complete);
    for _ in 0..iterations {
        fibo_submit(&join_set_id, n);
    }
    let mut last = 0;
    for _ in 0..iterations {
        last = fibo_await_next(&join_set_id).unwrap().1;
    }
    last
}
```

First, we must explicitly instantiate a {{ doc_link(title="Join Set", path="concepts/workflows/join-sets.md") }}. While direct calls also involve a join set, Obelisk creates it automatically in that scenario; here, manual creation is required.

Next, we call the `-submit` extension function. This action persists the execution request to the database, queuing it for processing. An assigned executor will then pick up this task and run the child execution to completion. Importantly, the parent workflow is not blocked and can continue submitting other child executions while this happens.

To retrieve results, call the `-await-next` extension function. This function will block if no child executions have finished. As the name implies, -await-next returns results based on completion order, not submission order – whichever child execution finishes first provides the next result.

The [stargazers demo repository](https://github.com/obeli-sk/demo-stargazers/tree/main/workflow) contains code examples demonstrating both direct (blocking) and concurrent submission of activities and sub-workflows within a workflow.

## Scheduling child executions
The `-schedule` extension function is suitable when the workflow either doesn't require the result of the submitted execution or needs to defer its execution to a future time. Importantly, join sets are not used for scheduled executions, as this method bypasses the {{ doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} principles.

```rust
fn schedule_child(n: u8)  {
    let duration=...
    fibo_schedule(ScheduleAt::In(duration), n);
}
```

## Logging and debugging
To understand the internal state of a workflow, you can use the following:
* Read the execution log. It contains workflow parameters, each child execution and the final result. Execution log is available in the web UI.
* `printf` style debugging: enable `forward_stdout` or `forward_stderr` in the `[[workflow]]` section of the {{ doc_link(title="configuratin", path="configuration.md") }}. Output will appear in the server log.
* `obelisk:log` API - see {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}

Adding print statements or logs is ignored by the execution log, so you can add it to an in-progress or a finished execution and trigger the replay.

## Configuration
A simple workflow configuration can look like this:
```toml
[[workflow]]
name = "myworkflow"
location.path = "target/wasm32-unknown-unknown/release/workflow.wasm"
```

Only two attributes are required - `name` and `location`.

### Backtrace capture

<img src="{{ get_url(path="backtrace.png") }}" alt="A backtrace viewer" style="max-width: 100%; height: auto; display: block;" />



If we specify the `backtrace.sources`, the frontend can
display source file and line for every captured backtrace.
```toml
[[workflow]]
backtrace.sources = {"${OBELISK_TOML_DIR}/workflow/src/lib.rs" = "${OBELISK_TOML_DIR}/workflow/src/lib.rs"}
```
Backtraces are captured automatically and stored in the database every time
a child execution is submitted or awaited.

Persistent backtrace capture can be turned off globally using
```toml
workflows.backtrace.persist = false
```

### Join Next Blocking Strategy
You can control what happens to the runtime instance when a blocking call is awaited (e.g. in the example above, when `fibo_activity()` is executed).

* **`await`** - keep the instance waiting for the result, until the execution lock expires.
* **`interrupt`** - unload the instance from memory immediately.

For example, having the following configuration:
```toml
[[workflow]]
name = "myworkflow"
location.path = "target/wasm32-unknown-unknown/release/workflow.wasm"
exec.lock_expiry.seconds = 1
join_next_blocking_strategy = "await"
```

If the workflow instance calls an action right at the start, it will be kept hot for up to 1 second. If the activity finishes before the lock expires, the workflow instance will receive the result and continue.

On the other hand, if the activity result is delayed, the execution will be unloaded from memory. Once the activity finishes, it will mark the parent workflow as pending. The workflow
executor will lock it again, fetch its execution log and replay all the steps that the execution went through.

If the `interrupt` strategy is selected, each call to an activity or {{ doc_link(title="persistent sleep", path="concepts/runtime-support.md") }} will trigger locking
the execution and replaying the execution log.
