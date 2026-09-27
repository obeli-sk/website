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

Obelisk is a deterministic durable execution engine. Write new apps in JavaScript on the native V8 runtime by default. Use Rust/WASM when the component needs better performance or an existing Rust library. Agents can generate WIT and Cargo boilerplate when Rust is needed.

## Default authoring path
- Start every new app with `obelisk generate new NAME` (or `obelisk generate new` inside an empty directory). It writes a runnable `app.toml`, `deployment.toml`, JavaScript webhook, workflow, and HTTP activity, and a `README.md`. Adapt the generated files instead of writing the configuration from scratch.
- To add a single configuration file to an existing project, generate its commented reference instead: `obelisk generate app-config app.toml`, `obelisk generate deployment deployment.toml`, or `obelisk generate server-config server.toml` (optional; only needed to change platform defaults such as ports or limits). Every setting in these references is commented out; at minimum uncomment and set `app_name` in `app.toml`.
- JavaScript components are plain `.js` files with WIT-defined signatures.
- Activities are idempotent units of side-effecting work and can be retried automatically.
- Workflows are deterministic and replayable. They orchestrate child executions - workflows and activities, and durable timers.
- Webhook endpoints are HTTP handlers that can spawn executions.
- Deployments are versioned. Workflows can be paused between runs, replayed, advanced step by step, or automatically replayed and upgraded when code changes between deployments.
- Cancellation is part of structured concurrency. Activities and delays are cancellable; workflows are cancellable only when their exported function name ends in `-cancellable`. A cancelled workflow is not advanced again, so an ancestor must own cleanup.
- All functions are identified by an FFQN (`namespace:package/interface.function`) and typed with WIT.
- JS components declare their types inline in `deployment.toml` — no WIT files needed.
- Every function must return a fallible type: `result`, `result<T>`, `result<T, string>`, or `result<T, E>` where `E` is a variant containing `execution-failed`. See the Activities and Workflows concept pages for details.
- Configuration is split into `server.toml` (platform limits and listeners, optional), `app.toml` (app name, secrets, public environment, outbound HTTP, and exec approvals), and `deployment.toml` (components).
- Name each app in `app.toml` with `app_name`; `obelisk generate new` creates it. When running without an app policy file, set `OBELISK_APP_NAME`.
- Outbound HTTP needs a component `allowed_host` entry in `deployment.toml` and a matching `[[outbound_http.allowed_host]]` entry in `app.toml`. Deployment environment variables must be declared in the app's `[public_env]`; credentials go in the app's `[secrets]`.
- Use `obelisk deployment verify --app-config app.toml --deployment deployment.toml --fix` to repair deployment digests and scaffold missing app configuration, then run `obelisk server run --app-config app.toml --deployment deployment.toml`.
- Read the Example Applications page before building an app. Start an agent from `agent-template`; study `demo-playwright` for durable browser work and `demo-tutorial` for basic workflow patterns. Copy the relevant source and permissions into the new app.
"""
+++
