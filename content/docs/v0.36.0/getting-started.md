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

See the [Installation page](https://obeli.sk/install/) for Docker, Nix, cargo-binstall, and other options.

## 2. Clone the Tutorial

```bash
git clone https://github.com/obeli-sk/demo-tutorial.git
cd demo-tutorial
```

The repository contains four JavaScript files and a `deployment.toml` — nothing else to install or compile.

## 3. The Components

### Activity

`activity/step.js` — the unit of side-effectful work. Activities are retried automatically on
timeout or failure.

```javascript
// ffqn: tutorial:demo/activity.step(idx: u64, sleep-millis: u64) -> result<string>
export default async function step(idx, sleep_millis) {
    console.log(`Step ${idx} started`);
    await new Promise(r => setTimeout(r, Number(sleep_millis)));
    console.log(`Step ${idx} completed`);
    return String(idx);
}
```

### Workflows

Workflows orchestrate activities. They must be **deterministic** — given the same inputs and
event history they always produce the same sequence of calls. This lets Obelisk recover them from
crashes by replaying the execution log.

`workflow/serial.js` — runs 10 steps in sequence with a persistent 1-second sleep between each:

```javascript
// ffqn: tutorial:demo/workflow.serial() -> result<string, string>
export default function serial() {
    let acc = 0;
    for (let i = 0; i < 10; i++) {
        obelisk.sleep({ seconds: 1 });
        const result = obelisk.call("tutorial:demo/activity.step", [i, i * 200]);
        acc += Number(result);
        console.log(`step(${i})=${result}`);
    }
    console.log(`serial completed: ${acc}`);
    return String(acc);
}
```

Key concepts:
- **`obelisk.sleep`** is a *persistent* sleep — its position is saved to the execution log.
  If the server crashes mid-sleep and restarts, the sleep resumes where it left off.
- **`obelisk.call`** submits an activity and blocks until it completes. The call and its result
  are recorded in the execution log, so on replay the activity is not re-executed.

`workflow/parallel.js` — submits all 10 steps concurrently using
{{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}, then awaits results:

```javascript
// ffqn: tutorial:demo/workflow.parallel() -> result<string, string>
export default function parallel() {
    const joinSets = [];
    for (let i = 0; i < 10; i++) {
        const js = obelisk.createJoinSet();
        js.submit("tutorial:demo/activity.step", [i, i * 200]);
        joinSets.push({ i, js });
    }
    console.log("parallel: submitted all child executions");
    let acc = 0;
    for (const { i, js } of joinSets) {
        const response = js.joinNext();
        if (!response.ok) throw `step ${i} failed`;
        const result = obelisk.getResult(response.id);
        acc = 10 * acc + Number(result.ok);
        console.log(`step(${i})=${result.ok}, acc=${acc}`);
        obelisk.sleep({ milliseconds: 300 });
    }
    console.log(`parallel completed: ${acc}`);
    return String(acc);
}
```

### Webhook Endpoint

`webhook/tutorial.js` — serves HTTP and triggers workflows via `obelisk.call`:

```javascript
export default function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    console.log(`Handling request: ${path}`);

    if (path === "/serial") {
        const result = obelisk.call("tutorial:demo/workflow.serial", []);
        return new Response(`serial workflow completed: ${result}`, { status: 200 });
    } else if (path === "/parallel") {
        const result = obelisk.call("tutorial:demo/workflow.parallel", []);
        return new Response(`parallel workflow completed: ${result}`, { status: 200 });
    } else {
        return new Response("not found\ntry /serial or /parallel", { status: 404 });
    }
}
```

### Configuration

`deployment.toml` wires the components together. Each entry assigns an
{{ doc_link(title="FFQN", path="concepts/ffqn.md") }} (`package:namespace/interface.function`)
and {{ doc_link(title="WIT types", path="concepts/wit-types.md") }} to the JS function —
Obelisk synthesizes the interface at startup, so no WIT files are needed. The FFQN is the
address used in `obelisk.call`; the JS function name maps to the function part of it. See
{{ doc_link(title="JS components", path="concepts/js-components.md") }} for the JSON encoding
reference and links to the per-type pages (activities, workflows, webhooks).

```toml
[[activity_js]]
name = "step"
location = "${DEPLOYMENT_DIR}/activity/step.js"
ffqn = "tutorial:demo/activity.step"
params = [
  { name = "idx", type = "u64" },
  { name = "sleep-millis", type = "u64" },
]
return_type = "result<string>"
exec.lock_expiry.seconds = 10

[[workflow_js]]
name = "serial"
location = "${DEPLOYMENT_DIR}/workflow/serial.js"
ffqn = "tutorial:demo/workflow.serial"
params = []
return_type = "result<string, string>"

[[workflow_js]]
name = "parallel"
location = "${DEPLOYMENT_DIR}/workflow/parallel.js"
ffqn = "tutorial:demo/workflow.parallel"
params = []
return_type = "result<string, string>"

[[webhook_endpoint_js]]
name = "webhook"
location = "${DEPLOYMENT_DIR}/webhook/tutorial.js"
routes = ["/*"]
```

`${DEPLOYMENT_DIR}` resolves to the directory containing the deployment file.
See {{ doc_link(title="Configuration", path="configuration.md") }} for all options.

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

To see the child workflow and activities spawned by a webhook, use `show_derived` and filter by
FFQN prefix:

```bash
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=tutorial:demo"
```

```
E_01KN209P2PC....o:1_1              Finished(ok)  tutorial:demo/workflow.serial    2026-03-31 13:11:01 UTC
E_01KN209P2PC....o:1_1.o:2-step_1  Finished(ok)  tutorial:demo/activity.step      2026-03-31 13:11:02 UTC
...
```

Then fetch logs for the workflow execution by its ID — `console.log` calls appear as structured
log entries with timestamps.

The **Web UI** at [http://localhost:8080](http://localhost:8080) provides a visual trace. Click an
execution and enable **Autoload children** to see the full hierarchy of webhook → workflow →
activities.

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

No `--deployment` flag needed: Obelisk persists the full deployment configuration — including
the paths to JS source files — in the database on first run, so the server can reload all
components on restart without re-specifying them. Obelisk resumes the workflow from its last
completed step. Already-completed activities are **not re-executed**.

This is durable execution: your workflows survive server crashes, restarts, and deployments
without losing progress or duplicating work.

## Next Steps

- **Go further:** {{ doc_link(title="Saga Pattern with Fly.io", path="getting-started-fly-agent.md") }}
  — learn the saga pattern by creating a fly.io app, running a short-lived AI agent VM,
  and guaranteeing cleanup via a two-level workflow. Introduces pre-built WASM activities
  and crash-safe compensation.

- **Understand the concepts:**
  {{ doc_link(title="JS Activities", path="concepts/js-activities.md") }},
  {{ doc_link(title="JS Workflows", path="concepts/js-workflows.md") }},
  {{ doc_link(title="JS Webhooks", path="concepts/js-webhooks.md") }},
  {{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }}

- **Build your own project:** See {{ doc_link(title="Rust components", path="concepts/rust-components.md") }}
  for the WIT world, `bindgen!`, and Cargo setup, or scaffold a new project with:

  ```bash
  cargo generate obeli-sk/obelisk-templates
  ```

  The `rust/` directory in the [demo-tutorial](https://github.com/obeli-sk/demo-tutorial)
  contains a Rust implementation of the same activity, workflow, and webhook.

- **Explore a real-world example:** The [Stargazers demo](https://github.com/obeli-sk/demo-stargazers)
  uses a GitHub webhook, OpenAI, and a database to process GitHub star events with a multi-step workflow.

- **Learn the CLI:** {{ doc_link(title="CLI reference", path="cli.md") }} covers
  submitting executions, inspecting state, and managing components.

- **Read the blog:** [Comparing Obelisk with DBOS](@/blog/2025-11-26-comparing-dbos-part-1.md)
  walks through this same tutorial code in depth, comparing the approach with DBOS Java.
