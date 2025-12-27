+++
title = "Persistent Sleep"
template = "docs.html"
weight = 20
+++

Persistent or durable sleep means the workflow's state is saved, and execution will resume after the duration has elapsed, even if the Obelisk server restarts.

The {{ doc_link(title="Runtime Support API", path="concepts/runtime-support.md") }} contains method `sleep` which creates an one-off {{ doc_link(title="Join Set", path="concepts/workflows/join-sets.md") }} and blocks the execution until the delay has timed out.

Another way to submit a persistent delay is to use {{ doc_link(title="Heterogenous Join Set", path="concepts/workflows/join-sets.md#heterogenous-join-sets") }} with the `submit_delay` host support function.
