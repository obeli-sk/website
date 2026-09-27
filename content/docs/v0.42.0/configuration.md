+++
title = "Configuration"
template = "docs.html"
weight = 20
+++

## Overview

The configuration is split into three files, each owned by a different role:

- **`server.toml`** (platform admin): listeners, API authentication, database, resource limits, WASM
  and V8 runtimes, logging, HTTP servers, and the platform exec gate.
- **`app.toml`** (app admin): the app name and the reviewed maximum privileges of every deployment:
  secrets and their exposure, public environment variables, outbound HTTP, and exec activities.
- **`deployment.toml`** (app developer): component arrays: activities, workflows, webhook endpoints,
  and cron tasks.

This separation contains deployment code that the app admin does not fully trust, including
LLM-generated code. The deployment requests capabilities; the app policy limits them in `app.toml`,
and the platform limits resources in `server.toml`. See
{{ doc_link(title="Security model", path="security.md") }} before configuring secrets, native
execution, or outbound HTTP.

### Version Compatibility

The `obelisk-version` field can be set in `server.toml` or `deployment.toml` to ensure compatibility
with the running Obelisk version:

```toml
obelisk-version = "0.42"
```

### Built-in Defaults

All three servers start automatically with built-in defaults. **No `server.toml` is required**
unless you need to change addresses, database settings, limits, or other platform options:

- **API server** at `127.0.0.1:5005`
- **Web UI** at `127.0.0.1:8080`
- **External webhook server** at `127.0.0.1:9090`

The server does require an app name, set as `app_name` in `app.toml` or through the
`OBELISK_APP_NAME` environment variable. Without an `app.toml`, the default app policy grants no
secrets, public environment variables, outbound HTTP, or exec activities.

### Generating Configuration Files

`obelisk generate new NAME` creates a directory named `NAME` with `app.toml`, `deployment.toml`, and
a JavaScript webhook, workflow, and HTTP activity. Without `NAME`, it writes into the current
directory and converts that directory's name to an app slug.

Generate the commented configuration references by passing an output filename:

```sh
obelisk generate server-config server.toml
obelisk generate app-config app.toml
obelisk generate deployment deployment.toml
```

Without an output filename, these commands print the configuration to stdout. Every setting in the
references is commented out; set at least `app_name` in `app.toml` before starting the server. For a
single-party installation where the admins and every deployment author share the same trust level,
the `--trusted` option generates permissive policies:

```sh
obelisk generate app-config --trusted app.toml       # outbound HTTP to any deployment-requested host
obelisk generate server-config --trusted server.toml # platform exec gate set to "*"
```

Do not use the trusted configurations for multi-tenant or agent-driven deployments. The trusted app
policy removes the destination boundary for outbound HTTP. Neither registers secrets or approves
individual exec activities; verification with `--fix` can add reviewed exec configuration digests
and scaffold referenced secrets in `app.toml`.

To split a 0.41 `server.toml` that still contains app policy, run
`obelisk generate split-config --server-config server.toml`. See
{{ doc_link(title="Migrating from 0.41 to 0.42", path="migrating-to-0.42.md", version="v0.42.0") }}.

### Running the Server

```sh
obelisk server run --app-config app.toml --deployment deployment.toml
obelisk server verify --app-config app.toml --deployment deployment.toml

# With explicit server config:
obelisk server run --server-config server.toml --app-config app.toml --deployment deployment.toml
```

If `--server-config` is omitted, built-in platform defaults are used. If `--app-config` is omitted,
the default app policy is used and `OBELISK_APP_NAME` must be set. If `--deployment` is omitted, the
database's active/enqueued deployment is used.

To verify a local deployment without opening the database, use:

```sh
obelisk deployment verify --server-config server.toml --app-config app.toml --deployment deployment.toml
```

Missing public environment variables and secrets are reported together with a sorted, pasteable
`app.toml` snippet. Add `--fix` to add missing `[public_env]` entries, scaffold missing `[secrets]`
entries, and write the reviewed exec allowlist and secret-exposure grants into `app.toml`. Review
the generated policy and set each secret's environment variable before starting the server.
`obelisk server verify --fix` provides the same repair behavior. Outbound HTTP rules are not added
automatically; verification prints the missing `app.toml` entries instead. A stale exec digest is
kept and the current one appended as an array; remove the old digest when no running revision needs
it, and update the platform exec gate in `server.toml`, which `--fix` does not change.

---

## Server Configuration (`server.toml`)

### API Server

```toml
api.listening_addr = "127.0.0.1:5005"   # Address and port for API server
```

#### API Authentication

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
{{ doc_link(title="Authentication", path="authentication.md") }} for the full model, generating
tokens, and the `--no-auth` recovery flag.

### Web UI

```toml
webui.listening_addr = "127.0.0.1:8080" # Address and port for web UI
```

> **Warning**: The external webhook HTTP server has no authentication. Listening on all interfaces
> (`[::]:<port>`) is not recommended.

### Platform Exec Gate

[Exec activities](#exec-activities) run host processes outside the WASM sandbox, so they are
**disabled by default**. They need approval from both the platform admin in `server.toml` and the
app admin in `app.toml` (see [App Exec Approval](#app-exec-approval)).

```toml
allowed_exec_activities = "*"   # Allow any app-approved exec activity; startup warns.

# Or limit the platform grant to reviewed component digests:
# [allowed_exec_activities]
# worker = "sha256:..."
```

Omitting the field or setting it to `false` disables exec activities. Every digest in `app.toml`
must be covered by the platform grant. Both files accept an array of digests when overlapping
deployment revisions must be authorized.

### Server Limits

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

#### Execution Slots

Every execution slot in the process is charged to exactly one (workload, runtime) cell. `count` is
how many slots the cell grants, and `memory` is how much linear memory (for a V8 cell, isolate heap)
one slot may hold. Both accept `"unlimited"`. Byte sizes require a unit key: `memory.mib`,
`memory.gib`, or `memory.bytes`. The defaults are:

```toml
[limits.activities.wasm]       # Includes Boa JavaScript activities.
count = 500
memory.gib = 1
[limits.activities.v8]
count = 16
memory.mib = 256
[limits.activities.process]    # activity_exec: an operating system process, so no `memory`.
count = 32
[limits.activities.vm_bochs]   # activity_vm
count = 8
memory.gib = 1
[limits.workflows.wasm]        # Includes Boa JavaScript workflows.
count = 500
memory.mib = 512
[limits.workflows.v8]
count = 100
memory.mib = 256
[limits.webhooks.wasm]         # Includes Boa JavaScript webhook endpoints.
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

The `v8` cells apply to JavaScript components, which run on native V8 by default. When the server is
started with `OBELISK_JS_RUNTIME=boawasm`, JavaScript components run on Boa compiled to WASM and use
the `wasm` cells.

### Automatic Maintenance and Retention

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

### Sqlite

The SQLite database directory defaults to a per-app path:

```toml
database.sqlite.directory = "${DATA_DIR}/apps/${APP_NAME}/sqlite"
```

`${APP_NAME}` is the configured app name. Releases before 0.42 used `${DATA_DIR}/obelisk-sqlite`;
set that value explicitly to keep using an existing database. See [Path Prefixes](#path-prefixes)
for how `${DATA_DIR}` is translated.

Customize PRAGMA statements. Defaults are in
{{ github(title="crates/db-sqlite/src/sqlite_dao.rs", path="crates/db-sqlite/src/sqlite_dao.rs") }}

```toml
database.sqlite.pragma = { "cache_size" = "10000", "synchronous" = "FULL" }
```

### PostgreSQL

Configure connection to Postgres. All of the following keys support environment variable
interpolation.

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
allocator_config = "auto"                      # One of "auto"|"on_demand"|"pooling"
fuel = "unlimited"                             # If set to an integer, WASM instances consume fuel, details: https://docs.wasmtime.dev/api/wasmtime/struct.Store.html#method.set_fuel
build_semaphore = "unlimited"                  # If set to an integer, limits the number of AOT compilations that can run in parallel.
parallel_compilation = true                    # Enable (default) or disable parallel AOT compilation of each WASM component.
debug = false                                  # Emit DWARF debug info and disable Cranelift optimizations.
```

Concurrency and per-instance memory are configured by the [execution slot](#execution-slots) cells
of `[limits]`.

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

### Native V8 Configuration

```toml
[v8]
thread_stack_size.mib = 4   # Stack size for each native V8 isolate thread.
```

Each V8 isolate runs on its own OS thread. The number of isolates and their heap size are the `v8`
cells of [`[limits]`](#execution-slots).

### Global Webhook Configuration

```toml
[webhooks]
request_timeout.seconds = 30   # Deadline for a webhook handler to return its HTTP response.
```

The deadline applies to WASM and V8 webhook handlers. It does not limit a streaming response body
after the response has been returned.

### Global Workflow Configuration

```toml
[workflows]
subscription_interruption.seconds = 1  # Interrupts listening for notifications periodically. Needed for Postgres with a local-only subscription mechanism. Value can be "none" or a duration.
max_events_per_run = 100               # Max history events a real workflow run writes before it yields and unlocks, improving fairness across concurrent workflows. Replay uses max_replay_captured_writes instead.
max_replay_captured_writes = 100       # Max captured writes a single replay pass returns. On reaching it, replay stops and returns that many as an advanceable prefix (advance them, then replay again to resume), keeping a non-terminating join-next-try poll loop advanceable in bounded batches.
response_refresh_interval = 32         # Reload responses from the database after this many newly written non-blocking events while a workflow keeps running. Usually set below max_events_per_run. Replay ignores it.

```

---

## App Configuration (`app.toml`)

The app policy is reviewed by the app admin and passed with `--app-config`. It declares the app's
required inputs and the maximum privileges any deployment may use. Missing required inputs fail at
startup, so executions do not discover them at runtime. Environment overrides such as `OBELISK__...`
apply only to `server.toml`, not to `app.toml`.

### App Name

```toml
app_name = "my-app"
```

The app name is required, either here or through `OBELISK_APP_NAME`. It selects the default SQLite
directory.

### Secret Registry

Map each logical secret name to the environment variable of the same name:

```toml
[secrets]
OPENAI_KEY = {}
GITHUB_TOKEN = { optional = true }

[secrets.DB_PASSWORD.exposed_to]
migration = "sha256:..."
```

At startup, Obelisk reads each value into memory and removes the variable from the process
environment before workers start. A required secret whose variable is unset prevents startup. An
`optional = true` secret may be absent; deployments must then reference it as optional, for example
`{ name = "GITHUB_TOKEN", optional = true }`, and an absent value is omitted from the component
environment or stdin.

Deployments request logical names in a component's `exposed_secrets` or an allowed host's `secrets`
field; they cannot interpolate registered secret values with `${...}`. The former gives component
code the plaintext value and requires an `exposed_to` grant generated with
`obelisk generate secret-config-digest`. The latter substitutes opaque placeholders only in an
authorized outbound request and does not require a plaintext-exposure grant.

`exposed_secrets` is supported by WASM and JavaScript activities and webhook endpoints, native exec
activities, and experimental VM activities. WASM, JavaScript, and VM components receive each value
under its logical name as an environment variable. Exec activities receive the values in the
`secrets` object on stdin.

### Public Deployment Environment

Deployments can only read process environment variables declared by the app admin. The declarations
apply both to `env_vars` forwarded into components and `${...}` interpolation anywhere in
`deployment.toml`:

```toml
[public_env]
API_BASE_URL = {}
REGION = {}
TRACE_ID = { optional = true }
```

Entries are required at startup unless marked `optional = true`. A deployment may reference an
optional variable only through an optional forwarded reference, such as
`{ key = "TRACE_ID", optional = true }`, or an interpolation fallback, such as `${TRACE_ID:-none}`.
Keep credentials in the secret registry instead. A variable registered as a secret cannot also be
read through the public environment table.

### App Outbound HTTP Policy

Component-originated HTTP must match an allowlist entry in both `app.toml` and the component's
deployment configuration. An empty app allowlist denies all component-originated HTTP.

```toml
[[outbound_http.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]
request_url_regex = "^POST https://api\\.openai\\.com/v1/"
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

The app and deployment entries use the same syntax. Both apply to every request: a request must
match both destinations and methods, and both `request_url_regex` values, which need not be
identical. A secret is substituted only when matching entries on both sides list the same secret and
replacement location. Activation rejects a deployment whose destinations or methods are not covered
by the app policy.

### App Exec Approval

Generate reviewable grants from the deployment configuration:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Approve reviewed executable and exposed-secret configurations by component name. The generated
secret-exposure digest binds the executable content and the complete exposed-secret set:

```toml
[allowed_exec_activities]
greet = "sha256:..."
```

Use an array of digests when overlapping deployment revisions must be authorized. If the activity
receives plaintext secrets, copy the generated `[secrets.<name>.exposed_to]` grants too. The
platform must also allow the digest through its [exec gate](#platform-exec-gate).

### App Policy Digest

Obelisk computes a canonical `app_config_digest` of the app policy. Deployments record the digest
used at activation, system events carry the current digest, and the running policy is available
through `GET /v1/app-config`.

## HTTP Servers

The built-in `"external"` HTTP server is always available at `127.0.0.1:9090` and does not need to
be declared. Define additional named servers in `server.toml` when you need non-default ports:

```toml
[[http_server]]
name = "server_name"                  # Server identifier
listening_addr = "0.0.0.0:9000"       # Listen address and port
```

Named servers defined here can be referenced from `webhook_endpoint_wasm` entries in
`deployment.toml` via `http_server = "server_name"`.

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

---

## Deployment Configuration (`deployment.toml`)

The deployment file contains only component arrays. Platform settings go in `server.toml`, and app
policy goes in `app.toml`.

### Common Component Settings

All WASM components (Activities, Workflows, Webhooks) share these configuration options:

```toml
name = "component_name"                         # Required: Component identifier
location = "path/to/wasm"                       # File path location
location = "oci://docker.io/repo/image:tag"     # OCI registry location (note the oci:// prefix)
```

Value of `location` supports [path prefixes](#path-prefixes) when used as a file path.

Note: The `location` field uses a single string. `oci://` references an OCI image; plain paths
without a prefix are treated as local file paths. Both WASM and JS components can be stored in OCI
registries — see `obelisk component push` to publish them.

### Common Executor Settings

```toml
exec.batch_size = 5                            # Executions per event loop tick
exec.lock_expiry.seconds = 30                  # Execution lock duration (default: 30 seconds)
exec.tick_sleep.milliseconds = 200             # Executor sleeps the specified duration when polling for pending executions
exec.locking_strategy = "auto"                 # Workflow default. See supported strategies below.
```

Workflows support all three locking strategies:

- `auto` (default) selects executions by exported FFQNs. After a redeployment, an in-progress
  execution is replayed against the current workflow component. If replay succeeds, Obelisk upgrades
  the execution and associates it with the current deployment. If replay detects nondeterminism, the
  execution stays on its previous component version and is not repeatedly retried against the
  incompatible digest. The upgrade outcome is recorded in the execution history.
- `by_ffqns` selects executions by the FFQNs exported by the component, without automatically
  upgrading their component assignment.
- `by_component_digest` selects only executions assigned to the exact component version (by `sha256`
  digest) that was available when the execution was first submitted. Such an execution can be
  upgraded using the upgrade API endpoint or gRPC RPC. The RPC attempts to replay the execution log
  by default to avoid upgrading to incompatible workflow code.

Activities support `by_ffqns` (default) and `by_component_digest`, but not `auto`. Since activities
are restarted and not replayed, the default `by_ffqns` strategy lets pending executions use the new
code after redeployment without an upgrade.

### Function Signatures

WASM activities and WASM workflows carry their function signatures inside the compiled component, so
they never declare `params` or `return_type` in the TOML. Components whose source does not embed a
WIT world — JavaScript activities and workflows, exec activities, and stub and external activities —
declare the signature of their `ffqn` in one of two ways:

- **Inline**, with `params` and `return_type` written directly in the component table:

  ```toml
  [[activity_stub]]
  ffqn = "example:session/turn.request"
  params = [{ name = "response-id", type = "string" }]
  return_type = "result<string, string>"
  ```

- **From a WIT folder**, with a single `wit` field pointing at a deployment-local directory of WIT
  files (a `deps/` subfolder for imported packages is supported). Obelisk resolves the component's
  `ffqn` signature from that folder instead of the inline fields:

  ```toml
  [[activity_stub]]
  ffqn = "example:session/turn.request"
  wit = "wit"
  ```

The `wit` folder form lets several components — for example a workflow and the stub activities it
awaits — share one WIT definition as a single source of truth, so their signatures and payload types
cannot drift. See
{{ doc_link(title="Durable Mailbox and Notification Channel", path="patterns/stub-mailbox.md") }}.

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
env_vars = ["ENV1", { key = "ENV2", value = "value" }, { key = "OPT", optional = true }] # Forwarded names must be declared in app.toml [public_env].
exposed_secrets = ["ACTIVITY_SECRET"] # Registered secrets injected as environment variables. Requires exposed_to grants.
logs_store_min_level = "debug"       # Minimum log level to persist in the database. One of "off"|"trace"|"debug"|"info"|"warn"|"error". Default: "debug"
```

Use `exposed_secrets` only when the activity must read the plaintext. Register every name under
`[secrets]`, then generate and review its `[secrets.<name>.exposed_to]` grant. For credentials used
only in outbound HTTP, prefer the `allowed_host.secrets` placeholder mechanism below.

Obelisk 0.42 also has experimental WASIp3 component support for WASM activities and webhook
endpoints. The component model is detected from the binary; the existing deployment component
sections and app HTTP policy still apply. Treat WASIp3 support as experimental when choosing
production compatibility guarantees.

#### Permanent Error Handling

Activities returning a variant containing a case named `permanent` will skip retries, regardless of
`max_retries`.

#### Outbound HTTP Allowlist

Activities that make outbound HTTP calls require explicit `[[allowed_host]]` entries in the
deployment and matching `[[outbound_http.allowed_host]]` entries in `app.toml`. Without both, the
request is blocked.

```toml
[[activity_wasm]]
name = "activity_llm"
location = "..."
exec.lock_expiry.seconds = 10
env_vars = [{key = "API_BASE_URL", value = "${API_BASE_URL:-https://api.openai.com}"}]

[[activity_wasm.allowed_host]]
pattern = "${API_BASE_URL:-https://api.openai.com}"
methods = ["POST"]
# Optional extra restriction after pattern and methods match.
request_url_regex = "^POST https://api\\.openai\\.com/v1/"
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

`OPENAI_KEY` is a logical name from the app's `[secrets]` registry. A matching app allowlist entry
must also permit this host, method, secret, and replacement target. An allowlist entry can list a
secret the component can run without as `{ name = "GITHUB_TOKEN", optional = true }`.

`pattern` matches the request origin: scheme, host, and port. It uses the limited wildcard syntax
below, not regular expressions, and must not contain a URL path. A pattern without a scheme uses
HTTPS; one without a port uses the scheme's default port (80 for HTTP, 443 for HTTPS). Supported
patterns include:

- `"*"` matches all HTTPS hosts on port 443.
- `"*://*"` matches any HTTP or HTTPS host on its default port.
- `"*://*:*"` matches any HTTP or HTTPS host on any port.
- `"*.example.com"` matches subdomains of `example.com`.
- `"http://192.168.1.*"` matches that IPv4 `/24` range over HTTP.
- `"http://localhost:*"` matches localhost on any HTTP port.

The `pattern` field supports `${VAR}` and `${VAR:-default}` environment variable interpolation.

`request_url_regex` is an optional extra restriction on top of the required host `pattern` and
`methods` allowlist entry. It is checked only after the host and method match, and omitting it
allows all paths accepted by those required restrictions. The regex is matched against `METHOD URL`
with query parameters removed, for example `GET https://api.example.com/v1/items`. The regex also
supports `${VAR}` and `${VAR:-default}` interpolation; interpolated values are treated as regex
syntax, so escape them when they should match literally.

Secrets are injected via placeholder replacement in outgoing HTTP requests. WASM receives an opaque
placeholder; the runtime substitutes real values only for requests to approved hosts. `replace_in`
selects where substitution happens: `headers`, `params` (URL query parameter values only), and/or
`body`. Substitution is a literal replacement of the placeholder string wherever it appears in those
locations, so the component itself decides placement (for example an
`Authorization: Bearer <placeholder>` header that it sets). Header names, URL paths, and query
parameter names are never searched. Body replacement requires valid UTF-8 and a textual content
type: `text/*`, JSON, or `application/x-www-form-urlencoded`.

### JavaScript Activities

```toml
[[activity_js]]
name = "name"
location = "path/to/source.js"          # Local path or oci://registry/image:tag
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
exposed_secrets = ["ACTIVITY_SECRET"] # Injected into process.env. Requires exposed_to grants.
```

Outbound HTTP allowlist: same `[[activity_js.allowed_host]]` syntax as `activity_wasm`. JavaScript
activities receive exposed values as `process.env.ACTIVITY_SECRET`. Register the logical name in the
app secret registry and authorize the generated digest under `[secrets.ACTIVITY_SECRET.exposed_to]`.

### Experimental VM Activities

`activity_vm` runs a Nix-packaged Linux executable inside an experimental Linux VM: a
[Bochs](https://github.com/obeli-sk/activity-vm-bochs) x86 emulator compiled to WASM and hosted by
Wasmtime. The minimal guest (Linux kernel, BusyBox, and an HTTP proxy) is built by
[activity-vm-bochs-runtime](https://github.com/obeli-sk/activity-vm-bochs-runtime) and distributed
as the `getobelisk/activity-vm-runtime` OCI artifact. Its configuration, guest ABI, cache layout,
and runtime behavior may change or be removed in a later release.

```toml
[[activity_vm]]
name = "vm-curl"
ffqn = "example:vm/curl.run"
content = '''#!/usr/bin/env bash
curl -fsS https://api.example.com/v1/items
'''
params = []
return_type = "result<string, string>"
store_paths = [
  "/nix/store/...-bash-interactive-5.3p15",
  "/nix/store/...-curl-8.22.0-bin",
]
exec.lock_expiry.seconds = 120

[[activity_vm.allowed_host]]
pattern = "https://api.example.com"
methods = ["GET"]
```

The pinned VM runtime and verified Nix closures are cached and exposed read-only to the guest.
`cache.nixos.org` is enabled by default; add `[[activity_vm.nix_cache]]` entries with trusted public
keys for other caches. Each declared store path's `bin` directory is added to the guest `PATH`.

Guest HTTP(S) uses the same intersection of deployment and app policy as WASM and JS components.
Inside the guest, `obelisk-host` addresses the Obelisk host; configure its allowlist as the
corresponding `http://localhost:PORT` destination. Prefer outbound secret placeholders. Secrets in
`activity_vm.exposed_secrets` become guest environment variables readable by every guest process and
require a matching `[secrets.<name>.exposed_to]` digest grant.

### Exec Activities

Exec activities run an approved host executable as a durable activity. The child process receives
function parameters as JSON-encoded CLI arguments. The result is read from stdout — exit code 0
means success, non-zero means error. Both stdout and stderr are streamed and persisted, available
via the CLI, REST API, and Web UI.

> **Security**: exec activities run host processes outside the WASM sandbox and are disabled by
> default. A deployment that declares one fails verification until both the app admin approves it in
> [`app.toml`](#app-exec-approval) and the platform admin enables the
> [exec gate](#platform-exec-gate) in `server.toml`.

```toml
[[activity_exec]]
name = "name"                                # Optional. Defaults to {ifc_name}.{function_name} from ffqn
location = "scripts/my-script.sh"             # Deployment-local path or oci://registry/image:tag
# content = '''#!/usr/bin/env bash
# echo "\"hello\""
# '''
# content_digest = "sha256:..."
ffqn = "namespace:package/interface.function" # Required
params = [
  { name = "a", type = "u32" },
  { name = "b", type = "u32" },
]
return_type = "result<u32, string>"          # See return type conventions below
max_retries = 5
retry_exp_backoff.milliseconds = 100
forward_stdout = "db"                        # One of "none"|"stdout"|"stderr"|"db". Default: "db"
forward_stderr = "db"
logs_store_min_level = "debug"
max_output_bytes = 4096                      # Max bytes from stdout for the response. Default: 4096
params_via_stdin = false                     # Pass params via stdin instead of argv
```

Exactly one of `location` or `content` must be set:

- `location` can point to a local script file or an `oci://...` reference.
- Local files must be deployment-local: relative to the directory containing `deployment.toml`, with
  no absolute paths or `..` escapes.
- Local files are read at deploy time and stored with the deployment, making the deployment
  reconstructable.
- `content` embeds the script directly in `deployment.toml`.
- `content_digest` can be used to pin and verify the resolved script contents.
- `params_via_stdin = true` passes parameters in a stdin JSON `params` array, avoiding operating
  system argument-size limits for large inputs.

#### Environment variables and secrets

```toml
# Only listed vars are exposed; host environment is cleared
env_vars = ["PATH", {key = "MY_VAR", value = "my_value"}]

# Registered secret names: piped to stdin as JSON {"secrets":{"KEY":"value",...}}
exposed_secrets = ["MY_SECRET"]
```

Declare `MY_SECRET = {}` in the app's `[secrets]` table and set the `MY_SECRET` environment variable
for the server. Then copy the activity's grants from
`obelisk generate secret-config-digest --deployment deployment.toml` into the app's
`[allowed_exec_activities]` and `[secrets.MY_SECRET.exposed_to]`.

When both `params_via_stdin` and exposed secrets are configured, stdin contains both top-level
fields: `{"params":[...],"secrets":{"KEY":"value"}}`.

#### Return type conventions

The `return_type` field must be one of:

- `result` — no return data; exit 0 = ok, non-zero = error. stdout is ignored.
- `result<T>` — on exit 0, stdout is parsed as the ok JSON value of type T.
- `result<T, string>` — on exit 0, stdout is the ok JSON value of type T; on non-zero exit, stdout
  is the err string, JSON-encoded (e.g. `"boom"`).
- `result<T, variant { execution-failed, ... }>` — structured error type where `execution-failed` is
  a variant case; on non-zero exit, stdout is the err-variant JSON.

Both the ok and err values are read from **stdout**. stderr is only forwarded to the logs (see
`forward_stderr`) and is never captured into the result, so a non-zero exit with empty stdout fails
to type-check a non-unit err arm and surfaces as an uncategorized execution failure instead of
`err`.

A platform failure projected into a `result<_, string>` error uses the string `"execution_failed"`.

`T` can be `_` to indicate no ok value (e.g. `result<_, string>`). In this case `stdout` is ignored
on exit 0.

#### Retry and timeout

Exec activities follow the same retry semantics as WASM and JS activities. The `exec.lock_expiry`
setting controls how long the child process is allowed to run. When the lock expires or the executor
shuts down, the child's process group is killed and reaped, and the execution is then retried or
marked as permanently timed out.

### Stub Activities

```toml
[[activity_stub]]
name = "..."
location = "oci://..."
```

Inline mode (no WASM file required):

```toml
[[activity_stub]]
name = "my-stub"                             # Optional. Defaults to {ifc_name}.{function_name} from ffqn
ffqn = "namespace:package/interface.function"
params = [{ name = "id", type = "u64" }]
return_type = "result<string, string>"
```

### External Activities

```toml
[[activity_external]]
name = "..."
location = "oci://..."
```

Inline mode (no WASM file required):

```toml
[[activity_external]]
name = "my-external-activity"                # Optional. Defaults to {ifc_name}.{function_name} from ffqn
ffqn = "namespace:package/interface.function"
params = [{ name = "id", type = "u64" }]
return_type = "result<string, string>"
```

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

## Automatic lock extension is enabled by default.
lock_extension = true
lock_extension_leeway.seconds = 15  # Starts extending at expires_at minus this leeway.

logs_store_min_level = "debug"       # Minimum log level to persist in the database. Default: "debug"
```

The blocking strategy controls whether an execution should `await` the child execution response or
be `interrupt`ed and later replayed. Note that the `await` strategy will only wait until
`lock_expiry` duration expires.

### JavaScript Workflows

```toml
[[workflow_js]]
name = "name"
location = "path/to/workflow.js"       # Local path or oci://registry/image:tag
ffqn = "namespace:package/interface@version.function"  # Required
params = [                             # Optional
  { name = "param1", type = "string" },
]
return_type = "result"
retry_exp_backoff.milliseconds = 100
lock_extension = true
lock_extension_leeway.seconds = 15  # Starts extending at expires_at minus this leeway.
blocking_strategy = "await"
logs_store_min_level = "debug"
```

## Webhook Endpoints

A Webhook Endpoint must be associated with a HTTP Server and must define one or more routes to
listen on. Routes are divided into two categories: with HTTP methods (high priority) and without
HTTP methods (low priority). When a request matches multiple routes of the same priority, the first
webhook will receive it.

The built-in `"external"` HTTP server (at `127.0.0.1:9090` by default) is always available and used
when `http_server` is omitted. Additional named servers are defined in `server.toml`.

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
exposed_secrets = ["WEBHOOK_SIGNING_SECRET"] # Injected as environment variables. Requires exposed_to grants.
# Map from frame symbol file names to corresponding file paths on local filesystem.
# Both sides can use path prefixes.
backtrace.sources = {"backtracepath/src/lib.rs"="localpath/src/lib.rs"}
backtrace_persist = true              # Persist call-site backtraces for this webhook. Default: false.
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
exposed_secrets = ["WEBHOOK_SIGNING_SECRET"] # Available through process.env. Requires exposed_to grants.
backtrace_persist = true              # Persist call-site backtraces for this webhook. Default: false.
```

Plaintext webhook secrets are intended for operations such as validating an inbound HMAC signature.
Register every logical name under `[secrets]`, generate grants with
`obelisk generate secret-config-digest --deployment deployment.toml`, and copy the reviewed
`[secrets.<name>.exposed_to]` entries into `app.toml`. The grant is bound to the component digest
and complete exposed-secret set, so regenerate it when either changes.

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

## Cron (Periodic Tasks)

Cron tasks trigger a function on a recurring schedule or once at startup. They are defined directly
in `deployment.toml`:

```toml
[[cron]]
name = "my-daily-job"
ffqn = "myapp:tasks/jobs@1.0.0.daily-cleanup"
params = '["arg1", 42]'                  # JSON array; defaults to []
schedule = "@daily"                      # cron expression or named shorthand
```

The `schedule` field accepts standard five-field cron expressions (`"0 3 * * *"`), six-field
expressions whose leading field adds seconds (`"30 0 3 * * *"`), or one of the named shorthands:

| Shorthand  | Meaning                                             |
| ---------- | --------------------------------------------------- |
| `@once`    | Run exactly once when the deployment becomes active |
| `@hourly`  | `0 * * * *`                                         |
| `@daily`   | `0 0 * * *`                                         |
| `@weekly`  | `0 0 * * 0`                                         |
| `@monthly` | `0 0 1 * *`                                         |
| `@yearly`  | `0 0 1 1 *`                                         |

See {{ doc_link(title="Cron tasks", path="concepts/cron.md") }} for a full explanation of the
scheduling model.

## Path Prefixes

The following path prefixes are supported:

In `deployment.toml`:

<div class="table">

| Prefix          | Default Path on Linux    | Details                                                            |
| --------------- | ------------------------ | ------------------------------------------------------------------ |
| `~`             | `~`                      | Home directory                                                     |
| `${DATA_DIR}`   | `~/.local/share/obelisk` | System data directory                                              |
| `${CACHE_DIR}`  | `~/.cache/obelisk`       | System cache directory                                             |
| `${CONFIG_DIR}` | `~/.config/obelisk`      | System config directory                                            |
| `${TEMP_DIR}`   | /tmp                     | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html) |

</div>

In `server.toml`:

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
