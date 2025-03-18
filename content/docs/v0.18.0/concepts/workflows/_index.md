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
    *   The workflow continues processing. If the workflow was suspended while waiting for results, its execution is restarted and replayed from the execution log.

6.  **Completion/Failure:** The workflow continues until it either completes successfully or encounters an unrecoverable error. The final state of the workflow is recorded.

## Example - calling the Fibonacci activity

The following example is a simple workflow that takes two arguments and calls an activity.
First we need to define an interface with the function signature in WIT format. We also need to import the
activity interface.

```wit
package template-fibo:workflow;

interface fibo-workflow-ifc {
    fiboa: func(n: u8, iterations: u32) -> u64;
}
world any {
    // Export the interface
    export fibo-workflow-ifc;
    // Activity import, the WIT file must be placed in `wit/deps/`.
    import template-fibo:activity/fibo-activity-ifc;
}
```

Implementing the workflow is straight forward. In Rust, the interface will be turned into `Guest` trait
by [wit-bindgen](https://crates.io/crates/wit-bindgen). Bindings for the imported interfaces will be generated as well.

```rust
impl Guest for Component {
    fn fiboa(n: u8, iterations: u32) -> u64 {
        let mut last = 0;
        for _ in 0..iterations {
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

## Example - concurrently calling multiple activities
The [stargazers demo repository](https://github.com/obeli-sk/demo-stargazers/tree/main/workflow) contains code examples demonstrating both direct (blocking) and concurrent submission of activities and sub-workflows within a workflow.

