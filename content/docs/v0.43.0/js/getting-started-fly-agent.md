+++
title = "Getting Started: Saga Pattern with Fly.io"
template = "docs.html"
weight = 1
+++

This tutorial extends the {{ doc_link(title="Getting Started", path="js/getting-started.md") }}
guide with two advanced topics:

- **The saga pattern** — guarantee cleanup even when a workflow fails or the server crashes.
- **App-local JS activities:** call only the Fly.io API operations this example needs, with no build
  step.

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

An abnormal activity failure, such as OOM, a JS trap, or exhausted retries, propagates as a
catchable `err` variant.

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

The directory contains JS workflows, a webhook, five Fly API activities, and configuration files.
There is nothing to compile.

## The Components

### Fly.io Activities

`deployment.toml` declares five local JS activities for app creation and deletion, and machine
creation, inspection, and command execution. For example:

```toml
[[activity_js]]
name = "apps_put"
location = "activity/apps-put.js"
ffqn = "demo:fly-agent/apps.put"
params = [{ name = "org-slug", type = "string" }, { name = "app-name", type = "string" }]
return_type = "result<record { name: string, id: string }, string>"
exec.lock_expiry.seconds = 15
[[activity_js.allowed_host]]
url_prefix = "https://api.machines.dev/v1"
methods = ["POST"]
url_regex_suffix = "/apps$"
secrets = ["FLY_API_TOKEN"]
replace_in = ["headers"]

[[activity_js.allowed_host]]
url_prefix = "https://api.machines.dev/v1"
methods = ["GET"]
url_regex_suffix = "/apps/[A-Za-z0-9_-]+$"
secrets = ["FLY_API_TOKEN"]
replace_in = ["headers"]
```

Each activity allows only the methods and endpoints it calls: `url_prefix` fixes the Fly API base
URL, and `url_regex_suffix` restricts the path that follows it, one entry per method. See
{{ doc_link(title="URL prefix rules", path="configuration/deployment.md#url-prefix-rules") }}.

Create `app.toml` beside the deployment, name the app, register `FLY_API_TOKEN`, and add a matching
`[[outbound_http.allowed_host]]` entry. The activities receive only an opaque token placeholder;
Obelisk substitutes the token in the Authorization header for allowed Fly API requests.

```toml
# app.toml
app_name = "demo-tutorial-fly-agent"

[secrets]
FLY_API_TOKEN = {}

[[outbound_http.allowed_host]]
url_prefix = "https://api.machines.dev/v1"
methods = ["GET", "POST", "DELETE"]
url_regex_suffix = "/apps(/.*)?$"
secrets = ["FLY_API_TOKEN"]
replace_in = ["headers"]
```

The [activity files](https://github.com/obeli-sk/demo-tutorial/tree/main/fly-agent/activity)
implement only the Fly operations used below. `apps.put` checks that an existing app belongs to the
requested organization, `machines.create` reuses a machine ID on a name conflict, and `apps.delete`
accepts an already deleted app. These cases make activity retries safe after uncertain API results.

### Inner Workflow — `workflow/agent.js`

```javascript
// demo:fly-agent/workflow.agent: func(app-name: string, org-slug: string, prompt: string) -> result<string, string>
import * as apps from "demo:fly-agent/apps";
import * as machines from "demo:fly-agent/machines";
import * as obelisk from "obelisk:workflow@1.0.0";

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
    JSON.stringify({
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
    }),
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
    const cat = machines.exec(app_name, machine_id, ["cat", "/result.txt"], 10);
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
- **Machine `exec` result:** `exec` returns the exit code without throwing, which lets the workflow
  distinguish "file not ready yet" (exit 1) from "VM unreachable" (error variant → throws). Short
  `cat` calls avoid Fly.io's command timeout.
- The workflow does **not** delete the app. That is the outer workflow's job.

The machine configuration is passed to the JS activity as a JSON string. The activity converts its
`env` pairs into the object expected by Fly.io before sending the request.

In `deployment.toml`:

```toml
[[workflow_js]]
name = "agent"
location = "workflow/agent.js"
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
// demo:fly-agent/workflow.run: func(app-name: string, org-slug: string, prompt: string) -> result<string, string>
import { agent } from "demo:fly-agent/workflow";
import * as apps from "demo:fly-agent/apps";

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
location = "workflow/run.js"
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
location = "webhook/fly-agent.js"
routes = [{ methods = ["GET"], route = "/run/:org-slug/:app-name/:prompt" }]
```

See {{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }} for the full path parameter
reference and {{ doc_link(title="Deployment Configuration", path="configuration/deployment.md") }}
for all options.

## Run

```bash
cd demo-tutorial/fly-agent
obelisk server run --app-config app.toml --deployment deployment.toml
```

Trigger the saga with a globally unique app name and your actual Fly organization slug:

```bash
APP=my-fly-agent-$(date +%s)
ORG_SLUG=your-organization-slug
curl "http://localhost:9090/run/${ORG_SLUG}/${APP}/what-is-42"
```

After ~75 seconds (VM creation + ~60 s background job + app deletion):

```
Agent completed:
Prompt: what-is-42
Result: 42 is the answer
```

List executions to see the full hierarchy. The API port (`5005`) requires a bearer token printed to
the console on startup; export it first (or start the server with `--no-auth`). See
{{ doc_link(title="Authentication", path="access/authentication.md") }}.

```bash
export OBELISK_API_TOKEN=<token printed on server startup>
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=demo:fly-agent" \
  -H 'Accept: application/json' -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

```
E_01KN... `Finished: OK` demo:fly-agent/workflow.run ...
E_01KN... `Finished: OK` demo:fly-agent/workflow.agent ...
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
ORG_SLUG=your-organization-slug
curl "http://localhost:9090/run/${ORG_SLUG}/${APP}/what-is-42"

# terminal 2 — stop the VM before /result.txt is written
fly machine stop agent-vm --app ${APP}
```

When the VM stops, the next `cat /result.txt` exec call returns an error (VM unreachable). The inner
`agent` workflow throws, the outer `run` workflow catches it, and `apps.delete` fires automatically
— no orphaned app left on fly.io.

Check the execution log to confirm:

```bash
curl -s "http://localhost:5005/v1/executions?show_derived=true&ffqn_prefix=demo:fly-agent" \
  -H 'Accept: application/json' -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

```
E_01KN... `Finished: Error` demo:fly-agent/workflow.agent ...
E_01KN... `Finished: Error` demo:fly-agent/workflow.run ...
```

The outer `run` reports the inner failure after compensation. The app is gone even though the
execution failed.

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
- **REST API:** {{ doc_link(title="API access", path="access/api.md") }} — submit executions and
  query state without the webhook.
- **Rust components:** {{ doc_link(title="Rust components", path="wasm/rust-components.md") }} —
  build your own compiled activity like the fly.io one used here.
