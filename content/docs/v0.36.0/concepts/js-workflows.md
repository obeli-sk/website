+++
title = "JS Workflows"
template = "docs.html"
weight = 24
+++

Workflows orchestrate activities (and other workflows). They must be **deterministic** —
given the same inputs and event history they always produce the same sequence of calls.
Obelisk records every call and its result; on crash-recovery it replays the log, skipping
already-completed calls. See {{ doc_link(title="Workflows", path="concepts/workflows/_index.md") }}
for the general model.

```toml
[[workflow_js]]
name        = "my_workflow"
location    = "${DEPLOYMENT_DIR}/workflow/my_workflow.js"
ffqn        = "myapp:demo/workflow.my-workflow"
params      = []
return_type = "result<string, string>"
```

Do not use `Date.now()`, `Math.random()`, or other non-deterministic sources in workflow
code. Use `obelisk.sleep` for delays instead of `setTimeout`.

## `obelisk.call` — submit and await

Submits a child execution and **blocks** until it completes. Returns the ok payload directly;
throws the err payload if the child permanently fails.

```javascript
// ffqn: myapp:demo/workflow.serial() -> result<string, string>
export default function serial() {
    let acc = 0;
    for (let i = 0; i < 10; i++) {
        obelisk.sleep({ seconds: 1 });
        const result = obelisk.call("myapp:demo/activity.step", [i, i * 200]);
        acc += Number(result);
        console.log(`step(${i})=${result}`);
    }
    return String(acc);
}
```

## `obelisk.sleep` — persistent sleep

Pauses the workflow durably — the sleep position is saved to the execution log. If the server
crashes mid-sleep and restarts, the sleep resumes where it left off.

```javascript
obelisk.sleep({ milliseconds: 300 });
obelisk.sleep({ seconds: 1 });
obelisk.sleep({ minutes: 5 });
```

## Join sets — parallel submission

{{ doc_link(title="Join sets", path="concepts/workflows/join-sets.md") }} let you submit
multiple child executions concurrently and await their results individually.

```javascript
// ffqn: myapp:demo/workflow.parallel() -> result<string, string>
export default function parallel() {
    // Submit all
    const handles = [];
    for (let i = 0; i < 10; i++) {
        const js = obelisk.createJoinSet();
        const execId = js.submit("myapp:demo/activity.step", [i, i * 200]);
        handles.push({ i, js, execId });
    }

    // Collect results
    let acc = 0;
    for (const { i, js, execId } of handles) {
        const response = js.joinNext();   // blocks until next result in this join set
        if (!response.ok) throw `step ${i} failed`;
        const result = obelisk.getResult(response.id);  // { ok: value } or { err: value }
        acc = 10 * acc + Number(result.ok);
        obelisk.sleep({ milliseconds: 300 });
    }
    return String(acc);
}
```

**API summary:**

| Call | Returns | Description |
|------|---------|-------------|
| `obelisk.createJoinSet()` | join set | Create a new join set |
| `js.submit(ffqn, args)` | `executionId` (string) | Submit a child execution without blocking |
| `js.joinNext()` | `{ ok: bool, id: string }` | Block until the next result in this join set |
| `obelisk.getResult(id)` | `{ ok: value }` or `{ err: value }` | Fetch a result after `joinNext` |

`response.ok` is `true` if the execution finished in the ok variant; `response.id` is the
execution ID to pass to `obelisk.getResult`.

## `obelisk.stub` — manual result injection

For testing: provide a result for a stub activity without executing it.

```javascript
const js = obelisk.createJoinSet();
const execId = js.submit("myapp:stubs/stubs.my-stub", [42]);
obelisk.stub(execId, { ok: "stub-result" });
js.joinNext();
const result = obelisk.getResult(execId).ok;  // "stub-result"
```
