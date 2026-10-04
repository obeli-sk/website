+++
title = "Obelisk 0.42: Sandboxes All the Way Down"
date = 2026-10-04
draft = false
+++

Letting a coding agent write your workflows is easy. Letting it ship them is the hard part. Obelisk
0.42 answers that with layers: each layer can only narrow what the one above it allows, and the
agent gets to touch only the innermost one. The configuration is split between the people who own
each boundary, the runtime adds a VM layer for code that needs a real Linux userspace, and
JavaScript can run on native V8.

<!-- more -->

## Security

### Three files, three owners

In 0.41 the operator's policy lived in `server.toml` and the application lived in `deployment.toml`.
That left one file doing two jobs: `server.toml` described both the platform (listeners, database,
resource limits) and what a particular app was allowed to do. 0.42 splits it:

| File              | Owner              | What it holds                                                   |
| ----------------- | ------------------ | --------------------------------------------------------------- |
| `server.toml`     | Platform admin     | Listeners, database, `[limits]`, the exec gate                  |
| `app.toml`        | App admin          | Secrets, public environment, outbound HTTP policy, exec grants  |
| `deployment.toml` | Developers, agents | Components, routes, retries; requests capabilities from the app |

The effective permission is the intersection. A deployment can request less than `app.toml` grants,
never more, and `app.toml` cannot switch on exec activities unless `server.toml` allows it.

This is the split we want for agents. An agent can rewrite code and `deployment.toml` as often as it
likes; `obelisk deployment verify --fix` tells it exactly which `app.toml` entries its change would
need. Those entries are the review. Reading the diff of `app.toml` tells a reviewer which secrets
exist and who reads them, which hosts the app calls, and which native executables it runs, without
reading any of the code.

```toml
# app.toml
app_name = "my-app"

[secrets]
OPENAI_KEY = {}

[[outbound_http.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]
request_url_regex = "^POST https://api\\.openai\\.com/v1/"
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

The running policy has a canonical digest, available at `GET /v1/app-config`, and every deployment
records the digest it was activated under. `obelisk generate split-config` moves app policy out of a
0.41 `server.toml`.

### Plaintext secrets need a signed-off digest

Secrets still default to placeholders that the runtime replaces at the network edge, so component
code never sees the value. Some code legitimately needs the plaintext, such as a webhook verifying
an HMAC signature. In 0.42, WASM and JavaScript activities, webhooks, exec activities, and VM
activities can request that with `exposed_secrets`.

Each exposure requires a grant in `app.toml` bound to a digest of the component's configuration and
its complete set of exposed secrets:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

```toml
# app.toml
[secrets.WEBHOOK_SIGNING_SECRET.exposed_to]
"signed-webhook" = "sha256:..."
```

If the agent changes the component or asks for one more secret, the digest changes and the grant no
longer applies. Nothing is exposed until a human approves the new digest.

### Exec activities: the escape hatch, approved twice

Exec activities run a host process. They are deliberately outside every sandbox, which is why they
now need two signatures: the platform admin opens the gate in `server.toml`, and the app admin
approves the specific digest in `app.toml`. The process starts with a cleared environment and is
killed as a process group when its lock expires. Treat it as the tool of last resort.

## Native V8

JavaScript workflows, activities, and webhooks can now run on native V8 instead of Boa compiled to
WASM: start the server with `OBELISK_JS_RUNTIME=v8`. Each activity gets a fresh isolate and existing
components need no changes. Boa remains the default engine.

Concurrency and memory are bounded per workload and runtime by `[limits]` in `server.toml`, so the
platform admin can cap V8 activities, WASM workflows, and VM activities independently.

Replay is where a faster JavaScript engine pays off: a workflow runs through its recorded history
before doing new work. workflow-agent has two separate workflow implementations, JavaScript and Rust
WASM, including separate Bash interpreters. We replayed a real conversation asking the agent to
build a GitHub contribution app: 18 agent steps, 17 tool calls, and 726 events. On the same Intel
i9-14900HX host with the published Obelisk 0.42.0 binary, the nine measured replays took **123–140
ms on V8**, about **3.1–3.3 s on Boa WASM**, and **105–117 ms for Rust in Wasmtime**. The ranges
show variation between runs of this session; performance across agent sessions depends on the code
and recorded history.

{{ inline_svg(path="blog/2026-10-04-obelisk-0-42/workflow-replay-range.svg") }}

Bars show the median; markers and labels show the observed minimum and maximum over nine calls after
warmup, excluding database loading. All three replayed the complete history to the same waiting
state. Replay uses recorded activity results, so these measurements made no live model or tool
calls.

## VM activities (experimental)

Between the WASM sandbox and a raw host process there was nothing. 0.42 adds `[[activity_vm]]`: a
script that runs inside a Linux VM, with its tools supplied as Nix store paths that are verified and
mounted read-only.

Guest HTTP goes through the same app and deployment policy as every other component, including
secret placeholders, so a VM activity cannot reach a host that a JavaScript activity could not.

Choose a backend by setting `OBELISK_UNSTABLE_ACTIVITY_VM` for both the CLI and the server:

- `bochs-wasm`: the Bochs x86 emulator compiled to WASM, running inside Wasmtime. A Linux VM inside
  the WASM sandbox, with no host binaries required. It is the slowest option and has a fixed 512 MiB
  guest.
- `qemu-tcg` and `qemu-kvm`: native QEMU, with or without KVM, up to 16.25 GiB of guest RAM.
- `firecracker`: a Firecracker microVM, cold booted for each execution; needs `/dev/kvm`.

What does the VM layer cost? We measured from the activity's persisted `Locked` event to its
`Finished` event. The VM runs used a local release build; QEMU used the published 2026-10-01 EROFS
runtime. Docker bars use same-host measurements. The small cases print a string with Bash or use
curl to fetch a local page through Obelisk's HTTP bridge. The larger case is the
[inception Playwright demo](https://github.com/obeli-sk/demo-playwright), which boots Obelisk inside
a browser tab. Each bar is a median in seconds; the scales differ between workloads.

<div style="overflow-x:auto">
<svg role="img" aria-labelledby="vm-bench-title vm-bench-desc" viewBox="0 0 760 525" style="display:block;width:760px;max-width:none;height:auto;color:var(--text);font:14px system-ui,sans-serif">
  <title id="vm-bench-title">Activity latency across VM backends and Docker</title>
  <desc id="vm-bench-desc">Median seconds from Locked to Finished. Bash printf: Firecracker 0.154, QEMU KVM 0.215, QEMU TCG 0.435, Bochs WASM 0.872. Curl: Firecracker 0.179, QEMU KVM 0.269, QEMU TCG 0.733, Bochs WASM 2.243. Inception: Docker 5.744, Firecracker 11.201, QEMU KVM 14.588.</desc>
  <g fill="currentColor">
    <text x="20" y="27" font-weight="700">Bash printf</text><text x="595" y="27">scale: 0–1 s</text>
    <text x="20" y="63">Firecracker</text><text x="20" y="93">QEMU KVM</text><text x="20" y="123">QEMU TCG</text><text x="20" y="153">Bochs WASM</text>
    <text x="670" y="63">0.154 s</text><text x="670" y="93">0.215 s</text><text x="670" y="123">0.435 s</text><text x="670" y="153">0.872 s</text>
    <text x="20" y="207" font-weight="700">Curl to local page</text><text x="595" y="207">scale: 0–2.5 s</text>
    <text x="20" y="243">Firecracker</text><text x="20" y="273">QEMU KVM</text><text x="20" y="303">QEMU TCG</text><text x="20" y="333">Bochs WASM</text>
    <text x="670" y="243">0.179 s</text><text x="670" y="273">0.269 s</text><text x="670" y="303">0.733 s</text><text x="670" y="333">2.243 s</text>
    <text x="20" y="387" font-weight="700">Inception in Chromium</text><text x="595" y="387">scale: 0–20 s</text>
    <text x="20" y="423">Docker</text><text x="20" y="453">Firecracker</text><text x="20" y="483">QEMU KVM</text>
    <text x="670" y="423">5.744 s</text><text x="670" y="453">11.201 s</text><text x="670" y="483">14.588 s</text>
  </g>
  <g fill="none" stroke="currentColor" opacity="0.35">
    <path d="M200 39V160 M600 39V160 M200 219V340 M600 219V340 M200 399V490 M600 399V490"/>
  </g>
  <g style="fill:var(--primary)">
    <rect x="200" y="48" width="62" height="19" rx="3"/><rect x="200" y="78" width="86" height="19" rx="3"/><rect x="200" y="108" width="174" height="19" rx="3"/><rect x="200" y="138" width="349" height="19" rx="3"/>
    <rect x="200" y="228" width="29" height="19" rx="3"/><rect x="200" y="258" width="43" height="19" rx="3"/><rect x="200" y="288" width="117" height="19" rx="3"/><rect x="200" y="318" width="359" height="19" rx="3"/>
    <rect x="200" y="408" width="115" height="19" rx="3"/><rect x="200" y="438" width="224" height="19" rx="3"/><rect x="200" y="468" width="292" height="19" rx="3"/>
  </g>
</svg>
</div>

All timings came from the same Intel i9-14900HX host. The VM runs were sequential, with cached
runtime images and warmup runs. Bash printf and curl use 512 MiB and one guest vCPU; inception uses
8 GiB and four. The [benchmark notes](https://github.com/obeli-sk/demo-playwright/tree/main/bench)
include the commands and sample counts.

See the
{{ doc_link(title="VM activity reference", path="configuration/deployment.md#experimental-vm-activities", version="v0.42.0") }}
for configuration. The guest ABI, configuration, and behavior are experimental.

## Agentic workflows

There are two ways to bring agentic workloads to Obelisk. Let a coding agent such as Claude Code or
Codex generate application code, then deploy it within the application's security policy. Once
deployed, that code runs durably without needing another model call for each execution: a zero-token
architecture for the resulting application.

Or run the agent itself as a durable workflow, with model calls and tools as activities. This is
useful for enterprise agents that wait on people or external systems, and for coding agents that
work inside a simulated Bash session with a persistent virtual filesystem.

[workflow-agent](https://github.com/obeli-sk/workflow-agent) is our prototype of that second path: a
browser UI, a durable agent loop, Bash, MCP tools, and the ability to inspect, edit, and deploy an
Obelisk application. The aim is thousands of concurrent sessions without an external VM per chat.
Waiting sessions are just rows in the database; Obelisk reconstructs their state when work resumes.

![workflow-agent showing the prompt to build a GitHub contribution app, thinking bubbles, and Bash tool calls](/blog/2026-10-04-obelisk-0-42/workflow-agent.png)

These agentic workflows also shape Obelisk's APIs. Earlier versions copied the growing conversation
into every LLM activity, ballooning workflow state and stored data. Now the workflow keeps the
latest reply, while the activity fetches previous messages in a batch. That prompted the new
{{ doc_link(title="batch events API", path="access/api.md#post-v1-executions-events-batch", version="v0.42.0") }},
which reads just the create and finish events of child executions. The
[workflow-agent architecture](https://github.com/obeli-sk/workflow-agent#architecture) explains the
design.

For a smaller starting point, [demo-agent](https://github.com/obeli-sk/demo-agent) provides a
JavaScript agent loop, an LLM activity, example tools, a human-in-the-loop question, and a polling
UI. Its mock deployment runs without an LLM key.

## Web UI: themes and new screens

The Web UI gets light and dark themes, a refreshed layout, deployment graphs, and new screens for
system events and retention. Application logs now have level and stream filters. It uses the REST
API and ships in every 0.42 release binary, served at `http://localhost:8080` by default.

![The updated Web UI showing a deployment's components and their connections](/sc-deployment-graph.png)

## Also in 0.42

- `obelisk generate new` creates a JavaScript starter app.
- Retention and garbage collection run automatically (30 days by default) and can be managed with
  `obelisk admin`; system events are persisted.
- JavaScript and Rust workflows write identical execution logs, so a workflow can switch languages
  mid-execution.
- `execution submit --follow-logs`, SSE streams for `follow=true`, and a batch events endpoint.
- Experimental WASIp3 support for WASM activities and webhooks.
- gRPC and gRPC-web are deprecated; the REST `/v1` API covers everything they did.

## Upgrading

This release breaks configuration, the JavaScript runtime API, WIT packages, and a few API
endpoints. Split your configuration, name the app, import `obelisk:workflow@1.0.0` instead of using
the global `obelisk` object, rename `activity_exec.secrets` to `exposed_secrets` and generate the
grants, and review the new `[limits]` defaults. `deployment get` is now `deployment pull`.

The {{ doc_link(title="Migrating to 0.42", path="migrating-to-0.42.md", version="v0.42.0") }} guide
covers each step, and the
{{ doc_link(title="Security Model", path="security.md", version="v0.42.0") }} page describes how the
layers fit together. The configuration reference is split the same way as the files:
{{ doc_link(title="server.toml", path="configuration/server.md", version="v0.42.0") }},
{{ doc_link(title="app.toml", path="configuration/app.md", version="v0.42.0") }}, and
{{ doc_link(title="deployment.toml", path="configuration/deployment.md", version="v0.42.0") }}.

## Full Changelog

See [CHANGELOG.md](https://github.com/obeli-sk/obelisk/blob/v0.42.0/CHANGELOG.md) for every change.
