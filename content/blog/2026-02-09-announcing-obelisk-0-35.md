+++
title = "Obelisk 0.35: Replay, Pause, Persistent Logs, GitHub Releases"
date = 2026-02-09
+++

Obelisk 0.35 introduces workflow replay for debugging and version migration,
execution pausing, persistent log storage, and streamlined component management
with GitHub release support.

<!-- more -->

Since the [0.32 announcement](@/blog/2025-12-29-announcing-obelisk-0-32.md),
releases 0.33 through 0.35 have landed with significant improvements across
the CLI, WebUI, runtime, and API.

## Workflow Replay

Workflow replay re-executes a workflow from its recorded event history.
This is useful for testing whether a new version of a workflow component
produces the same results as the original execution, before deploying it
to production.

Replay is triggered via the {{ doc_link(title="WebAPI", path="programmatic-access.md", version="v0.35.1") }}:
```sh
curl -X PUT 127.1:5005/v1/executions/<EXECUTION_ID>/replay
```

The replay engine feeds the same inputs and responses from the original
execution into the new workflow component. If the new version makes
different calls or reads different results, the replay reports the
divergence.

## Pause and Unpause

Executions can now be paused and later resumed via the
{{ doc_link(title="WebAPI", path="programmatic-access.md", version="v0.35.1") }}
or WebUI:

```sh
curl -X PUT 127.1:5005/v1/executions/<EXECUTION_ID>/pause
curl -X PUT 127.1:5005/v1/executions/<EXECUTION_ID>/unpause
```

When an execution is paused, it stops processing after completing its
current step. Unpausing returns it to the pending queue.

## Persistent Logs

Execution logs are now stored in the database by default and can be
retrieved at any time via the
{{ doc_link(title="WebAPI", path="programmatic-access.md", version="v0.35.1") }}
or viewed in the Web UI:

```sh
curl 127.1:5005/v1/executions/<EXECUTION_ID>/logs
```

There are two sources of log output:

* **`obelisk:log` interface** (preferred) — structured, string-based
  {{ doc_link(title="logging", path="concepts/logging.md", version="v0.35.1") }}
  with five log levels (`trace` through `error`). Available to activities,
  workflows, and webhook endpoints.
* **`stdout`/`stderr` forwarding** — byte-stream output from `println!` and
  similar. Available to activities and webhook endpoints only.

The `logs_store_min_level` setting controls the minimum level of
`obelisk:log` messages persisted to the database (default: `"debug"`).
The `forward_stdout` and `forward_stderr` settings control stream
forwarding (default: `"db"`).
See {{ doc_link(title="configuration", path="configuration.md", version="v0.35.1") }}
for details.

## Component Management

### `component add`

The new `component add` command downloads a WASM component and adds it
to the TOML configuration:

```sh
obelisk component add activity_wasm ./my-activity.wasm --name my_activity
```

With `--locked`, the component is stored in the local cache and its
`content_digest` is recorded for reproducible builds.

### GitHub Releases

Components can now be fetched directly from GitHub releases using
the `gh://` scheme:

```toml
[[activity_wasm]]
name = "activity_github"
location = "gh://obeli-sk/demo-stargazers@v0.35.0/activity_github.wasm"
```

The format is `gh://owner/repo@tag/asset.wasm`.
Use `latest` as the tag to always fetch the most recent release:

```toml
location = "gh://obeli-sk/demo-stargazers@latest/activity_github.wasm"
```

This also works with `component add` and `component inspect`:
```sh
obelisk component add activity_wasm \
    gh://obeli-sk/demo-stargazers@latest/activity_github.wasm \
    --name activity_github --locked
```

## Permanent Errors

Activities can now signal that an error should not be retried by returning
a variant containing `permanent`. When Obelisk sees this variant, it skips
all remaining retry attempts and immediately reports the error to the
calling workflow. This avoids wasting time retrying errors that are known
to be unrecoverable, such as invalid input or authentication failures:

```toml
[[activity_wasm]]
name = "my_activity"
location = "my_activity.wasm"
exec.retry_on_err.max_retries = 10  # Will be skipped on permanent errors
```

## CLI Changes

The `obelisk client` subcommand has been removed. `execution` and
`component` are now top-level commands:

```sh
# Before (0.32)
obelisk client execution submit ...
obelisk client component list

# Now (0.35)
obelisk execution submit ...
obelisk component list
```

Other notable CLI changes:
- `generate extensions` renamed to `generate wit-extensions`
- New `generate wit-deps` generates importable WIT packages from a TOML config
- New `generate wit-support` generates Obelisk WIT support files for a given component type
- `component inspect` accepts remote locations (`oci://`, `gh://`)
- Configuration can be loaded from a URL: `obelisk server run -c https://example.com/obelisk.toml`

## Configuration

The component `location` field has been simplified. Instead of separate
`location.path` and `location.oci` tables, a single string with scheme
prefixes is used:

```toml
# Before
location.path = "./my-activity.wasm"
location.oci = "docker.io/myaccount/myactivity:latest"

# Now
location = "./my-activity.wasm"
location = "oci://docker.io/myaccount/myactivity:latest"
location = "gh://owner/repo@v1.0.0/asset.wasm"
```

The `obelisk-version` field can be set to ensure the configuration is
compatible with the running server:
```toml
obelisk-version = "0.35"
```

## WebUI Improvements

The WebUI received a significant refresh in 0.33:
- Execution detail page shows color-coded join sets with rail lines
  between submissions and awaits
- Debug view allows stepping to submissions and awaits
- Tracing view has "Autoload child executions" and "Hide finished" controls
- Execution list supports searching by FFQN and Execution ID prefix,
  and filtering by unfinished status

## OpenAPI Schema

The Web API now has an auto-generated
{{ github(title="OpenAPI schema", path="assets/openapi.json", version="v0.35.0") }},
making it easier to generate clients and explore the API.

## WIT Runtime Changes

The WIT interfaces have been updated to version `4.1.0`:
- `submit-delay` and `join-next` moved from the `join-set` resource to
  standalone functions
- New `join-next-try` function for non-blocking polling of join set results
- New `submit-json` and `get-result-json` for working with JSON-serialized
  values
- New `submit-config` record for controlling child execution submission

## Full Changelog

For the complete list of changes, see the
<a target="_blank" href="https://github.com/obeli-sk/obelisk/blob/main/CHANGELOG.md">CHANGELOG</a>.
