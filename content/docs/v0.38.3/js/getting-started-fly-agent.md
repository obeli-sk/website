+++
title = "Getting Started: Saga Pattern with Fly.io"
template = "docs.html"
weight = 1
+++

This tutorial extends the {{ doc_link(title="Getting Started", path="js/getting-started.md") }}
guide with two advanced topics:

- **The saga pattern** — guarantee cleanup even when a workflow fails or the server crashes.
- **Pre-built WASM activities** — call a compiled Rust activity (fly.io API) from a JS workflow with
  no build step.

You will build a two-workflow system that creates a fly.io app, runs a short-lived VM acting as an
AI agent, and destroys the app afterwards — whether the agent succeeded or not.

## Prerequisites

- Obelisk installed (see {{ doc_link(title="Getting Started", path="js/getting-started.md") }})
- A [fly.io](https://fly.io) account with a
  [personal access token](https://fly.io/user/personal_access_tokens) saved in `FLY_API_TOKEN`

```bash
export FLY_API_TOKEN=your_token_here
```

## The Saga Pattern

A **saga** is a sequence of steps where each step has a corresponding compensation action that
undoes its effects. When any step fails you run the compensations in reverse — or in the simplest
case, you run a single cleanup action at the end if the main action fails.

In Obelisk the saga guarantee is strong: even a server crash mid-workflow cannot skip the
compensation, because the execution log is replayed on restart. The workflow continues from the last
completed step.

Any abnormal activity failure — OOM panic, WASM trap, or an endless loop exhausting the retry budget
— propagates as a regular `err` variant and is catchable.

A programming error in workflow code itself can also cause an execution failure. The outer saga
workflow should therefore be kept minimal: only the action and its compensation. Move all complex
logic — the resource creation, the agent exec, the polling loop — into the inner child workflow.
That way a bug in the complex logic fails the child workflow (catchable), while the outer workflow
stays simple and reliable enough that it will always reach the `apps.delete` call.

This tutorial implements the simplest form:

```
run (outer saga workflow)       ← kept intentionally minimal
├── agent (inner workflow)      ← all complex logic here; may fail for any reason
└── apps.delete                 ← always runs, regardless of agent's success or failure
```

The outer `run` workflow calls the inner `agent` workflow inside a `try/catch`, then unconditionally
calls `apps.delete`. A try/catch is perfectly safe in a deterministic workflow: the branch taken is
recorded in the execution log, so replay always follows the same path.

## Clone and Navigate

```bash
cd demo-tutorial/fly-agent
```

The directory contains four files and a `deployment.toml` — nothing to compile.

## The Components

### Fly.io Activity (pre-built WASM)

`deployment.toml` references a compiled Rust activity from the Obelisk component registry:

```toml
[[activity_wasm]]
name = "activity_fly_http"
location = "oci://docker.io/getobelisk/components_fly_activity_fly_http:..."
exec.lock_expiry.seconds = 15
[[activity_wasm.allowed_host]]
pattern = "https://api.machines.dev"
methods = "*"
[activity_wasm.allowed_host.secrets]
env_vars = ["FLY_API_TOKEN"]
replace_in = ["headers"]
```

Obelisk downloads and caches the component on first run. The `secrets` block tells Obelisk to inject
`FLY_API_TOKEN` from the environment into the `Authorization` header of every outbound request — the
token is never written to disk or logged and only a placeholder is passed to the WASM activity.

The activity exposes the full [Fly.io Machines API](https://docs.machines.dev/) as callable
functions. Their FFQNs follow the WIT package structure:
`obelisk-flyio:activity-fly-http/<interface>@1.0.0-beta.<function>`.

### Inner Workflow — `workflow/agent.js`

```javascript
import * as apps from "obelisk-flyio:activity-fly-http/apps@1.0.0-beta";
import * as machines from "obelisk-flyio:activity-fly-http/machines@1.0.0-beta";

// ffqn: demo:fly-agent/workflow.agent(app-name: string, org-slug: string, prompt: string) -> result<string, string>
export default function agent(app_name, org_slug, prompt) {
  // Step 1: Create the fly.io app.
  apps.put(org_slug, app_name);

  // Step 2: Launch a VM.
  // The init command runs the agent in the background and writes the result to
  // /result.txt. The foreground `sleep 3600` keeps the VM alive so we can read
  // the file via exec. Replace the backgrounded command with your agent.
  const machine_id = machines.create(
    app_name,
    "agent-vm",
    {
      image: "alpine:3.21",
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256, kernel_args: null },
      auto_destroy: null,
      init: {
        entrypoint: null,
        cmd: [
          "/bin/sh",
          "-c",
          '(sleep 60 && printf "Prompt: %s\\nResult: %s\\n" "$PROMPT" "42 is the answer" > /result.txt) & sleep 3600',
        ],
        exec: null,
        kernel_args: null,
        swap_size_mb: null,
        tty: null,
      },
      env: [["PROMPT", prompt]],
      restart: { max_retries: null, policy: "no" },
      stop_config: null,
      mounts: null,
      services: null,
      files: null,
    },
    "ams",
  );

  // Step 3: Durable poll — obelisk.sleep is recorded in the execution log.
  let started = false;
  for (let i = 0; i < 20; i++) {
    const machine = machines.get(app_name, machine_id);
    if (machine !== null && machine.state === "started") {
      started = true;
      break;
    }
    obelisk.sleep({ seconds: 3 });
  }
  if (!started) throw "VM did not reach 'started' state within timeout";

  // Step 4: Poll until /result.txt appears.
  // Each exec is a fast `cat` — no fly.io exec timeout issues.
  // Throws if the VM becomes unreachable (e.g. stopped externally).
  let output = null;
  for (let i = 0; i < 30; i++) {
    const cat = machines.exec(app_name, machine_id, ["cat", "/result.txt"], {
      timeout_secs: 10,
      stdin: null,
    });
    if (cat.exit_code === 0) {
      output = (cat.stdout || "").trim();
      break;
    }
    obelisk.sleep({ seconds: 5 });
  }
  if (output === null) throw "Agent did not produce a result within timeout";
  return output;
}
```

Key points:

- **`obelisk.sleep` is durable.** Its position is saved in the execution log. A crash during either
  polling loop is recovered on restart without re-creating the VM or re-running work.
- **Imported activity calls** block until the activity completes (with auto-retry on transient
  failures). The result is recorded; on replay the activity is not re-executed.
- **`exec` vs `exec-check-success`:** `exec` returns the exit code without throwing, which lets the
  workflow distinguish "file not ready yet" (exit 1) from "VM unreachable" (error variant → throws).
  A long exec inside `exec-check-success` would hit fly.io's exec timeout; the file-polling approach
  avoids this entirely.
- The workflow does **not** delete the app. That is the outer workflow's job.

#### JSON encoding for WASM activities

Arguments are JSON-encoded using the WIT type schema. Key rules (see
{{ doc_link(title="JS components", path="js/js-components.md") }} for the full table):

| WIT type         | JS value                                   |
| ---------------- | ------------------------------------------ |
| `record { ... }` | Plain object; kebab-case → snake_case keys |
| `option<T>` some | The value                                  |
| `option<T>` none | `null`                                     |
| `enum { ... }`   | Snake_case string, e.g. `"shared"`         |
| `tuple<A, B>`    | Array `[a, b]`                             |

In `deployment.toml`:

```toml
[[workflow_js]]
name = "agent"
location = "${DEPLOYMENT_DIR}/workflow/agent.js"
ffqn = "demo:fly-agent/workflow.agent"
params = [
  { name = "app-name", type = "string" },
  { name = "org-slug", type = "string" },
  { name = "prompt",   type = "string" },
]
return_type = "result<string, string>"
```

### Outer Workflow — `workflow/run.js`

```javascript
import { agent } from "demo:fly-agent/workflow";
import * as apps from "obelisk-flyio:activity-fly-http/apps@1.0.0-beta";

// ffqn: demo:fly-agent/workflow.run(app-name: string, org-slug: string, prompt: string) -> result<string, string>
export default function run(app_name, org_slug, prompt) {
  let result = null;
  let error = null;

  // Call the inner workflow; capture any failure so cleanup still runs.
  try {
    result = agent(app_name, org_slug, prompt);
  } catch (e) {
    error = String(e);
    console.log(`Agent workflow failed: ${error}`);
  }

  // Saga compensation: always delete the app.
  // A crash between the try/catch and here is safe: Obelisk replays the log
  // on restart and continues from this point.
  console.log(`Deleting app: ${app_name}`);
  try {
    apps.delete(app_name, true);
    console.log("App deleted");
  } catch (e) {
    console.log(`App deletion failed (manual cleanup may be needed): ${e}`);
  }

  if (error !== null) throw error;
  return result;
}
```

The `try/catch` pattern is deterministic: the branch taken (error or success) is recorded in the
execution log. On replay Obelisk replays the same branch — crash recovery is guaranteed regardless
of where the server stopped.

In `deployment.toml`:

```toml
[[workflow_js]]
name = "run"
location = "${DEPLOYMENT_DIR}/workflow/run.js"
ffqn = "demo:fly-agent/workflow.run"
params = [
  { name = "app-name", type = "string" },
  { name = "org-slug", type = "string" },
  { name = "prompt",   type = "string" },
]
return_type = "result<string, string>"
```

### Webhook — `webhook/fly-agent.js`

Route path segments starting with `:` are captured and exposed via `process.env` inside the handler.
The webhook uses three segments for org, app name, and prompt:

```javascript
import { run } from "demo:fly-agent/workflow";

// Route: /run/:org-slug/:app-name/:prompt
export default function handle(_request) {
  const org_slug = process.env["org-slug"];
  const app_name = process.env["app-name"];
  const prompt = process.env["prompt"];
  const result = run(app_name, org_slug, prompt);
  return new Response(`Agent completed:\n${result}\n`, { status: 200 });
}
```

In `deployment.toml`:

```toml
[[webhook_endpoint_js]]
name = "webhook"
location = "${DEPLOYMENT_DIR}/webhook/fly-agent.js"
routes = [{ methods = ["GET"], route = "/run/:org-slug/:app-name/:prompt" }]
```

See {{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }} for the full path parameter
reference and {{ doc_link(title="Configuration", path="configuration.md") }} for all options.

## Run

```bash
cd demo-tutorial/fly-agent
obelisk server run --deployment deployment.toml
```

Trigger the saga — pick a globally unique app name on fly.io:

```bash
APP=my-fly-agent-$(date +%s)
curl "http://localhost:9090/run/personal/${APP}/what-is-42"
```

After ~75 seconds (VM creation + ~60 s background job + app deletion):

```
Agent completed:
Prompt: what-is-42
Result: 42 is the answer
```

List executions to see the full hierarchy:

```bash
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=demo:fly-agent" \
  -H 'Accept: text/plain'
```

```
E_01KN...  Finished(ok)  demo:fly-agent/workflow.run    ...
E_01KN...  Finished(ok)  demo:fly-agent/workflow.agent  ...
```

The **Web UI** at [http://localhost:8080](http://localhost:8080) shows the full trace. Enable
**Autoload children** on the outer `run` execution to see the inner `agent` execution and all
activity calls beneath it.

## Saga Recovery in Action

The backgrounded `sleep 60` gives you a 60-second window before `/result.txt` appears. Start a new
saga, then stop the VM while the background job is still sleeping:

```bash
# terminal 1
APP=my-fly-agent-$(date +%s)
curl "http://localhost:9090/run/personal/${APP}/what-is-42"

# terminal 2 — stop the VM before /result.txt is written
fly machine stop agent-vm --app ${APP}
```

When the VM stops, the next `cat /result.txt` exec call returns an error (VM unreachable). The inner
`agent` workflow throws, the outer `run` workflow catches it, and `apps.delete` fires automatically
— no orphaned app left on fly.io.

Check the execution log to confirm:

```bash
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=demo:fly-agent" \
  -H 'Accept: text/plain'
```

```
E_01KN...  Finished(err)  demo:fly-agent/workflow.agent  ...
E_01KN...  Finished(ok)   demo:fly-agent/workflow.run    ...
```

The outer `run` finishes with `ok` because the compensation succeeded — the app is gone.

You can also test server-crash recovery: kill Obelisk while the result-polling loop is running and
restart with `obelisk server run`. The workflow replays from the last completed step and continues
polling; when the VM is eventually stopped, `apps.delete` still runs.

## Next Steps

- **Plug in a real AI agent:** Replace the backgrounded `sleep 60` in the init command with your
  agent. The agent should run immediately and write its output to `/result.txt`; the `PROMPT`
  environment variable carries the user-supplied text. Remove `sleep 60` — your agent starts as soon
  as the VM boots.

  ```javascript
  cmd: ["/bin/sh", "-c", '(your-agent --prompt "$PROMPT" > /result.txt) & sleep 3600'];
  ```

- **Structured concurrency:**
  {{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }} — run multiple agent VMs
  in parallel and collect results.
- **Concepts:** {{ doc_link(title="JS Workflows", path="js/js-workflows.md") }},
  {{ doc_link(title="JS Activities", path="js/js-activities.md") }}
- **REST API:** {{ doc_link(title="Programmatic access", path="programmatic-access.md") }} — submit
  executions and query state without the webhook.
- **Rust components:** {{ doc_link(title="Rust components", path="wasm/rust-components.md") }} —
  build your own compiled activity like the fly.io one used here.
