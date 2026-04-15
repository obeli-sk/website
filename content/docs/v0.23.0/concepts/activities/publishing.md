+++
title = "Publishing the WASM Component"
template = "docs.html"
weight = 90
+++

After a WASM file is built, it can be pushed into an OCI registry with this command:

```sh
obelisk client component push \
    target/wasm32-wasip2/release/myactivity.wasm \
    docker.io/youraccount/yourimage:tag
```

Obelisk will output the OCI location together with its SHA digest. This can be used instead of the
file location in `obelisk.toml`:

```diff
 [[activity_wasm]]
 name = "myactivity"
-location.path = "target/wasm32-wasip2/release/myactivity.wasm"
+location.oci = "docker.io/getobelisk/example_activity_fibo_template:2025-01-30@sha256:f67904dd6d30bc4ca9bf844d41b6c11b146ebf66adaf05a2088e2a5f7fa46d29"
```

## Note on caching of OCI artifacts

Although including the `sha256` part is not necessary, it improves reproducibility (tags can be
moved) and caching (unlike Docker, Obelisk will always check whether the tag points to an image that
was downloaded already).
