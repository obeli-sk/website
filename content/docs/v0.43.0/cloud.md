+++
title = "Obelisk Cloud"
template = "docs.html"
weight = 2
+++

Obelisk Cloud hosts each app on its own VM. You manage apps at
[cloud.obeli.sk](https://cloud.obeli.sk) or with `obelisk cloud`, and a deployed app is served at
`myapp.obelisk.works`.

## Deploying an app

Sign in at [cloud.obeli.sk](https://cloud.obeli.sk), create an API token, and export it as
`OBELISK_CLOUD_API_TOKEN`. Then deploy from the project directory:

```sh
obelisk generate new myapp
cd myapp
obelisk cloud app deploy -a app.toml -d deployment.toml --fill
obelisk cloud app endpoint
```

`--fill` prompts for required env vars and secrets. Use `--fill-non-interactive` in scripts to read
same-named environment variables instead.

An idle app may be suspended. It resumes on the next request.

## Endpoints

<div class="table">

| URL                                     | Serves              | Authentication               |
| --------------------------------------- | ------------------- | ---------------------------- |
| `https://myapp.obelisk.works`           | `external` webhooks | None; the webhook decides    |
| `https://internal--myapp.obelisk.works` | `internal` webhooks | Browser sign-in or API token |
| `https://webui--myapp.obelisk.works`    | Web UI              | Browser sign-in              |
| `https://api--myapp.obelisk.works`      | API                 | API token                    |

</div>

Opening the Web UI or internal host in a browser signs in through
[cloud.obeli.sk](https://cloud.obeli.sk). Other clients send an API token to the API host or the
internal host; the Web UI host accepts only the browser session.

The CLI uses `--api-url` (`OBELISK_CLOUD_API_URL`, default `https://cloud.obeli.sk/api`) and
`--api-token` (`OBELISK_CLOUD_API_TOKEN`). It derives app endpoints from `--apps-domain`
(`OBELISK_CLOUD_APPS_DOMAIN`, default `obelisk.works`).

## Public and private webhooks

Each {{ doc_link(title="webhook", path="js/js-webhooks.md") }} names its server with `http_server`.

- **`internal`** is for anything only you should reach, such as admin pages and tools. The platform
  handles sign-in, so the app needs no login of its own. Webhooks receive the caller's username in
  the `obelisknet-user-slug` header. Only trust it here: other servers are not behind the same
  check.
- **`external`** is for public sites and for callbacks from other services. Anyone can call it, so
  the webhook does its own authentication. It starts only when
  {{ doc_link(title="`app.toml`", path="configuration/app.md#public-http-servers") }} lists it:

  ```toml
  public_http_servers = ["external"]
  ```

## Cookies

All apps share one domain with other tenants, so a cookie without the `__Host-` prefix could have
been set by another app. Webhooks therefore receive only `__Host-` cookies, and the API and Web UI
receive none. Set cookies like this:

```
Set-Cookie: __Host-session=...; Secure; Path=/; HttpOnly; SameSite=Lax
```

The cookie must have `Secure`, `Path=/`, and no `Domain`. Any other cookie is dropped and named in
the `obelisknet-cookie-rejected` response header, which `curl -i` and browser developer tools show.

Other apps also count as the same site, so `SameSite` does not protect against forged requests from
them. A public webhook receives no cookies on a request from another app, except when following a
top-level link. Browsers that do not send `Sec-Fetch-Site` are not covered, so check `Origin` on
unsafe methods as well.

## Integrations

{{ doc_link(title="`[cloud.integrations]`", path="configuration/app.md#cloud-integrations") }} gives
an app access to LLM and GitHub services the cloud provides, without storing credentials in the app.

## Commands

`obelisk cloud` manages apps hosted by an Obelisk cloud control plane. `cloud token` creates, lists,
inspects, and revokes cloud bearer tokens; `cloud apps` lists the apps you own. Everything scoped to
one app lives under `cloud app`:

- `new`, `get`, `status`, `enable`, `disable`, `delete`: app lifecycle. `new` creates a stopped app
  named by `--app`. `status` shows the staged and applied configuration revisions and, when `-a` or
  `./app.toml` is readable, whether it matches the staged configuration. It also shows the health
  check of a started VM and a scheduled wake-up that keeps failing. Required env vars and secrets
  must be supplied at creation with `--fill` (prompts) or `--fill-non-interactive` (reads same-named
  environment variables).
- `events` lists the app's recent lifecycle and VM events, newest first: completed and failed
  commands, app failures and restores, critical and recovered health checks, restarts of an
  unhealthy VM, and failed wake-ups. `-n, --limit` sets how many to show (1-50, default 5). Routine
  idle suspends and wake-ups are not recorded.
- `stage` stages app policy and cloud settings as a new configuration revision without restarting
  the VM; `apply` applies a staged revision together with the enqueued (or active) deployment while
  respecting the app's intended running state.
- `deploy` publishes the local project: it creates or configures the app, submits the deployment,
  and activates it. It fails on missing required values unless `--fill` or `--fill-non-interactive`
  is passed. When the app name is taken, an interactive `deploy` offers an alternative and saves it
  to `app.toml` if the original name came from there; noninteractive and `--json` runs fail with a
  conflict error. `--description` describes the deployment, as in `deployment enqueue`.
- `fill` interactively stages declared env vars and secrets and requires a terminal;
  `fill --non-interactive` stages same-named environment variables instead, for scripts. `env` and
  `secrets` manage them individually; names starting with `OBELISK_` are accepted. Internal secrets
  and internal public environment entries are skipped.
- `fill` and `apply` compare `-a` or `./app.toml` with the staged configuration (the control plane
  performs the comparison) and never stage it silently: on a difference they ask whether to stage
  it, use the staged one, or cancel, and fail without a terminal unless `--staged` is passed.
  `apply` also accepts `--fill` and `--fill-non-interactive`.
- `endpoint` shows the API, webhook, Web UI, and internal webhook URLs; `endpoint api`, `webhook`,
  `webui`, or `internal` prints one of them.
- `deployment`, `execution`, `component`, and `admin` connect directly to the selected app's API.

Select an app with `cloud app --app`, `OBELISK_APP_NAME`, or `app_name` in `./app.toml`. Cloud app
names are 4-20 lowercase ASCII letters, digits, and single interior hyphens (no `--`), and are
unique within each cloud environment. Names starting with `system-` or `integrations-` are reserved.
Env vars bound by
{{ doc_link(title="`[cloud.integrations]`", path="configuration/app.md#cloud-integrations") }} are
supplied by the cloud, so `new`, `deploy`, `fill`, and `apply` never ask for them.

`new`, `status`, `stage`, `deploy`, `fill`, and `apply` read the app config from `-a, --app-config`
or discover `./app.toml`. They never use another app's config: a file whose `app_name` differs from
the app selected by `--app` or `OBELISK_APP_NAME` is an error when passed with `-a` or required (by
`stage` and `deploy`), and is ignored when discovered by the other commands.

`cloud token new --name <NAME> --token-file <FILE>` saves the server-issued token to a new private
file; it does not overwrite an existing file. `--scope <APP>` restricts the token to apps and
`--expires-at` sets an RFC 3339 expiry. Token names are unique per account until revoked. If the
creation response is lost, revoke the inaccessible token before creating a replacement with the same
name.

Cloud commands print concise human-readable results to stderr; `--json` prints machine-readable
output and `--verbose` adds metadata, diagnostics, and each HTTP request with its response status,
prefixed with the time since the previous step (deploy steps included). Run `obelisk cloud --help`
and `obelisk cloud app --help` for all options.
