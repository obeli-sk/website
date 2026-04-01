+++
title = "WIT Types"
template = "docs.html"
weight = 21
+++

[WIT](https://component-model.bytecodealliance.org/design/wit.html) (WebAssembly Interface
Types) is the interface definition language of the WebAssembly Component Model. It describes
the function signatures that components export and import.

Declaring accurate types matters for two reasons:

- **Interoperability.** WIT is language-neutral — a JS workflow can call a Rust activity and
  vice versa without any glue code. The synthesized interface is the shared contract regardless
  of implementation language. This is the common pattern: download a pre-built Rust (or any
  WASM) activity and wire it from a JS workflow or webhook.
- **Runtime behaviour.** Obelisk uses the declared return type to interpret results and drive
  execution. For example, when an activity returns the `err` variant of a `result` type,
  Obelisk treats it as a failure and schedules a retry; an `ok` variant marks the execution as
  finished.

For JS components, Obelisk synthesizes WIT interfaces from the `ffqn`, `params`, and
`return_type` fields in `deployment.toml` — no WIT files needed. Rust components define their
own WIT files and use the `bindgen!` macro to generate bindings. See
{{ doc_link(title="JS components", path="js/js-components.md") }} and
{{ doc_link(title="Rust components", path="wasm/rust-components.md") }} for details.

WIT identifiers must use **kebab-case** (e.g. `sleep-millis`, not `sleep_millis`).

## Primitive types

| WIT type | Description              |
|----------|--------------------------|
| `bool`   | Boolean                  |
| `u8`     | Unsigned 8-bit integer   |
| `u16`    | Unsigned 16-bit integer  |
| `u32`    | Unsigned 32-bit integer  |
| `u64`    | Unsigned 64-bit integer  |
| `s8`     | Signed 8-bit integer     |
| `s16`    | Signed 16-bit integer    |
| `s32`    | Signed 32-bit integer    |
| `s64`    | Signed 64-bit integer    |
| `f32`    | 32-bit float             |
| `f64`    | 64-bit float             |
| `char`   | Unicode scalar value     |
| `string` | UTF-8 string             |

## Compound types

| WIT syntax                        | Description                              |
|-----------------------------------|------------------------------------------|
| `option<T>`                       | Optional value                           |
| `result`                          | Success/failure with no payloads         |
| `result<T>`                       | Success with value, failure with no payload |
| `result<T, E>`                    | Success with value, failure with error   |
| `list<T>`                         | Variable-length sequence                 |
| `tuple<T1, T2, ...>`              | Fixed-length heterogeneous sequence      |
| `record { field-name: T, ... }`   | Object with named fields                 |
| `variant { case-name(T), ... }`   | Tagged union                             |
| `enum { case-name, ... }`         | Enumeration (one of a fixed set)         |
| `flags { flag-name, ... }`        | Bit-flag set                             |
