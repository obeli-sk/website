+++
title = "Execution Log"
template = "docs.html"
weight = 13
+++

Every execution in Obelisk maintains a persistent, append-only **execution log**. The log is the
single source of truth for the execution’s history: it records how the execution was created, every
lock acquisition, every child execution request, every result, and the final outcome.

The execution log enables two critical capabilities:

1. **Crash recovery** — after a restart, a
   {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }} is replayed from its log to
   reconstruct its state.
2. **Observability** — the full history of an execution is available for inspection via the REST API
   and the Web UI.

## Events

Each entry in the execution log is an **event** with a monotonically increasing **version** number
(starting at 0) and a timestamp. The following table lists all event types and their effect on the
{{ doc_link(title="execution state", path="concepts/execution-states.md") }}.

| Event                        | Description                                                                                                                                                                                 | State Transition                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Created**                  | The execution was submitted. Records the function ({{ doc_link(title="FFQN", path="concepts/ffqn.md") }}), parameters, parent execution (if any), scheduled time, and component assignment. | → PendingAt                          |
| **Locked**                   | An executor acquired the execution. Records the executor ID, run ID, lock expiry, component ID, and retry configuration.                                                                    | PendingAt → Locked                   |
| **Unlocked**                 | The executor voluntarily released the execution (e.g., shutting down or resource limits). Records a `backoff_expires_at` time and a reason.                                                 | Locked → PendingAt                   |
| **ComponentUpgradeFinished** | A manual or automatic workflow component upgrade finished. Records the target component digest, deployment, and success or failure outcome.                                                 | No change                            |
| **TemporarilyFailed**        | An activity encountered a retryable error (e.g., a WASM trap). Records backoff expiry, reason, and optional HTTP client traces.                                                             | Locked → PendingAt                   |
| **TemporarilyTimedOut**      | An activity timed out but has retries remaining. Records backoff expiry and optional HTTP client traces.                                                                                    | Locked → PendingAt                   |
| **Finished**                 | The execution completed. Records the return value or error. This is a terminal event — no further events can be appended.                                                                   | Any → Finished                       |
| **HistoryEvent**             | A workflow’s internal decision or interaction with the runtime. See [History Events](#history-events) below.                                                                                | Varies                               |
| **Paused**                   | The execution was paused via CLI or API.                                                                                                                                                    | Any non-Finished → Paused            |
| **Unpaused**                 | The execution was resumed.                                                                                                                                                                  | Paused → (previous underlying state) |
| **CancellationRequested**    | Cancellation was requested for an activity or cancellable workflow.                                                                                                                         | Any non-Finished → Cancelling        |

See {{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }} for
the structured-concurrency teardown rules.

### History Events

History events are created by the executor while the execution is in **Locked** state. They capture
the deterministic decisions made by a workflow during execution. During replay, the runtime compares
the workflow’s requests against the recorded history events to detect nondeterminism.

| History Event       | Description                                                                                                                                                                                                                                       | State Effect                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Persist**         | Records a generated pseudorandom value (random u64 or random string). Used for determinism: on replay the same value is returned.                                                                                                                 | No change                                            |
| **JoinSetCreate**   | A new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} was created.                                                                                                                                                       | No change                                            |
| **JoinSetRequest**  | A request was added to a join set. This is either a **ChildExecutionRequest** (spawn a child activity or workflow) or a **DelayRequest** ({{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}).               | No change                                            |
| **JoinNext**        | The workflow is waiting for the next response in a join set. If no response is available, the execution transitions to BlockedByJoinSet. If a response is already available, the execution stays Locked (or becomes PendingAt after lock expiry). | Locked → BlockedByJoinSet (if no response available) |
| **JoinNextTry**     | Non-blocking poll of a join set. Records whether a response was found, is still pending, or all requests were processed.                                                                                                                          | No change                                            |
| **JoinNextTooMany** | The workflow attempted to await more responses than were submitted to the join set.                                                                                                                                                               | No change                                            |
| **Schedule**        | The workflow scheduled a child execution outside of a join set (fire-and-forget).                                                                                                                                                                 | No change                                            |
| **Stub**            | The workflow wrote a result to a stub execution.                                                                                                                                                                                                  | No change                                            |

## Responses

In addition to the event log, each execution maintains a list of **responses**. Responses arrive
asynchronously — they are written by child executions or the delay timer, not by the workflow
itself:

| Response                   | Description                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **ChildExecutionFinished** | A child activity or workflow in a join set completed. Contains the child execution ID, join set ID, and the result. |
| **DelayFinished**          | A delay request in a join set expired. Contains the delay ID and join set ID.                                       |

When a response arrives and the execution is in **BlockedByJoinSet** state waiting on that join set,
the execution transitions to **PendingAt**, making it eligible for an executor to pick up and
continue.

## Versioning

Each event is assigned a **version** number equal to its index in the log (starting at 0 for the
`Created` event). The version serves as an optimistic concurrency control token: when an executor
appends events, it must specify the expected current version. If it does not match, the write is
rejected.

Once an execution reaches the **Finished** state, the version counter stops advancing.

## Example: Activity Lifecycle

The following shows a typical activity execution log:

```text
Version 0: Created(ns:pkg/ifc.my-activity, scheduled_at=2025-01-15T10:00:00Z)
  → State: PendingAt(2025-01-15T10:00:00Z)

Version 1: Locked(executor=E1, run=R1, expires_at=2025-01-15T10:00:30Z)
  → State: Locked(E1, R1)

Version 2: Finished(Ok([42]))
  → State: Finished(ok)
```

## Example: Activity with Retries

An activity that fails temporarily before succeeding:

```text
Version 0: Created(ns:pkg/ifc.flaky-activity, scheduled_at=...)
  → State: PendingAt

Version 1: Locked(executor=E1, run=R1, expires_at=...)
  → State: Locked

Version 2: TemporarilyFailed(backoff_expires_at=+1s, reason="connection refused")
  → State: PendingAt(+1s)

Version 3: Locked(executor=E1, run=R2, expires_at=...)
  → State: Locked

Version 4: TemporarilyFailed(backoff_expires_at=+2s, reason="connection refused")
  → State: PendingAt(+2s)

Version 5: Locked(executor=E1, run=R3, expires_at=...)
  → State: Locked

Version 6: Finished(Ok("success"))
  → State: Finished(ok)
```

## Example: Workflow with Child Execution

A workflow that spawns a child activity and waits for its result:

```text
Version 0: Created(ns:pkg/ifc.my-workflow, scheduled_at=...)
  → State: PendingAt

Version 1: Locked(executor=E1, run=R1, expires_at=T+30s)
  → State: Locked

Version 2: HistoryEvent(JoinSetCreate(o:1))
  → State: Locked (no change)

Version 3: HistoryEvent(JoinSetRequest(o:1, ChildExecutionRequest(child_id, ns:pkg/ifc.my-activity)))
  → State: Locked (no change)

Version 4: HistoryEvent(JoinNext(o:1, run_expires_at=T+30s))
  → State: BlockedByJoinSet(o:1)  [no response available yet]

--- Response arrives: ChildExecutionFinished(child_id, Ok(42)) ---
  → State: PendingAt(max(T+30s, response_time))

Version 5: Locked(executor=E1, run=R1, expires_at=T+60s)  [lock extension]
  → State: Locked

Version 6: HistoryEvent(JoinNextTry(o:1, Found))
  → State: Locked (no change)

Version 7: Finished(Ok(42))
  → State: Finished(ok)
```

Note: if the original executor is still holding the WASM instance warm (see
[Join Next Blocking Strategy](@/docs/v0.41.5/concepts/workflows/_index.md#join-next-blocking-strategy)),
it may continue directly without an additional Locked event.

## Inspecting the Execution Log

### REST API

```sh
# Get execution events
curl -H 'Accept: application/json' \
  http://127.0.0.1:5005/v1/executions/{id}/events

# Include backtrace IDs (for source mapping in the Web UI)
curl -H 'Accept: application/json' \
  'http://127.0.0.1:5005/v1/executions/{id}/events?include_backtrace_id=true'
```

The response contains a list of events, each with its version, timestamp, and event type.

### CLI

```sh
obelisk execution status {id}
obelisk execution result {id}
```

### Web UI

The execution detail view shows the full event log as an interactive timeline. Each event is
displayed with its version number, timestamp, and details. The
{{ doc_link(title="time-traveling debugger", path="concepts/workflows/_index.md") }} uses the
execution log to reconstruct and visualize the execution at any point in its history.
