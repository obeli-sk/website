+++
title = "Join Sets"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Join sets are a core mechanism for handling
{{doc_link(title="structured concurrency", path="concepts/structured-concurrency.md") }} and
asynchronous operations in Obelisk workflows. A join set represents a collection of pending
operations (like activity calls or spawned child workflows). A workflow can interact with a join set
in the following ways:

- Create a join set: a workflow can create zero to many join sets, each is initially empty.

- Add operations to a join set: a workflow can submit child executions (workflows, activities) and
  {{ doc_link(title="persistent sleeps", path="concepts/workflows/persistent-sleep.md") }}.

- Await results: the workflow waits for the next operation in that set to complete.

- Close the join set: all unawaited activities, delays, and cancellable child workflows are
  cancelled; non-cancellable child workflows are awaited.

The examples below use JavaScript. The same operations in Rust are shown in
{{ doc_link(title="Rust Workflows", path="wasm/workflows.md#join-sets-in-rust") }}.

## Defining Features

- **Completion Order**: Operations in a join set complete in an arbitrary order, determined by when
  the underlying activities or workflows finish. Awaiting returns results in the order they become
  available. This does not break determinism, as the order of responses is recorded in the execution
  log.

- **Persistence**: The state of join sets is persisted in the execution log, ensuring that workflows
  can resume correctly after failures.

## Join Set Kinds

There are three kinds of join sets:

- One-off - created by the Obelisk runtime when the workflow calls an activity or a child workflow
  directly.
- Generated - created by the workflow using `obelisk.createJoinSet()`.
- Named - created by the workflow using `obelisk.createJoinSet({ name: "..." })`.

The only difference between a named and generated join set is the name. Naming join sets groups
logically related child executions, which helps with debugging and monitoring.

### Allowed Named Join Set Charset

The name of a join set is limited to the following charset: Alphanumeric characters (both upper and
lower case), and these special characters: `-/`

See {{ doc_link(title="Join Set ID", path="concepts/identifiers.md#join-set-id") }} for details.

### One-off (implicit) Join Set

Calling a child execution directly creates a one-off join set and awaits it. Each call marked 1-5
below does that:

```javascript
import * as dbUser from "stargazers:db/user";
import * as dbLlm from "stargazers:db/llm";
import { accountInfo } from "stargazers:github/account";
import { respond } from "stargazers:llm/llm";

export default function starAdded(login, repo) {
  // 1. Persist the user giving a star to the project.
  const description = dbUser.addStarGetDescription(login, repo);
  if (description == null) {
    const info = accountInfo(login); // 2. Fetch the account info from GitHub.
    const settings = dbLlm.getSettingsJson(); // 3. Fetch the prompt from the database.
    const generated = respond(info, settings); // 4. Generate the user's description.
    dbUser.updateUserDescription(login, generated); // 5. Persist the description.
  }
}
```

## Homogenous Join Sets

When a join set contains only child executions of the same function, it is called homogenous. Use
the typed `AwaitNext` import from the `-obelisk-ext` interface until all submitted executions are
awaited:

```javascript
import { accountInfoSubmit, accountInfoAwaitNext } from "stargazers:github-obelisk-ext/account";
import * as obelisk from "obelisk:workflow@1.0.0";

const js = obelisk.createJoinSet({ name: "accounts" });
for (const login of logins) {
  accountInfoSubmit(js, login);
}
for (const _ of logins) {
  const info = accountInfoAwaitNext(js); // in completion order
  const childId = js.lastId; // execution ID of the child that finished
}
```

Awaiting more times than there are submissions throws `obelisk.JoinSetExhaustedError`.

The following example runs two activities in parallel, each in its own named join set:

```javascript
export default function starAddedParallel(login, repo) {
  const description = dbUser.addStarGetDescription(login, repo); // one-off join set
  if (description == null) {
    const jsInfo = obelisk.createJoinSet({ name: `${login}-info` });
    const jsSettings = obelisk.createJoinSet({ name: "settings" });
    accountInfoSubmit(jsInfo, login);
    getSettingsJsonSubmit(jsSettings);
    const info = accountInfoAwaitNext(jsInfo);
    const settings = getSettingsJsonAwaitNext(jsSettings);
    dbUser.updateUserDescription(login, respond(info, settings));
  }
}
```

## Heterogenous Join Sets

When a join set contains child executions of multiple functions, or delays, it is called
heterogenous. Use `js.joinNext()`, which returns the next completed value, and compare `js.lastId`
with the IDs you submitted to find out which response it was. A completed delay returns `null`:

```javascript
const js = obelisk.createJoinSet();
const execId = accountInfoSubmit(js, login);
const delayId = js.submitDelay({ seconds: 10 });

const result = js.joinNext();
if (js.lastId === delayId) {
  return "timed out"; // the activity is cancelled when the join set closes
}
return result; // js.lastId === execId
```

`js.joinNextTry()` is the non-blocking variant: it returns `undefined` while requests are still
pending.

## Handling child failures

A direct call or `AwaitNext` of a child that failed throws `obelisk.ChildError`. Catching it lets
the workflow handle a failure (a business `err`, a timeout, or a cancellation) instead of failing
itself:

```javascript
try {
  const info = accountInfoAwaitNext(js);
} catch (e) {
  if (!(e instanceof obelisk.ChildError)) throw e;
  // e.value is the err payload, e.failureKind is set for platform failures such as "timed-out"
}
```

See
{{ doc_link(title="JS Workflows", path="js/js-workflows.md#handling-child-failures-with-obelisk-childerror") }}
for all fields.

## Join Set Close

Join sets are closed either explicitly using `js.close()`, or automatically when the workflow
execution finishes. During this process, all child executions that the parent execution submitted
but did not await are processed as follows:

- Child activities and delay requests are cancelled
- Child workflows whose exported function name ends in `-cancellable` are cancelled
- Other child workflows are awaited

The parent workflow is marked as finished only when all unattended child executions are finished.

Cancellable child workflows are the opt-in form of workflow cancellation used by structured
concurrency. They let join-set close release a stuck or blocked child without running that child's
code again. Use them only when cleanup is owned by an ancestor, not by the cancelled child itself.
See
{{ doc_link(title="Cancellable child workflows", path="patterns/cleanup-supervisor.md#cancellable-child-workflows") }}.

### Example - Back-pressure with join set close

The following example submits a child workflow for each stargazer in a batch, then closes the
batch's join sets before fetching the next page. Closing waits for the child workflows, so at most
one page runs at a time:

```javascript
import { listStargazers } from "stargazers:github/account";
import { starAddedParallelSubmit } from "stargazers:workflow-obelisk-ext/workflow";

export default function backfillParallel(repo) {
  const pageSize = 5;
  let cursor = null;
  while (true) {
    const resp = listStargazers(repo, pageSize, cursor);
    if (resp == null) break;
    const batch = resp.logins.map((login) => {
      const js = obelisk.createJoinSet({ name: login });
      starAddedParallelSubmit(js, login, repo);
      return js;
    });
    batch.forEach((js) => js.close()); // waits for the child workflows
    if (resp.logins.length < pageSize) break;
    cursor = resp.cursor;
  }
}
```

It is advised to await the result of submitted child workflows explicitly; closing is the fallback.

<img src="{{ get_url(path="stargazers-backfill-parallel.png") }}" alt="Backfill trace" /> Lines
`o1_1` and `o2_1` are one-off join sets containing the `list-stargazers` activity.
