+++
title = "Deployment Configuration"
template = "docs.html"
weight = 3
+++

`deployment.toml` is one instance of the app, passed with `--deployment`. It lists the components
(activities, workflows, webhook endpoints, and cron tasks) and requests the capabilities each one
needs. It may be written by a coding agent together with the component code. Whatever it requests
must fit within `app.toml` and `server.toml`: verification, startup, and activation reject a
deployment that asks for an ungranted secret, environment variable, outbound HTTP destination, or
exec activity. Run `obelisk server verify --skip-db --deployment deployment.toml` to check the
policy fit before submitting. See
{{ doc_link(title="Configuration", path="configuration/_index.md") }} for how the three files
relate.

## Common Component Settings

All components (activities, workflows, webhook endpoints) share these configuration options:

```toml
name = "component_name"                         # Required: Component identifier
location = "path/to/file"                       # File path location (.js or .wasm)
location = "oci://docker.io/repo/image:tag"     # OCI registry location (note the oci:// prefix)
```

Value of `location` supports [path prefixes](#path-prefixes) when used as a file path.

Note: The `location` field uses a single string. `oci://` references an OCI image; plain paths
without a prefix are treated as local file paths. Both WASM and JS components can be stored in OCI
registries — see `obelisk component push` to publish them.

## Common Executor Settings

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
  upgraded using the upgrade API endpoint, which replays the execution log by default to avoid
  upgrading to incompatible workflow code.

Activities support `by_ffqns` (default) and `by_component_digest`, but not `auto`. Since activities
are restarted and not replayed, the default `by_ffqns` strategy lets pending executions use the new
code after redeployment without an upgrade.

## Function Signatures

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

### JavaScript Activities

A JavaScript activity is a single function in a `.js` file. Because the source carries no types, the
table declares the function's `ffqn` and its signature, see
[Function Signatures](#function-signatures):

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
env_vars = ["ENV1", { key = "ENV2", value = "value" }] # Forwarded names must be declared in app.toml [public_env].
exposed_secrets = ["ACTIVITY_SECRET"] # Injected into process.env. Requires exposed_to grants.
```

Outbound HTTP requires an allowlist, see [Outbound HTTP Allowlist](#outbound-http-allowlist).
JavaScript activities receive exposed values as `process.env.ACTIVITY_SECRET`. Register the logical
name in the app secret registry and authorize the generated digest under
`[secrets.ACTIVITY_SECRET.exposed_to]`.

### WASM Activities

Activities compiled to WebAssembly components, for example from Rust, use the `activity_wasm`
section. Their function signatures come from the compiled component:

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

### Permanent Error Handling

Activities returning a variant containing a case named `permanent` will skip retries, regardless of
`max_retries`.

### Outbound HTTP Allowlist

Activities that make outbound HTTP calls require explicit `[[allowed_host]]` entries in the
deployment and matching `[[outbound_http.allowed_host]]` entries in `app.toml`. Without both, the
request is blocked. The same `allowed_host` syntax applies to `[[activity_js]]`,
`[[activity_wasm]]`, `[[activity_vm]]`, `[[webhook_endpoint_js]]`, and `[[webhook_endpoint_wasm]]`.

```toml
[[activity_js]]
name = "activity_llm"
location = "activity/llm.js"
exec.lock_expiry.seconds = 10
env_vars = [{key = "API_BASE_URL", value = "${API_BASE_URL:-https://api.openai.com}"}]

[[activity_js.allowed_host]]
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

#### URL prefix rules

When a component talks to a single base URL, `url_prefix` replaces both `pattern` and
`request_url_regex`, so one environment variable describes the whole destination:

```toml
[[activity_js]]
name = "activity_llm"
location = "activity/llm.js"
env_vars = ["LLM_URL"]

[[activity_js.allowed_host]]
url_prefix = "${LLM_URL}"
methods = ["GET", "POST"]
# Optional; omit to allow any continuation of the prefix.
url_regex_suffix = "/v1/models$|/v1/chat/completions$"
secrets = ["LLM_API_KEY"]
replace_in = ["headers"]
```

- `url_prefix` must be an absolute `http://` or `https://` URL without credentials, query, fragment,
  or wildcards. Use `pattern` when you need wildcards.
- `${VAR}` and `${VAR:-default}` are expanded before the prefix is regex-escaped, so the value is
  matched literally. The URL is normalized and trailing slashes are removed.
- The request origin (scheme, host, and port) of the prefix becomes the host pattern.
- `url_regex_suffix` is a regex appended to the literal prefix as a group. It must not start with
  `^`; end it with `$` to require an exact endpoint. Without a suffix, any URL continuing the prefix
  matches, for example `https://llm.example/api` matches `https://llm.example/api/v1/models`. The
  prefix is a plain string prefix, so it also matches `https://llm.example/api2`; use
  `url_regex_suffix = "/"` to require a path separator.
- As with `request_url_regex`, matching ignores query parameters.
- An entry uses either `pattern` (with optional `request_url_regex`) or `url_prefix` (with optional
  `url_regex_suffix`); the fields cannot be combined.

The same form is accepted in `[[outbound_http.allowed_host]]` in `app.toml`. App and deployment
entries may use different forms: verification checks that the app covers the deployment's origins
and methods, and both URL restrictions apply at runtime.

Secrets are injected via placeholder replacement in outgoing HTTP requests. The component receives
an opaque placeholder; the runtime substitutes real values only for requests to approved hosts.
`replace_in` selects where substitution happens: `headers`, `params` (URL query parameter values
only), and/or `body`. Substitution is a literal replacement of the placeholder string wherever it
appears in those locations, so the component itself decides placement (for example an
`Authorization: Bearer <placeholder>` header that it sets). Header names, URL paths, and query
parameter names are never searched. Body replacement requires valid UTF-8 and a textual content
type: `text/*`, JSON, or `application/x-www-form-urlencoded`.

### Experimental VM Activities

`activity_vm` runs a Nix-packaged Linux executable inside an experimental Linux VM. Set
`OBELISK_UNSTABLE_ACTIVITY_VM` on both the deployment CLI and server to select a backend:

| Value         | Backend                                                                              | Host requirements                                                          |
| :------------ | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `bochs-wasm`  | [Bochs](https://github.com/obeli-sk/activity-vm-bochs) x86 emulator compiled to WASM | Wasmtime; fixed 512 MiB guest and one vCPU                                 |
| `qemu-tcg`    | Native QEMU with software emulation                                                  | Matching `qemu-system-x86_64` on `PATH`                                    |
| `qemu-kvm`    | Native QEMU with KVM acceleration                                                    | Matching `qemu-system-x86_64` on `PATH` and `/dev/kvm`                     |
| `firecracker` | Firecracker microVM, cold booted for each execution                                  | `firecracker` and `mkfs.erofs` on `PATH`; readable and writable `/dev/kvm` |

The value is required even for existing VM deployments. Without it, deployment verification rejects
`[[activity_vm]]` and existing VM deployments cannot activate. Each backend pulls a pinned runtime
bundle from OCI. The guest ABI, cache layout, configuration, and runtime behavior may change or be
removed in a later release.

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
memory.mib = 512 # Required guest RAM; use memory.gib = 4 with a native backend.
cpus = 1         # Optional; defaults to 1.
exec.lock_expiry.seconds = 120

[[activity_vm.allowed_host]]
pattern = "https://api.example.com"
methods = ["GET"]
```

Native QEMU supports guest RAM from 256 MiB up to the pinned bundle's limit (currently 16.25 GiB)
and vCPUs up to the bundle's limit. Bochs requires exactly 512 MiB and one vCPU. Firecracker checks
memory and vCPU counts against its pinned bundle. The `memory` setting is required for every
backend; `cpus` defaults to one.

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
> {{ doc_link(title="`app.toml`", path="configuration/app.md#app-exec-approval") }} and the platform
> admin enables the
> {{ doc_link(title="exec gate", path="configuration/server.md#platform-exec-gate") }} in
> `server.toml`.

```toml
[[activity_exec]]
name = "name"                                # Optional. Defaults to {ifc_name}.{function_name} from ffqn
location = "scripts/my-script.sh"             # Deployment-local path or oci://registry/image:tag
# content = '''#!/usr/bin/env bash
# echo "\"hello\""
# '''
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
- Generated `content_digest` and `component_files` metadata must not appear in authored deployments.
  The CLI adds upload metadata during submission and removes it from exports.
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
blocking_strategy = "await"          # "await" (default) or "interrupt"
logs_store_min_level = "debug"
```

The blocking strategy controls whether an execution should `await` the child execution response or
be `interrupt`ed and later replayed. Note that the `await` strategy will only wait until
`lock_expiry` duration expires.

### WASM Workflows

Workflows compiled to WebAssembly components, for example from Rust, use the `workflow_wasm`
section:

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

## Webhook Endpoints

A Webhook Endpoint must be associated with a HTTP Server and must define one or more routes to
listen on. Routes are divided into two categories: with HTTP methods (high priority) and without
HTTP methods (low priority). When a request matches multiple routes of the same priority, the first
webhook will receive it.

The built-in `"external"` HTTP server (at `127.0.0.1:9090` by default) is always available and used
when `http_server` is omitted. Additional named servers are defined in `server.toml`.

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

### WASM Webhook Endpoints

Webhook endpoints compiled to WebAssembly components use the `webhook_endpoint_wasm` section:

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

### Route Syntax

Routes: Define URL paths (only the path is matched):

#### Static paths

- `"/"` - Root path only
- `"/path"` - Exact path match

#### Wildcards

- `"/path/*"` - Path prefix match
- `"{ methods = ["GET"], route = "/path" }"` - Method-specific (priority) match

#### Parameterized

- `"/status/:param1/:param2"` - Path parameters (exposed as env vars)

#### All paths

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

File paths in `deployment.toml` support these prefixes:

<div class="table">

| Prefix          | Default Path on Linux    | Details                                                            |
| --------------- | ------------------------ | ------------------------------------------------------------------ |
| `~`             | `~`                      | Home directory                                                     |
| `${DATA_DIR}`   | `~/.local/share/obelisk` | System data directory                                              |
| `${CACHE_DIR}`  | `~/.cache/obelisk`       | System cache directory                                             |
| `${CONFIG_DIR}` | `~/.config/obelisk`      | System config directory                                            |
| `${TEMP_DIR}`   | /tmp                     | See [temp_dir](https://doc.rust-lang.org/std/env/fn.temp_dir.html) |

</div>

Note: the resolved path on Mac OS and Windows will be different, e.g. for `${CONFIG_DIR}`:

- `/Users/youruser/Library/Application Support/com.obelisk.obelisk-App/` on Mac
- `C:\Users\youruser\AppData\Roaming\obelisk\obelisk\config\` on Windows

See the
[directories crate documentation](https://docs.rs/directories/6.0.0/directories/struct.ProjectDirs.html)
for details.
