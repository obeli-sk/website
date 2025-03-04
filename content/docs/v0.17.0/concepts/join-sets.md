+++
title = "Join Sets"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Join sets are a core mechanism for handling concurrency and asynchronous operations in Obelisk workflows. A join set represents a collection of pending operations (like activity calls or spawned child workflows). A parent workflow can interact with a join set in the following ways:

- Create a Join Set: A workflow can create a new join set, which is initially empty.

* Add Operations to a Join Set: When a workflow starts an activity or spawns a child workflow, these are automatically or manually associaded with a join set.

    * Blocking call

    * non-blocking call (`-submit`)

- Await Results: The workflow can use `await-next` on a join set to wait for the next operation in that set to complete. This call blocks until a result is available.

Currently join sets are limited to a single type of child executions, meaning it is not possible to submit child executions that belong to more than one activity or a workflow function signature.

## Key Properties of Join Sets

Completion Order: Operations in a join set are completed in an arbitrary order (determined by when the underlying activities or workflows finish). The await-next call returns results in the order they become available.

Persistence: The state of join sets is persisted in the execution log, ensuring that workflows can resume correctly after failures.

Closing: Join sets are automatically "closed" when the execution finishes. This allows workflows to wait for all child executions to finish.
In the future it will be possible to set a flag on join sets that will cancel all child
executions that were not awaited for.

## Join Set Kinds
There are three kinds of join sets:

* One-off - created by the Obelisk runtime when the workflow calls an activity or a child workflow directly.
* Named - created by the workflow using the `new-join-set-named` function.
* Generated - created by the workflow using the `new-join-set-generated` function.

## API
The API for join sets is as defined in [workflow-support.wit](https://github.com/obeli-sk/obelisk/blob/main/wit/obelisk_workflow/workflow-support.wit).

## Examples

### One-off

The following examples uses join sets implicitly by calling the child executions directly. Each call marked as 1-5 will create a one-off join set and await for the result.

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
Each of the calls marked as 1-5 will trigger insertion of the following events into the execution log:

1. `JoinSetCreate` - A new join set is created with kind `one-off`, and a generated identifier.
2. `JoinSetRequest.ChildExecutionRequest` - an event containing the {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} of the child execution and the join set identifier.
3. `JoinNext` - an event that blocks the workflow until the child execution completes.

### Named
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
In this case all the child executions could share the same join set. One benefit of naming join sets is that they can be used to group child executions that are logically related,
which can be useful for debugging and monitoring.

The line marked with 1(`new_join_set_named`) will trigger insertion of the following event into the execution log: `JoinSetCreate` with kind `named` and the passed identifier.
The line maked with 2(`_submit`) will trigger insertion of the following event into the execution log: `JoinSetRequest.ChildExecutionRequest` with the {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} of the child execution and the join set identifier.

Note that there is no corresponding `await-next` call in this example. When this execution completes, all join sets will be awaited.

### Generated
The following example creates two join sets with generated identifiers and uses them to parallelize `account-info` and `get-settings-json` activities.
```rust
fn star_added_parallel(login: String, repo: String) -> Result<(), String> {
    // Persist the user giving a star to the project - a blocking call that creates and awaits a one-off join set.
    let description = db::user::add_star_get_description(&login, &repo)?;
    if description.is_none() {
        // 1. Create two join sets for the two child workflows.
        let join_set_info =
            new_join_set_generated(ClosingStrategy::Complete);
        let join_set_settings =
            new_join_set_generated(ClosingStrategy::Complete);
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

The line marked with 1 will trigger insertion of the following event into the execution log: `JoinSetCreate` with kind `generated` and a auto-incremented identifier.
The line marked with 2 will trigger insertion of the following events into the execution log: `JoinSetRequest.ChildExecutionRequest` with the {{ doc_link(title="FFQN", path="concepts/ffqn.md") }} of the child execution and the join set identifier.
The lines marked with 3 will trigger insertion of the following events into the execution log: `JoinNext` that blocks the workflow until the child execution completes.
