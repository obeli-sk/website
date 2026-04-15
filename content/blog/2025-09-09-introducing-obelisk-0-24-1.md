+++
title = "Introducing Obelisk 0.24.1"
date = 2025-09-09
+++

Obelisk is an open-source deterministic workflow engine that runs, stores, and replays WASM-based
workflows using SQLite.

There have been many changes since the
[initial public release 0.19.1](@/blog/2025-05-03-introducing-obelisk.md), mostly focused on
structured concurrency ergonomics, adding more abilities to activities and exploring using other
languages than Rust for authoring WASM Components.

<!-- more -->

## Experimental support for {{ doc_link(title="Process spawning", path="concepts/activities/process.md") }} and {{ doc_link(title="disk IO", path="concepts/activities/preopened-dirs.md") }}

Process API allows for spawning processes on the same machine that runs the
{{ doc_link(title="activity", path="concepts/activities/_index.md") }}. Moreover, with preopened
directory support, activities can use Rust and its standard library to access a temporary directory
on the host. Both of these features are useful for cases when no WASM-native library is available.
One can use the disk IO to set up a configuration file, download a remote file and then use the
Process API to drive the execution, interacting with the process if needed.

Process API will be used as the basis for future microVM support.

## {{ doc_link(title="Heterogenous join sets", path="concepts/workflows/join-sets.md#heterogenous-join-sets") }}

... allowing mixing different functions as well as delays into one join set. Up until now, it was
only possible to submit executions of the same function into one join set:

```rs
let join_set = new_join_set_generated(ClosingStrategy::Complete);
// use `-submit` extension
let execution_id_a = account_info_submit(&join_set_foo, a());
let execution_id_b = account_info_submit(&join_set_foo, b());
// use `-await-next` extension
let (_execution_id, first_response) = account_info_await_next(&join_set).unwrap();
```

It was also not possible to mix child executions and
{{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}.

With the new functionality it is possible to do both:

```rs
let execution_id_account = account_info_submit(&join_set, &login);
let execution_id_settings = get_settings_json_submit(&join_set);
let delay_id = submit_delay(&join_set, ScheduleAt::In(Duration::Seconds(10)));
// Use `join-next` to get the first response.
let first_response_id = join_next(&join_set)?;
```

## {{ doc_link(title="Stub Activities", path="concepts/activities/stub.md") }}

... that represent work outside of the WASM sandbox. A stub activity may appear as a regular
{{ doc_link(title="WASM activity", path="concepts/activities/_index.md") }} to workflows - its
exported functions can be executed directly, or submitted and then awaited in a
{{ doc_link(title="Join Set", path="concepts/workflows/join-sets.md") }}. There is one big
distinction though: no code is executed on behalf of stub activity. Instead, the response (be it
success or an execution failure) must be supplied externally, either by an
{{ doc_link(title="workflow", path="concepts/workflows/_index.md") }},
{{ doc_link(title="CLI", path="cli.md") }}, or a gRPC client.

Stub activities are useful when a workflow needs to evaluate an external execution, either a process
or a human intervention. Since workflows can send and receive values using this mechanism, it can be
useful when the regular parent - child RPC mechanism is insufficiet. Another use case is testing:
workflow can be isolated and every activity response including errors can be simulated using stub
activities.

## Scoped {{ doc_link(title="Join Set Close", path="concepts/workflows/join-sets.md#join-set-close") }}

Closing of a Join Set referrs to the background processes needed to uphold the
{{ doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} paradigm.
Since cooperative cancellation is not implemented yet, this essentially means that the parent
execution will be blocked until all of its child executions are completed. Previously this process
happened only during the finalization of the parent execution: each join set that contained
unprocessed child requests was issued one or many "Join Next" requests until all responses arrived.

This behavior has been changed slightly: join sets are now closed when they are dropped or get out
of scope. This change follows the principle of least surprise, and also binds the structured
concurrency to the lifetime of a join set. The old behavior of closing join sets during finalization
can be enfoced by declaring join sets at the top level scope of the workflow function or by using
`std::mem::forget`.

The following trace shows how scoped Join Set Close can group child executions into a batch and add
backpressure. Check out the
{{ doc_link(title="full example", path="concepts/workflows/join-sets.md#join-set-close") }} in the
documentation.

<img src="{{ get_url(path="stargazers-backfill-parallel.png") }}" />

Once the cooperative cancellation is implemented, this mechanism will do the right thing as well:
cancel child executions that were not awaited as soon as the join set gets out of scope.

## Ability to generate extension WIT files

The {{ doc_link(title="Extension WIT interfaces", path="concepts/extensions.md") }} are
automatically implemented by the runtime for every WASM export.

Previously, the generated WIT interfaces were available via the Web UI, but not through the
{{ doc_link(title="CLI", path="cli.md#obelisk-generate") }}.

The new

```sh
obelisk generate extensions
```

fills this gap by (re-)generating the WIT files, making it easier to stay in sync with latest
Obelisk version.

## Experimental support for JavaScript and Go for activities, workflows and webhooks

Emphasis on **experimental**, elaborated in
[Comparing Rust, JavaScript and Go for authoring WASM Components](@/blog/2025-05-25-comparing-rs-js-go.md)
blog post.

## Bonus: fly.io WASM Components

New repository [components-flyio](https://github.com/obeli-sk/components-flyio) provides functions
for creating Fly.io apps and managing VMs. It can become a building block for larger workflows, such
as building a SaaS :) .
