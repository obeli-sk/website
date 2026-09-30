+++
title = "Rust Workflows"
template = "docs.html"
weight = 26
+++

This page shows workflows written in Rust. The model is the same as in JavaScript: read
{{ doc_link(title="Workflows", path="concepts/workflows/_index.md") }} and
{{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }} first. Rust workflows are
compiled to `wasm32-unknown-unknown` and run in Wasmtime. Like activities, their functions must
return a `result` type, see
{{ doc_link(title="Rust Activities", path="wasm/activities.md#return-types") }}.

## Calling an activity

Continuing the fibonacci example from
{{ doc_link(title="Rust Activities", path="wasm/activities.md") }}, the
[demo-tutorial Rust workflow](https://github.com/obeli-sk/demo-tutorial/tree/main/rust/workflow-tutorial)
is a complete buildable example. The project uses the following layout:

```sh
.
├── Cargo.toml
├── rust-toolchain.toml
├── src
│   └── lib.rs
└── wit
    ├── deps
    │   ├── obelisk_types@6.0.0
    │   │   └── types.wit
    │   ├── obelisk_workflow@7.0.0
    │   │   └── workflow-support.wit
    │   ├── template-fibo_activity
    │   │   └── fibo-activity.wit                   # Imported activity
    │   ├── template-fibo_activity-obelisk-ext
    │   │   └── activity-obelisk-ext.wit            # Generated -ext import
    │   └── template-fibo_workflow
    │       └── fibo-workflow.wit                   # Exported interface
    └── impl.wit                                    # World (imports and exports)
```

The activity interface, `fibo-activity.wit`:

```wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo-activity: func(n: u8) -> result<u64>;
}
```

The workflow interface, `fibo-workflow.wit`:

```wit
package template-fibo:workflow;

interface fibo-workflow-ifc {
    fiboa: func(n: u8, iterations: u32) -> result<u64>;
    fiboa-concurrent: func(n: u8, iterations: u32) -> result<u64>;
}
```

The world, `impl.wit`, exports the workflow and imports the activity:

```wit
package any:any;

world any {
    export template-fibo:workflow/fibo-workflow-ifc;
    import template-fibo:activity/fibo-activity-ifc;
    import template-fibo:activity-obelisk-ext/fibo-activity-ifc;
    import obelisk:workflow/workflow-support@7.0.0;
}
```

[wit-bindgen](https://crates.io/crates/wit-bindgen) turns the exported interface into a `Guest`
trait and generates bindings for the imports. Calling an imported function blocks until the child
execution finishes:

```rust
impl Guest for Component {
    fn fiboa(n: u8, iterations: u32) -> Result<u64, ()> {
        let mut last = 0;
        for _ in 0..iterations {
            // Pause the workflow, submit a new activity execution and wait for the result.
            last = fibo_activity(n).unwrap();
        }
        Ok(last)
    }
}
```

```toml
[[activity_wasm]]
name = "activity_myfibo"
location = "target/wasm32-wasip2/release/myactivity.wasm"

[[workflow_wasm]]
name = "myworkflow"
location = "target/wasm32-unknown-unknown/release/myworkflow.wasm"
```

```sh
cargo build --release
obelisk server run --app-config app.toml --deployment deployment.toml
obelisk execution submit --follow \
    template-fibo:workflow/fibo-workflow-ifc.fiboa [40,10]
```

The trace shows that the `fibo` activities were executed sequentially:

<img src="{{ get_url(path="fiboa-trace.png") }}" alt="Sequential trace" style="max-width: 100%;
height: auto; display: block;" />

## Submitting concurrently

The generated `-obelisk-ext` interface adds `-submit`, `-await-next`, and `-get` functions for every
imported function. See {{ doc_link(title="Extensions", path="wasm/extensions.md") }}.

```rust
fn fiboa_concurrent(n: u8, iterations: u32) -> Result<u64, ()> {
    let join_set = join_set_create();
    for _ in 0..iterations {
        fibo_activity_submit(&join_set, n).unwrap();
    }
    let mut last = 0;
    for _ in 0..iterations {
        last = fibo_activity_await_next(&join_set).unwrap().unwrap();
    }
    Ok(last)
}
```

<img src="{{ get_url(path="fiboa-concurrent-trace.png") }}" alt="Concurrent trace" style="max-width:
100%; height: auto; display: block;" />

## Join sets in Rust

```rust
let named = join_set_create_named("some-name").unwrap(); // See allowed join set characters
let generated = join_set_create();
```

Named join sets submitting two activities in parallel, from the
[stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/workflow):

```rust
fn star_added_parallel(login: String, repo: String) -> Result<(), String> {
    let description = db::user::add_star_get_description(&login, &repo)?; // one-off join set
    if description.is_none() {
        let join_set_info = join_set_create_named(&format!("{login}-info")).unwrap();
        let join_set_settings = join_set_create_named("settings").unwrap();
        account_info_submit(&join_set_info, &login);
        get_settings_json_submit(&join_set_settings);
        // `-await-next` returns the child result directly;
        // read `join_set.last_id()` if you also need the execution id.
        let info = account_info_await_next(&join_set_info).map_err(err_to_string)??;
        let settings_json = get_settings_json_await_next(&join_set_settings).map_err(err_to_string)??;
        let description = llm::respond(&info, &settings_json)?;
        db::user::update_user_description(&login, &description)?;
    }
    Ok(())
}
```

A heterogenous join set, mixing child executions and a delay, is awaited with `join_next`. Read
`join_set.last_id()` to learn which response was processed, then type the value with `-get`:

```rust
let join_set = join_set_create();
let execution_id_account = account_info_submit(&join_set, &login);
let _execution_id_settings = get_settings_json_submit(&join_set);
let _delay_id = submit_delay(&join_set, ScheduleAt::In(Duration::Seconds(10)));
match join_next(&join_set) {
    Ok(_result) => match join_set.last_id() {
        Some(ResponseId::DelayId(_)) => println!("delay won"),
        Some(ResponseId::ExecutionId(execution_id)) if execution_id.id == execution_id_account.id => {
            let resp = account_info_get(execution_id).expect("processed by join_next");
            println!("account-info response won: {resp:?}");
        }
        other => println!("settings or unexpected response won: {other:?}"),
    },
    Err(JoinNextError::AllProcessed) => unreachable!("submitted 3 child requests"),
}
```

`join_next_try` is the non-blocking variant, returning `JoinNextTryError::Pending` when no response
is available yet.

Join sets are closed with `join_set_close`, or automatically when the `JoinSet` value goes out of
scope. Dropping a batch of join sets at the end of a loop iteration therefore waits for their child
workflows, which adds back-pressure:

```rust
fn backfill_parallel(repo: String) -> Result<(), String> {
    let page_size = 5;
    let mut cursor = None;
    while let Some(resp) = github::account::list_stargazers(&repo, page_size, cursor.as_deref())? {
        let mut join_set_batch = Vec::new();
        for login in &resp.logins {
            let join_set = join_set_create_named(login).expect("valid join set name");
            star_added_parallel_submit(&join_set, login, &repo);
            join_set_batch.push(join_set); // closing the join set here would kill parallelism
        }
        if resp.logins.len() < usize::from(page_size) {
            break;
        }
        cursor = Some(resp.cursor);
        // `join_set_batch` is dropped here, awaiting all child workflows.
    }
    Ok(())
}
```

<img src="{{ get_url(path="stargazers-backfill-parallel.png") }}" alt="Backfill trace" />

## Persistent sleep

```rust
workflow_support::sleep(ScheduleAt::In(Duration::Seconds(10)), None)
    .map_err(|()| MyWorkflowError::Cancelled)?;
```

The trailing `None` optionally names the one-off join set. `sleep` returns an error if the delay is
cancelled. Use `submit_delay` to put a delay into a join set instead.

## Scheduling

The `-schedule` function from the generated `-obelisk-schedule` interface starts a top-level
execution without awaiting it:

```rust
fn schedule_child(n: u8) {
    fibo_activity_schedule(ScheduleAt::In(Duration::Minutes(5)), n).unwrap();
}
```

## Backtrace sources

Workflow backtraces are captured lazily during user-issued replay and advance operations. If
`backtrace.sources` is set, the Web UI can display the source file and line of every captured frame:

<img src="{{ get_url(path="backtrace.png") }}" alt="A backtrace viewer" style="max-width: 100%;
height: auto;" />

```toml
[[workflow_wasm]]
backtrace.sources = {".../src/lib.rs" = "workflow/src/lib.rs"}
```

The mapping is from frame source to the local file system. When `.../` is used, the frame source
path is matched by suffix, `src/lib.rs` in this example. To replay an execution and persist its
call-site backtraces, run:

```sh
obelisk execution persist-backtraces <execution-id>
```
