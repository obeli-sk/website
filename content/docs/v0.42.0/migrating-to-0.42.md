+++
title = "Migrating from 0.41 to 0.42"
template = "docs.html"
weight = 61
+++

Obelisk 0.42 tightens the boundary between operators and deployments, removes configuration and API
aliases deprecated in 0.41, and replaces the global JavaScript runtime API with explicit ES module
imports. This guide covers the changes required to upgrade a 0.41 server and its deployments. See
{{ doc_link(title="Security model", path="security.md") }} for the operator/deployment trust
boundary behind the new policy requirements.

## Verify deployments before restarting

Run verification with the new Obelisk binary against every deployment and its server policy:

```sh
obelisk deployment verify \
  --server-config server.toml \
  --deployment deployment.toml
```

Use `--allow-unavailable-runtime-config` in CI when production environment variables or runtime
capabilities are deliberately unavailable. Verification catches removed configuration keys, missing
environment grants, JavaScript import errors, and mismatches between component and server HTTP
policies without changing the active deployment.

Missing public variables and secrets are reported together with a sorted `server.toml` snippet. To
apply the mechanical part of that repair, run:

```sh
obelisk deployment verify \
  --server-config server.toml \
  --deployment deployment.toml \
  --fix
```

`obelisk server verify --fix` provides the same repair behavior. The command adds missing public
variable names and secret scaffolds; review its diff and configure the real secret sources before
starting the server.

## Allow deployment environment variables explicitly

Deployments can only read process environment variables named in the operator-owned
`[public_env].allowed` list. This includes variables forwarded through `env_vars` and variables used
in `${...}` interpolation anywhere in `deployment.toml`.

Add the public configuration variables a deployment needs to `server.toml`:

```toml
[public_env]
allowed = ["API_BASE_URL", "REGION"]
```

Do not add credentials to this list. Keep them in `[secrets]`; deployments continue to refer to the
logical secret name, not its source environment variable. Missing allowed variables do not prevent
the server from starting, but a deployment that requires one still fails validation until it is set.

When a component calls the Obelisk API, use `OBELISK_API_TOKEN` as the logical secret and source
environment variable. Replace the older double-underscore name `OBELISK__API__TOKEN` in component
placeholders, deployment allowlists, server secret registrations, and operator setup instructions.

### Normalize outbound HTTP secret declarations

Some deployments may still use the pre-0.41 nested secret table. Replace it while auditing public
environment variables. For every activity and webhook allowlist, change:

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
Register each logical name in the server's `[secrets]` table and add a matching
`[[outbound_http.allowed_host]]` policy. The source environment variable belongs only in the server
secret registry, not in `[public_env].allowed` or the component's `env_vars`.

In 0.42.0-rc.2, registered secrets cannot be exposed as plaintext to JS or WASM webhook code for
inbound HMAC validation. Outbound HTTP placeholder replacement still works. Do not migrate an
inbound webhook credential into `public_env` or ordinary `env_vars`; keep that application on its
previous release until a release with secure webhook secret injection is available.

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
```

Webhooks use `obelisk:webhook-dynamic@1.0.0`. Move `call`, `schedule`, and workflow `submitJson`
uses to `dynamic`; APIs such as `sleep`, `createJoinSet`, execution ID helpers, and error classes
remain on the base module. Deployments that do not need runtime-selected dispatch no longer receive
that capability implicitly.

The deprecated `obelisk.ChildExecutionError` alias is also gone. Catch `obelisk.ChildError`.

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

| JavaScript API                  | JavaScript behavior                                      |
| ------------------------------- | -------------------------------------------------------- |
| Typed `fooSubmit(joinSet, ...)` | Returns the execution ID string; throws `Error` on error |
| `joinSet.submit(ffqn, params)`  | Returns the execution ID string; throws `Error` on error |
| Typed `fooSchedule(at, ...)`    | Returns the execution ID string; throws `Error` on error |
| Typed `fooStub(id, result)`     | Returns `undefined`; throws `Error` on error             |

Awaiting and retrieval APIs are translated similarly: they return the decoded child value and throw
on child, retrieval, or platform errors. See
{{ doc_link(title="JavaScript workflows", path="js/js-workflows.md", version="v0.42.0") }} for the
complete JavaScript contract.

## Update the Nix development environment

For an application flake that follows Obelisk's Nix inputs, start from the `flake.lock` published
with the Obelisk release instead of independently updating every input. Then run a Nix command in
the application so Nix adds the consumer flake's `obelisk` input node. This preserves Obelisk's
pinned dependency graph and allows the application to reuse published Cachix artifacts.

## Remove deprecated configuration

Apply these configuration changes before verification:

- Remove deployment `component_digest` overrides. Obelisk computes component digests from content
  and configuration.
- Move `[workflows].lock_extension_leeway` to `exec.lock_extension_leeway` on each
  `[[workflow_wasm]]` or `[[workflow_js]]` component that needs a non-default value.
- Remove `${DEPLOYMENT_DIR}/` from deployment-owned paths. Paths are relative to the
  `deployment.toml` file.
- Rename `allow_exec_activities` to `allowed_exec_activities`. Boolean values and unnamed digest
  lists are no longer accepted.
- Rename `activity_exec.secrets` to `activity_exec.exposed_secrets`.
- Move top-level `max_deployment_file_bytes` to `limits.max_deployment_file_bytes` in `server.toml`.

The default execution lock expiry is now 30 seconds and lock extension starts 15 seconds before
expiry. Review explicitly tuned workflow lock expiry and extension values, especially values based
on the old one-second default.

## Authorize plaintext secret exposure

Native exec and VM activities that receive plaintext secrets now require a `SecretExposureDigest`.
The digest binds the component's executable configuration and its complete set of exposed secrets,
so existing exec content-digest approvals cannot be reused.

After renaming each exec activity's `secrets` field to `exposed_secrets`, generate the grants from
the migrated deployment:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Review and copy the generated entries into `server.toml`. Exec activities need both the execution
grant and one exposure grant for every secret they receive:

```toml
[allowed_exec_activities]
"migration" = "sha256:..."

[secrets.DB_PASSWORD]
env = "PRODUCTION_DB_PASSWORD"

[secrets.DB_PASSWORD.exposed_to]
"migration" = "sha256:..."
```

TOML cannot add a nested `exposed_to` table beneath an inline entry such as
`DB_PASSWORD = { env = "PRODUCTION_DB_PASSWORD" }`. Convert any secret that needs exposure grants to
the regular table form shown above.

An array of digests can temporarily authorize overlapping deployment revisions. VM activities do not
use `allowed_exec_activities`, but each plaintext secret exposed through
`activity_vm.exposed_secrets` still needs its generated `[secrets.<name>.exposed_to]` grant.

HTTP placeholder substitution continues to use `allowed_host.secrets`; it does not expose the
plaintext value to the component and does not require an `exposed_to` grant.

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

## Update API clients

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

## Migration checklist

1. Add every non-secret deployment environment variable to `[public_env].allowed`.
2. Convert nested `allowed_host.secrets.env_vars` tables to logical `secrets` lists and matching
   server policy.
3. Replace the JavaScript global with versioned base and dynamic module imports.
4. Remove or relocate deprecated configuration fields.
5. Regenerate secret-exposure grants for exec and VM activities that receive plaintext secrets.
6. Update REST and gRPC clients that use removed aliases, request fields, or cursor formats.
7. Review the new 30-day retention and 1 MiB persisted-value defaults.
8. Run `obelisk deployment verify` for every server/deployment pair.
9. Confirm that no JS/WASM webhook depends on unavailable RC2 plaintext secret exposure.
10. Back up the database, upgrade the server, and smoke-test workflow calls, webhook schedules,
    outbound HTTP, and log pagination.
