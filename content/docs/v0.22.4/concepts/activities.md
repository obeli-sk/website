+++
title = "Activities"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities are the fundamental building blocks of work within an Obelisk {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. They represent individual, idempotent operations that perform a specific task, typically a network activity. Think of them as the "verbs" of your workflow - the interactions with real world that get things done. Activities are executed at least once for resiliency.

## Key Characteristics of Activities
* **Idempotency**: This is the most crucial aspect of an activity. An activity must be idempotent, meaning it can be executed multiple times with the same input and produce the same result without unintended side effects. This is essential for retries and ensuring the integrity of your workflow, even in the face of failures. The responsibility for fulfilling this contract lies with the activity's implementation.

* **WASM Sandboxing**: Activities are executed within a WebAssembly (WASM) sandbox. This provides a secure, isolated environment, preventing activities from having unrestricted access to the system.

* **Resilience**: Obelisk automatically handles retries for activities that fail due to errors, timeouts, or panics(traps). This retry mechanism makes activities highly reliable. The input parameters and execution results of activities are persistently stored. Keep in mind that an activity can be retried even after it succeeded - in a rare case when persisting the result fails, e.g. during a server restart.

## Developing an Activity in Rust

In this contrived example we will create an activity that does not communicate with an external system. Its purpose is to show all the basic steps needed to execute an activity. Install [Rust](https://rustup.rs/), [cargo-generate](https://crates.io/crates/cargo-generate) and run:

```sh
cargo generate obeli-sk/obelisk-templates fibo/activity --name myactivity
cd myactivity
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
    │   └── template-fibo_activity
    │       └── fibo.wit
    └── impl.wit
```


First let's look at the `fibo.wit` - a [WIT](https://component-model.bytecodealliance.org/design/wit.html) interface with a single function.

```wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo: func(n: u8) -> u64;
}
```

The other WIT file - `impl.wit` - exports this interface:
```wit
package any:any;

world any {
    export template-fibo:activity/fibo-activity-ifc;
}
```

Obelisk disregards namespace, package name and the world name - it only concerns itself with the exported interface(s).
The `world` can be though of as an ESModule with no code - just imports and exports.

Let's look at the (naive) implementation found in `lib.rs`:

```rust
impl Guest for Component {
    fn fibo(n: u8) -> u64 {
        if n <= 1 {
            n.into()
        } else {
            Self::fibo(n - 1) + Self::fibo(n - 2)
        }
    }
}
```
The configuration file `obelisk.toml` already includes the activity:
```toml
[[activity_wasm]]
name = "myactivity"
location.path = "target/wasm32-wasip2/release/myactivity.wasm"
```
Let's build the WASM Component and run Obelisk.
```sh
cargo build --release
obelisk server run --config ./obelisk.toml
```

In order to execute the activity, we can use the CLI or the Web UI. In either case, we need the {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} and the function parameters:
```sh
obelisk client execution submit --follow \
    template-fibo:activity/fibo-activity-ifc.fibo [10]
```

### Publishing the WASM Component
We can push the WASM file into an OCI registry with this command:

```sh
obelisk client component push \
    target/wasm32-wasip2/release/myactivity.wasm \
    docker.io/youraccount/yourimage:tag
```

Obelisk will output the OCI location together with its SHA digest. This can be used instead of the file location in `obelisk.toml`:

```diff
 [[activity_wasm]]
 name = "myactivity"
-location.path = "target/wasm32-wasip2/release/myactivity.wasm"
+location.oci = "docker.io/getobelisk/example_activity_fibo_template:2025-01-30@sha256:f67904dd6d30bc4ca9bf844d41b6c11b146ebf66adaf05a2088e2a5f7fa46d29"
```

Follow the template's [README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/activity/README.md) for more details.

## Using HTTP Client
Activities can make HTTP requests using the [WASI 0.2 HTTP client](https://github.com/WebAssembly/wasi-http). This allows them to interact with external services and APIs. Importantly, this HTTP client is controlled, with built-in tracing to enhance security and predictability. Disk I/O is currently not permitted.

Let's generate a simple HTTP Client from a template:
```sh
cargo generate obeli-sk/obelisk-templates http-simple/activity --name httpactivity
cd httpactivity
```
This will generate a directory with the following structure:
```
.
├── .cargo
│   └── config.toml
├── Cargo.toml
├── obelisk.toml
├── README.md
├── rust-toolchain.toml
├── src
│   └── lib.rs
└── wit
    ├── deps
    │   └── template-http_activity
    │       └── http-get.wit
    └── impl.wit
```

The WIT interface is stored in `http-get.wit`:
```
package template-http:activity;

interface http-get {
    get: func(url: string) -> result<string, string>;
}
```

Instead of using the WASI HTTP 0.2 bindings directly we can use the [waki](https://crates.io/crates/waki) HTTP client.

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

We can build, run and publish the WASM Component the same way as previously. See the [http-simple template](https://github.com/obeli-sk/obelisk-templates/tree/main/http-simple/activity) for details on how to run the integration test.


If you need to use GraphQL, check out the [cynic](https://crates.io/crates/cynic) crate and the following [template](https://github.com/obeli-sk/obelisk-templates/tree/main/graphql-github/activity).

For more advanced use cases that require `async` support please check out the [wstd](https://crates.io/crates/wstd) crate.

## Logging, debugging, testing
To understand the internal state of an activity, you can use the following:

* `printf` style debugging: enable `forward_stdout` or `forward_stderr` in the `[[activity]]` section of the {{ doc_link(title="configuratin", path="configuration.md") }}. Output will appear in the server log.
* `obelisk:log` API - see {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}

Unit and integration testing is possible with Cargo's test harness.

The [stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/activity) repository contains unit and integration tests for activities.
