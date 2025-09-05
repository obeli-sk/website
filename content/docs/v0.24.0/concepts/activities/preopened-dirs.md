+++
title = "Preopended directory suppport"
template = "docs.html"
weight = 30  #  Lower weights appear first
+++

Disk IO must be explicitly enabled in the {{ doc_link(title="TOML configuration", path="configuration.md") }} using `directories.enabled = true` setting.

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

The {{ doc_link(title="TOML configuration", path="configuration.md") }} contains more information on how to configure the host path and cleanup.

More examples are in [directory test activity](https://github.com/obeli-sk/obelisk/blob/main/crates/testing/test-programs/dir/activity/src/lib.rs).
