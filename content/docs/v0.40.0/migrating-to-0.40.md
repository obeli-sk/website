+++
title = "Migrating to 0.40"
template = "docs.html"
weight = 60
+++

Obelisk 0.40 secures the API port, gates host exec activities, and bumps the WIT packages to new
major versions. This guide covers the changes an operator and an application developer need to make
when upgrading from 0.39.

At a glance:

- **Operators** must supply an API token (or opt out) and enable exec activities if they use them,
  and rename one CLI flag.
- **Component authors** must rebuild against `obelisk:types@5.0.0`, `obelisk:workflow@6.0.0`, and
  `obelisk:webhook@6.0.0`, and update code that awaited child results.

## Operator changes

### The API port now requires a token

The API port (`5005`) denies unauthenticated requests by default, returning HTTP `401` (gRPC
`UNAUTHENTICATED`). This affects every client that talks to the API: the CLI, REST callers, and the
Web UI.

- The server prints an **ephemeral startup token** to the console on every start.
- Configure **persistent tokens** as SHA-256 hashes in `api.token_hashes` (generate them with
  `obelisk generate token`), or inject a plaintext token via `OBELISK__API__TOKEN`.
- CLI subcommands read the token from `--api-token`, `$OBELISK_API_TOKEN`, or
  `$OBELISK__API__TOKEN`.
- To keep the old open behavior for local development or recovery, start the server with
  `--allow-unauthenticated-api`.

See {{ doc_link(title="Authentication", path="authentication.md") }} for the full model.

### Exec activities are disabled by default

{{ doc_link(title="Exec activities", path="configuration.md#exec-activities") }} run host processes
outside the WASM sandbox and are now off by default. A deployment that declares an `activity_exec`
fails verification until the operator opts in on the server:

```toml
# server.toml — allow any exec activity (logs a warning)
allow_exec_activities = true

# or allowlist only reviewed scripts by content digest
allow_exec_activities = ["sha256:..."]
```

A rejected deployment logs the digest line to copy into `server.toml` after review. See
{{ doc_link(title="Exec Activity Gating", path="configuration.md#exec-activity-gating") }}.

### Renamed runtime-config flag

The availability policy was renamed from "missing" to "unavailable" because it now also covers
server capabilities such as exec activities, not just environment variables and secrets.

| Before                                                     | After                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `server verify --ignore-missing-env-vars`                  | `server verify --allow-unavailable-runtime-config`                       |
| `deployment submit/enqueue --allow-missing-runtime-config` | `... --allow-unavailable-runtime-config`                                 |
| REST field `allow_missing_runtime_config`                  | `allow_unavailable_runtime_config` (old name still accepted as an alias) |
| gRPC `RUNTIME_CONFIG_CHECK_ALLOW_MISSING`                  | `RUNTIME_CONFIG_CHECK_ALLOW_UNAVAILABLE` (numeric tag remains `2`)       |

The `-s` shorthand for `--suppress-type-checking-errors` was removed; use the long flag.

## Component changes

All components must be rebuilt against the new WIT packages:

- `obelisk:types@5.0.0`
- `obelisk:workflow@6.0.0`
- `obelisk:webhook@6.0.0`

Update the version in your WIT imports, regenerate WIT dependencies and extension packages
(`obelisk generate wit-deps` / `wit-extensions`), and do not hand-patch generated code. The sections
below cover the behavioral changes.

### `join-next` and `-await-next` return the value directly

Previously `join-next` returned a `(response-id, result)` tuple and a generated `-await-next`
returned `(execution-id, result<T, E>)`. Both now return the completed value directly. Read the
processed response id from `join-set.last-id()` immediately afterwards if you need it.

**Rust — generated `-await-next`:**

```rust
// before
let (execution_id, child_result) = foo_await_next(&join_set)?;
let value = child_result?;

// after
let value = foo_await_next(&join_set)??;
let execution_id = match join_set.last_id() {
    Some(ResponseId::ExecutionId(exe)) => exe,
    other => panic!("expected child execution id, got {other:?}"),
};
```

**Rust — `join-next`:**

```rust
// before
let (response_id, is_success) = join_next(&join_set)?;
// ... resolve the value with get-result-json / a typed -get

// after
let json_result = join_next(&join_set)?; // the value, directly
let response_id = join_set.last_id();     // an ExecutionId or a DelayId
```

### `sleep` takes a name, native calls drop the backtrace parameter

On the native `workflow-support` / `webhook-support` interfaces, no function takes a `backtrace`
parameter anymore (the backtrace-carrying variants moved to a separate `*-support-backtrace`
interface imported only by the JS runtime). `sleep` keeps an optional one-off join-set `name`:

```rust
// before
workflow_support::sleep(ScheduleAt::In(duration))?;
let join_set = join_set_create(None);

// after
workflow_support::sleep(ScheduleAt::In(duration), None)?; // trailing None is the join-set name
let join_set = join_set_create();
```

### `submit-config` was removed

The never-implemented `submit-config` type and its parameters are gone. Drop the trailing config
argument from `submit-json`, `schedule-json`, and `call-json` call sites.

### Distinguishing platform failures

The error payload representation is unchanged: a platform failure still appears in the `err` arm as
the existing sentinel. When code must tell a platform failure (timeout, cancellation,
nondeterminism, out-of-fuel) apart from a business `err`, query
`get-execution-failure-kind(execution-id)` for the already-processed child.

### Webhook interface renames

If you build native webhook components, note these `webhook-support@6.0.0` renames:

- `current-execution-id` is now `execution-id-current`;
- `get-status-v2` is now `get-status`, and `execution-status-v2` is now `execution-status`;
- `get-status`, `get`, and `try-get` no longer take a backtrace parameter;
- `execution-status-finished::execution-failure` now carries `execution-failure-kind`.

## JavaScript components

### Awaited child failures throw `obelisk.ChildExecutionError`

Any awaited child failure from `joinNext`, `joinNextTry`, a generated `awaitNext` proxy, an imported
direct call, `obelisk.call`, `obelisk.getResult`, or the webhook `obelisk.get` / `obelisk.tryGet`
now throws `obelisk.ChildExecutionError`, instead of the raw err value:

```javascript
// before
try {
  const value = stepAwaitNext(js);
} catch (e) {
  if (e !== "stub-err") throw e;
}

// after
try {
  const value = stepAwaitNext(js);
} catch (e) {
  if (!(e instanceof obelisk.ChildExecutionError)) throw e;
  if (e.value !== "stub-err") throw e.value;
}
```

The error carries `value` (decoded business err payload, `undefined` for a unit err or platform
failure), `childId`, `cancelled`, `failureKind`, and a human-readable `message`. See
{{ doc_link(title="Handling child failures", path="js/js-workflows.md#handling-child-failures-with-obelisk-childexecutionerror") }}.

### `joinNext` returns the value directly

`js.joinNext()` no longer returns a winner object. It returns the ok value directly (`null` for a
completed delay) and throws on failure. Read `js.lastId` for the id of the processed response:

```javascript
// before
const response = js.joinNext();
const value = obelisk.getResult(response.id);

// after
const value = js.joinNext();
const completedId = js.lastId;
```

## Migration checklist

1. Give the server a token (`api.token_hashes` / `OBELISK__API__TOKEN`) or start it with
   `--allow-unauthenticated-api`; update CLI callers to pass `--api-token`.
2. If you use exec activities, set `allow_exec_activities` in `server.toml`.
3. Rename `--ignore-missing-env-vars` / `--allow-missing-runtime-config` to
   `--allow-unavailable-runtime-config` in scripts.
4. Bump WIT imports to `types@5.0.0`, `workflow@6.0.0`, `webhook@6.0.0` and regenerate bindings.
5. Fix every consumer of `join-next`, `join-next-try`, and `-await-next` return values; add the
   trailing `None` to native `sleep`; drop `submit-config` arguments.
6. Update JS `catch` blocks to handle `obelisk.ChildExecutionError`, and replace the `joinNext()`
   winner-object plus `getResult(id)` pattern with the direct return plus `js.lastId`.
7. Rebuild all components, then verify each deployment
   (`obelisk server verify --allow-unavailable-runtime-config`) before rolling out.
