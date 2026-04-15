+++
title = "Obelisk 0.25.4 and handling of WASM traps"
date = 2025-10-06
+++

Obelisk is an open-source deterministic workflow engine that runs, stores, and replays WASM-based
workflows using SQLite.

The headline change in **v0.25**: every function in workflows and activities is now required to be
fallible. Obelisk maps `execution-failed` errors into the called function's return type. This
ensures traps and errors are handled explicitly instead of silently breaking execution.

<!-- more -->

## Breaking API Changes

Each function invoked by Obelisk, whether a workflow or an activity, must be fallible. More
precisely, it means that the return type must be one of following:

- `result` or `result<T>` where `T` is any success type, e.g. `string` or `list<u32>` or even a none
  type (`_`) In Rust, the execution failure will be represented as `Err(())`
- `result<T, string>` - the execution failure will be represented as `Err("execution-failed")`
- `result<T, E>` where `E` is a `variant` type (similar to Rust's `enum`) that includes an
  `execution-failed` variant. The execution failure will be represented as
  `Err(MyError::ExecutionFailed)`

Previously, functions were free to return any WIT-supported value. However, this flexibility caused
issues:

- Activities could fail if a function `trap`ped (panicked) or timed out with no retries left.
- Workflows could fail when a function `trap`ped

This was previously mitigated with the `execution-failed` error. The parent execution had to choose
between:

- Calling an {{ doc_link(title="extension funcion", path="concepts/extensions.md") }} such as
  `-invoke` or `-await-next`, then handling the error, or
- Calling the child function directly, in which case the error was unhandled.

In the latter case, the parent execution itself would abort with an "Unhandled child execution
error".

This design added complexity for both workflow authors and the runtime. Workflow authors had to
decide whether a child’s execution error was fatal or if cleanup or compensation should follow.

Mistakingly calling a child function directly could mean resources were never freed, making
workflows brittle.

The runtime faced similar complexity, especially around join set closing. It was unclear whether an
`execution-failed` during a
{{ doc_link(title="Join Set Close", path="concepts/workflows/join-sets.md#join-set-close") }} should
be treated as fatal for the parent workflow or simply ignored as other unawaited execution results.

With the new design, the runtime maps `execution-failed` to one of the supported error types. It
builds on the strength of the WASM isolation - effectively making each invocation live in its own
"blast zone", so that even unusual errors like running out of memory will not affect the caller.

When handling such errors, not every activity failure needs to derail the workflow. For example, if
an email-sending activity fails with `execution-failed`, the email may not be sent, but the workflow
can still continue without issue.

If an activity is crucial, the workflow must exit. Making the error handling explicit has one big
advantage especially for sagas: Since it is now impossible to overlook this kind of error, the
workflow must now choose whether to abort all further actions or whether a compensating logic should
be applied. This could include shutting down VMs or other resources that must not be left in an
unknown state.

In conclusion, the new requirement for fallible functions simplifies both workflow authoring and
runtime behavior. By mapping `execution-failed` errors into the called function's return type,
workflows become safer, more predictable, and easier to reason about, allowing developers to handle
failures explicitly and reliably without risking hidden resource leaks or unexpected early returns.

## Ergonomics changes

Other changes are mostly focused on CLI:

- `obelisk generate wit-support` was added to export the Obelisk WIT files. These files are required
  for working with extensions and include workflow support functions. See
  {{ doc_link(title="CLI command", path="cli.md#obelisk-generate") }} for details.
- `-invoke` extension now accepts a join set label. With execution-error removed, this function was
  repurposed to attach a label to its one-off join set. This is especially useful when calling the
  same function with different parameters, as custom join set names make it easier to understand a
  workflow’s pending state without inspecting the execution log.
- A new {{ doc_link(title="runtime support", path="concepts/runtime-support.md") }} function,
  `close(join-set)`, was added. In garbage-collected languages, join set resources aren’t
  automatically dropped, so this explicit function in workflow-support ensures proper cleanup.
- The `obelisk client execution submit` command now supports the shorthand
  `.../interface-name.fn-name` for specifying functions in addition to the
  {{ doc_link(title="FFQN", path="concepts/ffqn.md#function-fully-qualified-name-ffqn") }} format.
- Minor usability improvements have been made to the WebUI.
