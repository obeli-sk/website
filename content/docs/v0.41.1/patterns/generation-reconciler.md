+++
title = "Generation Reconciler for Long-Running Workflows"
template = "docs.html"
weight = 20
+++

Long-running workflows accumulate durable history and may remain attached to an older component
after a deployment changes their code. Use a short-lived recurring reconciler to manage them as
deployment generations: keep one current workflow for each logical key, cancel obsolete or duplicate
workflows, and start missing ones.

This pattern is useful for monitors, consumers, pollers, and other services represented by durable
workflows that should run continuously but do not need one execution to live forever.

## Topology

The pattern has two workflow roles:

1. A **finite reconciler** runs periodically from a cron task. It inspects current control-plane
   state, makes the desired generation match reality, and finishes.
2. A **managed workflow** performs the long-running work. Its FFQN ends in `-cancellable`, making it
   safe for the reconciler to retire when a replacement is needed.

```text
periodic cron
    |
    v
finite reconciler ---- list/retire through control-plane activity
    |
    +---- schedule key A, current deployment ----> managed workflow A-cancellable
    +---- schedule key B, current deployment ----> managed workflow B-cancellable
```

The reconciler itself is not long-running. Deploying new reconciler code therefore does not require
upgrading or cancelling an old reconciler execution: old runs have already finished, and the next
cron tick uses the active deployment.

## Reconciliation algorithm

Each run determines its own `deployment-id` from its execution record, then lists unfinished managed
workflows by FFQN prefix. For each logical key:

- Keep the newest workflow whose `deployment-id` matches the reconciler's deployment.
- Cancel workflows from older deployments.
- Cancel duplicate workflows from the current deployment.
- Start a current workflow when none remains.

The logical key might be a repository, tenant, queue, device, or any other stable identity found in
the managed workflow's creation parameters.

```javascript
import { listDesiredKeys, reconcileWorkers } from "example:control/workers";

const WORKER_FFQN = "example:service/worker.run-cancellable";

export default function reconcile() {
  const current = JSON.parse(reconcileWorkers(obelisk.executionIdCurrent()));
  let started = 0;

  for (const key of listDesiredKeys()) {
    if (!Object.hasOwn(current, key)) {
      obelisk.schedule(obelisk.executionIdGenerate(), WORKER_FFQN, [key]);
      started += 1;
    }
  }

  return `kept ${Object.keys(current).length}; started ${started}`;
}
```

`reconcile-workers` is an activity rather than workflow code because querying and mutating the
Obelisk control plane are non-deterministic I/O. It receives the reconciler's execution ID, reads
that execution's creation event to find the current deployment, and returns the retained
`key -> execution-id` map.

The activity should perform retirement idempotently. Treat an already terminal execution as success,
and tolerate a repeated cancellation request. A later cron tick repairs partial progress after a
transient failure.

## Configuration

Run the reconciler periodically and mark the managed workflow cancellable:

```toml
[[workflow_js]]
name = "reconciler"
location = "workflow/reconcile.js"
ffqn = "example:service/reconciler.run"
return_type = "result<string, string>"

[[workflow_js]]
name = "worker"
location = "workflow/worker.js"
ffqn = "example:service/worker.run-cancellable"
params = [{ name = "key", type = "string" }]
return_type = "result<string, string>"

[[cron]]
name = "worker_reconcile"
ffqn = "example:service/reconciler.run"
schedule = "* * * * *"
```

The control-plane activity needs narrowly scoped access to the Obelisk API. Allow only the required
host and methods, and inject the API token through a secret header binding. Listing requires `GET`;
retirement requires `PUT` to the cancellation endpoint. Do not put a real token in workflow
parameters or execution history.

## Why cancellation matters

A workflow can be cancelled externally only when its FFQN ends in `-cancellable`. Cancellation
closes its join sets recursively, cancelling pending activities, delays, stubs, and cancellable
child workflows. The cancelled execution remains in durable history as a terminal record; the
pattern retires work, not audit history.

Only use the suffix when abrupt workflow termination is safe. If the managed workflow owns an
external resource that needs compensation, put it under a non-cancellable cleanup supervisor and
cancel a child as described in
{{ doc_link(title="Cleanup supervisor", path="patterns/cleanup-supervisor.md") }}.

## Bounded histories and self-updating code

The managed execution's history is bounded by its deployment generation instead of growing for the
entire lifetime of the service. After a code deployment, the next reconciliation cancels old workers
and starts fresh ones from the new component. This avoids relying on replay compatibility for
arbitrary long-lived histories.

Normal restarts within one deployment do not replace healthy workflows. The reconciler retains their
execution IDs, so durable sleeps and pending mailbox offers continue normally.

## Races and migration

Reconciliation must tolerate overlap. If two runs briefly race and both start the same key, the next
run keeps the newest current workflow and cancels the duplicate. Keep the reconciliation interval
longer than its normal execution time to make this uncommon.

An existing workflow whose FFQN lacks `-cancellable` cannot be cancelled through the workflow
cancellation endpoint. During migration, pause such legacy executions and switch all new managed
workflows to the cancellable FFQN. Paused legacy executions remain visible for audit purposes but no
longer consume work.
