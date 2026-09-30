+++
title = "Logging"
template = "docs.html"
weight = 25
+++

Obelisk provides two mechanisms for logging from WASM components: the structured `obelisk:log`
interface and `stdout`/`stderr` stream forwarding.

## `obelisk:log` Interface

The preferred way to emit log messages is through the
{{ github(title="`obelisk:log/log@1.0.0`", path="wit/obelisk_log%401.0.0/log.wit") }} WIT interface.
It is available to all component types:
{{ doc_link(title="activities", path="concepts/activities/_index.md") }},
{{ doc_link(title="workflows", path="concepts/workflows/_index.md") }}, and
{{ doc_link(title="webhook endpoints", path="concepts/webhook-endpoints.md") }}.

The interface provides five log levels:

```wit
package obelisk:log@1.0.0;

interface log {
    trace: func(message: string);
    debug: func(message: string);
    info: func(message: string);
    warn: func(message: string);
    error: func(message: string);
}
```

### Usage in WIT

Import the interface in your component's WIT world:

```wit
package my:component;

world my-world {
    import obelisk:log/log@1.0.0;
    // ... other imports and exports
}
```

Alternatively, generate the WIT support files using the CLI:

```sh
obelisk generate wit-support <COMPONENT_TYPE> <OUTPUT_DIRECTORY>
```

### Usage in Rust

```rust
use obelisk::log::log;

log::info("Processing request");
log::debug(&format!("Input: {input:?}"));
log::error("Something went wrong");
```

Each message is a `string`, so use `format!` for dynamic content.

## `stdout`/`stderr` Forwarding

Activities and webhook endpoints can also produce output via `stdout` and `stderr` (e.g., `println!`
in Rust). This byte-stream output can be forwarded to the database or to the server's console.

Workflows do not support `stdout`/`stderr` forwarding — use `obelisk:log` instead.

Forwarding is controlled per component in the
{{ doc_link(title="deployment configuration", path="deployment-configuration.md") }}:

```toml
[[activity_wasm]]
name = "my_activity"
location = "my_activity.wasm"
forward_stdout = "db"      # One of "none"|"stdout"|"stderr"|"db". Default: "db"
forward_stderr = "db"      # One of "none"|"stdout"|"stderr"|"db". Default: "db"
```

| Value      | Behavior                                     |
| ---------- | -------------------------------------------- |
| `"db"`     | Persist the stream to the database (default) |
| `"stdout"` | Forward to the server's standard output      |
| `"stderr"` | Forward to the server's standard error       |
| `"none"`   | Discard the stream                           |

## Persistent Log Storage

Both `obelisk:log` messages and forwarded `stdout`/`stderr` streams can be stored in the database.
Stored logs can be retrieved via the {{ doc_link(title="WebAPI", path="programmatic-access.md") }}.
Export `OBELISK_API_TOKEN` as described in
{{ doc_link(title="Authentication", path="authentication.md") }} first:

```sh
curl 127.1:5005/v1/executions/<EXECUTION_ID>/logs -H 'Accept: text/plain' \
  -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

Logs are also visible in the Web UI on the execution detail page.

### `logs_store_min_level`

The `logs_store_min_level` setting controls the minimum log level of `obelisk:log` messages that are
persisted to the database. It can be configured per component:

```toml
[[activity_wasm]]
name = "my_activity"
location = "my_activity.wasm"
logs_store_min_level = "debug"  # One of "off"|"trace"|"debug"|"info"|"warn"|"error"
```

The default is `"debug"`, which stores all messages at debug level and above. Set to `"off"` to
disable log persistence entirely, or to `"info"` to reduce storage in high-throughput scenarios.

This setting applies to all component types: `[[activity_wasm]]`, `[[workflow]]`, and
`[[webhook_endpoint]]`.

### Comparison

| Feature               | `obelisk:log`                   | `stdout`/`stderr`             |
| --------------------- | ------------------------------- | ----------------------------- |
| Available to          | Activities, workflows, webhooks | Activities, webhooks          |
| Output type           | Structured string messages      | Byte streams                  |
| Log levels            | trace, debug, info, warn, error | No levels                     |
| Level-based filtering | Yes (`logs_store_min_level`)    | No (all-or-nothing)           |
| Recommended for       | Application logging             | Legacy output, `printf` debug |
