+++
title = "Activities"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities are the fundamental building blocks of work within an Obelisk {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. They represent individual, idempotent operations that perform a specific task, typically a network activity. Think of them as the "verbs" of your workflow – the actions that get things done. Activities are designed to be resilient, with built-in mechanisms for handling errors and ensuring reliable execution.

## Key Characteristics of Activities
* **Idempotency**: This is the most crucial aspect of an activity. An activity must be idempotent, meaning it can be executed multiple times with the same input and produce the same result without unintended side effects. This is essential for retries and ensuring the integrity of your workflow, even in the face of failures. The responsibility for fulfilling this contract lies with the activity's implementation.

* **WASM Sandboxing**: Activities are executed within a WebAssembly (WASM) sandbox. This provides a secure, isolated environment, preventing activities from having unrestricted access to the system.

* **Resilience**: Obelisk automatically handles retries for activities that fail due to errors, timeouts, or panics(traps). This retry mechanism, combined with idempotency, makes activities highly reliable. The input parameters and execution results of activities are persistently stored, contributing to this resilience.

## Creating an Activity


1. **Definition:** You define a workflow as code. Each function must have its signature specified using [WIT (WebAssembly Interface Type)](https://component-model.bytecodealliance.org/design/wit.html) IDL. Any language that is supported by [wit-bindgen](https://github.com/bytecodealliance/wit-bindgen/blob/main/README.md#supported-guest-languages) including Rust and Go can be used.

2.  **Compilation to WASM:** Your activity code is compiled into a WebAssembly Component.

3.  **Deployment:** Create a new `[[wasm_activity]]` table with the compiled WASM file location in the {{ doc_link(title="Obelisk configuration", path="configuration.md") }} file.

4.  **Execution:** The activity can be triggered directly using CLI, WebUI or [gRPC](https://github.com/obeli-sk/obelisk/tree/main/proto), but most commonly it is executed as a step in a {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. Obelisk persists the execution submission and execution result. If the activity times out, panics(traps) or returns an error, it will be retried after a timeout.

## Example - calculating Fibonacci
In this contrived example we will create an activity that does not communicate with an external system. Its purpose is to show
the interactions between activities and {{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}.
First we need to define an interface with a single function using [WIT IDL](https://component-model.bytecodealliance.org/design/wit.html). We will then export the interface.

```wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo: func(n: u8) -> u64;
}
world any {
    export fibo-activity-ifc;
}
```

The corresponding bindings are generated automatically using [wit-bindgen](https://crates.io/crates/wit-bindgen) if we
place the WIT file in the `wit` folder. Then we implement the `Guest` trait in Rust.

```rust
impl Guest for Component {
    fn fibo(n: u8) -> u64 {
        if n == 0 {
            0
        } else if n == 1 {
            1
        } else {
            Self::fibo(n - 1) + Self::fibo(n - 2)
        }
    }
}
```

In order to simplify creating the `Cargo` project, you can use [cargo-generate](https://crates.io/crates/cargo-generate):
```sh
cargo generate obeli-sk/obelisk-templates fibo/activity --name myactivity
cd myactivity
cargo build --release
obelisk server run
```
Follow the template's [README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/activity/README.md) to execute the activity.

## HTTP Client
Activities can make HTTP requests using the [WASI 0.2 HTTP client](https://github.com/WebAssembly/wasi-http). This allows them to interact with external services and APIs. Importantly, this HTTP client is controlled, with built-in tracing to enhance security and predictability. Disk I/O is not permitted.

### Example - WAKI based HTTP client
Instead of using the generated bindings directly we can use the [waki](https://crates.io/crates/waki) HTTP client.

```rust
impl Guest for Component {
    fn get(url: String) -> Result<String, String> {
        let resp = waki::Client::new()
            .get(&url)
            .connect_timeout(Duration::from_secs(1))
            .send()
            .map_err(|err| format!("{err:?}"))?;
        let body = resp.body().map_err(|err| format!("{err:?}"))?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn integration_test() {
        let url = std::env::var("TEST_URL").expect("TEST_URL must be set");
        let body = Component::get(url).unwrap();
        println!("body: {body}");
    }
}
```
This project can be generated using the [http-simple template](https://github.com/obeli-sk/obelisk-templates/tree/main/http-simple/activity)
```sh
cargo generate obeli-sk/obelisk-templates http-simple/activity
```

If you need to use GraphQL, check out the [cynic](https://crates.io/crates/cynic) crate and the following [template](https://github.com/obeli-sk/obelisk-templates/tree/main/graphql-github/activity):
```sh
cargo generate obeli-sk/obelisk-templates graphql-github/activity
```
