+++
title = "Structured Concurrency"
template = "docs.html"
weight = 15
+++

Structured concurrency is a programming paradigm that Obelisk employs to manage child executions
(child workflows and activities). It ensures that the lifetimes of concurrent tasks are contained
within the scope of their parent execution, meaning that the parent workflow execution is blocked
until its child executions finish or are cancelled.

This approach simplifies resource management, cleanup and error handling.

At its core, structured concurrency in Obelisk revolves around managing a tree structure of
executions.

### The Execution Tree

1.  **Root Execution:** It all starts with a single top-level execution, which is typically a
    {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }} triggered by an external
    event or a {{ doc_link(title="webhook endpoint", path="concepts/webhook-endpoints.md") }}.
2.  **Parent-Child Relationship:** Workflows can spawn child executions. These children can be other
    workflows or {{ doc_link(title="activities", path="concepts/activities/_index.md") }}. Only
    activities are permitted to perform side effects, such as making external HTTP calls. Workflows
    orchestrate these activities and other workflows in a deterministic and thus replayable fashion.
3.  **Controlled Lifetimes:** A fundamental guarantee of structured concurrency is that child
    executions **cannot outlive their parent**. When a parent workflow finishes (either successfully
    or due to an error), Obelisk ensures that all its direct children are also properly concluded
    before the grand-parent is notified.

### Error Propagation

Structured concurrency provides clear rules for how errors are handled within the execution tree:

1.  **Child to Parent:** If a child execution fails – whether by returning an error, panicking
    (trapping within the WASM sandbox), or timing out – and the configured amount of retries is
    exhausted – the last execution error is propagated upwards to its immediate parent workflow.
2.  **Bubbling Up Unhandled errors:** If the parent workflow does not explicitly handle the error
    from its child, the error continues to bubble up the execution tree.
3.  **Root Failure:** An unhandled error that reaches the root execution will cause the entire
    top-level execution to be marked as failed.

This ensures that failures are not lost and that the system maintains a consistent state.

### The Role of Join Sets

{{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }} are the primary mechanism
Obelisk uses to implement and enforce structured concurrency.

- **Tracking Children:** When a workflow spawns child executions using mechanisms like direct calls
  or the `-submit` {{ doc_link(title="extension function", path="concepts/extensions.md") }}, these
  children are associated with a join set (either an implicit one-off set for direct calls or an
  explicit one created by the workflow).
- **Awaiting Completion:** Join sets allow the parent workflow to asynchronously await the results
  of its children as they complete using `-await-next`
  {{ doc_link(title="extension function", path="concepts/extensions.md") }} or `join-next`
  {{ doc_link(title="support function", path="concepts/runtime-support.md") }}. Results arrive based
  on completion order, not submission order.
- **Enforcing Lifetimes:** Crucially, join sets ensure the parent-child lifetime constraint. When a
  Join Set gets out of scope, the execution will block and resume only when all child executions are
  finished. See
  {{ doc_link(title="Join Set Close", path="concepts/workflows/join-sets.md#join-set-close") }} for
  details.

### Cancellation

Cancellation is part of Obelisk's structured-concurrency guarantee: a child execution must not
outlive its parent. When a join set closes, Obelisk tears down the still-pending members that are
safe to stop and waits for the members that must finish cooperatively:

During normal execution, a join set closes when workflow code closes an explicit join set or leaves
an implicit direct-call join set. During cancellation, Obelisk closes persisted join sets from the
execution log, so teardown does not depend on the workflow replaying to the close point.

- Pending activities and delay requests are cancelled. Running WASM and JS activities are
  interrupted in-process by dropping the Wasmtime invocation before cancellation is reported as
  finished. Running exec activities have their process group signalled with `SIGKILL` and the direct
  child is awaited; terminating descendants is best effort because a native process can spawn
  children or block in the kernel.
- Child workflows are awaited by default.
- Child workflows whose exported function name ends in `-cancellable` are cancelled instead of
  awaited. Cancellation closes their own join sets from the persisted execution log, recursively
  applying the same rules; the workflow WASM is not advanced again.

A cancellable workflow is useful when an operator or parent workflow needs to release a subtree that
is stuck on a long-lived stub, blocked on a child, or unable to replay after a code change. It is
also a stronger shutdown primitive than cancelling only the leaf activities because it can reach a
workflow that cannot currently run.

The tradeoff is cleanup ownership. Since a cancelled workflow is not run again, its own `finally`
blocks, catch handlers, or compensation code do not execute. Mark a workflow `-cancellable` only
when any resources it uses are owned and compensated by an ancestor. To make an entire subtree
tearable-down, every workflow on the path must be cancellable; a non-cancellable workflow remains an
await barrier.

A cancelled child cannot report its own cancellation — because its code is not run, it cannot return
a sentinel value. A parent observes the outcome only externally. A cancelled child finishes as an
{{ doc_link(title="execution failure", path="concepts/execution-states.md") }}, so `obelisk.getResult`
throws and `obelisk.getStatus` reports `finishedStatus: "executionFailure"` — a coarse category it
shares with nondeterminism and out-of-fuel failures. To distinguish a deliberate cancellation from a
genuine fault, read the execution's specific classification (`Cancelled`) from the REST API
(`GET /v1/executions/{id}`).

### Contrast with Unstructured Concurrency (`-schedule`)

Obelisk also provides the `-schedule` extension function. It's important to understand that using
`-schedule` **opts out** of the structured concurrency model for that specific execution:

- **No Join Set:** Scheduled executions are not associated with a join set.
- **No Lifetime Link:** The parent workflow does not automatically wait for scheduled executions to
  complete, nor does their failure automatically propagate back unless explicitly designed via other
  means (e.g., the scheduled task reporting status elsewhere).
- **Use Cases:** `-schedule` is intended for "fire-and-forget" tasks where the result isn't
  immediately needed by the parent, or for delaying execution until a specific time, effectively
  detaching the child's lifecycle from the parent's immediate scope.

Because a scheduled execution has no parent to enforce its lifetime, a long-lived detached root — for
example a session workflow started by a webhook via `-schedule` — is responsible for bounding its own
lifetime. Give it an internal limit so it cannot run forever if its driver disappears: an idle
timeout (a persistent sleep raced against its next unit of work), an absolute cap such as a maximum
number of iterations, or both.

### Benefits of Structured Concurrency

- **Reliability:** Ensures executions don't get lost or run indefinitely.
- **Predictability:** Makes it easier to reason about the state and lifecycle of concurrent
  operations.
- **Simplified Error Handling:** Provides clear paths for error propagation and handling.
- **Cleanup:** Facilitates automatic cleanup actions tied to the scope of the parent workflow.
