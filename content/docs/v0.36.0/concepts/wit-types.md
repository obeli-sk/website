+++
title = "WIT Types"
template = "docs.html"
weight = 21
+++

[WIT](https://component-model.bytecodealliance.org/design/wit.html) (WebAssembly Interface
Types) is the interface definition language of the WebAssembly Component Model. Obelisk
synthesizes WIT interfaces from the `ffqn`, `params`, and `return_type` fields in
`deployment.toml`, so you never write WIT by hand.

The following types can be used in `params` and `return_type`:

## Primitive types

| WIT type | Description                          | JS representation        |
|----------|--------------------------------------|--------------------------|
| `bool`   | Boolean                              | `boolean`                |
| `u8`     | Unsigned 8-bit integer               | `number`                 |
| `u16`    | Unsigned 16-bit integer              | `number`                 |
| `u32`    | Unsigned 32-bit integer              | `number`                 |
| `u64`    | Unsigned 64-bit integer              | `number` (or `bigint`)   |
| `s8`     | Signed 8-bit integer                 | `number`                 |
| `s16`    | Signed 16-bit integer                | `number`                 |
| `s32`    | Signed 32-bit integer                | `number`                 |
| `s64`    | Signed 64-bit integer                | `number` (or `bigint`)   |
| `f32`    | 32-bit float                         | `number`                 |
| `f64`    | 64-bit float                         | `number`                 |
| `char`   | Unicode scalar value                 | single-character `string`|
| `string` | UTF-8 string                         | `string`                 |

## Compound types

| WIT syntax                        | Description                              |
|-----------------------------------|------------------------------------------|
| `option<T>`                       | Optional value (`null` or `T` in JS)     |
| `result`                          | Success/failure with no payloads         |
| `result<T>`                       | Success with value, failure with no payload |
| `result<T, E>`                    | Success with value, failure with error   |
| `list<T>`                         | Array (`T[]` in JS)                      |
| `tuple<T1, T2, ...>`              | Fixed-length heterogeneous array         |
| `record { field-name: T, ... }`   | Object with named fields                 |
| `variant { case-name(T), ... }`   | Tagged union                             |
| `enum { case-name, ... }`         | Enumeration (string in JS)               |
| `flags { flag-name, ... }`        | Bit-flag set (set of strings in JS)      |

## Result types for JS components

JS activities and workflows use `result`-based return types. The ok and err payloads are
JSON-encoded when passed between components:

- `result` — no ok or err payload
- `result<string>` — ok carries a string value; err has no payload
- `result<string, string>` — ok and err both carry strings; use this for workflows that
  can `throw` a string error

WIT identifiers must use **kebab-case** (e.g. `sleep-millis`, not `sleep_millis`). Obelisk
maps these to JavaScript parameter names automatically.
