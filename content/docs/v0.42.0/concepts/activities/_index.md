+++
title = "Activities"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities are the fundamental building blocks of work within an Obelisk
{{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. They represent individual,
idempotent operations that perform a specific task, typically a network activity. Think of them as
the "verbs" of your workflow - the interactions with real world that get things done. Activities are
executed at least once for resiliency.

## Defining Features of Activities

- **Idempotency**: Activities must be safe to execute more than once with the same logical input.
  Repeating the activity must not produce an incorrect duplicate side effect. This is the most
  important activity contract, and the responsibility for satisfying it lies with the activity
  implementation.

- **Sandboxing**: WASM and JS activities are executed within a WebAssembly sandbox, providing a
  secure, isolated environment. Exec activities run as native child processes and rely on OS-level
  isolation.

- **Retry safety**: Activities must be safe to retry after errors, timeouts, and traps, but also
  after ambiguous outcomes. In particular, an activity may be executed again even if it already
  completed successfully, for example if the server crashes before the result is durably persisted.
  A correct activity therefore needs to converge to the intended final outcome even when Obelisk
  cannot tell whether a previous attempt already applied the side effect.

- **No unrecoverable local state**: Activities may talk to stateful external systems, but they must
  not depend on important in-memory or process-local state that would be lost on retry. Any state
  required for correctness must be reconstructible from persisted inputs, persisted workflow state,
  or the external world itself.

- **Short-lived**: Activities should do bounded work and complete. Long waits, polling loops, human
  approval, or management of long-lived resources should be modeled as repeated activity invocations
  coordinated by a workflow, not as one attempt that stays alive indefinitely.

- **Resilience**: Obelisk automatically retries activities that fail due to errors, timeouts, or
  panics (traps). The input parameters and execution results of activities are persistently stored.
  This makes retries reliable at the engine level, but correctness still depends on the activity
  honoring the contracts above.

## Activity Types

Obelisk supports three kinds of activities:

- **WASM Activities** (`activity_wasm`) — compiled WebAssembly components (Rust, TinyGo, etc.)
- **JavaScript Activities** (`activity_js`) — JavaScript functions executed in the built-in JS
  runtime
- **Exec Activities** (`activity_exec`) — native executables (shell scripts, Python scripts, Docker
  commands, etc.) run as child processes

All three types share the same retry, durability, and observability guarantees. The choice depends
on your toolchain and use case.

### Exec Activities

Exec activities run any executable as a durable activity. The child process receives function
parameters as JSON-encoded CLI arguments. The result is read from stdout — exit code 0 means
success, non-zero means error. Both stdout and stderr are streamed and persisted, available via the
CLI, REST API, and Web UI.

Example `deployment.toml`:

```toml
[[activity_exec]]
ffqn = "myapp:scripts/greet.greet"
location = "scripts/greet.sh"
params = [{ name = "name", type = "string" }]
return_type = "result<string, string>"
env_vars = ["PATH"]
max_retries = 5
```

With a corresponding script `scripts/greet.sh`:

```sh
#!/usr/bin/env bash
set -euo pipefail
NAME=$(echo "$1" | jq -r '.')
echo "\"Hello, ${NAME}!\""
```

The script receives each parameter as a JSON-encoded positional argument and must write a
JSON-encoded return value to stdout.

On failure, exit with a non-zero status and write the `err` value, also JSON-encoded, to stdout
(stderr is only logged, never captured into the result). For example, `printf '"not found"'; exit 1`
produces `err("not found")`. A non-zero exit with empty stdout cannot be decoded into a non-unit
`err` arm and instead becomes an uncategorized execution failure.

See {{ doc_link(title="Configuration", path="configuration.md") }} for all `activity_exec` fields
including inline `content`, secrets, environment variables, and output size limits.

## Defining activity functions in WIT

As with all components in Obelisk, the
[WIT](https://component-model.bytecodealliance.org/design/wit.html) interface definition language is
used to describe each activity function. Since activities can fail when the function invocation
`trap`s (panics), runs out of time or retries, each function must be fallible. This means that the
return type must be one of following:

- `result`
- `result<T>` where `T` represents any successful variant like `string` or `list<u32>` or even a
  none type (`_`)
- `result<T, string>`
- `result<T, E>` where `E` is a `variant` type that contains `execution-failed` variant.

## Developing an Activity in Rust

In this contrived example we will create an activity that does not communicate with an external
system. Its purpose is to show all the basic steps needed to execute an activity. Install
[Rust](https://rustup.rs/), [cargo-generate](https://crates.io/crates/cargo-generate) and run:

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

First let's look at the `fibo.wit` - a
[WIT](https://component-model.bytecodealliance.org/design/wit.html) interface with a single
function.

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

Obelisk disregards namespace, package name and the world name - it only concerns itself with the
exported interface(s). The `world` can be though of as an ESModule with no code - just imports and
exports.

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
location = "target/wasm32-wasip2/release/myactivity.wasm"
```

Let's build the WASM Component and run Obelisk.

```sh
cargo build --release
obelisk server run --config ./obelisk.toml
```

In order to execute the activity, we can use the CLI or the Web UI. In either case, we need the
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }} and the function parameters:

```sh
obelisk execution submit --follow \
    template-fibo:activity/fibo-activity-ifc.fibo [10]
```

Follow the template's
[README](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/activity/README.md) for more
details.
