+++
title = "Access"
template = "docs.html"
sort_by = "weight"
weight = 50
+++

Obelisk is operated through the `obelisk` command line tool or through the REST web API on the API
server. The CLI and the Web UI are clients of that API; gRPC is deprecated. The CLI covers
generating and verifying configuration, running the server, submitting deployments, and inspecting
executions. The API exposes the same operations to scripts and other services. Every API request
needs a token; see {{ doc_link(title="Authentication", path="access/authentication.md") }}.
