+++
title = "Function Fully Qualified Name (FFQN)"
template = "docs.html"
weight = 20  #  Lower weights appear first
+++

In the following sections, we describe the structure of a WIT package name, interface fully
qualified name (IFQN), and function fully qualified name (FFQN). We use the GitHub account activity
from
[stargazers](https://github.com/obeli-sk/demo-stargazers/blob/main/activity/github/wit-interface/stargazers_github/github.wit)
repository as an example.

# Package Name

As per the
[WIT Specification](https://component-model.bytecodealliance.org/design/wit.html#packages) each WIT
package consits of a namespace field and a package field separated by a colon. Optionally a WIT
package can contain a version.

Package names are specified at the top of a WIT file via a package declaration:

```
package stargazers:github;
```

or

```
package stargazers:github@1.2.0;
```

# Interface Fully Qualified Name (IFQN)

An interface fully qualified name is a unique identifier for an interface that includes the package
and the interface name separated by a slash. For example, if the interface name is `account`, the
IFQN is:

```
stargazers:github/account
```

or

```
stargazers:github/account@1.2.0
```

Note that the version appears at the end of IFQN although it is part of the package name.

To import an interface in a WIT file, use the IFQN:

```wit
package stargazers:workflow-impl;

world any {
    // Export workflow functions in the `workflow` interface.
    export stargazers:workflow/workflow;
    // Import the GitHub account activity.
    import stargazers:github/account;
    // Import the Obelisk workflow support functions.
    import obelisk:workflow/workflow-support@6.0.0;
}
```

# Function Fully Qualified Name (FFQN)

A function fully qualified name is a unique identifier for a function that includes the interface
path and the function name. The FFQN is used to reference functions in Obelisk workflows and the
execution log. The FFQN is a string that has the following format:

```
interface-fqn.function-name
```

For the following WIT file:

```wit
package stargazers:github;

interface account {
    account-info: func(login: string) -> result<string, string>;
}
```

the FFQN for the `account-info` function is

```
stargazers:github/account.account-info
```

To run the function using CLI, use

```
obelisk execution submit --follow stargazers:github/account.account-info '["your-github-login"]'
```
