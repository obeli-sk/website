+++
title = "Activities"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities are the fundamental building blocks of work within an Obelisk {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. They represent individual, idempotent operations that perform a specific task, typically a network activity. Think of them as the "verbs" of your workflow - the interactions with real world that get things done. Activities are executed at least once for resiliency.

## Defining Features of Activities
* **Idempotency**: This is the most crucial aspect of an activity. An activity must be idempotent, meaning it can be executed multiple times with the same input and produce the same result without unintended side effects. This is essential for retries and ensuring the integrity of your workflow, even in the face of failures. The responsibility for fulfilling this contract lies with the activity's implementation.

* **WASM Sandboxing**: Activities are executed within a WebAssembly (WASM) sandbox. This provides a secure, isolated environment, preventing activities from having unrestricted access to the system.

* **Resilience**: Obelisk automatically handles retries for activities that fail due to errors, timeouts, or panics(traps). This retry mechanism makes activities highly reliable. The input parameters and execution results of activities are persistently stored. Keep in mind that an activity can be retried even after it succeeded - in a rare case when persisting the result fails, e.g. during a server restart.

## Defining activity functions in WIT
As with all components in Obelisk, the [WIT](https://component-model.bytecodealliance.org/design/wit.html) interface definition language is used to describe each activity function.
Since activities can fail when the function invocation `trap`s (panics), runs out of time or retries, each function must be fallible. This means that the return type must be one of following:
* `result`
* `result<T>` where `T` represents any successful variant like `string` or `list<u32>` or even a none type (`_`)
* `result<T, string>`
* `result<T, E>` where `E` is a `variant` type that contains `execution-failed` variant.

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
    fibo: func(n: u8) -> result<u64, _>;
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
    fn fibo(n: u8) -> Result<u64, ()> {
        if n <= 1 {
            Ok(n.into())
        } else {
            Ok(Self::fibo(n - 1).unwrap() + Self::fibo(n - 2).unwrap())
        }
    }
}
```

The configuration file `obelisk.toml` already includes the activity:
```toml
[[activity_wasm]]
name = "myactivity"
location = "${OBELISK_TOML_DIR}/target/wasm32-wasip2/release/myactivity.wasm"
```
Let's build the WASM Component and run Obelisk.
```sh
cargo build --release
obelisk server run --config ./obelisk.toml
```

In order to execute the activity, we can use the CLI or the Web UI. In either case, we need the {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} and the function parameters:
```sh
obelisk execution submit --follow \
    template-fibo:activity/fibo-activity-ifc.fibo [10]
```

Follow the template's [README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/activity/README.md) for more details.

