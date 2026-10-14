+++
title = "Publishing Workflow Events with Self-Fulfilled Stubs"
template = "docs.html"
weight = 30
+++

A long-running workflow sometimes needs to publish structured intermediate output before it
finishes, so a UI that reads the workflow's execution history can display progress.

Use a stub activity as a typed event envelope: submit it as a child, immediately fulfil it from the
same workflow, then consume the completion from its join set. Unlike an ordinary activity, this
schedules no implementation code on an activity worker.

```toml
[[activity_stub]]
ffqn = "example:session/events.publish"
params = [{ name = "event-id", type = "string" }]
return_type = "result<string, string>"
```

```javascript
import * as obelisk from "obelisk:workflow@1.0.0";
import * as dynamic from "obelisk:workflow-dynamic@1.0.0";

export default function session() {
  const events = obelisk.createJoinSet({ name: "events" });

  function publish(eventId, value) {
    const executionId = dynamic.submit(events, "example:session/events.publish", [eventId]);
    // Fulfil the stub from this workflow. No external producer is involved.
    obelisk.stub(executionId, { ok: JSON.stringify(value) });
    // Consume the completion so it becomes a processed response of the join set.
    events.joinNext();
  }

  publish("command-1", { stdout: "hello\n", stderr: "", exit_code: 0 });
  // Continue the long-running work.
}
```

The event id lands in the child submission parameters, the structured payload in the stub's return
value. An observer correlates the two through the child execution id and the parent's join-set
responses.

## Join-set choice

A dedicated join set is simplest when events are published one at a time: the immediate `joinNext()`
consumes exactly the stub just fulfilled. If the stub instead shares a join set with other in-flight
children, another child may complete first, so drain the set through a dispatcher keyed by `lastId`
rather than assuming the next response belongs to the most recent submission.

## When to use this pattern

Use a self-fulfilled stub when the workflow must expose structured intermediate output that belongs
in durable execution history, no external party needs to produce or approve the value, and consumers
already inspect child executions or parent join-set responses.

Each event still creates one child execution. For high-volume telemetry, use normal logs or an
external event system instead.
