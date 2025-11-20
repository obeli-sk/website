+++
title = "Frequently Asked Questions"
template = "faq.html"
+++

### Why are deterministic workflow engines awesome?

A workflow engine is designed to handle long-running and durable processes.
Workflow is a function, but it can execute for months or even years and
may pause for events such as human approval.
Durability ensures that workflows can survive failures over time,
maintaining consistency and reliability throughout their execution.
This makes workflow engines essential in most SaaS systems, where tasks
cannot afford to lose progress, even during server crashes or restarts.

A good example is infrastructure provisioning and lifecycle management.
In this context, the **workflow** defines and orchestrates the sequence of steps, such as creating virtual machines,
configuring software, etc., while making decisions based on **activity** results.
The **workflow engine**, in contrast, handles the execution details:
spawning and coordinating executions, managing retries and persisting state between steps.
This separation allows workflows to focus solely on imperatively invoking child workflows and activities,
while the engine transparently handles persistence, retries, and replay.

### What is the difference between a workflow and an activity?

A <a href="{{ get_url(path='@/docs/latest/concepts/workflows/_index.md') }}">workflow</a> is a deterministic, side‑effect‑free orchestration logic.

An <a href="{{ get_url(path='@/docs/latest/concepts/activities/_index.md') }}">activity</a> is a unit of work that produces side
effects using HTTP requests, file I/O or OS processes. Activities must be idempotent (retriable) so the runtime can safely and
transparently retry them on failure. Once an activity successfully finishes and is checkpointed, it is never re-executed.
However, even if it succeeds, it may be retried if the server crashes before persisting its result.

### What does determinism mean in the context of a workflow engine?

Determinism means that a system always produces the same result given the same initial parameters and inputs.
The outcome is fully determined by cause and effect, with no randomness or uncertainty.

Many popular workflow engines like GitHub Actions use a purely declarative model (YAML), where workflow state is managed explicitly.
These engines move state between dependent jobs or workflows by passing input/output data, typically through artifacts
or environment variables. However, embedding logic such as conditionals, abstracting common steps,
and performing refactorings can be cumbersome in this model.

In contrast, when a workflow is written as a function composed of many steps in a general-purpose language,
the engine must capture and persist all non-deterministic, side-effecting calls with side effects, so that the workflow can be interrupted,
restarted, and replayed later. This enables reliable crash recovery, transparent retries, and the ability
to unload long-running workflows from memory while waiting for results or timeouts.

The engine therefore persists the entire workflow state, including child executions' parameters and
their results in an execution log.

During replay, it verifies that the events produced by the workflow match the log and halts execution if any discrepancy is found.

### When does a code change break determinism?

Determinism of a workflow is evaluated from the perspective of the database.
Pausing an execution and replaying it with updated code may trigger a 'nondeterminism detected' error, however
not all code changes cause issues.

As long as the code produces the same sequence of events as the previous version,
refactoring or minor tweaks such as changing log statements will not trigger the nondeterminism error.
The new code may diverge from the old code only
after successfully replaying all events stored in the execution log.

### What happens when the system crashes during operation?

After a crash (or restart/update), the Obelisk runtime:

1. **Restarts** each in-progress workflow from scratch with the same initial parameters.

2. **Replays** each completed activity’s recorded result from the execution log.

3. **Retries** any activity whose result wasn’t yet persisted when the crash occurred.

###  How to do a cleanup after an activity permanently failed?

If an activity exhausts its retries and fails, the workflow must invoke the compensating activity to
roll back or clean up any side effects and continue or exit the workflow function.
Check out this video on
<a target="_blank" href="https://www.youtube.com/watch?v=0UTOLRTwOX0">Distributed sagas</a> for details.

### What is the relation to AI

Workflows can integrate AI seamlessly by treating large language model (LLM) calls as regular HTTP activities —
for example, for data enrichment, summarization, or classification.

At the same time,
Obelisk is well-suited for building agentic systems by combining deterministic control with AI-driven reasoning.
Its persistence provides full auditability of every step, while its structure cleanly separates precise,
mechanical operations like setup and cleanup from the open-ended agentic loop powered by LLMs.
Human operators can intervene at any time through events to adjust or halt behavior, making
Obelisk a reliable and controllable foundation for building AI agents.
