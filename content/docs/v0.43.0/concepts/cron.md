+++
title = "Cron (Periodic Tasks)"
template = "docs.html"
weight = 35
+++

**Cron tasks** let you trigger a function on a repeating schedule or run it once when a deployment
becomes active. They are a first-class part of the deployment configuration — no extra
infrastructure is needed.

## Defining a cron task

Add one or more `[[cron]]` sections to your `deployment.toml`:

```toml
[[cron]]
name     = "daily-cleanup"
ffqn     = "myapp:tasks/jobs@1.0.0.daily-cleanup"
params   = '["archive", 30]'   # JSON array; defaults to []
schedule = "@daily"
```

| Field      | Type              | Required | Description                                                                   |
| ---------- | ----------------- | -------- | ----------------------------------------------------------------------------- |
| `name`     | string            | yes      | Unique name within the deployment                                             |
| `ffqn`     | string            | yes      | {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} of the function to call |
| `params`   | JSON array string | no       | Parameters passed to the function on every tick (default: `[]`)               |
| `schedule` | string            | yes      | Cron expression or named shorthand (see below)                                |
| `overlap`  | string            | no       | `"skip"` (default) or `"allow"`, see [Overlapping runs](#overlapping-runs)    |

## Schedule syntax

The `schedule` field accepts standard five-field cron expressions, six-field expressions whose
leading field adds seconds, or one of the named shorthands:

| Value           | Equivalent / Meaning                               |
| --------------- | -------------------------------------------------- |
| `@once`         | Run exactly once when the deployment is activated  |
| `@hourly`       | `0 * * * *` — at minute 0 of every hour            |
| `@daily`        | `0 0 * * *` — at midnight every day                |
| `@weekly`       | `0 0 * * 0` — at midnight every Sunday             |
| `@monthly`      | `0 0 1 * *` — at midnight on the 1st of each month |
| `@yearly`       | `0 0 1 1 *` — at midnight on 1 January             |
| `"*/5 * * * *"` | Every 5 minutes (custom expression)                |

Fields in a five-field cron expression are: `minute hour day-of-month month day-of-week`. A
six-field expression prepends a `second` field: `second minute hour day-of-month month day-of-week`.

## How it works

When a deployment becomes active, Obelisk creates a **cron scheduler execution** for each `[[cron]]`
entry. The scheduler runs as a long-lived internal workflow:

1. On each tick it computes the next scheduled time and persists the schedule to the execution log.
2. It sleeps until that time using a durable
   {{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}.
3. It submits the target function as a top-level execution with the configured `params`.
4. It loops back to step 1.

Because the scheduler is itself a durable execution, it survives server restarts and crashes without
missing ticks.

The `@once` shorthand submits the target function once immediately and then the scheduler execution
finishes.

## Overlapping runs

By default (`overlap = "skip"`), a tick does not submit the target while the execution submitted by
the previous tick is unfinished. The scheduler skips that tick and waits for the next scheduled
time, so a slow run is never joined by a second one. Set `overlap = "allow"` to submit on every tick
regardless of earlier runs.

```toml
[[cron]]
name     = "sync"
ffqn     = "myapp:tasks/jobs@1.0.0.sync"
schedule = "*/5 * * * *"
overlap  = "allow"
```

## Relationship to deployments

During server startup or a hot-redeploy, Obelisk hashes each `[[cron]]` entry's configuration —
`name`, `ffqn`, `params`, and `schedule` — with SHA-256 to produce a **content digest**. The digest
identifies the cron in a dedicated registration table that records its current scheduler execution
and its most recent submission. `overlap` is not part of the digest, so changing only `overlap`
keeps the existing registration.

Registration happens before cron executors start. A digest that is already registered is reused
as-is, so an unchanged cron entry survives restarts and redeployments without interruption. Most
notably, the cron will not fire again immediately after a redeploy: the next tick is computed from
where the existing scheduler left off. A new digest gets a new registration and a new scheduler
execution with an ordinary execution ID.

Cron entries that are **removed** from `deployment.toml` are left without an executor: their
registration and unfinished scheduler stay dormant until a future deployment includes a matching
cron configuration again, which resumes the schedule. A re-added `@once` that already submitted does
not fire again, even after retention has deleted both the scheduler and the target execution.

## Scheduler history and retention

A recurring scheduler does not grow forever. Once its execution log approaches 1,000 events
(including skipped ticks), the scheduler finishes and a new scheduler execution takes over at the
next tick, keeping the overlap state. Finished schedulers, and the scheduler of a submitted `@once`,
are removed by ordinary
{{ doc_link(title="execution retention", path="configuration/server.md#automatic-maintenance-and-retention") }};
the current scheduler of each registered cron is always protected.

Schedulers created by 0.43.0-rc.11 and earlier used deterministic execution IDs derived from the
digest. They are adopted on deployment activation with their pending time and history unchanged, and
roll over to ordinary IDs like any other scheduler.

## Viewing cron executions

Cron scheduler executions appear in the Web UI and via the API like any other execution. They use an
FFQN derived from the target: `obelisk:schedule/<name>.<target-function>-cron`.

```sh
obelisk execution submit --follow myapp:tasks/jobs@1.0.0.daily-cleanup '["archive", 30]'
```

You can also list all executions for a cron function after exporting `OBELISK_API_TOKEN` as
described in {{ doc_link(title="Authentication", path="access/authentication.md") }}:

```sh
curl "127.1:5005/v1/executions?ffqn_prefix=obelisk:schedule/" -H accept:application/json \
  -H "Authorization: Bearer $OBELISK_API_TOKEN"
```
