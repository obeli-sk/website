+++
title = "Execution States"
template = "docs.html"
weight = 12
+++

Every execution in Obelisk is in exactly one **pending state** at any given time. The pending state
drives the scheduler — it determines whether an execution can be picked up by an executor, is
waiting for an external event, or has finished.

## States

| State                | Description                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PendingAt**        | The execution is ready to be picked up by an executor at (or after) the specified time. A newly created execution starts in this state.                                                                                                          |
| **Locked**           | An executor has acquired the execution and is actively running it. The lock has an expiry time; if the executor crashes or fails to renew the lock, the execution becomes pending again after the lock expires.                                  |
| **BlockedByJoinSet** | The execution called `-await-next` or `join-next` and is waiting for a response in a {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }}. No executor can pick it up until a response arrives.                              |
| **Paused**           | The execution has been explicitly paused via the CLI or API. A paused execution retains its underlying state (PendingAt or BlockedByJoinSet) and resumes from that state when unpaused. Activities can be paused between runs, not while locked. |
| **Cancelling**       | Cancellation has been requested. An activity is being stopped, or a cancellable workflow is closing its join sets without advancing its WASM again.                                                                                              |
| **Finished**         | The execution has completed — either successfully, with an application error, or due to a terminal failure (timeout, cancellation, nondeterminism). This is a terminal state.                                                                    |

## State Machine

The diagram below shows all valid state transitions. Each arrow is labeled with the
{{ doc_link(title="execution log", path="concepts/execution-log.md") }} event that triggers the
transition.

```text
                         +------------------------------------------------------+
                         |                                                      |
 +----------+  Locked    |  +--------+                                          |
 | PendingAt|------------|->|Locked  |                                          |
 +--+---^---+            |  +--+--+--+                                          |
    |   |                |     |  |                                             |
    |   |  Unlocked /    |     |  |  HistoryEvent(JoinNext)   +--------------+  |
    |   |  TemporarilyFailed / |  +-------------------------->|BlockedByJoin |  |
    |   |  TemporarilyTimedOut |                              |    Set       |  |
    |   |  / lock expired |    |                              +--+-----------+  |
    |   +-----------------|----|                                 |              |
    |                     |                       response       |              |
    |                     |         +--------------arrives-------+              |
    |                     |         |  (becomes PendingAt)                      |
    |                     |         |                                           |
    |   Finished          |         |  Finished                    Finished     |
    |   +-----------------|---------|-----------------------------------------+ |
    |   |                 |         |                                         | |
    v   v                 |         v                                         v |
 +----------+             |                                                     |
 | Finished |             |                                                     |
 +----------+             |                                                     |
                          |         Paused / Unpaused                           |
                          |  (overlays any non-Finished state)                  |
                          +-----------------------------------------------------+
```

### Transitions in Detail

#### Created → PendingAt

When an execution is first submitted (via CLI, API, or as a child of another execution), a `Created`
event is appended and the execution enters **PendingAt** with the requested schedule time. If
`scheduled_at` is in the future, the execution will not be picked up until that time.

#### PendingAt → Locked

An executor acquires the execution by appending a `Locked` event. The lock has an expiry time
(`lock_expires_at`). While locked, the executor runs the WASM component. Only the original executor
(identified by `executor_id` and `run_id`) can extend its own lock.

#### Locked → PendingAt

This transition happens in several scenarios:

- **Unlocked**: The executor voluntarily releases the execution (e.g., shutting down or resource
  limits reached). The execution becomes pending at `backoff_expires_at`.
- **TemporarilyFailed**: An activity encountered a retryable error. The execution becomes pending
  after an exponential backoff period.
- **TemporarilyTimedOut**: An activity timed out but still has retries remaining. Same backoff
  behavior as TemporarilyFailed.
- **Lock expired**: If the executor crashes without appending any event, other executors can acquire
  the execution after the lock expires.

#### Locked → BlockedByJoinSet

When a workflow calls `-await-next` or `join-next` and no response is available yet, a
`HistoryEvent(JoinNext)` event is appended. The execution transitions to **BlockedByJoinSet**,
meaning it cannot be picked up by any executor until a response arrives in the specified join set.

The `JoinNext` event carries a `run_expires_at` field. Until that time, the original executor may
keep the WASM instance warm in memory, waiting for the response. After expiry, any executor can pick
up the execution.

#### BlockedByJoinSet → PendingAt

When a response arrives in the join set (a child execution finishes or a delay expires), the
execution becomes **PendingAt**. The scheduled time is `max(lock_expires_at, response_time)`, giving
the original executor a chance to continue without replay if it is still holding the instance warm.

#### Any non-Finished state → Finished

A `Finished` event can be appended from **Locked** state (normal completion), or forced from any
non-finished state during cancellation. The execution enters the terminal **Finished** state.

Finished results are classified as:

- **Ok** — the function returned successfully.
- **Error** — the function returned an application-level error.
- **ExecutionFailure** — a terminal failure: `TimedOut` (activity exceeded max retries),
  `NondeterminismDetected` (workflow replay diverged), `Cancelled` (explicitly cancelled), or
  `OutOfFuel`.

#### Paused / Unpaused

A `Paused` event can be appended to an execution that is not finished or cancelling. It wraps the
current underlying state. The execution will not be picked up by any executor while paused. An
`Unpaused` event restores the underlying state.

Activities can be paused only between runs, when they are not locked by an executor. A running
activity should be cancelled if it must be interrupted. Workflows may be paused before their next
run; if a workflow currently holds a lock, Obelisk first releases that run and then records the
pause.

#### CancellationRequested / Cancelling

`CancellationRequested` moves an activity or cancellable workflow into **Cancelling**. A cancelling
activity is interrupted and finishes with `ExecutionFailure::Cancelled`. A cancellable workflow is
not advanced again; the cancellation driver tears down its join sets and, once teardown completes,
the workflow finishes with `ExecutionFailure::Cancelled`. See
{{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }} for the
teardown rules.

## Retry Behavior

When an activity fails temporarily (`TemporarilyFailed` or `TemporarilyTimedOut`), Obelisk applies
exponential backoff. The backoff duration is:

```
retry_exp_backoff × 2^(temporary_event_count - 1)
```

where `temporary_event_count` is the number of `TemporarilyFailed` and `TemporarilyTimedOut` events
in the execution log. If `max_retries` is configured and the count exceeds it, no further retries
are attempted and the execution finishes with an `ExecutionFailure::TimedOut` error.

Workflows are retried forever — they do not have a `max_retries` limit.

## Inspecting Execution State

The current pending state is returned by the REST API. Export `OBELISK_API_TOKEN` as described in
{{ doc_link(title="Authentication", path="access/authentication.md") }} first:

```sh
# List executions with their pending states
curl -H 'Accept: application/json' -H "Authorization: Bearer $OBELISK_API_TOKEN" \
  http://127.0.0.1:5005/v1/executions

# Get a specific execution
curl -H 'Accept: application/json' -H "Authorization: Bearer $OBELISK_API_TOKEN" \
  http://127.0.0.1:5005/v1/executions/{id}
```

The pending state is also visible in the Web UI execution list and detail views.
