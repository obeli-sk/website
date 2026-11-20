+++
title = "Obelisk Cloud"
template = "docs.html"
weight = 2
+++

Obelisk Cloud hosts each app on its own VM. You manage apps at
[cloud.obeli.sk](https://cloud.obeli.sk) or with `obelisk cloud`, and a deployed app is served at
`myapp.obelisk.works`.

## Deploying an app

Log in, then push the project from its directory:

```sh
obelisk cloud auth login
obelisk generate new myapp
cd myapp
obelisk cloud app push -a app.toml -d deployment.toml --fill
obelisk cloud app status
```

`--fill` prompts for required env vars and secrets. Use `--fill-non-interactive` in scripts to read
same-named environment variables instead, or pass values individually: `--env NAME=VALUE`,
`--env NAME` (reads the same-named environment variable), and `--secret NAME` (always reads the
same-named environment variable, so secrets never appear on the command line).

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

The bare hostname answers 404 unless the applied `app.toml` lists `external` in
`public_http_servers` (see [below](#public-and-private-webhooks)). `cloud app status` and `push`
print the endpoints the app serves.

Opening the Web UI or internal host in a browser signs in through
[cloud.obeli.sk](https://cloud.obeli.sk). Other clients send an API token to the API host or the
internal host; the Web UI host accepts only the browser session.

## Logging in

`obelisk cloud auth login` prints a link and opens it in a browser, unless it cannot, as over SSH,
or you pass `--no-browser`. After you approve the login, the page displays a code. Paste it into the
terminal to save an account-wide token valid for 90 days. Only paste such a code into a terminal you
started yourself, and approve a login only if you just ran the command.

CI and agents have no terminal to log in from. Create a token at
[cloud.obeli.sk](https://cloud.obeli.sk), restricted to the apps it needs, and set
`OBELISK_CLOUD_API_TOKEN`.

- `obelisk cloud auth status` shows the saved accounts and whether their tokens still work. An
  account defaults to your username at the API host, for example `alice@cloud.obeli.sk`.
  `auth login --account <ALIAS>` assigns a custom name; `--default` makes that login the default.
  Refreshing a login preserves its saved name. Account selection is case-sensitive, and backends are
  distinguished by the full API URL.
- `obelisk cloud auth switch <ACCOUNT>` changes the default account. The first login becomes the
  default.
- `obelisk cloud auth logout [ACCOUNT]` revokes the token and forgets the login.

To add another account, switch accounts on GitHub, sign out of
[cloud.obeli.sk](https://cloud.obeli.sk), then run `obelisk cloud auth login` again. Otherwise
GitHub signs you back in as the same user.

Logins are saved unencrypted in `cloud-credentials.toml` in the Obelisk configuration directory,
`~/.config/obelisk` on Linux. The file is created readable only by you, and the CLI refuses to use
it if others can read it.

RC17 stores logins in named `[account."name"]` tables. To upgrade a credentials file from earlier
release candidates, manually convert each `[[account]]` table using its saved account name, or
remove the file and log in again.

The CLI picks what it talks to from the first row that matches:

<div class="table">

| Set                                                                | Used                                |
| ------------------------------------------------------------------ | ----------------------------------- |
| `--api-token` or `OBELISK_CLOUD_API_TOKEN` alone                   | `https://cloud.obeli.sk/api`        |
| The token, `OBELISK_CLOUD_API_URL` and `OBELISK_CLOUD_APPS_DOMAIN` | A custom deployment                 |
| `--account` or `OBELISK_CLOUD_ACCOUNT`                             | That saved account, for one command |
| Nothing                                                            | The default account                 |

</div>

Setting only some of the token, URL and domain is an error, as is combining any of them with
`--account`. A custom deployment can also use saved logins: run
`obelisk cloud auth login https://cloud.example.com/api`, without those variables set. Login also
accepts `OBELISK_CLOUD_API_URL` as its default URL; an unset or empty value uses
`https://cloud.obeli.sk/api`, and an explicit URL takes precedence.

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
an app access to LLM, GitHub, and headless browser services the cloud provides, without storing
credentials in the app.

### Browser

The `browser` integration runs a headless browser on the app's VM, which activities and webhooks
drive with Playwright-style steps. See
{{ doc_link(title="Cloud Browser", path="cloud-browser.md") }} for setup, the session API,
credentials, and troubleshooting denied requests.

## Commands

`obelisk cloud` manages apps hosted by an Obelisk cloud control plane. `cloud auth` manages
[logins](#logging-in). `cloud token` creates, lists, inspects, and revokes cloud bearer tokens;
`cloud app list` lists the apps you own. The other `cloud app` subcommands are scoped to one app:

- `new`, `status`, `enable`, `disable`, `delete`: app lifecycle. `new` creates a stopped app named
  by `--app`. `status` shows the app's endpoints, the applied configuration revision, your
  [drafts](#drafts) with their changes and missing values and, when `-a` or `./app.toml` is
  readable, whether it matches the default draft. It also shows the health check of a started VM and
  a scheduled wake-up that keeps failing. An app suspended while idle shows as `running (suspended)`
  with `API: resumes on request`. Required env vars and secrets must be supplied at creation with
  `--env` and `--secret`, `--fill` (prompts), or `--fill-non-interactive` (reads same-named
  environment variables).
- `pull` writes the running `app.toml`, the active deployment, and its source files to disk.
- `events` lists the app's recent lifecycle and VM events, newest first: completed and failed
  commands, app failures and restores, critical and recovered health checks, restarts of an
  unhealthy VM, and failed wake-ups. `-n, --limit` sets how many to show (1-50, default 5). Routine
  idle suspends and wake-ups are not recorded.
- `stage` puts `app.toml` and any `--env`/`--secret` or filled values into a [draft](#drafts)
  without restarting the VM; it never applies. With `-d, --deployment <FILE>` it first submits the
  deployment, then stages its ID in the draft along with the configuration, so a failed submission
  stages nothing; `--empty-deployment` stages an empty deployment instead, and `--description`
  describes either. Without them the draft's deployment is left unchanged. Staging an app that does
  not exist creates it with only `app_name` and an empty deployment, then stages the real
  configuration, so required values can be filled in later, from the CLI or the dashboard, before
  applying. `unstage` discards the draft. `apply` prints what changes and applies the staged draft;
  the control plane activates the draft's staged deployment, or keeps the active one, while
  respecting the app's intended running state. It fails when nothing is staged. `apply --reapply`
  re-applies the applied revision instead, reconciling the VM with the app's intended state without
  restarting an unchanged VM.
- `push` publishes the local project: it creates a missing app with only `app_name` (and says so),
  stages `app.toml` and values into a new `push-<ID>` draft, submits the deployment (`-d`, default
  `deployment.toml`, or an empty one with `--empty-deployment`), stages it in the same draft, and
  applies the draft. It fails on missing required values unless they are passed with `--env` and
  `--secret`, `--fill`, or `--fill-non-interactive`. The draft never touches `default` and is
  discarded when `push` fails before applying it. When the app name is taken, an interactive `push`
  offers an alternative and saves it to `app.toml` if the original name came from there;
  noninteractive and `--json` runs fail with a conflict error. `--description` describes the
  deployment, as in `deployment submit`.
- `cloud app deployment` has no `enqueue` or `apply`. To activate an existing deployment, stage
  it with `cloud app stage --deployment <ID>` and run `cloud app apply`, or use the dashboard.
  The app's API rejects deployment switch requests, including the Web UI's, with the same
  guidance.
- `env set`, `env unset`, `secrets set`, and `secrets unset` stage env vars and secrets into a
  draft; names starting with `OBELISK_` are accepted. Internal secrets and internal public
  environment entries are skipped. `env list` and `secrets list` show the applied values.
- `deployment`, `execution`, `component`, and `admin` connect directly to the selected app's API.

Select an app with `--app` after the subcommand (`cloud app status --app NAME`), `OBELISK_APP_NAME`,
or `app_name` in `./app.toml`. Cloud app names are 4-20 lowercase ASCII letters, digits, and single
interior hyphens (no `--`), and are unique within each cloud environment. Names starting with
`system-` or `integrations-` are reserved. Env vars bound by
{{ doc_link(title="`[cloud.integrations]`", path="configuration/app.md#cloud-integrations") }} are
supplied by the cloud, so `new` and `push` never ask for them.

### Drafts

Changes to `app.toml`, env vars, and secrets are staged into a draft and take effect when the draft
is applied. `stage`, `unstage`, `apply`, `env set`/`unset`, and `secrets set`/`unset` take
`--draft <KEY>` (default `default`; the dashboard edits the same `default` draft). Each draft starts
from the applied revision and belongs to you. Applying a draft discards the app's other drafts,
including those of other users; `push` stages into its own temporary draft and warns about your
drafts it will discard. Apply fails while declared required values are missing; values the draft
sets but `app.toml` does not declare are reported.

`new`, `status`, `stage`, and `push` read the app config from `-a, --app-config` or discover
`./app.toml`. They never use another app's config: a file whose `app_name` differs from the app
selected by `--app` or `OBELISK_APP_NAME` is an error when passed with `-a` or required (by `stage`
and `push`), and is ignored when discovered by the other commands.

`cloud token new --name <NAME> --token-file <FILE>` saves the server-issued token to a new private
file; it does not overwrite an existing file. `--scope <APP>` restricts the token to apps and
`--expires-at` sets an RFC 3339 expiry. Token names are unique per account until revoked. If the
creation response is lost, revoke the inaccessible token before creating a replacement with the same
name.

Cloud commands print concise human-readable results to stderr; `--json` prints machine-readable
output and `--verbose` adds metadata, diagnostics, and each HTTP request with its response status,
prefixed with the time since the previous step (push steps included). Run `obelisk cloud --help` and
`obelisk cloud app --help` for all options.
