+++
title = "JS Components"
template = "docs.html"
weight = 22
+++

Obelisk supports three JS component types, each with its own execution model and API:

- {{ doc_link(title="JS Activities", path="concepts/js-activities.md") }} — side-effectful
  work; retried automatically on failure
- {{ doc_link(title="JS Workflows", path="concepts/js-workflows.md") }} — deterministic
  orchestration; survives server crashes via replay
- {{ doc_link(title="JS Webhooks", path="concepts/js-webhooks.md") }} — HTTP handlers;
  can call activities and workflows

## Function signatures and FFQNs

Each component's JS function name maps to the last segment of its
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }}. Parameter names use snake_case in JS
but kebab-case in WIT and `deployment.toml`. A leading comment makes the mapping explicit:

```javascript
// ffqn: tutorial:demo/activity.step(idx: u64, sleep-millis: u64) -> result<string>
export default async function step(idx, sleep_millis) { ... }
```

```toml
[[activity_js]]
ffqn    = "tutorial:demo/activity.step"
params  = [
  { name = "idx",         type = "u64" },
  { name = "sleep-millis", type = "u64" },
]
return_type = "result<string>"
```

See {{ doc_link(title="WIT types", path="concepts/wit-types.md") }} for the full type
reference and
{{ doc_link(title="JS activities", path="concepts/js-activities.md") }}
for how `return` and `throw` map to the `result` variants.

## JSON encoding

Arguments to `obelisk.call` and results are JSON-encoded. The mapping between WIT types
and JSON (validated against obelisk 0.36.1):

| WIT type                          | JSON encoding                                                   |
|-----------------------------------|-----------------------------------------------------------------|
| `bool`                            | `true` / `false`                                               |
| integers, floats                  | JSON number                                                     |
| `char`, `string`                  | JSON string                                                     |
| `option<T>` — some                | JSON value of T                                                 |
| `option<T>` — none                | `null`                                                          |
| `result<T, E>` — ok               | `{"ok": <T value>}`                                             |
| `result<T, E>` — err              | `{"err": <E value>}`                                            |
| `result` / `result<T>` — no payload | `{"ok": null}` / `{"err": null}`                              |
| `list<T>`                         | JSON array                                                      |
| `tuple<T1, T2, ...>`              | JSON array `[val1, val2, ...]`                                  |
| `record { field-name: T, ... }`   | JSON object; kebab-case keys become snake_case: `{"field_name": val}` |
| `variant { case-name(T) }`        | No payload: `"case_name"`. With payload: `{"case_name": val}`  |
| `enum { case-name }`              | `"case_name"` (kebab-case → snake_case)                         |
| `flags { flag-name }`             | Array of active flag strings: `["flag_name"]`                   |

Note: kebab-case WIT identifiers become snake_case in JSON keys and values.

## Inline WIT types

In `deployment.toml`, `params` types and `return_type` accept any WIT type inline —
including `record`, `variant`, `enum`, and `flags`, which standard WIT requires to be
declared separately. Obelisk extracts them and assigns generated names (`t0`, `t1`, …):

```toml
params = [
  { name = "point", type = "record { x: u32, y: u32 }" },
]
return_type = "result<variant { found(string), not-found }>"
```
