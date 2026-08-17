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
- {{ doc_link(title="Durable mailbox and notification channel", path="patterns/stub-mailbox.md") }}
  — keep an always-outstanding offer stub as an inbox and self-fulfil a second stub as a progress
  outbox, sharing one WIT folder between the workflow and its stubs.
- {{ doc_link(title="Stub RPC (typed oneshot channels)", path="patterns/stub-rpc.md") }} — pair two
  stubs into request/response RPC that bridges a synchronous webhook onto a durable workflow.
- {{ doc_link(title="Self-fulfilled stub events", path="patterns/self-fulfilled-stub-events.md") }}
  publishes structured intermediate workflow output by submitting and immediately fulfilling a stub.
