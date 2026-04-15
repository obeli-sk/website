+++
title = "Runtime Suppport"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

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
{{ doc_link(title="extension", path="concepts/extensions.md") }}, contains `time` and `execution`
interfaces with types like `execution-id` and others.

### {{ github(title="`obelisk:types/types@4.1.0`", path="wit/obelisk_types%404.1.0/types.wit") }}

## Available Support Functions

Here's a breakdown of the available functions, grouped by their WIT interface:

### {{ github(title="`obelisk:log/log@1.0.0`", path="wit/obelisk_log%401.0.0/log.wit") }}

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

### {{ github(title="`obelisk:workflow/workflow-support@4.1.0`", path="wit/obelisk_workflow%404.1.0/workflow-support.wit") }}

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

- `sleep: func(schedule-at: schedule-at) -> result<datetime>`:
  {{ doc_link(title="Persistently pauses", path="concepts/workflows/persistent-sleep.md") }} the
  workflow's execution for the specified duration. The sleep duration can be specified in
  milliseconds, seconds, minutes, hours, or days. The successful returned value represents the time
  when the durable sleep expires, error indicates the delay was cancelled.

- `join-set-create: func() -> join-set`: Creates a new
  {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with an automatically
  generated, unique name.

- `join-set-create-named: func(name: string) -> result<join-set, join-set-create-error>`: Creates a
  new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with a user-provided
  name.

- `join-set-close: func(join-set: join-set)`:
  {{ doc_link(title="Closes", path="concepts/workflows/join-sets.md#join-set-close") }} the join
  set.

- `submit-delay: func(join-set: borrow<join-set>, timeout: schedule-at) -> delay-id`: Submit a delay
  request to the join set. The delay can be later polled using `join-next`.

- `join-next: func(join-set: borrow<join-set>) -> result<tuple<response-id, result>, join-next-error>`:
  Block the workflow execution until next response associated with the join set arrives. The
  response is marked as processed. Child execution result can be obtained using `-get` extension
  function using the returned execution ID. Return `join-next-error::all-processed` if the join set
  has all requests matched with responses already processed.

- `join-next-try: func(join-set: borrow<join-set>) -> result<tuple<response-id, result>, join-next-try-error>`:
  Non-blocking variant of `join-next`. Attempts to process the next response without blocking.
  Return `join-next-try-error::pending` if no response is available yet but there are pending
  requests. Return `join-next-try-error::all-processed` if all requests have been matched with
  responses already processed.

- `submit-json: func(join-set: borrow<join-set>, function: function, params: string, config: option<submit-config>) -> result<execution-id, submit-json-error>`:
  Submit a child execution request with its parameters serialized as a JSON array. This enables
  dynamic function dispatch without compile-time bindings. The optional `submit-config` record can
  override activity timeout.

- `get-result-json: func(execution-id: execution-id) -> result<result<option<string>, option<string>>, get-result-json-error>`:
  Obtain a child execution result as JSON after it has been awaited using `-await-next` extension or
  `join-next`.

### Join set resource functions

- `id: func() -> string`: Get the join set identifier in the form of:
  - `o:NAME` in case of a one-off join set, where `NAME` is generally an auto-incremented index
    optionally followed by underscode and a supplied name,
  - `g:NAME` in case of a generated join set where `NAME` is generally an auto-incremented index,
  - `n:NAME` in case of a named join

- `submit-delay: func(timeout: schedule-at) -> delay-id`: _Deprecated in 4.1.0, moved to a
  standalone function in `workflow-support`._ Submit a delay request to the join set.

- `join-next: func() -> result<tuple<response-id, result>, join-next-error>`: _Deprecated in 4.1.0,
  moved to a standalone function in `workflow-support`._ Block the workflow execution until next
  response arrives.

### {{ github(title="`obelisk:activity/process@1.0.0`", path="wit/obelisk_activity%401.0.0/process.wit") }}

Available to: {{ doc_link(title="Activities", path="concepts/activities/_index.md") }}

The `process` WIT interface allows activities to spawn, wait for, kill etc. a local process.

See {{ doc_link(title="Process API", path="concepts/activities/process.md") }} for details.
