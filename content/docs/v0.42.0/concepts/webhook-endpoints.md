+++
title = "Webhook Endpoints"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Webhook endpoints handle incoming HTTP requests and can trigger workflows or activities in response.
They are sandboxed like activities, but export an HTTP handler instead of named functions.

A handler receives a request and returns a response. It can call a workflow or activity directly —
blocking until the result is ready — or schedule one as fire-and-forget without waiting.
{{ doc_link(title="Join sets", path="concepts/workflows/join-sets.md") }} are not available inside
webhook handlers. URL path parameters are exposed as environment variables (`process.env` in
JavaScript) inside the handler.

```javascript
// webhook/start.js
import { serialSchedule } from "myapp:demo-obelisk-schedule/workflow";

export default async function handle(request) {
  const execId = serialSchedule(null);
  return new Response(`Started ${execId}\n`, { status: 202 });
}
```

## Implementation

For language-specific implementation details, see:

- {{ doc_link(title="JS Webhooks", path="js/js-webhooks.md") }} — JavaScript handler, `dynamic.call`
  and `dynamic.schedule` from `obelisk:webhook-dynamic@1.0.0`, fetch, path parameters
- {{ doc_link(title="Rust Components", path="wasm/rust-components.md") }} — Rust handler using
  `wstd`

## Example — Stargazers demo

The webhook endpoint in the
[stargazers demo repository](https://github.com/obeli-sk/demo-stargazers/tree/main/webhook) shows a
real-world integration with GitHub. JavaScript and Rust webhooks can request a registered signing
key through `exposed_secrets` and receive it as an environment variable. The app admin must
authorize the generated component-and-secret-set digest under `[secrets.<name>.exposed_to]` in
`app.toml`. Do not put such a credential in `public_env` or a regular component `env_vars` entry.

The demo covers:

- Registering a shared webhook secret
- Verifying the request signature using HMAC
- Creating a tunnel to expose the local HTTP server
- Testing

## Configuration

### Associating Webhook Endpoints with HTTP Servers

Webhook endpoints don't listen for HTTP requests directly. Instead, they are served by an HTTP
server. The built-in `"external"` server listens on `127.0.0.1:9090` and is used when `http_server`
is omitted. The platform admin can define additional named servers in
{{ doc_link(title="server.toml", path="configuration/server.md#http-servers") }}:

```toml
# server.toml
[[http_server]]
name = "my_server"
listening_addr = "0.0.0.0:9000"
```

```toml
# deployment.toml
[[webhook_endpoint_js]]
name = "my_endpoint"
location = "webhook/start.js"
http_server = "my_server"
routes = ["/start"]
```

### Routes Configuration

Each webhook endpoint must define one or more routes. These routes determine which incoming HTTP
requests will be handled by that endpoint.

```toml
[[webhook_endpoint_js]]
name = "my_endpoint"
location = "webhook/start.js"
http_server = "my_server"
routes = [
    { methods = ["GET"], route = "/users/{id}" },  # Route with method
    "/products/*",                                 # Route without method (wildcard)
    "/status",                                     # Route without method (exact match)
]
```

#### Route Syntax and Matching

Obelisk supports several ways to define routes:

- **Static Routes**: Match exact URL paths.
  - `"/"`: Matches only the root path.

  - `"/path"`: Matches the exact path `/path`.

- **Wildcard Routes**: Match path prefixes.
  - `"/path/*"`: Matches any path that starts with `/path/`, including `/path/`, `/path/subpath`,
    `/path/a/b/c`, etc.

- **Parameterized Routes**: Capture parts of the path as parameters.
  - `"/status/:PARAM1/:PARAM2"`: Matches paths like `/status/123/abc`. The values `123` and `abc`
    will be available to the webhook endpoint as environment variables named `PARAM1` and `PARAM2`,
    respectively.

- **Method-Specific Routes**: These routes combine an HTTP method (or methods) with a path.
  Method-specific routes have higher priority than routes without methods.
  - `{ methods = ["GET"], route = "/path/*" }`: A wildcard route restricted to only `GET` requests.

  - `{ methods = ["POST", "PUT"], route = "/resource" }`: A static route restricted to `POST` or
    `PUT` requests.

- **Matching All Paths**
  - `""` or `"/*"` — Match all paths

#### Route Priority and Matching Order

When an incoming HTTP request arrives, Obelisk checks the configured routes to determine which
webhook endpoint should handle it. The matching process follows these rules:

- **Method-Specific Routes First**: Obelisk first tries to match the request against routes that
  specify HTTP methods (e.g., `{ methods = ["GET"], route = "/path" }`).

- **First Match Wins (Within Priority)**: Within each priority level (method-specific or not), the
  first route that matches the request wins. The order of routes in the routes list matters.
