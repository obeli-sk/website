+++
title = "Logging, debugging, testing"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

To understand the internal state of an activity, you can use the following:

* **Persistent logs**: By default, `forward_stdout` and `forward_stderr` are set to `"db"`, which stores output in the database. Logs can be viewed in the Web UI or retrieved via the `GET /v1/executions/{id}/logs` {{ doc_link(title="API endpoint", path="programmatic-access.md") }}.
* **Console output**: Set `forward_stdout` or `forward_stderr` to `"stdout"` or `"stderr"` in the `[[activity_wasm]]` section of the {{ doc_link(title="configuration", path="configuration.md") }} to forward output to the server log.
* **`obelisk:log` API**: Use the logging interface for structured log messages — see {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}. Log level persistence is controlled by `logs_store_min_level` (default: `"debug"`).

Unit and integration testing is possible with Cargo's test harness.

The [stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/activity) repository contains unit and integration tests for activities.
