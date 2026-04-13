+++
title = "Persistent Sleep"
template = "docs.html"
weight = 20
+++

Persistent or durable sleep means the workflow's state is saved, and execution will resume after the duration has elapsed, even if the Obelisk server restarts.

The {{ doc_link(title="Runtime Support API", path="concepts/runtime-support.md") }} contains method `sleep` which creates an one-off {{ doc_link(title="Join Set", path="concepts/workflows/join-sets.md") }} and blocks the execution until the delay has timed out.

If the durable sleep is cancelled, `sleep` returns an error that must be handled by the workflow:

```rs
workflow_support::sleep(ScheduleAt::In(SchedulingDuration::Seconds(10)))
    .map_err(|()| MyWorkflowError::Cancelled)?;
```

Another way to submit a persistent delay is to use {{ doc_link(title="Heterogenous Join Set", path="concepts/workflows/join-sets.md#heterogenous-join-sets") }} with the `submit_delay` function.

```rs
fn two_delays_in_same_join_set() -> Result<(), ()> {
    let join_set = workflow_support::join_set_create();
    let _long = submit_delay(&join_set, ScheduleAt::In(DurationEnum::Seconds(10)));
    let short = submit_delay(&join_set, ScheduleAt::In(DurationEnum::Milliseconds(10)));
    // child executions can be added to this join set using `-submit` extension.
    // `join_next` returns `result<tuple<response-id, result>, join-next-error>`
    let (ResponseId::DelayId(first), res) = join_next(&join_set)
        .expect("submitted two delays, joining first, thus `join-next-error::all-processed` cannot happen")
    else {
        unreachable!("only delays have been submitted");
    };
    assert!(res.is_ok());
    assert_eq!(short.id, first.id);
    // long delay will be cancelled when the join set is closed.
    Ok(())
```