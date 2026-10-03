+++
title = "Obelisk 0.42: Sandboxes All the Way Down"
date = 2026-09-30
draft = false
+++

Letting a coding agent write your workflows is easy. Letting it ship them is the hard part. Obelisk
0.42 answers that with layers: each layer can only narrow what the one above it allows, and the
agent gets to touch only the innermost one. The configuration is split between the people who own
each boundary, the runtime adds a VM layer for code that needs a real Linux userspace, and
JavaScript can run on native V8.

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

What does the VM layer cost? We measured from the activity's persisted `Locked` event to its
`Finished` event. The VM runs used a local release build; QEMU used the published 2026-10-01 EROFS
runtime. Docker bars use same-host measurements. The small cases print a string with Bash or use
curl to fetch a local page through Obelisk's HTTP bridge. The larger cases are the
[todoapp and inception Playwright demos](https://github.com/obeli-sk/demo-playwright): one opens a
task-list page, while the other boots Obelisk inside a browser tab. Each bar is a median in seconds;
the scales differ between workloads.

<div style="overflow-x:auto">
<svg role="img" aria-labelledby="vm-bench-title vm-bench-desc" viewBox="0 0 760 705" style="display:block;width:760px;max-width:none;height:auto;color:var(--text);font:14px system-ui,sans-serif">
  <title id="vm-bench-title">Activity latency across VM backends and Docker</title>
  <desc id="vm-bench-desc">Median seconds from Locked to Finished. Bash printf: Firecracker 0.154, QEMU KVM 0.215, QEMU TCG 0.435, Bochs WASM 0.872. Curl: Firecracker 0.179, QEMU KVM 0.269, QEMU TCG 0.733, Bochs WASM 2.243. Todoapp: Docker 0.505, Firecracker 0.816, QEMU KVM 1.438, QEMU TCG 12.940, clipped at 2 seconds. Inception: Docker 5.744, Firecracker 11.201, QEMU KVM 14.588.</desc>
  <g fill="currentColor">
    <text x="20" y="27" font-weight="700">Bash printf</text><text x="595" y="27">scale: 0–1 s</text>
    <text x="20" y="63">Firecracker</text><text x="20" y="93">QEMU KVM</text><text x="20" y="123">QEMU TCG</text><text x="20" y="153">Bochs WASM</text>
    <text x="670" y="63">0.154 s</text><text x="670" y="93">0.215 s</text><text x="670" y="123">0.435 s</text><text x="670" y="153">0.872 s</text>
    <text x="20" y="207" font-weight="700">Curl to local page</text><text x="595" y="207">scale: 0–2.5 s</text>
    <text x="20" y="243">Firecracker</text><text x="20" y="273">QEMU KVM</text><text x="20" y="303">QEMU TCG</text><text x="20" y="333">Bochs WASM</text>
    <text x="670" y="243">0.179 s</text><text x="670" y="273">0.269 s</text><text x="670" y="303">0.733 s</text><text x="670" y="333">2.243 s</text>
    <text x="20" y="387" font-weight="700">Todoapp in Chromium</text><text x="540" y="387">scale: 0–2 s; TCG clipped</text>
    <text x="20" y="423">Docker</text><text x="20" y="453">Firecracker</text><text x="20" y="483">QEMU KVM</text><text x="20" y="513">QEMU TCG</text>
    <text x="670" y="423">0.505 s</text><text x="670" y="453">0.816 s</text><text x="670" y="483">1.438 s</text><text x="670" y="513">12.940 s</text>
    <text x="20" y="567" font-weight="700">Inception in Chromium</text><text x="595" y="567">scale: 0–20 s</text>
    <text x="20" y="603">Docker</text><text x="20" y="633">Firecracker</text><text x="20" y="663">QEMU KVM</text>
    <text x="670" y="603">5.744 s</text><text x="670" y="633">11.201 s</text><text x="670" y="663">14.588 s</text>
  </g>
  <g fill="none" stroke="currentColor" opacity="0.35">
    <path d="M200 39V160 M600 39V160 M200 219V340 M600 219V340 M200 399V520 M600 399V520 M200 579V670 M600 579V670"/>
  </g>
  <g style="fill:var(--primary)">
    <rect x="200" y="48" width="62" height="19" rx="3"/><rect x="200" y="78" width="86" height="19" rx="3"/><rect x="200" y="108" width="174" height="19" rx="3"/><rect x="200" y="138" width="349" height="19" rx="3"/>
    <rect x="200" y="228" width="29" height="19" rx="3"/><rect x="200" y="258" width="43" height="19" rx="3"/><rect x="200" y="288" width="117" height="19" rx="3"/><rect x="200" y="318" width="359" height="19" rx="3"/>
    <rect x="200" y="408" width="101" height="19" rx="3"/><rect x="200" y="438" width="163" height="19" rx="3"/><rect x="200" y="468" width="288" height="19" rx="3"/>
    <rect x="200" y="498" width="395" height="19" rx="3"/><path d="M595 498L612 507.5L595 517Z"/>
    <rect x="200" y="588" width="115" height="19" rx="3"/><rect x="200" y="618" width="224" height="19" rx="3"/><rect x="200" y="648" width="292" height="19" rx="3"/>
  </g>
</svg>
</div>

All timings came from the same Intel i9-14900HX host. The VM runs were sequential, with cached
runtime images and warmup runs. Bash printf, curl, and todoapp use 512 MiB and one guest vCPU;
inception uses 8 GiB and four. The
[benchmark notes](https://github.com/obeli-sk/demo-playwright/tree/main/bench) include the commands
and sample counts.

The name says it: the guest ABI, configuration, and behavior may still change or disappear.

## Native V8

JavaScript workflows, activities, and webhooks can now run on native V8 instead of Boa compiled to
WASM: start the server with `OBELISK_JS_RUNTIME=v8`. Each activity gets a fresh isolate and existing
components need no changes. Boa remains the default engine.

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
