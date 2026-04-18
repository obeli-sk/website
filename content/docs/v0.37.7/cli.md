+++
title = "Command Line Interface"
template = "docs.html"
weight = 50
+++

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
- `--server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted,
  built-in defaults are used
- `-d, --deployment <FILE>` - Path to the deployment TOML file. If provided, the deployment is
  inserted and activated on startup, overriding any existing Enqueued or Active deployment in the
  database
- `--empty` - Start with an empty deployment, ignoring any Enqueued or Active deployment in the
  database
- `-s, --suppress-type-checking-errors` - Do not fail startup when a component's imports/exports
  fail type checking against the current deployment

If `--deployment` is not provided, Obelisk uses the Enqueued or Active deployment from the database.

### Verifying the Server Configuration

Instead of running the server one might wish just to verify the TOML configuration. This includes:

- downloading artifacts from OCI registries
- compiling WASM into the `codegen_cache` directory
- verifying that all imports are satisfied
- verifying that environment variables required by activities are present (can be disabled)
- checking database schema (can be disabled)

```sh
obelisk server verify [OPTIONS]
```

Options:

- `--clean-cache` - Delete both the codegen cache and the OCI image cache before verifying
- `--clean-codegen-cache` - Delete only the codegen cache; OCI image cache is kept
- `--server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted,
  built-in defaults are used
- `-d, --deployment <FILE>` - Path to the deployment TOML file. If omitted, the database's Enqueued
  deployment is used, falling back to the Active deployment
- `-i, --ignore-missing-env-vars` - Skip the check that every environment variable referenced by the
  deployment is set
- `-s, --suppress-type-checking-errors` - Do not fail when a component's imports/exports fail type
  checking against the deployment
- `--skip-db` - Skip opening the database and validating its schema

## Obelisk Deployment

Manage deployments (component configurations) stored in the database.

### Submitting a deployment

Upload a deployment TOML as a new deployment; print the new deployment ID.

```sh
obelisk deployment submit [OPTIONS] [PATH]
```

Arguments:

- `[PATH]` - Path to the deployment TOML file

Options:

- `--empty` - Submit an empty deployment with no components (mutually exclusive with `PATH`)
- `--verify` - Verify all environment variables before persisting
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Enqueueing a deployment

Submit a deployment (if a file is given) and enqueue it for activation on the next server restart.

```sh
obelisk deployment enqueue [OPTIONS] [PATH|ID]
```

Arguments:

- `[PATH|ID]` - Path to a deployment TOML file, or an existing deployment ID

Options:

- `--empty` - Enqueue an empty deployment with no components
- `--verify` - Verify all environment variables before enqueuing
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

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
- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Listing deployments

```sh
obelisk deployment list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Showing a deployment

Show the full configuration of a deployment.

```sh
obelisk deployment show [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Deployment ID

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

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
  - Multiple arguments after `--`, e.g. `-- '"first"' @secondparam.json null 1`
  - For functions with no parameters: `[]` or omit entirely

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
- `-e, --execution-id <ID>` - Use this explicit execution ID instead of having the server assign one
  (useful for idempotency — see `obelisk generate execution-id`)
- `-f, --follow` - Follow the status stream until the execution finishes
- `--no-reconnect` - Do not attempt to reconnect on connection error while following
- `-j, --json` - Output events as JSON in Web API format instead of human-readable text

### Listing executions

```sh
obelisk execution list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
- `--ffqn <FFQN_PREFIX>` - Filter by function FFQN prefix (any prefix of a fully-qualified name,
  e.g. `namespace:`; short `.../ifc.fn` form not supported)
- `-e, --execution_id <EXECUTION_ID_PREFIX>` - Filter by execution ID or its prefix (useful with
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
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:3-fibo_1 `Finished(ok)` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.391616296 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:2-fibo_1 `Finished(ok)` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.390617507 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A.o:1-fibo_1 `Finished(ok)` benchmark-fibo:activity/fiboa.fibo `2026-04-18 06:12:31.388883844 UTC`
E_01KPFKGAGSH91DRVBJZ3AK0T8A `Finished(ok)` benchmark-fibo:workflow/fibow.fiboa `2026-04-18 06:12:31.386857278 UTC`
```

### Getting the current execution state

```sh
obelisk execution get [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to look up

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
- `-f, --follow` - Follow the status stream until the execution finishes
- `--no-reconnect` - Do not attempt to reconnect on connection error while following

### Fetching logs

```sh
obelisk execution logs [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to fetch logs for

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
- `--show-derived` - Include logs from child (derived) executions
- `--level <LEVEL>` - Minimum log level: `trace`, `debug`, `info`, `warn`, `error`, `off` (default:
  `debug`; use `off` with `--show-streams` to suppress structured logs)
- `--show-streams` - Include stdout/stderr stream output
- `--stream-type <TYPE>` - Filter stream output by type (`stdout`, `stderr`); repeatable; only with
  `--show-streams`
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

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
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

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
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

### Cancelling an activity or a delay request

```sh
obelisk execution cancel [OPTIONS] <ID>
```

Arguments:

- `<ID>` - Execution ID of an activity (`E_01...`) or a delay request (`Delay_01...`)

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Providing the result of a stubbed activity

```sh
obelisk execution stub [OPTIONS] <EXECUTION_ID> <RETURN_VAL>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID of the stub execution waiting for its return value
- `<RETURN_VAL>` - Return value encoded as JSON

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Pausing an execution

Pause a workflow execution, preventing it from being picked up until unpaused.

```sh
obelisk execution pause [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to pause

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Resuming a paused execution

```sh
obelisk execution unpause [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to unpause

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Replaying an execution

Replay a workflow execution from its execution log, checking for non-determinism.

```sh
obelisk execution replay [OPTIONS] <EXECUTION_ID>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID to replay

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

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

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
- `--skip-determinism-check` - Skip the determinism check during upgrade

## Obelisk Component

### Listing available components and functions

```sh
obelisk component list [OPTIONS]
```

Options:

- `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
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

- `-o, --overwrite` - Overwrite existing files in the output directory

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

- `-o, --overwrite` - Overwrite existing files
- `--skip-local` - Skip local-path components

### Generating server configuration

Generate a default `server.toml` configuration file:

```sh
obelisk generate server-config [OPTIONS] [OUTPUT]
```

Arguments:

- `[OUTPUT]` - Filename to write the TOML to (default: `server.toml`)

Options:

- `-o, --overwrite` - Overwrite existing file

### Generating deployment configuration

Generate a default `deployment.toml` configuration file:

```sh
obelisk generate deployment [OPTIONS] [OUTPUT]
```

Arguments:

- `[OUTPUT]` - Filename to write the TOML to (default: `deployment.toml`)

Options:

- `-o, --overwrite` - Overwrite existing file

### Generating an execution ID

Generate a new execution ID:

```sh
obelisk generate execution-id
```

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
