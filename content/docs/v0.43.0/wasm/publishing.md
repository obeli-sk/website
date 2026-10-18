+++
title = "Publishing Components"
template = "docs.html"
weight = 90
+++

After a WASM file is built, it can be pushed into an OCI registry. The command reads the component
entry from a deployment file, pushes the file it points to, and embeds the entry's metadata in the
image. JavaScript components can be published the same way, see
{{ doc_link(title="JS Components", path="js/js-components.md#oci-distribution") }}.

```sh
obelisk component push --deployment deployment.toml \
    myactivity oci://docker.io/youraccount/yourimage:tag
```

Obelisk prints the OCI location together with its SHA digest to stdout, e.g.
`oci://docker.io/youraccount/yourimage:tag@sha256:...`. This can be used instead of the file
location in `deployment.toml`:

```diff
 [[activity_wasm]]
 name = "myactivity"
-location = "target/wasm32-wasip2/release/myactivity.wasm"
+location = "oci://docker.io/getobelisk/example_activity_fibo_template:2025-01-30@sha256:f67904dd6d30bc4ca9bf844d41b6c11b146ebf66adaf05a2088e2a5f7fa46d29"
```

Components can also be referenced from GitHub releases using the `gh://` prefix. The format is
`gh://owner/repo@tag/asset.wasm`, where `tag` is a release tag (e.g. `v1.0.0`) or `latest`:

```toml
[[activity_wasm]]
name = "myactivity"
location = "gh://owner/repo@v1.0.0/asset.wasm"
```

## Note on caching of OCI artifacts

Although including the `sha256` part is not necessary, it improves reproducibility (tags can be
moved) and caching (unlike Docker, Obelisk will always check whether the tag points to an image that
was downloaded already).
