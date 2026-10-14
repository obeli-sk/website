+++
title = "WIT Basics"
template = "docs.html"
weight = 21
+++

Every function in Obelisk has a typed signature written in
[WIT](https://component-model.bytecodealliance.org/design/wit.html) (WebAssembly Interface Types).
For a JavaScript developer, WIT is simply the type language used in `deployment.toml`: the `params`
and `return_type` of each activity, workflow, and stub.

```toml
[[activity_js]]
ffqn = "tutorial:demo/activity.step"
params = [
  { name = "idx", type = "u32" },
  { name = "sleep-millis", type = "u32" },
]
return_type = "result<u32, string>"
```

The types matter for two reasons:

- **Validation and interoperability.** Obelisk checks parameters and return values against the
  declared types, so a JavaScript workflow can safely call a JavaScript or Rust activity. Imports in
  workflows and webhooks are verified against these signatures when the deployment starts.
- **Runtime behaviour.** Obelisk uses the declared return type to interpret results and drive
  execution. When an activity returns the `err` variant of a `result` type (in JavaScript, when it
  throws), Obelisk treats it as a failure and schedules a retry; an `ok` variant marks the execution
  as finished.

That is why every exported function returns a `result`: it gives Obelisk a place to report timeouts,
crashes, and exhausted retries.

JavaScript components need no WIT files. Obelisk synthesizes the interfaces from `deployment.toml`.
Several components can instead share one folder of `.wit` files with the `wit` field, see
{{ doc_link(title="Function Signatures", path="configuration/deployment.md#function-signatures") }}.
Rust components always define their own WIT files, see
{{ doc_link(title="Rust Components", path="wasm/rust-components.md") }}.

WIT identifiers must use **kebab-case** (e.g. `sleep-millis`, not `sleep_millis`).

## Primitive types

| WIT type | Description             |
| -------- | ----------------------- |
| `bool`   | Boolean                 |
| `u8`     | Unsigned 8-bit integer  |
| `u16`    | Unsigned 16-bit integer |
| `u32`    | Unsigned 32-bit integer |
| `u64`    | Unsigned 64-bit integer |
| `s8`     | Signed 8-bit integer    |
| `s16`    | Signed 16-bit integer   |
| `s32`    | Signed 32-bit integer   |
| `s64`    | Signed 64-bit integer   |
| `f32`    | 32-bit float            |
| `f64`    | 64-bit float            |
| `char`   | Unicode scalar value    |
| `string` | UTF-8 string            |

## Compound types

| WIT syntax                      | Description                                 |
| ------------------------------- | ------------------------------------------- |
| `option<T>`                     | Optional value                              |
| `result`                        | Success/failure with no payloads            |
| `result<T>`                     | Success with value, failure with no payload |
| `result<_, E>`                  | Success with no payload, failure with error |
| `result<T, E>`                  | Success with value, failure with error      |
| `list<T>`                       | Variable-length sequence                    |
| `tuple<T1, T2, ...>`            | Fixed-length heterogeneous sequence         |
| `record { field-name: T, ... }` | Object with named fields                    |
| `variant { case-name(T), ... }` | Tagged union                                |
| `enum { case-name, ... }`       | Enumeration (one of a fixed set)            |
| `flags { flag-name, ... }`      | Bit-flag set                                |

In `deployment.toml`, a `record`, `variant`, `enum`, or `flags` type is written **inline** and
Obelisk assigns it a generated name (`t0`, `t1`, …):

```toml
params = [
  { name = "point", type = "record { x: u32, y: u32 }" },
]
return_type = "result<variant { found(string), not-found }>"
```

## JSON encoding

Execution parameters and results are JSON-encoded, for example on the CLI, in the REST API, and in
JavaScript `dynamic.call`. The mapping between WIT types and JSON:

| WIT type                            | JSON encoding                                                         |
| ----------------------------------- | --------------------------------------------------------------------- |
| `bool`                              | `true` / `false`                                                      |
| integers, floats                    | JSON number                                                           |
| `char`, `string`                    | JSON string                                                           |
| `option<T>` — some                  | JSON value of T                                                       |
| `option<T>` — none                  | `null`                                                                |
| `result<T, E>` — ok                 | `{"ok": <T value>}`                                                   |
| `result<T, E>` — err                | `{"err": <E value>}`                                                  |
| `result` / `result<T>` — no payload | `{"ok": null}` / `{"err": null}`                                      |
| `list<T>`                           | JSON array                                                            |
| `tuple<T1, T2, ...>`                | JSON array `[val1, val2, ...]`                                        |
| `record { field-name: T, ... }`     | JSON object; kebab-case keys become snake_case: `{"field_name": val}` |
| `variant { case-name(T) }`          | No payload: `"case_name"`. With payload: `{"case_name": val}`         |
| `enum { case-name }`                | `"case_name"` (kebab-case → snake_case)                               |
| `flags { flag-name }`               | Array of active flag strings: `["flag_name"]`                         |

Note: kebab-case WIT identifiers become snake_case in JSON keys and values. A record field of type
`option<T>` may be omitted from the JSON object; it is then treated as none.

### Numeric precision

JavaScript components return numbers as JSON numbers. Obelisk accepts numeric conversions between
integer and floating-point WIT types only when the conversion is lossless:

- A whole-number JSON float such as `42.0` can be returned for an integer WIT field.
- A JSON integer such as `42` can be returned for an `f32` or `f64` WIT field when the float can
  represent it exactly.
- Fractional values cannot be returned for integer WIT fields.
- Values that would lose precision are rejected instead of rounded silently.

For JavaScript `Number`, integers are exact only up to `Number.MAX_SAFE_INTEGER` (`2^53 - 1`). Use a
`string` field when a JavaScript component needs to return larger integer identifiers without
precision loss. `f32` has a smaller precision range than `f64`, so some values that fit in `f64`
still cannot be returned for an `f32` field without rounding.

## WIT files

The types above are all you need for `deployment.toml`. When components share a `wit` folder, or
when writing Rust components, the signatures live in `.wit` files instead.

### Package declaration

A WIT file begins with a `package` declaration giving the namespace and package name, optionally
with a version:

```wit
package tutorial:activity;
// or with version:
package tutorial:activity@1.0.0;
```

The package name forms the first part of an interface's
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }}.

### Interface and function declarations

An `interface` block groups related functions. Each function is declared with a name, parameter
names and types, and a return type:

```wit
package tutorial:activity;

interface activity-sleepy {
    step: func(idx: u64, sleep-millis: u64) -> result<u64>;
    health-check: func() -> result;
}
```

### Named type declarations

Types like `record`, `variant`, `enum`, and `flags` can be named and reused across functions:

```wit
interface account {
    record user-info {
        login: string,
        id: u64,
    }

    enum status {
        active,
        suspended,
    }

    variant fetch-error {
        not-found,
        rate-limited(u32),   // payload: seconds until reset
    }

    get-user: func(login: string) -> result<user-info, fetch-error>;
    get-status: func(login: string) -> result<status>;
}
```
