+++
title = "JS Webhooks"
template = "docs.html"
weight = 25
+++

Webhook endpoints serve HTTP requests. The handler receives a `Request` object and must return a
`Response`. Webhooks can call activities and workflows via imports or `dynamic.call` and make
outbound HTTP requests via `fetch`. See
{{ doc_link(title="Webhook Endpoints", path="concepts/webhook-endpoints.md") }} for the general
model.

Prefer imports when the target function is known statically. Imports are verified when the
deployment starts; use dynamic FFQN calls only when the target is constructed at runtime.

Import `obelisk:webhook@1.0.0` for execution IDs and result lookup. Runtime-selected calls and
schedules come from the separate `obelisk:webhook-dynamic@1.0.0` module.

```javascript
import * as obelisk from "obelisk:webhook@1.0.0";
import * as dynamic from "obelisk:webhook-dynamic@1.0.0";
```

```toml
[[webhook_endpoint_js]]
name     = "my_webhook"
location = "webhook/my_webhook.js"
routes   = [
    { methods = ["GET"],  route = "/items" },
    { methods = ["POST"], route = "/items/:id" },
]
env_vars = [{ key = "DB_URL", value = "..." }]
exposed_secrets = ["WEBHOOK_SIGNING_SECRET"]
[[webhook_endpoint_js.allowed_host]]
pattern = "https://api.example.com"
methods = ["GET"]
secrets = ["API_KEY"]
replace_in = ["headers"]
```

The app policy must register `API_KEY` in `[secrets]` and allow the same destination, method,
secret, and `replace_in` target in `[[outbound_http.allowed_host]]` in `app.toml`.

`WEBHOOK_SIGNING_SECRET` is different: the handler must read its plaintext to validate inbound
signatures. Register it under `[secrets]`, generate a digest with
`obelisk generate secret-config-digest --deployment deployment.toml`, and authorize the resulting
component-and-secret-set digest under `[secrets.WEBHOOK_SIGNING_SECRET.exposed_to]`. The handler can
then read `process.env.WEBHOOK_SIGNING_SECRET`. Regenerate the grant whenever the component or its
complete `exposed_secrets` list changes.

Route path segments starting with `:` are captured and exposed as `process.env` entries inside the
handler — `process.env['segment-name']` returns the captured value as a string.

## Handler signature

```javascript
export default function handle(request) {
  // sync or async
  return new Response("body", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
```

## Request object

| Property / method           | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `request.url`               | Full request URL as a string                                     |
| `request.method`            | HTTP method (`"GET"`, `"POST"`, …)                               |
| `request.headers`           | `Headers` object                                                 |
| `request.headers.get(name)` | Returns header value or `null`; multiple values joined by `", "` |
| `await request.text()`      | Read the request body as a string                                |
| `await request.json()`      | Parse the request body as JSON                                   |
| `await request.formData()`  | Parse the request body as form data                              |

### Reading the request body

```javascript
export default async function handle(request) {
  // As plain text
  const text = await request.text();

  // As JSON
  const data = await request.json();

  // As form data (application/x-www-form-urlencoded or multipart/form-data)
  const form = await request.formData();
  const field = form.get("field-name");

  return Response.json({ received: data });
}
```

## Response construction

```javascript
// Text response
return new Response("Hello!", {
  status: 200,
  headers: { "content-type": "text/plain" },
});

// JSON response (sets content-type: application/json automatically)
return Response.json({ key: "value" });
return Response.json([1, 2, 3], { status: 201 });

// Proxy a fetch response directly
const resp = await fetch("https://api.example.com/data");
return resp;
```

## Calling activities and workflows

Import functions by their interface name (the FFQN without the function). The call blocks until the
child execution completes, so the HTTP response is only sent after the child finishes.

```javascript
import { serial } from "myapp:demo/workflow";

// ffqn: myapp:demo/webhook.handle
export default function handle(request) {
  const url = new URL(request.url);
  if (url.pathname === "/serial") {
    const result = serial();
    return new Response(`serial completed: ${result}`, { status: 200 });
  }
  return new Response("not found", { status: 404 });
}
```

For FFQNs constructed at runtime, use `dynamic.call(ffqn, argArray)`:

```javascript
import * as dynamic from "obelisk:webhook-dynamic@1.0.0";

const result = dynamic.call(ffqn, argArray);
```

## Return values and errors

Obelisk APIs return the useful value on success and throw on error:

| JavaScript API                      | Returns               | Throws                         |
| ----------------------------------- | --------------------- | ------------------------------ |
| Typed `fooSchedule(at, ...)`        | Execution ID string   | `Error`                        |
| `dynamic.schedule(...)`             | `undefined`           | `Error`                        |
| Typed call                          | Child value           | On child or platform error     |
| `dynamic.call(...)`                 | Child value           | `ChildError` or a host `Error` |
| `obelisk.getStatus/get/tryGet(...)` | Status or child value | On errors                      |

Use the execution ID returned by a typed schedule. `dynamic.schedule` returns `undefined`, so
generate the ID yourself and pass it in.

## Path parameters

When a route contains named segments (`:name`), the captured values are available as `process.env`
entries inside the handler:

```toml
[[webhook_endpoint_js]]
name    = "my_webhook"
location = "webhook/my_webhook.js"
routes  = ["/users/:user-id/items/:item-id"]
```

```javascript
export default function handle(request) {
  const userId = process.env["user-id"];
  const itemId = process.env["item-id"];
  return Response.json({ userId, itemId });
}
```

## Scheduling executions

Webhooks can schedule top-level executions without blocking the HTTP response. Import from the
`-obelisk-schedule` suffix:

```javascript
import { sendEmailSchedule } from "myapp:demo-obelisk-schedule/activity";

export default function handle(request) {
  const execId = sendEmailSchedule(null, "user@example.com");
  // With a delay: sendEmailSchedule({ seconds: 60 }, "user@example.com");
  return new Response(execId, { status: 202 });
}
```

For FFQNs constructed at runtime, use `dynamic.schedule` directly:

```javascript
import * as obelisk from "obelisk:webhook@1.0.0";
import * as dynamic from "obelisk:webhook-dynamic@1.0.0";

const execId = obelisk.executionIdGenerate();
dynamic.schedule(execId, "myapp:demo/activity.send-email", ["user@example.com"]);
```

The typed schedule returns the execution ID string. `dynamic.schedule` returns `undefined`; it uses
the execution ID supplied by the caller. Both throw `Error` if scheduling fails.

Check or retrieve a previously scheduled or running execution:

```javascript
const status = obelisk.getStatus(execId);
// e.g. { status: "pendingAt"|"locked"|"paused"|"blockedByJoinSet"|"cancelling" } or { status: "finished", finishedStatus:"ok"|"err"|"executionFailure" }

const result = obelisk.tryGet(execId);
// undefined if not finished yet
// returns ok value when done, or throws obelisk.ChildError on failure
```

Get the execution ID of the current webhook invocation:

```javascript
const myExecId = obelisk.executionIdCurrent();
// Returns the execution ID string for this webhook handler invocation
```

## Webhook API

**Import-based calls (preferred):**

| Import pattern                                             | Description                          |
| ---------------------------------------------------------- | ------------------------------------ |
| `import { fn } from "ns:pkg/ifc"`                          | Call and await a child execution     |
| `import { fnSchedule } from "ns:pkg-obelisk-schedule/ifc"` | Schedule a fire-and-forget execution |

**Dynamic calls (when FFQN isn't known statically):**

| Call                                                   | Returns                                                                                                                              | Description                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `dynamic.call(ffqn, argArray)`                         | returns ok value, throws `obelisk.ChildError` on failure                                                                             | Call and await a child execution                       |
| `obelisk.executionIdGenerate()`                        | `executionId` (string)                                                                                                               | Generate a unique execution ID                         |
| `obelisk.executionIdCurrent()`                         | `executionId` (string)                                                                                                               | Get the execution ID of the current webhook invocation |
| `dynamic.schedule(execId, ffqn, argArray)`             | `undefined` (throws `Error` on failure)                                                                                              | Schedule a top-level execution immediately             |
| `dynamic.schedule(execId, ffqn, argArray, scheduleAt)` | `undefined` (throws `Error` on failure)                                                                                              | Schedule with a relative duration or absolute `Date`   |
| `obelisk.getStatus(execId)`                            | `{ status: "pendingAt"/"locked"/"paused"/"blockedByJoinSet"/"cancelling"/"finished", finishedStatus:"ok"/"err"/"executionFailure" }` |
| `obelisk.get(execId)`                                  | ok value (throws `obelisk.ChildError` on failure)                                                                                    | Blocking: waits until execution finishes               |
| `obelisk.tryGet(execId)`                               | ok value (throws `obelisk.ChildError` on failure), `undefined` if not finished yet                                                   | Non-blocking result fetch                              |

## Available globals

Same as {{ doc_link(title="JS activities", path="js/js-activities.md") }}: `process.env`, `fetch`,
`crypto.subtle`, `console`, `TextEncoder`/`TextDecoder`, `URL`/`URLSearchParams`.

## Fetch example

```javascript
export default async function handle(request) {
  const someHeader = request.headers.get("x-custom");
  const api_key = process.env["API_KEY"]; // JS code only gets a short-lived token, transformed on outbound HTTP request.
  // Requires [[webhook_endpoint_js.allowed_host]] for the target
  const resp = await fetch("https://api.example.com/data", {
    headers: { accept: "application/json", authorization: `Bearer ${api_key}` },
  });
  return resp;
}
```
