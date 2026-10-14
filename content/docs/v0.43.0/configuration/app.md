+++
title = "App Configuration"
template = "docs.html"
weight = 2
+++

`app.toml` is owned by the app admin and passed with `--app-config`. It is the reviewed policy of
the app: its required inputs and the maximum privileges any deployment may use. A deployment can
request less than `app.toml` grants, never more. Reviewers get a high-level picture of what the app
can touch (which secrets exist and who reads them, which hosts it calls, which native executables it
runs) by auditing this file alone. When a coding agent writes the deployment, the diff of `app.toml`
is the part a human should review.

Missing required inputs fail at startup, so executions do not discover them at runtime. Environment
overrides such as `OBELISK__...` apply only to `server.toml`, not to `app.toml`. See
{{ doc_link(title="Configuration", path="configuration/_index.md") }} for how the three files
relate.

## App Name

```toml
app_name = "my-app"
```

The app name is required, either here or through `OBELISK_APP_NAME`. It selects the default SQLite
directory.

## Secret Registry

Map each logical secret name to the environment variable of the same name:

```toml
[secrets]
OPENAI_KEY = {}
GITHUB_TOKEN = { optional = true }

[secrets.DB_PASSWORD.exposed_to]
migration = "sha256:..."
```

At startup, Obelisk reads each value into memory and removes the variable from the process
environment before workers start. A required secret whose variable is unset prevents startup. An
`optional = true` secret may be absent; deployments must then reference it as optional, for example
`{ name = "GITHUB_TOKEN", optional = true }`, and an absent value is omitted from the component
environment or stdin.

Deployments request logical names in a component's `exposed_secrets` or an allowed host's `secrets`
field; they cannot interpolate registered secret values with `${...}`. The former gives component
code the plaintext value and requires an `exposed_to` grant generated with
`obelisk generate secret-config-digest`. The latter substitutes opaque placeholders only in an
authorized outbound request and does not require a plaintext-exposure grant.

`exposed_secrets` is supported by WASM and JavaScript activities and webhook endpoints, native exec
activities, and experimental VM activities. WASM, JavaScript, and VM components receive each value
under its logical name as an environment variable. Exec activities receive the values in the
`secrets` object on stdin.

## Public Deployment Environment

Deployments can only read process environment variables declared by the app admin. The declarations
apply both to `env_vars` forwarded into components and `${...}` interpolation anywhere in
`deployment.toml`:

```toml
[public_env]
API_BASE_URL = {}
REGION = {}
TRACE_ID = { optional = true }
```

Entries are required at startup unless marked `optional = true`. A deployment may reference an
optional variable only through an optional forwarded reference, such as
`{ key = "TRACE_ID", optional = true }`, or an interpolation fallback, such as `${TRACE_ID:-none}`.
Keep credentials in the secret registry instead. A variable registered as a secret cannot also be
read through the public environment table.

## App Outbound HTTP Policy

Component-originated HTTP must match an allowlist entry in both `app.toml` and the component's
deployment configuration. An empty app allowlist denies all component-originated HTTP.

```toml
[[outbound_http.allowed_host]]
pattern = "api.openai.com"
methods = ["POST"]
request_url_regex = "^POST https://api\\.openai\\.com/v1/"
secrets = ["OPENAI_KEY"]
replace_in = ["headers"]
```

The app and deployment entries use the same syntax. Both apply to every request: a request must
match both destinations and methods, and both `request_url_regex` values, which need not be
identical. A secret is substituted only when matching entries on both sides list the same secret and
replacement location. Activation rejects a deployment whose destinations or methods are not covered
by the app policy.

## App Exec Approval

Generate reviewable grants from the deployment configuration:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Approve reviewed executable and exposed-secret configurations by component name. The generated
secret-exposure digest binds the executable content and the complete exposed-secret set:

```toml
[allowed_exec_activities]
greet = "sha256:..."
```

Use an array of digests when overlapping deployment revisions must be authorized. If the activity
receives plaintext secrets, copy the generated `[secrets.<name>.exposed_to]` grants too. The
platform must also allow the digest through its
{{ doc_link(title="exec gate", path="configuration/server.md#platform-exec-gate") }}.

## App Policy Digest

Obelisk computes a canonical `app_config_digest` of the app policy. Deployments record the digest
used at activation, system events carry the current digest, and the running policy is available
through `GET /v1/app-config`.
