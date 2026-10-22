+++
title = "Deployments"
template = "docs.html"
weight = 11
+++

A **Deployment** is a versioned snapshot of your component configuration — the set of activities,
workflows, webhook endpoints, and cron tasks that Obelisk should run. Every time you push a new
`deployment.toml` to the server, Obelisk stores it as a new Deployment record in the database.

## What a Deployment stores

Each Deployment record contains:

- A unique **Deployment ID** (e.g. `Dep_01KN1NK9A6NMHP31TVJ875X599`).
- The verbatim **`deployment.toml`** submitted by the client.
- Deployment-owned source files referenced by JS components, exec activities, and backtrace source
  maps, stored in a content-addressed file store.
- A deployment digest, computed from the stored manifest.
- The **status**: `enqueued`, `active`, or `inactive`.
- Timestamps (`created_at`, `last_active_at`).

Because the manifest is stored verbatim and deployment-owned sources are stored with it, the server
can recreate a deployment directory and provide source context to replay, advance, logs, and
backtrace inspection even after the active deployment has moved on.

## Execution - Deployment relationship

Every execution carries a reference to the Deployment that was active when it was locked for
processing. This means:

- You can filter executions by `deployment_id` in the Web API or Web UI.
- Replay and upgrade operations know exactly which component version handled each event.
- Hot redeploy (see below) switches activity and webhook work to the new deployment immediately,
  while in-flight workflow executions are replayed and upgraded automatically when using the default
  `auto` locking strategy.

## Deployment lifecycle

- **Enqueued** — The deployment is marked as the next one to activate. It will become active on the
  next server restart (or immediately via hot-redeploy).
- **Active** — The server is running with this deployment. New executions reference this Deployment
  ID.
- **Inactive** — Any new or old deployment stored in the database.

Only zero or one deployment can be `enqueued` and one can be `active` at any given time.

On startup, `server run` activates the file passed with `--deployment`, the stored deployment
selected with `--deployment-id`, or else the enqueued deployment, falling back to the active one.
`server verify --deployment-id` checks a stored deployment without activating it.

## App checkpoint

Each successful activation, at startup or through a hot redeploy, stores the running app policy and
the deployment ID together as one atomic checkpoint. `obelisk server checkpoint` prints the last
checkpoint as JSON without starting the server, so tooling can recover the exact policy and
deployment that last ran.

## Hot redeploy

Hot redeploy activates a new deployment **without restarting the server**. The behavior differs by
component type:

- **Activities** — Activities default to the `by_ffqns` locking strategy. Pending executions are
  selected by the currently active FFQNs and start running on the newly deployed activity workers
  transparently, without replay or an upgrade.
- **Workflows** — With the default `auto` locking strategy, in-progress executions are replayed
  against the current workflow component after redeployment. Compatible executions are upgraded and
  associated with the current deployment. If replay detects nondeterminism, the execution stays on
  its previous component version. With `by_ffqns`, executions are selected by the functions exported
  by the current component without an automatic component upgrade. With `by_component_digest`,
  executions remain pending until explicitly upgraded (see
  [Upgrading workflow executions](#upgrading-workflow-executions) below).
- **Webhooks** — Existing TCP connections continue to be served by the old deployment. New
  connections use the new deployment.

Hot redeploy is triggered via:

```sh
obelisk deployment apply <PATH|ID>           # CLI: submit + hot-redeploy
```

or via the Web API, after exporting `OBELISK_API_TOKEN` as described in
{{ doc_link(title="Authentication", path="access/authentication.md") }}:

```sh
curl "127.1:5005/v1/deployments/Dep_.../switch" \
  -H "Authorization: Bearer $OBELISK_API_TOKEN" \
  -H content-type:application/json -X PUT -d '{"apply": true}'
```

Use the `apply` field. The former `hot_redeploy` alias was removed in 0.42.

If a configuration change cannot be applied hot (e.g. a component that requires a full restart), the
API returns `"restart_required"` and the deployment is enqueued for the next startup.

## Upgrading workflow executions

The default `auto` locking strategy upgrades compatible in-flight workflow executions automatically.
If a workflow uses `by_component_digest`, existing in-flight executions continue to reference the
old component digest. To migrate one to the new version, use the upgrade API:

```sh
OLD=$(curl "127.1:5005/v1/executions/${EXECUTION_ID}/status" -H accept:application/json -H "Authorization: Bearer $OBELISK_API_TOKEN" | jq .component_digest)
NEW=$(curl '127.1:5005/v1/components?name=my_workflow' -H accept:application/json -H "Authorization: Bearer $OBELISK_API_TOKEN" | jq .[0].component_id.component_digest)

curl "127.1:5005/v1/executions/${EXECUTION_ID}/upgrade" \
  -H "Authorization: Bearer $OBELISK_API_TOKEN" \
  -H content-type:application/json -X PUT \
  -d "{\"old\": $OLD, \"new\": $NEW}"
```

The upgrade endpoint replays the execution history against the new component and refuses to switch
if the new workflow code is not replay-compatible, unless `skip_determinism_check` is set to `true`.

## Managing deployments

**CLI:**

| Command                                 | Description                                    |
| --------------------------------------- | ---------------------------------------------- |
| `obelisk deployment submit <PATH>`      | Store a deployment TOML; print the new ID      |
| `obelisk deployment enqueue <PATH\|ID>` | Submit (if path) and enqueue for next restart  |
| `obelisk deployment apply <PATH\|ID>`   | Submit (if path) and hot-redeploy immediately  |
| `obelisk deployment list`               | List recent deployments and their status       |
| `obelisk deployment active`             | Print the active deployment ID                 |
| `obelisk deployment show <ID> [FILE]`   | Show stored TOML or a stored file              |
| `obelisk deployment pull <ID>`          | Recreate deployment TOML and source files      |
| `obelisk deployment verify`             | Verify a local deployment without a server     |
| `obelisk server checkpoint`             | Print the last activated policy and deployment |

**Web API:** see {{ doc_link(title="API access", path="access/api.md") }}.

Unreferenced deployment file blobs are removed by automatic maintenance; see
{{ doc_link(title="Server Configuration", path="configuration/server.md#automatic-maintenance-and-retention") }}.
