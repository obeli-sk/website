+++
title = "Migrating from 0.42 to 0.43"
template = "docs.html"
weight = 4
+++

This guide targets **Obelisk 0.43.0-rc.6**. It is based on the
[published release notes](https://github.com/obeli-sk/obelisk/releases/tag/v0.43.0-rc.6) of every
0.43.0 release candidate. Audit every deployment, configuration file, script, and CI workflow
against these changes. Apps older than 0.42 must first follow the
{{ doc_link(title="0.42 migration guide", path="migrating-to-0.42.md", version="v0.42.0") }}.

## Check the app name

App names must be 4-25 characters of lowercase ASCII letters, digits, and interior hyphens. 0.42
accepted 1-63 characters. Rename any app whose `app_name` (or `OBELISK_APP_NAME`) falls outside this
range. The app name selects the default SQLite directory, so a renamed app starts with a new
database unless `server.toml` sets the database directory explicitly.

## Separate component verification from policy verification

`deployment verify` now checks components without loading app policy, server configuration, runtime
values, or database state:

```sh
obelisk deployment verify --deployment deployment.toml
```

Remove `--app-config`, `--server-config`, `--allow-unavailable-runtime-config`, and `--fix` from
this command. To verify app and platform permissions or runtime configuration, use `server verify`:

```sh
obelisk server verify --skip-db --app-config app.toml --deployment deployment.toml
# If the app intentionally needs platform settings:
obelisk server verify --skip-db --server-config server.toml --app-config app.toml --deployment deployment.toml
# CI without injected secret values:
obelisk server verify --skip-db --allow-unavailable-runtime-config --app-config app.toml --deployment deployment.toml
```

Deployments with
{{ doc_link(title="experimental VM activities", path="configuration/deployment.md#experimental-vm-activities") }}
still need `OBELISK_UNSTABLE_ACTIVITY_VM` set for either command.

`server verify` also performs every component check of `deployment verify`, so CI that already runs
`server verify` for a deployment does not need both. `server verify --skip-db` needs `--deployment`;
without `--skip-db` it falls back to the database's enqueued or active deployment. An app policy is
always checked against a deployment, so verify a policy file that ships without its own deployment
against a deployment that runs under it.

`--allow-unavailable-runtime-config` tolerates missing runtime values only. Required public
environment and secret declarations, outbound HTTP permissions, exec approvals, and secret-exposure
grants still have to exist. It does not bypass the app or platform policy.

`server run` and `server verify` discover `./app.toml` when `--app-config` is omitted. An explicit
path takes precedence. Without either an explicit file or discovered file, built-in app defaults
apply and the app name must come from `OBELISK_APP_NAME`.

## Repair policy explicitly

Policy repair moved to `server verify`. Review the resulting configuration changes:

```sh
obelisk server verify --skip-db --app-config app.toml --deployment deployment.toml --fix
```

`--fix` applies all app repairs, including declarations, outbound HTTP secret replacements, exec
approvals, and secret exposure grants. To limit a repair, use one or more of:

- `--fix-app-declarations`
- `--fix-app-http-permissions`
- `--fix-app-exec-permissions`
- `--fix-app-secret-exposure`

Platform exec permissions need the separate `--fix-server-exec-permissions` flag and a target
`--server-config` file. Repairs require the configuration paths to modify (a discovered `./app.toml`
counts) and a deployment file, preserve existing grants, and rerun verification.

## Remove generated metadata from authored deployments

Delete every `content_digest` and `component_files` field from authored `deployment.toml` files,
including fields on JavaScript, WASM, exec scripts, and referenced files. They are generated upload
metadata and are now rejected as authored input. Update generators and CI digest-repair scripts
accordingly. The CLI adds metadata during submission and removes it from exports. Pin a genuine
cross-repository OCI dependency with its OCI `@sha256:...` reference instead.

## Update authentication

Replace `server run --allow-unauthenticated-api` with `server run --no-auth`. The old flag has been
removed. Replace `OBELISK__API__TOKEN` with `OBELISK_API_TOKEN`; the legacy fallback has also been
removed. `--api-token` and server `api.token_hashes` remain supported.

Apps whose components call their own server's API no longer need an operator-supplied token for it.
Declare the secret as {{ doc_link(title="internal", path="configuration/app.md#internal-secrets") }}
and drop the instructions and scripts that generated and exported the token for the app:

```toml
[secrets]
OBELISK_API_TOKEN = { type = "internal" }
```

The value is the server's startup token, rotates on every restart, and requires an authenticated
API: `server run --no-auth` refuses to start with an internal secret. Keep an env-backed secret when
the token targets a different server.

The API can also accept OIDC ID tokens, such as Fly.io machine tokens, from issuers trusted in
`api.oidc`; see {{ doc_link(title="Authentication", path="access/authentication.md") }}.

Platforms running several apps can set
{{ doc_link(title="`app_env_prefix`", path="configuration/server.md#app-environment-prefix") }} in
`server.toml`; app public env and env-backed secrets are then read only from the prefixed variable
names.

## Audit stdout consumers

Human-readable listings, progress, and confirmations now go to **stderr**. Stdout carries IDs, JSON,
generated configuration, source content, and execution logs. Scripts parsing human-readable stdout
must use `--json` or deliberately capture stderr. This applies to cloud commands too.

Deployment `submit`, `apply`, and `enqueue` print the deployment ID to stdout. `--json` is now
available for those commands, deployment `list`, component `list`, execution `pause`, `unpause`,
`cancel`, and `upgrade`, and `cloud app endpoint`. Execution JSON follow modes emit flushed NDJSON:
one compact JSON object per line, including submission responses, log records, and final results. Do
not parse a followed execution as one JSON document.

## Audit REST consumers and JS webhooks

Use JSON for structured REST resources and actions. Structured `text/plain` representations have
been removed. WIT, source files, IDs, scalar app-config digests, execution-log streams, and SSE
retain their supported representations.

Clients decoding `/v1/components` exports must accept the new `extension` value `"schedule_with_id"`
for `-schedule-with-id` functions; it is distinct from `"schedule"`.

System-event retention requests must explicitly include `dry_run`; omission is rejected without
deleting events. gRPC behavior is unchanged. The CLI no longer supplies compatibility defaults for
replay measurements and public environment classifications when talking to servers older than 0.42.

`GET /v1/info` returns the app name, Obelisk version, deployment ID, node run ID, app config digest,
and start time. `GET /v1/admin/node-run-id` is deprecated and will be removed after 0.43; read
`node_run_id` from `/v1/info` instead.

In V8 activities and webhooks, `fetch` sets `Response.statusText` to the received HTTP/1 reason
phrase. A webhook `Response` accepts `options.statusText`, which must be a valid reason phrase.

Boa and V8 webhooks no longer receive automatic `__OBELISK_JS_SOURCE__` or
`__OBELISK_JS_FILE_NAME__` environment variables. Remove any dependency on them.

## WIT compatibility and caller-supplied schedule IDs

The generated packages are now `obelisk:types@6.1.0`, `obelisk:workflow@7.1.0`, and
`obelisk:webhook@7.1.0`. Existing components importing types `6.0.0` and workflow/webhook `7.0.0`
remain accepted, so regenerating existing WIT is optional unless adopting the new extensions.

If you regenerate support or dependency WIT, update authored worlds and native WIT imports to match
the generated packages: workflow and webhook references become `@7.1.0`, and types become `@6.1.0`.
This includes `workflow-support` and `workflow-dynamic-support`. A world importing `@7.0.0` cannot
resolve a dependency directory that contains only `@7.1.0`; acceptance of existing compiled
components does not make those source package names interchangeable. To regenerate with the target
CLI:

```sh
obelisk generate wit-support workflow wit/deps --force
# For webhook components, use webhook_endpoint instead of workflow.
obelisk generate wit-extensions --help
```

Typed `-schedule-with-id` extensions let workflows and webhooks supply a top-level execution ID.
JavaScript typed schedules accept `executionId` in the leading schedule object. Matching retries
reuse the original execution; a different target, parameters, or timing conflicts. Relative timing
compares the original offset from creation. Retrying never reschedules an execution.

## Deployment reuse and cloud commands

`deployment submit`, `apply`, and `enqueue` reuse the active deployment when its parsed content and
description match. Changing or removing the description creates a new deployment; explicit
deployment IDs are honored. Scripts must tolerate a successful submission returning an existing ID.

New {{ doc_link(title="`cloud` commands", path="access/cli.md#cloud-commands") }} manage apps,
tokens, policy, environment variables, and secrets. App-scoped commands, including `deployment`,
`execution`, `component`, and `admin`, live under `cloud app`, and `--app` is an option of
`cloud app`. Select an app with `--app`, `OBELISK_APP_NAME`, or `app_name` in `./app.toml`.
`cloud app deploy` publishes a local project in one step.

## Verification checklist

- Check every `app_name` against the 4-25 character rule.
- Audit all authored deployments for generated metadata and all verification invocations for removed
  flags.
- Run `server verify` for every deployment against each applicable app/server configuration.
- Run the repository's CI commands with the target release, regenerate required artifacts, and check
  for tracked drift.
- Keep cross-repository OCI dependencies pinned and remove self-references when building the same
  repository locally.
- Review app/server policy diffs, authentication (including internal secrets for self-API tokens),
  stdout consumers, REST requests, and optional WIT regeneration.
