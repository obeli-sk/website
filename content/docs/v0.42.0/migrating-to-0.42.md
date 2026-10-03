+++
title = "Migrating from 0.41 to 0.42"
template = "docs.html"
weight = 61
+++

Obelisk 0.42 separates platform, app, and deployment configuration, removes configuration and API
aliases deprecated in 0.41, adds native V8 as an opt-in JavaScript runtime, and replaces the global
JavaScript runtime API with explicit ES module imports. This guide covers the changes required to
upgrade a 0.41 server and its deployments. See
{{ doc_link(title="Security model", path="security.md", version="v0.42.0") }} for the trust boundary
behind the new policy requirements.

If you already migrated to a 0.42 release candidate, see
[Upgrading from an earlier 0.42 release candidate](#upgrading-from-an-earlier-0-42-release-candidate)
at the end of this guide.

## Split the configuration into three files

0.42 uses three configuration files, each owned by a different role:

| File              | Owner          | Contents                                                                                   |
| ----------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `server.toml`     | Platform admin | Listeners, database, resource limits, logging, and the platform exec gate                  |
| `app.toml`        | App admin      | `app_name`, secrets, public environment variables, outbound HTTP policy, and exec approval |
| `deployment.toml` | App developer  | Components, routes, and cron tasks                                                         |

In 0.41, secrets, `[public_env]`, `[[outbound_http.allowed_host]]`, and `[allowed_exec_activities]`
lived in `server.toml`. Move them to `app.toml` with:

```sh
obelisk generate split-config --server-config server.toml
```

The command rewrites `server.toml` and writes the app policy to a sibling `app.toml` (use
`--app-config PATH` for a different location). It also converts `[public_env].allowed` to named
entries. Split-config validates the resulting `server.toml`, so remove the keys listed in
[Remove deprecated configuration](#remove-deprecated-configuration) first. It refuses to split a
secret whose source variable differs from its logical name; see
[Rename secret source variables](#rename-secret-source-variables).

Pass the app policy to every server and verification command with `--app-config` (`-a`):

```sh
obelisk server run --server-config server.toml --app-config app.toml --deployment deployment.toml
```

`server.toml` remains optional. If it is omitted, built-in platform defaults are used.

### Name the app

The server no longer starts without an app name. Set `app_name` in `app.toml`, or set
`OBELISK_APP_NAME` when running without an app policy file:

```toml
app_name = "my-app"
```

The name selects the default SQLite directory, which moves from `${DATA_DIR}/obelisk-sqlite` to
`${DATA_DIR}/apps/${APP_NAME}/sqlite`. **An upgraded server that relies on the default SQLite
location will otherwise start with an empty database.** To keep the existing execution history, pin
the old location in `server.toml` before starting 0.42:

```toml
database.sqlite.directory = "${DATA_DIR}/obelisk-sqlite"
```

Alternatively, stop the 0.41 server and move the directory to the new app-specific path. PostgreSQL
configurations are not affected.

### Declare the platform exec gate

Exec activities now need approval from both the app admin and the platform admin. `app.toml` lists
the reviewed component digests, and `server.toml` must allow them with its own
`allowed_exec_activities` field:

```toml
# server.toml
allowed_exec_activities = "*"     # Allow any app-approved exec activity (startup warns)

# or limit the platform grant to specific digests:
# [allowed_exec_activities]
# migration = "sha256:..."
```

Omitting the field, or setting it to `false`, disables exec activities. `true` is no longer
accepted. Every digest in `app.toml` must be covered by the platform grant; both files accept digest
arrays for overlapping deployment revisions.

`obelisk generate server-config --trusted` now generates a platform file with
`allowed_exec_activities = "*"`. Unrestricted outbound HTTP for single-party installations moved to
`obelisk generate app-config --trusted`.

## Verify deployments before restarting

Run verification with the new Obelisk binary against every deployment and its policy files:

```sh
obelisk deployment verify \
  --server-config server.toml \
  --app-config app.toml \
  --deployment deployment.toml
```

Use `--allow-unavailable-runtime-config` in CI when production environment variables or runtime
capabilities are deliberately unavailable. Verification catches removed configuration keys, missing
environment declarations, JavaScript import errors, and mismatches between component and app HTTP
policies without changing the active deployment.

That flag also skips the exec digest checks: stale or unknown digests in either
`[allowed_exec_activities]` table still pass, and only the platform gate being off is reported. Exec
activity digests change with 0.42, so run verification once without the flag, with the runtime
variables and secrets set, or compare the tables against
`obelisk generate secret-config-digest --deployment deployment.toml`.

Missing public variables and secrets are reported together with a sorted `app.toml` snippet. To
apply the mechanical part of that repair, add `--fix`:

```sh
obelisk deployment verify \
  --server-config server.toml \
  --app-config app.toml \
  --deployment deployment.toml \
  --fix
```

`obelisk server verify --fix` provides the same repair behavior. With `--app-config`, `--fix` adds
missing `[public_env]` entries, scaffolds `[secrets]` entries, and writes the reviewed exec
allowlist and `exposed_to` grants into `app.toml`. It also scaffolds uncovered outbound HTTP
destinations for review. It does not change `server.toml`. Review its diff and set the real secret
values before starting the server.

When an exec activity already has a stale digest in `app.toml`, `--fix` keeps it and appends the
current digest, turning the entry into an `["sha256:old", "sha256:new"]` array. Remove the old
digest unless the previous deployment revision must keep running. Because `--fix` does not change
`server.toml`, the command still exits with an error until the platform exec gate also covers the
new digest.

## Declare deployment environment variables

Deployments can only read process environment variables declared in the app's `[public_env]` table.
This includes variables forwarded through `env_vars` and variables used in `${...}` interpolation
anywhere in `deployment.toml`. The 0.41 `allowed` list is replaced by named entries:

```toml
# app.toml
[public_env]
API_BASE_URL = {}
REGION = {}
TRACE_ID = { optional = true }
MODE = { optional = true }
```

Entries are required by default: the server refuses to start, and activation rejects a deployment,
when a required variable is not set. Mark variables that may be absent with `optional = true`. A
deployment may reference an optional variable only through an optional forwarded reference or an
interpolation fallback:

```toml
env_vars = ["REGION", { key = "TRACE_ID", optional = true }, { key = "MODE", value = "${MODE:-batch}" }]
```

Do not add credentials to `[public_env]`. Keep them in `[secrets]`; deployments refer to the logical
secret name, not a source variable.

When a component calls the Obelisk API, use `OBELISK_API_TOKEN` as the logical secret and source
environment variable. Replace the older double-underscore name `OBELISK__API__TOKEN` in component
placeholders, deployment allowlists, app secret registrations, and operator setup instructions.

## Rename secret source variables

A registered secret now reads the environment variable with the same name. The `env` source alias is
removed:

```toml
# 0.41 server.toml
[secrets]
OPENAI_KEY = { env = "OPENAI_API_KEY" }

# 0.42 app.toml
[secrets]
OPENAI_KEY = {}
```

Either rename the process environment variable to match the logical name (`OPENAI_KEY` above) or
rename the logical secret everywhere the deployment refers to it. Obelisk reads each value into
memory at startup and removes the variable from the process environment before workers start.

A secret the application can run without can be registered with `optional = true`. An absent
optional secret is omitted from the component environment or stdin. Deployment references must also
opt in, otherwise verification still requires the value:

```toml
exposed_secrets = ["API_KEY", { name = "SESSION_TOKEN", optional = true }]
secrets = ["OPENAI_KEY", { name = "GITHUB_TOKEN", optional = true }]
```

`OBELISK__...` environment overrides apply only to `server.toml`; they do not configure `app.toml`.

### Normalize outbound HTTP secret declarations

Some deployments may still use the pre-0.41 nested secret table. Replace it while auditing the
policy. For every activity and webhook allowlist, change:

```toml
[[activity_wasm.allowed_host]]
pattern = "https://api.example.com"
methods = ["POST"]

[activity_wasm.allowed_host.secrets]
env_vars = ["API_TOKEN"]
replace_in = ["headers"]
```

to a list of logical secret names with `replace_in` on the allowlist entry:

```toml
[[activity_wasm.allowed_host]]
pattern = "https://api.example.com"
methods = ["POST"]
secrets = ["API_TOKEN"]
replace_in = ["headers"]
```

Apply the same conversion to `activity_js`, `webhook_endpoint_wasm`, and `webhook_endpoint_js`.
Register each logical name in the app's `[secrets]` table and add a matching
`[[outbound_http.allowed_host]]` entry, with the same `secrets` and `replace_in`, to `app.toml`. The
source environment variable belongs only in the secret registry, not in `[public_env]` or the
component's `env_vars`.

Activation now rejects a deployment whose outbound HTTP destinations or methods are not covered by
the app policy, instead of discovering the denial at request time. Verification prints the missing
`app.toml` entries. Both the app and deployment `request_url_regex` values apply to a request; they
need not be identical.

## Authorize plaintext secret exposure

JS and WASM activities and webhook endpoints can now request registered secrets as environment
variables with `exposed_secrets`, alongside exec and VM activities:

```toml
[[webhook_endpoint_js]]
name = "signed-webhook"
location = "webhook.js"
routes = ["/*"]
exposed_secrets = ["WEBHOOK_SIGNING_SECRET"]
```

Every plaintext exposure requires a `SecretExposureDigest` grant under `[secrets.<name>.exposed_to]`
in `app.toml`. The digest binds the component's configuration and its complete set of exposed
secrets, so existing 0.41 exec content-digest approvals cannot be reused. After renaming each exec
activity's `secrets` field to `exposed_secrets`, generate the grants from the migrated deployment:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Review and copy the generated entries into `app.toml`, or let
`deployment verify --app-config app.toml --fix` write them. Exec activities need both the execution
grant and one exposure grant for every secret they receive, plus the platform gate in `server.toml`:

```toml
# app.toml
[allowed_exec_activities]
"migration" = "sha256:..."

[secrets.DB_PASSWORD.exposed_to]
"migration" = "sha256:..."
```

Regenerate grants when the component or its requested secret set changes. Use plaintext exposure for
credentials that component code must read, such as inbound webhook HMAC keys. Outbound HTTP
placeholder replacement still uses `allowed_host.secrets` and does not require an `exposed_to`
grant.

Deployment generators that synthesize both `deployment.toml` and `app.toml` must apply the same
binding. Materialize the final component configuration first, generate its digest, and carry that
digest alongside the exposed-secret request or recompute it before writing the app grant. Reject an
exposed-secret request when the matching digest is absent; never fall back to an ordinary
environment variable.

## Import JavaScript runtime APIs

The unversioned global `obelisk` object has been removed. Import the stable, versioned runtime
module in every JavaScript workflow and webhook that uses host operations:

```javascript
import * as obelisk from "obelisk:workflow@1.0.0";
```

For a webhook, use `obelisk:webhook@1.0.0` instead. Runtime-selected calls and schedules are now
separate capabilities, so import them from the corresponding dynamic module:

```javascript
import * as obelisk from "obelisk:workflow@1.0.0";
import * as dynamic from "obelisk:workflow-dynamic@1.0.0";

const result = dynamic.call(ffqn, params);
const execId = dynamic.submit(joinSet, ffqn, params);
```

Webhooks use `obelisk:webhook-dynamic@1.0.0`. Move `call` and `schedule` uses to `dynamic`. Join set
objects no longer have a `submit` method: replace `joinSet.submit(ffqn, params)` with
`dynamic.submit(joinSet, ffqn, params)`. Typed `fooSubmit(joinSet, ...)` imports are unchanged. APIs
such as `sleep`, `createJoinSet`, execution ID helpers, and error classes remain on the base module,
which does not export `call`, `schedule`, or `submit`.

The dynamic module is only available to a component that declares it statically: an `import` or
`export ... from` of `obelisk:workflow-dynamic@1.0.0` (or `obelisk:webhook-dynamic@1.0.0`) in any of
its source files. This also applies when the module is loaded with `import()`. Deployments that do
not need runtime-selected dispatch no longer receive that capability implicitly.

The deprecated `obelisk.ChildExecutionError` alias is also gone. Catch `obelisk.ChildError`.

### Native V8 is an opt-in JavaScript runtime

JavaScript workflows, activities, and webhooks still run on Boa compiled to WASM by default, bounded
by the `wasm` cells of `[limits]` (see [Review resource limits](#review-resource-limits)). Start the
server with `OBELISK_JS_RUNTIME=v8` to run them on native V8 isolates instead. Components need no
changes. See {{ doc_link(title="JS runtime", path="js/js-runtime.md") }} for the differences between
the runtimes.

## Regenerate Rust WIT dependencies

Regenerate workflow support and extension WIT with the 0.42 CLI. Workflow support moves from
`obelisk:workflow/workflow-support@6.0.0` to `@7.0.0`, and the shared Obelisk types move from
`@5.0.0` to `@6.0.0`. Webhook support also moves to `obelisk:webhook@7.0.0`:

```sh
obelisk generate wit-support workflow --force wit/deps
obelisk generate wit-extensions activity activity-wit wit/deps
```

Add `obelisk:workflow/workflow-dynamic-support@7.0.0` to native workflow worlds that use
`call-json`, `submit-json`, or `schedule-json`. Those functions are no longer part of the base
workflow support interface.

Generated `*-submit` extensions now return `result<execution-id, child-execution-request-error>`,
and generated stub functions include the new `value-too-large` error. The `function` record moved
from the `execution` interface to the new `function` interface. Update native callers and imports,
then rebuild components before deployment verification.

This WIT signature change applies to native component bindings. Obelisk's JavaScript adapters
translate WIT results into JavaScript return values and exceptions. Do not manually unwrap a raw
`{ tag: "ok" | "err", val: ... }` result in JavaScript. `submit-json`, `schedule-json`, and
`stub-json` are internal WIT bindings, not JavaScript functions to call directly:

| JavaScript API                          | JavaScript behavior                                      |
| --------------------------------------- | -------------------------------------------------------- |
| Typed `fooSubmit(joinSet, ...)`         | Returns the execution ID string; throws `Error` on error |
| `dynamic.submit(joinSet, ffqn, params)` | Returns the execution ID string; throws `Error` on error |
| Typed `fooSchedule(at, ...)`            | Returns the execution ID string; throws `Error` on error |
| Typed `fooStub(id, result)`             | Returns `undefined`; throws `Error` on error             |

Awaiting and retrieval APIs are translated similarly: they return the decoded child value and throw
on child, retrieval, or platform errors. See
{{ doc_link(title="JavaScript workflows", path="js/js-workflows.md", version="v0.42.0") }} for the
complete JavaScript contract.

## Update installation and the Nix development environment

Obelisk is no longer published to crates.io, so `cargo install obelisk` and `cargo binstall obelisk`
do not receive 0.42.0 or later releases. Install them from the GitHub release binaries
(`download.sh`), the Docker image, or Nix. See the [Installation page](@/install/_index.md).

For an application flake that follows Obelisk's Nix inputs, start from the `flake.lock` published
with the Obelisk release instead of independently updating every input. Then run a Nix command in
the application so Nix adds the consumer flake's `obelisk` input node. This preserves Obelisk's
pinned dependency graph and allows the application to reuse published Cachix artifacts.

Docker and other container setups must now provide an app name, for example with
`-e OBELISK_APP_NAME=my-app` or by mounting an `app.toml` and passing `--app-config`.

## Remove deprecated configuration

Apply these configuration changes before verification:

- Remove deployment `component_digest` overrides. Obelisk computes component digests from content
  and configuration.
- Move `[workflows].lock_extension_leeway` to `exec.lock_extension_leeway` on each
  `[[workflow_wasm]]` or `[[workflow_js]]` component that needs a non-default value.
- Remove `${DEPLOYMENT_DIR}/` from deployment-owned paths. Paths are relative to the
  `deployment.toml` file.
- Rename `allow_exec_activities` to `allowed_exec_activities`. Boolean `true` and unnamed digest
  lists are no longer accepted.
- Rename `activity_exec.secrets` to `activity_exec.exposed_secrets`.
- Move top-level `max_deployment_file_bytes` to `limits.max_deployment_file_bytes` in `server.toml`.
- Remove `[wasm].global_executor_instance_limiter` and `[wasm].global_webhook_instance_limiter`. Use
  the `[limits]` cells described below.
- Remove `exec.instance_limiter` from deployment components. It was not a cross-node singleton lock;
  use the `[limits]` cells to bound a process and the execution log for exclusivity.
- Replace `[public_env].allowed` with named `[public_env]` entries in `app.toml`.
- Remove `env = "..."` from `[secrets]` entries and rename the source variables.

The default execution lock expiry is now 30 seconds and lock extension starts 15 seconds before
expiry. Review explicitly tuned workflow lock expiry and extension values, especially values based
on the old one-second default.

## Review resource limits

Concurrency and per-instance memory are now bounded by per-workload, per-runtime cells in
`server.toml`. Each cell sets a concurrent `count` and, except for `process`, a per-slot `memory`;
both accept `"unlimited"`. Byte sizes require a unit key (`mib`, `gib`, or `bytes`):

```toml
[limits.activities.wasm]
count = 500
memory.gib = 1

[limits.activities.v8]
count = 16
memory.mib = 256

[limits.activities.process]   # activity_exec
count = 32
```

The defaults cap concurrency at 500 WASM activities, workflows, and webhooks, 16 V8 activities and
webhooks, 100 V8 workflows, 32 exec processes, and 8 VM activities. In 0.41, execution concurrency
was unlimited by default. Raise the relevant cells for workloads with high parallelism, especially
JavaScript activities and webhooks. See
{{ doc_link(title="Server Configuration", path="configuration/server.md#execution-slots", version="v0.42.0") }}
for every cell.

Executors acquire a slot before locking an execution, so work beyond the limit stays pending. A
webhook request that cannot get a slot now returns `503 Service Unavailable` instead of
`429 Too Many Requests`; capacity is acquired after route matching.

Webhook handlers also have a new wall-clock deadline for returning a response, 30 seconds by
default. Increase `[webhooks].request_timeout` in `server.toml` for handlers that intentionally
block longer. A streaming response body is not limited after the response has been returned.

## Review retention and value-size defaults

Automatic maintenance is enabled by default and retains completed execution trees, inactive
deployments, and system events for 30 days. Before the upgrade, set the `maintenance.gc.retention`
policies in `server.toml` if your audit, recovery, or compliance needs require a different lifetime.
The new admin API and `obelisk admin` commands can inspect and apply retention policies explicitly.

New execution trees also snapshot a 1 MiB `limits.max_persisted_value_size_bytes` limit. Submitting,
scheduling, stubbing, or returning a larger persisted value now produces `value-too-large` rather
than storing it. Existing execution trees keep their previous unlimited contract. The separate
`limits.max_transport_message_size_bytes` setting defaults to 512 MiB and bounds gRPC messages and
equivalent REST request bodies.

## Update API clients and scripts

- Rename `obelisk deployment get` to `obelisk deployment pull`.
- Remove calls to `obelisk deployment gc`. Automatic maintenance removes unreferenced deployment
  files; `obelisk admin` provides explicit retention commands.
- Remove `--json` from `obelisk generate server-config` and `obelisk generate deployment`; the
  generators write TOML only.
- Replace the `hot_redeploy` REST request alias with `apply`.
- Send structured `function_filter` values instead of the removed gRPC `function_name_prefix`.
- Use canonical join-set IDs when filtering execution responses; bare join-set names are rejected.
  For example, query `join_set=n%3Asession-events`, not `join_set=session-events`.
- Treat log pagination cursors as opaque. Pass the cursor returned by the API, and use `after` for
  timestamp filtering instead of using an RFC 3339 timestamp as a cursor. Omit `cursor` on the first
  page rather than manufacturing a timestamp sentinel such as `1970-01-01T00:00:00Z`.
- Supply a `deployment_id` when submitting through REST or gRPC. REST clients should use
  `PUT /v1/deployments/{deployment-id}`. Retrying the same ID and content is idempotent; reusing an
  ID for different content is rejected. Deployment IDs are `Dep_` followed by a ULID. Generate one
  with `obelisk generate deployment-id`, or use a ULID library when calling the REST API directly.
  The Obelisk CLI generates an ID unless `--deployment-id` is supplied.
- REST requests with `follow=true` (`POST /v1/executions`, `PUT /v1/executions/{id}`, and
  `GET /v1/executions/{id}`) now return a `text/event-stream` response. Read the `data` field of the
  `result` event instead of parsing the response body as JSON. See
  {{ doc_link(title="API access", path="access/api.md", version="v0.42.0") }}.
- gRPC and gRPC-web are deprecated. Move clients to the `/v1` REST API, which now covers the gRPC
  feature set, including status streams, exact function and state filters, and app policy lookup.

## Migration checklist

1. Remove the deprecated keys and limiters from `server.toml` and `deployment.toml`.
2. Rename secret source variables to match their logical names.
3. Run `obelisk generate split-config --server-config server.toml` and add `app_name` to `app.toml`.
4. Pin `database.sqlite.directory` or move the SQLite directory to keep existing history.
5. Set the platform `allowed_exec_activities` gate if the app uses exec activities.
6. Declare every non-secret deployment variable in `[public_env]`, marking optional ones.
7. Convert nested `allowed_host.secrets.env_vars` tables to logical `secrets` lists and matching app
   policy.
8. Replace the JavaScript global with versioned base and dynamic module imports.
9. Regenerate WIT dependencies and rebuild native components.
10. Regenerate secret-exposure and exec grants into `app.toml`.
11. Review the `[limits]` cells, webhook request timeout, 30-day retention, and 1 MiB
    persisted-value defaults.
12. Update CLI scripts, installation channels, and REST and gRPC clients.
13. Run `obelisk deployment verify --server-config server.toml --app-config app.toml` for every
    deployment.
14. Back up the database, upgrade the server with `--app-config`, and smoke-test workflow calls,
    webhook schedules, outbound HTTP, and log pagination.

## Upgrading from an earlier 0.42 release candidate

Applications already migrated to 0.42.0-rc.2 or rc.3 have handled the JavaScript, WIT, and
exposure-grant changes above, and most API changes. They still need the changes introduced after
rc.3:

- Split `server.toml` into `server.toml` and `app.toml`, add `app_name`, and pass `--app-config` to
  `server run`, `server verify`, and `deployment verify`.
- Pin or move the SQLite directory, because the default path now includes the app name.
- Convert `[public_env].allowed` to named entries and remove `env` source aliases from `[secrets]`.
  Entries are required at startup unless marked `optional = true`, even when the active deployment
  does not reference them, so test servers that share the app policy must set them too.
- Cover every outbound HTTP destination before activating a deployment. rc.6 rejected uncovered
  destinations even with `--allow-unavailable-runtime-config`; the current version permits
  verification and submission while app approval is pending. `verify --fix` can scaffold the missing
  `app.toml` entries for review.
- Parse `follow=true` REST responses as `text/event-stream` and read the `data` field of the
  `result` event. rc.3 still returned the JSON result to clients that sent
  `Accept: application/json`.
- Move `[secrets.<name>.exposed_to]` grants and `[allowed_exec_activities]` digests into `app.toml`,
  and add the platform `allowed_exec_activities` gate to `server.toml`.
- Regenerate exec digests with `obelisk generate secret-config-digest`. Digests approved under rc.2
  or rc.3 are rejected by rc.6 and later. List the old and new digest as an array only while both
  deployment revisions must run.
- Replace the instance limiters with `[limits]` cells and review the new defaults.
- Update scripts that use `obelisk deployment get` or `cargo install obelisk`.
- Expect JavaScript components to run on Boa compiled to WASM unless `OBELISK_JS_RUNTIME=v8` is set.
  rc.4 through rc.10 defaulted to V8; set `OBELISK_JS_RUNTIME=v8` to keep it. The former `boawasm`
  value is rejected; `OBELISK_JS_RUNTIME=boa-wasm` selects the Boa default explicitly.
- On V8, declare the HMAC hash actually used and include `sign` or `verify` in the key usages.
  Through rc.11, V8 signed with SHA-256 regardless of the key's hash and did not check usages.
- Replace `joinSet.submit(ffqn, params)` with `dynamic.submit(joinSet, ffqn, params)` and import
  `obelisk:workflow-dynamic@1.0.0` statically in every component that uses the dynamic module, even
  when it is loaded with `import()`. The base module does not export `call` or `schedule`.
- Set `OBELISK_UNSTABLE_ACTIVITY_VM` on the deployment CLI and server for every VM activity. Choose
  `bochs-wasm`, `qemu-tcg`, `qemu-kvm`, or `firecracker`, and add required guest `memory` to each
  `[[activity_vm]]`. `cpus` is optional and defaults to one. Bochs requires `memory.mib = 512` and
  one vCPU; see
  {{ doc_link(title="VM activity configuration", path="configuration/deployment.md#experimental-vm-activities", version="v0.42.0") }}
  for native backend requirements.
