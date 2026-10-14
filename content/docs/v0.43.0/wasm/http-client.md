+++
title = "HTTP Client (Rust)"
template = "docs.html"
weight = 25
+++

Rust activities and webhook endpoints can make outbound HTTP requests using the
[WASI 0.2 HTTP client](https://github.com/WebAssembly/wasi-http). This HTTP client is controlled,
with built-in tracing to enhance security and predictability. Disk I/O is currently not permitted.

> **Note**: Components that make outbound HTTP calls require `[[allowed_host]]` entries in the
> deployment and matching `[[outbound_http.allowed_host]]` entries in `app.toml`. Without both,
> outbound HTTP is blocked. See
> {{ doc_link(title="Configuration", path="configuration/deployment.md#outbound-http-allowlist") }}
> for details.

The following WIT and code show the client pattern. See
{{ doc_link(title="Rust components", path="wasm/rust-components.md") }} for project setup.

The WIT interface is stored in `http-client.wit`:

```wit
package template-http:activity;

interface http-get {

    // Submit example: obelisk execution submit --follow template-http:activity/http-get.get-plain '["https://api.ipify.org"]'
    get-plain: func(url: string) -> result<string, string>;

    // Submit example: obelisk execution submit -f template-http:activity/http-get.get-json '["https://api.ipify.org?format=json"]'
    get-json: func(url: string) -> result<string, string>;
}

interface http-post {
    // Submit example: obelisk execution submit -f template-http:activity/http-post.post '["https://httpbin.org/post", "text-plain", "test"]'
    post: func(url: string, content-type: string, body: string) -> result<string, string>;
}
```

Instead of using the WASI HTTP 0.2 bindings directly we use the
[wstd](https://crates.io/crates/wstd) async runtime, which supports `async`/`await` syntax within
WASM components.

```rust
use wstd::{
    http::{Body, Client, Method, Request},
    runtime::block_on,
};

async fn get_plain(url: &str) -> Result<String, anyhow::Error> {
    let client = Client::new();
    let request = Request::builder()
        .uri(url)
        .method(Method::GET)
        .header("User-Agent", "my-awesome-agent/1.0")
        .body(Body::empty())?;
    let response = client.send(request).await?;
    let mut body = response.into_body();
    let body = body.contents().await?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}

async fn get_json(url: &str) -> Result<String, anyhow::Error> {
    let client = Client::new();
    let request = Request::builder()
        .uri(url)
        .method(Method::GET)
        .header("Accept", "application/json")
        .body(Body::empty())?;
    let response = client.send(request).await?;
    let body: serde_json::Value = response.into_body().json().await?;
    Ok(serde_json::to_string(&body)?)
}

async fn post(url: &str, content_type: &str, body: String) -> Result<String, anyhow::Error> {
    let client = Client::new();
    let request = Request::builder()
        .uri(url)
        .method(Method::POST)
        .header("content-type", content_type)
        .body(Body::from(body))?;
    let response = client.send(request).await?;
    let mut body = response.into_body();
    let body = body.contents().await?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}

impl GetGuest for Component {
    fn get_plain(url: String) -> Result<String, String> {
        block_on(async move { get_plain(&url).await.map_err(|err| err.to_string()) })
    }

    fn get_json(url: String) -> Result<String, String> {
        block_on(async move { get_json(&url).await.map_err(|err| err.to_string()) })
    }
}

impl PostGuest for Component {
    fn post(url: String, content_type: String, body: String) -> Result<String, String> {
        block_on(async move {
            post(&url, &content_type, body)
                .await
                .map_err(|err| err.to_string())
        })
    }
}
```

Build the WASM component in release mode:

```sh
just build
```

Run the integration test:

```sh
just test
```

Start the Obelisk server and submit an execution:

```sh
just serve
just submit
```

See {{ doc_link(title="Rust components", path="wasm/rust-components.md") }} for WIT and build setup.

If you need to use GraphQL, check out the [cynic](https://crates.io/crates/cynic) crate and the
[cynic documentation](https://cynic-rs.dev/).
