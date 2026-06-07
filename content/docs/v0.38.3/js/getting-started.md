+++
title = "Getting Started with Obelisk"
template = "docs.html"
weight = 0
+++

This guide walks you through running a durable application with Obelisk — a workflow engine that
automatically recovers your program from crashes. You'll write a `step` activity, serial and
parallel workflows, and a webhook endpoint in JavaScript, then see crash recovery in action.

No build step or toolchain required — just install Obelisk and run.

## 1. Install Obelisk

```bash
curl -L --tlsv1.2 -sSf https://raw.githubusercontent.com/obeli-sk/obelisk/main/download.sh | bash
```

See the [Installation page](@/install/_index.md) for Docker, Nix, cargo-binstall, and other
options.

## 2. Clone the Tutorial

```bash
git clone https://github.com/obeli-sk/demo-tutorial.git
cd demo-tutorial
```

The repository contains four JavaScript files and a `deployment.toml` — nothing else to install or
compile.

Starting from an empty project instead? Generate the commented deployment reference first:

```bash
obelisk generate deployment
```

Then add your activities, workflows, and webhook endpoints to `deployment.toml`. The rest of this
guide explains the same pieces using the tutorial repository.

## 3. The Components

### Activity

`activity/step.js` — the unit of side-effectful work. Activities are retried automatically on
timeout or failure.

```javascript
// tutorial:demo/activity.step: func(idx: u32, sleep-millis: u32) -> result<u32>
export default async function step(idx, sleep_millis) {
  console.log(`Step ${idx} started`); // logs are persisted
  await new Promise((r) => setTimeout(r, sleep_millis));
  console.log(`Step ${idx} completed`);
  return idx;
}
```

### Workflows

Workflows orchestrate activities. They must be **deterministic** — given the same inputs and event
history they always produce the same sequence of calls. This lets Obelisk recover them from crashes
by replaying the execution log.

`workflow/serial.js` — runs 10 steps in sequence with a persistent 1-second sleep between each:

```javascript
import { step } from "tutorial:demo/activity";

// tutorial:demo/workflow.serial: func() -> result<u32, string>
export default function serial() {
  let acc = 0;
  for (let i = 0; i < 10; i++) {
    obelisk.sleep({ seconds: 1 });
    const result = step(i, i * 200);
    acc += result;
    console.log(`step(${i})=${result}`);
  }
  console.log(`serial completed: ${acc}`);
  return acc;
}
```

Key concepts:

- **ES module imports** — `import { step } from "tutorial:demo/activity"` imports the activity by
  its WIT interface path. Obelisk resolves the import at startup: calling `step(...)` submits the
  activity, blocks until it completes, and returns the ok payload. The call and its result are
  recorded in the execution log, so on replay the activity is not re-executed. Function names are
  converted from kebab-case (WIT) to camelCase (JS) automatically.
- **`obelisk.sleep`** is a _persistent_ sleep — its position is saved to the execution log. If the
  server crashes mid-sleep and restarts, the sleep resumes where it left off.

`workflow/parallel.js` — submits all 10 steps concurrently using
{{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}, then awaits results:

```javascript
import { stepSubmit, stepAwaitNext } from "tutorial:demo-obelisk-ext/activity";

// tutorial:demo/workflow.parallel: func() -> result<u32, string>
export default function parallel() {
  const handles = [];
  for (let i = 0; i < 10; i++) {
    const js = obelisk.createJoinSet();
    stepSubmit(js, i, i * 200);
    handles.push({ i, js });
  }
  console.log("parallel: submitted all child executions");
  let acc = 0;
  for (const { i, js } of handles) {
    const result = stepAwaitNext(js);
    acc = 10 * acc + result;
    console.log(`step(${i})=${result}, acc=${acc}`);
    obelisk.sleep({ milliseconds: 300 });
  }
  console.log(`parallel completed: ${acc}`);
  return acc;
}
```

### Webhook Endpoint

`webhook/tutorial.js` — serves HTTP and triggers workflows via imports:

```javascript
import { serial } from "tutorial:demo/workflow";
import { parallel } from "tutorial:demo/workflow";

export default function handle(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  console.log(`Handling request: ${path}`);

  if (path === "/serial") {
    const result = serial();
    return new Response(`serial workflow completed: ${result}`, { status: 200 });
  } else if (path === "/parallel") {
    const result = parallel();
    return new Response(`parallel workflow completed: ${result}`, { status: 200 });
  } else {
    return new Response("not found\ntry /serial or /parallel", { status: 404 });
  }
}
```

### Configuration

`deployment.toml` wires the components together. Each entry assigns an
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }} (`package:namespace/interface.function`) and
{{ doc_link(title="WIT types", path="concepts/wit-reference.md") }} to the JS function — Obelisk
synthesizes the interface at startup, so no WIT files are needed. The FFQN is the address used in ES
module imports and `obelisk.call`; the JS function name maps to the function part of it. See
{{ doc_link(title="JS components", path="js/js-components.md") }} for links to the per-type pages
(activities, workflows, webhooks) and JSON encoding.

```toml
[[activity_js]]
name = "step"
location = "${DEPLOYMENT_DIR}/activity/step.js"
ffqn = "tutorial:demo/activity.step"
params = [
  { name = "idx", type = "u32" },
  { name = "sleep-millis", type = "u32" },
]
return_type = "result<u32>"
exec.lock_expiry.seconds = 10

[[workflow_js]]
name = "serial"
location = "${DEPLOYMENT_DIR}/workflow/serial.js"
ffqn = "tutorial:demo/workflow.serial"
params = []
return_type = "result<u32, string>"

[[workflow_js]]
name = "parallel"
location = "${DEPLOYMENT_DIR}/workflow/parallel.js"
ffqn = "tutorial:demo/workflow.parallel"
params = []
return_type = "result<u32, string>"

[[webhook_endpoint_js]]
name = "webhook"
location = "${DEPLOYMENT_DIR}/webhook/tutorial.js"
routes = ["/*"]
```

`${DEPLOYMENT_DIR}` resolves to the directory containing the deployment file. See
{{ doc_link(title="Configuration", path="configuration.md") }} for all options.

## 4. Run

```bash
obelisk server run --deployment deployment.toml
```

Three endpoints start automatically:

- **Web UI** at [http://localhost:8080](http://localhost:8080)
- **Webhook server** at [http://localhost:9090](http://localhost:9090)
- **API** at [http://localhost:5005](http://localhost:5005)

Trigger the serial workflow:

```bash
curl http://localhost:9090/serial
```

After ~20 seconds (10 steps × 1 s sleep each):

```
serial workflow completed: 45
```

Trigger the parallel workflow — all steps run concurrently, finishes in a few seconds:

```bash
curl http://localhost:9090/parallel
```

```
parallel workflow completed: 123456789
```

## 5. Inspect Executions

List top-level executions — one per webhook call:

```bash
curl -s "http://localhost:5005/v1/executions"
```

```
E_01KN209P2PC...  Finished(ok)  wasi:http/incoming-handler.handle  2026-03-31 13:11:01 UTC
```

Fetch logs for a webhook execution (includes its `console.log` output):

```bash
EXECUTION_ID=E_01KN209P2PC...
curl -s "http://localhost:5005/v1/executions/${EXECUTION_ID}/logs"
```

To see the child workflow and activities spawned by a webhook, use `show_derived` and filter by FFQN
prefix:

```bash
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=tutorial:demo"
```

```
E_01KN209P2PC....o:1_1              Finished(ok)  tutorial:demo/workflow.serial    2026-03-31 13:11:01 UTC
E_01KN209P2PC....o:1_1.o:2-step_1  Finished(ok)  tutorial:demo/activity.step      2026-03-31 13:11:02 UTC
...
```

Then fetch logs for the workflow execution by its ID — `console.log` calls appear as structured log
entries with timestamps.

The **Web UI** at [http://localhost:8080](http://localhost:8080) provides a visual trace. Click an
execution and enable **Autoload children** to see the full hierarchy of webhook → workflow →
activities.

Serial workflow — steps run one at a time:

![Trace view of the serial workflow showing sequential activity executions](/js-tutorial-trace.png)

Parallel workflow — all steps run concurrently:

![Trace view of the parallel workflow showing concurrent activity executions](/js-tutorial-trace-parallel.png)

## 6. Crash Recovery

Start the serial workflow, then kill the server while it is running:

```bash
# terminal 1
curl http://localhost:9090/serial

# terminal 2 — kill mid-execution
kill $(pgrep obelisk)
```

The curl request fails — but the workflow state is safely persisted. Restart the server:

```bash
obelisk server run
```

No `--deployment` flag needed: Obelisk persists the full deployment configuration — including the
paths to JS source files — in the database on first run, so the server can reload all components on
restart without re-specifying them. Obelisk resumes the workflow from its last completed step.
Already-completed activities are **not re-executed**.

This is durable execution: your workflows survive server crashes, restarts, and deployments without
losing progress or duplicating work.

## Next Steps

- **Go further:**
  {{ doc_link(title="Saga Pattern with Fly.io", path="js/getting-started-fly-agent.md") }} — learn
  the saga pattern by creating a fly.io app, running a short-lived AI agent VM, and guaranteeing
  cleanup via a two-level workflow. Introduces pre-built WASM activities and crash-safe
  compensation.

- **Understand the concepts:** {{ doc_link(title="JS Activities", path="js/js-activities.md") }},
  {{ doc_link(title="JS Workflows", path="js/js-workflows.md") }},
  {{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }},
  {{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }}

- **WASM/Rust alternative:**
  {{ doc_link(title="Getting Started (Rust / WASM)", path="wasm/getting-started.md") }} — same
  tutorial implemented in Rust compiled to WebAssembly.

- **Build your own Rust project:** See
  {{ doc_link(title="Rust components", path="wasm/rust-components.md") }} for the WIT world,
  `bindgen!`, and Cargo setup, or scaffold a new project with:

  ```bash
  cargo generate obeli-sk/obelisk-templates
  ```

  The `rust/` directory in the [demo-tutorial](https://github.com/obeli-sk/demo-tutorial) contains a
  Rust implementation of the same activity, workflow, and webhook.

- **Explore example apps:** [demo-tutorial](https://github.com/obeli-sk/demo-tutorial) is the app
  from this guide, [demo-stargazers](https://github.com/obeli-sk/demo-stargazers) uses a GitHub
  webhook, OpenAI, and a database,
  [obelisk-deploy-flyio](https://github.com/obeli-sk/obelisk-deploy-flyio) deploys Obelisk apps to
  Fly.io, and [obelisk-templates](https://github.com/obeli-sk/obelisk-templates) contains starter
  templates.

- **Learn the CLI:** {{ doc_link(title="CLI reference", path="cli.md") }} covers submitting
  executions, inspecting state, and managing components.

- **Read the blog:** [Comparing Obelisk with DBOS](@/blog/2025-11-26-comparing-dbos-part-1.md) walks
  through this same tutorial code in depth, comparing the approach with DBOS Java.
