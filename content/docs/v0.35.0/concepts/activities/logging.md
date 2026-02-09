+++
title = "Logging, debugging, testing"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

To understand the internal state of an activity, you can use the following:

* `printf` style debugging: enable `forward_stdout` or `forward_stderr` in the `[[activity]]` section of the {{ doc_link(title="configuratin", path="configuration.md") }}. Output will appear in the server log.
* `obelisk:log` API - see {{ doc_link(title="Runtime Support", path="concepts/runtime-support.md") }}

Unit and integration testing is possible with Cargo's test harness.

The [stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/activity) repository contains unit and integration tests for activities.
