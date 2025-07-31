+++
title = "Frequently Asked Questions"
template = "faq.html"
+++

**Q:** What does **determinism** mean in the context of a workflow engine?

**A:** Determinism means that a system always produces the same result given the same initial parameters and inputs. The outcome is fully determined by cause and effect, with no randomness or uncertainty.

Many popular workflow engines like GitHub Actions use a purely declarative model (YAML), where workflow state is managed explicitly. These engines move state between dependent jobs or workflows by explicitly passing input/output data, typically through artifacts or environment variables. However, embedding logic such as conditionals, abstracting common steps, and performing refactorings can be cumbersome in this model.

In contrast, when a workflow is written as a function composed of many steps in a general-purpose language, the engine must capture all non-deterministic calls with side effects, so that the workflow can be interrupted, restarted, and replayed at any time. This enables reliable crash recovery, transparent retries, and the ability to unload long-running workflows from memory while waiting for results or timeouts.

Deterministic execution therefore requires that all workflow state - including child executions' parameters and their results - be persisted in an execution log.

**Q:** What is the difference between a **workflow** and an **activity**?

**A:** A <a href="{{ get_url(path='@/docs/latest/concepts/workflows/_index.md') }}">workflow</a> is your deterministic, side‑effect‑free orchestration logic.
<br/>
An <a href="{{ get_url(path='@/docs/latest/concepts/activities/_index.md') }}">activity</a> is a unit of work that does produce side effects using HTTP requests, file I/O or child processes. Activities must be idempotent(retriable) so the runtime can safely and transparently retry them on failure. The workflow invokes activities, waits for their results, and then continues its logic based on those results.

**Q:** What happens when the system crashes during operation?

**A:** After a crash (or restart/update), the Obelisk runtime:

1. **Restarts** each in-progress workflow from scratch with the same initial parameters.

2. **Replays** each completed activity’s recorded result from the execution log.

3. **Retries** any activity whose result wasn’t yet persisted when the crash occurred - another reason why activities must be idempotent.

**Q:**  How to do a cleanup after an activity permanently failed?

**A:** Obelisk doesn’t yet offer built‑in saga support, so you handle compensation logic directly in your workflow. In practice, you wrap activities in a try/catch (or equivalent) block: if an activity exhausts its retries and fails, invoke the compensating activity to roll back or clean up any side effects and continue or exit the workflow function.
