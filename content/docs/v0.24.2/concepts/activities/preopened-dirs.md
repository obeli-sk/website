+++
title = "Preopended directory suppport"
template = "docs.html"
weight = 30  #  Lower weights appear first
+++

Disk IO must be explicitly enabled globally in the {{ doc_link(title="configuration", path="configuration.md#global-preopened-directories-configuration") }} using `directories.enabled = true` setting.

When enabled, the activity will be able to read and write to `.` (guest current directory).

Example of listing the current directory:
```rust
fn ls() -> Vec<String> {
    let mut entries = std::fs::read_dir(".")
        .expect("read_dir failed")
        .map(|res| res.map(|e| e.path().to_string_lossy().into_owned()))
        .collect::<Result<Vec<_>, _>>()
        .expect("iterating over folder failed");
    entries.sort();
    println!("ls:");
    println!("{entries:?}");
    entries
}
```

The {{ doc_link(title="configuration", path="configuration.md#preopended-directory-support") }} contains more information on how to configure the host path and cleanup.

More examples are in
{{ github(title="directory test activity", path="crates/testing/test-programs/dir/activity/src/lib.rs") }} .
