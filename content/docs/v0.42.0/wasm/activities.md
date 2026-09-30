+++
title = "Rust Activities"
template = "docs.html"
weight = 24
+++

This page shows the WIT and Rust code behind a WASM activity. Read
{{ doc_link(title="Activities", path="concepts/activities/_index.md") }} first for the retry and
idempotency contract, which is the same in every language.

## Return types

A WASM activity declares its functions in WIT. Since an activity can fail when the invocation traps
(panics), times out, or runs out of retries, each function must be fallible. The return type must be
one of the following:

- `result`
- `result<T>` where `T` represents any successful variant like `string` or `list<u32>` or even a
  none type (`_`)
- `result<T, string>`
- `result<T, E>` where `E` is a `variant` type that contains `execution-failed` variant.

## A minimal activity

In this contrived example the activity does not communicate with an external system. Its purpose is
to show the WIT and Rust code needed for an activity. Install [Rust](https://rustup.rs/) and use the
[demo-tutorial Rust activity](https://github.com/obeli-sk/demo-tutorial/tree/main/rust/activity-sleepy)
as a complete project example. A project with the following structure can host this example:

```sh
.
├── Cargo.toml
├── rust-toolchain.toml
├── src
│   └── lib.rs
└── wit
    ├── deps
    │   └── template-fibo_activity
    │       └── fibo.wit
    └── impl.wit
```

`fibo.wit` is a WIT interface with a single function:

```wit
package template-fibo:activity;

interface fibo-activity-ifc {
    fibo: func(n: u8) -> result<u64, _>;
}
```

`impl.wit` exports this interface:

```wit
package any:any;

world any {
    export template-fibo:activity/fibo-activity-ifc;
}
```

Obelisk disregards the namespace, package name, and world name of the world file. It only concerns
itself with the exported interfaces. A `world` can be thought of as an ES module with no code, just
imports and exports.

The (naive) implementation in `lib.rs`:

```rust
impl Guest for Component {
    fn fibo(n: u8) -> Result<u64, ()> {
        if n <= 1 {
            Ok(n.into())
        } else {
            Ok(Self::fibo(n - 1).unwrap() + Self::fibo(n - 2).unwrap())
        }
    }
}
```

Add the activity to `deployment.toml`. WASM components carry their signatures, so there are no
`params` or `return_type` fields:

```toml
[[activity_wasm]]
name = "myactivity"
location = "target/wasm32-wasip2/release/myactivity.wasm"
```

Build the component and run Obelisk:

```sh
cargo build --release
obelisk server run --app-config app.toml --deployment deployment.toml
```

Execute the activity using its {{ doc_link(title="FFQN", path="concepts/ffqn.md") }}:

```sh
obelisk execution submit --follow \
    template-fibo:activity/fibo-activity-ifc.fibo [10]
```

For a complete build and deployment, follow
{{ doc_link(title="Getting Started (Rust / WASM)", path="wasm/getting-started.md") }}. For outbound
HTTP, see {{ doc_link(title="HTTP Client", path="wasm/http-client.md") }}.

## Logging

Import the {{ github(title="`obelisk:log/log@1.0.0`", path="wit/obelisk_log%401.0.0/log.wit") }}
interface in the world:

```wit
world any {
    export template-fibo:activity/fibo-activity-ifc;
    import obelisk:log/log@1.0.0;
}
```

```rust
use obelisk::log::log;

log::info("Processing request");
log::debug(&format!("Input: {input:?}"));
```

Each message is a `string`, so use `format!` for dynamic content. Output of `println!` and
`eprintln!` is captured as well, see
{{ doc_link(title="Logging", path="concepts/logging.md#stdout-stderr-forwarding") }}.

## Testing

Unit and integration testing is possible with Cargo's test harness. The
[stargazers demo](https://github.com/obeli-sk/demo-stargazers/tree/main/activity) repository
contains unit and integration tests for activities.
