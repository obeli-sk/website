+++
title = "Identifiers"
template = "docs.html"
weight = 20
+++

## Join Set ID
As discussed in {{ doc_link(title="Join Sets", path="concepts/workflows/join-sets.md") }}, there are three kinds of Join Sets:
* **One-off** - Join set is created implicitly when calling `sleep` {{ doc_link(title="support function", path="concepts/runtime-support.md") }} or calling the child import directly, without an {{ doc_link(title="extension function", path="concepts/extension-functions.md") }}. Example: `o:1`
* **Generated** - Created using `new_join_set_generated` {{ doc_link(title="support function", path="concepts/runtime-support.md") }}. Example: `g:1`
* **Named** - Created using `new_join_set_named` {{ doc_link(title="support function", path="concepts/runtime-support.md") }}. Example: `n:foo`

Each group consist of a prefix (`o`,`g`,`n`) and a suffix.
The suffix for first two groups is an auto-incremented integer.
Named accept arbitrary string set by the workflow. The charset is limited to: Alphanumeric characters (both upper and lower case), and these special characters: `_-/`

## Execution ID

The top-level Execution ID is an [ULID](https://github.com/ulid/spec) prefixed by `E_`, e.g. `E_01K42AJA8QHD7D3GTJAYMASFY`.
Every child execution consists of the parent ID, join set ID and an auto-incremented index.
This is called Derived Execution ID.
For example, submitting the first child execution to the abovementioned top-level Execution ID and Join Set ID `n:fetch` will become `E_01K42AJA8QHD7D3GTJAYMASFY.n:fetch_1`

## Delay ID
Delay ID is similar to the concept of Derived Execution ID with the only exception being that the prefix is `D_`. Exampmle: `D_01K42AJA8QHD7D3GTJAYMASFY.n:fetch_1` would be the first delay request submitted to the `fetch` Join Set.
