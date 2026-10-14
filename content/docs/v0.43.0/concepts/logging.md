+++
title = "Logging"
template = "docs.html"
weight = 25
+++

Every component type can log. Log messages are stored in the database with the execution and shown
in the Web UI next to the execution log.

## `console` in JavaScript

JavaScript activities, workflows, and webhooks log with the familiar `console` methods. Each call
becomes one log entry with a level:

| Method          | Level   |
| --------------- | ------- |
| `console.trace` | `trace` |
| `console.debug` | `debug` |
| `console.log`   | `info`  |
| `console.info`  | `info`  |
| `console.warn`  | `warn`  |
| `console.error` | `error` |

```javascript
console.log("Processing order", orderId);
console.warn(`Retrying, attempt ${attempt}`);
```

Arguments are joined with spaces. Logging from a workflow is safe: messages are not part of the
execution log, so adding a `console.log` does not affect replay.

Rust components log through the `obelisk:log` WIT interface with the same five levels, see
{{ doc_link(title="Rust Activities", path="wasm/activities.md#logging") }}.

## `stdout`/`stderr` Forwarding

Activities and webhook endpoints can also produce byte-stream output on `stdout` and `stderr`: exec
activities print to them, and Rust components use `println!`. This output can be forwarded to the
database or to the server's console. Workflows do not support `stdout`/`stderr` forwarding.

Forwarding is controlled per component in the
{{ doc_link(title="deployment configuration", path="configuration/deployment.md") }}:

```toml
[[activity_exec]]
ffqn = "myapp:scripts/greet.greet"
# ...
forward_stdout = "db"      # One of "none"|"stdout"|"stderr"|"db". Default: "db"
forward_stderr = "db"      # One of "none"|"stdout"|"stderr"|"db". Default: "db"
```

| Value      | Behavior                                     |
| ---------- | -------------------------------------------- |
| `"db"`     | Persist the stream to the database (default) |
| `"stdout"` | Forward to the server's standard output      |
| `"stderr"` | Forward to the server's standard error       |
| `"none"`   | Discard the stream                           |

## Reading Stored Logs

Logs are visible in the Web UI on the execution detail page, and can be followed from the CLI with
`obelisk execution submit --follow-logs`. They can also be retrieved via the
{{ doc_link(title="REST API", path="access/api.md") }}. Export `OBELISK_API_TOKEN` as described in
{{ doc_link(title="Authentication", path="access/authentication.md") }} first:

```sh
curl 127.1:5005/v1/executions/<EXECUTION_ID>/logs -H 'Accept: text/plain' \
  -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

### `logs_store_min_level`

The `logs_store_min_level` setting controls the minimum level of log messages that are persisted to
the database. It can be configured per component:

```toml
[[activity_js]]
name = "my_activity"
# ...
logs_store_min_level = "debug"  # One of "off"|"trace"|"debug"|"info"|"warn"|"error"
```

The default is `"debug"`, which stores all messages at debug level and above. Set to `"off"` to
disable log persistence entirely, or to `"info"` to reduce storage in high-throughput scenarios.
This setting applies to activities, workflows, and webhook endpoints.
