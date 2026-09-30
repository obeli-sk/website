+++
title = "Command Line Interface"
template = "docs.html"
weight = 1
+++

## Global Options

- `--api-token <TOKEN>` - API token presented to the server as `Authorization: Bearer <token>` by
  subcommands that talk to the API. Pass it after the subcommand, for example
  `obelisk execution list --api-token <TOKEN>`; `obelisk --api-token <TOKEN> execution list` is
  rejected. Falls back to `$OBELISK_API_TOKEN`; `$OBELISK__API__TOKEN` is deprecated. See
  {{ doc_link(title="Authentication", path="access/authentication.md") }}
- `-v, --version` - Print version. Accepted only directly after `obelisk`, as in `obelisk --version`

## Obelisk Server

### Running the Server

```sh
obelisk server run [OPTIONS]
```

Options:

- `--clean-sqlite-directory` - Delete the SQLite database directory before starting (destroys all
  execution history)
- `--clean-cache` - Delete both the codegen cache and the OCI image cache before starting
- `--clean-codegen-cache` - Delete only the codegen cache; OCI image cache is kept
- `-s, --server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted,
  built-in defaults are used
- `-a, --app-config <FILE>` - Path to the app policy (`app.toml`). If omitted, built-in defaults are
  used and `OBELISK_APP_NAME` must be set
- `-d, --deployment <FILE>` - Path to the deployment TOML file. If provided, the deployment is
  inserted and activated on startup, overriding any existing Enqueued or Active deployment in the
  database
- `--empty` - Start with an empty deployment, ignoring any Enqueued or Active deployment in the
  database
- `--description <DESCRIPTION>` - Optional human-readable description for the deployment created by
  `--deployment` or `--empty`
- `--suppress-type-checking-errors` - Do not fail startup when a component's imports/exports fail
  type checking against the current deployment
- `--no-auth` - Accept unauthenticated requests on the API port. Development / recovery override;
  conflicts with `--api-token`. See
  {{ doc_link(title="Authentication", path="access/authentication.md") }}.
  (`--allow-unauthenticated-api` is a deprecated alias.)
- `--api-token <TOKEN>` - API token required to access the API server. Falls back to
  `$OBELISK_API_TOKEN`; `$OBELISK__API__TOKEN` is deprecated. Conflicts with `--no-auth`

If `--deployment` is not provided, Obelisk uses the Enqueued or Active deployment from the database.

The server requires an app name, from `app_name` in `app.toml` or from `OBELISK_APP_NAME`. The name
selects the default SQLite directory, `${DATA_DIR}/apps/${APP_NAME}/sqlite`. See
{{ doc_link(title="App Configuration", path="configuration/app.md#app-name") }}.

### Verifying the Server Configuration

Instead of running the server one might wish just to verify the TOML configuration. This includes:

- downloading artifacts from OCI registries
- compiling WASM into the `codegen_cache` directory
- verifying that all imports are satisfied
- verifying that environment variables required by activities are present (can be disabled)
- opening the database and applying any pending schema migrations (can be disabled with `--skip-db`)

```sh
obelisk server verify [OPTIONS]
```

Options:

- `--clean-cache` - Delete both the codegen cache and the OCI image cache before verifying
- `--clean-codegen-cache` - Delete only the codegen cache; OCI image cache is kept
- `-s, --server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted,
  built-in defaults are used
- `-a, --app-config <FILE>` - Path to the app policy (`app.toml`). If omitted, built-in defaults are
  used and `OBELISK_APP_NAME` must be set
- `-d, --deployment <FILE>` - Path to the deployment TOML file. If omitted, the database's Enqueued
  deployment is used, falling back to the Active deployment
- `--allow-unavailable-runtime-config` - Verify while runtime values or app and platform approvals
  are pending
- `--suppress-type-checking-errors` - Do not fail when a component's imports/exports fail type
  checking against the deployment
- `--skip-db` - Skip opening the database, which otherwise upgrades its schema to the running
  version. Requires `--deployment`
- `--fix` - Clean generated deployment metadata and, when `--app-config` is passed, scaffold missing
  public environment names, secrets, outbound HTTP destinations, and exec grants in `app.toml` for
  review

The availability flag allows a developer to verify a deployment before an app or platform admin has
supplied required values or approved public environment names, secrets, outbound HTTP destinations,
or exec activities. These gaps produce warnings. Invalid manifests, missing files, compile errors,
and link errors still fail. Activation always checks the actual configuration strictly.

## Obelisk Deployment

Manage deployments (component configurations) stored in the database.

### Verifying a local deployment

Compile and verify a deployment without starting a server or accessing its database:

```sh
obelisk deployment verify --server-config server.toml --app-config app.toml --deployment deployment.toml
```

Options:

- `-s, --server-config <FILE>` - Path to `server.toml`. If omitted, built-in defaults are used
- `-a, --app-config <FILE>` - Path to the app policy (`app.toml`). If omitted, built-in defaults are
  used and `OBELISK_APP_NAME` must be set
- `-d, --deployment <FILE>` - Path to the local deployment TOML file
- `--allow-unavailable-runtime-config` - Verify while runtime values or app and platform approvals
  are pending; activation still checks strictly
- `--suppress-type-checking-errors` - Do not fail on component import/export type errors
- `--fix` - Clean generated deployment metadata and, when `--app-config` is passed, scaffold missing
  public environment names, secrets, outbound HTTP destinations, and exec grants in `app.toml` for
  review
- `--clean-cache` - Delete both the codegen and OCI image caches before verifying
- `--clean-codegen-cache` - Delete only the codegen cache before verifying

### Submitting a deployment

Upload a deployment TOML as a new deployment; print the new deployment ID.

```sh
obelisk deployment submit [OPTIONS] [PATH]
```

Arguments:

- `[PATH]` - Path to the deployment TOML file

Options:

- `--empty` - Submit an empty deployment with no components (mutually exclusive with `PATH`)
- `--allow-unavailable-runtime-config` - Store a verified deployment while runtime values or app and
  platform approvals are pending; activation still checks strictly
- `--description <DESCRIPTION>` - Optional human-readable description
- `--deployment-id <ID>` - Optional client-supplied deployment ID for idempotent submission
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Enqueueing a deployment

Submit a deployment (if a file is given) and enqueue it for activation on the next server restart.

```sh
obelisk deployment enqueue [OPTIONS] [PATH|ID]
```

Arguments:

- `[PATH|ID]` - Path to a deployment TOML file, or an existing deployment ID

Options:

- `--empty` - Enqueue an empty deployment with no components
- `--allow-unavailable-runtime-config` - Submit and enqueue while runtime values or app and platform
  approvals are pending; activation on restart still checks strictly
- `--description <DESCRIPTION>` - Optional human-readable description for a newly submitted
  deployment
- `--deployment-id <ID>` - Optional client-supplied deployment ID for idempotent submission when
  submitting a file or empty deployment
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Applying a deployment

Submit a deployment (if a file is given) and hot-redeploy immediately. Fails if hot-redeploy is not
possible.

```sh
obelisk deployment apply [OPTIONS] [PATH|ID]
```

Arguments:

- `[PATH|ID]` - Path to a deployment TOML file, or an existing deployment ID

Options:

- `--empty` - Apply an empty deployment with no components
- `--description <DESCRIPTION>` - Optional human-readable description for a newly submitted
  deployment
- `--deployment-id <ID>` - Optional client-supplied deployment ID for idempotent submission when
  submitting a file or empty deployment
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Listing deployments

```sh
obelisk deployment list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Showing the active deployment ID

```sh
obelisk deployment active [OPTIONS]
```

Options:

- `--json` - Output as JSON instead of plain text
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Showing a deployment

Show the stored `deployment.toml` for a deployment, a single deployment-owned source file, or the
stored TOML manifest rendered as JSON. The TOML output preserves the submitted formatting and
comments.

```sh
obelisk deployment show [OPTIONS] <ID> [FILE]
```

Arguments:

- `<ID>` - Deployment ID
- `[FILE]` - Deployment-relative path of a stored source file to print

Options:

- `--json` - Print the stored TOML manifest as JSON instead of TOML
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Retrieving a deployment

Retrieve a deployment to disk as a re-submittable `deployment.toml` plus its deployment-owned source
files. By default the exported TOML omits generated content digests and JavaScript module metadata.

```sh
obelisk deployment pull [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Deployment ID

Options:

- `-o, --output <DIR>` - Directory to write `deployment.toml` and source files into (default:
  current directory)
- `-f, --force` - Overwrite existing files in the output directory
- `--include-generated-metadata` - Keep generated content digests and JavaScript module metadata in
  `deployment.toml`, retaining the stored server view
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

## Obelisk Execution

### Submitting an execution

```sh
obelisk execution submit [OPTIONS] <function> [parameters]...
```

Arguments:

- `<function>` - Function to invoke, as a
  {{ doc_link(title="fully qualified name", path="concepts/ffqn.md#function-fully-qualified-name-ffqn") }}
  (`ns:pkg/ifc.fn`) or shortened to `.../ifc.fn` when the interface name is unambiguous
- `[parameters]...` - One of:
  - JSON array string, e.g. `'["first", "second", null, 1]'`
  - File reference prefixed with `@`, e.g. `@file.json` (file must contain a valid JSON array)
  - A lone `-` to read a JSON parameter array from stdin
  - Multiple arguments after `--`, e.g. `-- '"first"' @secondparam.json null 1`
  - For functions with no parameters: `[]` or omit entirely

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-e, --execution-id <ID>` - Use this explicit execution ID instead of having the server assign one
  (useful for idempotency — see `obelisk generate execution-id`)
- `-f, --follow` - Follow the status stream until the execution finishes
- `--follow-logs` - Stream execution logs until completion, then print the result
- `--no-reconnect` - Do not attempt to reconnect on connection error while following
- `--paused` - Create the execution in paused state so it won't run until explicitly unpaused or
  advanced
- `-j, --json` - Output events as JSON in Web API format instead of human-readable text

### Listing executions

```sh
obelisk execution list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `--ffqn <FFQN_PREFIX>` - Filter by function FFQN prefix (any prefix of a fully-qualified name,
  e.g. `namespace:`; short `.../ifc.fn` form not supported)
- `-e, --execution-id <EXECUTION_ID_PREFIX>` - Filter by execution ID or its prefix (useful with
  `--show-derived` to find all child executions)
- `--show-derived` - Include child (derived) executions spawned by workflows
- `--hide-finished` - Hide finished executions
- `--limit <LIMIT>` - Number of executions to return (default: `20`)
- `-j, --json` - Output as JSON instead of human-readable text

#### Example

```sh
obelisk execution list -e E_01KPFKGAGSH91DRVBJZ3AK0T8A --show-derived
```

```
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:3-fibo_1 `Finished: OK` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.391616296 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:2-fibo_1 `Finished: OK` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.390617507 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:1-fibo_1 `Finished: OK` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.388883844 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A `Finished: OK` benchmark-fibo:workflow/fibow.fiboa `2026-04-18 06:12:31.386857278 UTC`
```

### Getting the current execution state

```sh
obelisk execution status [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to look up

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-f, --follow` - Follow the status stream until the execution finishes
- `--no-reconnect` - Do not attempt to reconnect on connection error while following
- `-j, --json` - Output as JSON instead of human-readable text

### Getting the final result

```sh
obelisk execution result [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to look up

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-f, --follow` - Follow until the execution finishes and the final result is available
- `--no-reconnect` - Do not attempt to reconnect on connection error while following
- `-j, --json` - Output as JSON instead of human-readable text

### Fetching logs

```sh
obelisk execution logs [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to fetch logs for

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `--show-derived` - Include logs from child (derived) executions
- `--level <LEVEL>` - Minimum log level: `trace`, `debug`, `info`, `warn`, `error`, `off` (default:
  `debug`)
- `--stream-type <TYPE>` - Select which stream output to show: `stdout`, `stderr`, `none`. If not
  specified, both stdout and stderr are shown. Use `none` to hide all stream output
- `--show-run-id` - Show the run ID in each log line
- `--after <TIMESTAMP>` - Only show entries created after this timestamp (RFC3339)
- `--follow` - Poll for new log entries until the execution finishes
- `--limit <LIMIT>` - Number of log entries to return per request (default: `20`, max: `200`)
- `-j, --json` - Output as JSON instead of human-readable text

### Showing execution events

```sh
obelisk execution events [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `--from <VERSION>` - Start from this event version (inclusive)
- `--limit <LIMIT>` - Number of events to return (default: `20`)
- `-j, --json` - Output as JSON instead of human-readable text

#### Example

```sh
obelisk execution events E_01KPFKGAGSH91DRVBJZ3AK0T8A
```

```
1 `2026-04-18 06:12:31.387608348 UTC` Locked(`2026-04-18 06:12:33.387608348 UTC`, workflow:fibow_rs:sha256:11d530...)
2 `2026-04-18 06:12:31.388883844 UTC` HistoryEvent(JoinSetCreate(o:1-fibo))
3 `2026-04-18 06:12:31.388883844 UTC` HistoryEvent(JoinSetRequest(ChildExecutionRequest(...)))
...
11 `2026-04-18 06:12:31.392790003 UTC` Finished
```

### Showing execution responses

```sh
obelisk execution responses [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `--from <CURSOR>` - Start from this response cursor (inclusive)
- `--limit <LIMIT>` - Number of responses to return (default: `20`)
- `-j, --json` - Output as JSON instead of human-readable text

#### Example

```sh
obelisk execution responses E_01KPFKGAGSH91DRVBJZ3AK0T8A
```

```
1 `2026-04-18 06:12:31.390150065 UTC` o:1-fibo completed successfully: E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:1-fibo_1
2 `2026-04-18 06:12:31.391402695 UTC` o:2-fibo completed successfully: E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:2-fibo_1
3 `2026-04-18 06:12:31.392479831 UTC` o:3-fibo completed successfully: E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:3-fibo_1
```

### Cancelling an activity, cancellable workflow, or delay request

```sh
obelisk execution cancel [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Execution ID of an activity or cancellable workflow (`E_01...`) or a delay request
  (`Delay_01...`)

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

Workflow cancellation is accepted only for workflows whose exported function name ends in
`-cancellable`. This lets an operator release a workflow that is stuck on a long-lived stub, blocked
on a child, or unable to replay after a failed upgrade. Obelisk does not run the cancelled workflow
again; it closes that workflow's join sets and cancels activities, delays, and cancellable workflow
children held by those sets. See
{{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }}.

### Providing the result of a stubbed activity

```sh
obelisk execution stub [OPTIONS] <EXECUTION_ID> <RETURN_VAL>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID of the stub execution waiting for its return value
- `<RETURN_VAL>` - Return value encoded as JSON

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Pausing an execution or delay

Pause a workflow execution, pending activity execution, or pending delay, preventing it from being
picked up until unpaused. A running activity cannot be paused while it is locked; pause applies
between activity runs. Cancel a running activity when it must be interrupted immediately.

```sh
obelisk execution pause [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Execution ID (`E_01...`) or delay ID (`Delay_01...`) to pause

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Resuming a paused execution or delay

```sh
obelisk execution unpause [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Execution ID (`E_01...`) or delay ID (`Delay_01...`) to unpause

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Replaying an execution

Replay a workflow execution from its execution log, checking for non-determinism. The response
indicates whether the execution is advanceable, finished, blocked, or if replay failed.

```sh
obelisk execution replay [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to replay

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-j, --json` - Output as JSON instead of human-readable text

### Persisting workflow backtraces

Replay a workflow and persist its call-site backtraces:

```sh
obelisk execution persist-backtraces [OPTIONS] <EXECUTION_ID>
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)

### Advancing a paused execution

Advance a paused workflow execution by replaying it and applying the next captured writes. This
enables step-through debugging: create an execution with `--paused`, then call `replay` to preview
what would happen next, and `advance` to apply those writes. This lets you inspect each step before
it takes effect, trim events, or mark child executions and delays as paused for further control.

```sh
obelisk execution advance [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to advance

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-j, --json` - Output as JSON instead of human-readable text
- `--trim <TRIM>` - Send only the first N captured writes from replay to advance
- `-p, --pause-all` (alias: `--pause`) - Pause both replayed child executions and delay requests
  when applying the advance
- `--pause-submitted-executions` - Rewrite replayed submitted executions so they are created paused
  when advance is applied
- `--pause-delays` - Rewrite replayed delay requests so they are created paused when advance is
  applied
- `--force` - Advance even if replay finishes with an execution failure, persisting it

### Upgrading an execution

Upgrade a workflow execution to the current component version in the active deployment. Looks up the
execution's FFQN, finds the component exporting it in the active deployment, and upgrades the
execution from its current digest to the new one.

```sh
obelisk execution upgrade [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to upgrade

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `--skip-determinism-check` - Skip the determinism check during upgrade

## Obelisk Admin

The `obelisk admin` commands expose operator-only maintenance and persisted system events through
the authenticated API:

```sh
obelisk admin node-run-id
obelisk admin events list --level warning
obelisk admin events get <event-id>
obelisk admin storage show
```

Retain execution trees, inactive deployments, or system events by age or count. Use `--dry-run`
before destructive retention operations:

```sh
obelisk admin executions retain --max-age 30d --dry-run
obelisk admin deployments retain --count 20 --dry-run
obelisk admin events retain --max-age 30d
```

Delete explicit execution trees or inactive deployments with `admin executions delete` and
`admin deployments delete`. Non-terminal execution trees require `--force`; an execution root that
belongs to the active deployment cannot be force-deleted. Deployment retention always keeps active
and enqueued deployments. Add `--json` for machine-readable output.

## Obelisk Component

### Listing available components and functions

```sh
obelisk component list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`; env:
  `OBELISK_API_URL`)
- `-i, --imports` - Show component imports
- `-e, --extensions` - Show auto-generated export extensions

### Pushing a component to an OCI registry

Push a WASM or JS component to an OCI registry with Obelisk deployment metadata embedded in the
image manifest. Use `docker login` to authenticate against the OCI registry first.

```sh
obelisk component push --deployment <DEPLOYMENT> <COMPONENT_NAME> <OCI>
```

Arguments:

- `<COMPONENT_NAME>` - Component name as it appears in the deployment TOML
- `<OCI>` - OCI reference with `oci://` prefix, e.g. `oci://docker.io/repo/image:tag`
- `--deployment <FILE>` - Path to the input deployment TOML file _(required)_

### Adding a component to the deployment configuration

Add a component to a deployment TOML configuration file from an OCI reference. The component type is
auto-detected from the OCI image metadata embedded by `component push`.

```sh
obelisk component add [OPTIONS] --deployment <DEPLOYMENT> <LOCATION> <COMPONENT_NAME>
```

Arguments:

- `<LOCATION>` - OCI reference with `oci://` prefix, e.g. `oci://docker.io/repo/image:tag`
- `<COMPONENT_NAME>` - Component name in the target deployment TOML
- `--deployment <FILE>` - Path to the target deployment TOML file _(required)_

Options:

- `--locked` - Pin the location with the manifest digest (e.g. `image:tag@sha256:...`)

## Obelisk Generate

### Generating extension functions

The {{ doc_link(title="extension", path="concepts/extensions.md") }} WIT files of a given component
can be generated using:

```sh
obelisk generate wit-extensions [OPTIONS] <COMPONENT_TYPE> <INPUT_WIT_DIRECTORY> <OUTPUT_DIRECTORY>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity`, `activity_stub`, `webhook_endpoint`
- `<INPUT_WIT_DIRECTORY>` - Path to the `wit` folder, containing the target world and possibly a
  `deps` subfolder
- `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written

Options:

- `-j, --json` - Output as JSON instead of human-readable text
- `-f, --force` - Overwrite existing files in the output directory

### Generating WIT support functions

As described in {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}, Obelisk
provides types and host functions described as WIT interfaces.

```sh
obelisk generate wit-support [OPTIONS] <COMPONENT_TYPE> <OUTPUT_DIRECTORY>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity`, `activity_stub`, `webhook_endpoint`
- `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written

Options:

- `-j, --json` - Output as JSON instead of human-readable text
- `-f, --force` - Overwrite existing files in the output directory

### Generating WIT dependencies

Generate WIT dependency folder based on activities and workflows found in the provided deployment
TOML:

```sh
obelisk generate wit-deps [OPTIONS] --deployment <DEPLOYMENT> <OUTPUT_DIRECTORY>
```

Arguments:

- `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written
- `--deployment <FILE>` - Path to the deployment TOML file _(required)_

Options:

- `-j, --json` - Output as JSON instead of human-readable text
- `-f, --force` - Overwrite existing files
- `--skip-local` - Skip local-path components
- `--prune` - Remove obsolete WIT dependencies previously generated by Obelisk, preserving
  user-authored WIT files

### Starting a new app

Create a JavaScript starter app:

```sh
obelisk generate new [NAME]
```

With `NAME`, Obelisk creates a new directory of that name. `NAME` must be a valid app DNS label.
Without `NAME`, it writes into the current directory and derives a lowercase app slug from that
directory's name. The starter contains `app.toml`, `deployment.toml`, a webhook, a workflow, and an
HTTP activity. Existing files and directories are preserved. See the generated `README.md` to run
it.

### Generating server configuration

Print a default server configuration to stdout, or write it to a file when `OUTPUT` is given:

```sh
obelisk generate server-config [OPTIONS] [OUTPUT]
```

Arguments:

- `[OUTPUT]` - Filename to write the TOML to (default: stdout)

Options:

- `-f, --force` - Overwrite existing file
- `--trusted` - Generate a single-party platform configuration that enables exec activities
  (`allowed_exec_activities = "*"`). Each exec activity still needs app approval in `app.toml`

### Generating app configuration

Print a default app configuration to stdout, or write it to a file when `OUTPUT` is given:

```sh
obelisk generate app-config [OPTIONS] [OUTPUT]
```

Arguments:

- `[OUTPUT]` - Filename to write the TOML to (default: stdout)

Options:

- `-f, --force` - Overwrite existing file
- `--trusted` - Allow outbound HTTP from any component with a matching deployment rule. Do not use
  this configuration across an app-admin/deployment-author trust boundary

### Splitting a 0.41 server configuration

Move app-owned policy (`[secrets]`, `[public_env]`, `[[outbound_http.allowed_host]]`, and
`[allowed_exec_activities]`) from an existing `server.toml` into `app.toml`:

```sh
obelisk generate split-config [OPTIONS] --server-config <SERVER_CONFIG>
```

Options:

- `--server-config <FILE>` - Existing `server.toml` to update _(required)_
- `-a, --app-config <FILE>` - Output `app.toml` (default: a sibling of `server.toml`)

See
{{ doc_link(title="Migrating from 0.41 to 0.42", path="migrating-to-0.42.md", version="v0.42.0") }}.

### Generating deployment configuration

Print a default deployment configuration to stdout, or write it to a file when `OUTPUT` is given:

```sh
obelisk generate deployment [OPTIONS] [OUTPUT]
```

Arguments:

- `[OUTPUT]` - Filename to write the TOML to (default: stdout)

Options:

- `-f, --force` - Overwrite existing file

### Generating secret-exposure digests

Calculate the reviewed configuration digests for exec activities and for components that request
plaintext secrets through `exposed_secrets`. The output is pasteable `app.toml` configuration:
`[allowed_exec_activities]` entries for exec activities and `[secrets.<name>.exposed_to]` grants.

```sh
obelisk generate secret-config-digest [OPTIONS] --deployment <DEPLOYMENT> [COMPONENT_NAME]
```

Arguments:

- `[COMPONENT_NAME]` - Limit output to this resolved component name

Options:

- `-d, --deployment <FILE>` - Path to the deployment TOML file _(required)_
- `-j, --json` - Output structured JSON

### Generating a deployment ID

Generate a new deployment ID:

```sh
obelisk generate deployment-id
```

Options:

- `-j, --json` - Output as JSON instead of plain text

### Generating an execution ID

Generate a new execution ID:

```sh
obelisk generate execution-id
```

Options:

- `-j, --json` - Output as JSON instead of plain text

### Generating an API token

Generate a random API token. Stdout contains only the token so the command can be used directly in
environment injection. In an interactive terminal, the corresponding `api.token_hashes` entry is
also printed to stderr. The plaintext token is printed once and never stored; revoke it by deleting
its hash line and restarting the server. See
{{ doc_link(title="Authentication", path="access/authentication.md") }}.

```sh
obelisk generate token
```

Options:

- `-j, --json` - Output the token and its `sha256:` hash as JSON
- `-s, --server-config <FILE>` - Append the token hash to `api.token_hashes` in the server config

### Generating a coding-agent prompt

Print a prompt context for authoring an Obelisk application with a coding agent:

```sh
obelisk generate prompt <DESCRIPTION>
```

Arguments:

- `<DESCRIPTION>` - Description of the application to build

#### Example

```sh
obelisk generate prompt 'Create a daily task that monitors GitHub org "my-org"' | claude
```
