+++
title = "Obelisk 0.41: Safe Deployments for Agents"
date = 2026-08-09
+++

Obelisk 0.41 draws a firm line between what an operator controls and what a deployment can do. That
line is what makes it safe to let an agent author, submit, and activate deployments: the operator
sets secrets and outbound HTTP policy once in `server.toml`, and no deployment can exceed it, no
matter who wrote it. Our proof of concept
[`workflow-agent`](https://github.com/obeli-sk/workflow-agent), where the workflow *is* the agent
editing and pushing deployments, runs entirely inside these boundaries.

<!-- more -->

## The operator owns `server.toml`

A deployment describes an application: its components, their allowed hosts, the secrets they
reference by name. `server.toml` describes the trust the operator is willing to extend to any
deployment on that server. In 0.41 the two are enforced together. Runtime access is the
**intersection** of the operator policy and the deployment's own component policy, so a deployment
can only narrow what the operator granted, never widen it.

That is exactly the property you want when the author is an agent. You can hand it the deployment and
let it iterate, because the blast radius is fixed by a file the agent does not get to rewrite.

## Secrets by name, never by value

Secrets are now operator-owned names declared in a `[secrets]` table:

```toml
# server.toml
[secrets]
LLM_API_KEY = { env = "LLM_API_KEY" }
```

The value is resolved from its source once, before the async runtime even starts, and the source
environment variable is then wiped from the process. Deployments reference the secret **by name
only**:

```toml
[[outbound_http.allowed_host]]
pattern = "${LLM_BASE_URL:-http://127.0.0.1:9190}"
methods = ["POST"]
secrets = ["LLM_API_KEY"]
replace_in = ["headers"]
```

The component receives an opaque placeholder. The runtime substitutes the real value only into
outgoing requests to approved hosts, at the network edge, in the locations `replace_in` selects. The
WASM or JavaScript guest never sees the plaintext and cannot exfiltrate it.
Deployment-side interpolation of secret values is gone entirely.

## Outbound HTTP, gated on both sides

Component-originated outbound HTTP now requires a matching `[[outbound_http.allowed_host]]` entry in
**both** `server.toml` and the deployment. An omitted server allowlist denies all
component-originated HTTP by default. On top of the host `pattern` and `methods`, an optional
`request_url_regex` pins the exact routes a component may call:

```toml
[[outbound_http.allowed_host]]
pattern = "${LLM_BASE_URL:-http://127.0.0.1:9190}"
methods = ["POST"]
request_url_regex = "^POST http[s]?://[^/]+(/[^/]+)*/v1/(messages|chat/completions|responses)$"
secrets = ["LLM_API_KEY"]
replace_in = ["headers"]
```

An agent editing this deployment can point the component at the LLM endpoint the operator approved,
with the key the operator provided, and can reach nothing else.

## Offline verify and repair

`obelisk deployment verify` compiles and checks a local deployment with no running server and no
database. With `--fix` it repairs content digests, updates the exec activity allowlist, and
scaffolds missing secret declarations. This is the loop an agent runs before it ever touches a
server: author the deployment, verify it offline, let `--fix` bring it into shape, then submit. For
single-party setups, `obelisk generate server-config --trusted` emits a minimal configuration that
allows all exec activities and component-originated HTTP without registering secrets.

## Seen in `workflow-agent`

The [`workflow-agent`](https://github.com/obeli-sk/workflow-agent) proof of concept is an Obelisk app
whose workflow is an agent. It mounts the active deployment as a virtual filesystem, edits it with a shell,
verifies it, and can submit and activate the result or open a pull request. Its `server.toml` grants
exactly three destinations, each with a named secret injected at the edge: the LLM endpoint, the
Obelisk API, and the GitHub API. The agent has full run of the deployment, and still cannot read a
token or reach an unlisted host. That is 0.41's boundary doing its job.

The agent loop and its shell used to run on an embedded JavaScript engine. We rewrote both as a
native Rust workflow, porting `just-bash` to Rust so the whole session (chat history, virtual
filesystem, the model-facing `bash` tool) executes as compiled WASM. The payoff is latency: a turn
that replays a cold workflow from its execution log lands in tens of milliseconds, and once the
workflow is warm in memory the hot path is single-digit milliseconds. Durable execution here costs
almost nothing.

## Upgrading

This release is breaking for both operators and component authors. Move
`[activity_exec.secrets] env_vars` to `activity_exec.secrets = ["NAME"]`, flatten nested
`allowed_host.secrets.env_vars` to `secrets = ["NAME"]` with `replace_in = [...]`, declare each name
in `[secrets]`, and copy your existing deployment allowlist entries into `server.toml` as a starting
point before narrowing them. Backtrace persistence is now on demand rather than global, and execution
failure JSON consistently uses `execution_failed`.

The {{ doc_link(title="Migrating to 0.41", path="migrating-to-0.41.md", version="v0.41.0") }} guide
walks through each step with before/after snippets.

For the full model and reference material, see the updated
{{ doc_link(title="Configuration", path="configuration.md") }} and
{{ doc_link(title="CLI", path="cli.md") }} docs.
