+++
title = "Obelisk 0.40: Secured API Access and Structured Child Failures"
date = 2026-07-13
+++

Obelisk 0.40 tightens two defaults that used to be wide open and improves how workflows see failed
children. The API port now rejects requests without a token, host exec activities have to be enabled
before they will run, and an awaited child failure now tells you whether it was a business error or
a platform failure such as a timeout or cancellation.

<!-- more -->

## Authenticated API Port

Until now, anything that could reach the API port could drive Obelisk. In 0.40 the API port denies
any request that does not present a valid `Authorization: Bearer <token>` header, returning HTTP
`401` (gRPC `UNAUTHENTICATED`). The check covers the REST web API, gRPC, and gRPC-web uniformly.

Getting a token is easy:

- The server generates an **ephemeral startup token** and prints it to the console on every start.
  It is valid until shutdown and needs no configuration.
- **Persistent tokens** are configured as SHA-256 hashes in `api.token_hashes`. Hashes are not
  secrets, so `server.toml` stays safe to commit. Generate a token and its hash with
  `obelisk generate token`.
- A plaintext token can be injected through the environment as `OBELISK__API__TOKEN` for
  secret-manager workflows.

The CLI reads the token from `--api-token`, `$OBELISK_API_TOKEN`, or `$OBELISK__API__TOKEN`. The Web
UI prompts for a token and keeps it for the browser tab. Webhook HTTP servers are unaffected and
stay open, so your public endpoints keep working.

If you need the previous open behavior for local development or recovery, start the server with
`--allow-unauthenticated-api`. See the
{{ doc_link(title="Authentication", path="authentication.md") }} guide for the full model.

## Exec Activity Gating

Exec activities run host processes outside the WASM sandbox, so 0.40 disables them by default. A
deployment that declares an `activity_exec` fails verification unless the operator opts in, either
globally or by allowlisting the exact reviewed script:

```toml
# server.toml
allow_exec_activities = true                 # allow any exec activity (logs a warning)
# or
allow_exec_activities = ["sha256:..."]       # only these reviewed scripts, pinned by content digest
```

A rejected deployment logs the digest line to copy into `server.toml` after review, so promoting a
vetted script is a one-line change.

## Structured Child Failures

The Obelisk WIT packages moved to new major versions (`obelisk:types@5.0.0`,
`obelisk:workflow@6.0.0`, `obelisk:webhook@6.0.0`). The headline change is how workflows observe a
child result.

`join-next` and the generated `-await-next` extension functions now return the completed value
**directly** instead of a `(response-id, result)` tuple. When you still need the id of the response
you just processed, read it from `join-set.last-id()`:

```rust
// before
let (execution_id, child_result) = foo_await_next(&join_set)?;
let value = child_result?;

// after
let value = foo_await_next(&join_set)??;
let execution_id = join_set.last_id();
```

Platform failures are now first-class. A new `get-execution-failure-kind(execution-id)` lets a
workflow tell a timeout, cancellation, nondeterminism, or out-of-fuel failure apart from a business
`err`, without changing the existing err payload.

In JavaScript, awaited child failures throw a single, catchable `obelisk.ChildExecutionError`. It
exposes the decoded `value`, the `childId`, the platform `failureKind`, and whether the child was
`cancelled`, so detecting a cancelled child is now straightforward:

```javascript
try {
  const value = stepAwaitNext(js);
} catch (e) {
  if (e instanceof obelisk.ChildExecutionError && e.cancelled) {
    return "child was cancelled";
  }
  throw e;
}
```

`joinNext()` follows the same rule: it returns the ok value directly (`null` for a completed delay)
and throws `obelisk.ChildExecutionError` on failure, replacing the old winner-object plus
`getResult(id)` dance.

## Clearer Availability Checks

The runtime-config availability policy was renamed from "missing" to "unavailable", because it now
also covers server capabilities such as exec activities, not just environment variables and secrets.
`obelisk server verify --ignore-missing-env-vars` and `--allow-missing-runtime-config` are now
`--allow-unavailable-runtime-config`. The REST field `allow_missing_runtime_config` was renamed to
`allow_unavailable_runtime_config` and keeps the old name as an alias for now.

## Upgrading

This is a breaking release for both operators and component authors: give the server a token (or opt
out), enable exec activities if you use them, and rebuild every component against the new WIT
packages. The {{ doc_link(title="Migrating to 0.40", path="migrating-to-0.40.md") }} guide walks
through each step with before/after snippets.

For complete reference material, see the updated
{{ doc_link(title="Authentication", path="authentication.md") }},
{{ doc_link(title="Configuration", path="configuration.md") }},
{{ doc_link(title="CLI", path="cli.md") }}, and
{{ doc_link(title="Programmatic access", path="programmatic-access.md") }} docs.
