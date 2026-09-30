+++
title = "Activities"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities are the fundamental building blocks of work within an Obelisk
{{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. They represent individual,
idempotent operations that perform a specific task, typically a network activity. Think of them as
the "verbs" of your workflow - the interactions with real world that get things done. Activities are
executed at least once for resiliency.

## Defining Features of Activities

- **Idempotency**: Activities must be safe to execute more than once with the same logical input.
  Repeating the activity must not produce an incorrect duplicate side effect. This is the most
  important activity contract, and the responsibility for satisfying it lies with the activity
  implementation.

- **Isolation**: JavaScript activities run in fresh V8 isolates by default. WASM activities run in
  Wasmtime. Exec activities run as host processes; VM activities run through the selected
  experimental VM backend.

- **Retry safety**: Activities must be safe to retry after errors, timeouts, and crashes, but also
  after ambiguous outcomes. In particular, an activity may be executed again even if it already
  completed successfully, for example if the server crashes before the result is durably persisted.
  A correct activity therefore needs to converge to the intended final outcome even when Obelisk
  cannot tell whether a previous attempt already applied the side effect.

- **No unrecoverable local state**: Activities may talk to stateful external systems, but they must
  not depend on important in-memory or process-local state that would be lost on retry. Any state
  required for correctness must be reconstructible from persisted inputs, persisted workflow state,
  or the external world itself.

- **Short-lived**: Activities should do bounded work and complete. Long waits, polling loops, human
  approval, or management of long-lived resources should be modeled as repeated activity invocations
  coordinated by a workflow, not as one attempt that stays alive indefinitely.

- **Resilience**: Obelisk automatically retries activities that fail due to errors, timeouts, or
  crashes. The input parameters and execution results of activities are persistently stored. This
  makes retries reliable at the engine level, but correctness still depends on the activity honoring
  the contracts above.

## A JavaScript activity

An activity is a JavaScript function exported from a module. Its signature is declared in
`deployment.toml`:

```javascript
// myapp:demo/activity.fetch-title: func(url: string) -> result<string, string>
export default async function fetchTitle(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw `HTTP ${resp.status}`; // err: retried
  }
  const html = await resp.text();
  return html.match(/<title>(.*?)<\/title>/)?.[1] ?? ""; // ok
}
```

```toml
[[activity_js]]
name = "fetch_title"
location = "activity/fetch-title.js"
ffqn = "myapp:demo/activity.fetch-title"
params = [{ name = "url", type = "string" }]
return_type = "result<string, string>"

[[activity_js.allowed_host]]
pattern = "https://example.com"
methods = ["GET"]
```

Outbound HTTP is denied unless the deployment requests the host and `app.toml` allows it, see
{{ doc_link(title="Security Model", path="security.md") }}.

Returning a value finishes the execution with `ok`. Throwing produces `err`, which Obelisk retries
until `max_retries` is exhausted. Because an activity can always fail, its `return_type` must be a
`result`. See {{ doc_link(title="JS Activities", path="js/js-activities.md") }} for the full API and
{{ doc_link(title="WIT Basics", path="concepts/wit-reference.md") }} for the available types.

## Activity Types

Obelisk supports four kinds of activities:

- **JavaScript Activities** (`activity_js`): JavaScript functions executed in V8
- **Rust Activities** (`activity_wasm`): Rust components compiled to WebAssembly and run in
  Wasmtime, see {{ doc_link(title="Rust Activities", path="wasm/activities.md") }}
- **Exec Activities** (`activity_exec`): approved host processes used by JavaScript or Rust apps
- **VM Activities** (`activity_vm`): Nix-packaged Linux programs run through an opt-in Bochs, QEMU,
  or Firecracker backend

All four types share the same retry, durability, and observability guarantees, and workflows call
them the same way. The choice depends on your toolchain and use case.

### Exec Activities

Exec activities run any executable as a durable activity. The child process receives function
parameters as JSON-encoded CLI arguments. The result is read from stdout — exit code 0 means
success, non-zero means error. Both stdout and stderr are streamed and persisted, available via the
CLI, REST API, and Web UI.

Example `deployment.toml`:

```toml
[[activity_exec]]
ffqn = "myapp:scripts/greet.greet"
location = "scripts/greet.sh"
params = [{ name = "name", type = "string" }]
return_type = "result<string, string>"
env_vars = [{ key = "PATH", value = "/usr/bin:/bin" }]
max_retries = 5
```

With a corresponding script `scripts/greet.sh`:

```sh
#!/usr/bin/env bash
set -euo pipefail
NAME=$(echo "$1" | jq -r '.')
echo "\"Hello, ${NAME}!\""
```

The script receives each parameter as a JSON-encoded positional argument and must write a
JSON-encoded return value to stdout.

On failure, exit with a non-zero status and write the `err` value, also JSON-encoded, to stdout
(stderr is only logged, never captured into the result). For example, `printf '"not found"'; exit 1`
produces `err("not found")`. A non-zero exit with empty stdout cannot be decoded into a non-unit
`err` arm and instead becomes an uncategorized execution failure.

See
{{ doc_link(title="Deployment Configuration", path="configuration/deployment.md#exec-activities") }}
for all `activity_exec` fields including inline `content`, secrets, environment variables, and
output size limits.
