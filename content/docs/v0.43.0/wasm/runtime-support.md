+++
title = "Runtime Support Interfaces"
template = "docs.html"
weight = 35
+++

This page is the WIT reference of the host functions that Rust components import. JavaScript
components use the `obelisk:workflow@1.0.0` and `obelisk:webhook@1.0.0` modules instead, see
{{ doc_link(title="JS Workflows", path="js/js-workflows.md") }} and
{{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }}.

Obelisk provides built-in runtime support functions that can be accessed by
{{ doc_link(title="workflows", path="concepts/workflows/_index.md") }} and
{{ doc_link(title="activities", path="concepts/activities/_index.md") }}.

These functions offer essential capabilities like logging, random number generation, creating
{{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}, and, others.
{{ doc_link(title="Activities", path="concepts/activities/_index.md") }} and
{{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }} have access to
logging support functions, but _not_ to the other workflow-specific functions.

The runtime support functions are defined using
[WIT (WebAssembly Interface Type)](https://component-model.bytecodealliance.org/design/wit.html)
files.

## Available Support Types

Used by other Obelisk WIT interfaces as well as the generated
{{ doc_link(title="extension", path="wasm/extensions.md") }}, contains `time` and `execution`
interfaces with types like `execution-id` and others.

Generated WIT uses types `6.1.0` and workflow/webhook `7.1.0`. Existing imports of types `6.0.0` and
workflow/webhook `7.0.0` remain accepted.

### {{ github(title="`obelisk:types@6.1.0`", path="wit/obelisk_types%406.1.0/obelisk_types%406.1.0.wit", version="v0.43.0-rc.8") }}

The `function` record is in the dedicated `obelisk:types/function@6.1.0` interface. It is no longer
defined by the `execution` interface.

## Available Support Functions

Here's a breakdown of the available functions, grouped by their WIT interface:

### {{ github(title="`obelisk:log/log@1.0.0`", path="wit/obelisk_log%401.0.0/obelisk_log%401.0.0.wit", version="v0.43.0-rc.8") }}

Available to:

- {{ doc_link(title="activities", path="concepts/activities/_index.md") }}
- {{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}
- {{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }}

This interface provides standard logging functions. All messages are strings.

Example (Rust):

```rust
use obelisk::log::log;

log::info("This is an informational message.");
log::error("This is an error message!");
```

### {{ github(title="`obelisk:workflow/workflow-support@7.1.0`", path="wit/obelisk_workflow%407.1.0/obelisk_workflow%407.1.0.wit", version="v0.43.0-rc.8") }}

Available to:

- {{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}

Some of these functions act like host-based activities - they avoid the need to spawn a WASM
activity to obtain e.g. a random number. Other functions are related to
{{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }} and
{{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} construction.

- `random-u64(min: u64, max-exclusive: u64) -> u64`: Generates a pseudo-random unsigned 64-bit
  integer within the specified range [min, max-exclusive). The max-exclusive value is not included
  in the possible results.

- `random-u64-inclusive(min: u64, max-inclusive: u64) -> u64`: Generates a pseudo-random unsigned
  64-bit integer within the specified inclusive range [min, max-inclusive]. The max-inclusive value
  is included in the possible results.

- `random-string(min-length: u16, max-length-exclusive: u16) -> string`: Generates a pseudo-random
  alphanumeric string (containing uppercase and lowercase letters, and digits) with a length between
  min-length (inclusive) and max-length-exclusive (exclusive).

- `sleep: func(schedule-at: schedule-at, name: option<string>) -> result<datetime>`:
  {{ doc_link(title="Persistently pauses", path="concepts/workflows/persistent-sleep.md") }} the
  workflow's execution for the specified duration. The sleep duration can be specified in
  milliseconds, seconds, minutes, hours, or days. The optional `name` names the one-off join set the
  delay is submitted to. The successful returned value represents the time when the durable sleep
  expires, error indicates the delay was cancelled.

- `join-set-create: func() -> join-set`: Creates a new
  {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with an automatically
  generated, unique name.

- `join-set-create-named: func(name: string) -> result<join-set, join-set-create-error>`: Creates a
  new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with a user-provided
  name.

- `join-set-close: func(join-set: join-set)`:
  {{ doc_link(title="Closes", path="concepts/workflows/join-sets.md#join-set-close") }} the join
  set. Has no error result.

- `submit-delay: func(join-set: borrow<join-set>, timeout: schedule-at) -> delay-id`: Submit a delay
  request to the join set. The delay can be later polled using `join-next`.

- `join-next: func(join-set: borrow<join-set>) -> result<result<option<string>, option<string>>, join-next-error>`:
  Block the workflow execution until the next response associated with the join set arrives. The
  response is marked as processed and its value is returned **directly** as the **inner** result.
  That inner result is the child's JSON-encoded ok/err response: the `option<string>` holds the
  JSON-encoded value, or is `none` when that arm has no payload. So `ok(some(json))` / `ok(none)` is
  an ok result (`ok(none)` also for an expired delay), and `err(some(json))` / `err(none)` is an err
  result (`err(none)` also for a cancelled delay). Read `join-set.last-id` for the id of the
  processed response and `get-execution-failure-kind` for a child's platform failure kind. The
  **outer** result returns `join-next-error::all-processed` if the join set has all requests matched
  with responses already processed.

- `join-next-try: func(join-set: borrow<join-set>) -> result<result<option<string>, option<string>>, join-next-try-error>`:
  Non-blocking variant of `join-next`. Attempts to process the next response without blocking. On
  success the **inner** result is the same JSON-encoded ok/err response described above. The outer
  result returns `join-next-try-error::pending` if no response is available yet but there are
  pending requests, or `join-next-try-error::all-processed` if all requests have been matched with
  responses already processed.

- `get-result-json: func(execution-id: execution-id) -> result<result<option<string>, option<string>>, get-result-json-error>`:
  Obtain a child execution result as JSON after it has been awaited using `-await-next` extension or
  `join-next`.

- `get-execution-failure-kind: func(execution-id: execution-id) -> result<option<execution-failure-kind>, get-result-json-error>`:
  The platform-level failure kind (`timed-out`, `nondeterminism-detected`, `out-of-fuel`,
  `cancelled`, `value-too-large`, or `uncategorized`) of an already-processed child response, or
  `none` if it finished with an ok or business `err` result. This is additive to the err value,
  which keeps carrying the failure sentinel.

- `last-direct-call-id: func() -> option<execution-id>`: The execution ID of the last direct call
  (`call-json`), or `none`. Unlike `last-oneoff-id`, it is never a delay and is not clobbered by an
  intervening `sleep`. Pair with `get-execution-failure-kind` to resolve the last direct call's
  failure kind.

- `last-oneoff-id: func() -> option<response-id>`: The `response-id` of the last one-off operation
  of any kind, including `sleep` (in which case it is a `delay-id`), or `none`.

- `execution-id-current: func() -> execution-id`: The execution ID of the current workflow
  invocation.

### Dynamic workflow support

Runtime-selected dispatch is isolated in `obelisk:workflow/workflow-dynamic-support@7.1.0`. Import
it only when a native workflow constructs FFQNs at runtime. It provides `submit-json`,
`schedule-json`, and `call-json`; submission and scheduling can return `value-too-large` in addition
to parsing, lookup, and type-check errors.

Webhook components use `obelisk:webhook/webhook-support@7.1.0` for execution lookup and ID helpers,
and `obelisk:webhook/webhook-dynamic-support@7.1.0` for runtime-selected calls and schedules.

### Join set resource functions

- `id: func() -> string`: Get the join set identifier in the form of:
  - `o:NAME` in case of a one-off join set, where `NAME` is generally an auto-incremented index
    optionally followed by underscode and a supplied name,
  - `g:NAME` in case of a generated join set where `NAME` is generally an auto-incremented index,
  - `n:NAME` in case of a named join

- `last-id: func() -> option<response-id>`: The `response-id` of the last processed response of this
  join set (the one returned by the most recent `join-next` / `-await-next`), or `none` if no
  response has been processed yet. Must be read immediately after `join-next`, before the next one.
  An `execution-id` marks a child response; a `delay-id` marks a delay.

### Backtrace variants

Native components import the plain `workflow-support` interface, whose functions take **no**
`backtrace` parameter. The backtrace-carrying variants of the event-persisting functions live in a
separate `workflow-support-backtrace` interface that only interpreted runtimes (the native JS
runtime) import; native components never touch it.
