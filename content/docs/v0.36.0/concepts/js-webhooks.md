+++
title = "JS Webhooks"
template = "docs.html"
weight = 25
+++

Webhook endpoints serve HTTP requests. The handler receives a `Request` object and must
return a `Response`. Webhooks can call activities and workflows via `obelisk.call` and make
outbound HTTP requests via `fetch`. See
{{ doc_link(title="Webhook Endpoints", path="concepts/webhook-endpoints.md") }} for the
general model.

```toml
[[webhook_endpoint_js]]
name     = "my_webhook"
location = "${DEPLOYMENT_DIR}/webhook/my_webhook.js"
routes   = [
    { methods = ["GET"],  route = "/items" },
    { methods = ["POST"], route = "/items/:id" },
]
env_vars = [{ key = "DB_URL", value = "..." }]
[[webhook_endpoint_js.allowed_host]]
pattern = "https://api.example.com"
methods = ["GET"]
```

Route path segments starting with `:` are captured but are not exposed directly — read them
from the URL if needed.

## Handler signature

```javascript
export default function handle(request) {
    // sync or async
    return new Response("body", { status: 200, headers: { "content-type": "text/plain" } });
}
```

## Request object

| Property / method | Description |
|-------------------|-------------|
| `request.url` | Full request URL as a string |
| `request.method` | HTTP method (`"GET"`, `"POST"`, …) |
| `request.headers` | `Headers` object |
| `request.headers.get(name)` | Returns header value or `null`; multiple values joined by `", "` |

## Response construction

```javascript
// Text response
return new Response("Hello!", { status: 200, headers: { "content-type": "text/plain" } });

// JSON response (sets content-type: application/json automatically)
return Response.json({ key: "value" });
return Response.json([1, 2, 3], { status: 201 });

// Proxy a fetch response directly
const resp = await fetch("https://api.example.com/data");
return resp;
```

## Calling activities and workflows

Webhooks have access to `obelisk.call` — the call blocks until the child execution
completes, so the HTTP response is only sent after the workflow finishes.

```javascript
// ffqn: myapp:demo/webhook.handle
export default function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === "/serial") {
        const result = obelisk.call("myapp:demo/workflow.serial", []);
        return new Response(`serial completed: ${result}`, { status: 200 });
    }
    return new Response("not found", { status: 404 });
}
```

## Available globals

Same as {{ doc_link(title="JS activities", path="concepts/js-activities.md") }}:
`process.env`, `fetch`, `crypto.subtle`, `console`, `TextEncoder`/`TextDecoder`.

## Examples

**Read a request header:**
```javascript
export default function handle(request) {
    const value = request.headers.get("x-custom");
    return Response.json(value !== null ? value.split(", ") : []);
}
```

**Read environment variable:**
```javascript
export default function handle(_request) {
    const value = process.env["API_KEY"];
    if (value === undefined) return new Response("missing config", { status: 500 });
    return new Response(value, { status: 200 });
}
```

**Proxy an outbound fetch:**
```javascript
export default async function handle(request) {
    // Requires [[webhook_endpoint_js.allowed_host]] for the target
    const resp = await fetch("https://api.example.com/data", {
        headers: { "accept": "application/json" }
    });
    return resp;
}
```

**Forward request headers to a fetch:**
```javascript
export default async function handle(request) {
    return fetch("https://api.example.com/data", { headers: request.headers });
}
```
