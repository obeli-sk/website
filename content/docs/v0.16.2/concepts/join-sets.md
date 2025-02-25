+++
title = "Join Sets"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Join sets are a core mechanism for handling concurrency and asynchronous operations in Obelisk workflows. A join set represents a collection of pending operations (like activity calls or spawned child workflows). A parent workflow can interact with a join set in the following ways:

- Create a Join Set: A workflow can create a new join set, which is initially empty.

* Add Operations to a Join Set: When a workflow starts an activity or spawns a child workflow, these are automatically or manually associaded with a join set.

    * Blocking call

    * non-blocking call (`-submit`)

- Await Results: The workflow can use `await-next` on a join set to wait for the next operation in that set to complete. This call blocks until a result is available.

Currently join sets are limited to a single type of child executions, meaning it is not possible to submit child executions that belong to more than one activity or a workflow function signature.

## Key Properties of Join Sets

Completion Order: Operations in a join set are completed in an arbitrary order (determined by when the underlying activities or workflows finish). The await-next call returns results in the order they become available.

Persistence: The state of join sets is persisted in the execution log, ensuring that workflows can resume correctly after failures.

Closing: Join sets are automatically "closed" when the execution finishes. This allows workflows to wait for all child executions to finish.
In the future it will be possible to set a flag on join sets that will cancel all child
executions that were not awaited for.
