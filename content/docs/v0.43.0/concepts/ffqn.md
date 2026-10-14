+++
title = "Function Fully Qualified Name (FFQN)"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

Every function in Obelisk (an activity, a workflow, or a stub) has a globally unique name, the
function fully qualified name or FFQN. It is the address used everywhere: in `deployment.toml`, in
JavaScript imports, on the CLI, in the REST API, and in the execution log.

```
namespace:package/interface.function
```

For example `stargazers:github/account.account-info` consists of:

| Part                  | Example                     |
| --------------------- | --------------------------- |
| Namespace             | `stargazers`                |
| Package               | `github`                    |
| Interface             | `account`                   |
| Function              | `account-info`              |
| Package name          | `stargazers:github`         |
| Interface name (IFQN) | `stargazers:github/account` |

All parts use lowercase kebab-case. A package can optionally carry a version, which is written at
the end of the interface name: `stargazers:github/account@1.2.0.account-info`.

The naming comes from [WIT](https://component-model.bytecodealliance.org/design/wit.html) packages
and interfaces, see {{ doc_link(title="WIT Basics", path="concepts/wit-reference.md") }}.

## Using the FFQN

A JavaScript component declares its FFQN in `deployment.toml`:

```toml
[[activity_js]]
name = "account_info"
location = "activity/account-info.js"
ffqn = "stargazers:github/account.account-info"
params = [{ name = "login", type = "string" }]
return_type = "result<string, string>"
```

A workflow or webhook imports the function by its interface name. The function name is converted
from kebab-case to camelCase:

```javascript
import { accountInfo } from "stargazers:github/account";
```

The CLI and the REST API take the full FFQN:

```sh
obelisk execution submit --follow stargazers:github/account.account-info '["your-github-login"]'
```

Functions in the same interface share the part before the dot, so group related functions (for
example all GitHub activities) into one interface.

## Versioned packages

A package version follows the interface name, before the function name. It must be written
everywhere the FFQN or interface name appears:

```toml
[[activity_js]]
name = "account_info"
location = "activity/account-info.js"
ffqn = "stargazers:github/account@1.2.0.account-info"
params = [{ name = "login", type = "string" }]
return_type = "result<string, string>"
```

```javascript
import { accountInfo } from "stargazers:github/account@1.2.0";
```

```sh
obelisk execution submit --follow stargazers:github/account@1.2.0.account-info '["your-github-login"]'
```

Versions let two incompatible revisions of an interface be deployed side by side, for example
`stargazers:github/account@1.2.0` and `stargazers:github/account@2.0.0`, while running executions
keep calling the version they were written against.
