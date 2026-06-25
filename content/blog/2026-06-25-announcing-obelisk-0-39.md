+++
title = "Obelisk 0.39: Reconstructable Deployments and Safer Deployment APIs"
date = 2026-06-25
+++

Obelisk 0.39 makes deployments easier to inspect, reproduce, and move between environments. The
server now stores the submitted `deployment.toml` together with deployment-owned source files, can
reconstruct a deployment back to disk, and verifies deployment packages before they are persisted.

<!-- more -->

## Deployment Source of Truth

In previous releases, deployment storage was centered on the resolved configuration. In 0.39, the
stored source of truth is the submitted `deployment.toml`. Local JS files, exec activity scripts,
and configured backtrace source files are stored as deployment-owned blobs in a content-addressed
store.

That changes the operational model in two useful ways:

- `obelisk deployment show <ID>` prints the stored `deployment.toml`, preserving formatting and
  comments, or a single stored source file when you pass a deployment-relative path.
- `obelisk deployment get <ID> --output DIR` writes the stored `deployment.toml` and recreates the
  deployment-owned source files on disk.

This is especially helpful when debugging a remote deployment: the server has the manifest and
sources that belonged to the deployment, even if the active deployment has moved on.

## Deployment-Local Paths

For deployment-owned source files, relative paths are now resolved from the directory containing
`deployment.toml`. The old `${DEPLOYMENT_DIR}/` prefix still works for compatibility, but it is no
longer needed:

```toml
[[activity_exec]]
ffqn = "myapp:ops/run.task"
location = "scripts/run-task.sh"
params = [{ name = "payload", type = "string" }]
return_type = "result<string, string>"
```

Absolute paths and `..` escapes are rejected for JS and exec source files and for backtrace source
files. That keeps deployment packages self-contained and prevents a deployment from depending on
files outside its directory.

## Idempotent Deployment Submission

Deployment submission now accepts an optional client-supplied deployment ID:

```sh
DEPLOYMENT_ID=$(obelisk generate deployment-id)
obelisk deployment submit deployment.toml --deployment-id "$DEPLOYMENT_ID"
```

If the same ID and same deployment digest are submitted again, the operation is a no-op. If the ID
already exists with different content, the submit is rejected. This gives clients a straightforward
idempotency key for deployment automation.

The REST API can also accept multipart deployment packages:

```sh
curl "127.1:5005/v1/deployments" -X POST \
  -F deployment_toml=@deployment.toml \
  -F 'file=@scripts/run-task.sh;filename=scripts/run-task.sh'
```

Incomplete or invalid packages return `409 Conflict` with structured details, and no deployment is
stored. That is an important safety property: a failed submit does not leave behind a deployment row
that references missing files.

## CLI Additions

The deployment CLI gained a few inspection commands:

```sh
obelisk deployment active
obelisk deployment show Dep_...
obelisk deployment show Dep_... scripts/run-task.sh
obelisk deployment get Dep_... --output recovered
obelisk deployment gc
```

The `generate` subcommands now consistently use `--force` for overwriting generated files. The old
`--overwrite` flag has been replaced.

## API Notes

Deployment and execution list APIs expose more deployment metadata, including component summaries
where requested. Structural REST endpoints default to JSON output, while raw identifier and
file-like endpoints such as `/v1/execution-id`, `/v1/deployment-id`, WIT, and backtrace source
endpoints still default to text.

The top-level JSON error shape is `{ "err": ... }` again. If you integrated against the brief
`{ "error": ... }` shape, update clients before upgrading.

## Exec Activity Details

Exec activities gained `params_via_stdin = true`, which passes parameters through stdin instead of
command-line arguments. Use it when parameters may exceed operating system argument-size limits.

Exec secrets are also nested under `secrets` in stdin:

```json
{ "params": ["payload"], "secrets": { "API_TOKEN": "..." } }
```

Code that previously read secrets from the top-level stdin object should switch to the `secrets`
field.

For complete reference material, see the updated {{ doc_link(title="CLI", path="cli.md") }},
{{ doc_link(title="Configuration", path="configuration.md") }}, and
{{ doc_link(title="Programmatic access", path="programmatic-access.md") }} docs.
