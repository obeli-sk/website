+++
title = "Authentication"
template = "docs.html"
weight = 3
+++

Starting with 0.40.0, the Obelisk **API port denies any request that does not present a valid
token**. This page explains what is protected, how tokens are issued and configured, and how each
client (CLI, REST, Web UI) authenticates.

Authentication is one part of the broader operator/deployment boundary. See
{{ doc_link(title="Security model", path="security.md") }} for public environment variables,
registered secrets, native execution approval, and outbound HTTP policy.

## What is protected

Authentication guards the **API port** only (`127.0.0.1:5005` by default). A single host-level check
runs before any routing, so all three surfaces on that port are covered uniformly:

- the REST web API (used by the CLI and the Web UI),
- gRPC and gRPC-web (deprecated).

A request without an accepted token is rejected with HTTP `401 Unauthorized` (gRPC
`UNAUTHENTICATED`, numeric status `16`).

The **external webhook HTTP server** (`127.0.0.1:9090` by default) is **not** authenticated: webhook
endpoints stay open so they can serve public HTTP traffic. Do not expose it on a public interface
without your own protection in front of it.

> **Recovery / development:** start the server with `--no-auth` to accept unauthenticated requests
> on the API port. Use it only for local development or to recover access.
> (`--allow-unauthenticated-api` is a deprecated alias.)

## Tokens

### Ephemeral startup token

Every time the server starts it generates a fresh random token and prints it to standard error. This
token is valid until the server shuts down and needs no configuration, so it is the quickest way to
get going:

```
API startup token: 6f1c...<token>
```

### Persistent tokens

Persistent tokens are configured as SHA-256 hashes of the token text in `server.toml`. The hashes
are **not** secrets, so the file stays safe to commit to version control. Generate a token and
append its hash directly to the server configuration:

```sh
export OBELISK_API_TOKEN=$(obelisk generate token --server-config server.toml)
```

Stdout contains only the token. Without `--server-config`, an interactive terminal also prints the
ready-to-paste hash entry to stderr. Use `--json` when a program needs both values.

Collect one hash per client and list them, with a comment identifying each:

```toml
api.token_hashes = [
  "sha256:...",   # agent
  "sha256:...",   # laptop
]
```

The plaintext token is printed once and never stored. **Revoke** a token by deleting its hash line
and restarting the server.

### Token hash reload (upcoming release)

In the upcoming release after 0.43.0-rc.2, the server reads the configured `server.toml` about once
per second and atomically replaces only `api.token_hashes`. Add or revoke tokens by updating that
list; atomic file replacement is supported. Set `api.token_hashes = []` to revoke all configured
static tokens. The startup token, explicit `--api-token` / `OBELISK_API_TOKEN`, and OIDC verifier
and cached signing keys remain valid. Missing, unreadable, or invalid files retain the last valid
set and produce a diagnostic.

Revocation affects requests authenticated after reload. Existing streams remain open because they
were authenticated when opened. Writing the file alone does not acknowledge a reload.

The authenticated system-events API exposes an initial `api.token_hashes_loaded` event, including
for an empty set, and `api.token_hashes_changed` after a changed set is applied. Their details
contain `fingerprint` and `count`. The fingerprint is `sha256:<hex>` of the sorted, deduplicated raw
32-byte digests concatenated together, including the empty concatenation. Process-lifetime
credentials are excluded. Reordering or duplicating entries produces no change event. Failed event
writes are retried without undoing revocations; a newer set supersedes a pending acknowledgment.

Automation should obtain the current node-run identity from `GET /v1/admin/node-run-id` and poll
`GET /v1/admin/system-events` using an accepted bearer token, such as an OIDC ID token. Only the
latest loaded/changed event for that node run can acknowledge the desired fingerprint. A historical
match is insufficient; missing acknowledgment keeps synchronization pending. Initial events also
cover restarts and retries that leave the set unchanged.

Other server settings, including listeners and OIDC trust, require restart. This feature does not
reload `app.toml` policy. Authentication disabled with `--no-auth` needs no watcher.

### Plaintext token from the environment

A single plaintext token can be injected into the **server** through `--api-token` or the
environment variable `OBELISK_API_TOKEN` — the same variable the CLI client uses (see below). This
is intended for secret-manager injection at deploy time; do not write the plaintext into a committed
`server.toml`.

```sh
export OBELISK_API_TOKEN=<token>
obelisk server run --app-config app.toml --deployment deployment.toml
```

Use a token generated by `obelisk generate token`. A plaintext token shorter than 32 characters is
still accepted for compatibility, but the server logs a warning when a request first presents it.

> **Deprecated:** the legacy double-underscore config-env form `OBELISK__API__TOKEN` is still
> accepted by the server but prints a deprecation warning; switch to `OBELISK_API_TOKEN`. There is
> no plaintext `api.token` key in `server.toml` — persistent tokens are configured as hashes via
> `api.token_hashes` (above).

## Authenticating each client

### CLI

Subcommands that talk to the API present the token via their `--api-token` flag, which falls back to
`$OBELISK_API_TOKEN`, then the deprecated `$OBELISK__API__TOKEN`. The server accepts the same
`$OBELISK_API_TOKEN` variable, so client and server now share one canonical variable.

```sh
export OBELISK_API_TOKEN=<token>
obelisk deployment submit deployment.toml     # picks up $OBELISK_API_TOKEN
obelisk execution list --api-token <token>    # or pass it explicitly, after the subcommand
```

> **Tip (local development):** because the server and the CLI both accept `OBELISK_API_TOKEN`, a
> single generated token can authenticate both sides. With [direnv](https://direnv.net/), mint a
> fresh token per shell in `.envrc` so the server you start and the CLI you run share it
> automatically, with no copy-paste of the startup token:
>
> ```sh
> # .envrc
> export OBELISK_API_TOKEN=$(obelisk generate token)
> ```

### REST / curl

Send the token in the `Authorization` header on every request:

```sh
curl -s "http://127.0.0.1:5005/v1/executions" \
  -H 'Accept: text/plain' \
  -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

See {{ doc_link(title="API access", path="access/api.md") }} for the full REST reference.

### Web UI

The Web UI (`127.0.0.1:8080` by default) calls the REST web API on the API port, so it needs a token
too. On the first call that requires authentication it shows an **"Authentication required"**
dialog. Paste any accepted token (the ephemeral startup token, or a persistent one) and continue.
The token is kept in the browser tab's session storage, so it persists across reloads but is cleared
when the tab closes; if the token stops being accepted you are prompted again.

## Summary

| Surface                      | Port (default)   | Authenticated             |
| ---------------------------- | ---------------- | ------------------------- |
| REST web API                 | `127.0.0.1:5005` | Yes                       |
| gRPC / gRPC-web (deprecated) | `127.0.0.1:5005` | Yes                       |
| Web UI                       | `127.0.0.1:8080` | Yes (prompts for a token) |
| External webhook HTTP server | `127.0.0.1:9090` | No                        |
