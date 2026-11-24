+++
title = "Design Principles"
template = "docs.html"
weight = 5
+++

Rules of thumb for splitting an application into workflows and activities. The other pages in this
section build on them.

## Keep activities short and single-purpose

An activity performs one unit of side-effecting work, typically one request to an external system,
and returns its raw outcome.

- **Short-lived.** Activities are retried on errors, timeouts, and traps, and a retry starts the
  work again from the beginning. Keep them in the range of seconds. Run CPU-intensive or long
  workloads in a container or VM that an activity starts, and poll for completion from the workflow
  with durable sleeps (see {{ doc_link(title="durable polling", path="js/js-patterns.md") }}).
- **Idempotent.** An activity can run more than once for the same logical input, so pass an
  idempotency key to external APIs or check before creating. See
  {{ doc_link(title="Activities", path="concepts/activities/_index.md") }}.
- **One request, no decisions.** Do not chain requests behind conditions inside an activity, such as
  "on `412`, fetch the current state and retry with it". Return the response and let the workflow
  decide what to call next.

## Make decisions in workflows

Workflows are deterministic and replayable, and every child call they make is recorded in the
{{ doc_link(title="execution log", path="concepts/execution-log.md") }}. Branching that lives in a
workflow is visible in the trace, survives crashes, and can be replayed against new code. Branching
hidden in an activity is visible only as one opaque call and is repeated on every retry.

Read the time and random values through the Obelisk APIs so replay stays deterministic (see
{{ doc_link(title="Random values and time", path="js/js-workflows.md#random-values-and-time") }}).

## Make every execution finish

{{ doc_link(title="Automatic retention", path="configuration/server.md#automatic-maintenance-and-retention") }}
deletes only finished execution trees. An execution that waits forever, for example a chat session
nobody returns to or an approval nobody answers, keeps its whole tree in the database indefinitely
and never counts toward `max_count` or `max_age`.

- **Bound every wait on outside input.** Race each stub or external signal against a durable delay
  in the same join set and end the execution, with an error or a default, when the delay wins. The
  example agents end a session after 7 days without user input.
- **Make long-lived workflows cancellable.** End the exported function name in `-cancellable` so an
  operator or a parent can cancel the execution, which also makes it finished. See
  {{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }} for
  the cleanup tradeoff.
- **Replace instead of running forever.** A monitor or consumer that must keep running should
  periodically hand over to a fresh execution. See
  {{ doc_link(title="Generation reconciler", path="patterns/generation-reconciler.md") }}.

```javascript
import { approveSubmit } from "myapp:stubs-obelisk-ext/approval";
import * as obelisk from "obelisk:workflow@1.0.0";

const IDLE_TIMEOUT = { days: 7 };

export default function reviewCancellable(requestId) {
  const js = obelisk.createJoinSet();
  const approvalId = approveSubmit(js, requestId);
  const idleId = js.submitDelay(IDLE_TIMEOUT);
  const decision = js.joinNext();
  if (js.lastId === idleId) {
    throw "no answer within 7 days";
  }
  if (js.lastId !== approvalId) {
    throw `unexpected response: ${js.lastId}`;
  }
  js.close(); // cancels the pending delay
  return decision;
}
```

The requested delay is part of the execution log and is compared on replay, so changing the timeout
is a nondeterministic change: executions that already submitted the old delay fail to replay against
the new code and stay on their previous component version (see
{{ doc_link(title="Hot redeploy", path="concepts/deployments.md#hot-redeploy") }}). Pick the timeout
up front, or pass it as a workflow parameter so new executions can use a different value.

## Own cleanup in a parent

A cancelled workflow is not run again, so its own `finally` blocks do not execute. When a workflow
creates an external resource, keep creation and cleanup in a small parent and run the complex work
in a child. See {{ doc_link(title="Cleanup supervisor", path="patterns/cleanup-supervisor.md") }}.
