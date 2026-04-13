+++
title = "Configuration"
template = "docs.html"
weight = 20
+++


## Overview

In Obelisk 0.36, the configuration is split into two files:

- **`server.toml`** — server-level settings: API, Web UI, database, WASM, logging, HTTP servers, etc.
- **`deployment.toml`** — component arrays only: activities, workflows, webhook endpoints.

### Version Compatibility
The `obelisk-version` field can be set in either file to ensure compatibility with the running Obelisk version:
```toml
obelisk-version = "0.36"
```

### Built-in Defaults

All three servers start automatically with built-in defaults — **no `server.toml` is required** unless you need to change addresses, database settings, or other server-level options:

- **API server** at `127.0.0.1:5005`
- **Web UI** at `127.0.0.1:8080`
- **External webhook server** at `127.0.0.1:9090`

### Running the Server
```sh
obelisk server run --deployment deployment.toml
obelisk server verify --deployment deployment.toml

# With explicit server config:
obelisk server run --server-config server.toml --deployment deployment.toml
obelisk server verify --server-config server.toml --deployment deployment.toml
```

If `--server-config` is omitted, built-in defaults are used.
If `--deployment` is omitted, the database's active/enqueued deployment is used.

---

## Server Configuration (`server.toml`)

### API Server
```toml
api.listening_addr = "127.0.0.1:5005"   # Address and port for API server
```

### Web UI
```toml
webui.listening_addr = "127.0.0.1:8080" # Address and port for web UI
```

> **Warning**: Listening on all interfaces (`[::]:<port>`) is not recommended as authentication is not yet implemented.

### Sqlite
Set SQLite database directory.
```toml
database.sqlite.directory = "${DATA_DIR}/obelisk-sqlite"
```
See [Path Prefixes](#path-prefixes) for how `${DATA_DIR}` is translated.

Customize PRAGMA statements.
Defaults are in
{{ github(title="crates/db-sqlite/src/sqlite_dao.rs", path="crates/db-sqlite/src/sqlite_dao.rs") }}

```toml
database.sqlite.pragma = { "cache_size" = "10000", "synchronous" = "FULL" }
```

### PostgreSQL

Configure connection to Postgres. All of the following keys support environment variable interpolation.

```toml
database.postgres.host =     "${POSTGRES_HOST}"
database.postgres.user =     "${POSTGRES_USER}"
database.postgres.password = "${POSTGRES_PASSWORD}"
database.postgres.db_name =  "${POSTGRES_DATABASE}"
```

#### Database creation
```toml
database.postgres.provision_policy = "never" # One of "auto"|"never".
```
If `auto` is selected, missing database will be created on startup.


### Timers Watcher Configuration

```toml
[timers_watcher]
enabled = true
leeway.milliseconds = 500
tick_sleep.milliseconds = 100
```

### Global WASM Configuration

```toml
[wasm]
cache_directory = "${CACHE_DIR}/wasm"          # WASM file cache location
backtrace.persist = true                       # Persist backtraces on effect calls for all workflows and webhook endpoints.
allocator_config = "auto"                      # One of "auto"|"on_demand"|"pooling"
global_executor_instance_limiter = "unlimited" # If set to an integer, limits the number of concurrent workflow and activity executions.
global_webhook_instance_limiter = "unlimited"  # If set to an integer, limits the number of concurrent webhook requests.
fuel = "unlimited"                             # If set to an integer, WASM instances consume fuel, details: https://docs.wasmtime.dev/api/wasmtime/struct.Store.html#method.set_fuel
parallel_compilation = true                    # Enable (default) or disable parallel AOT compilation of each WASM component.
```

See [Path Prefixes](#path-prefixes) for how `${CACHE_DIR}` is translated.

#### WASM Cache Directory
Path to directory where downloaded or transformed WASM files are stored. Supports [path prefixes](#path-prefixes).
By default `"${CACHE_DIR}/wasm"` or `"./cache/wasm"` if no valid home directory path could be retrieved from the operating system.

#### Allocator Configuration
See [Allocation strategy](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html) for instance creation. Can be either [pooling](https://docs.wasmtime.dev/api/wasmtime/struct.PoolingAllocationConfig.html) or [on demand](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html#variant.OnDemand). Default value `auto` will attempt
to use the `pooling` strategy with a fallback on error to `on_demand`.

### Code Generation Cache
The compiled binaries can be stored to speed up startup time.
```toml
[wasm.codegen_cache]
enabled = true
directory = "${CACHE_DIR}/codegen"   # Path to directory where AOT generated code is cached. Supports path prefixes.
```

### Global Preopened Directories Configuration
Preopened directory support for activities is disabled by default. It must be enabled both globally and specifically for each activity that uses disk IO.
```toml
[activities.directories]
enabled = false                           # Disabled by default.
parent_directory = "${TEMP_DIR}/obelisk"  # Make sure the folder is not on a RAM-backed filesystem if you plan to write large files.
cleanup.enabled = true                    # Periodic cleanup job can be disabled, it is enabled by default.
cleanup.run_every.minutes = 1             # Run the cleanup every minute by default.
cleanup.older_than.minutes = 5            # Delete folders belonging to executions that finished 5 minutes earlier by default.
```

### Global Workflow Configuration
```toml
[workflows]
lock_extension_leeway.milliseconds = 100         # Starts extending the lock a little before it expires, specifically at expires_at minus the configured leeway.
```

## HTTP Servers

The built-in `"external"` HTTP server is always available at `127.0.0.1:9090` and does not need to be declared. Define additional named servers in `server.toml` when you need non-default ports:

```toml
[[http_server]]
name = "server_name"                  # Server identifier
listening_addr = "0.0.0.0:9000"       # Listen address and port
max_inflight_requests = "unlimited"   # Concurrent request limit
```

Named servers defined here can be referenced from `webhook_endpoint_wasm` entries in `deployment.toml` via `http_server = "server_name"`.

## Observability

Levels and filtering is configured using
[EnvFilter](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html) syntax.

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

---

## Deployment Configuration (`deployment.toml`)

The deployment file contains only component arrays. All server-level settings must go in `server.toml`.

### Common Component Settings

All WASM components (Activities, Workflows, Webhooks) share these configuration options:

```toml
name = "component_name"                         # Required: Component identifier
location = "path/to/wasm"                       # File path location
location = "oci://docker.io/repo/image:tag"     # OCI registry location (note the oci:// prefix)
location = "gh://owner/repo@v1.0.0/asset.wasm"  # GitHub release at specific tag
location = "gh://owner/repo@latest/asset.wasm"  # GitHub release using the latest tag
content_digest = "sha256:..."                   # Optional: WASM file hash verification. Recommended for GitHub releases.
```
Value of `location` supports [path prefixes](#path-prefixes) when used as a file path.

Note: The `location` field uses a single string with optional scheme prefixes (`oci://`, `gh://`). Plain paths without a prefix are treated as local file paths. The `gh://` format is `gh://owner/repo@tag/asset.wasm`, where `tag` is a release tag or `latest`.

### Common Executor Settings

```toml
exec.batch_size = 5                            # Executions per event loop tick
exec.lock_expiry.seconds = 1                   # Execution lock duration
exec.tick_sleep.milliseconds = 200             # Executor sleeps the specified duration when polling for pending executions
exec.locking_strategy = "by_component_digest"  # Default. One of "by_component_digest"|"by_ffqns"
```

The default `by_component_digest` strategy locks executions to the exact WASM component version
(by `sha256` digest) that was available when the execution was first submitted.
An execution can be upgraded to use a different digest using the upgrade API endpoint or gRPC RPC.

## Activities

### WASM Activities

Configure each WASM activity component using the `activity_wasm` section:

```toml
[[activity_wasm]]
name = "..."
location = "oci://..."
# Common component and executor settings apply
max_retries = 5                      # Maximum retry attempts
retry_exp_backoff.milliseconds = 100 # Initial retry delay (doubles each attempt)
forward_stdout = "db"                # stdout forwarding ("db"|"stdout"|"stderr"|"none"). Default: "db"
forward_stderr = "db"                # stderr forwarding ("db"|"stdout"|"stderr"|"none"). Default: "db"
env_vars = ["ENV1", "ENV2=value"]    # Environment variable configuration. Inherit from system if value is not provided.
logs_store_min_level = "debug"       # Minimum log level to persist in the database. One of "off"|"trace"|"debug"|"info"|"warn"|"error". Default: "debug"
```

#### Permanent Error Handling
Activities returning a variant containing a case named `permanent` will skip retries, regardless of `max_retries`.

#### Outbound HTTP Allowlist

Activities that make outbound HTTP calls require explicit `[[allowed_host]]` entries. Without them, **all outbound HTTP is blocked**.

```toml
[[activity_wasm]]
name = "activity_llm"
location = "..."
exec.lock_expiry.seconds = 10
env_vars = [{key = "API_BASE_URL", value = "${API_BASE_URL:-https://api.openai.com}"}]

[[activity_wasm.allowed_host]]
pattern = "${API_BASE_URL:-https://api.openai.com}"
methods = ["POST"]

[activity_wasm.allowed_host.secrets]
env_vars = ["OPENAI_API_KEY"]
replace_in = ["headers"]
```

Pattern supports wildcards: `"*"` matches all HTTPS hosts on port 443, `"*://*"` matches any host on default ports, `"*.example.com"` matches subdomains. The `pattern` field supports `${VAR}` and `${VAR:-default}` env var interpolation.

Secrets are injected via placeholder replacement in outgoing HTTP requests. WASM receives an opaque placeholder; the runtime substitutes real values only for requests to approved hosts.

### JavaScript Activities

```toml
[[activity_js]]
name = "name"
location = "path/to/source.js"          # Local path or gh://user/repo@release/file.js
ffqn = "namespace:package/interface@version.function"  # Required
params = [                               # Optional, defaults to no parameters
  { name = "param1", type = "string" },
  { name = "count", type = "u32" },
]
return_type = "result"                   # Defaults to "result". Must be result, result<T>, result<T, string>, or result<T, variant{...}>
max_retries = 5
retry_exp_backoff.milliseconds = 100
forward_stdout = "db"
forward_stderr = "db"
logs_store_min_level = "debug"
```

Outbound HTTP allowlist: same `[[activity_js.allowed_host]]` syntax as `activity_wasm`.

### Stub activities

```toml
[[activity_stub]]
name = "..."
location = "oci://..."
```

Inline mode (no WASM file required):
```toml
[[activity_stub]]
name = "my-stub"
ffqn = "namespace:package/interface.function"
params = [{ name = "id", type = "u64" }]
return_type = "result<string, string>"
```

### External activities
```toml
[[activity_external]]
name = "..."
location = "oci://..."
```

### Preopened directory support
Disk IO must be explicitly enabled using the global `activities.directories.enabled = true` setting in `server.toml`.
When enabled, a directory will be created on host and mapped to `.` on the guest activity with all permissions.
On host the directory is created as `activities.directories.parent_directory`/ExecutionID and is truncated after the activity finishes.

```toml
directories  = { enabled = true, reuse_on_retry = false}
```

`reuse_on_retry` disabled by default: every execution attempt will start with an empty preopened directory.

If `reuse_on_retry` is enabled, a retried activity can reuse the same directory that was used by previous attempt. This
can be helpful if an activity e.g. downloads a file and then processes it. Activity must in this case do all of its operations
idempotently (e.g. `mkdir -p`) and verify the integrity of all files left by previous attempts.

Read more about {{ doc_link(title="Preopened directories", path="concepts/activities/preopened-dirs.md") }}.

### Process Spawn API
In order to enable the `obelisk:activity/process@1.0.0` API, preopened directory must be enabled and
`process_provider` must be set to  `"native"`.

```toml
directories  = { enabled = true, reuse_on_retry = false, process_provider = "native"}
```

Read more about {{ doc_link(title="Process API", path="concepts/activities/process.md") }}.

## Workflows

### WASM Workflows

Configure each workflow component using the `workflow_wasm` section:

```toml
[[workflow_wasm]]
name = "..."
location = "oci://..."
# Common component and executor settings apply
retry_exp_backoff.milliseconds = 100  # Initial retry delay

# Blocking strategy:
blocking_strategy = "await"           # One of ("await"|"interrupt"|{"kind"=...})
# Default strategy is await.
# Customize the number of non-blocking events that can be cached and written in a batch.
# blocking_strategy = { kind = "await", non_blocking_event_batching = 100 }

# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}

# Stub WASI CLI world imports. Only needed for workflows authored in TinyGo.
stub_wasi = false                     # Default is false.

## Automatic lock extension can be disabled by setting the duration to zero.
lock_extension.seconds = 1

logs_store_min_level = "debug"       # Minimum log level to persist in the database. Default: "debug"
```

The blocking strategy controls whether an execution should `await` the child execution response
or be `interrupt`ed and later replayed. Note that the `await` strategy will only wait until `lock_expiry`
duration expires.

### JavaScript Workflows

```toml
[[workflow_js]]
name = "name"
location = "path/to/workflow.js"       # Local path or gh://user/repo@release/file.js
ffqn = "namespace:package/interface@version.function"  # Required
params = [                             # Optional
  { name = "param1", type = "string" },
]
return_type = "result"
retry_exp_backoff.milliseconds = 100
lock_extension = true
blocking_strategy = "await"
logs_store_min_level = "debug"
```

## Webhook Endpoints

A Webhook Endpoint must be associated with a HTTP Server and must define one or
more routes to listen on.
Routes are divided into two categories: with HTTP methods (high priority)
and without HTTP methods (low priority).
When a request matches multiple routes of the same priority,
the first webhook will receive it.

The built-in `"external"` HTTP server (at `127.0.0.1:9090` by default) is always available and used when `http_server` is omitted. Additional named servers are defined in `server.toml`.

### WASM Webhook Endpoints
```toml
[[webhook_endpoint_wasm]]
name = "..."
location = "oci://..."
# Common component settings apply
http_server = "server_name"          # Optional: reference to a named HTTP server in server.toml. Defaults to built-in "external" server.
routes = [                           # Route configurations
    { methods = ["GET"], route = "/path" },
    "/other/*",
    "/status/:param1/:param2"
]
forward_stdout = "db"                # stdout forwarding ("db"|"stdout"|"stderr"|"none"). Default: "db"
forward_stderr = "db"                # stderr forwarding ("db"|"stdout"|"stderr"|"none"). Default: "db"
env_vars = ["ENV1", "ENV2=value"]    # Environment variable configuration. Inherit from system if value is not provided.
# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}
```

### JavaScript Webhook Endpoints
```toml
[[webhook_endpoint_js]]
name = "name"
location = "path/to/webhook.js"
http_server = "external"             # Optional: defaults to built-in "external" server
routes = [{ methods = ["GET"], route = "/some"}, "/other"]
forward_stdout = "stderr"
forward_stderr = "stderr"
logs_store_min_level = "debug"
env_vars = ["ENV1", "ENV2=value"]
```

#### Route Syntax
Routes: Define URL paths (only the path is matched):

##### Static paths
- `"/"` - Root path only
- `"/path"` - Exact path match

##### Wildcards
- `"/path/*"` - Path prefix match
- `"{ methods = ["GET"], route = "/path" }"` - Method-specific (priority) match

##### Parameterized
- `"/status/:param1/:param2"` - Path parameters (exposed as env vars)

##### All paths
- `""` or `"/*"` - Match all paths


## Path Prefixes

The following path prefixes are supported:

In `deployment.toml`:

<div class="table">

| Prefix                 | Default Path on Linux      | Details                                           |
|------------------------|----------------------------|---------------------------------------------------|
| `~`                    | `~`                        | Home directory                                    |
| `${DATA_DIR}`          | `~/.local/share/obelisk`   | System data directory                             |
| `${CACHE_DIR}`         | `~/.cache/obelisk`         | System cache directory                            |
| `${CONFIG_DIR}`        | `~/.config/obelisk`        | System config directory                           |
| `${DEPLOYMENT_DIR}`    | N/A                        | Directory where the deployment.toml file is located |
| `${TEMP_DIR}`          | /tmp                       | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html)|

</div>

In `server.toml`:

<div class="table">

| Prefix                 | Default Path on Linux      | Details                                           |
|------------------------|----------------------------|---------------------------------------------------|
| `~`                    | `~`                        | Home directory                                    |
| `${DATA_DIR}`          | `~/.local/share/obelisk`   | System data directory                             |
| `${CACHE_DIR}`         | `~/.cache/obelisk`         | System cache directory                            |
| `${CONFIG_DIR}`        | `~/.config/obelisk`        | System config directory                           |
| `${SERVER_CONFIG_DIR}` | N/A                        | Directory where the server.toml file is located   |
| `${TEMP_DIR}`          | /tmp                       | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html)|

</div>

Note: the resolved path on Mac OS and Windows will be different, e.g. for `${CONFIG_DIR}`:

* `/Users/youruser/Library/Application Support/com.obelisk.obelisk-App/` on Mac
* `C:\Users\youruser\AppData\Roaming\obelisk\obelisk\config\` on Windows

See the [directories crate documentation](https://docs.rs/directories/6.0.0/directories/struct.ProjectDirs.html) for details.
