+++
title = "Runtime Suppport"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Obelisk provides built-in runtime support functions that can be accessed by
{{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}. These functions offer
essential capabilities like logging, random number generation, creating
{{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}, and, crucially, the
ability to pause workflow execution (`sleep`).
{{ doc_link(title="Activities", path="concepts/activities/_index.md") }} and
{{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }} have access to
logging support functions, but _not_ to the other workflow-specific functions.

## Available Support Functions

The runtime support functions are defined using
[WIT (WebAssembly Interface Type)](https://component-model.bytecodealliance.org/design/wit.html)
files. Here's a breakdown of the available functions, grouped by their WIT interface:

### {{ github(title="`obelisk:log/log@1.0.0`", path="wit/obelisk_log%401.0.0/log%401.0.0.wit") }}

Available to:

- activities
- workflows
- webhooks

This interface provides standard logging functions. All messages are strings.

Example (Rust):

```rust
use obelisk::log::log;

log::info("This is an informational message.");
log::error("This is an error message!");
```

### {{ github(title="`obelisk:workflow/workflow-support@2.0.0`", path="wit/obelisk_workflow%402.0.0/workflow-support%402.0.0.wit") }}

Available to:

- workflows

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

- `sleep(duration: duration)`:
  {{ doc_link(title="Persistently", path="concepts/workflows/persistent-sleep.md") }} pauses the
  workflow's execution for the specified duration. The sleep duration can be specified in
  milliseconds, seconds, minutes, hours, or days.

- `submit-delay: func(join-set-id: borrow<join-set-id>, timeout: schedule-at) -> delay-id`: Submit a
  delay request to the join set. The delay can be later polled using `join-next`.

- `new-join-set-named(name: string, closing-strategy: closing-strategy) -> result<join-set-id, join-set-create-error>`:
  Creates a new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with a
  user-provided name.

- `new-join-set-generated(closing-strategy: closing-strategy) -> join-set-id`: Creates a new
  {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with an automatically
  generated, unique name.
  - `closing-strategy`: An enum defining how a join set behaves when the workflow finishes:
    - `complete`: All child executions that were submitted to the join set but not yet awaited will
      be awaited before the workflow completes. This is the default and currently the only supported
      behavior.

- `join-next: func(join-set-id: borrow<join-set-id>) -> result<response-id, join-next-error>`: Block
  the workflow execution until next response associated with the join set arrives. The response is
  marked as processed. Child execution result can be obtained using `-get` extension function using
  the returned execution ID. Return `none` if the join set has all requests matched with responses.

Example (Rust):

```rust
use obelisk::workflow::workflow_support::*;
use obelisk::types::time::Duration;

// Persistently sleep for 5 seconds
sleep(Duration::Seconds(5));

// Generate a random number between 1 and 10 (inclusive)
let random_num = random_u64_inclusive(1, 10);

// Create a named join set
let join_set_id = new_join_set_named("my_join_set", ClosingStrategy::Complete).unwrap();
```

### {{ github(title="`obelisk:activity/process@1.0.0`", path="wit/obelisk_activity%401.0.0/process.wit") }}

Available to:

- activities

The `process` WIT interface allows activities to spawn, wait for, kill etc. a local process.

See {{ doc_link(title="Process API", path="concepts/activities/process.md") }} for details.
