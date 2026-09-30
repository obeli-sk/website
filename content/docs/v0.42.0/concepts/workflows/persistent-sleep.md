+++
title = "Persistent Sleep"
template = "docs.html"
weight = 20
+++

Persistent or durable sleep means the workflow's state is saved, and execution will resume after the
duration has elapsed, even if the Obelisk server restarts. Workflows use `obelisk.sleep` instead of
`setTimeout`:

```javascript
import * as obelisk from "obelisk:workflow@1.0.0";

obelisk.sleep({ seconds: 10 });
obelisk.sleep(new Date(Date.now() + 30_000)); // absolute wake-up time
const wokeAt = obelisk.sleep({ days: 1 }, "reminder"); // optional name, returns a Date
```

`sleep` creates a one-off {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }}
with a delay and blocks until the delay expires. The optional second argument names that join set.

If the durable sleep is cancelled, `sleep` throws `obelisk.ChildError` with `cancelled === true`.
See {{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }} for
how delay cancellation fits into structured concurrency.

## Delays in a join set

A delay can also be submitted to a join set next to child executions. This is how a workflow
implements a timeout: whichever finishes first is returned by `joinNext`, and closing the join set
cancels the rest.

```javascript
const js = obelisk.createJoinSet();
const execId = js.submit("myapp:demo/activity.step", [1, 200]);
const delayId = js.submitDelay({ seconds: 10 });
const result = js.joinNext(); // null if the delay won
if (js.lastId === delayId) {
  return "timed out";
}
```

See
{{ doc_link(title="Heterogenous Join Sets", path="concepts/workflows/join-sets.md#heterogenous-join-sets") }}.
For Rust, see {{ doc_link(title="Rust Workflows", path="wasm/workflows.md#persistent-sleep") }}.
