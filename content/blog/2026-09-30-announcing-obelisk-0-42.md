+++
title = "Obelisk 0.42: Sandboxes All the Way Down"
date = 2026-09-30
draft = true
+++

Letting a coding agent write your workflows is easy. Letting it ship them is the hard part. Obelisk
0.42 answers that with layers: each layer can only narrow what the one above it allows, and the
agent gets to touch only the innermost one. The configuration is split between the people who own
each boundary, the runtime adds a VM layer for code that needs a real Linux userspace, and
JavaScript now runs on native V8 by default.

<!-- more -->

## Three files, three owners

In 0.41 the operator's policy lived in `server.toml` and the application lived in `deployment.toml`.
That left one file doing two jobs: `server.toml` described both the platform (listeners, database,
resource limits) and what a particular app was allowed to do. 0.42 splits it:

| File              | Owner          | What it holds                                                   |
| ----------------- | -------------- | --------------------------------------------------------------- |
| `server.toml`     | Platform admin | Listeners, database, `[limits]`, the exec gate                  |
| `app.toml`        | App admin      | Secrets, public environment, outbound HTTP policy, exec grants  |
| `deployment.toml` | Anyone, agents | Components, routes, retries; requests capabilities from the app |

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

## Plaintext secrets need a signed-off digest

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

## Exec activities: the escape hatch, approved twice

Exec activities run a host process. They are deliberately outside every sandbox, which is why they
now need two signatures: the platform admin opens the gate in `server.toml`, and the app admin
approves the specific digest in `app.toml`. The process starts with a cleared environment and is
killed as a process group when its lock expires. Treat it as the tool of last resort.

## VM activities (experimental)

Between the WASM sandbox and a raw host process there was nothing. 0.42 adds `[[activity_vm]]`: a
script that runs inside a Linux VM, with its tools supplied as Nix store paths that are verified and
mounted read-only.

```toml
[[activity_vm]]
name = "vm-curl"
ffqn = "example:vm/curl.run"
content = '''#!/usr/bin/env bash
curl -fsS https://api.example.com/v1/items
'''
params = []
return_type = "result<string, string>"
store_paths = [
  "/nix/store/...-bash-interactive-5.3p15",
  "/nix/store/...-curl-8.22.0-bin",
]
memory.mib = 512

[[activity_vm.allowed_host]]
pattern = "https://api.example.com"
methods = ["GET"]
```

Guest HTTP goes through the same app and deployment policy as every other component, including
secret placeholders, so a VM activity cannot reach a host that a JavaScript activity could not.

Choose a backend by setting `OBELISK_UNSTABLE_ACTIVITY_VM` for both the CLI and the server:

- `bochs-wasm`: the Bochs x86 emulator compiled to WASM, running inside Wasmtime. A Linux VM inside
  the WASM sandbox, with no host binaries required. It is the slowest option and has a fixed 512 MiB
  guest.
- `qemu-tcg` and `qemu-kvm`: native QEMU, with or without KVM, up to 16.25 GiB of guest RAM.
- `firecracker`: a Firecracker microVM, cold booted for each execution; needs `/dev/kvm`.

The name says it: the guest ABI, configuration, and behavior may still change or disappear.

## Native V8 by default

JavaScript workflows, activities, and webhooks now run on native V8 instead of Boa compiled to WASM.
Each activity gets a fresh isolate, activities gain Web Crypto, and existing components need no
changes. `OBELISK_JS_RUNTIME=boa-wasm` keeps the previous engine.

Concurrency and memory are now bounded per workload and runtime by `[limits]` cells in
`server.toml`, so the platform admin can cap V8 activities, WASM workflows, and VM activities
independently.

## Also in 0.42

- `obelisk generate new` creates a JavaScript starter app.
- Retention and garbage collection run automatically (30 days by default) and can be managed with
  `obelisk admin`; system events are persisted.
- JavaScript and Rust workflows write identical execution logs, so a workflow can switch languages
  mid-execution.
- `execution submit --follow-logs`, SSE streams for `follow=true`, and a batch events endpoint.
- The Web UI is embedded in every release binary and talks to the REST API.
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

See [CHANGELOG.md](https://github.com/obeli-sk/obelisk/blob/main/CHANGELOG.md) for every change.
