+++
title = "Join Sets"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Join sets are a core mechanism for handling {{doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} and asynchronous operations in Obelisk workflows. A join set represents a collection of pending operations (like activity calls or spawned child workflows). A workflow can interact with a join set in the following ways:

- Create a Join Set: A workflow can create a new join set, which is initially empty.

- Add Operations to a Join Set: When a workflow spawns a child execution (workflow, activity), the execution is associated with a join set.

- Await Results: The workflow can use a direct call or an {{ doc_link(title="extension", path="concepts/workflows/extension-functions.md") }} to wait for the next operation in that set to complete.

## Defining Features

* **Completion Order**: Operations in a join set are completed in an arbitrary order (determined by when the underlying activities or workflows finish). The `await-next` call returns results in the order they become available.

* **Persistence**: The state of join sets is persisted in the execution log, ensuring that workflows can resume correctly after failures.


## Join Set Kinds
There are three kinds of join sets:

* One-off - created by the Obelisk runtime when the workflow calls an activity or a child workflow directly.
* Named - created by the workflow using the `new-join-set-named` function.
* Generated - created by the workflow using the `new-join-set-generated` function.

## API
The API for join sets is as defined in [workflow-support.wit](https://github.com/obeli-sk/obelisk/blob/main/wit/obelisk_workflow/workflow-support.wit).

To create a join set in Rust, use
```rust
let named = new_join_set_generated("some-name", ClosingStrategy::Complete);
let generated = new_join_set_generated(ClosingStrategy::Complete)
```

## Limitations
Currently join sets are limited to a single type of child executions, meaning it is not possible to submit child executions that belong to more than one activity or a workflow function signature.

## Examples

### One-off (Direct Call)

The following example uses join sets implicitly by calling the child executions directly.
Each call marked as 1-5 will create a one-off join set and await the result.

```rust
fn star_added(login: String, repo: String) -> Result<(), String> {
    // 1. Persist the user giving a star to the project.
    let description = db::user::add_star_get_description(&login, &repo)?;
    if description.is_none() {
        // 2. Fetch the account info from GitHub.
        let info = github::account::account_info(&login)?;
        // 3. Fetch the prompt from the database.
        let settings_json = db::llm::get_settings_json()?;
        // 4. Generate the user's description.
        let description = llm::respond(&info, &settings_json)?;
        // 5. Persist the generated description.
        db::user::update_user_description(&login, &description)?;
    }
    Ok(())
}
```

### Named
The following example creates two join sets with named identifiers and uses them to parallelize `account-info` and `get-settings-json` activities.
```rust
fn star_added_parallel(login: String, repo: String) -> Result<(), String> {
    // Persist the user giving a star to the project - a direct call that creates and awaits a one-off join set.
    let description = db::user::add_star_get_description(&login, &repo)?;
    if description.is_none() {
        // 1. Create two join sets for the two child workflows.
        let join_set_info =
            new_join_set_named(&format!("{login}-info"), ClosingStrategy::Complete);
        let join_set_settings =
            new_join_set_named("settings", ClosingStrategy::Complete);
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

### Generated
The only difference between a named and generated join set is the way how it is created.
The example above could be slightly simplified by switching to the join sets with generated names:
```rust
let join_set_info = new_join_set_generated(ClosingStrategy::Complete);
```

One benefit of naming join sets is that they can be used to group child executions that are logically related, which can be useful for debugging and monitoring.


## Advanced Topics

### Join Set Finalization (Close)

Join sets are automatically closed when a workflow execution finishes. During teardown, all child executions that the parent execution
submitted but did not await for will be automatically processed. The parent workflow will be marked as finished only when all
unattended child executions are finished.

Currently, only `closing-strategy::complete` closing strategy is supported. This means that all child executions that were submitted
but not awaited will be awaited for during workflow teardown. Errors will be propagated unless
`forward_unhandled_child_errors_in_completing_join_set_close` {{ doc_link(title="configuration", path="configuration.md") }} setting is turned off.

In the future, `closing-strateg::cancel` will attempt to cancel each unattended child execution.


#### Example - Join set without awaiting child execution results
The following example creates a named join set for each login and uses it to parallelize the execution of the `star_added` function.
```rust
fn backfill_parallel(repo: String) -> Result<(), String> {
    let page_size = 5;
    let mut cursor = None;
    // Fetch the list of stargazers from GitHub. A blocking call that creates and awaits a one-off join set.
    while let Some(resp) =
        github::account::list_stargazers(&repo, page_size, cursor.as_deref())?
    {
        for login in &resp.logins {
            // 1. Create a named join set for each login.
            let named_join_set = new_join_set_named(login, ClosingStrategy::Complete);
            // 2. Submit the child execution to the named join set.
            imported_workflow_ext::star_added_parallel_submit(
                &named_join_set,
                login,
                &repo,
            );
        }
        if resp.logins.len() < usize::from(page_size) {
            break;
        }
        cursor = Some(resp.cursor);
    }
    Ok(())
}
```

Note that there is no corresponding `await-next` call in this example. When this execution completes, all join sets will be awaited.
