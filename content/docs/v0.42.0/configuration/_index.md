+++
title = "Configuration"
template = "docs.html"
weight = 20
sort_by = "weight"
+++

Obelisk reads three configuration files. Each one has a different owner and changes at a different
pace:

<div class="table">

| File              | Owner                         | Contains                                                                | Changes                                 |
| ----------------- | ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| `server.toml`     | Platform admin                | Listeners, database, limits, runtimes, logging, HTTP servers, exec gate | Rarely; optional on a developer machine |
| `app.toml`        | App admin                     | App name, secrets, public environment, outbound HTTP, exec approvals    | When the app needs a new capability     |
| `deployment.toml` | App developer or coding agent | Activities, workflows, webhook endpoints, and cron tasks                | With every code change                  |

</div>

Each file has its own reference page:
{{ doc_link(title="Server Configuration", path="configuration/server.md") }},
{{ doc_link(title="App Configuration", path="configuration/app.md") }}, and
{{ doc_link(title="Deployment Configuration", path="configuration/deployment.md") }}.

## Why Three Files

**`server.toml` is the platform boundary.** The platform admin sets ports, the database, resource
limits, the named HTTP servers, and whether exec activities are available at all. These settings
belong to the host and normally stay the same for the lifetime of an app. On a developer machine the
developer is the platform, and the built-in defaults are usually enough.

**`app.toml` is the reviewed policy of the app.** It states the app's required inputs and the most
any deployment may do: which secrets exist and which components may read them in plaintext, which
environment variables deployments may read, which hosts and methods outbound HTTP may reach, and
which exec activities may run. It contains no component code, host paths, or ports, so it stays
short, and the same file and its digest apply locally and in the cloud. Reviewers get a high-level
picture of what the app can touch by auditing `app.toml` alone, without reading the code.

**`deployment.toml` is one instance of the app.** It lists the components and requests the
capabilities each one needs. A deployment can only use what `app.toml` and `server.toml` allow:
verification, startup, and activation reject a deployment that requests a secret, environment
variable, outbound HTTP destination, or exec activity that is not granted. Exec activities need the
approval of both admins.

See {{ doc_link(title="Security model", path="security.md") }} before configuring secrets, native
execution, or outbound HTTP.

## Working with Coding Agents

The split is designed for coding agents. An agent may change component code and `deployment.toml`
and iterate on them without supervision, because nothing it writes there can exceed the reviewed
policy. Changes to `app.toml` and `server.toml` widen what the app can do, so a human should review
them.

A typical loop:

1. The agent edits the components and `deployment.toml`.
2. `obelisk deployment verify --app-config app.toml --deployment deployment.toml` reports every
   requirement the app policy does not cover. With `--fix`, it writes the missing entries into
   `app.toml`.
3. A reviewer audits the `app.toml` diff: a new secret, a new outbound host, or a new exec digest.

Protecting `app.toml` and `server.toml` with a code-owners rule keeps an agent's pull request from
widening the policy without review.

## Version Compatibility

The `obelisk-version` field can be set in `server.toml` or `deployment.toml` to ensure compatibility
with the running Obelisk version:

```toml
obelisk-version = "0.42"
```

## Built-in Defaults

All three listeners start automatically with built-in defaults. **No `server.toml` is required**
unless you need to change addresses, database settings, limits, or other platform options:

- **API server** at `127.0.0.1:5005`
- **Web UI** at `127.0.0.1:8080`
- **External webhook server** at `127.0.0.1:9090`

The server does require an app name, set as `app_name` in `app.toml` or through the
`OBELISK_APP_NAME` environment variable. Without an `app.toml`, the default app policy grants no
secrets, public environment variables, outbound HTTP, or exec activities.

## Generating Configuration Files

`obelisk generate new NAME` creates a directory named `NAME` with `app.toml`, `deployment.toml`, and
a JavaScript webhook, workflow, and HTTP activity. Without `NAME`, it writes into the current
directory and converts that directory's name to an app slug.

Generate the commented configuration references by passing an output filename:

```sh
obelisk generate server-config server.toml
obelisk generate app-config app.toml
obelisk generate deployment deployment.toml
```

Without an output filename, these commands print the configuration to stdout. Every setting in the
references is commented out; set at least `app_name` in `app.toml` before starting the server. For a
single-party installation where the admins and every deployment author share the same trust level,
the `--trusted` option generates permissive policies:

```sh
obelisk generate app-config --trusted app.toml       # outbound HTTP to any deployment-requested host
obelisk generate server-config --trusted server.toml # platform exec gate set to "*"
```

Do not use the trusted configurations for multi-tenant or agent-driven deployments. The trusted app
policy removes the destination boundary for outbound HTTP. Neither registers secrets or approves
individual exec activities; verification with `--fix` can add reviewed exec configuration digests
and scaffold referenced secrets in `app.toml`.

To split a 0.41 `server.toml` that still contains app policy, run
`obelisk generate split-config --server-config server.toml`. See
{{ doc_link(title="Migrating from 0.41 to 0.42", path="migrating-to-0.42.md", version="v0.42.0") }}.

## Running the Server

```sh
obelisk server run --app-config app.toml --deployment deployment.toml
obelisk server verify --app-config app.toml --deployment deployment.toml

# With explicit server config:
obelisk server run --server-config server.toml --app-config app.toml --deployment deployment.toml
```

If `--server-config` is omitted, built-in platform defaults are used. If `--app-config` is omitted,
the default app policy is used and `OBELISK_APP_NAME` must be set. If `--deployment` is omitted, the
database's active/enqueued deployment is used.

To verify a local deployment without opening the database, use:

```sh
obelisk deployment verify --server-config server.toml --app-config app.toml --deployment deployment.toml
```

Missing public environment variables and secrets are reported together with a sorted, pasteable
`app.toml` snippet. Add `--fix` to add missing `[public_env]` entries, scaffold missing `[secrets]`
entries, and write the reviewed exec allowlist and secret-exposure grants into `app.toml`. Review
the generated policy and set each secret's environment variable before starting the server.
`obelisk server verify --fix` provides the same repair behavior. Missing outbound HTTP destinations
are scaffolded in `app.toml` for review. A stale exec digest is kept and the current one appended as
an array; remove the old digest when no running revision needs it, and update the platform exec gate
in `server.toml`, which `--fix` does not change.
