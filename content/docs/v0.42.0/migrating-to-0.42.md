+++
title = "Migrating from 0.41 to 0.42"
template = "docs.html"
weight = 61
+++

Obelisk 0.42 tightens the boundary between operators and deployments, removes configuration and API
aliases deprecated in 0.41, and replaces the global JavaScript runtime API with explicit ES module
imports. This guide covers the changes required to upgrade a 0.41 server and its deployments.

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
`@5.0.0` to `@6.0.0`:

```sh
obelisk generate wit-support workflow --force wit/deps
obelisk generate wit-extensions activity activity-wit wit/deps
```

Add `obelisk:workflow/workflow-dynamic-support@7.0.0` to native workflow worlds that use
`call-json`, `submit-json`, or `schedule-json`. Those functions are no longer part of the base
workflow support interface.

Generated `*-submit` extensions now return
`result<execution-id, child-execution-request-error>`, and generated stub functions include the new
`value-too-large` error. Update native callers to handle the submit error and rebuild components
before deployment verification.

## Remove deprecated configuration

Apply these configuration changes before verification:

- Remove deployment `component_digest` overrides. Obelisk computes component digests from content
  and configuration.
- Move `[workflows].lock_extension_leeway` to `exec.lock_extension_leeway` on each
  `[[workflow_wasm]]` or `[[workflow_js]]` component that needs a non-default value.
- Remove `${DEPLOYMENT_DIR}/` from deployment-owned paths. Paths are relative to the
  `deployment.toml` file.
- Replace an unnamed `allow_exec_activities` digest list with a table mapping each reviewed activity
  name to its content digest.
- Move top-level `max_deployment_file_bytes` to `limits.max_deployment_file_bytes` in `server.toml`.

The default execution lock expiry is now 30 seconds and lock extension starts 15 seconds before
expiry. Review explicitly tuned workflow lock expiry and extension values, especially values based
on the old one-second default.

## Update API clients

- Replace the `hot_redeploy` REST request alias with `apply`.
- Send structured `function_filter` values instead of the removed gRPC `function_name_prefix`.
- Use canonical join-set IDs when filtering execution responses; bare join-set names are rejected.
  For example, query `join_set=n%3Asession-events`, not `join_set=session-events`.
- Treat log pagination cursors as opaque. Pass the cursor returned by the API, and use `after` for
  timestamp filtering instead of using an RFC 3339 timestamp as a cursor. Omit `cursor` on the
  first page rather than manufacturing a timestamp sentinel such as `1970-01-01T00:00:00Z`.

## Migration checklist

1. Add every non-secret deployment environment variable to `[public_env].allowed`.
2. Replace the JavaScript global with versioned base and dynamic module imports.
3. Remove or relocate deprecated configuration fields.
4. Update REST and gRPC clients that use removed aliases or cursor formats.
5. Run `obelisk deployment verify` for every server/deployment pair.
6. Back up the database, upgrade the server, and smoke-test workflow calls, webhook schedules,
   outbound HTTP, and log pagination.
