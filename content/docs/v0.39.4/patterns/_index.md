+++
title = "Common Design Patterns"
template = "docs_toc.html"
sort_by = "weight"
weight = 15
+++

Reusable workflow structures for resource ownership, concurrency, durable waiting, and operator
interaction.

- {{ doc_link(title="Cleanup supervisor (saga)", path="patterns/cleanup-supervisor.md") }} — keep
  resource creation and cleanup in a small parent workflow while complex work runs in a child.
- {{ doc_link(title="Parallel fan-out and durable polling", path="js/js-patterns.md") }} — submit
  independent work through join sets and poll external state with bounded durable sleeps.
- {{ doc_link(title="Human-in-the-loop signals", path="concepts/activities/stub.md") }} — use stub
  activities for approvals, operator input, and external signals.
