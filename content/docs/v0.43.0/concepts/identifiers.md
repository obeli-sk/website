+++
title = "Identifiers"
template = "docs.html"
weight = 20
+++

## Join Set ID

As discussed in {{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }}, there are
three kinds of Join Sets:

- **One-off** - Join set is created implicitly when calling `obelisk.sleep` or calling a child
  import directly. Example: `o:1`
- **Generated** - Created using `obelisk.createJoinSet()`. Example: `g:1`
- **Named** - Created using `obelisk.createJoinSet({ name: "foo" })`. Example: `n:foo`

Each group consist of a prefix (`o`,`g`,`n`) and a suffix. The suffix for first two groups is an
auto-incremented integer. Named accept arbitrary string set by the workflow. The charset is limited
to: Alphanumeric characters (both upper and lower case), and these special characters: `-/`

## Execution ID

The top-level Execution ID is an [ULID](https://github.com/ulid/spec) prefixed by `E_`, e.g.
`E_01K42AJA8QHD7D3GTJAYMASFY`. Every child execution consists of the parent ID, join set ID and an
auto-incremented index. This is called Derived Execution ID. For example, submitting the first child
execution to the abovementioned top-level Execution ID and Join Set ID `n:fetch` will become
`E_01K42AJA8QHD7D3GTJAYMASFY.n:fetch_1`

## Delay ID

Delay ID is similar to the concept of Derived Execution ID with the only exception being that the
prefix is `Delay_`. Example: `Delay_01K42AJA8QHD7D3GTJAYMASFY.n:fetch_1` would be the first delay
request submitted to the `fetch` Join Set.
