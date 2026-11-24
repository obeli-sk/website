+++
title = "Cloud Browser"
template = "docs.html"
weight = 3
+++

The `browser`
{{ doc_link(title="cloud integration", path="configuration/app.md#cloud-integrations") }} runs a
headless browser ([Lightpanda](https://lightpanda.io)) on the app's VM. Activities and webhooks
drive it over plain HTTP with batches of Playwright-style steps; no WebSocket, CDP, or Playwright
client is needed. A browser can load only the hosts that `app.toml` allows, and it fills credentials
without the component code ever seeing them.

## Setup

Enable the integration in `app.toml`, list what the browser may load, and let components call the
browser service:

```toml
app_name = "myapp"

[cloud]
memory.mib = 512

[cloud.integrations.browser]
type = "browser"
env = "BROWSER_URL"
max_sessions = 1          # Concurrent sessions, default 1.
session_memory.mib = 128  # Memory limit per session, default 128 MiB, at least 128 MiB.
max_ttl.minutes = 30      # Upper bound and default for a session's TTL, 1 minute to 24 hours.
# user_agent = "..."      # Optional, see below.

# What the browser may load.
[[cloud.integrations.browser.allowed_host]]
pattern = "https://app.example.com"
methods = ["GET", "POST"]
request_url_regex = "^(GET|POST) https://app\\.example\\.com/(login|invoices)(/|$)"

[[cloud.integrations.browser.allowed_host]]
pattern = "https://*.examplecdn.com"
methods = ["GET"]

[public_env]
BROWSER_URL = {}

[secrets]
APP_PASSWORD = {}

# Who may drive the browser: components calling the browser service.
[[outbound_http.allowed_host]]
url_prefix = "${BROWSER_URL}"
methods = ["GET", "POST", "DELETE"]
secrets = ["APP_PASSWORD"]   # Only to fill credentials, see below.
replace_in = ["body"]
```

Obelisk reads only `env` from the integration; the cloud validates the other settings when the app
is staged, so `server verify` does not catch typos in them. The cloud binds `BROWSER_URL` to the
browser service, `http://127.0.0.1:9195`. Components that drive the browser need the same
`allowed_host` entry in `deployment.toml` and `env_vars = ["BROWSER_URL"]`:

```toml
[[activity_js]]
name = "browse"
location = "browse.js"
env_vars = ["BROWSER_URL"]
# ...

[[activity_js.allowed_host]]
url_prefix = "${BROWSER_URL}"
methods = ["GET", "POST", "DELETE"]
secrets = ["APP_PASSWORD"]
replace_in = ["body"]
```

Changing the integration restarts the VM, which ends open sessions.

### Allowed hosts

`[[cloud.integrations.browser.allowed_host]]` entries decide what pages may load. They are separate
from `[[outbound_http.allowed_host]]`: allowing components to call a host and allowing a page's
JavaScript to load it are different grants. Entries take the same keys as
{{ doc_link(title="outbound HTTP entries", path="configuration/app.md#app-outbound-http-policy") }},
except `secrets` and `replace_in`, because the browser already holds the plaintext:

- `pattern`: `[scheme://]host[:port]`, with an optional leading `*.` that matches any subdomain but
  not the domain itself.
- `methods`: required; a list of uppercase methods, or `"*"` for all of them.
- `request_url_regex`: optional; an unanchored regex matched against `METHOD URL`, where the URL has
  no query or fragment.
- `url_prefix` with optional `url_regex_suffix` replaces `pattern` and `request_url_regex`, as in
  `outbound_http`.

At least one entry is required. Two layers enforce the entries:

- **The egress proxy** is the browser's only network access. It lets the browser connect only to a
  host and port that matches some entry's `pattern`. It refuses loopback, private, and link-local
  addresses even when a host matches. It does not decrypt TLS.
- **Request interception** inside the browser checks every request, including redirect hops,
  `fetch`, XHR, form submissions, and beacons, against the method and `request_url_regex` before it
  is sent. A CORS preflight `OPTIONS` passes when its host matches any entry, because the request it
  guards is checked separately.

WebSockets are refused. Of a page's subresources, the browser loads scripts and stylesheets; images
and iframes are skipped. Pages often pull assets from CDNs, fonts, and analytics hosts, so expect
some denials: allow what the page needs to work and leave the rest denied (see
[Troubleshooting](#troubleshooting)).

### Memory

Each session is a separate browser process with its own memory limit, running in a sandbox as an
unprivileged user with no network access except through its own proxy.

- `max_sessions * session_memory` must fit in `cloud.memory` minus 256 MiB, which Obelisk and the
  platform need. A 512 MiB VM hosts two 128 MiB sessions or one 256 MiB session; the 256 MiB default
  VM cannot host a browser.
- A session uses about 20 MB idle, 30 to 70 MB on most pages, and up to about 120 MB on heavy pages
  such as GitHub; 128 MiB still loads those.
- A session that runs out of memory, or stalls against its limit, ends with `oom` or
  `memory_pressure`. Other sessions and Obelisk keep running.

### User-Agent

Without `user_agent`, the browser sends a Chrome-like value without the `Mozilla` prefix, which
sites that reject unknown browsers accept. A custom value, in `app.toml` or per session, must be
printable ASCII and must not contain `Mozilla`. The `Sec-CH-UA` header and `navigator.userAgentData`
always identify Lightpanda.

## Sessions

The browser service answers at `BROWSER_URL`:

| Route                                                      | Purpose                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /v1/sessions`                                         | Open sessions, oldest first, with the execution that started each one      |
| `POST /v1/sessions` `{"ttl_s"?, "user_agent"?, "target"?}` | Starts a session; returns 201 with `{"id", "expires_at"}`                  |
| `POST /v1/sessions/{id}/steps` `{"steps": [...]}`          | Runs up to 100 steps in order, stopping at the first error                 |
| `GET /v1/sessions/{id}`                                    | Expiry, current URL and title, or `"busy": true` while a batch runs        |
| `GET /v1/sessions/{id}/log?after={seq}`                    | What the session did, see [Session log](#session-log)                      |
| `DELETE /v1/sessions/{id}`                                 | Ends the session and frees its slot                                        |

Obelisk adds the calling execution's ID to every request to `BROWSER_URL` in the
`Obelisk-Int-Execution-Id` header, and the service answers 400 without it. Only WASM and JavaScript
activities and webhook endpoints can therefore use the browser; native `activity_exec` processes
cannot. Components cannot set the header themselves.

`GET /v1/sessions` answers `{"sessions": [{"id", "execution_id", "target", "created_at",
"expires_at"}]}`, where `execution_id` is the execution that started the session. Use it to find and
end sessions that a failed execution left open instead of waiting for their TTL.

`ttl_s` defaults to `max_ttl` and cannot exceed it. `target: "debug"` opens a
[debug session](#debug-sessions). Starting a session answers 429 when `max_sessions` are open.

Session IDs are unguessable, and any component of the app can use any of its sessions, so a workflow
can open a session in one activity and drive it from the next. A session lives outside the execution
log: it ends at its TTL, on `DELETE`, or when the VM restarts. An ended session answers 410 with
`end_reason` and `ended_at`; the reasons are `ttl`, `deleted`, `oom`, `memory_pressure`, `crashed`,
and `reconfigured`. A workflow should treat 404 and 410 as a signal to start a new session. While a
batch runs, another batch for the same session answers 409.

### Steps

```json
{
  "steps": [
    { "op": "goto", "url": "https://app.example.com/login" },
    { "op": "fill", "locator": { "label": "Email" }, "value": "me@example.com" },
    {
      "op": "fill",
      "locator": { "label": "Password" },
      "value": "<APP_PASSWORD placeholder>",
      "sensitive": true
    },
    { "op": "click", "locator": { "role": "button", "name": "Sign in" } },
    { "op": "wait_for", "url": "**/invoices" },
    { "op": "text", "locator": { "css": "table.invoices" } }
  ]
}
```

| Op                  | Fields                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `goto`              | `url`                                                                                                                        |
| `click`             | `locator`                                                                                                                    |
| `fill`              | `locator`, `value`, `sensitive`                                                                                              |
| `press`             | `key`, optional `locator` (else the focused element)                                                                         |
| `select`            | `locator`, `values` (option values or labels)                                                                                |
| `check`             | `locator`, `checked` (default `true`)                                                                                        |
| `wait_for`          | `locator` with `state` (`attached`, `detached`, `visible` (default), `hidden`), or `url` glob (`**` spans `/`, `*` does not) |
| `text`, `attribute` | `locator`; `attribute` also takes `name`                                                                                     |
| `count`             | `locator`                                                                                                                    |
| `content`           | `format`: `html` (default) or `markdown`                                                                                     |
| `evaluate`          | `expression`, a JavaScript expression evaluated in the page                                                                  |

Every op except `count`, `content`, and `evaluate` accepts `timeout_ms`. A locator has one of `css`,
`role` (with optional `name`), `text`, `label`, `placeholder`, or `test_id`, plus optional `exact`
(whole, case-sensitive match) and `nth` (negative counts from the end). Locators and auto-waiting
follow Playwright's semantics: actions wait for the element to be visible, stable, and enabled.

The response has one result per step that ran (`op`, then `value` or `error`, and `truncated` when a
value was cut at 256 KiB), the page's final `url` and `title`, and what was refused since the
previous batch:

```json
{
  "results": [{ "op": "goto" }, { "op": "text", "value": "..." }],
  "url": "https://app.example.com/invoices",
  "title": "Invoices",
  "denied_hosts": ["fonts.example.net:443"],
  "denied_requests": ["POST https://app.example.com/analytics"]
}
```

Send an `Idempotency-Key` header with each batch: a retried activity whose response was lost then
gets the stored result instead of running the steps again. Send one batch per activity and let the
workflow decide the next batch from the result.

### Credentials

To fill a credential, list its secret in the `outbound_http` entry for `BROWSER_URL` with
`replace_in = ["body"]`, as in the [setup](#setup). The component reads an opaque placeholder from
the secret's environment variable and puts it in the step's `value`. Obelisk replaces it with the
real value in the request to `BROWSER_URL` (see
{{ doc_link(title="Secrets", path="configuration/app.md#secret-registry") }}), so component code and
the execution log never see it.

Mark the step `sensitive`: the browser then redacts the value from every later result in the
session, the session log and system events included, as typed and in its percent-encoded,
HTML-escaped, and JSON-escaped forms. Other encodings, and values the page derives from it, are not
redacted, so read back only what the workflow needs.

The browser holds the plaintext, so the browser `allowed_host` entries are what keep a credential on
its site. Any component that can reach `BROWSER_URL` can fill the secret into any field of any
allowed page, and `evaluate` can read cookies and form values and send them to any allowed host.
Keep the entries tight, and use `methods` and `request_url_regex` to limit where forms can post.

### Limitations

Lightpanda has no layout or rendering: there are no screenshots or PDFs, and file downloads and
uploads are not supported. Classic server-rendered sites work well, while some single-page
applications and sites behind bot protection do not.

## Troubleshooting

A session runs on between batches (timers, redirects, background requests), and workflows often
drive it from several activities, so a step result alone may not show why a page failed. Three
places show what happened.

### Step results

`denied_hosts` lists connections the egress proxy refused, as `host:port`. `denied_requests` lists
requests that interception blocked, as `METHOD URL` without the query. A `goto` that was refused
fails with an error, while refused subresources and background requests only appear in these lists.

### System events

Every refusal is also recorded as an Obelisk system event at warning level, next to Obelisk's own
`outbound_http.denied`, so it shows up without anyone reading a session log:

| Code                            | Details                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ext.browser.request.denied`    | `session_id`, `method`, `url` (no query, secrets redacted), `scheme`, `host`, `port`, `resource_type`, `denied_by`, `app_toml` |
| `ext.browser.connection.denied` | `session_id`, `host`, `port`, `denied_by`                                                                                      |

`denied_by` says which check refused it:

- `host`: no `allowed_host` entry matches the host and port.
- `request`: an entry matches the host, but none allows this method and URL.
- `private_address`: the host resolves only to loopback, private, or link-local addresses.
- `scheme`: not `http` or `https`.

For `host` and `request`, `app_toml` holds an entry that would allow the request. Review it before
copying it into `app.toml`: it allows the whole origin for that method, and a request your page does
not need is better left denied.

List them with the CLI, or filter the Web UI's system events by the `ext.browser` code prefix:

```sh
obelisk cloud app admin events list --app myapp --code ext.browser --json
```

Each refusal is recorded once per deployment and browser policy: repeats of the same method, origin,
and reason are not recorded again until the deployment or the `allowed_host` entries change. Use the
`session_id` and the event's time to find the session log, and the session log to see every
occurrence.

### Session log

`GET /v1/sessions/{id}/log` returns every request the browser made, allowed or not, each refused
connection, each batch, and the session's end:

```json
{
  "id": "4f0c...",
  "state": "open",
  "expires_at": "2026-11-19T10:30:00Z",
  "dropped": 0,
  "entries": [
    {
      "seq": 0,
      "at": "2026-11-19T10:00:01Z",
      "kind": "request",
      "method": "GET",
      "url": "https://app.example.com/login",
      "resource_type": "Document"
    },
    {
      "seq": 1,
      "at": "2026-11-19T10:00:01Z",
      "kind": "connection_denied",
      "host": "fonts.example.net",
      "port": 443,
      "denied_by": "host"
    },
    {
      "seq": 2,
      "at": "2026-11-19T10:00:02Z",
      "kind": "request",
      "method": "POST",
      "url": "https://app.example.com/analytics",
      "resource_type": "Ping",
      "denied_by": "request"
    },
    {
      "seq": 3,
      "at": "2026-11-19T10:00:03Z",
      "kind": "batch",
      "started_at": "2026-11-19T10:00:00Z",
      "ops": ["goto", "fill", "fill", "click"],
      "url": "https://app.example.com/invoices",
      "title": "Invoices"
    }
  ]
}
```

- Entries have a sequence number and an RFC 3339 timestamp, which match them to the executions that
  drove the session. Pass `after` with the last `seq` you read to get only newer entries.
- The log keeps the newest 500 entries; `dropped` counts older ones that were discarded.
- A `batch` entry has `error` when a step failed. An `ended` entry records the `reason`.
- URLs have no query or fragment, and sensitive values are redacted as in step results.
- An ended session's log has `"state": "ended"`, `end_reason`, and `ended_at`, and stays readable
  for 15 minutes; after that only the end reason remains.

`BROWSER_URL` is reachable only inside the VM, so read the log through a component: an activity you
submit with `obelisk cloud app execution submit`, or an `internal` webhook that returns it. Reading
the log does not affect the session, so it is safe while a workflow drives the session.

## Debug sessions

A debug session browses the app's own webhooks, for example so that an agent can test a UI it built,
without giving the browser credentials. It needs the `debug` server, which listens only on the VM's
loopback at `http://127.0.0.1:9092` with no authentication, and starts only when `app.toml` lists
it:

```toml
public_http_servers = ["debug"]

[[cloud.integrations.browser.allowed_host]]
url_prefix = "http://127.0.0.1:9092/ui/"
methods = ["GET", "POST"]

[public_env]
DEBUG_BASE_URL = { type = "internal", source = "http-server-url", http_server = "debug" }
```

Bind the webhooks to test to it with `http_server = "debug"` in `deployment.toml`; a webhook that
also serves on `internal` needs a second entry with the same component. `DEBUG_BASE_URL` gives
components the server's URL, which on a local run is your own listener. Then start the session with
`{"target": "debug"}`.

- A debug session can load only the `debug` server, and only what its `allowed_host` entries allow.
  Pages served there cannot load CDN assets, so a debug UI must serve its own.
- A normal session never reaches the `debug` server, even with an entry for it, because a
  third-party page in the same session could call the unauthenticated server.
- An entry for `127.0.0.1:9092` or `localhost:9092` requires `debug` in `public_http_servers`.
  Starting a session answers 400 when no entry exists for its target.
- The `debug` server is never reachable from outside the VM, but components with an outbound HTTP
  entry for it can call it.
