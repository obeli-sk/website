+++
title = "Authentication"
template = "docs.html"
weight = 25
+++

Starting with 0.40.0, the Obelisk **API port denies any request that does not present a valid
token**. This page explains what is protected, how tokens are issued and configured, and how each
client (CLI, REST, Web UI) authenticates.

## What is protected

Authentication guards the **API port** only (`127.0.0.1:5005` by default). A single host-level check
runs before any routing, so all three surfaces on that port are covered uniformly:

- the REST web API,
- gRPC,
- gRPC-web (used by the Web UI).

A request without an accepted token is rejected with HTTP `401 Unauthorized` (gRPC
`UNAUTHENTICATED`, numeric status `16`).

The **external webhook HTTP server** (`127.0.0.1:9090` by default) is **not** authenticated: webhook
endpoints stay open so they can serve public HTTP traffic. Do not expose it on a public interface
without your own protection in front of it.

> **Recovery / development:** start the server with `--allow-unauthenticated-api` to accept
> unauthenticated requests on the API port, restoring the pre-0.40 behavior. Use it only for local
> development or to recover access.

## Tokens

### Ephemeral startup token

Every time the server starts it generates a fresh random token and prints it to the console. This
token is valid until the server shuts down and needs no configuration, so it is the quickest way to
get going:

```
API token (valid until shutdown): 6f1c...<token>
```

### Persistent tokens

Persistent tokens are configured as SHA-256 hashes of the token text in `server.toml`. The hashes
are **not** secrets, so the file stays safe to commit to version control. Generate a token together
with its ready-to-paste hash entry:

```sh
obelisk generate token
```

```
API token (shown only once, store it securely):
<token>

Add its hash to `api.token_hashes` in server.toml:
api.token_hashes = ["sha256:..."]
```

Collect one hash per client and list them, with a comment identifying each:

```toml
api.token_hashes = [
  "sha256:...",   # agent
  "sha256:...",   # laptop
]
```

The plaintext token is printed once and never stored. **Revoke** a token by deleting its hash line
and restarting the server.

### Plaintext token from the environment

A single plaintext token can be injected into the **server** through the environment as
`OBELISK__API__TOKEN` (the double-underscore config-env form, equivalent to the `api.token` key).
This is intended for secret-manager injection at deploy time; do not write the plaintext into a
committed `server.toml`.

```sh
export OBELISK__API__TOKEN=<token>
obelisk server run --deployment deployment.toml
```

> **Note:** the server only reads `OBELISK__API__TOKEN` (double underscore). It does **not** accept
> `OBELISK_API_TOKEN` (single underscore), which is a client-side variable (see below).

## Authenticating each client

### CLI

Subcommands that talk to the API present the token via the global `--api-token` flag, which falls
back to `$OBELISK_API_TOKEN` and then `$OBELISK__API__TOKEN`. Note the asymmetry: the client accepts
either `OBELISK_API_TOKEN` or `OBELISK__API__TOKEN`, but the server reads only `OBELISK__API__TOKEN`
for its accepted plaintext token.

```sh
export OBELISK_API_TOKEN=<token>
obelisk deployment submit deployment.toml     # picks up $OBELISK_API_TOKEN
obelisk --api-token <token> execution list    # or pass it explicitly
```

> **Tip (local development):** because the server accepts `OBELISK__API__TOKEN` and the CLI falls
> back to it, a single generated token can authenticate both sides. With
> [direnv](https://direnv.net/), mint a fresh token per shell in `.envrc` so the server you start
> and the CLI you run share it automatically, with no copy-paste of the startup token:
>
> ```sh
> # .envrc
> export OBELISK__API__TOKEN=$(obelisk generate token --json | jq -r .token)
> ```

### REST / curl

Send the token in the `Authorization` header on every request:

```sh
curl -s "http://127.0.0.1:5005/v1/executions" \
  -H 'Accept: text/plain' \
  -H "Authorization: Bearer $OBELISK_API_TOKEN"
```

See {{ doc_link(title="Programmatic access", path="programmatic-access.md") }} for the full REST
reference.

### Web UI

The Web UI (`127.0.0.1:8080` by default) makes gRPC-web calls to the API port, so it needs a token
too. On the first call that requires authentication it shows an **"Authentication required"**
dialog. Paste any accepted token (the ephemeral startup token, or a persistent one) and continue.
The token is kept in the browser tab's session storage, so it persists across reloads but is cleared
when the tab closes; if the token stops being accepted you are prompted again.

## Summary

| Surface                      | Port (default)   | Authenticated             |
| ---------------------------- | ---------------- | ------------------------- |
| REST web API                 | `127.0.0.1:5005` | Yes                       |
| gRPC / gRPC-web              | `127.0.0.1:5005` | Yes                       |
| Web UI                       | `127.0.0.1:8080` | Yes (prompts for a token) |
| External webhook HTTP server | `127.0.0.1:9090` | No                        |
