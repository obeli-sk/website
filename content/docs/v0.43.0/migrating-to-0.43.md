+++
title = "Migrating from 0.42 to 0.43"
template = "docs.html"
weight = 4
+++

This guide targets **Obelisk 0.43.0-rc.14**. It is based on the
[published release notes](https://github.com/obeli-sk/obelisk/releases/tag/v0.43.0-rc.14) of every
0.43.0 release candidate. Audit every deployment, configuration file, script, and CI workflow
against these changes. Apps older than 0.42 must first follow the
{{ doc_link(title="0.42 migration guide", path="migrating-to-0.42.md", version="v0.42.0") }}.

## Check the app name

App names must be 4-25 characters of lowercase ASCII letters, digits, and interior hyphens. 0.42
accepted 1-63 characters. Rename any app whose `app_name` (or `OBELISK_APP_NAME`) falls outside this
range. Apps deployed with `obelisk cloud` must also fit the cloud rule: 4-20 characters, no double
hyphens, and unique within the cloud environment. The app name selects the default SQLite directory,
so a renamed app starts with a new database unless `server.toml` sets the database directory
explicitly.

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
grants still have to exist. It does not bypass the app or platform policy. Variables interpolated
with `${...}` into `app.toml` `[[outbound_http.allowed_host]]` rules are not tolerated: verification
fails while they are unset, so CI must supply them, for example as placeholder URLs. A missing
variable in a deployment `allowed_host` rule only skips that rule with a warning.

`server run` and `server verify` discover `./app.toml` when `--app-config` is omitted. An explicit
path takes precedence. Without either an explicit file or discovered file, built-in app defaults
apply and the app name must come from `OBELISK_APP_NAME`. Startup fails when `OBELISK_APP_NAME` and
`app_name` are both set and differ; unset the stale variable.

`--api-url` of the direct API commands (`deployment`, `execution`, `component`, `admin`) no longer
has the `-a` shorthand, which now always means `--app-config`. Replace `-a <URL>` with
`--api-url <URL>` or set `OBELISK_API_URL`.

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

## Move gRPC clients to REST

The deprecated gRPC and gRPC-web API and `proto/obelisk.proto` have been removed. Port any client
generated from the proto file to the {{ doc_link(title="REST API", path="access/api.md") }}, served
on the same `api.listening_addr`. The CLI and the Web UI already use REST. OTLP trace export over
gRPC is unaffected.

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

`api.token_hashes` is read once at startup: adding or revoking a hash in `server.toml` requires a
restart. Earlier 0.43 release candidates reloaded the file live and emitted
`api.token_hashes_loaded` and `api.token_hashes_changed` system events; both are gone. OIDC signing
keys are still refreshed while the server runs.

Platforms running several apps can set
{{ doc_link(title="`app_env_prefix`", path="configuration/server.md#app-environment-prefix") }} in
`server.toml`; app public env and env-backed secrets are then read only from the prefixed variable
names.

## Simplify app URLs and outbound HTTP rules

Apps whose components call their own server's API or link to its Web UI no longer need the operator
to supply those URLs. Replace env-backed declarations with
{{ doc_link(title="internal public environment", path="configuration/app.md#internal-public-environment") }}
entries:

```toml
[public_env]
OBELISK_API_URL = { type = "internal", source = "api-url" }
OBELISK_WEBUI_URL = { type = "internal", source = "webui-url" }
```

The server resolves them from its own listeners and ignores process variables of the same name. Set
`webui.public_url` in `server.toml` when the Web UI is reached through a proxy, so browser links use
the public address. Drop the corresponding variables from run scripts, `.env` files, and cloud
environments; `cloud app fill` skips internal entries.

Outbound HTTP rules in `app.toml` and deployments accept `url_prefix` with an optional
`url_regex_suffix` instead of `pattern` and `request_url_regex`. Apps that needed separate
environment variables for the host pattern, the request regex, and the path can derive everything
from a single URL variable:

```toml
# Before: three related variables, kept consistent by hand.
[[outbound_http.allowed_host]]
pattern = "${LLM_HOST}"
methods = ["POST"]
request_url_regex = "^POST ${LLM_URL_REGEX}${LLM_PATH}"

# After: one URL variable, matched literally.
[[outbound_http.allowed_host]]
url_prefix = "${LLM_URL}"
methods = ["POST"]
url_regex_suffix = "/v1/chat/completions$"
```

Environment variables expand before the prefix is regex-escaped. A trailing slash is kept and
matched literally, so `https://host/repos/` does not match `/repos-other`; a bare origin matches any
path. The prefix must be an absolute HTTP(S) URL without credentials, query, fragment, or wildcards;
keep `pattern` for wildcard hosts. The suffix is appended as a regex group, must not start with `^`,
and should end with `$` to allow exactly one endpoint; without it, any continuation of the prefix
matches. An entry cannot mix the two forms. See
{{ doc_link(title="URL prefix rules", path="configuration/deployment.md#url-prefix-rules") }}.

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

System-event retention requests must explicitly include `dry_run`: use `true` to preview and `false`
to delete. Omission returns HTTP 422 without deleting events; the CLI already supplies it.
Retention never deletes events of the current node run.

Each deployment start or switch records one `deployment.policy.applied` system event instead of
per-component `component.http_policy.applied` and `component.secret_exposure.authorized` events.
Its details hold every component's HTTP policy and secret exposure. `outbound_http.denied` links to
it through `policy_event_id`, replacing `component_policy_event_id` and
`server_configuration_event_id`. The `server.configuration.resolved` snapshot format is now
`obelisk-server-configuration-v3` and includes the full `app_policy`.

Use the 0.43 CLI with servers version 0.42 or newer. Replay responses must include
`replayed_event_count`, `replay_duration_ms`, and `replay_version`; structured
missing-runtime-config responses must include `optional_public_env` and `required_public_env`. The
CLI no longer supplies compatibility defaults for these fields. Replay failure details remain
optional.

`GET /v1/info` returns the app name, `app_env_prefix`, Obelisk version, deployment ID, node run ID,
app config digest, and start time. `GET /v1/admin/node-run-id` is deprecated and will be removed
after 0.43; read `node_run_id` from `/v1/info` instead.

`GET /v1/app-config` and `GET /v1/app-config-digest` are deprecated and will be removed after 0.43.
Read the policy from `GET /v1/app-policy` (JSON, or TOML with `Accept: application/toml`), which
returns the policy object directly instead of wrapping it in `{ app_config_digest, policy }`, and
read `app_config_digest` from `GET /v1/info`.

In Boa and V8 activities and webhooks, `fetch` reports the canonical `Response.statusText` for the
status code, not the reason phrase sent by the server. A webhook `Response` accepts
`options.statusText`, which must be a valid reason phrase.

In JS webhooks, `fetch` resolves once the response headers arrive and exposes the body as a stream,
and a handler can return a streaming `Response`. JS activity `fetch` does not stream the body yet;
it still reads the whole body before resolving. See
{{ doc_link(title="JS webhooks", path="js/js-webhooks.md#streaming-responses") }}.
`[webhooks] request_timeout` now limits only the time until the response headers are returned, for
every webhook kind. Handlers that stream for longer than the timeout are no longer cut off.

`GET /v1/execution-id` and `GET /v1/deployment-id` are deprecated. Generate execution IDs locally,
for example with `obelisk generate execution-id`, and read `deployment_id` from `GET /v1/info`.
Clients polling responses, logs, or statuses can switch to the `follow=true` streams and
`POST /v1/executions/status/batch` described in
{{ doc_link(title="REST API", path="access/api.md#following-pages") }}.

Boa and V8 webhooks no longer receive automatic `__OBELISK_JS_SOURCE__` or
`__OBELISK_JS_FILE_NAME__` environment variables. Pass application metadata through deployment
`env_vars` when needed. Module loading still uses the module graph in both runtimes.

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

## Cron overlap and lock extension

Cron entries accept `overlap`. The default, `"skip"`, skips a tick while the execution submitted by
the previous tick is unfinished. Earlier releases submitted on every tick; set `overlap = "allow"`
to keep that behavior. See {{ doc_link(title="Cron", path="concepts/cron.md#overlapping-runs") }}.

Lock extension now renews the lock once half of `exec.lock_expiry` has elapsed.
`exec.lock_extension_leeway` is still accepted but ignored with a warning; remove it.

## Server checkpoints

Each successful activation now stores the app policy and deployment ID together as one checkpoint.
`obelisk server checkpoint` prints it as JSON without starting the server. `server run` and
`server verify` accept `--deployment-id` to select a stored deployment instead of a file; `run`
activates it, `verify` checks it without activation. See
{{ doc_link(title="CLI", path="access/cli.md#reading-the-app-checkpoint") }}.

## Deployment reuse and cloud commands

`deployment submit`, `apply`, and `enqueue` reuse the active deployment when its parsed content and
description match. Changing or removing the description creates a new deployment; explicit
deployment IDs are honored. Scripts must tolerate a successful submission returning an existing ID.

New {{ doc_link(title="`cloud` commands", path="access/cli.md#cloud-commands") }} manage apps,
tokens, policy, environment variables, and secrets. App-scoped commands, including `deployment`,
`execution`, `component`, and `admin`, live under `cloud app`, and `--app` is an option of
`cloud app`. Select an app with `--app`, `OBELISK_APP_NAME`, or `app_name` in `./app.toml`.
`cloud app deploy` publishes a local project in one step.

Scripts written against earlier 0.43 release candidates must be updated:

- `cloud app start` and `cloud app stop`, later named `reactivate` and `deactivate`, are now
  `cloud app enable` and `cloud app disable`.
- `cloud app status` shows the staged and applied revisions and compares the local `app.toml` with
  the staged one; `apply` applies a staged revision.
- App names starting with `system-` or `integrations-` are reserved.
- Public environment variables bound in `[cloud.integrations]` receive their value from the cloud
  and are never prompted for. See
  {{ doc_link(title="Cloud Integrations", path="configuration/app.md#cloud-integrations") }}.
- Missing required env vars and secrets fail in the client. `cloud app new`, `deploy`, and `apply`
  take `--fill` (prompts) or `--fill-non-interactive` (reads same-named environment variables);
  `cloud app fill` takes `--non-interactive`.
- `fill` and `apply` compare `./app.toml` (or `-a`) with the staged configuration and prompt, or
  fail without a terminal, when they differ. Pass `--staged` to use the staged configuration.
  `apply` sends the staged configuration and the enqueued (or active) deployment explicitly.
- `--api-url` (`OBELISK_CLOUD_API_URL`) defaults to `https://cloud.obeli.sk`. App endpoints are
  derived locally from `--apps-domain` (`OBELISK_CLOUD_APPS_DOMAIN`, default `obelisk.works`):
  `<app>.<domain>`, `api--<app>.<domain>`, and `webui--<app>.<domain>`.
- `cloud token new` requires `--token-file` and saves the server-issued token to that new private
  file. Token names are unique per account until revoked; after a lost creation response, revoke the
  inaccessible token before creating a replacement.
- `cloud app env set`, `secrets set`, and `fill` accept names starting with `OBELISK_`.
- Cloud app names are limited to 4-20 characters without double hyphens and are unique within each
  cloud environment. An interactive `cloud app deploy` offers an alternative for a taken name.
- `cloud app new` no longer takes a positional name; use `cloud app --app <NAME> new`.
- Cloud app commands refuse an app config naming a different app than `--app` or
  `OBELISK_APP_NAME` when it is passed with `-a` or required by `stage` and `deploy`. `stage` and
  `deploy` discover `./app.toml` like `fill` and `apply`, and `status` accepts `-a`.

## Verification checklist

- Check every `app_name` against the 4-25 character rule, and cloud app names against the 4-20
  character rule.
- Audit all authored deployments for generated metadata and all verification invocations for removed
  flags.
- Run `server verify` for every deployment against each applicable app/server configuration.
- Run the repository's CI commands with the target release, regenerate required artifacts, and check
  for tracked drift.
- Keep cross-repository OCI dependencies pinned and remove self-references when building the same
  repository locally.
- Replace gRPC clients with REST and `/v1/app-config` reads with `/v1/app-policy` and `/v1/info`.
- Consider internal public environment entries for the server's own API and Web UI URLs, and
  `url_prefix` rules for single-URL destinations.
- Update cloud scripts for renamed lifecycle commands and explicit fill flags.
- Decide `overlap` for each `[[cron]]` entry and remove `exec.lock_extension_leeway`.
- Replace `GET /v1/execution-id` and `GET /v1/deployment-id` calls.
- Review app/server policy diffs, authentication (including internal secrets for self-API tokens and
  restart-only token hash changes), stdout consumers, REST requests, and optional WIT regeneration.
