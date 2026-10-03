+++
title = "JS Runtime"
template = "docs.html"
weight = 27
+++

JavaScript workflows, activities, and webhook endpoints run on the server's JS runtime. The runtime
is a server-wide choice: every JavaScript component in the process uses the same one, and components
need no changes to switch between them.

## Selecting the runtime

Set `OBELISK_JS_RUNTIME` in the environment of `obelisk server run`:

| Value                | Runtime                                                         |
| -------------------- | --------------------------------------------------------------- |
| `boa-wasm` (default) | [Boa](https://boajs.dev/) compiled to WASM, running in Wasmtime |
| `v8`                 | Native V8 isolates                                              |

Any other value fails startup.

## Differences

|                            | `boa-wasm`                                     | `v8`                                                      |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Activity isolation         | A fresh WASM instance per execution            | A fresh V8 isolate per execution                          |
| Execution slots            | `wasm` cells of [`[limits]`](#execution-slots) | `v8` cells of [`[limits]`](#execution-slots)              |
| Slot `memory` limit        | WASM linear memory                             | Isolate heap                                              |
| Exceeding the memory limit | Fails the execution                            | Fails the execution with "JavaScript heap limit exceeded" |

Workflows are deterministic on both runtimes: each restricts nondeterministic access so the same
inputs and event history replay to the same result.

## Execution slots

Each runtime has its own cells per workload in `server.toml`, so switching runtimes also switches
which limits apply. The defaults are:

```toml
[limits.activities.wasm]   # boa-wasm activities, shared with Rust activities
count = 500
memory.gib = 1
[limits.activities.v8]
count = 16
memory.mib = 256
[limits.workflows.wasm]    # boa-wasm workflows, shared with Rust workflows
count = 500
memory.mib = 512
[limits.workflows.v8]
count = 100
memory.mib = 256
[limits.webhooks.wasm]     # boa-wasm webhook endpoints, shared with Rust webhook endpoints
count = 500
memory.mib = 512
[limits.webhooks.v8]
count = 16
memory.mib = 256
```

See {{ doc_link(title="Execution Slots", path="configuration/server.md#execution-slots") }} for how
slots are acquired.

## V8 configuration

```toml
[v8]
thread_stack_size.mib = 4   # Stack size for each V8 isolate thread.
```

These settings apply only with `OBELISK_JS_RUNTIME=v8`. Each V8 isolate runs on its own OS thread.
