+++
title = "Security Model"
template = "docs.html"
weight = 19
+++

Obelisk is designed to contain deployment code that the server operator does not fully trust,
including code produced by an LLM. A deployment author or coding agent can provide workflow,
activity, and webhook code, but that code does not automatically inherit the server process's
credentials or authority. The deployment requests capabilities in `deployment.toml`; the operator
sets the maximum authority granted through a separate policy layer in `server.toml`.

This is a defense-in-depth boundary, not a claim that arbitrary hostile native code is safe. WASM
components run inside the Wasmtime sandbox. Native exec activities deliberately cross that sandbox
and therefore require explicit, digest-bound operator approval. Experimental VM activities isolate
Linux programs inside a container2wasm appliance, but still require operator policy for secrets and
network access.

The operating principle is least privilege: choose the least powerful component type that can do the
job, grant only the public configuration and network destinations it needs, and prefer secret
placeholders that cannot be read or redirected by component code.

## Operator and deployment responsibilities

| Concern               | Application deployment (`deployment.toml`)                                | Server operator (`server.toml`)                                                                   |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Components and routes | Declares code, FFQNs, parameters, routes, and execution settings          | Chooses whether to accept and activate the deployment                                             |
| Public configuration  | Requests named environment variables and interpolation                    | Allows non-secret names through `[public_env].allowed`                                            |
| Secrets               | Refers only to logical secret names                                       | Registers sources in `[secrets]` and controls plaintext exposure                                  |
| Outbound HTTP         | Requests destinations, methods, paths, and placeholder locations          | Sets the maximum permitted HTTP policy in `[[outbound_http.allowed_host]]`                        |
| Native execution      | Declares exec code and requested plaintext secrets                        | Approves the generated digest in `[allowed_exec_activities]` and each secret's `exposed_to` table |
| API access            | A webhook may call the API only through explicitly configured HTTP policy | Protects the API port with bearer tokens and decides which token may be injected                  |

The effective permission is the intersection of both files. A deployment cannot widen the operator's
policy, and an operator allowlist does not grant a capability that the deployment did not request.

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
Deployments can reference only non-secret variables named in `[public_env].allowed`. Register
credentials under logical names in `[secrets]`; do not add their source variables to `public_env` or
ordinary component `env_vars`.

At startup, Obelisk reads env-backed secrets into memory and removes their source variables from the
process environment before deployment code runs. Prefer opaque placeholders for outbound HTTP
credentials. Component code can place a placeholder in an approved request but cannot read its
plaintext or use it in another context. Obelisk substitutes the plaintext only while sending an
authorized request, after both the deployment and server policies match the destination, method,
optional URL regex, secret name, and replacement location. This limits the opportunity for generated
or compromised code to exfiltrate a credential.

Expose plaintext only when placeholder substitution cannot support the operation. Exec activities
receive exposed secrets through stdin, and VM activities receive them as guest environment
variables. Code with plaintext access can attempt to copy the credential through any capability it
also holds. Both component types therefore require a `SecretExposureDigest` grant under
`[secrets.<name>.exposed_to]`; exec activities additionally require the same reviewed digest under
`[allowed_exec_activities]`.

In 0.42.0-rc.2, registered-secret plaintext exposure is not available to JS or WASM webhook code.
That means an RC2 webhook cannot securely read a shared secret to validate an inbound HMAC
signature. Outbound placeholder substitution still works for webhook HTTP clients. Do not work
around the inbound limitation by placing the credential in `public_env` or ordinary `env_vars`.

## Network boundaries

Component-originated HTTP is denied unless an entry matches in both configuration files. Keep the
server policy narrower than or equal to the deployment request. Restrict methods and paths with
`request_url_regex` when a component needs only part of an API. Secret replacement never occurs for
an unapproved request.

The API port is authenticated. The external webhook server is not, because its endpoints are
intended to receive application traffic. Put public webhook listeners behind your own TLS,
authentication, rate-limiting, and request-size controls as appropriate. Treat any workflow or
activity scheduled by a webhook as input from an untrusted caller.

## Verification and deployment review

Verify every server/deployment pair before activation:

```sh
obelisk deployment verify --server-config server.toml --deployment deployment.toml
```

Verification reports missing public variables, secret registrations, execution grants, and HTTP
policy. `--fix` can scaffold missing names, but the operator must review the generated policy and
provide real secret sources. Generate digest-bound exec and secret-exposure grants with:

```sh
obelisk generate secret-config-digest --deployment deployment.toml
```

Regenerate and review those grants whenever executable content or the complete exposed-secret set
changes. Use `obelisk generate server-config --trusted` only when the operator and every deployment
author share one trust boundary; it intentionally permits unrestricted outbound HTTP. Exec
activities and registered secrets still require explicit configuration.

For concrete syntax, see {{ doc_link(title="Configuration", path="configuration.md") }}. For API
credentials and exposed surfaces, see
{{ doc_link(title="Authentication", path="authentication.md") }}.
