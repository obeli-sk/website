+++
title = "Process API"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

The **experimental** WIT interface
{{ github(title="`obelisk:activity/process@1.0.0`", path="wit/obelisk_activity%401.0.0/process.wit") }}
allows activities to spawn, wait for, kill etc. a local process.

Disk IO must be explicitly enabled globally in the
{{ doc_link(title="configuration", path="configuration.md#global-preopened-directories-configuration") }}
using `directories.enabled = true` setting. The Process Spawn API must be enabled for the specific
activity using `directories.process_provider = "native"`
{{ doc_link(title="setting", path="configuration.md#process-spawn-api") }}.

The `native` process provider executes spawned processes in a process group. Server attempts to kill
the whole process group when the activity is terminated.

Example of running `touch somefile`:

```rust
// Idempotently create a file.
let process = process_support::spawn(
    "touch",
    &process_support::SpawnOptions {
        args: vec!["somefile".to_string()],
        environment: vec![],
        current_working_directory: None,
        stdin: process_support::Stdio::Discard,
        stdout: process_support::Stdio::Discard,
        stderr: process_support::Stdio::Discard,
    },
)?;
println!("Waiting for {}", process.id());
let exit_status = process.wait()?;
ensure!(exit_status == Some(0));
```

Idempotency of each file IO operation is needed only when `reuse_on_retry` is enabled in the
{{ doc_link(title="configuration", path="configuration.md#preopended-directory-support") }}.

More examples can be found in the
{{ github(title="process example activity", path="crates/testing/test-programs/process/activity/src/lib.rs") }}.
