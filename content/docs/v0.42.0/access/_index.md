+++
title = "Access"
template = "docs.html"
sort_by = "weight"
weight = 50
+++

Obelisk is operated through the `obelisk` command line tool or through the API server, which serves
both gRPC and HTTP. The CLI covers generating and verifying configuration, running the server,
submitting deployments, and inspecting executions. The API exposes the same operations to scripts
and other services. Every API request needs a token; see
{{ doc_link(title="Authentication", path="access/authentication.md") }}.
