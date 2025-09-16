+++
title = "Frequently Asked Questions"
template = "faq.html"
+++

### What does determinism mean in the context of a workflow engine?

Determinism means that a system always produces the same result given the same initial parameters and inputs.
The outcome is fully determined by cause and effect, with no randomness or uncertainty.

Many popular workflow engines like GitHub Actions use a purely declarative model (YAML), where workflow state is managed explicitly.
These engines move state between dependent jobs or workflows by explicitly passing input/output data, typically through artifacts
or environment variables. However, embedding logic such as conditionals, abstracting common steps,
and performing refactorings can be cumbersome in this model.

In contrast, when a workflow is written as a function composed of many steps in a general-purpose language,
the engine must capture all non-deterministic calls with side effects, so that the workflow can be interrupted,
restarted, and replayed at any time. This enables reliable crash recovery, transparent retries, and the ability
to unload long-running workflows from memory while waiting for results or timeouts.

Deterministic execution therefore requires that all workflow state - including child executions' parameters and
their results - be persisted in an execution log.

### When does a code change break determinism?

Determinism of a workflow is evaluated from the perspective of the database.
Pausing an execution and replaying it with updated code may trigger a 'nondeterminism detected' error, however
not all code changes cause issues.

As long as the code produces the same sequence of events as the previous version,
refactoring or minor tweaks such as changing log statements will not trigger the nondeterminism error.
The new code may diverge from the old code only
after successfully replaying all events stored in the execution log.

### What is the difference between a workflow and an activity?

A <a href="{{ get_url(path='@/docs/latest/concepts/workflows/_index.md') }}">workflow</a> is your deterministic,
side‑effect‑free orchestration logic.

An <a href="{{ get_url(path='@/docs/latest/concepts/activities/_index.md') }}">activity</a> is a unit of work that does produce side
effects using HTTP requests, file I/O or child processes. Activities must be idempotent(retriable) so the runtime can safely and
transparently retry them on failure. The workflow invokes activities, waits for their results, and then continues its logic based
on those results.

### What happens when the system crashes during operation?

After a crash (or restart/update), the Obelisk runtime:

1. **Restarts** each in-progress workflow from scratch with the same initial parameters.

2. **Replays** each completed activity’s recorded result from the execution log.

3. **Retries** any activity whose result wasn’t yet persisted when the crash occurred - another reason why activities must be idempotent.

###  How to do a cleanup after an activity permanently failed?

Obelisk doesn’t yet offer built‑in saga support, so you handle compensation logic directly in your workflow. In practice, you wrap
activities in a try/catch (or equivalent) block: if an activity exhausts its retries and fails, invoke the compensating activity to
roll back or clean up any side effects and continue or exit the workflow function.
