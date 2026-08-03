+++
title = "Migrating from 0.40 to 0.41"
template = "docs.html"
weight = 60
+++

Obelisk 0.41 adds an operator-owned security boundary around component secrets and outbound HTTP,
changes how backtraces are persisted, and removes compatibility aliases deprecated in 0.40. This
guide covers the changes required to upgrade a 0.40 server and its deployments.

At a glance:

- **Operators** must declare secrets and outbound HTTP destinations in `server.toml`.
- **Deployment authors** must replace the old nested secret syntax with secret names and flatten
  secret placement onto each `allowed_host` entry.
- **API clients** must update two removed aliases and the execution-failure JSON spelling.
- **JavaScript authors** should adopt `obelisk.ChildError` and review scheduling code that passes
  `Date` or object values.

## Verify the migration locally

The new `obelisk deployment verify --fix` command can perform much of the mechanical migration
without starting a server or accessing its database:

```sh
obelisk deployment verify \
  --server-config server.toml \
  --deployment deployment.toml \
  --fix
```

It repairs content digests, updates the exec activity allowlist, and scaffolds missing secret
declarations. Review its diff, finish narrowing the generated policy, then rerun the command without
`--fix` to confirm the result. Add `--allow-unavailable-runtime-config` when CI does not have the
production environment variables or other runtime capabilities.

## Move secrets into the server registry

In 0.40, a deployment could resolve a secret directly from an environment variable. In 0.41, the
operator declares a logical secret name and its source in `server.toml`. Deployments can request the
logical name, but cannot select or interpolate its source.

Declare each secret once:

```toml
# server.toml
[secrets]
OPENAI_KEY = { env = "OPENAI_API_KEY" }
DB_PASSWORD = { env = "PRODUCTION_DB_PASSWORD" }
```

The key on the left is the name used by deployments. The `env` value is the environment variable
read by the server. At startup, Obelisk reads registered environment-backed secrets into memory and
removes their source variables from the process environment.

### Exec activity secrets

Replace the 0.40 table that contained environment-variable mappings:

```toml
# deployment.toml, 0.40
[[activity_exec]]
ffqn = "example:tools/run.command"

[activity_exec.secrets]
env_vars = [
  { name = "DB_PASSWORD", value = "${PRODUCTION_DB_PASSWORD}" },
]
```

with a list of registered names:

```toml
# deployment.toml, 0.41
[[activity_exec]]
ffqn = "example:tools/run.command"
secrets = ["DB_PASSWORD"]
```

The exec activity still receives the requested values in the `secrets` object on stdin. Only their
ownership and configuration have changed.

### Outbound HTTP secrets

Replace the nested `allowed_host.secrets` table:

```toml
# deployment.toml, 0.40
[[activity_js.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]

[activity_js.allowed_host.secrets]
env_vars = ["OPENAI_API_KEY"]
replace_in = ["headers"]
```

with flattened fields that reference the logical server secret:

```toml
# deployment.toml, 0.41
[[activity_js.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

Apply the same change to `activity_wasm`, `webhook_endpoint_js`, and `webhook_endpoint_wasm`
allowlists.

## Add the server outbound HTTP policy

Component-originated HTTP requests must now match an allowlist entry in both `deployment.toml` and
`server.toml`. If the server has no `[[outbound_http.allowed_host]]` entries, it denies all outbound
HTTP from components.

As a migration starting point, copy the deployment destinations into the server configuration:

```toml
# server.toml
[[outbound_http.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]
request_url_regex = "^POST https://api\\.openai\\.com/v1/"
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

Then narrow the operator-owned entries to the destinations and methods permitted on that server. The
effective policy is the intersection of the server and deployment entries: neither side can widen
the other. Secret replacement also requires matching entries on both sides to list the same secret
name and the same `replace_in` target.

This policy applies only to HTTP requests made by components. It does not replace API authentication
or control the server's own OCI and database connections.

## Update backtrace persistence

Remove the global 0.40 setting:

```toml
[wasm]
backtrace.persist = true
```

Workflow call-site backtraces are now captured lazily during user-issued replay and advance
operations. To replay one workflow and store its backtraces, run:

```sh
obelisk execution persist-backtraces <execution-id>
```

Webhook endpoints can opt in to persistence per component. The default is `false`:

```toml
[[webhook_endpoint_js]]
name = "api"
location = "webhook/api.js"
backtrace_persist = true
```

The same field is available on `webhook_endpoint_wasm`.

## Update failure JSON consumers

Execution failure JSON now consistently uses `execution_failed`:

- A platform failure projected into a `result<_, string>` error is now the string
  `"execution_failed"`, not `"execution-failed"`.
- The Web API execution result field is now `execution_failed`, not `execution_failure`.

Update exact string comparisons, generated client models, fixtures, and JSON decoders that use the
old spellings. WIT variant case names remain written in kebab case, such as `execution-failed`, in
WIT and deployment `return_type` declarations.

## Update removed API aliases

Two 0.40 compatibility paths have been removed:

| 0.40 compatibility name                   | 0.41 name                          |
| ----------------------------------------- | ---------------------------------- |
| REST field `allow_missing_runtime_config` | `allow_unavailable_runtime_config` |
| gRPC `CancelActivity`                     | `CancelExecution`                  |

The CLI already uses `--allow-unavailable-runtime-config`. Update older REST and gRPC clients before
switching the server to 0.41.

## Review JavaScript behavior changes

### Use `obelisk.ChildError`

`obelisk.ChildExecutionError` has been renamed to `obelisk.ChildError`. The old constructor remains
as a deprecated alias in 0.41, and both names identify the same error type:

```javascript
try {
  return childTask();
} catch (error) {
  if (!(error instanceof obelisk.ChildError)) throw error;
  console.error(error.childId, error.failureKind, error.value);
  throw error;
}
```

A cancelled `obelisk.sleep` now throws `obelisk.ChildError` with `cancelled === true` and
`failureKind === "cancelled"`. In 0.40 it threw a plain `Error`.

### `Date` is now supported for scheduling

Workflow `Date`, `Date()`, and `Date.now()` now use the deterministic Obelisk clock. APIs that
accept a schedule time, including `obelisk.sleep`, `schedule`, and `submitDelay`, accept a `Date` as
an absolute time:

```javascript
const wakeAt = new Date(Date.now() + 30_000);
obelisk.sleep(wakeAt);
```

In 0.40, a `Date` or another object without a recognized duration key was silently treated as
sleep-until-now. In 0.41, `Date` has the absolute-time behavior above, while an unrecognized object
throws `TypeError`. Review code that constructs schedule objects dynamically.

JavaScript workflows may also export `async` functions in 0.41. Existing synchronous exports remain
valid and do not need to change.

## Migration checklist

1. Register every deployment secret in the server's `[secrets]` table.
2. Replace `activity_exec.secrets` tables with `secrets = ["NAME"]`.
3. Flatten every `allowed_host.secrets` table into `secrets` and `replace_in` fields.
4. Add matching `[[outbound_http.allowed_host]]` entries to `server.toml`.
5. Remove `[wasm] backtrace.persist`; configure webhook persistence individually if needed.
6. Update failure JSON spellings and the removed REST and gRPC aliases.
7. Adopt `obelisk.ChildError` and review JavaScript schedule-object handling.
8. Run `obelisk deployment verify` for every deployment before starting the 0.41 server.
