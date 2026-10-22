+++
title = "Security Model"
template = "docs.html"
weight = 19
+++

Obelisk is designed to contain deployment code that the app admin does not fully trust, including
code produced by an LLM. A deployment author or coding agent can provide workflow, activity, and
webhook code, but that code does not automatically inherit the server process's credentials or
authority. The deployment requests capabilities in `deployment.toml`; the app admin sets the maximum
authority granted to the app in `app.toml`; and the platform admin sets listeners, resource limits,
and the exec gate in `server.toml`.

This is a defense-in-depth boundary, not a claim that arbitrary hostile native code is safe. WASM
components run inside the Wasmtime sandbox. Native exec activities deliberately cross that sandbox
and therefore require explicit, digest-bound approval from both admins. Experimental VM activities
run Linux programs through an explicitly selected Bochs, QEMU, or Firecracker backend and still
require app policy for secrets and network access. The native backends require host executables;
QEMU with KVM and Firecracker also require access to `/dev/kvm`.

The operating principle is least privilege: choose the least powerful component type that can do the
job, grant only the public configuration and network destinations it needs, and prefer secret
placeholders that cannot be read or redirected by component code.

## Platform, app, and deployment responsibilities

| Concern               | Deployment (`deployment.toml`)                                   | App admin (`app.toml`)                                                               | Platform admin (`server.toml`)                              |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Components and routes | Declares code, FFQNs, parameters, routes, and execution settings | Chooses whether to accept and activate the deployment                                | Bounds concurrency and memory with `[limits]`               |
| Public configuration  | Requests named environment variables and interpolation           | Declares required and optional non-secret names in `[public_env]`                    |                                                             |
| Secrets               | Refers only to logical secret names                              | Registers secrets in `[secrets]` and grants plaintext exposure with `exposed_to`     |                                                             |
| Outbound HTTP         | Requests destinations, methods, paths, and placeholder locations | Sets the maximum permitted HTTP policy in `[[outbound_http.allowed_host]]`           |                                                             |
| Native execution      | Declares exec code and requested plaintext secrets               | Approves the generated digest in `[allowed_exec_activities]` and each secret's grant | Enables exec through its own `allowed_exec_activities` gate |
| API access            | A webhook may call the API only through configured HTTP policy   | Decides whether an API token secret may be used by a component                       | Protects the API port with bearer tokens                    |

The effective permission is the intersection of the files. A deployment cannot widen the app policy,
and an app allowlist does not grant a capability that the deployment did not request. Exec
activities additionally need the platform gate. The running app policy is available through
`GET /v1/app-policy` and its canonical digest through `GET /v1/info`; each deployment records the
digest it was activated under.

## Choose the least powerful tool

Start with deterministic workflow code, which cannot read process environment variables or perform
arbitrary I/O. Move non-deterministic work into a narrowly scoped WASM or JavaScript activity with
only the required outbound hosts and methods. Use a webhook only when the application must accept
HTTP traffic, and treat every request as untrusted input.

Use an experimental VM activity only when the workload needs a Linux userspace or Nix-packaged
program. Use a native exec activity only when sandboxed component types cannot perform the task:
exec code runs as a host process outside the WASM sandbox. VM and exec capabilities should be small,
reviewed, and separated from workflows that do not need them.

## Environment variables and secrets

The server process environment is not a general-purpose deployment configuration channel.
Deployments can reference only non-secret variables declared in the app's `[public_env]`. Register
credentials under logical names in the app's `[secrets]`; do not add them to `public_env` or
ordinary component `env_vars`.

At startup, Obelisk reads each secret from the environment variable of the same name into memory and
removes the variable from the process environment before deployment code runs. Required secrets and
public variables that are missing prevent startup, so a misconfiguration is not discovered by a
running execution. Prefer opaque placeholders for outbound HTTP credentials. Component code can
place a placeholder in an approved request but cannot read its plaintext or use it in another
context. Obelisk substitutes the plaintext only while sending an authorized request, after both the
deployment and app policies match the destination, method, optional URL regex, secret name, and
replacement location. This limits the opportunity for generated or compromised code to exfiltrate a
credential.

Expose plaintext only when placeholder substitution cannot support the operation. WASM and
JavaScript activities and webhook endpoints can request registered secrets with `exposed_secrets`;
Obelisk injects them as environment variables when executing the activity or handling the request.
This supports operations such as validating an inbound webhook HMAC, where component code must read
the key.

Exec activities receive exposed secrets through stdin, and VM activities receive them as guest
environment variables. Code with plaintext access can attempt to copy the credential through any
capability it also holds. Every plaintext exposure therefore requires a `SecretExposureDigest` grant
under `[secrets.<name>.exposed_to]` in `app.toml`, bound to the component digest and its complete
requested secret set. Exec activities additionally require the same reviewed digest under the app's
`[allowed_exec_activities]`, and the platform's exec gate in `server.toml`.

Do not put credentials in `public_env` or ordinary component `env_vars`. Do not use
`exposed_secrets` merely to construct an outbound authorization header: outbound placeholder
substitution keeps the plaintext hidden from component code and should remain the default.

## Network boundaries

Component-originated HTTP is denied unless an entry matches in both `app.toml` and
`deployment.toml`, and activation rejects a deployment that requests destinations the app policy
does not cover. Keep the app policy narrower than or equal to the deployment request. Restrict
methods and paths with `request_url_regex`, or with `url_prefix` and `url_regex_suffix`, when a
component needs only part of an API. Secret replacement never occurs for an unapproved request.

The API port is authenticated. The external webhook server is not, because its endpoints are
intended to receive application traffic. Put public webhook listeners behind your own TLS,
authentication, rate-limiting, and request-size controls as appropriate. Treat any workflow or
activity scheduled by a webhook as input from an untrusted caller.

## Verification and deployment review

Verify every deployment against its app and server policy before activation:

```sh
obelisk server verify --skip-db --server-config server.toml --app-config app.toml --deployment deployment.toml
```

Verification reports missing public variables, secret registrations, execution grants, and HTTP
policy. `--fix` can scaffold missing names and grants in `app.toml`, but the app admin must review
the generated policy and provide real secret values. Generate digest-bound exec and secret-exposure
grants with:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Regenerate and review those grants whenever executable content or the complete exposed-secret set
changes. Use `obelisk generate app-config --trusted` only when the app admin and every deployment
author share one trust boundary; it intentionally permits unrestricted outbound HTTP. Exec
activities and registered secrets still require explicit configuration.

For concrete syntax, see {{ doc_link(title="Configuration", path="configuration/_index.md") }}. For
API credentials and exposed surfaces, see
{{ doc_link(title="Authentication", path="access/authentication.md") }}.
