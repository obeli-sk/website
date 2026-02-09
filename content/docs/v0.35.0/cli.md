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

* `--clean-sqlite-directory` - Clean the sqlite database directory
* `--clean-cache` - Clean the codegen and OCI cache directories
* `--clean-codegen-cache` - Clean the codegen cache directory
* `-c, --config <CONFIG>` - Path to the TOML configuration

If the `-c` switch is not provided, Obelisk attempts to find the TOML configuration automatically in the following paths:
1. `obelisk.toml` in the current directory
2. `$CONFIG_DIR/obelisk/obelisk.toml` - See {{ doc_link(title="Path Prefixes", path="configuration.md#path-prefixes") }}
3. `/etc/obelisk/obelisk.toml`

### Verifying the Server Configuration

Instead of running the server one might wish just to verify the TOML configuration. This includes:
* downloading artifacts from OCI registries
* compiling WASM into the `codegen_cache` directory
* verifying that all imports are satisfied
* verifying that environment variables required by activities are present (can be disabled)

```sh
obelisk server verify [OPTIONS]
```

Following optional options can be provided:
* `--clean-cache` - Clean the codegen and OCI cache directories
* `--clean-codegen-cache` - Clean the codegen cache
* `-c, --config <CONFIG>` - Path to the TOML configuration
* `-i, --ignore-missing-env-vars` -Do not verify existence of environment variables

## Obelisk Client

### Submitting an execution
```sh
obelisk client execution submit [OPTIONS] <FUNCTION> [PARAMETERS]
```

Arguments:
*  `<FUNCTION>` - Function name
*  `[PARAMETERS]`

Accepted Parameter Formats:

- Function name can either be in the {{ doc_link(title="fully qualified format", path="concepts/ffqn.md#function-fully-qualified-name-ffqn") }} or,
if there are no collisions, in a shortened format: `.../interface-name.fn-name`, omitting the package and version.

- JSON array string, e.g. `'["first", "second", null, 1]'`

- File reference prefixed with `@`, e.g. `@file.json` (file must contain a valid JSON array)

- Multiple arguments after `--`, e.g. `-- '"first"' @secondparam.json null 1`

- For functions with no parameters: `[]` (JSON array variant) or no arguments.

Options:
* `-e`, `--execution-id` - Supply an execution id
* `-f`, `--follow` - Follow the stream of events until the execution finishes
* `--no-reconnect` - Do not attempt to reconnect on connection error while following the status stream

### Getting the current execution state
```sh
obelisk client execution get [OPTIONS] <EXECUTION_ID>
```
Same as with the `submit` command, the execution can be followed until it finishes:
* `-f, --follow` - Follow the status stream until the execution finishes
* `--no-reconnect` - Do not attempt to reconnect on connection error while following the status stream

### Cancelling an activity or a delay request
```sh
obelisk client execution cancel <ID>
```

Argument `ID` must be either a delay id (starting with `Delay_`), or an execution id (starting with `E_`) belonging to an activity.


### Providing the result of a stubbed activity
```sh
obelisk client execution stub <--return-value <RETURN_VALUE>|--empty|--error> <EXECUTION_ID>
```
Options:
* `--return-value <RETURN_VALUE>` - Stub a return value encoded as JSON
* `--empty` - Stub an empty return value
* `--error` - Stub an error


### Listing available components and functions
```sh
obelisk client component list [OPTIONS]
```
Options:
* `-i, --imports` - Show component imports
* `-e, --extensions` - Show auto-generated export extensions


### Inspecting provided WASM file
This command does not connect to the server, but it outputs the exported functions of a WASM component similarily to `obelisk client component list`.
```sh
obelisk client component inspect [OPTIONS] <COMPONENT_TYPE> <PATH>
```
Arguments:
* `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`, `webhook_endpoint`
* `<PATH>` - Path to the WASM file

Options:
* `-i, --imports` - Show component imports
* `-e, --extensions` - Show auto-generated export extensions
* `-c, --convert-core-module` - Attempt to convert Core WASM Module to a WASM Component

### Pushing a WASM Component into an OCI Registry
This command does not connect to the server. Use `docker login` to authenticate against the OCI registry first.
```sh
obelisk client component push <PATH> <IMAGE_NAME>
```
Arguments:
* `<PATH>` - WASM file to be pushed
* `<IMAGE_NAME>` - OCI reference. Example: `docker.io/repo/image:tag`

## Obelisk Generate

### Generating extension functions
The {{ doc_link(title="extension", path="concepts/extensions.md") }} WIT files of a given WASM component can be generated using:
```sh
obelisk generate extensions <COMPONENT_TYPE> <INPUT_WIT_DIRECTORY> <OUTPUT_DIRECTORY>
```

Arguments:
* `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`. No extensions are generated for {{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }}.
* `<INPUT_WIT_DIRECTORY>` - Path to the `wit` folder, containing the target world and possibly `deps` subfolder.
* `<OUTPUT_DIRECTORY>`  - Path to directory where extensions will be written.

### Generating WIT support functions
As described in {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}, Obelisk provides types and host functions described as WIT interfaces.

```sh
obelisk generate wit-support <COMPONENT_TYPE> <OUTPUT_DIRECTORY>
```

Arguments:
* `<COMPONENT_TYPE>` - One of `workflow`, `activity_wasm`, `activity_stub`, `webhook_endpont`.
* `<OUTPUT_DIRECTORY>`  - Path to directory where extensions will be written.
