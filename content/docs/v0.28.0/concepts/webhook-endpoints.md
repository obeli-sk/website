+++
title = "Webhook Endpoints"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Webhook endpoints in Obelisk provide a way to trigger executions via incoming HTTP requests. They
act as entry points into your Obelisk system, allowing external services and applications to
interact with your workflows and activities.

## Core Concepts

- **HTTP-Triggered Execution:** Webhook endpoints are fundamentally different from workflows in how
  they are initiated. Workflows are started explicitly (CLI, UI, gRPC, or scheduled), while webhook
  endpoints are triggered by _incoming_ HTTP requests.

- **Request Handling:** A webhook endpoint is defined by a Rust function that receives an HTTP
  `Request` object (from the `waki` crate) and returns an HTTP `Response` object. This function can
  then process the request data (headers, body, query parameters) and perform actions accordingly.

- **Limited Concurrency:** Unlike general workflows, webhook endpoints _do not_ support
  {{ doc_link(title="join sets", path="concepts/workflows/join-sets.md") }}. Within a webhook
  endpoint, you can either:
  1.  **Directly Call a Workflow/Activity Function:** This is similar to a direct call within a
      workflow. The webhook endpoint function will block until the called function completes and
      returns a result. This result can then be used to construct the HTTP response.
  2.  **Schedule a Workflow/Activity Function:** Use the `-schedule` extension function to schedule
      a workflow or activity for later execution. This is a "fire-and-forget" operation from the
      perspective of the webhook endpoint. The endpoint will _not_ wait for the scheduled execution
      to complete, and the result of the scheduled function is not available to the webhook.

- **Single-Threaded Execution:** Like workflows, webhook endpoint code executes in a
  single-threaded, synchronous manner within its WebAssembly sandbox. You don't need to manage
  asynchronous operations directly within your webhook handler function.

- **Environment Variables**: You must extract parameters from the environment variables. The names
  of the variables are capitalized names of the HTTP URL path parameters.

## Creating a Webhook Endpoint

1.  **Definition:** Define a Rust function that will handle incoming HTTP requests. If the function
    is annotated with the `#[handler]` macro from the [waki](https://crates.io/crates/waki) crate,
    the macro handles the necessary [WASI 0.2 HTTP](https://github.com/WebAssembly/wasi-http)
    imports and exports.

2.  **WIT Imports:** Similar to workflows, in order to call workflows or activities, you need to
    import their WIT interfaces.

3.  **Compilation to WASM:** The Rust code is compiled into a WebAssembly Component.

4.  **Deployment:** Create a `[[webhook_endpoint]]` table in your `obelisk.toml`
    {{ doc_link(title="Obelisk configuration", path="configuration.md") }} file. This table
    specifies:
    - `name`: A unique name for the endpoint.
    - `http_server`: An association to a `http_server`
    - `location`: A table that defines where to load the wasm component from. It can be either
      `location.path` to a local file or `location.oci` to use a OCI registry.
    - `routes`: A request matching any of the specified routes will be forwarded to this endpoint.
      See next sections for details.

5.  **Execution:** When an HTTP request is made to a matching route, Obelisk:
    - Loads the associated WebAssembly Component.
    - Invokes the handler function, passing in the request and path parameters.
    - The handler function executes, potentially calling workflows/activities directly or scheduling
      them.
    - The response returned by the handler function is sent back to the client that made the HTTP
      request.

## Example - triggering the Fibonacci workflow

This example demonstrates a webhook endpoint that triggers the example Fibonacci
{{ doc_link(title="workflow", path="concepts/workflows/_index.md") }}. It showcases both direct
calls and {{ doc_link(title="scheduled", path="concepts/extensions.md") }} execution of a workflow
function.

**WIT File (`wit/template_fibo.wit`):**

```wit
package any:any;

world any {
    import template-fibo:workflow/fibo-workflow-ifc;
    import template-fibo:workflow-obelisk-ext/fibo-workflow-ifc;
    import obelisk:log/log@1.0.0;
}
```

**Rust Code (`src/lib.rs`):**

```rust
#[handler]
fn handle(_req: Request) -> Result<Response, ErrorCode> {
    let Ok(n) = std::env::var("N")
        .expect("env var `N` must be set by Obelisk if routes are configured properly")
        .parse()
    else {
        return Response::builder().status_code(400).build();
    };

    let Ok(iterations) = std::env::var("ITERATIONS")
        .expect("env var `ITERATIONS` must be set by Obelisk if routes are configured properly")
        .parse()
    else {
        return Response::builder().status_code(400).build();
    };

    let fibo_res = if n >= 10 {
        println!("scheduling");
        let execution_id = workflow_ext::fiboa_schedule(ScheduleAt::Now, n, iterations);
        format!("scheduled: {}", execution_id.id)
    } else if n > 1 {
        // Call the execution directly.
        println!("direct call");
        let fibo_res = workflow::fiboa(n, iterations);
        format!("direct call: {fibo_res}")
    } else {
        println!("hardcoded");
        "hardcoded: 1".to_string() // For performance testing - no activity is called
    };
    info(&format!("Sending response {fibo_res}"));
    Response::builder().body(fibo_res).build()
}
```

**`obelisk.toml` (Excerpt):**

```toml
[[http_server]]
name = "external"
listening_addr = "0.0.0.0:9000"

[[webhook_endpoint]]
name = "fibo"
location.path = "${OBELISK_TOML_DIR}/target/wasm32-wasip2/release/fibo_webhook_endpoint.wasm"  # Or use location.oci
http_server = "external"
routes = [{ methods = ["GET"], route = "/fibo/:N/:ITERATIONS" }] # Path parameters are captured
```

**Project Template:**

You can quickly create a new webhook endpoint project using
[cargo-generate](https://crates.io/crates/cargo-generate) and the
[webhook template](https://github.com/obeli-sk/obelisk-templates/blob/main/fibo/webhook_endpoint):

```bash
cargo generate obeli-sk/obelisk-templates fibo/webhook_endpoint --name mywebhook
cd mywebhook
cargo build --release
obelisk server run
```

Then, you can test it with `curl`:

```bash
curl localhost:9000/fibo/5/1  # Direct call
curl localhost:9000/fibo/12/1 # Scheduled execution
```

## Example - Stargazers demo

The webhook endoint in
[stargazers demo repository](https://github.com/obeli-sk/demo-stargazers/tree/main/webhook) shows
the integration with GitHub, specifically:

- Setting a shared secret and passing it as an environment variable
- Verifying the request signature using HMAC
- Creating a tunnel to expose the local HTTP server
- Testing

## Main Differences from Workflows

| Feature                 | Workflows                                     | Webhook Endpoints                                            |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| **Triggering**          | Explicit - CLI, Web UI, gRPC                  | Incoming HTTP Request                                        |
| **Function Extensions** | Full support (join sets)                      | Limited to direct calls or scheduling                        |
| **Purpose**             | Complex orchestration, long-running processes | Handling HTTP requests, typically just triggering a workflow |
| **Parameters**          | Explicitly declared in WIT                    | URL path parameters, configured environment variables        |

## Configuration

### Associating Webhook Endpoints with HTTP Servers

Webhook endpoints don't listen for HTTP requests directly. Instead, they are associated with an
`[[http_server]]` instance defined in your `obelisk.toml` configuration. This association is
established using the `http_server` field within the `[[webhook_endpoint]]` configuration.

```toml
[[http_server]]
name = "my_server"
listening_addr = "0.0.0.0:9000"

[[webhook_endpoint]]
name = "my_endpoint"
http_server = "my_server"  # Associates this endpoint with the "my_server" HTTP server
# ... other webhook endpoint settings ...
```

### Routes Configuration

Each `[[webhook_endpoint]]` must define one or more routes. These routes determine which incoming
HTTP requests will be handled by that endpoint. The routes field is a list of route specifications.

```toml
[[webhook_endpoint]]
name = "my_endpoint"
http_server = "my_server"
routes = [
    { methods = ["GET"], route = "/users/{id}" },  # Route with method
    "/products/*",                                 # Route without method (wildcard)
    "/status",                                     # Route without method (exact match)
]
# ... other webhook endpoint settings ...
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
  - `""` or `"/*"` - Match all paths

#### Route Priority and Matching Order

When an incoming HTTP request arrives, Obelisk checks the configured routes to determine which
webhook endpoint should handle it. The matching process follows these rules:

- **Method-Specific Routes First**: Obelisk first tries to match the request against routes that
  specify HTTP methods (e.g., { methods = ["GET"], route = "/path" }).

- **First Match Wins (Within Priority)**: Within each priority level (method-specific or not), the
  first route that matches the request wins. The order of routes in the routes list matters.
