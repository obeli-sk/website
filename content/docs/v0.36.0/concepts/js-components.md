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

The JS runtime maps `return` and `throw` to the `result` type:

| JS                    | WIT result variant | Notes                              |
|-----------------------|--------------------|------------------------------------|
| `return undefined`    | `ok` (no payload)  | for `return_type = "result"`       |
| `return "value"`      | `ok("value")`      | for `return_type = "result<string>"` |
| `throw "error"`       | `err("error")`     | err payload is always a string     |

Workflows that can throw should declare `return_type = "result<string, string>"` so that the
err variant has a string payload. An uncaught thrown string causes the execution to fail with
that string as the error; a non-string throw becomes a generic failure.

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
