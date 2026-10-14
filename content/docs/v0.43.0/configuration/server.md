+++
title = "Server Configuration"
template = "docs.html"
weight = 1
+++

`server.toml` is owned by the platform admin and passed with `--server-config`. It sets the runtime
boundary the app runs within: listeners, the database, resource limits, runtimes, logging, named
HTTP servers, and whether exec activities are available at all. These settings belong to the host
and normally stay the same through an app's lifecycle. The file is optional: without it, the
built-in defaults apply. Environment overrides of the form `OBELISK__...` apply to this file only.
See {{ doc_link(title="Configuration", path="configuration/_index.md") }} for how it relates to
`app.toml` and `deployment.toml`.

## API Server

```toml
api.listening_addr = "127.0.0.1:5005"   # Address and port for API server
```

### API Authentication

The API port denies any request without a valid `Authorization: Bearer <token>` header. Persistent
tokens are configured as SHA-256 hashes, which are not secrets, so `server.toml` stays safe to
commit:

```toml
api.token_hashes = [
  "sha256:...",   # agent
  "sha256:...",   # laptop
]
```

A plaintext token can also be injected through `--api-token` or the environment variable
`OBELISK_API_TOKEN`; do not write the plaintext into a committed `server.toml`. There is no
plaintext `api.token` key in `server.toml`. See
{{ doc_link(title="Authentication", path="access/authentication.md") }} for the full model,
generating tokens, and the `--no-auth` recovery flag.

## Web UI

```toml
webui.listening_addr = "127.0.0.1:8080" # Address and port for web UI
```

> **Warning**: The external webhook HTTP server has no authentication. Listening on all interfaces
> (`[::]:<port>`) is not recommended.

## Platform Exec Gate

{{ doc_link(title="Exec activities", path="configuration/deployment.md#exec-activities") }} run host
processes outside the WASM sandbox, so they are **disabled by default**. They need approval from
both the platform admin in `server.toml` and the app admin in `app.toml` (see
{{ doc_link(title="App Exec Approval", path="configuration/app.md#app-exec-approval") }}).

```toml
allowed_exec_activities = "*"   # Allow any app-approved exec activity; startup warns.

# Or limit the platform grant to reviewed component digests:
# [allowed_exec_activities]
# worker = "sha256:..."
```

Omitting the field or setting it to `false` disables exec activities. Every digest in `app.toml`
must be covered by the platform grant. Both files accept an array of digests when overlapping
deployment revisions must be authorized.

## Server Limits

```toml
[limits]
max_persisted_value_size_bytes = 1048576 # 1 MiB default
max_deployment_file_bytes = 20971520 # 20 MiB default
max_transport_message_size_bytes = 536870912 # 512 MiB default
```

`max_deployment_file_bytes` limits an individual file submitted as part of a deployment.
`max_persisted_value_size_bytes` is snapshotted by each new execution tree and bounds persisted
parameters and results. `max_transport_message_size_bytes` independently bounds gRPC messages and
equivalent REST request bodies.

### Execution Slots

Every execution slot in the process is charged to exactly one (workload, runtime) cell. `count` is
how many slots the cell grants, and `memory` is how much memory one slot may hold. Both accept
`"unlimited"`. Byte sizes require a unit key: `memory.mib`, `memory.gib`, or `memory.bytes`. The
defaults are:

```toml
[limits.activities.wasm]       # Includes JavaScript activities on the boa-wasm JS runtime.
count = 500
memory.gib = 1
[limits.activities.v8]
count = 16
memory.mib = 256
[limits.activities.process]    # activity_exec: an operating system process, so no `memory`.
count = 32
[limits.activities.vm_bochs]   # activity_vm (the VM slot cell for all backends)
count = 8
memory.gib = 1
[limits.workflows.wasm]        # Includes JavaScript workflows on the boa-wasm JS runtime.
count = 500
memory.mib = 512
[limits.workflows.v8]
count = 100
memory.mib = 256
[limits.webhooks.wasm]         # Includes JavaScript webhook endpoints on the boa-wasm JS runtime.
count = 500
memory.mib = 512
[limits.webhooks.v8]
count = 16
memory.mib = 256
```

The cells are independent reservations, so no workload or runtime can starve another, and their sum
is the process bound. Executors acquire a slot before locking an execution, so work beyond the limit
stays pending in the database. A webhook request that cannot acquire a slot receives
`503 Service Unavailable`; capacity is acquired only after a route matches.

JavaScript components use the `wasm` or `v8` cells depending on the selected
{{ doc_link(title="JS runtime", path="js/js-runtime.md") }}.

## Automatic Maintenance and Retention

Obelisk removes tombstoned execution trees and unreferenced shared data in bounded background
batches. Automatic maintenance is enabled by default. Completed execution trees, inactive
deployments, and system events each default to a maximum age of 30 days:

```toml
[maintenance.gc]
enabled = true
interval.seconds = 30
batch_size = 1000
batch_delay.milliseconds = 25

[maintenance.gc.retention.executions]
enabled = true
max_age.hours = 720

[maintenance.gc.retention.deployments]
enabled = true
max_age.hours = 720

[maintenance.gc.retention.system_events]
enabled = true
max_age.hours = 720
```

Disable a specific retention policy when that class must be retained indefinitely. Disable
`maintenance.gc` only when maintenance is managed externally. Operator-triggered deletion and
retention operations are also available through `obelisk admin` and `/v1/admin`.

## Sqlite

The SQLite database directory defaults to a per-app path:

```toml
database.sqlite.directory = "${DATA_DIR}/apps/${APP_NAME}/sqlite"
```

`${APP_NAME}` is the configured app name. Releases before 0.42 used `${DATA_DIR}/obelisk-sqlite`;
set that value explicitly to keep using an existing database. See [Path Prefixes](#path-prefixes)
for how `${DATA_DIR}` is translated.

Customize PRAGMA statements. Defaults are in
{{ github(title="crates/db-sqlite/src/sqlite_dao.rs", path="crates/db-sqlite/src/sqlite_dao.rs", version="v0.43.0-rc.1") }}

```toml
database.sqlite.pragma = { "cache_size" = "10000", "synchronous" = "FULL" }
```

## PostgreSQL

Configure connection to Postgres. All of the following keys support environment variable
interpolation.

```toml
database.postgres.host =     "${POSTGRES_HOST}"
database.postgres.user =     "${POSTGRES_USER}"
database.postgres.password = "${POSTGRES_PASSWORD}"
database.postgres.db_name =  "${POSTGRES_DATABASE}"
```

### Database creation

```toml
database.postgres.provision_policy = "never" # One of "auto"|"never".
```

If `auto` is selected, missing database will be created on startup.

## Timers Watcher Configuration

```toml
[timers_watcher]
enabled = true
leeway.milliseconds = 500
tick_sleep.milliseconds = 100
```

## Global WASM Configuration

```toml
[wasm]
cache_directory = "${CACHE_DIR}/wasm"          # WASM file cache location
allocator_config = "auto"                      # One of "auto"|"on_demand"|"pooling"
fuel = "unlimited"                             # If set to an integer, WASM instances consume fuel, details: https://docs.wasmtime.dev/api/wasmtime/struct.Store.html#method.set_fuel
build_semaphore = "unlimited"                  # If set to an integer, limits the number of AOT compilations that can run in parallel.
parallel_compilation = true                    # Enable (default) or disable parallel AOT compilation of each WASM component.
debug = false                                  # Emit DWARF debug info and disable Cranelift optimizations.
```

Concurrency and per-instance memory are configured by the [execution slot](#execution-slots) cells
of `[limits]`.

See [Path Prefixes](#path-prefixes) for how `${CACHE_DIR}` is translated.

### WASM Cache Directory

Path to directory where downloaded or transformed WASM files are stored. Supports
[path prefixes](#path-prefixes). By default `"${CACHE_DIR}/wasm"` or `"./cache/wasm"` if no valid
home directory path could be retrieved from the operating system.

### Allocator Configuration

See
[Allocation strategy](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html)
for instance creation. Can be either
[pooling](https://docs.wasmtime.dev/api/wasmtime/struct.PoolingAllocationConfig.html) or
[on demand](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html#variant.OnDemand).
Default value `auto` will attempt to use the `pooling` strategy with a fallback on error to
`on_demand`.

## Code Generation Cache

The compiled binaries can be stored to speed up startup time.

```toml
[wasm.codegen_cache]
enabled = true
directory = "${CACHE_DIR}/codegen"   # Path to directory where AOT generated code is cached. Supports path prefixes.
```

## JS Runtime Configuration

The `[v8]` table and the choice between the `boa-wasm` and `v8` runtimes are described in
{{ doc_link(title="JS runtime", path="js/js-runtime.md") }}.

## Global Webhook Configuration

```toml
[webhooks]
request_timeout.seconds = 30   # Deadline for a webhook handler to return its HTTP response.
```

The deadline applies to all webhook handlers. It does not limit a streaming response body after the
response has been returned.

## Global Workflow Configuration

```toml
[workflows]
subscription_interruption.seconds = 1  # Interrupts listening for notifications periodically. Needed for Postgres with a local-only subscription mechanism. Value can be "none" or a duration.
max_events_per_run = 100               # Max history events a real workflow run writes before it yields and unlocks, improving fairness across concurrent workflows. Replay uses max_replay_captured_writes instead.
max_replay_captured_writes = 100       # Max captured writes a single replay pass returns. On reaching it, replay stops and returns that many as an advanceable prefix (advance them, then replay again to resume), keeping a non-terminating join-next-try poll loop advanceable in bounded batches.
response_refresh_interval = 32         # Reload responses from the database after this many newly written non-blocking events while a workflow keeps running. Usually set below max_events_per_run. Replay ignores it.
```

## HTTP Servers

The built-in `"external"` HTTP server is always available and does not need to be declared. It
listens on `127.0.0.1:9090` by default; move it with `external.listening_addr`, because declaring an
`[[http_server]]` named `external` is rejected as a duplicate name. The server binds its port even
when no webhook endpoint uses it; set `external.enabled = false` to disable it. Define additional
named servers in `server.toml` when you need non-default ports:

```toml
external.listening_addr = "127.0.0.1:9090" # Address and port for the built-in "external" server
external.enabled = true                    # Set to false to disable the built-in "external" server

[[http_server]]
name = "server_name"                  # Server identifier
listening_addr = "0.0.0.0:9000"       # Listen address and port
```

Named servers defined here can be referenced from `webhook_endpoint_js` and `webhook_endpoint_wasm`
entries in `deployment.toml` via `http_server = "server_name"`.

## Observability

Levels and filtering is configured using
[EnvFilter](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html)
syntax.

### OTLP Tracing

```toml
[otlp]
enabled = true
level = "info,app=trace"   # See filtering syntax
service_name = "obelisk-server"
otlp_endpoint = "http://localhost:4317"
```

### Logging

#### Console Logging

```toml
[log.console]
enabled = false
level = "info,app=debug"   # See filtering syntax
style = "plain_compact"    # One of "plain"|"plain_compact"|"json"
span = "none"              # One of "none"|"new"|"enter"|"exit"|"close"|"active"|"full"
target = false             # Whether to include the target module in message
writer = "stderr"          # One of "stderr"|"stdout". Default: "stderr"
```

#### File Logging

```toml
[log.file]
enabled = false
level = "info,obeli=debug,app=debug" # See filtering syntax
style = "json"             # One of "plain"|"plain_compact"|"json"
span = "close"             # One of "none"|"new"|"enter"|"exit"|"close"|"active"|"full"
target = true              # Whether to include the target module in message
rotation = "daily"         # One of "minutely"|"hourly"|"daily"|"never"
directory = "."
prefix = "obelisk_server_daily" # File name prefix
```

## Path Prefixes

Paths in `server.toml` support these prefixes:

<div class="table">

| Prefix                 | Default Path on Linux    | Details                                                            |
| ---------------------- | ------------------------ | ------------------------------------------------------------------ |
| `~`                    | `~`                      | Home directory                                                     |
| `${DATA_DIR}`          | `~/.local/share/obelisk` | System data directory                                              |
| `${CACHE_DIR}`         | `~/.cache/obelisk`       | System cache directory                                             |
| `${CONFIG_DIR}`        | `~/.config/obelisk`      | System config directory                                            |
| `${SERVER_CONFIG_DIR}` | N/A                      | Directory where the server.toml file is located                    |
| `${TEMP_DIR}`          | /tmp                     | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html) |

</div>

Note: the resolved path on Mac OS and Windows will be different, e.g. for `${CONFIG_DIR}`:

- `/Users/youruser/Library/Application Support/com.obelisk.obelisk-App/` on Mac
- `C:\Users\youruser\AppData\Roaming\obelisk\obelisk\config\` on Windows

See the
[directories crate documentation](https://docs.rs/directories/6.0.0/directories/struct.ProjectDirs.html)
for details.
