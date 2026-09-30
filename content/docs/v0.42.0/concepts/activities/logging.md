+++
title = "Logging, debugging, testing"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

## Logging

For a comprehensive guide to logging from all component types, see the
{{ doc_link(title="Logging", path="concepts/logging.md") }} page.

In summary:

- **`obelisk:log` interface** (preferred): Structured string-based logging with log levels (`trace`,
  `debug`, `info`, `warn`, `error`). Available to activities, workflows, and webhook endpoints.
- **`stdout`/`stderr` forwarding**: Byte-stream output from `println!` and similar. Available to
  activities and webhook endpoints only. Controlled by `forward_stdout` and `forward_stderr` in the
  {{ doc_link(title="deployment configuration", path="configuration/deployment.md") }}.

## Debugging and Testing

Unit and integration testing is possible with Cargo's test harness.

The [stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/activity) repository
contains unit and integration tests for activities.
