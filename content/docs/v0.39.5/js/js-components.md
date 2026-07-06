+++
title = "JS Components"
template = "docs.html"
weight = 22
+++

Obelisk supports three JS component types, each with its own execution model and API:

- {{ doc_link(title="JS Activities", path="js/js-activities.md") }} — side-effectful work; retried
  automatically on failure
- {{ doc_link(title="JS Workflows", path="js/js-workflows.md") }} — deterministic orchestration;
  survives server crashes via replay
- {{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }} — HTTP handlers; can call activities
  and workflows

## Function signatures and FFQNs

Each component's JS function name maps to the last segment of its
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }}. Parameter names use snake_case in JS but
kebab-case in WIT and `deployment.toml`. A leading comment makes the mapping explicit:

```javascript
// tutorial:demo/activity.step: func(idx: u32, sleep-millis: u32) -> result<u32>
export default async function step(idx, sleep_millis) { ... }
```

```toml
[[activity_js]]
ffqn    = "tutorial:demo/activity.step"
params  = [
  { name = "idx",          type = "u32" },
  { name = "sleep-millis", type = "u32" },
]
return_type = "result<u32>"
```

See {{ doc_link(title="WIT reference", path="concepts/wit-reference.md") }} for the full type
reference and JSON encoding, and {{ doc_link(title="JS activities", path="js/js-activities.md") }}
for how `return` and `throw` map to the `result` variants.

## Inline WIT types

In `deployment.toml`, `params` types and `return_type` accept any WIT type inline — including
`record`, `variant`, `enum`, and `flags`, which standard WIT requires to be declared separately.
Obelisk extracts them and assigns generated names (`t0`, `t1`, …):

```toml
params = [
  { name = "point", type = "record { x: u32, y: u32 }" },
]
return_type = "result<variant { found(string), not-found }>"
```

## OCI distribution

JS components can be pushed to and pulled from OCI registries just like WASM components. Obelisk
embeds component metadata (type, allowed hosts, env vars, secrets, WIT config) in the OCI image
manifest, so `component add` can reconstruct the deployment entry automatically:

```sh
# Push a JS webhook to an OCI registry
obelisk component push --name my_webhook --deployment deployment.toml \
  docker.io/myorg/my-webhook:v1.0.0

# Add the component from OCI (type is auto-detected from manifest metadata)
obelisk component add oci://docker.io/myorg/my-webhook:v1.0.0 \
  --name my_webhook --deployment deployment.toml --locked
```
