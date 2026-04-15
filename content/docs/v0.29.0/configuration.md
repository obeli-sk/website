+++
title = "Configuration - obelisk.toml"
template = "docs.html"
weight = 20
+++

## Server Configuration

### API Server

```toml
api.listening_addr = "127.0.0.1:5005"   # Address and port for API server
```

### Web UI

```toml
webui.listening_addr = "127.0.0.1:8080" # Address and port for web UI
```

> **Warning**: Listening on all interfaces (`[::]:<port>`) is not recommended as authentication is
> not yet implemented.

### Sqlite

Set SQLite database directory.

```toml
sqlite.directory = "${DATA_DIR}/obelisk-sqlite"
```

See [Path Prefixes](#path-prefixes) for how `${DATA_DIR}` is translated.

Customize PRAGMA statements. Defaults are in
{{ github(title="crates/db-sqlite/src/sqlite_dao.rs", path="crates/db-sqlite/src/sqlite_dao.rs") }}

```toml
sqlite.pragma = { "cache_size" = "10000", "synchronous" = "FULL" }
```

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

Path to directory where downloaded or transformed WASM files are stored. Supports
[path prefixes](#path-prefixes). By default `"${CACHE_DIR}/wasm"` or `"./cache/wasm"` if no valid
home directory path could be retrieved from the operating system.

#### Allocator Configuration

See
[Allocation strategy](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html)
for instance creation. Can be either
[pooling](https://docs.wasmtime.dev/api/wasmtime/struct.PoolingAllocationConfig.html) or
[on demand](https://docs.wasmtime.dev/api/wasmtime/enum.InstanceAllocationStrategy.html#variant.OnDemand).
Default value `auto` will attempt to use the `pooling` strategy with a fallback on error to
`on_demand`.

### Code Generation Cache

The compiled binaries can be stored to speed up startup time.

```toml
[wasm.codegen_cache]
enabled = true
directory = "${CACHE_DIR}/codegen"   # Path to directory where AOT generated code is cached. Supports path prefixes.
```

### Global Preopened Directories Configuration

Preopended directory support for activities is disabled by default. It must be enabled both globally
and for specifically for activity that uses disk IO.

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

## Component Configuration

### Common Component Settings

All WASM components (Activities, Workflows, Webhooks) share these configuration options:

```toml
name = "component_name"              # Required: Component identifier
location.path = "path/to/wasm"       # File path location (mutually exclusive with oci)
location.oci = "docker.io/repo/image:tag"  # OCI registry location
content_digest = "sha256:..."        # Optional: WASM file hash verification
```

Value of `location.path` supports [path prefixes](#path-prefixes).

### Common Executor Settings

```toml
exec.batch_size = 5                  # Executions per event loop tick
exec.lock_expiry.seconds = 1         # Execution lock duration
exec.tick_sleep.milliseconds = 200   # Executor sleeps the specified duration when polling for pending executions
```

## Activities

Configure each WASM activity component using the `activity_wasm` section:

```toml
[[activity_wasm]]
name = "..."
location.oci = "..."
# Common component and executor settings apply
max_retries = 5                      # Maximum retry attempts
retry_exp_backoff.milliseconds = 100 # Initial retry delay (doubles each attempt)
retry_on_err = true                  # Retry on Result::Err returns
forward_stdout = "stderr"            # stdout forwarding ("stdout"|"stderr"|"none")
forward_stderr = "stderr"            # stderr forwarding ("stdout"|"stderr"|"none")
env_vars = ["ENV1", "ENV2=value"]    # Environment variable configuration. Inherit from system if value is not provided.
```

### Stub activities

```toml
[[activity_stub]]
name = "..."
location.oci = "..."
```

### External activities

```toml
[[activity_external]]
name = "..."
location.oci = "..."
```

### Preopended directory support

Disk IO must be explicitly enabled using the global `activities.directories.enabled = true` setting
described above. When enabled, a directory will be created on host and mapped to `.` on the guest
activity with all permissions. On host the directory is created as
`activities.directories.parent_directory`/ExecutionID and is truncated after the activity finishes.

```toml
directories  = { enabled = true, reuse_on_retry = false}
```

`reuse_on_retry` disabled by default: every execution attempt will start with an empty preopened
directory.

If `reuse_on_retry` is enabled, a retried activity can reuse the same directory that was used by
previous attempt. This can be helpful if an activity e.g. downloads a file and then processes it.
Activity must in this case do all of its operations idempotently (e.g. `mkdir -p`) and verify the
integrity of all files left by previous attempts.

Read more about
{{ doc_link(title="Preopened directories", path="concepts/activities/preopened-dirs.md") }}.

### Process Spawn API

In order to enable the `obelisk:activity/process@1.0.0` API, preopened directory must be enabled and
`process_provider` must be set to `"native"`.

```toml
directories  = { enabled = true, reuse_on_retry = false, process_provider = "native"}
```

Read more about {{ doc_link(title="Process API", path="concepts/activities/process.md") }}.

## Workflows

Configure each workflow component using the `workflow` section:

```toml
[[workflow]]
name = "..."
location.oci = "..."
# Common component and executor settings apply
retry_exp_backoff.milliseconds = 100  # Initial retry delay

# Blocking strategy:
blocking_strategy = "await"           # One of ("await"|"interrupt"|{"kind"=...})
# Default strategy is await.
# Customize the number of non-blocking events that can be cached and written in a batch.
# blocking_strategy = { kind = "await", non_blocking_event_batching = 100 }

convert_core_module = true            # Auto-convert Core WASM modules to WASM Components
# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}

# Stub WASI CLI world imports. Only needed for workflows authored in TinyGo.
stub_wasi = false                     # Default is false.

## Automatic lock extension can be disabled by setting the duration to zero.
lock_extension.seconds = 1
```

The blocking strategy controlls whether an execution should `await` the child execution response or
be `interrupt`ed and later replayed. Note that the `await` strategy will only wait until
`lock_expiry` duration expires.

## HTTP Servers and Webhooks

A Webhook Endpoint must be associated with a HTTP Server and must define one or more routes to
listen on. Routes are divided into two categories: with HTTP methods (high priority) and without
HTTP methods (low priority). When a request matches multiple routes of the same priority, the first
webhook will receive it.

### HTTP Servers

```toml
[[http_server]]
name = "server_name"                  # Server identifier
listening_addr = "0.0.0.0:9000"       # Listen address and port
max_inflight_requests = "unlimited"   # Concurrent request limit
```

### Webhook Endpoints

```toml
[[webhook_endpoint]]
name = "..."
location.oci = "..."
# Common component settings apply
http_server = "server_name"          # Reference to HTTP server
routes = [                           # Route configurations
    { methods = ["GET"], route = "/path" },
    "/other/*",
    "/status/:param1/:param2"
]
forward_stdout = "stderr"            # stdout forwarding ("stdout"|"stderr"|"none")
forward_stderr = "stderr"            # stderr forwarding ("stdout"|"stderr"|"none")
env_vars = ["ENV1", "ENV2=value"]    # Environment variable configuration. Inherit from system if value is not provided.
# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}
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

#### Stdout Logging

```toml
[log.stdout]
enabled = true
level = "info,app=trace"   # See filtering syntax
style = "plain_compact"    # One of "plain"|"plain_compact"|"json"
span = "none"              # One of "none"|"new"|"enter"|"exit"|"close"|"active"|"full"
target = false             # Whether to include the target module in message
```

#### File Logging

```toml
[log.file]
enabled = true
level = "info,obeli=debug,app=trace" # See filtering syntax
style = "json"             # One of "plain"|"plain_compact"|"json"
span = "close"             # One of "none"|"new"|"enter"|"exit"|"close"|"active"|"full"
target = true              # Whether to include the target module in message
rotation = "daily"         # One of "minutely"|"hourly"|"daily"|"never"
directory = "."
prefix = "obelisk_server_daily" # File name prefix
```

## Path Prefixes

The following path prefixes are supported throughout the configuration:

<div class="table">

| Prefix                | Default Path on Linux    | Details                                                            |
| --------------------- | ------------------------ | ------------------------------------------------------------------ |
| `~`                   | `~`                      | Home directory                                                     |
| `${DATA_DIR}`         | `~/.local/share/obelisk` | System data directory                                              |
| `${CACHE_DIR}`        | `~/.cache/obelisk`       | System cache directory                                             |
| `${CONFIG_DIR}`       | `~/.config/obelisk`      | System config directory                                            |
| `${OBELISK_TOML_DIR}` | N/A                      | Directory where the obelisk.toml file is located                   |
| `${TEMP_DIR}`         | /tmp                     | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html) |

</div>

Note: the resolved path on Mac OS and Windows will be differet, e.g. for `${CONFIG_DIR}`:

- `/Users/youruser/Library/Application Support/com.obelisk.obelisk-App/` on Mac
- `C:\Users\youruser\AppData\Roaming\obelisk\obelisk\config\` on Windows

See the
[directories crate documentation](https://docs.rs/directories/6.0.0/directories/struct.ProjectDirs.html)
for details.
