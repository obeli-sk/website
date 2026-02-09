+++
title = "Workflows"
template = "docs.html"
+++

Workflows are the core of Obelisk's functionality, allowing you to define functions that orchestrate your application's processes by spawning sequences of child executions – such as {{ doc_link(title="activities", path="concepts/activities/_index.md") }} or other workflows. Obelisk takes responsibility for managing the reliable execution of these sequences, handling factors like retries, and timeouts to ensure the entire process completes correctly, even in the face of interruptions like server restarts.

## Determinism and Replayability

This reliability is fundamentally enabled by ensuring **deterministic execution** and thus **replayability**. Workflows run within a WASM sandbox, guaranteeing that given the same inputs and event history, the workflow logic will always produce the exact same outputs and sequence of operations. To support this, Obelisk persistently records every child execution submission and its eventual result, forming a **durable execution log**. This log allows a workflow's state to be precisely reconstructed and resumed after any interruption, ensuring it can reliably continue from where it left off without duplicating or skipping steps.

## How Workflows Are Executed in Obelisk

1. The Obelisk runtime instantiates the WASM component and calls the requested workflow function.
1. When the workflow needs to start a child execution, it makes a request to store its {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} and parameters.
1. The Obelisk runtime schedules the activity or a child workflow for execution in the background.
1. The child execution runs, performs its work, and returns a result to the workflow. Obelisk handles retries on errors and timeouts for activities.
1. The workflow continues processing. This may involve replaying the state form its execution log.
1. **Completion/Failure:** The workflow continues until it either completes successfully or encounters an unrecoverable error. The final state of the workflow is recorded.


## Defining workflow functions in WIT
As with all components in Obelisk, the [WIT](https://component-model.bytecodealliance.org/design/wit.html) interface definition language is used to describe each workflow function.
Since workflows can fail when the function invocation `trap`s (panics), each function must be fallible. This means that the return type must be one of following:
* `result`
* `result<T>` where `T` represents any successful variant like `string` or `list<u32>` or even a none type (`_`)
* `result<T, string>`
* `result<T, E>` where `E` is a `variant` type that contains `execution-failed` variant.

## Developing a Workflow in Rust

### Creating a workflow from a template

Continuing the fibonacci example from {{ doc_link(title="activities", path="concepts/activities/_index.md") }} page, let's generate the workflow from [this template](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/workflow) using [cargo-generate](https://crates.io/crates/cargo-generate):
```sh
cargo generate obeli-sk/obelisk-templates fibo/workflow --name myworkflow
cd myworkflow
```

This will generate a directory with the following structure:

```sh
.
├── Cargo.toml
├── obelisk.toml
├── README.md
├── rust-toolchain.toml
├── src
│   └── lib.rs
└── wit
    ├── deps
    │   ├── obelisk_types@4.1.0
    │   │   └── types.wit
    │   ├── obelisk_workflow@4.1.0
    │   │   └── workflow-support.wit
    │   ├── template-fibo_activity
    │   │   └── fibo-activity.wit                   # Imported activity
    │   ├── template-fibo_activity-obelisk-ext
    │   │   └── activity-obelisk-ext.wit            # Generated -ext import
    │   └── template-fibo_workflow
    │       └── fibo-workflow.wit                   # Exported interface
    ├── impl.wit                                    # World (imports and exports)
    ├── template-fibo_workflow-obelisk-ext
    │   └── workflow-obelisk-ext.wit                # Generated -ext interface of exports
    └── template-fibo_workflow-obelisk-schedule
        └── workflow-obelisk-schedule.wit           # Generated -schedule interface of exports
```

### Synchronously Calling an Activity

First we need to define and export the workflow interface with the function signature in WIT format. We also need to import the
activity interface.

`fibo-activity.wit`:
```fibo-activity.wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo-activity: func(n: u8) -> result<u64>;
}
```

`fibo-workflow.wit` (simplified):
```wit
package template-fibo:workflow;

interface fibo-workflow-ifc {
    fiboa: func(n: u8, iterations: u32) -> result<u64>;
}
```
`impl.wit` (simplified):
```wit
package any:any;

world any {
    export template-fibo:workflow/fibo-workflow-ifc;
    import template-fibo:activity/fibo-activity-ifc;
}
```

Implementing the workflow is straight forward. In Rust, the interface will be turned into `Guest` trait
by [wit-bindgen](https://crates.io/crates/wit-bindgen). Bindings for the imported interfaces will be generated as well.

```rust
impl Guest for Component {
    fn fiboa(n: u8, iterations: u32) -> Result<u64, ()> {
        let mut last = 0;
        for _ in 0..iterations {
            // This line will pause the workflow,
            // submit new activity execution and wait for the result.
            last = fibo_activity(n).unwrap();
        }
        Ok(last)
    }
}
```

The configuration file `obelisk.toml` already includes the fibo activity and the workflow:

```toml
[[activity_wasm]]
name = "activity_myfibo"
# ...

[[workflow]]
name = "myworkflow"
location = "${OBELISK_TOML_DIR}/target/wasm32-unknown-unknown/release/myworkflow.wasm"
```

Let's build the WASM Component and run Obelisk.
```sh
cargo build --release
obelisk server run --config ./obelisk.toml
```

In another terminal, let's list all the exported functions:
```sh
obelisk component list
```
Expected output:
```
myworkflow      workflow:myworkflow
Exports:
        template-fibo:workflow/fibo-workflow-ifc.fiboa : func(n: u8, iterations: u32) -> result<u64>
        template-fibo:workflow/fibo-workflow-ifc.fiboa-concurrent : func(n: u8, iterations: u32) -> result<u64>

activity_myfibo activity_wasm:activity_myfibo
Exports:
        template-fibo:activity/fibo-activity-ifc.fibo : func(n: u8) -> result<u64>
```

We can run the `fiboa` workflow using CLI:
```sh
obelisk execution submit --follow \
    template-fibo:workflow/fibo-workflow-ifc.fiboa [40,10]
```
or using the WebUI:
<img src="{{ get_url(path="fiboa-submit.png") }}" alt="Submit the execution" style="max-width: 100%; height: auto; display: block;border: 2px dotted #efeded;" />
The result shows that `fibo` activities were indeed executed sequentially:
<img src="{{ get_url(path="fiboa-trace.png") }}" alt="View the result" style="max-width: 100%; height: auto; display: block;border: 2px dotted #efeded;" />

Follow the template's [README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/workflow/README.md) to learn how to publish the WASM Component into an OCI registry and more.

## Concurrently submitting multiple child executions
Using the same activity WIT, let's now submit all executions concurrently and then await their results:

### Extended Activity WIT
Obelisk can generate several helper functions for every exported activity or workflow function. See {{ doc_link(title="Extension Functions", path="concepts/extensions.md") }} for details.
```wit
// Generated by Obelisk
package template-fibo:activity-obelisk-ext;

interface fibo-activity-ifc {
  use obelisk:types/execution@4.1.0.{execution-id, join-set, await-next-extension-error, get-extension-error, invoke-extension-error};

  fibo-submit: func(join-set: borrow<join-set>, n: u8) -> execution-id;

  fibo-await-next: func(join-set: borrow<join-set>) -> result<tuple<execution-id, result<u64>>, await-next-extension-error>;

  fibo-get: func(execution-id: execution-id) -> result<result<u64>, get-extension-error>;

  fibo-invoke: func(label: string, n: u8) -> result<result<u64>, invoke-extension-error>;
}
```

### Workflow WIT
Let's add a new function signature to the exported interface:
```wit
package template-fibo:workflow;

interface fibo-workflow-ifc {
    fiboa: func(n: u8, iterations: u32) -> result<u64>;
    fiboa-concurrent: func(n: u8, iterations: u32) -> result<u64>; // Added
}
```
### Workflow implementation
```rust
fn fiboa_concurrent(n: u8, iterations: u32) -> Result<u64, ()> {
    let join_set = join_set_create();
    for _ in 0..iterations {
        fibo_submit(&join_set, n);
    }
    let mut last = 0;
    for _ in 0..iterations {
        last = fibo_await_next(&join_set).unwrap().1.unwrap();
    }
    Ok(last)
}
```

First, we must explicitly instantiate a {{ doc_link(title="Join Set", path="concepts/workflows/join-sets.md") }}. While synchronous calls also involve a join set,
Obelisk creates it automatically in that scenario; here, manual creation is required.

Next, we call the `-submit` extension function. This action persists the execution request to the database, queuing it for processing.
An assigned executor will then pick up this task and run the child execution to completion.
Importantly, the parent workflow is not blocked and can continue submitting other child executions while this happens.

To retrieve results, call the `-await-next` extension function. This function will block if no child executions have finished.
As the name implies, -await-next returns results based on completion order, not submission order – whichever child execution finishes first provides the next result.

Running the `fiboa-concurrent` produces the expected trace:

<img src="{{ get_url(path="fiboa-concurrent-trace.png") }}" alt="View the result" style="max-width: 100%; height: auto; display: block;border: 2px dotted #efeded;" />

The [stargazers demo repository](https://github.com/obeli-sk/demo-stargazers/tree/main/workflow) contains code examples demonstrating
both synchronous (blocking) and concurrent submission of activities and sub-workflows within a workflow.

## Scheduling child executions
The `-schedule` {{ doc_link(title="extension function", path="concepts/extensions.md") }} is suitable when the workflow either doesn't require the
result of the submitted execution or needs to defer its execution to a future time. Importantly, join sets are not used for scheduled executions,
as this method bypasses the {{ doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} principles.

```rust
fn schedule_child(n: u8)  {
    let duration=...
    fibo_schedule(ScheduleAt::In(duration), n);
}
```

## Logging and debugging
To understand the internal state of a workflow, you can use the following:
* Read the execution log. It contains workflow parameters, each child execution and the final result. Execution log is available in the web UI.
* `printf` style debugging: enable `forward_stdout` or `forward_stderr` in the `[[workflow]]` section of the {{ doc_link(title="configuration", path="configuration.md") }}.
By default, output is stored in the database and available in the Web UI. It can also be forwarded to `"stdout"` or `"stderr"` to appear in the server log.
* `obelisk:log` API - see {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}

Adding print statements or logs is ignored by the execution log, so you can add it to an in-progress or a finished execution and trigger the replay.

## Advanced Topics

### Backtrace capture

<img src="{{ get_url(path="backtrace.png") }}" alt="A backtrace viewer" style="max-width: 100%; height: auto; border: 2px dotted #efeded;" />

If we specify the `backtrace.sources`, the frontend can
display source file and line for every captured backtrace.

```toml
[[workflow]]
backtrace.sources = {".../src/lib.rs" = "${OBELISK_TOML_DIR}/workflow/src/lib.rs"}
```

Backtraces are captured automatically and stored in the database every time a child execution is submitted or awaited.
The mapping is from frame source to local file system.
Note that when `.../` is used, frame source path is matched based on the suffix, `src/lib.rs` in this example.

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
location = "${OBELISK_TOML_DIR}/target/wasm32-unknown-unknown/release/workflow.wasm"
exec.lock_expiry.seconds = 1
join_next_blocking_strategy = "await"
```

If the workflow instance calls an action right at the start, it will be kept hot for up to 1 second. If the activity finishes before the lock expires,
the workflow instance will receive the result and continue.

On the other hand, if the activity result is delayed, the execution will be unloaded from memory. Once the activity finishes, it will mark the parent workflow as pending.
The workflow
executor will lock it again, fetch its execution log and replay all the steps that the execution went through.

If the `interrupt` strategy is selected, each call to an activity or {{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}
will trigger locking the execution and replaying the execution log.
