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
* `--clean-sqlite-directory` - Delete the SQLite database directory before starting (destroys all execution history)
* `--clean-cache` - Delete both the codegen cache and the OCI image cache before starting
* `--clean-codegen-cache` - Delete only the codegen cache; OCI image cache is kept
* `--server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted, built-in defaults are used
* `-d, --deployment <FILE>` - Path to the deployment TOML file. If provided, the deployment is inserted and activated on startup, overriding any existing Enqueued or Active deployment in the database
* `--empty` - Start with an empty deployment, ignoring any Enqueued or Active deployment in the database
* `-s, --suppress-type-checking-errors` - Do not fail startup when a component's imports/exports fail type checking against the current deployment

If `--deployment` is not provided, Obelisk uses the Enqueued or Active deployment from the database.

### Verifying the Server Configuration

Instead of running the server one might wish just to verify the TOML configuration. This includes:
* downloading artifacts from OCI registries
* compiling WASM into the `codegen_cache` directory
* verifying that all imports are satisfied
* verifying that environment variables required by activities are present (can be disabled)
* checking database schema (can be disabled)

```sh
obelisk server verify [OPTIONS]
```

Options:
* `--clean-cache` - Delete both the codegen cache and the OCI image cache before verifying
* `--clean-codegen-cache` - Delete only the codegen cache; OCI image cache is kept
* `--server-config <FILE>` - Path to the server configuration file (`server.toml`). If omitted, built-in defaults are used
* `-d, --deployment <FILE>` - Path to the deployment TOML file. If omitted, the database's Enqueued deployment is used, falling back to the Active deployment
* `-i, --ignore-missing-env-vars` - Skip the check that every environment variable referenced by the deployment is set
* `-s, --suppress-type-checking-errors` - Do not fail when a component's imports/exports fail type checking against the deployment
* `--skip-db` - Skip opening the database and validating its schema

## Obelisk Deployment

Manage deployments (component configurations) stored in the database.

### Submitting a deployment
Upload a deployment TOML as a new deployment; print the new deployment ID.
```sh
obelisk deployment submit [OPTIONS] [PATH]
```

Arguments:
* `[PATH]` - Path to the deployment TOML file

Options:
* `--empty` - Submit an empty deployment with no components (mutually exclusive with `PATH`)
* `--verify` - Verify all environment variables before persisting
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Enqueueing a deployment
Submit a deployment (if a file is given) and enqueue it for activation on the next server restart.
```sh
obelisk deployment enqueue [OPTIONS] [PATH|ID]
```

Arguments:
* `[PATH|ID]` - Path to a deployment TOML file, or an existing deployment ID

Options:
* `--empty` - Enqueue an empty deployment with no components
* `--verify` - Verify all environment variables before enqueuing
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Applying a deployment
Submit a deployment (if a file is given) and hot-redeploy immediately. Fails if hot-redeploy is not possible.
```sh
obelisk deployment apply [OPTIONS] [PATH|ID]
```

Arguments:
* `[PATH|ID]` - Path to a deployment TOML file, or an existing deployment ID

Options:
* `--empty` - Apply an empty deployment with no components
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Listing deployments
```sh
obelisk deployment list [OPTIONS]
```

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Showing a deployment
Show the full configuration of a deployment.
```sh
obelisk deployment show [OPTIONS] <ID>
```

Arguments:
* `<ID>` - Deployment ID

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

## Obelisk Execution

### Submitting an execution
```sh
obelisk execution submit [OPTIONS] <function> [parameters]...
```

Arguments:
* `<function>` - Function to invoke, as a {{ doc_link(title="fully qualified name", path="concepts/ffqn.md#function-fully-qualified-name-ffqn") }} (`ns:pkg/ifc.fn`) or shortened to `.../ifc.fn` when the interface name is unambiguous
* `[parameters]...` - One of:
  - JSON array string, e.g. `'["first", "second", null, 1]'`
  - File reference prefixed with `@`, e.g. `@file.json` (file must contain a valid JSON array)
  - Multiple arguments after `--`, e.g. `-- '"first"' @secondparam.json null 1`
  - For functions with no parameters: `[]` or omit entirely

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
* `-e, --execution-id <ID>` - Use this explicit execution ID instead of having the server assign one (useful for idempotency — see `obelisk generate execution-id`)
* `-f, --follow` - Follow the status stream until the execution finishes
* `--no-reconnect` - Do not attempt to reconnect on connection error while following
* `-j, --json` - Output events as JSON in Web API format instead of human-readable text

### Getting the current execution state
```sh
obelisk execution get [OPTIONS] <EXECUTION_ID>
```

Arguments:
* `<EXECUTION_ID>` - Execution ID to look up

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
* `-f, --follow` - Follow the status stream until the execution finishes
* `--no-reconnect` - Do not attempt to reconnect on connection error while following

### Cancelling an activity or a delay request
```sh
obelisk execution cancel [OPTIONS] <ID>
```

Arguments:
* `<ID>` - Execution ID of an activity (`E_01...`) or a delay request (`Delay_01...`)

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

### Providing the result of a stubbed activity
```sh
obelisk execution stub [OPTIONS] <EXECUTION_ID> <RETURN_VAL>
```

Arguments:
* `<EXECUTION_ID>` - Execution ID of the stub execution waiting for its return value
* `<RETURN_VAL>` - Return value encoded as JSON

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)

## Obelisk Component

### Listing available components and functions
```sh
obelisk component list [OPTIONS]
```

Options:
* `-a, --api-url <URL>` - Address of the obelisk server (default: `http://127.0.0.1:5005`)
* `-i, --imports` - Show component imports
* `-e, --extensions` - Show auto-generated export extensions

### Pushing a component to an OCI registry
Push a WASM or JS component to an OCI registry with Obelisk deployment metadata embedded in the image manifest. Use `docker login` to authenticate against the OCI registry first.
```sh
obelisk component push --deployment <DEPLOYMENT> <COMPONENT_NAME> <OCI>
```

Arguments:
* `<COMPONENT_NAME>` - Component name as it appears in the deployment TOML
* `<OCI>` - OCI reference with `oci://` prefix, e.g. `oci://docker.io/repo/image:tag`
* `--deployment <FILE>` - Path to the input deployment TOML file *(required)*

### Adding a component to the deployment configuration
Add a component to a deployment TOML configuration file from an OCI reference. The component type is auto-detected from the OCI image metadata embedded by `component push`.
```sh
obelisk component add [OPTIONS] --deployment <DEPLOYMENT> <LOCATION> <COMPONENT_NAME>
```

Arguments:
* `<LOCATION>` - OCI reference with `oci://` prefix, e.g. `oci://docker.io/repo/image:tag`
* `<COMPONENT_NAME>` - Component name in the target deployment TOML
* `--deployment <FILE>` - Path to the target deployment TOML file *(required)*

Options:
* `--locked` - Pin the location with the manifest digest (e.g. `image:tag@sha256:...`)

## Obelisk Generate

### Generating extension functions
The {{ doc_link(title="extension", path="concepts/extensions.md") }} WIT files of a given component can be generated using:
```sh
obelisk generate wit-extensions [OPTIONS] <COMPONENT_TYPE> <INPUT_WIT_DIRECTORY> <OUTPUT_DIRECTORY>
```

Arguments:
* `<COMPONENT_TYPE>` - One of `workflow`, `activity`, `activity_stub`, `webhook_endpoint`
* `<INPUT_WIT_DIRECTORY>` - Path to the `wit` folder, containing the target world and possibly a `deps` subfolder
* `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written

Options:
* `-f, --force` - Overwrite existing files in the output directory

### Generating WIT support functions
As described in {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}, Obelisk provides types and host functions described as WIT interfaces.

```sh
obelisk generate wit-support [OPTIONS] <COMPONENT_TYPE> <OUTPUT_DIRECTORY>
```

Arguments:
* `<COMPONENT_TYPE>` - One of `workflow`, `activity`, `activity_stub`, `webhook_endpoint`
* `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written

Options:
* `-o, --overwrite` - Overwrite existing files in the output directory

### Generating WIT dependencies
Generate WIT dependency folder based on activities and workflows found in the provided deployment TOML:

```sh
obelisk generate wit-deps [OPTIONS] --deployment <DEPLOYMENT> <OUTPUT_DIRECTORY>
```

Arguments:
* `<OUTPUT_DIRECTORY>` - Directory where folders and WIT files will be written
* `--deployment <FILE>` - Path to the deployment TOML file *(required)*

Options:
* `-o, --overwrite` - Overwrite existing files

### Generating server configuration
Generate a default `server.toml` configuration file:

```sh
obelisk generate server-config [OPTIONS] [OUTPUT]
```

Arguments:
* `[OUTPUT]` - Filename to write the TOML to (default: `server.toml`)

Options:
* `-o, --overwrite` - Overwrite existing file

### Generating deployment configuration
Generate a default `deployment.toml` configuration file:

```sh
obelisk generate deployment [OPTIONS] [OUTPUT]
```

Arguments:
* `[OUTPUT]` - Filename to write the TOML to (default: `deployment.toml`)

Options:
* `-o, --overwrite` - Overwrite existing file

### Generating an execution ID
Generate a new execution ID:

```sh
obelisk generate execution-id
```
