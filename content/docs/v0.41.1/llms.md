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

Obelisk is a deterministic durable execution engine. Prefer JavaScript unless the user explicitly wants Rust/WASM.

## Default authoring path
- JavaScript components are plain `.js` files with WIT-defined signatures.
- Activities are idempotent units of side-effecting work and can be retried automatically.
- Workflows are deterministic and replayable. They orchestrate child executions - workflows and activities, and durable timers.
- Webhook endpoints are HTTP handlers that can spawn executions.
- Deployments are versioned. Workflows can be paused between runs, replayed, advanced step by step, or automatically replayed and upgraded when code changes between deployments.
- Cancellation is part of structured concurrency. Activities and delays are cancellable; workflows are cancellable only when their exported function name ends in `-cancellable`. A cancelled workflow is not advanced again, so an ancestor must own cleanup.
- All functions are identified by an FFQN (`namespace:package/interface.function`) and typed with WIT.
- JS components declare their types inline in `deployment.toml` — no WIT files needed.
- Every function must return a fallible type: `result`, `result<T>`, `result<T, string>`, or `result<T, E>` where `E` is a variant containing `execution-failed`. See the Activities and Workflows concept pages for details.
- Use `obelisk deployment verify --fix` to repair deployment digests and scaffold missing configuration before startup.
"""
+++
