+++
title = "Using HTTP Client"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Activities can make HTTP requests using the [WASI 0.2 HTTP client](https://github.com/WebAssembly/wasi-http). This allows them to interact with external services and APIs. Importantly, this HTTP client is controlled, with built-in tracing to enhance security and predictability. Disk I/O is currently not permitted.

> **Note**: Activities that make outbound HTTP calls require explicit `[[allowed_host]]` entries in `deployment.toml`. Without them, all outbound HTTP is blocked. See {{ doc_link(title="Configuration", path="configuration.md#outbound-http-allowlist") }} for details.

Let's generate a simple HTTP Client from a template:
```sh
cargo generate obeli-sk/obelisk-templates activity-rs/http-simple-sync --name httpactivity
cd httpactivity
```
This will generate a directory with the following structure:
```
.
├── .cargo
│   └── config.toml
├── Cargo.toml
├── obelisk.toml
├── README.md
├── rust-toolchain.toml
├── src
│   └── lib.rs
└── wit
    ├── deps
    │   └── template-http_activity
    │       └── http-get.wit
    └── impl.wit
```

The WIT interface is stored in `http-get.wit`:
```
package template-http:activity;

interface http-get {
    get: func(url: string) -> result<string, string>;
}
```

Instead of using the WASI HTTP 0.2 bindings directly we use the [waki](https://crates.io/crates/waki) HTTP client.

```rust
impl Guest for Component {
    fn get(url: String) -> Result<String, String> {
        let resp = waki::Client::new()
            .get(&url)
            .connect_timeout(Duration::from_secs(1))
            .send()
            .map_err(|err| format!("{err:?}"))?;
        let body = resp.body().map_err(|err| format!("{err:?}"))?;
        Ok(String::from_utf8_lossy(&body).into_owned())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn integration_test() {
        let url = std::env::var("TEST_URL").expect("TEST_URL must be set");
        let body = Component::get(url).unwrap();
        println!("body: {body}");
    }
}
```

We can build, run and publish the WASM Component into an OCI registry. See the [sync http template](https://github.com/obeli-sk/obelisk-templates/tree/main/activity-rs/http-simple-sync) for details on how to run the integration test.

If you need to use GraphQL, check out the [cynic](https://crates.io/crates/cynic) crate and the [graphql template](https://github.com/obeli-sk/obelisk-templates/tree/main/activity-rs/graphql-sync).

For more advanced use cases that require `async` support please check out the [wstd](https://crates.io/crates/wstd) crate and the [async http template](https://github.com/obeli-sk/obelisk-templates/tree/main/activity-rs/http-simple-async).
