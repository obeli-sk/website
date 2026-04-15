+++
title = "Command Line Interface"
template = "docs.html"
weight = 50
+++

## Obelisk Server

### Running the Server

```sh
obelisk server run
```

Following optional options can be provided:

- `--clean-sqlite-directory` - Clean the sqlite database directory
- `--clean-cache` - Clean the codegen and OCI cache directories
- `--clean-codegen-cache` - Clean the codegen cache directory
- `-c, --config <CONFIG>` - Path or URL to the TOML configuration
- `-s, --suppress-type-checking-errors` - Ignore type checking errors

If the `-c` switch is not provided, Obelisk attempts to find the TOML configuration automatically in
the following paths:

1. `obelisk.toml` in the current directory
2. `$CONFIG_DIR/obelisk/obelisk.toml` - See
   {{ doc_link(title="Path Prefixes", path="configuration.md#path-prefixes") }}
3. `/etc/obelisk/obelisk.toml`

Note: `server run` and `server verify` now fail on type checking errors by default. Use
`--suppress-type-checking-errors` to override.

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

Following optional options can be provided:

- `--clean-cache` - Clean the codegen and OCI cache directories
- `--clean-codegen-cache` - Clean the codegen cache
- `-c, --config <CONFIG>` - Path or URL to the TOML configuration
- `-i, --ignore-missing-env-vars` - Do not verify existence of environment variables
- `-s, --suppress-type-checking-errors` - Ignore type checking errors
- `--skip-db` - Do not check database schema

## Obelisk Execution

### Submitting an execution

```sh
obelisk execution submit [OPTIONS] <FUNCTION> [PARAMETERS]
```

Arguments:

- `<FUNCTION>` - Function name
- `[PARAMETERS]`

Accepted Parameter Formats:

- Function name can either be in the
  {{ doc_link(title="fully qualified format", path="concepts/ffqn.md#function-fully-qualified-name-ffqn") }}
  or, if there are no collisions, in a shortened format: `.../interface-name.fn-name`, omitting the
  package and version.

- JSON array string, e.g. `'["first", "second", null, 1]'`

- File reference prefixed with `@`, e.g. `@file.json` (file must contain a valid JSON array)

- Multiple arguments after `--`, e.g. `-- '"first"' @secondparam.json null 1`

- For functions with no parameters: `[]` (JSON array variant) or no arguments.

Options:

- `-e`, `--execution-id` - Supply an execution id
- `-f`, `--follow` - Follow the stream of events until the execution finishes
- `--no-reconnect` - Do not attempt to reconnect on connection error while following the status
  stream
- `-j`, `--json` - Output JSON in Web API format

### Getting the current execution state

```sh
obelisk execution get [OPTIONS] <EXECUTION_ID>
```

Same as with the `submit` command, the execution can be followed until it finishes:

- `-f, --follow` - Follow the status stream until the execution finishes
- `--no-reconnect` - Do not attempt to reconnect on connection error while following the status
  stream

### Cancelling an activity or a delay request

```sh
obelisk execution cancel <ID>
```

Argument `ID` must be either a delay id (starting with `Delay_`), or an execution id (starting with
`E_`) belonging to an activity.

### Providing the result of a stubbed activity

```sh
obelisk execution stub <EXECUTION_ID> <RETURN_VALUE>
```

Arguments:

- `<EXECUTION_ID>` - Execution ID of the stub execution waiting for its return value
- `<RETURN_VALUE>` - Return value encoded as JSON

## Obelisk Component

### Listing available components and functions

```sh
obelisk component list [OPTIONS]
```

Options:

- `-i, --imports` - Show component imports
- `-e, --extensions` - Show auto-generated export extensions

### Inspecting a WASM component

This command outputs the exported functions of a WASM component similarly to
`obelisk component list`. The component can be a local file, an OCI reference, or a GitHub release.

```sh
obelisk component inspect [OPTIONS] <COMPONENT_TYPE> <LOCATION>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`, `webhook_endpoint`
- `<LOCATION>` - Path to a local WASM file, or a remote location (`oci://...`, `gh://...`)

Options:

- `-i, --imports` - Show component imports
- `-e, --extensions` - Show auto-generated export extensions

### Pushing a WASM Component into an OCI Registry

This command does not connect to the server. Use `docker login` to authenticate against the OCI
registry first.

```sh
obelisk component push <PATH> <IMAGE_NAME>
```

Arguments:

- `<PATH>` - WASM file to be pushed
- `<IMAGE_NAME>` - OCI reference. Example: `docker.io/repo/image:tag`

### Adding a component to the configuration

Add a component to the TOML configuration file.

```sh
obelisk component add [OPTIONS] <COMPONENT_TYPE> <LOCATION> --name <NAME>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`, `webhook_endpoint`
- `<LOCATION>` - Path to WASM file, or remote location (`oci://...`, `gh://...`)

Options:

- `-n, --name <NAME>` - Component name (required)
- `-c, --config <CONFIG>` - Path to the TOML configuration, defaults to `obelisk.toml`
- `--locked` - Store the component in local cache and record its `content_digest` for reproducible
  builds

GitHub release paths are supported via `gh://` prefix. Example:

```sh
obelisk component add activity_wasm gh://obeli-sk/demo-stargazers@latest/activity_github.wasm --name activity_github --locked
```

## Obelisk Generate

### Generating extension functions

The {{ doc_link(title="extension", path="concepts/extensions.md") }} WIT files of a given WASM
component can be generated using:

```sh
obelisk generate wit-extensions <COMPONENT_TYPE> <INPUT_WIT_DIRECTORY> <OUTPUT_DIRECTORY>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`. No extensions are
  generated for {{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }}.
- `<INPUT_WIT_DIRECTORY>` - Path to the `wit` folder, containing the target world and possibly
  `deps` subfolder.
- `<OUTPUT_DIRECTORY>` - Path to directory where extensions will be written.

### Generating WIT support functions

As described in {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}, Obelisk
provides types and host functions described as WIT interfaces.

```sh
obelisk generate wit-support <COMPONENT_TYPE> <OUTPUT_DIRECTORY>
```

Arguments:

- `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`, `webhook_endpont`.
- `<OUTPUT_DIRECTORY>` - Path to directory where extensions will be written.

### Generating WIT dependencies

Generate WIT dependency folder based on activities and workflows found in the provided TOML
configuration:

```sh
obelisk generate wit-deps [OPTIONS] <OUTPUT_DIRECTORY>
```

Arguments:

- `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written to.

Options:

- `-c, --config <CONFIG>` - Path or URL to the TOML configuration, defaults to `obelisk.toml`
- `-o, --overwrite` - Overwrite existing files

### Generating configuration

Generate a TOML configuration file:

```sh
obelisk generate config [OPTIONS] [CONFIG]
```

Arguments:

- `[CONFIG]` - Filename to write the TOML to, defaults to `obelisk.toml`

Options:

- `-o, --overwrite` - Overwrite existing file

### Generating an execution ID

Generate a new execution ID:

```sh
obelisk generate execution-id
```
