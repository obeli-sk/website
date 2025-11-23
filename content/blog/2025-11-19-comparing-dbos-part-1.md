+++
title = "Comparing Obelisk with DBOS"
date = 2025-11-19
+++

Obelisk and <a target="_blank" href="https://www.dbos.dev">DBOS</a> are both open-source
durable workflow engines.

Let's see how they compare in terms of ease of use, nondeterminism prevention and performance.

I will go through the <a target="_blank" href="https://docs.dbos.dev/java/programming-guide">Learn DBOS Java</a> tutorial
and compare it with Rust version of the same code written for Obelisk.
I chose Java because of familiarity, however the library has just been released so the code is still quite young.
On the Obelisk side, Rust is the obvious choice as it has the best
[performance](@/blog/2025-10-29-challenging-fastest-workflow-engine.md)
and [tooling](@/blog/2025-05-25-comparing-rs-js-go.md).

<!-- more -->


## Setting up the environment
DBOS-Java needs a JDK, Gradle and a PosgreSQL database.

For building WASM Components we need Rust and Cargo.

## Intro into deterministic workflow engines
As both [Obelisk](@/faq/_index.md) and
<a target="_blank" href="https://docs.dbos.dev/architecture#how-workflow-recovery-works">DBOS</a>
emphasize, workflows must be deterministic and activities / steps must be idempotent.

This ensures that long running workflows
can be replayed after a server crash or when they are migrated from one machine to another.

Activities can be retried automatically on a failure, but even a successful activity might
be retried if the server crashes just before persisting the result.

## Authoring workflows

Our test bed will be:
* An idempotent activity (step in DBOS lingo) that interacts with the world: sleeps and creates a file
* A `serial` and `parallel` workflows that run the activity with persistent sleep in a loop
* An HTTP endpoint (webhook endpoint in Obelisk lingo) that triggers these workflows.

Skip to [Experiments](#experiments) to avoid the wall of code.

### DBOS

In the DBOS <a target="_blank" href="https://github.com/tomasol/dbos-tutorial">repository</a>,
the step, workflows and a HTTP server can be put into a single Java class:

```java
package com.example;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Map;

import org.slf4j.LoggerFactory;
import dev.dbos.transact.DBOS;
import dev.dbos.transact.StartWorkflowOptions;
import dev.dbos.transact.config.DBOSConfig;
import dev.dbos.transact.workflow.Queue;
import dev.dbos.transact.workflow.Workflow;
import dev.dbos.transact.workflow.WorkflowHandle;
import io.javalin.Javalin;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;

interface Example {

    public int serial() throws Exception;

    public int childWorkflow(int i) throws Exception;

    public int parallelParent() throws Exception;
}

class ExampleImpl implements Example {

    private final Queue queue;
    private Example proxy;

    public ExampleImpl(Queue queue) {
        this.queue = queue;
    }

    public void setProxy(Example proxy) {
        this.proxy = proxy;
    }

    // Idempotent activity
    private static int step(int idx, int sleepMillis) throws Exception {
        System.out.printf("Step %d started%n", idx);
        Thread.sleep(sleepMillis);
        System.out.printf("Step %d creating file%n", idx);
        Path path = Path.of("file-" + idx + ".txt");
        Files.write(path, new byte[0]);
        System.out.printf("Step %d completed%n", idx);
        return idx;
    }

    @Workflow(name = "serial")
    public int serial() throws Exception {
        System.out.println("serial started");
        int acc = 0;
        for (int i = 0; i < 10; i++) {
            System.out.println("Persistent sleep started");
            DBOS.sleep(Duration.ofSeconds(1));
            System.out.println("Persistent sleep finished");
            final int i2 = i;
            int result = DBOS.runStep(() -> step(i2, 200 * i2), "step " + i);
            acc += result;
            System.out.printf("Step succeeded %d==%d%n", i, result);

        }
        System.out.println("serial completed");
        return acc;
    }

    // This child workflow exists because there is no way to run steps directly in
    // parallel.
    @Workflow(name = "parallel-child")
    public int childWorkflow(int i) throws Exception {
        return DBOS.runStep(() -> step(i, 200 * i), "step " + i);
    }

    @Workflow(name = "parallel-parent")
    public int parallelParent() throws Exception {
        System.out.println("parallel-parent started");
        ArrayList<Map.Entry<Integer, WorkflowHandle<Integer, Exception>>> handles = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            final int index = i;
            WorkflowHandle<Integer, Exception> handle = DBOS.startWorkflow(
                    () -> this.proxy.childWorkflow(index),
                    new StartWorkflowOptions().withQueue(this.queue));
            handles.add(new AbstractMap.SimpleEntry<>(i, handle)); // Tuple (i, handle)
        }
        System.out.println("parallel-parent submitted all parallel-child workflows");
        int acc = 0;
        for (var handle : handles) {
            System.out.printf("Awaiting parallel-child workflow %d%n", handle.getKey());
            int result = handle.getValue().getResult();
            acc += result;
            System.out.printf("parallel-child succeeded %d%n", result);
        }
        System.out.println("parallel-parent completed");
        return acc;
    }
}

public class App {
    public static void main(String[] args) throws Exception {
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.setLevel(Level.ERROR);
        DBOSConfig config = DBOSConfig.defaults("java1")
                // .withConductorKey(System.getenv("CONDUCTOR_KEY"))
                .withAppVersion("test-app-version") // Allow changing the code when replaying workflows
                .withDatabaseUrl(System.getenv("DBOS_SYSTEM_JDBC_URL"))
                .withDbUser(System.getenv("PGUSER"))
                .withDbPassword(System.getenv("PGPASSWORD"));
        DBOS.configure(config);
        Queue queue = new Queue("example-queue");
        DBOS.registerQueue(queue);
        ExampleImpl impl = new ExampleImpl(queue);
        Example proxy = DBOS.registerWorkflows(Example.class, impl);
        impl.setProxy(proxy);
        DBOS.launch();
        Javalin.create()
                .get("/serial", ctx -> {
                    int acc = proxy.serial();
                    ctx.result("serial workflow completed: " + acc);
                })
                .get("/parallel", ctx -> {
                    int acc = proxy.parallelParent();
                    ctx.result("parallel workflow completed: " + acc);
                })
                .start(9000);
    }
}
```

### Obelisk
Each component in the
<a target="_blank" href="https://github.com/obeli-sk/demo-tutorial">repository</a>
 is a separate Cargo package.
Obelisk also requires defining a schema between components using
<a target="_blank" href="https://component-model.bytecodealliance.org/design/wit.html">WIT (WebAssembly Interface Type)</a> IDL.

#### Activity
```wit
package tutorial:activity;

interface activity-sleepy {
    step: func(idx: u64, sleep-millis: u64) -> result<u64>;
}

world any {
    export tutorial:activity/activity-sleepy;
}
```

```rs
use exports::tutorial::activity::activity_sleepy::Guest;
use std::time::Duration;
use wit_bindgen::generate;

generate!({ generate_all });
struct Component;
export!(Component);

impl Guest for Component {
    fn step(idx: u64, sleep_millis: u64) -> Result<u64, ()> {
        println!("Step {idx} started");
        std::thread::sleep(Duration::from_millis(sleep_millis));
        println!("Step {idx} creating file");
        let path = format!("file-{idx}.txt");
        std::fs::File::create(path)
            .inspect_err(|err| eprintln!("{err:?}"))
            .map_err(|_| ())?;
        println!("Step {idx} completed");
        Ok(idx)
    }
}
```

#### Workflow
```wit
package tutorial:workflow;

interface workflow {
    serial:   func() -> result<u64>;
    parallel: func() -> result<u64>;
}

world any {
    export tutorial:workflow/workflow;
    // Import of the activity.
    import tutorial:activity/activity-sleepy;
    // Generated extensions for `parallel` workflow.
    import tutorial:activity-obelisk-ext/activity-sleepy;
    // Obelisk SDK
    import obelisk:types/execution@3.0.0;
    import obelisk:workflow/workflow-support@3.0.0;
    import obelisk:log/log@1.0.0;
}
```

```rs
use exports::tutorial::workflow::workflow::Guest;
use obelisk::{
    log::log,
    types::time::{Duration, ScheduleAt},
    workflow::workflow_support::{self, ClosingStrategy, new_join_set_generated},
};
use tutorial::{
    activity::activity_sleepy::step,
    activity_obelisk_ext::activity_sleepy::{step_await_next, step_submit},
};
use wit_bindgen::generate;

generate!({ generate_all });
struct Component;
export!(Component);

impl Guest for Component {
    fn serial() -> Result<u64, ()> {
        log::info("serial started");
        let mut acc = 0;
        for i in 0..10 {
            log::info("Persistent sleep started");
            workflow_support::sleep(ScheduleAt::In(Duration::Seconds(1)));
            log::info("Persistent sleep finished");
            let result = step(i, i * 200).unwrap();
            acc += result;
            log::info(&format!("Step succeeded {i}=={result}"));
        }
        log::info("serial completed");
        Ok(acc)
    }

    fn parallel() -> Result<u64, ()> {
        log::info("parallel started");
        let join_set = new_join_set_generated(ClosingStrategy::Complete);
        let max_iterations = 10;
        for i in 0..max_iterations {
            step_submit(&join_set, i, i * 200);
        }
        log::info("parallel submitted all child executions");
        let mut acc = 0;
        for _ in 0..max_iterations {
            let (_execution_id, result) = step_await_next(&join_set).unwrap();
            let result = result.unwrap();
            acc += result;
            log::info(&format!("child succeeded {result}"));
        }
        log::info("parallel completed");
        Ok(acc)
    }
}
```

#### Webhook endpoint
```wit
package any:any;

world any {
    import tutorial:workflow/workflow;
}
```

```rs
use crate::tutorial::workflow::workflow;
use anyhow::Result;
use wit_bindgen::generate;
use wstd::http::body::Body;
use wstd::http::{Error, Request, Response, StatusCode};

generate!({ generate_all });

#[wstd::http_server]
async fn main(request: Request<Body>) -> Result<Response<Body>, Error> {
    let path = request.uri().path_and_query().unwrap().as_str();
    let response = match path {
        "/serial" => {
            let acc = workflow::serial().unwrap();
            Response::builder().body(Body::from(format!("serial workflow completed: {acc}")))
        }
        "/parallel" => {
            let acc = workflow::parallel().unwrap();
            Response::builder().body(Body::from(format!("parallel workflow completed: {acc}")))
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("not found")),
    }
    .unwrap();
    Ok(response)
}
```

### Ergonomics

DBOS uses a callback approach when submitting child executions:
```java
int result = DBOS.runStep(() -> step(i, 200 * i), "step " + i);
```
The drawback here is lower readability when orchestrating a large number of steps.
DBOS could use Proxy pattern instead,
but it would make more difficult to attach metadata such as name, retry configuration
etc.

Obelisk workflows can call a child execution directly without a callback:
```rs
let result = step(i, i * 200).unwrap();
```
or using {{ doc_link(title="Extension Functions", path="concepts/extensions.md") }},
automatically generated from the activity's WIT file:
```rs
step_submit(&join_set, i, i * 200);
let (_execution_id, result) = step_await_next(&join_set).unwrap();
```

The great thing about DBOS is that the whole thing fits into a single Java file.

However, schema-first approach has several advantages:
* Strong, explicit interface contracts
* No way of forgetting to use the callback style or to construct a proxy object.
This would lead to mixing side effects into workflows.
* Cross-language interoperability: The WASM Component Model supports many languages such as
Rust, JavaScript, Python, Go and more.
* Versioning and backward-compatibility: Activities can export several versions
of the same interface, enabling workflows to catch up on their pace.
* Codegen allows creating multiple variants of the same exported function, so
attaching metadata is not an issue.


## Experiments

### Experiment A: Simulating a server crash

The task is to start the workflow, kill the server and start it again to see if the workflow finishes.

Submitting the parallel workflow in DBOS and then killing the server
revealed an unplesent surprise: After restart the workflow ended in `ERROR` state, with an error and a huge stack trace:
```
11:02:54.411 [pool-1-thread-2] ERROR dev.dbos.transact.execution.DBOSExecutor -- enqueueWorkflow
dev.dbos.transact.exceptions.DBOSWorkflowExecutionConflictException: Conflicting workflow ID 66b7739d-0d83-4b02-b99c-e824c6e2bfd5
...
```
However, after I
{{target_link(title="reported", href="https://github.com/dbos-inc/dbos-transact-java/issues/218")}}
the bug, the PR was merged within 24 hours. Kudos to the DBOS team.

Other than that, the only notable issue I found was that DBOS recovery started after around a one minute delay.
I was {{target_link(title="instructed", href="https://discord.com/channels/1156433345631232100/1440346985675886673/1440367182415532124")}}
to disable Conductor, a proprietary distributed orchestrator, which resolved the problem.

No problems with Obelisk were found.

### Experiment B: Breaking determinism with code changes

Changing code of a running workflow is a delicate process. It can only work when the change does not affect
the execution log, or when the running execution did not reach the changed line yet.

One clever trick that DBOS does is that it detects code changes by
{{target_link(title="hashing the bytecode", href="https://github.com/dbos-inc/dbos-transact-java/blob/94713bcdd00d45a8729924703d65415f0e2296e9/transact/src/main/java/dev/dbos/transact/internal/AppVersionComputer.java#L15")}}
of workflow classes. Obviously this is a best-effort solution, as the change can come from a dependency, or from
using a nondeterministic construct, as discussed later.
Instead of extracting the workflow logic into another file, I have disabled the hashing by setting a constant application version.

Obelisk does not currently perform a hash digest of the workflow's WASM executable. In the future, it will
{{target_link(title="store the WASM hash", href="https://github.com/obeli-sk/obelisk/issues/175")}}
when an execution is created. Contrary to DBOS, this approach reliably reflects whether the code (including dependencies) changed or not.

DBOS {{target_link(title="should", href="https://discord.com/channels/1156433345631232100/1440828912916500561/1440828912916500561")}}
throw an error when events produced on replay do not match the original execution log.

Let's start with an obvious change in the `serial` workflow:
```diff
 public int serial() throws Exception {
     ...
-    for (int i = 0; i < 10; i++) {
+    for (int i = 9; i >= 0; i--) {
         // Note that the step name changed as well:
         int result = DBOS.runStep(() -> step(i2, 200 * i2), "step " + i);
```

```diff
 fn serial() -> Result<(), ()> {
     ...
-    for i in 0..10 {
+    for i in (0..10).rev() {
        // Call the activity with different parameters
        let result = step(i, i * 200).unwrap();
```
An in-progresss execution that is replayed after restart should detect it immediately as the `i` variable
is used as a parameter to `step` invocation.

Both engines detect the failure:
<img src="{{ get_url(path="blog/2025-11-19-comparing-dbos-part-1/experiment-b-dbos.png") }}" style="border: 2px dotted #efeded;" />

<img src="{{ get_url(path="blog/2025-11-19-comparing-dbos-part-1/experiment-b-obelisk.png") }}" style="border: 2px dotted #efeded;" />

Full error:
```
key does not match event stored at index 4:
key: ChildExecutionRequest(E_01KAJVHDX4VAPCPAXXZ2QCVWCZ.o:1_1.o:2-step_1, tutorial:activity/activity-sleepy.step, params: [9, 1800]),
event: JoinSetRequest(ChildExecutionRequest(E_01KAJVHDX4VAPCPAXXZ2QCVWCZ.o:1_1.o:2-step_1, tutorial:activity/activity-sleepy.step, params: [0, 0]))
```

Notice that the DBOS error  only contains the naming differences, `step 0` vs `step 9` whereas Obelisk contains the actual parameters.
In fact, if we are a bit lazy, and do not serialize parameters into the name properly:

```diff
- int result = DBOS.runStep(() -> step(i2, 200 * i2), "step " + i);
+ int result = DBOS.runStep(() -> step(i2, 200 * i2), "step");
```
the workflow will finish happily with result 0+1+2+6+5+4+3+2+1+0=24!

### Experiment C: Trimming execution events

Another interesting test is to lower the number of iterations.
Let's start a `serial` workflow, wait until around `step 8`, kill the server and change:
```diff
 public void serial() throws Exception {
    ...
-    for (int i = 0; i < 10; i++) {
+    for (int i = 0; i < 3; i++) {
        ...
        int result = DBOS.runStep(() -> step(i2, 200 * i2), "step " + i);
```
This kind of error can lead to resources like temporary VMs running without a cleanup and should be reported by the engine.

The latest version of Obelisk detects it correctly:
```
found unprocessed event stored at index 18: event: JoinSetCreate(o:7-sleep)
```

DBOS marks the trimmed execution as successful, returning 0+1+2=3.

Full disclosure: Obelisk 0.26.2 did not detect these changes correctly, fixes landed for 0.27.0 .

### Experiment D: Breaking determinism using nondeterministic code

Instead of changing the code, determinism can be broken by using nondeterministic constructs.
DBOS documentation {{target_link(title="warns", href="https://docs.dbos.dev/java/tutorials/workflow-tutorial#determinism")}}:

> Java's threading and concurrency APIs are non-deterministic. You should use them only inside steps.

Using any source of nondeterminism, including current date, IO, environment variables, RNG or something more subtle like hash maps will break the replay as well.

For posterity, let's replace the `ArrayList` / `Vec` with a hash map:



### Experiment E: Resource usage with sleepy workflows and activities
Have 1000 workflows that sleep for 24 hours, measure RSS, graph it.
Same for activities.

### Experiment F: Fibo perf in AWS

Paste the AWS Step function comparison graph.


## Conclusion


easy to start - library

callback hell!

no isolation
no retries on timeouts
no determinism
Each language requires separate SDK

Cloud: How do they run the whole app with all its dependencies? Separate concerns!
Very tricky to upgrade, they do have versions so that old version replays with the old code but it is much easier to just run the original WASM,
no way of breaking determinism that way. They have no type safe schema language so every pull request in the whole app must be checked
not only for static determinism breakage (using hash maps), but also versioning breakage.

easy to start, hard to make changes - seemingly unrelated code changes can lead to (silent) determinism breakage.

Web console (conductor) - proprietary, must connect to the cloud.

Obelisk
fluid calls, no callbacks
no footguns (thread.sleep, hash maps etc.)
no queues (just the default one)
sending signals - only through stubbed activities, which guarantees that the workflow is in a correct state.

https://github.com/earendil-works/absurd
nice UI
queues
JS Only

WASM approach is good for code change detection.

DBOS is several separate engines, so fix in one language does not translate to others.

Detection of code changes can be improved, however it is simply impossible to prevent
accidental nondeterminisic constructs unless workflows are completely isolated
in a runtime that is built around deterministic execution.

# Bugs:


conductor UI https://github.com/dbos-inc/dbos-transact-java/issues/219

# Pet peeves
Durable sleep uses Thread.sleep, blocking a thread - nope, only for steps.
There doesn't seem a way to transparently unload the execution that is sleeping for days from memory - not sure, debug.
Point out that Thread.sleep in workflow is wrong and does not compile in Rust.
Can we catch exception of persistent sleep or how does it work? - Mention it is impossible in Obelisk.

Mention idempotency - lacking in docs, only mentioned in idempotent ID generation. and determinism. Mention distributed sagas video.

Compare nondeterminism detected - await 10 and 20 tasks with code change. (hang)

Break nondeterminism with hashset


DBOS Props:
+ No configuration, workflows, steps, HTTP endpoints are just code
