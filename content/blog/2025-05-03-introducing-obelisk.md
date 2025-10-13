+++
title = "Introducing Obelisk deterministic workflow engine"
date = 2025-05-03
+++

I'm excited to introduce Obelisk, a new workflow engine I've been passionately building for over a year. You can find the project hosted at [obeli.sk](https://obeli.sk/) and the source code openly available at [github.com/obeli-sk/obelisk](https://github.com/obeli-sk/obelisk) under an Open Source license.

Recently, I shared Obelisk on Hacker News (<a href="https://news.ycombinator.com/item?id=43636568" target="_blank">link to story</a>), and the response was very encouraging! It received over 100 upvotes, and the GitHub repository leaped from 14 stars to over 120 in just one day. Seeing this interest encouraged me to share more about the journey and the core ideas behind Obelisk.

<!-- more -->

## Why Build Another Workflow Engine?

As a backend software developer for nearly two decades, I've consistently felt a sense of dissatisfaction with how we often build and, more critically, *maintain* software. There's a recurring cycle:

1.  **Develop:** Write the feature, or perhaps worse, inherit a complex piece of code from someone who just left the team.
2.  **Observe (Sort of):** Add just enough logging to capture what seem like the most important state transitions. Try to anticipate edge cases, error conditions, and recovery paths.
3.  **Maintain (Struggle):** Wait for failures, then try to piece together what happened.

The fundamental problem with traditional logging is the constant trade-off. Log too little, and you lack the crucial details needed during failure investigation. Log too much, and you face overwhelming operational costs (storage, indexing, querying). This often leads to companies reacting by increasing the log severity filter, which ironically filters out the very logs you added for debugging (true story - I've seen this happen!). The common outcome is having logs that are simultaneously too verbose to sift through efficiently and too sparse to pinpoint the actual root cause.

This gets significantly harder when dealing with parallelism and distributed systems. Suddenly, robust retry logic becomes essential. But if services are developed independently, how do you ensure consistent retry policies? Without central management, you risk inefficiencies or even unintentional DoS attacks through cascading retries.

Calling remote services reliably also demands idempotency – that's just table stakes. But what happens if the *caller* crashes mid-transaction due to unrelated issues like memory pressure? Resuming that process correctly is often an afterthought, frequently requiring manual intervention, if it's handled at all. Consider a transaction involving services A, B, and C. If A and B succeed, but C fails either due to a server crash or after exhausting retries, how do you systematically continue or compensate for the actions already taken by A and B?

Day-to-day, one of the biggest frustrations came during incident investigation. Reconstructing failures often involved a painstaking process of correlating information across the current source code, available logs, and recent `git log` history. The team was essentially trying to fill in the gaps left by imperfect logging and distributed state to build a theory of what sequence of events could have led to the error. Too often, this felt like guesswork rather than solid engineering.

## The Search for a Better Way

I knew there had to be a more structured, reliable approach. I'd previously worked on extending workflow engines like <a href="https://github.com/Netflix/conductor" target="_blank">Netflix Conductor</a>, but I found the visual "drag-and-drop" style of programming for defining logic less appealing for complex tasks. I also grew wary of declarative, configuration-based systems (like YAML in GitHub Actions) – they can become incredibly complex and brittle once you start adding non-trivial conditional logic to execution graphs.

My ideal workflow engine would:

*   Allow developers to write orchestration logic in regular programming languages like Rust, JavaScript, Python or Go.
*   Enforce a strict separation between the pure, deterministic orchestration logic and the side-effectful operations that interact with the real world.
*   Bake determinism guarantees *into the compilation process*, preventing common mistakes (like accidental use of non-deterministic functions, threads, or direct system time calls within workflow code) that could break replayability. <a href="https://temporal.io" target="_blank">Temporal</a> solves this with runtime checks and developer discipline, but compile-time checks and a runtime sandbox are better.

## The Obelisk Approach: Server-Side WASM

This is where server-side WebAssembly (WASM) enters the picture for Obelisk. WASM provides the sandboxing and controlled execution environment needed to realize this vision. Obelisk leverages specific WASM capabilities through three core component types:

1.  **Workflows (Deterministic Logic):** This is where your core orchestration logic lives. Workflows are compiled to the `wasm32-unknown-unknown` target. This target intentionally lacks capabilities to interact with the outside world (no networking, filesystem access, etc.). The WASM runtime strictly controls execution, only allowing the Obelisk engine to start child executions and receive their results. This ensures the workflow code itself is purely deterministic. All necessary state, including results from external calls (Activities), is persisted and replayed by the engine, guaranteeing consistent execution even across server crashes or restarts.

2.  **Activities (Side Effects):** To interact with the real world (call external APIs, query databases, etc.), Workflows invoke Activities. These are compiled to the `wasm32-wasip2` target (WASI Preview 2). This target *does* provide standardized interfaces for capabilities like making outbound HTTP requests. Activities run in a sandbox (no arbitrary threads, limited I/O controlled by the host), but they can be granted permission by the Obelisk runtime to perform necessary side effects.

3.  **Webhook Endpoints (Triggers):** You need a way to trigger workflows or interact with the system externally. Obelisk uses Webhook Endpoints, also compiled using `wasm32-wasip2`. This target allows them to function as embeddable HTTP servers. They can listen for incoming HTTP requests (not just typical JSON POSTs, but any method or content type) and initiate workflows or activities based on those requests.

**Tying it Together: The WASM Component Model**

To enable seamless, type-safe communication between these different WASM components (e.g., a Workflow calling an Activity, an Webhook Endpoint starting a Workflow), Obelisk utilizes the <a href="https://component-model.bytecodealliance.org/" target="_blank">WASM Component Model</a>. The Component Model acts like an advanced version of ESModules with generated bindings, allowing components to export and import functions from others based on well-defined, language-agnostic interfaces, ensuring type safety across component boundaries.

## Why Does This Matter?

By combining these specific WASM targets and the Component Model, Obelisk aims to provide:

*   **Guaranteed Determinism:** Workflow logic is inherently deterministic, enforced at compile time.
*   **Clear Separation of Concerns:** Side effects are isolated within Activities.
*   **Familiar Languages:** Write complex logic in powerful languages like Rust, JavaScript and Go, with potential for more in the future.
*   **Sandboxing:** Enhanced security and resource control for all user-provided code.
*   **Reliability:** Built-in state persistence, retries and replay enable resilient execution in adverse environment.

## Get Involved!

If this approach to building reliable, maintainable backend systems resonates with you, I'd love for you to get involved:

*   Check out the **GitHub repository**: [github.com/obeli-sk/obelisk](https://github.com/obeli-sk/obelisk)
*   Read the <a href="{{ get_url(path='@/docs/latest/_index.md') }}">documentation</a> (still evolving!) to dive deeper.
*   Subscribe to the **mailing list** for future updates.

I'm excited about the potential of Obelisk and look forward to continuing its development in the open.
