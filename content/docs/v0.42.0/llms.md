+++
title = "llms.txt"
template = "llms_txt.html"
weight = 100
slug = "llms.txt"

[extra]
common_design_patterns = [
  { title = "Cleanup supervisor / saga", path = "patterns/cleanup-supervisor/" },
  { title = "Parallel fan-out and durable polling", path = "js/js-patterns/" },
  { title = "Human-in-the-loop signals with stub activities", path = "concepts/activities/stub/" },
]
preamble = """
# Obelisk

Obelisk is a deterministic durable execution engine. Write new apps in JavaScript by default; they run on Boa compiled to WASM, or on native V8 with `OBELISK_JS_RUNTIME=v8`. Use Rust components in Wasmtime when performance or an existing Rust library matters.

## Default authoring path
- Start every new app with `obelisk generate new NAME` (or `obelisk generate new` inside an empty directory). It writes a runnable `app.toml`, `deployment.toml`, JavaScript webhook, workflow, and HTTP activity, and a `README.md`. Adapt the generated files instead of writing the configuration from scratch.
- To add a single configuration file to an existing project, generate its commented reference instead: `obelisk generate app-config app.toml`, `obelisk generate deployment deployment.toml`, or `obelisk generate server-config server.toml` (optional; only needed to change platform defaults such as ports or limits). Every setting in these references is commented out; at minimum uncomment and set `app_name` in `app.toml`.
- JavaScript components are plain `.js` files with WIT-defined signatures.
- Activities are short-lived idempotent units of side-effecting work and can be retried automatically. Activities should spawn containers or VMs for CPU-intensive or long running workloads.
- Workflows are deterministic and replayable. They orchestrate child executions - workflows and activities, and durable timers.
- Webhook endpoints are HTTP handlers that can spawn executions.
- Deployments are versioned. Workflows can be paused between runs, replayed, advanced step by step, or automatically replayed and upgraded when code changes between deployments.
- Cancellation is part of structured concurrency. Activities and delays are cancellable; workflows are cancellable only when their exported function name ends in `-cancellable`. A cancelled workflow is not advanced again, so an ancestor must own cleanup.
- All functions are identified by an FFQN (`namespace:package/interface.function`) and typed with WIT.
- JS components declare their types inline in `deployment.toml` — no WIT files needed, or use `wit = "path/to/wit" to share types with other components.
- Every function must return a fallible type: `result`, `result<T>`, `result<T, string>`, or `result<T, E>` where `E` is a variant containing `execution-failed`. See the Activities and Workflows concept pages for details.
- Configuration is split by owner: `server.toml` (platform admin: limits and listeners, optional), `app.toml` (app admin: app name, secrets, public environment, outbound HTTP, and exec approvals), and `deployment.toml` (components). Agents edit component code and `deployment.toml` freely; a deployment can only use what `app.toml` and `server.toml` grant. Any change to `app.toml` or `server.toml` widens what the app can do, so point it out to a human for review instead of treating it as routine.
- Name each app in `app.toml` with `app_name`; `obelisk generate new` creates it. When running without an app policy file, set `OBELISK_APP_NAME`.
- Outbound HTTP needs a component `allowed_host` entry in `deployment.toml` and a matching `[[outbound_http.allowed_host]]` entry in `app.toml`. Deployment environment variables must be declared in the app's `[public_env]`; credentials go in the app's `[secrets]`.
- Use `obelisk deployment verify --app-config app.toml --deployment deployment.toml --fix` to repair deployment digests and scaffold missing app configuration, then run `obelisk server run --app-config app.toml --deployment deployment.toml`.
- Read the Example Applications page before building an app. Start an agent from `demo-agent`; study `demo-playwright` for durable browser work and `demo-tutorial` for basic workflow patterns. Copy the relevant source and permissions into the new app.
"""
+++
