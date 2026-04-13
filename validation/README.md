# Documentation Validation

Small Obelisk deployments that verify claims made in the docs.
Each subdirectory is a self-contained deployment. Run `./test.sh` inside it.

## Prerequisites

`obelisk` must be on `$PATH`.

## Subdirectories

- **`return-types/`** — validates `result`, `result<string>`, `result<string, string>` behaviour:
  `return`, `throw null`, `throw "str"`, `throw new Error(...)`.

- **`json-encoding/`** — validates the JSON ↔ WIT type mapping: primitives, `option`, `list`,
  and the kebab-case → snake_case parameter name conversion.

- **`v0.37-announcement/`** — validates the JS example from the 0.37 announcement: a webhook
  that accepts `POST /weather`, schedules a parallel city-temperatures workflow, and returns
  the execution ID. Requires outbound network access (`wttr.in`).
