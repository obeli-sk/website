+++
title = "Stub Activities"
template = "docs.html"
weight = 90
+++

Activities with no real implementation except for their WIT exports and configured in
`[[activity_stub]]` table are called Stub Activities.

Stub activity functions are not executed by the Obelisk runtime. Instead, the following steps are
executed:

1. The parent workflow calls the stub function. Both direct calls (e.g. `myactivity()`) and async
   counterparts (e.g. `myactivity_submit`) are supported.
2. An external process or workflow injects the execution result by supplying a return value or an
   execution error for the given
   {{ doc_link(title="Execution ID", path="concepts/identifiers.md#execution-id") }}.
3. The parent execution obtains the return value and continues its logic.

The parent execution is agnostic of whether the child activity is a regular WASM activity or a stub
activity.

Consider two activity functions defined in WIT like this:

```wit
package testing:stub-activity;

interface activity {
    foo: func(arg: string) -> string;

    noret: func();
}
```

Obelisk automatically generates `-obelisk-stub`
{{ doc_link(title="extension interface", path="concepts/extensions.md") }} for each WIT export. The
`-stub` function takes the Execution ID and the return value an execution error. The `-obelisk-stub`
interface can only be imported by workflows.

```wit
package testing:stub-activity-obelisk-stub;

interface activity {
    use obelisk:types/execution@6.0.0.{execution-id, stub-error};

    foo-stub: func(execution-id: execution-id, return-value: string) -> result<_, stub-error>;

    noret-stub: func(execution-id: execution-id) -> result<_, stub-error>;

}
```

The return value can also be injected using Web UI or
{{ doc_link(title="CLI", path="cli-and-api/cli.md#providing-the-result-of-a-stubbed-activity") }}.

The stubbed response call is idempotent, meaning it can be executed multiple times as long as the
response remains the same. Otherwise an `stub-error` is returned:

```wit
variant stub-error {
    /// Conflict can happen when a second writer attempts to stub a value, while the
    /// value is not equal to the already stubbed value.
    conflict,
}
```

An {{ github(title="example stub workflow", path="crates/testing/test-programs/stub/workflow") }} is
available in the repository.

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
