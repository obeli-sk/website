+++
title = "Runtime Suppport"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Obelisk provides built-in runtime support functions that can be accessed by {{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}. These functions offer essential capabilities like logging, random number generation, creating {{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}, and, crucially, the ability to pause workflow execution (`sleep`). {{ doc_link(title="Activities", path="concepts/activities.md") }} and {{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }} have access to logging support functions, but *not* to the other workflow-specific functions.

## Available Support Functions

The runtime support functions are defined using [WIT (WebAssembly Interface Type)](https://component-model.bytecodealliance.org/design/wit.html) files.  Here's a breakdown of the available functions, grouped by their WIT interface:

### [`obelisk:log@1.0.0`](https://github.com/obeli-sk/obelisk/blob/main/wit/obelisk_log%401.0.0/log%401.0.0.wit) (Logging)

This interface provides standard logging functions, available to workflows, activities, and webhook endpoints. All messages are strings.

Example (Rust):
```rust
use obelisk::log::log;

log::info("This is an informational message.");
log::error("This is an error message!");
```

### [`obelisk:workflow@1.1.0`](https://github.com/obeli-sk/obelisk/blob/main/wit/obelisk_workflow%401.1.0/workflow-support%401.1.0.wit) (Workflow-Specific Support)
This interface provides functions that are only available to workflows.


* `random-u64(min: u64, max-exclusive: u64) -> u64`: Generates a pseudo-random unsigned 64-bit integer within the specified range [min, max-exclusive). The max-exclusive value is not included in the possible results.

* `random-u64-inclusive(min: u64, max-inclusive: u64) -> u64`: Generates a pseudo-random unsigned 64-bit integer within the specified inclusive range [min, max-inclusive]. The max-inclusive value is included in the possible results.

* `random-string(min-length: u16, max-length-exclusive: u16) -> string`: Generates a pseudo-random alphanumeric string (containing uppercase and lowercase letters, and digits) with a length between min-length (inclusive) and max-length-exclusive (exclusive).

* `sleep(duration: duration)`: Pauses the workflow's execution for the specified duration. This is a persistent sleep, meaning the workflow's state is saved, and execution will resume after the duration has elapsed, even if the Obelisk server restarts. This is a crucial function for implementing long-running workflows and delays. The sleep duration can be specified in milliseconds, seconds, minutes, hours, or days.

* `new-join-set-named(name: string, closing-strategy: closing-strategy) -> join-set-id`: Creates a new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with a user-provided name.

* `new-join-set-generated(closing-strategy: closing-strategy) -> join-set-id`: Creates a new {{ doc_link(title="join set", path="concepts/workflows/join-sets.md") }} with an automatically generated, unique name.

  * `closing-strategy`: An enum defining how a join set behaves when the workflow finishes:

    * `complete`: All child executions that were submitted to the join set but not yet awaited will be awaited before the workflow completes. This is the default and currently the only supported behavior.



Example (Rust):
```rust
use obelisk::workflow::workflow_support::*;
use obelisk::types::time::Duration;

// Persistently sleep for 5 seconds
sleep(Duration::Seconds(5));

// Generate a random number between 1 and 10 (inclusive)
let random_num = random_u64_inclusive(1, 10);

// Create a named join set
let join_set_id = new_join_set_named("my_join_set", ClosingStrategy::Complete);
```
