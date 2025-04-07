+++
title = "Structured Concurrency"
template = "docs.html"
weight = 15
+++

Structured concurrency is a programming paradigm that Obelisk employs to manage concurrent operations (child workflows and activities). It ensures that the lifetimes of concurrent tasks are neatly contained within the scope of their parent execution, simplifying resource management, cleanup and error handling.

At its core, structured concurrency in Obelisk revolves around managing a tree structure of executions.

### The Execution Tree

1.  **Root Execution:** Every process starts with a single top-level execution, which is typically the initial {{ doc_link(title="workflow", path="concepts/workflows/_index.md") }} instance triggered by an external event.
2.  **Parent-Child Relationship:** Workflows can spawn child executions. These children can be other workflows or {{ doc_link(title="activities", path="concepts/activities.md") }}. Only activities are permitted to perform side effects, such as making external HTTP calls. Workflows orchestrate these activities and other workflows in a deterministic and thus replayable fashion.
3.  **Controlled Lifetimes:** A fundamental guarantee of structured concurrency is that child executions **cannot outlive their parent**. When a parent workflow finishes (either successfully or due to an error), Obelisk ensures that all its direct children are also properly concluded before the grand-parent is notified.

### Error Propagation

Structured concurrency provides clear rules for how errors are handled within the execution tree:

1.  **Child to Parent:** If a child execution fails – whether by returning an error, panicking (trapping within the WASM sandbox), or timing out – that error is propagated upwards to its immediate parent workflow.
2.  **Bubbling Up Unhandled errors:** If the parent workflow does not explicitly handle the error from its child, the error continues to bubble up the execution tree.
3.  **Root Failure:** An unhandled error that reaches the root execution will cause the entire workflow instance (the whole tree originating from that root) to be marked as failed.

This ensures that failures are not lost and that the system maintains a consistent state.

### The Role of Join Sets

{{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }} are the primary mechanism Obelisk uses to implement and enforce structured concurrency.

*   **Tracking Children:** When a workflow spawns child executions using mechanisms like direct calls or the `-submit` {{ doc_link(title="extension function", path="concepts/workflows/extension-functions.md") }}, these children are associated with a join set (either an implicit one-off set for direct calls or an explicit one created by the workflow).
*   **Awaiting Completion:** Join sets allow the parent workflow to asynchronously await the results of its children as they complete using `-await-next`. Results arrive based on completion order, not submission order.
*   **Enforcing Lifetimes:** Crucially, join sets ensure the parent-child lifetime constraint.

### Contrast with Unstructured Concurrency (`-schedule`)

Obelisk also provides the `-schedule` extension function. It's important to understand that using `-schedule` **opts out** of the structured concurrency model for that specific execution:

*   **No Join Set:** Scheduled executions are not associated with a join set.
*   **No Lifetime Link:** The parent workflow does not automatically wait for scheduled executions to complete, nor does their failure automatically propagate back unless explicitly designed via other means (e.g., the scheduled task reporting status elsewhere).
*   **Use Cases:** `-schedule` is intended for "fire-and-forget" tasks where the result isn't immediately needed by the parent, or for delaying execution until a specific time, effectively detaching the child's lifecycle from the parent's immediate scope.

### Benefits of Structured Concurrency

*   **Reliability:** Ensures executions don't get lost or run indefinitely.
*   **Resource Management:** Prevents orphaned executions that might consume resources.
*   **Predictability:** Makes it easier to reason about the state and lifecycle of concurrent operations.
*   **Simplified Error Handling:** Provides clear paths for error propagation and handling.
*   **Cleanup:** Facilitates automatic cleanup actions tied to the scope of the parent workflow.
