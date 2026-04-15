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

### Storage

```toml
sqlite.directory = "${DATA_DIR}/obelisk-sqlite"  # SQLite database location
wasm_cache_directory = "${CACHE_DIR}/wasm"      # WASM file cache location
```

### Code Generation Cache

```toml
[codegen_cache]
enabled = true
directory = "${CACHE_DIR}/codegen"  # Generated code cache location
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

### Common Executor Settings

```toml
exec.batch_size = 5                  # Executions per event loop tick
exec.lock_expiry.seconds = 1         # Execution lock duration
exec.tick_sleep.milliseconds = 200   # Executor sleeps the specified duration when polling for pending executions
exec.max_inflight_instances = "unlimited"  # Concurrent instance limit
```

## Activities Configuration

Configure each WASM activity component using the `activity_wasm` section:

```toml
[[activity_wasm]]
# Common component and executor settings apply
max_retries = 5                      # Maximum retry attempts
retry_exp_backoff.milliseconds = 100 # Initial retry delay (doubles each attempt)
retry_on_err = true                  # Retry on Result::Err returns
forward_stdout = "stderr"            # stdout forwarding ("stdout"|"stderr"|"none")
forward_stderr = "stderr"            # stderr forwarding ("stdout"|"stderr"|"none")
env_vars = ["ENV1", "ENV2=value"]    # Environment variable configuration. Inherit from system if value is not provided.
```

## Workflows Configuration

### Global workflow configuration

```toml
workflows.backtrace.persist = true        # Persist backtraces on side effect calls for all workflows.
```

### Workflow component configuration

Configure each workflow component using the `workflow` section:

```toml
[[workflow]]
# Common component and executor settings apply
retry_exp_backoff.milliseconds = 100  # Initial retry delay
join_next_blocking_strategy = "await" # Child execution handling strategy ("await"|"interrupt")
non_blocking_event_batching = 100     # Non-blocking event batch size
retry_on_trap = false                 # Retry on traps (panics)
convert_core_module = true            # Auto-convert Core WASM modules to WASM Components
# Forward unhandled child errors to the parent workflow when closing completing join sets.
forward_unhandled_child_errors_in_completing_join_set_close = true
# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}
```

The blocking strategy controlls whether an execution should wait for blocking child executions or be
unloaded and then replayed. Note that the `await` strategy will only wait until `lock_expiry`
duration expires.

## HTTP and Webhook Configuration

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

## Appendix: Path Prefixes

The following path prefixes are supported throughout the configuration:

| Prefix                | Default Path             | Details                                          |
| --------------------- | ------------------------ | ------------------------------------------------ |
| `~`                   | `~`                      | Home directory                                   |
| `${DATA_DIR}`         | `~/.local/share/obelisk` | System data directory                            |
| `${CACHE_DIR}`        | `~/.cache/obelisk`       | System cache directory                           |
| `${CONFIG_DIR}`       | `~/.config/obelisk`      | System config directory                          |
| `${OBELISK_TOML_DIR}` | N/A                      | Directory where the obelisk.toml file is located |
