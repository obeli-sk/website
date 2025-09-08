+++
title = "Join Sets"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Join sets are a core mechanism for handling {{doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} and asynchronous operations in Obelisk workflows. A join set represents a collection of pending operations (like activity calls or spawned child workflows). A workflow can interact with a join set in the following ways:

- Create a Join Set: A workflow can create zero to many join sets, each is initially empty.

- Add Operations to a Join Set: When a workflow spawns a child execution (workflow, activity), the execution is associated with a join set.

- Await Results: The workflow can use the `-await-next` {{ doc_link(title="extension", path="concepts/extension-functions.md") }} or
`join-next` {{ doc_link(title="support function", path="concepts/runtime-support.md") }} to wait for the next operation in that set to complete.

## Defining Features

* **Completion Order**: Operations in a join set are completed in an arbitrary order (determined by when the underlying activities or workflows finish). The `await-next` call returns results in the order they become available. This does not break the determinism, as responses maintain their own ordering.

* **Persistence**: The state of join sets is persisted in the execution log, ensuring that workflows can resume correctly after failures.


## Join Set Kinds
There are three kinds of join sets:

* One-off - created by the Obelisk runtime when the workflow calls an activity or a child workflow directly.
* Named - created by the workflow using the `new-join-set-named` function.
* Generated - created by the workflow using the `new-join-set-generated` function.

### Allowed Named Join Set Charset
The name of a join set is limited to the following charset: Alphanumeric characters (both upper and lower case), and these special characters: `_-/`

See {{ doc_link(title="Join Set ID", path="concepts/identifiers.md#join-set-id") }} for details.

## API
The API for join sets is as defined in [workflow-support.wit](https://github.com/obeli-sk/obelisk/blob/main/wit/obelisk_workflow%402.0.0/workflow-support%402.0.0.wit).

To create a join set in Rust, use
```rust
let named = new_join_set_named("some-name", ClosingStrategy::Complete).unwrap(); // See allowed join set characters
let generated = new_join_set_generated(ClosingStrategy::Complete)
```

### One-off (implicit) Join Set

The following example uses join sets implicitly by calling the child executions directly.
Each call marked as 1-5 will create a one-off join set and await the result.

```rust
fn star_added(login: String, repo: String) -> Result<(), String> {
    // 1. Persist the user giving a star to the project.
    let description = db::user::add_star_get_description(&login, &repo)?; // Create a one-off join set implicitly.
    if description.is_none() {
        // 2. Fetch the account info from GitHub.
        let info = github::account::account_info(&login)?; // Create a one-off join set implicitly.
        // 3. Fetch the prompt from the database.
        let settings_json = db::llm::get_settings_json()?; // Create a one-off join set implicitly.
        // 4. Generate the user's description.
        let description = llm::respond(&info, &settings_json)?; // Create a one-off join set implicitly.
        // 5. Persist the generated description.
        db::user::update_user_description(&login, &description)?; // Create a one-off join set implicitly.
    }
    Ok(())
}
```

### Named and Generated Join Set
The implicit form has one problem: the workflow will not
be able to handle the child execution failure due to timeouts or errors. This would lead to an unhandled child execution error that
will mark the whole execution as failed. This is the reason why `-await-next` returns a result with the following error:

```wit
/// Error that is thrown by `-await-next` extension functions.
variant await-next-extension-error {
    /// Execution response was awaited and marked as processed, but it finished with an error.
    execution-failed(execution-failed),
    /// All submitted requests and their responses of specified function and join set were already processed.
    all-processed,
    /// Execution response was awaited and marked as processed, but it belongs to a different function.
    /// This can happen when join set contains responses of multiple functions or delay requests.
    function-mismatch(function-mismatch),
}
```

The following example creates two named join sets and uses them to parallelize `account-info` and `get-settings-json` activities.

```rust
fn star_added_parallel(login: String, repo: String) -> Result<(), String> {
    // Persist the user giving a star to the project - a direct call that creates and awaits a one-off join set.
    let description = db::user::add_star_get_description(&login, &repo)?; // Create a one-off join set implicitly.
    if description.is_none() {
        // 1. Create two join sets for the two child workflows.
        let join_set_info =
            new_join_set_named(&format!("{login}-info"), ClosingStrategy::Complete).unwrap();
        let join_set_settings =
            new_join_set_named("settings", ClosingStrategy::Complete).unwrap();
        // 2. Submit the two child workflows asynchronously.
        account_info_submit(&join_set_info, &login);
        get_settings_json_submit(&join_set_settings);
        // 3. Await the results.
        let info = account_info_await_next(&join_set_info)
            .map_err(err_to_string)?
            .1?;
        let settings_json = get_settings_json_await_next(&join_set_settings)
            .map_err(err_to_string)?
            .1?;
        // Generate the user's description - a blocking call.
        let description = llm::respond(&info, &settings_json)?;
        // Persist the generated description - a blocking call.
        db::user::update_user_description(&login, &description)?;
    }
    Ok(())
}
```
The only difference between a named and generated join set is the way how it is created.
The example above could be slightly simplified by switching to the join sets with generated names:
```rust
let join_set_info = new_join_set_generated(ClosingStrategy::Complete);
```
One benefit of naming join sets is that they can be used to group child executions that are logically related, which can be useful for debugging and monitoring.

## Homogenous Join Sets
When a join set contains only child executions of the same function, it is called homogenous. It is safe to call `-await-next` until all submitted executions are awaited. Calling `-await-next` more times will result in `await-next-extension-error::all-processed` error.

```rust
let join_set = new_join_set_generated(ClosingStrategy::Complete);
// Submit the same execution with different parameters.
for _ in 0..9 {
    let _execution_id = account_info_submit(&join_set, foo());
}
// Await the responses as they arrive.
for _ in 0..9 {
    let (_execution_id, res) = account_info_await_next(&join_set).unwrap();
}
```

## Heterogenous Join Sets
When a join set contains child executions of multiple functions, or delay requests, it is called heterogenous. It is generally not safe to call `-await-next` extension as the resolved response might not belong to the awaited function. Therefore one must use `join-next` workflow {{ doc_link(title="support function", path="concepts/runtime-support.md") }} together with `-get` extension function based on the returned `response-id`.

```rust
let join_set = new_join_set_generated(ClosingStrategy::Complete);
// Submit the two child executions and a delay request.
let execution_id_account = account_info_submit(&join_set, &login);
let execution_id_settings = get_settings_json_submit(&join_set);
let _delay_id = submit_delay(&join_set, ScheduleAt::In(Duration::Seconds(10)));
// Use `join-next` to get the first response.
match join_next(&join_set) {
    Ok(ResponseId::DelayId(_)) => println!("delay won"),
    Ok(ResponseId::ExecutionId(execution_id)) => {
        if execution_id.id == execution_id_account.id {
            // use `-get` to obtain the response
            match account_info_get(&execution_id) {
                Ok(resp) => println!("account-info response won: {resp:?}"),
                Err(GetExtensionError::ExecutionFailed(_)) => todo!("handle failure"),
                Err(GetExtensionError::FunctionMismatch(_)) => {
                    unreachable!("this must be account-info based on execution id")
                }
                Err(GetExtensionError::NotFoundInProcessedResponses) => {
                    unreachable!("execution-id must have been processed as it was returned by `join-next`")
                }
            }
        }
    }
    Err(JoinNextError::AllProcessed) => unreachable!("submitted 3 child requests"),
}
```

## Advanced Topics

### Join Set Close

Join sets are automatically closed when a they go out of scope or when workflow execution finishes. During this process, all child executions that the parent execution submitted but did not await for will be automatically processed. The parent workflow will be marked as finished only when all
unattended child executions are finished.

Currently, only `closing-strategy::complete` closing strategy is supported. This means that all child executions that were submitted
but not awaited will be awaited for during workflow teardown.

In the future, `closing-strateg::cancel` will attempt to cancel each unattended child execution.


#### Example - Join set without awaiting child execution results
The following example creates a named join set for each user fetched from the database and uses it to parallelize the execution of the `star_added` function.
```rust
fn backfill_parallel(repo: String) -> Result<(), String> {
    let page_size = 5;
    let mut cursor = None;
    while let Some(resp) = // fetch a batch of users using an one-off join set
        github::account::list_stargazers(&repo, page_size, cursor.as_deref())?
    {
        let mut join_set_batch = Vec::new();
        for login in &resp.logins {
            let join_set = new_join_set_named(login, ClosingStrategy::Complete)
                    .expect("github login does not contain illegal characters");
            // `-submit`-ting child executions without `-await`-ing results
            star_added_parallel_submit(
                &join_set,
                login,
                &repo,
            );
            join_set_batch.push(join_set); // closing join set here would kill parallelism
        }
        if resp.logins.len() < usize::from(page_size) {
            // last batch of join sets closed here.
            break;
        }
        cursor = Some(resp.cursor);
        // join set batch closed here.
    }
    Ok(())
}
```

Note that there is no corresponding `await-next` call in this example.
The scoped Join Set Close adds back-pressure - the first batch of five child executions are submitted,
then implicitly awaited before the while loop begins again:

<img src="{{ get_url(path="stargazers-backfill-parallel.png") }}" />
Lines `o1_1` and `o2_1` are one-off join sets containing the `list-stargazers` activity.
