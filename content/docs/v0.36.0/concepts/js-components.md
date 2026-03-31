+++
title = "JS Components"
template = "docs.html"
weight = 22
+++

JavaScript activities, workflows, and webhook endpoints are configured in `deployment.toml`
with an `ffqn`, `params`, and `return_type`. Obelisk synthesizes a
{{ doc_link(title="WIT", path="concepts/wit-types.md") }} interface from these fields —
no WIT files are needed.

See the {{ doc_link(title="getting started guide", path="getting-started.md") }} for a
working example.

## Function signatures

The `ffqn` field determines the address other components use to call this function.
The JS function name maps to the last segment of the FFQN. Parameters use snake_case
in JS, kebab-case in WIT and `deployment.toml`:

```javascript
// tutorial:demo/activity.step(idx: u64, sleep-millis: u64) -> result<string>
export default async function step(idx, sleep_millis) { ... }
```

```toml
[[activity_js]]
ffqn = "tutorial:demo/activity.step"
params = [
  { name = "idx", type = "u64" },
  { name = "sleep-millis", type = "u64" },   # kebab-case in TOML and WIT
]
return_type = "result<string>"
```

## Calling child executions

`obelisk.call(ffqn, args)` submits a child execution and blocks until it completes.
Arguments are passed as a positional JSON array matching the WIT parameter order:

```javascript
// step takes (idx: u64, sleep-millis: u64) — pass both as numbers
const result = obelisk.call("tutorial:demo/activity.step", [3, 600]);
```

On success `obelisk.call` returns the ok payload directly. On failure it throws the
err payload as a string.

## Return values and errors

### `result` — no payload on either side

```toml
return_type = "result"
```

```javascript
export default function fn() {
    return;        // ok — no payload
    // throw null; // err — no payload; triggers Obelisk's retry policy
}
```

### `result<string>` — ok carries a value; err has no payload

```toml
return_type = "result<string>"
```

```javascript
export default function fn() {
    return "hello";  // ok("hello")
    // throw null;   // err (no payload) — triggers retry
    // throw "oops"; // FATAL — not allowed; Obelisk requires throw null for result<T>
}
```

Throwing a non-null value when there is no err type is a permanent failure (no retries).

### `result<string, string>` — both variants carry a string

```toml
return_type = "result<string, string>"
```

```javascript
export default function fn(ok) {
    if (ok) return "hello";              // ok("hello")
    throw "something went wrong";        // err("something went wrong") — triggers retry
    // throw new Error("msg")            // also works: Error.message is used
}
```

When an activity returns the err variant, Obelisk schedules a retry according to the
component's retry policy. After all retries are exhausted, the final error is propagated
to the caller. In a workflow, `obelisk.call` throws the err string once the activity
permanently fails. The err variant can also be produced by Obelisk itself — on timeout,
trap (panic), or type-check failure — even when the JS code never throws.

## Inline WIT types

In `deployment.toml`, `params` types and `return_type` accept any
{{ doc_link(title="WIT type", path="concepts/wit-types.md") }} inline, including named types
(`record`, `variant`, `enum`, `flags`) that standard WIT requires to be declared separately.
Obelisk extracts them and generates the declarations automatically:

```toml
params = [
  { name = "point", type = "record { x: u32, y: u32 }" },
]
return_type = "result<variant { found(string), not-found }>"
```

The generated WIT assigns sequential names (`t0`, `t1`, …) to the extracted types.

## Reading join set results

`obelisk.getResult(executionId)` returns the raw result object without unwrapping:

```javascript
const response = js.joinNext();              // { id, ok } or { id } if failed
const result = obelisk.getResult(response.id); // { ok: "value" } or { err: "reason" }
if (result.ok !== undefined) {
    console.log("succeeded:", result.ok);
} else {
    console.log("failed:", result.err);
}
```

## JSON encoding of WIT types

Values in `obelisk.call` arguments and results are JSON-encoded. The mapping between
WIT types and JSON:

| WIT type                          | JSON encoding                                              |
|-----------------------------------|------------------------------------------------------------|
| `bool`                            | `true` / `false`                                          |
| integers, floats                  | JSON number                                               |
| `char`, `string`                  | JSON string                                               |
| `option<T>` — some                | JSON value of T                                           |
| `option<T>` — none                | `null`                                                    |
| `result<T, E>` — ok               | `{"ok": <T value>}`                                       |
| `result<T, E>` — err              | `{"err": <E value>}`                                      |
| `result` / `result<T>` — no payload | `{"ok": null}` / `{"err": null}`                       |
| `list<T>`                         | JSON array                                                |
| `tuple<T1, T2, ...>`              | JSON array `[val1, val2, ...]`                            |
| `record { field-name: T, ... }`   | JSON object; kebab-case keys become snake_case: `{"field_name": val}` |
| `variant { case-name(T) }`        | No payload: `"case_name"`. With payload: `{"case_name": val}` |
| `enum { case-name }`              | `"case_name"` (kebab-case → snake_case)                   |
| `flags { flag-name }`             | Array of active flag strings: `["flag_name"]`             |

Note: kebab-case WIT identifiers become snake_case in JSON keys and values.
