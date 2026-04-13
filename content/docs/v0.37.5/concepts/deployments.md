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
- The full **configuration JSON** derived from your `deployment.toml`, including component locations,
  allowed hosts, environment variable keys, retry settings, cron schedules, and (for JS components)
  the JS source code itself.
- The **status**: `enqueued`, `active`, or `inactive`.
- Timestamps (`created_at`, `last_active_at`).

Because the JS source is stored inside the deployment, the server can  provide it
to the time-travel debugger for any historical
execution exactly as it ran — even after the component has been updated.

## Execution - Deployment relationship

Every execution carries a reference to the Deployment that was active when it was locked for
processing. This means:

- You can filter executions by `deployment_id` in the Web API or Web UI.
- Replay and upgrade operations know exactly which component version handled each event.
- Hot redeploy (see below) switches activity and webhook work to the new deployment immediately,
  while in-flight workflow executions become pending until explicitly upgraded to the new component version.

## Deployment lifecycle

* **Enqueued** — The deployment is marked as the next one to activate. It will become active on the
   next server restart (or immediately via hot-redeploy).
* **Active** — The server is running with this deployment. New executions reference this Deployment ID.
* **Inactive** — Any new or old deployment stored in the database.

Only zero or one deployment can be `enqueued` and one can be `active` at any given time.

## Hot redeploy

Hot redeploy activates a new deployment **without restarting the server**. The behavior differs by
component type:

- **Activities** — Pending activity executions start running on the newly deployed activity workers
  transparently. Activity executors lock executions with currently-active FFQNs, so any pending
  execution is immediately eligible to be picked up by the new worker.
- **Workflows** — Workflow executors lock executions by component digest (computed from the WASM or JS
  source). When the deployment changes, no executor works on executions assigned to the old digest,
  so they become pending. An explicit upgrade is required to migrate them to the new component
  version (see [Upgrading workflow executions](#upgrading-workflow-executions) below).
- **Webhooks** — Existing TCP connections continue to be served by the old deployment. New
  connections use the new deployment.

Hot redeploy is triggered via:

```sh
obelisk deployment apply <PATH|ID>           # CLI: submit + hot-redeploy
```

or via the Web API:

```sh
curl "127.1:5005/v1/deployments/Dep_.../switch" \
  -H content-type:application/json -X PUT -d '{"hot_redeploy": true}'
```

If a configuration change cannot be applied hot (e.g. a component that requires a full restart),
the API returns `"restart_required"` and the deployment is enqueued for the next startup.

## Upgrading workflow executions

When you update a workflow component, existing in-flight executions still reference the old
component digest. To migrate them to the new version use the upgrade API:

```sh
OLD=$(curl "127.1:5005/v1/executions/${EXECUTION_ID}/status" -H accept:application/json | jq .component_digest)
NEW=$(curl '127.1:5005/v1/components?name=my_workflow' -H accept:application/json | jq .[0].component_id.input_digest)

curl "127.1:5005/v1/executions/${EXECUTION_ID}/upgrade" \
  -H content-type:application/json -X PUT \
  -d "{\"old\": $OLD, \"new\": $NEW}"
```

The RPC replays the execution history against the new component and refuses to switch if the new workflow code is not replay-compatible — unless `skip_determinism_check` is set to `true`.

## Managing deployments

**CLI:**

| Command | Description |
|---------|-------------|
| `obelisk deployment submit <PATH>` | Store a deployment TOML; print the new ID |
| `obelisk deployment enqueue <PATH\|ID>` | Submit (if path) and enqueue for next restart |
| `obelisk deployment apply <PATH\|ID>` | Submit (if path) and hot-redeploy immediately |
| `obelisk deployment list` | List recent deployments and their status |
| `obelisk deployment show <ID>` | Show full configuration of a deployment |

**Web API:** see
{{ doc_link(title="Programmatic Access — Deployments", path="programmatic-access.md") }}.

**gRPC:** see the `DeploymentRepository` service in
{{ github(title="proto/obelisk.proto", path="proto/obelisk.proto") }}.
