+++
title = "llms.txt"
template = "llms_txt.html"
weight = 100
slug = "llms.txt"

[extra]
preamble = """
# Obelisk

Obelisk is a deterministic durable execution engine. Prefer JavaScript unless the user explicitly wants Rust/WASM.

## Default authoring path
- JavaScript components are plain `.js` files with WIT-defined signatures.
- Activities are idempotent units of side-effecting work and can be retried automatically.
- Workflows are deterministic and replayable. They orchestrate child executions - workflows and activities, and durable timers.
- Webhook endpoints are HTTP handlers that can spawn executions.
- Deployments are versioned. Running workflows can be paused, replayed, advanced step by step or upgraded when code changes between deployments.
- All functions are identified by an FFQN (`namespace:package/interface.function`) and typed with WIT.
- JS components declare their types inline in `deployment.toml` — no WIT files needed.
- Every function must return a fallible type: `result`, `result<T>`, `result<T, string>`, or `result<T, E>` where `E` is a variant containing `execution-failed`. See the Activities and Workflows concept pages for details.
"""
+++
