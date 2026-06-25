+++
title = "Cleanup Supervisor (Saga)"
template = "docs.html"
weight = 10
+++

Use a small parent workflow to own the lifecycle of an external resource. The parent creates the
resource, runs complex work in a child workflow, always performs cleanup, and then propagates the
child result or error.

This is a saga with one compensation: cleanup reverses resource creation. It is useful for temporary
containers, virtual machines, test environments, leases, and other resources that must not survive
the operation that uses them.

## Why use a parent workflow?

Putting creation, complex work, and cleanup in one workflow leaves more workflow code capable of
failing before cleanup is reached. A supervisor keeps the critical lifecycle path small:

1. Create the resource through an activity.
2. Submit the complex child workflow.
3. Wait for the child.
4. Clean up the resource.
5. Return the child result or rethrow its error.

Obelisk records completed steps in the execution log. After a process or server crash, replay
continues from the recorded state and still reaches cleanup. Activity calls used for creation and
cleanup should be idempotent.

```javascript
// workflow/run.js - minimal resource supervisor
import * as resource from "example:infra/resource";

const CHILD_FFQN = "example:app/workflow.run-child";

export default function run(input) {
  const resourceId = resource.create(input);
  let result = null;
  let childError = null;

  try {
    result = obelisk.call(CHILD_FFQN, [resourceId, input]);
  } catch (error) {
    childError = error;
  }

  try {
    resource.delete(resourceId);
  } catch (cleanupError) {
    console.error(`Cleanup failed for ${resourceId}: ${String(cleanupError)}`);
    if (childError === null) childError = cleanupError;
  }

  if (childError !== null) throw childError;
  return result;
}
```

Keep the supervisor intentionally simple. Put polling, tool dispatch, approvals, and other complex
or long-running logic in the child workflow.

## Racing work against a teardown signal

For operator-controlled teardown, submit both the child workflow and a long-lived stub activity to
one join set. The first completion wakes the supervisor:

```toml
[[activity_stub]]
name = "teardown_signal"
ffqn = "example:app/control.teardown-signal"
params = []
return_type = "result<_, string>"

[[workflow_js]]
ffqn = "example:app/workflow.run-child"
location = "${DEPLOYMENT_DIR}/workflow/run-child.js"
params = [
  { name = "resource-id", type = "string" },
  { name = "input",       type = "string" },
]
return_type = "result<string, string>"
```

```javascript
// workflow/run.js - supervisor with operator teardown
import * as resource from "example:infra/resource";

const CHILD_FFQN = "example:app/workflow.run-child";
const TEARDOWN_FFQN = "example:app/control.teardown-signal";

export default function run(input) {
  const resourceId = resource.create(input);
  const race = obelisk.createJoinSet({ name: "session" });

  let result = null;
  let childError = null;
  let tornDown = false;

  try {
    const childId = race.submit(CHILD_FFQN, [resourceId, input]);
    const teardownId = race.submit(TEARDOWN_FFQN, []);
    const completed = race.joinNext();

    if (completed.id === teardownId) {
      tornDown = true;
    } else if (completed.id === childId) {
      try {
        result = obelisk.getResult(childId);
      } catch (error) {
        childError = error;
      }
    } else {
      childError = `Unexpected child completion: ${completed.id}`;
    }
  } finally {
    // Cleanup precedes join-set close so teardown is not delayed by the child.
    try {
      resource.delete(resourceId);
    } catch (cleanupError) {
      if (childError === null) childError = cleanupError;
    }
    race.close();
  }

  if (childError !== null) throw childError;
  return tornDown ? "Resource torn down by operator." : result;
}
```

An operator requests teardown by cancelling the pending teardown stub execution:

```bash
obelisk execution cancel <teardown-stub-execution-id>
```

The cancelled stub is a completed member of the race, so the supervisor wakes and runs cleanup even
if the child is waiting on an unrelated activity or human-input stub.

## Child workflow shutdown

Cleanup and child termination are related but separate:

- Closing a join set cancels its pending **activities and delays**.
- Closing a join set does not directly cancel a pending **child workflow**. The parent waits for
  that child workflow to finish, preserving structured concurrency.

Therefore, the supervisor must perform resource cleanup before closing the race join set. The child
should then unwind when its resource-dependent activity fails, observe a cooperative shutdown
signal, or have its pending leaf activities cancelled by the control plane.

For a child parked on a long-lived stub, the teardown handler should:

1. Cancel the supervisor's teardown stub.
2. Wait until the supervisor starts cleanup or enters join-set closing.
3. Enumerate unfinished descendants and cancel pending activities, activity stubs, and delays.

The handler does not need to understand the child's join sets or business logic. It cancels leaf
work so the child can unwind; it does not attempt to cancel the child workflow directly.

Do not put the teardown signal inside the child workflow. If the child is blocked on another join
set, it cannot observe that signal. The parent supervisor must own both the resource and the
teardown race.

## Error policy

Choose and document cleanup-error precedence:

- If the child succeeds but cleanup fails, fail the supervisor with the cleanup error.
- If both child work and cleanup fail, preserve the child error and log or attach the cleanup error.
- If teardown was requested, return a distinct result only after cleanup has been attempted.

For a complete Fly.io example, see
{{ doc_link(title="Getting Started: Saga Pattern with Fly.io", path="js/getting-started-fly-agent.md") }}.
