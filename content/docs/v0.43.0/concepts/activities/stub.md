+++
title = "Stub Activities"
template = "docs.html"
weight = 90
+++

Activities with no implementation, only a signature, configured in an `[[activity_stub]]` table are
called Stub Activities. They represent a result that arrives from the outside world: a human
approval, a callback from another system, or a message from another workflow.

Stub activity functions are not executed by the Obelisk runtime. Instead, the following steps are
executed:

1. The parent workflow calls or submits the stub function like any other activity.
2. An external process or workflow injects the execution result by supplying a return value or an
   execution error for the given
   {{ doc_link(title="Execution ID", path="concepts/identifiers.md#execution-id") }}.
3. The parent execution obtains the return value and continues its logic.

The parent execution is agnostic of whether the child activity is a regular activity or a stub
activity.

```toml
[[activity_stub]]
ffqn = "myapp:stubs/approval.approve"
params = [{ name = "request-id", type = "string" }]
return_type = "result<string, string>"
```

A workflow submits the stub and awaits it like any activity:

```javascript
import { approveSubmit, approveAwaitNext } from "myapp:stubs-obelisk-ext/approval";
import * as obelisk from "obelisk:workflow@1.0.0";

const js = obelisk.createJoinSet();
const execId = approveSubmit(js, requestId);
// Hand execId to whoever approves, e.g. by calling a notification activity.
const decision = approveAwaitNext(js); // blocks until the result is supplied
```

The result can be injected using the Web UI, the
{{ doc_link(title="CLI", path="access/cli.md#providing-the-result-of-a-stubbed-activity") }}, the
{{ doc_link(title="REST API", path="access/api.md") }}, or from a workflow using the `-obelisk-stub`
import:

```javascript
import { approveStub } from "myapp:stubs-obelisk-stub/approval";

approveStub(execId, { ok: "approved" });
```

Supplying a result is idempotent: it can be repeated as long as the value stays the same. Supplying
a different value for the same execution fails with a conflict error.

An
{{ github(title="example stub workflow", path="crates/testing/test-programs/stub/workflow", version="v0.43.0-rc.1") }}
is available in the repository. See {{ doc_link(title="Stub RPC", path="patterns/stub-rpc.md") }}
and {{ doc_link(title="Durable Mailbox", path="patterns/stub-mailbox.md") }} for patterns built on
stubs.

## Cancellation and pending stubs

A pending stub is a member of the join set its owning workflow submitted it to. When that join set
closes — including when a `-cancellable` workflow is cancelled and Obelisk closes its join sets from
the execution log — the still-pending stub is cancelled and finishes as an execution failure. An
external party blocked on its result (for example a webhook awaiting the stub via `obelisk.get` or
`GET /v1/executions/{id}?follow=true`) is released at that point.

This unblocking happens through join-set close, not through the owning workflow's own code: a
cancelled workflow is not advanced again, so its `catch`/`finally` handlers do not run. Keep a stub
that an external reader depends on inside a join set owned by the workflow whose cancellation should
release that reader. See
{{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }}.
