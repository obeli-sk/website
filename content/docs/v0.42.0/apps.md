+++
title = "Example Applications"
template = "docs.html"
weight = 8
+++

Obelisk apps are deployments of JavaScript or Rust workflows, activities, and webhooks. Start with
`obelisk generate new my-app`, then use these repositories for working patterns. An agent can read
this page through [llms.txt](@/docs/v0.42.0/llms.md) and copy only the pieces an app needs.

| App                                                                            | What to learn from it                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [demo-agent](https://github.com/obeli-sk/demo-agent)                           | Minimal durable JavaScript agent loop, tool dispatch, human input, and web UI. Start here for a new agent.                                  |
| [workflow-agent](https://github.com/obeli-sk/workflow-agent)                   | Full agent with a persistent shell, deployment editing, app mounts, and peer sessions. It has JavaScript and Rust workflow implementations. |
| [agent-backed-llm-server](https://github.com/obeli-sk/agent-backed-llm-server) | OpenAI-compatible endpoint backed by persistent CLI agent sessions.                                                                         |
| [demo-tutorial](https://github.com/obeli-sk/demo-tutorial)                     | Small serial and parallel workflows, activities, and webhooks in JavaScript, with Rust equivalents.                                         |
| [demo-playwright](https://github.com/obeli-sk/demo-playwright)                 | Durable browser automation: JavaScript workflow, exec activities, and cleanup after failure or restart.                                     |
| [demo-stargazers](https://github.com/obeli-sk/demo-stargazers)                 | GitHub webhook and multi-step workflows that call GitHub, an LLM, and a database, in JavaScript and Rust.                                   |
| [obelisk-version-monitor](https://github.com/obeli-sk/obelisk-version-monitor) | JavaScript dashboard app that checks repositories and dispatches GitHub Actions.                                                            |
| [benchmark-fibo](https://github.com/obeli-sk/benchmark-fibo)                   | Fibonacci workloads in JavaScript and Rust for comparing workflow implementations.                                                          |
| [webui](https://github.com/obeli-sk/webui)                                     | Source of Obelisk's execution and deployment UI; use it when extending the UI itself.                                                       |
