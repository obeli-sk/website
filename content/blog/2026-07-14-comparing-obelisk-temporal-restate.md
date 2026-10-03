+++
title = "Comparing Obelisk with Temporal and Restate"
date = 2026-07-14
+++

Obelisk, [Temporal](https://temporal.io/) and [Restate](https://restate.dev/) all let a function
keep making progress after its process disappears. The largest architectural difference is that
Obelisk is a workflow runtime: it loads and runs application components itself. Temporal and Restate
are orchestrators whose application code runs in separately deployed Workers or service endpoints.
That difference shapes which mistakes each system can prevent and what exactly gets deployed.

I implemented the same small workflow with all three. The goal is to compare their Rust APIs,
determinism boundaries, activity isolation, secrets and deployment models.

<!-- more -->

One caveat up front: Temporal's
{{ target_link(title="Rust SDK", href="https://github.com/temporalio/sdk-rust") }} is currently in
Public Preview. Temporal has mature SDKs in other languages, so this Rust comparison should not be
read as a verdict on its overall developer experience.

## The workflow

The workflow fetches Amsterdam and Paris temperatures from [Open-Meteo](https://open-meteo.com/) in
parallel, waits on a durable one-second timer, and returns the warmer city. It crosses four useful
boundaries:

1. The two HTTP requests are side effects and must not run in deterministic workflow code.
2. The requests should run concurrently.
3. The timer must survive a process restart.
4. The final comparison is ordinary deterministic code.

In pseudocode, all three implementations do this:

```text
amsterdam = start forecast(52.37, 4.90)
paris     = start forecast(48.86, 2.35)
sleep durably for one second
return warmer(await amsterdam, await paris)
```

## Authoring the workflow

### Obelisk

Obelisk components expose and import typed interfaces defined with WIT. The workflow imports both
the activity's normal interface and generated extension functions for concurrent submission:

```rust
// WIT: compare: func() -> result<string, string>;
fn compare() -> Result<String, String> {
    let amsterdam = workflow_support::join_set_create();
    let paris = workflow_support::join_set_create();

    forecast_submit(&amsterdam, 52.37, 4.90);
    forecast_submit(&paris, 48.86, 2.35);

    workflow_support::sleep(ScheduleAt::In(Duration::Seconds(1)), None)
        .map_err(|()| "sleep cancelled".to_string())?;

    let amsterdam = forecast_await_next(&amsterdam)
        .map_err(|err| format!("activity failed: {err:?}"))??;
    let paris = forecast_await_next(&paris)
        .map_err(|err| format!("activity failed: {err:?}"))??;

    Ok(warmer("Amsterdam", amsterdam, "Paris", paris))
}
```

Concurrency needs Obelisk's generated `-submit` and `-await-next` functions plus
{{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}. They give concurrent
completions a linear, persisted interface that replay can reproduce. Synchronous imports remain
ordinary typed function calls. WIT adds a schema and binding-generation step, while making component
boundaries type-checked and language-independent. The
{{ doc_link(title="WIT reference", path="concepts/wit-reference.md") }} covers its types, results,
records and naming rules.

### Temporal

Temporal's Public Preview Rust SDK uses macros to define typed workflows and activities. Starting an
activity returns a durable future, and its workflow-aware `join!` macro polls both futures
concurrently in deterministic declaration order:

```rust
pub async fn run(
    ctx: &mut WorkflowContext<Self>,
    input: CompareWeatherInput,
) -> WorkflowResult<Comparison> {
    let options = ActivityOptions::schedule_to_close_timeout(Duration::from_secs(30));

    let amsterdam = ctx.start_activity(
        WeatherActivities::fetch_forecast,
        input.first,
        options.clone(),
    );
    let paris = ctx.start_activity(
        WeatherActivities::fetch_forecast,
        input.second,
        options,
    );

    ctx.timer(Duration::from_secs(1)).await;

    let (amsterdam, paris) = temporalio_sdk::workflows::join!(amsterdam, paris);
    let (amsterdam, paris) = (amsterdam?, paris?);

    Ok(warmer(amsterdam, paris))
}
```

The HTTP request is an `#[activity]` method registered on the Worker. Activities retry by default;
the schedule-to-close timeout bounds all attempts. The API is direct Rust, although version 0.5 is
still Public Preview.

### Restate

Restate models the HTTP operation as a separate service and calls it through a generated client. Its
`DurableFuturesUnordered` records which call completed, so a different network completion order
during recovery cannot change the result slots:

```rust
async fn run(&self, ctx: WorkflowContext<'_>) -> HandlerResult<String> {
    let forecasts = ctx.service_client::<ForecastServiceClient>();
    let mut calls = DurableFuturesUnordered::new();

    calls.push(forecasts.fetch(Json(amsterdam())).call());
    calls.push(forecasts.fetch(Json(paris())).call());

    ctx.sleep(Duration::from_secs(1)).await?;

    let mut results = [None, None];
    while let Some((index, result)) = calls.next().await? {
        results[index] = Some(result?.into_inner());
    }

    Ok(warmer(results))
}
```

The `ForecastService` handler contains the actual HTTP operation. Restate's `ctx.run` closure
journals its result and gives the operation its own retry policy:

```rust
let forecast = ctx
    .run(|| async move { fetch_open_meteo(client, city).await })
    .name("fetch_open_meteo")
    .retry_policy(RunRetryPolicy::default().max_attempts(3))
    .await?;
```

The operation could instead be an inline `ctx.run` step. A separate service makes the boundary
comparable with activities in the other runtimes; both Restate services can still share one Rust
binary and endpoint.

## Child lifetimes and cancellation

The weather workflow awaits both forecasts. The difference appears when a parent returns or is
cancelled with child work still pending.

**Obelisk** enforces
{{ doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }}. A parent
cannot finish until every join-set child has concluded. Closing a join set cancels pending
activities, timers and child workflows whose names opt into `-cancellable`; other child workflows
are awaited. Cancelled workflow code is not run again, so cleanup belongs in an ancestor, often a
minimal {{ doc_link(title="saga", path="js/getting-started-fly-agent.md#the-saga-pattern") }}.
`-schedule` is the explicit detached alternative.

**Temporal Rust** does not automatically join durable futures, and dropping one does not cancel its
Activity or Child Workflow. Application code must await or cancel it. Child Workflows add a Parent
Close Policy: terminate by default, request cooperative cancellation, or abandon the child. Activity
cancellation is also cooperative and usually delivered through heartbeats. See the
{{ target_link(title="Rust cancellation guide", href="https://docs.temporal.io/develop/rust/workflows/cancellation") }}
and
{{ target_link(title="Child Workflow guide", href="https://docs.temporal.io/develop/rust/workflows/child-workflows") }}.

**Restate Rust** durably submits a service call when its `CallFuture` is created, but returning
without awaiting it neither joins nor cancels the invocation. `.send()` makes intentional one-way
work explicit. Cancellation propagates cooperatively through request-response call trees; `kill`
skips cleanup. See
{{ target_link(title="managing invocations", href="https://docs.restate.dev/services/invocation/managing-invocations") }}.

## Determinism: convention or capability boundary

All three recover by replaying code against persisted history. Recorded side-effect results are not
repeated, so code must produce compatible durable operations during replay. The difference is how
strongly the runtime constrains the first execution.

### Obelisk removes ambient nondeterminism

An Obelisk `wasm32-unknown-unknown` workflow cannot open sockets, read files or environment
variables, use host time or randomness, or create native threads. It can only call explicitly
imported WIT functions. This removes broad classes of accidental nondeterminism before replay;
Obelisk still checks histories for compatibility after code changes. See the
{{ doc_link(title="workflow determinism documentation", path="concepts/workflows/_index.md") }}.

### Temporal and Restate run native application code

Temporal workflows run as native code in the user-hosted Worker. Authors must use SDK activities and
timers, avoid nondeterministic APIs, and reproduce commands compatible with Event History. Replay
detects mismatches, but this is an SDK discipline rather than a security sandbox. See Temporal's
{{ target_link(title="Workflow Definition", href="https://docs.temporal.io/workflow-definition") }}.

Restate likewise replays native handlers against a journal. Nondeterministic work belongs in
`ctx.run` or a separate service, and replay must issue compatible context operations. See
{{ target_link(title="service versioning", href="https://docs.restate.dev/services/versioning") }}.

## Security boundaries: server policy, APIs and activities

Obelisk separates restart-controlled host policy from hot-redeployable applications. `server.toml`
sets API tokens and broad rules such as exec-activity pinning. `deployment.toml` describes
components and narrower HTTP and secret capabilities; it must pass verification and cannot loosen
server policy. See the
{{ doc_link(title="configuration overview", path="configuration.md#overview", version="v0.41.5") }}
and
{{ doc_link(title="exec activity gating", path="configuration.md#exec-activity-gating", version="v0.41.5") }}.

Obelisk's API requires a token by default, while its webhook port remains open for application
traffic. Self-hosted Temporal defaults to a no-op authorizer, and self-hosted Restate expects a
proxy and network controls around ingress and administration. Their clouds add authentication. See
Obelisk's
{{ doc_link(title="authentication documentation", path="authentication.md", version="v0.41.5") }},
Temporal's
{{ target_link(title="self-hosted security guide", href="https://docs.temporal.io/self-hosted-guide/security") }}
and Restate's
{{ target_link(title="server security guide", href="https://docs.restate.dev/server/security") }}.

Temporal Activities and Restate service handlers are ordinary native application code. They can use
the process environment, filesystem and network. Restrictions belong to their deployment platform.

Obelisk WASM and JS activities run in a WebAssembly sandbox. Outbound HTTP is denied unless the
deployment explicitly permits a host and method. The Open-Meteo activity needs this entry:

```toml
[[activity_wasm.allowed_host]]
pattern = "https://api.open-meteo.com"
methods = ["GET"]
request_url_regex = "^GET https://api\\.open-meteo\\.com/v1/forecast$"
```

The Obelisk runtime enforces the allowlist. The same rule can inject a credential without exposing
its value to the component:

```toml
[[activity_wasm.allowed_host]]
pattern = "https://api.example.com"
methods = ["POST"]

[activity_wasm.allowed_host.secrets]
env_vars = ["API_TOKEN"]
replace_in = ["headers"]
```

The component puts an opaque placeholder in a header. The host substitutes the real value only after
the destination is approved, keeping the secret out of component memory, logs and workflow history.
See the
{{ doc_link(title="outbound HTTP configuration", path="configuration.md#outbound-http-allowlist", version="v0.41.5") }}.

This boundary also suits generated code. In
{{ target_link(title="workflow-agent", href="https://github.com/obeli-sk/workflow-agent") }}, an
agent runs inside Obelisk, edits stored component source and can hot-redeploy it after operator
approval.

## Interacting with a running workflow

Human approval and status reads reveal whether a workflow is a single waiting function or a durable
object with message handlers.

### Obelisk: typed oneshot channels at explicit wait points

An Obelisk workflow can call a typed
{{ doc_link(title="stub activity", path="concepts/activities/stub.md") }} that has a WIT signature
but no implementation:

```rust
let approval = approval(order_id)?;
```

The pending child can be fulfilled with a typed result through the CLI, Web UI or API, including by
another workflow. A workflow that submits the stub asynchronously with `-submit` can even resolve it
itself later. Either way the input has a fixed arrival point: it can only target a stub the workflow
has already created. Obelisk has no workflow-defined Query or handler that can run at an arbitrary
point, although execution state and history remain inspectable. Two stubs can form a
{{ doc_link(title="request/response pair", path="patterns/stub-rpc.md") }}.

### Temporal: a durable object with three message types

Temporal models a Workflow as a stateful service. A Signal is a durable message with no result, a
Query reads state without adding to history, and an Update is a tracked RPC that can mutate state
and return a result.

```rust
#[signal]
fn approve(&mut self, _ctx: &mut SyncWorkflowContext<Self>, input: Approval) {
    self.approval = Some(input);
}

#[query]
fn status(&self, _ctx: &WorkflowContextView) -> Status {
    self.status.clone()
}

#[update]
fn change_owner(&mut self, _ctx: &mut SyncWorkflowContext<Self>, owner: String) -> String {
    std::mem::replace(&mut self.owner, owner)
}
```

Async Signal and Update handlers can interleave with the main method at `await` points, so shared
state needs deliberate design, although handlers do not run in parallel. See Temporal's
{{ target_link(title="Rust message-passing guide", href="https://docs.temporal.io/develop/rust/workflows/message-passing") }}.

### Restate: workflow handlers and durable promises

Restate sits between those models. Its exclusive `run` handler is the single writer for a workflow
key; shared handlers can query state or resolve durable promises. A promise may be resolved before
the workflow starts waiting, so it is less position-dependent than an Obelisk stub.

```rust
#[shared]
async fn approve(
    &self,
    ctx: SharedWorkflowContext<'_>,
    decision: String,
) -> HandlerResult<()> {
    ctx.resolve_promise("decision", decision);
    Ok(())
}

// In run:
let decision: String = ctx.promise("decision").await?;
```

An RPC-like update can signal `run` and await a second promise for confirmation. See Restate's
{{ target_link(title="workflow tour", href="https://docs.restate.dev/tour/workflows") }}.

## What gets deployed

The architecture becomes clearer if we list the processes needed for this example.

| Deployment concern                   | Obelisk                                                                            | Temporal                                                                                             | Restate                                                                                                 |
| :----------------------------------- | :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| Application code                     | WASM components hosted by the server                                               | Separate Rust Worker process                                                                         | Separate Rust service endpoint                                                                          |
| Persistence                          | SQLite or PostgreSQL                                                               | Cassandra, MySQL or PostgreSQL for self-hosting                                                      | Built into a single server; clustered storage for HA                                                    |
| Application deployment and operation | Code changes form a versioned deployment managed by Obelisk through its CLI or API | The user is responsible for deploying and operating Worker processes, even when using Temporal Cloud | The user is responsible for deploying and operating application services, even when using Restate Cloud |

### Obelisk: application deployment is a runtime concept

For local development, one command starts the server with the application:

```sh
obelisk server run --deployment deployment.toml
```

The same manifest can be sent to a remote instance with the same CLI:

```sh
obelisk --api-token "$TOKEN" deployment apply \
  --api-url https://obelisk.example.com deployment.toml
```

`obelisk deployment apply` stores a versioned manifest and hot-activates it without restarting the
server. Local artifacts enter content-addressed storage; OCI components remain registry references.
A changed WASM or JS digest triggers replay of in-progress workflows against the new component.
Compatible executions upgrade automatically, while incompatible ones stay on the previous version.
See the {{ doc_link(title="deployments documentation", path="concepts/deployments.md") }}.

The smallest topology is also genuinely small: one Obelisk process can host the orchestrator,
workflows, activities and embedded SQLite database. Small installations typically fit in a 256 to
512 MB VM, although the required memory naturally depends on workload. PostgreSQL and
high-availability infrastructure remain options when the deployment outgrows that single-node shape.

Owning the components also enables a few useful operator features:

- **Replay and Advance** preview and selectively apply a paused workflow's next durable writes. See
  {{ doc_link(title="Replay and Advance CLI documentation", path="cli.md#replaying-an-execution", version="v0.41.5") }};
  the [0.38 announcement](@/blog/2026-05-29-announcing-obelisk-0-38.md#step-through-debugging) shows
  the Web UI.
- **Automatic backtraces** link durable events to stored source, creating a time-travelling
  debugger. See
  {{ doc_link(title="Backtrace capture", path="concepts/workflows/_index.md#backtrace-capture", version="v0.41.5") }}.
- **Logs follow the execution tree** across workflows and activities. See the
  {{ doc_link(title="execution logs CLI", path="cli.md#fetching-logs", version="v0.41.5") }}.
- **Exec activities** provide native process integration. They are disabled by default and can be
  restricted to reviewed script digests. See
  {{ doc_link(title="exec activity gating", path="configuration.md#exec-activity-gating", version="v0.41.5") }}.

### Temporal and Restate: orchestrators plus application processes

**Temporal** uses a service backed by Cassandra, MySQL or PostgreSQL, plus application Workers that
you deploy and scale. Temporal Cloud manages the service, not those Workers. Worker Versioning can
route executions among available builds, but Temporal does not receive or deploy the executable. The
current
{{ target_link(title="Worker Versioning support matrix", href="https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning") }}
does not yet list Rust.

**Restate** similarly runs `restate-server` separately from the Rust service endpoint. After
deploying the application, the operator registers it:

```sh
restate deployments register https://weather.example.com
```

New invocations use the latest compatible revision; in-progress invocations remain pinned, so old
endpoints must stay reachable until they drain. Restate owns the journal and revision metadata,
while the application platform owns the artifact and rollout. Restate Cloud manages the durable
runtime, but the user still supplies the application compute. See Restate's
{{ target_link(title="Cloud service connection documentation", href="https://docs.restate.dev/cloud/connecting-services") }}
and
{{ target_link(title="versioning documentation", href="https://docs.restate.dev/services/versioning") }}.

## Choosing between them

Choose **Temporal** when you want its established ecosystem, managed cloud, independently scalable
service architecture and mature operational model, especially if you can use one of its stable
language SDKs. For Rust specifically, account for the SDK's current Public Preview status.

Choose **Restate** when you want durable handlers and stateful services to remain ordinary HTTP
applications, including serverless deployments, and you are comfortable deploying those services
separately from the Restate Server. Its Rust API is compact, and it provides durable RPC handlers
and keyed stateful objects as first-class abstractions alongside workflows.

Choose **Obelisk** when you want three things together: a lightweight runtime that owns and executes
workflow components, a strong security boundary for unfamiliar or semi-untrusted code, and
self-contained deployments that can be hot-redeployed. Its deterministic workflow sandbox is paired
with sandboxed activities, runtime-enforced outbound HTTP policy and placeholder-based secret
injection. Reviewing the deployment TOML gives an operator a compact view of the intended blast
radius: which components run, which hosts and methods they may call, and where secrets may be
injected. The authenticated-by-default API, separately controlled server policy and deployment
verification extend that security boundary to operation of the runtime itself.

Recovery from persisted execution state is a baseline capability shared by all three. The defining
difference is that Obelisk is a workflow runtime, while Temporal and Restate are orchestrators with
separately deployed application code. Obelisk owns the execution boundary around that code, while
Temporal and Restate coordinate with application processes deployed and operated by the user.
