+++
title = "Obelisk 0.32: Cancellation, WebAPI, Postgres"
date = 2025-12-29
+++


<!-- more -->

## Cancellation

As discussed in the [previous announcement](@/blog/2025-10-06-announcing-obelisk-0-25-4.md),
each function invoked by Obelisk, whether a workflow or an activity, must be fallible.
As of `v0.29.0` this includes {{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md", version="v0.32.1") }} as well.
This enabled not only cancellation of
activities and delay requests, but also a clean way of handling cancellation in the workflows:

```rs
workflow_support::sleep(ScheduleAt::In(SchedulingDuration::Seconds(10)))
    .map_err(|()| MyWorkflowError::Cancelled)?;
some_activity::send_request()
    .map_err(|()| MyWorkflowError::Cancelled)?; // Handle cancellation and running out of retry attempts.
```

Cancellation is performed either by using {{ github(title="gRPC", path="proto/obelisk.proto", version="v0.32.1") }}
or the WebAPI discussed below.

The only way to cancel a workflow is to cancel its "leafs" - activites and delay requests. Some
workflow engines support workflow cancellation, but the act of stopping workflow at the next step
is not compatible with cleanup / compensating actions required for distributed sagas.

Obelisk only supports cooperative cancellation of workflows, which in turn makes writing compensating actions natural:

```rs
fn app_init(
    org_slug: String,
    app_name: String,
    obelisk_config: ObeliskConfig,
    init_config: AppInitConfig,
) -> Result<(), AppInitError> {
    // Launch sub-workflows by using import.
    // In case of any error including a trap (panic), delete the whole app.
    workflow_import::prepare_volume(...)
        .map_err(|err| cleanup(...))?;

    workflow_import::wait_for_secrets(...)
        .map_err(|err| cleanup(...))?;

    workflow_import::start_final_vm(...)
        .map_err(|err| cleanup(...))?;

    workflow_import::wait_for_health_check(...)
        .map_err(|err| cleanup(...))?;

    Ok(())
}
```
<a target="_blank" href="https://github.com/obeli-sk/obelisk-deploy-flyio/blob/04e886ad0eb1e8eb40b0e0456813b7b3367361d6/workflow/deployer-workflow/impl-flyio/src/lib.rs#L575-L612">source: obelisk-deploy-flyio</a>

The `app-init` workflow calls several child workflows, each calling an HTTP activity or sleep.

It does not matter whether one of the child workflows or underlying activities failed due to requests being rejected, a panic,
or due to a cancellation request. The error will propagate and the top level workflow will call `cleanup`, providing all-or-nothing semantics.

## WebAPI

Obelisk server listens by default on port `5005`, where previously it only served gRPC and gRPC-Web traffic.
As of `v0.31.0` this port handles text-over-HTTP as well:

```sh
curl 127.1:5005/v1/executions
```
```
E_01KDJH6F811F2E0Q7AC4PDR9WE `Finished(ok)` obelisk-flyio:workflow/workflow@1.0.0-beta.app-init `23 hours ago`
E_01KDG3JFCGDEM4E6MKD3M8QCS8 `Finished(execution completed with an error)` obelisk-flyio:workflow/workflow@1.0.0-beta.app-init `yesterday`
...
```
JSON output is supported as well:
```sh
curl 127.1:5005/v1/executions -H 'accept: application/json'
```
```json
[
  {
    "execution_id": "E_01KDJH6F811F2E0Q7AC4PDR9WE",
    "ffqn": "obelisk-flyio:workflow/workflow@1.0.0-beta.app-init",
    "pending_state": {
      "status": "Finished",
      "version": 16,
      "finished_at": "2025-12-28T13:09:50.226429459Z",
      "result_kind": "ok",
      "component_id_input_digest": "sha256:b2ee4bdf32367e5d4eaf3643b95b9d7261996a5fe03582bff58cc59a884dc29b"
    },
    "created_at": "2025-12-28T13:08:38.274234577Z",
    "first_scheduled_at": "2025-12-28T13:08:38.274234577Z",
    "component_digest": "sha256:b2ee4bdf32367e5d4eaf3643b95b9d7261996a5fe03582bff58cc59a884dc29b"
  },
  ...
```

## PostgreSQL

Obelisk has supported SQLite from day one. It is great for local development and for certain kinds of deployments, where
a few seconds of downtime during redeployment is acceptable.Backup and restore are handled by Litestream.
This allows Obelisk to be deployed to hundreds of VMs without sharing anything except an S3-compatible endpoint for backups.

One caveat of asynchronous replication, however, is that during a VM crash, the last few seconds of committed transactions may be lost.

Postgres support addresses both issues and is likely one of the most popular choices for more traditional deployments.
It also enables multi-node deployments, where the
WASM components can be split across VMs that can be dynamically scaled based on load.

PostgreSQL can be {{ doc_link(title="configured", path="configuration.md", version="v0.32.1") }} in the `obelisk.toml`.