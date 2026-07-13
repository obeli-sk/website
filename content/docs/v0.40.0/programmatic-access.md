+++
title = "Programmatic access"
template = "docs.html"
weight = 0
+++

## OpenAPI Schema

The Web API has an auto-generated OpenAPI schema available at
{{ github(title="assets/schemas/openapi.json", path="assets/schemas/openapi.json") }}.

## gRPC, gRPC-Web

See {{ github(title="obelisk.proto", path="proto/obelisk.proto") }} schema for details.

## WebAPI

This document describes the REST-like API for managing components, deployments, and executions.

## General Information

### Base URL

All endpoints are prefixed with `/v1`.

### Authentication

The API port denies any request without a valid `Authorization: Bearer <token>` header, returning
HTTP `401` (gRPC `UNAUTHENTICATED`). The same requirement applies to the web API, gRPC, and
gRPC-web.

Present an accepted token on every request:

```sh
export OBELISK_API_TOKEN=<accepted-token>
export OBELISK_API_AUTH="Authorization: Bearer $OBELISK_API_TOKEN"
curl -H "$OBELISK_API_AUTH" http://127.0.0.1:5005/v1/components
```

An ephemeral startup token is printed to the console on every server start; persistent tokens are
configured as SHA-256 hashes. See {{ doc_link(title="Authentication", path="authentication.md") }}
for how to generate and configure tokens. The `--allow-unauthenticated-api` server flag restores the
old open behavior for development or recovery.

All `curl` examples below use `$OBELISK_API_AUTH` defined above.

## Content Negotiation

The API supports content negotiation via the `Accept` header.

- `application/json`: Returns structured JSON data.
- `text/plain`: Returns raw text or a human-readable representation.

Structured endpoints default to `application/json`. Endpoints that return raw identifiers or
file-like content default to `text/plain`: `/v1/execution-id`, `/v1/deployment-id`, WIT endpoints,
and `/v1/executions/{execution-id}/backtrace/source`.

Send an explicit `Accept` header to override an endpoint's default where both representations are
supported.

---

## Components

### `GET /v1/components`

Lists all registered components in the system.

**Query Parameters:**

| Parameter       | Type    | Description                                                                                                                      | Default            |
| :-------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------- | :----------------- |
| `type`          | String  | Filter by [Component Type](#component-type).                                                                                     | `None`             |
| `name`          | String  | Filter by component name.                                                                                                        | `None`             |
| `ffqn`          | String  | Filter by function FFQN or its prefix (any prefix of `ns:pkg/ifc.fn`).                                                           | `None`             |
| `digest`        | String  | Filter by component digest (`sha256` of the WASM file for WASM components; hash of JS source + configuration for JS components). | `None`             |
| `deployment_id` | String  | Filter by deployment ID.                                                                                                         | `None`             |
| `exports`       | Boolean | Include exported functions in the response.                                                                                      | `false`            |
| `imports`       | Boolean | Include imported functions in the response.                                                                                      | `false`            |
| `submittable`   | Boolean | If set, filters the `exports` list to only include functions that can be submitted.                                              | `None` (Shows all) |
| `extensions`    | Boolean | Include {{ doc_link(title="Extension Functions", path="concepts/extensions.md") }} exports (e.g. `-schedule` variant).           | `false`            |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/components?exports=true&imports=false" -H accept:application/json
```

```json
[
  {
    "component_id": {
      "component_type": "activity",
      "name": "test_programs_fibo_activity",
      "component_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0"
    },
    "exports": [
      {
        "ffqn": "testing:fibo/fibo.fibo",
        "parameter_types": [
          {
            "name": "n",
            "wit_type": "u8"
          }
        ],
        "return_type": "result<u64>",
        "submittable": true
      }
    ]
  },
  ...
]
```

Filtering by FFQN prefix with `text/plain` output:

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/components?exports=true&ffqn=testing:fibo/fibo.fibo" -H accept:text/plain
```

```
activity:test_programs_fibo_activity:sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0 sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0
 exports:
  testing:fibo/fibo.fibo: func(n: u8) -> result<u64>
```

---

### `GET /v1/components/{digest}/wit`

Retrieves the WebAssembly Interface Type (WIT) definition for a specific component.

**Path Parameters:**

- `digest`: Component digest (see `digest` in `GET /v1/components`).

**Query Parameters:**

| Parameter       | Type   | Description          | Default |
| :-------------- | :----- | :------------------- | :------ |
| `deployment_id` | String | Filter by deployment | `None`  |

**Returns:**

- `200 OK`: The WIT text.
- `204 No Content`: If the component exists but has no WIT definition.
- `404 Not Found`: Component not found.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" '127.1:5005/v1/components/sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0/wit'
```

```
package root:component;

world root {
  import wasi:io/error@0.2.3;
  ...
}
...
```

---

## Executions

### `GET /v1/execution-id`

Generates a new, globally unique execution id.

**Returns:**

- JSON: quoted string, e.g. `"E_01KDN7RB038RJHVZ5QS6MMWWZ4"`
- Text: raw id, e.g. `E_01KDN7RB038RJHVZ5QS6MMWWZ4`

---

### `GET /v1/executions`

Lists executions with support for filtering and pagination.

**Query Parameters:**

| Parameter             | Type    | Description                                                         | Default        |
| :-------------------- | :------ | :------------------------------------------------------------------ | :------------- |
| `ffqn_prefix`         | String  | Filter by Function Fully Qualified Name or its prefix.              | `None`         |
| `show_derived`        | Boolean | If `true`, includes child executions.                               | `false`        |
| `hide_finished`       | Boolean | Show only unfinished executions.                                    | `false`        |
| `execution_id_prefix` | String  | Filter by Execution ID or its prefix.                               | `None`         |
| `component_digest`    | String  | Filter by component digest (see `digest` in `GET /v1/components`).  | `None`         |
| `deployment_id`       | String  | Filter by deployment ID.                                            | `None`         |
| `cursor`              | String  | Pagination cursor. Can be an ISO 8601 Timestamp or an Execution ID. | `None`         |
| `length`              | Integer | Number of items to return.                                          | System Default |
| `direction`           | String  | `older` or `newer`.                                                 | `older`        |
| `including_cursor`    | Boolean | Include the cursor item in the result.                              | `false`        |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions?length=10&direction=older" -H accept:application/json
```

```json
[
  {
    "execution_id": "E_01KDJH6F811F2E0Q7AC4PDR9WE",
    "ffqn": "obelisk-flyio:workflow/workflow@1.0.0-beta.app-init",
    "pending_state": {
      "status": "finished",
      "version": 16,
      "finished_at": "2025-12-28T13:09:50.226429459Z",
      "result_kind": "ok"
    },
    "created_at": "2025-12-28T13:08:38.274234577Z",
    "first_scheduled_at": "2025-12-28T13:08:38.274234577Z",
    "component_digest": "sha256:b2ee4bdf32367e5d4eaf3643b95b9d7261996a5fe03582bff58cc59a884dc29b",
    "component_type": "workflow",
    "deployment_id": "Dep_01KN1NK9A6NMHP31TVJ875X599"
  },
  ...
]
```

---

### `POST /v1/executions`

Submits a new execution. The system will automatically generate an Execution ID.

**Query Parameters:**

- `follow`: (Boolean) If `true`, the request blocks and streams the result once finished.

**Request Body:**

- `ffqn`: (String) Function Fully Qualified Name.
- `params`: (Array) JSON array of parameters matching the function signature.
- `paused`: (Boolean, optional) If `true`, the execution is created in paused state and won't run
  until explicitly unpaused or advanced. Default: `false`.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" '127.1:5005/v1/executions' -H content-type:application/json -H accept:application/json -X POST -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```

```json
{ "ok": "E_01KDN8Y8ZZ4XYG2J0XJW5A8WE5" }
```

Getting the result with `follow` set to `true`:

```sh
curl -H "$OBELISK_API_AUTH" '127.1:5005/v1/executions?follow=true' -H content-type:application/json -X POST -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```

```json
{ "ok": 5 }
```

---

### `PUT /v1/executions/{execution-id}`

Submits an execution with a client-provided ID. This is idempotent; if the execution already exists
with the same parameters, it returns `200 OK`.

**Path Parameters:**

- `execution-id`: The unique ID for this execution.

**Query Parameters:**

- `follow`: (Boolean) Block and stream the result.

#### Example request

```sh
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -H accept:application/json -X PUT -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```

```json
{ "ok": "E_01KDN9422HAK2AHY9EXZA201TD" }
```

Getting the result with `follow` set to `true`:

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}?follow=true" -H content-type:application/json -H accept:application/json -X PUT -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```

```json
{ "ok": 5 }
```

---

### `GET /v1/executions/{execution-id}`

Retrieves the result of an execution.

**Query Parameters:**

- `follow`: (Boolean) If the execution is not finished, the connection stays open and streams the
  result as soon as it completes.

**Responses:**

- `200 OK`: Returns the [Execution Result](#execution-result).
- `425 Too Early`: Execution is still in progress (only returned if `follow=false`).

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}"
```

```json
{ "ok": 5 }
```

---

### `GET /v1/executions/{execution-id}/status`

Returns the current lifecycle status (e.g., `pending`, `finished`). Unlike the root GET endpoint,
this returns the internal state rather than the function return value.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/status" -H accept:application/json
```

```json
{
  "execution_id": "E_01KDQR2TGJR2XWEDM4CS6E4TF1",
  "ffqn": "testing:fibo/fibo.fibo",
  "pending_state": {
    "status": "finished",
    "version": 2,
    "finished_at": "2025-12-30T13:45:14.993810795Z",
    "result_kind": "ok"
  },
  "created_at": "2025-12-30T13:45:14.968745786Z",
  "first_scheduled_at": "2025-12-30T13:45:14.968745786Z",
  "component_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0",
  "component_type": "activity",
  "deployment_id": "Dep_01KN1NK9A6NMHP31TVJ875X599"
}
```

---

### `GET /v1/executions/{execution-id}/events`

Retrieves the history of events for an execution.

**Query Parameters:**

| Parameter              | Type    | Description                      | Default |
| :--------------------- | :------ | :------------------------------- | :------ |
| `version_from`         | Integer | Start from this event version.   | `0`     |
| `length`               | Integer | Max number of events.            | `20`    |
| `include_backtrace_id` | Boolean | Include debugging backtrace IDs. | `false` |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:application/json
```

```json
{
  "events": [
    {
      "created_at": "2025-12-29T14:46:33.030449088Z",
      "event": {
        "locked": {
          "component_id": {
            "component_type": "activity",
            "name": "test_programs_fibo_activity",
            "component_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0"
          },
          "executor_id": "Exr_01KDN7RB038RJHVZ5QS6MMWWZ4",
          "deployment_id": "Dep_01KN1NK9A6NMHP31TVJ875X599",
          "run_id": "Run_01KDN7RB038RJHVZ5QS6MMWWZ5",
          "lock_expires_at": "2025-12-29T14:46:34.030449088Z",
          "retry_config": {
            "max_retries": 5,
            "retry_exp_backoff": { "secs": 0, "nanos": 100000000 }
          }
        }
      },
      "version": 1
    },
    {
      "created_at": "2025-12-29T14:46:33.082449088Z",
      "event": {
        "finished": {
          "retval": { "ok": 5 },
          "http_client_traces": []
        }
      },
      "version": 2
    }
  ],
  "max_version": 2
}
```

---

### `GET /v1/executions/{execution-id}/responses`

Retrieves responses associated with an execution (used for long-running interactions).

**Query Parameters:**

| Parameter          | Type    | Description                         | Default |
| :----------------- | :------ | :---------------------------------- | :------ |
| `cursor_from`      | Integer | Start from this cursor index.       | `0`     |
| `length`           | Integer | Max number of responses.            | `20`    |
| `including_cursor` | Boolean | Include the event at `cursor_from`. | `false` |

#### Example request

```sh
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}"?follow=true -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:fibo-workflow/workflow.fiboa", "params": [5,5] }'

curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/responses" -H accept:application/json
```

```json
{
  "responses": [
    {
      "event": {
        "created_at": "2025-12-29T14:58:17.290976499Z",
        "event": {
          "join_set_id": "o:1-fibo",
          "event": {
            "type": "ChildExecutionFinished",
            "child_execution_id": "E_01KDN9VJ2TJ396ZARNEMRBNBHP.o:1-fibo_1",
            "finished_version": 2,
            "result": {
              "ok": 5
            }
          }
        }
      },
      "cursor": 67
    }
  ],
  "max_cursor": 67
}
```

---

### `PUT /v1/executions/{execution-id}/stub`

Manually provides a return value for a stubbed execution. The `execution-id` here is a derived ID
(child execution).

**Request Body (JSON):** The body must match the return type of the stubbed function.

```json
{
  "ok": "your-return-value"
}
```

or

```json
{
  "err": "your-error-value"
}
```

#### Example request

```sh
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
# Submit a workflow that submits a stub activity
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -H accept:application/json -X PUT -d \
'{ "ffqn":"testing:stub-workflow/workflow.submit-await", "params": ["test"] }'
# Create the expected child execution id based on code or execution log
CHILD_EXECUTION_ID="${EXECUTION_ID}.o:1-foo_1"
# Optionally verify the id:
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:text/plain | grep $CHILD_EXECUTION_ID
# returns a row containing: HistoryEvent(JoinSetRequest(ChildExecutionRequest(E_01KDNB650P06H69YR1FD973MA0.o:1-foo_1, testing:stub-activity/activity.foo, params: ["test"])))

curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${CHILD_EXECUTION_ID}/stub" -H content-type:application/json -X PUT -d \
'{"ok": "some return value"}'
```

```json
{ "ok": "stubbed" }
```

---

### `PUT /v1/executions/{execution-id}/upgrade`

Upgrade an execution to run with a different WASM component. Upgrading only makes sense when the
executor is configured to lock executions by its WASM's sha256 digest:

```toml
exec.locking_strategy = "by_component_digest"
```

**Request Body (JSON):**

```json
{
  "old": "sha256:old-sha",
  "new": "sha256:new-sha"
}
```

#### Example request

```sh
obelisk server run --deployment obelisk.toml # start with components downloaded from Docker Hub.
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
# Submit a workflow
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep-workflow/workflow.sleep-host-activity", "params": [{"seconds":10}] }'

# Shutdown the server before the execution finishes.
obelisk server run --deployment obelisk-local.toml # Start with components built locally.
# Find the old and new sha256 digest
OLD=$(curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/status"  -H accept:application/json | jq .component_digest)
NEW=$(curl -H "$OBELISK_API_AUTH" '127.1:5005/v1/components?name=test_programs_sleep_workflow' -H 'accept:application/json' | jq .[0].component_id.input_digest)

curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/upgrade" -H content-type:application/json -X PUT -d \
'{"old":'$OLD', "new": '$NEW' }'
```

```json
{ "ok": "upgraded" }
```

---

### `GET /v1/executions/{execution-id}/logs`

Retrieves stored logs and output streams for an execution. Logs are stored in the database when
`forward_stdout`/`forward_stderr` is set to `"db"` (the default) or when using the `obelisk:log`
API.

**Query Parameters:**

| Parameter          | Type                | Description                                      | Default        |
| :----------------- | :------------------ | :----------------------------------------------- | :------------- |
| `show_logs`        | Boolean             | Include structured log entries                   | `true`         |
| `show_streams`     | Boolean             | Include stdout/stderr stream entries             | `true`         |
| `show_derived`     | Boolean             | Include logs from all derived (child) executions | `false`        |
| `cursor`           | DateTime (ISO 8601) | Pagination cursor                                | start of time  |
| `length`           | Integer             | Max entries to return                            | system default |
| `including_cursor` | Boolean             | Include the entry at `cursor`                    | `false`        |
| `direction`        | String              | `older` or `newer`                               | `older`        |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/logs" -H accept:application/json
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/logs?show_derived=true" -H accept:application/json
```

---

### `GET /v1/executions/{execution-id}/backtrace`

Returns the WASM backtrace for a trapped or failed execution, including call frames and optional
source symbol information.

**Query Parameters:**

| Parameter | Type   | Description                                                           | Default  |
| :-------- | :----- | :-------------------------------------------------------------------- | :------- |
| `version` | String | Which backtrace to retrieve: `"first"`, `"last"`, or a version number | `"last"` |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/backtrace" -H accept:application/json
```

```json
{
  "execution_id": "E_01KDQR2TGJR2XWEDM4CS6E4TF1",
  "component_id": "workflow:my_workflow:sha256:abc123...",
  "version_min_including": 1,
  "version_max_excluding": 3,
  "wasm_backtrace": {
    "frames": [
      {
        "module": "my_workflow",
        "func_name": "panic_handler",
        "symbols": [
          { "func_name": "my_fn", "file": "src/lib.rs", "line": 42, "col": 5 }
        ]
      }
    ]
  }
}
```

---

### `GET /v1/executions/{execution-id}/backtrace/source`

Retrieves the source file content referenced by a backtrace frame. Requires the WASM component to
have been compiled with embedded DWARF debug info.

**Query Parameters:**

| Parameter | Type   | Description                                                              | Default  |
| :-------- | :----- | :----------------------------------------------------------------------- | :------- |
| `file`    | String | File path to retrieve (suffix matching supported)                        | required |
| `version` | String | Backtrace version for component lookup: `"first"`, `"last"`, or a number | `"last"` |

**Responses:**

- `200 OK`: Source file content as a string.
- `404 Not Found`: Source file not found in the component.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/backtrace/source?file=src/lib.rs"
```

---

### `PUT /v1/executions/{execution-id}/pause`

Pauses an active execution. The execution will not be scheduled for further processing until it is
unpaused. Running activities cannot be paused while locked; activity pausing applies between runs.
Cancel a running activity if it must be interrupted immediately.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/pause" -X PUT -H accept:application/json
```

```json
{ "ok": "paused" }
```

---

### `PUT /v1/executions/{execution-id}/unpause`

Resumes a previously paused execution.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/unpause" -X PUT -H accept:application/json
```

```json
{ "ok": "unpaused" }
```

---

### `PUT /v1/executions/{execution-id}/replay`

Replay a workflow execution from its execution log. The response indicates what would happen next
without actually applying any writes:

- `advanceable` — replay produced captured writes that can be forwarded to the advance endpoint
- `finished` — execution would complete; includes the return value
- `blocked` — execution is waiting for an external event (e.g. a stub response or delay)
- `replay_failed` — non-determinism detected or other replay error

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/replay" -X PUT -H accept:application/json
```

```json
{ "type": "finished", "retval": { "ok": 5 } }
```

---

### `PUT /v1/executions/{execution-id}/advance`

Advance a paused execution by applying captured writes from a previous replay. The typical workflow
is: create a paused execution, call `replay` to preview what would happen, then `advance` to apply
those writes. This enables step-through debugging — you can inspect each step, trim events, or mark
child executions as paused before they execute.

**Request Body (JSON):**

```json
{
  "captured_writes": [...]
}
```

The `captured_writes` array should contain the writes returned by a previous `replay` call.

**Responses:**

- `200 OK`: Returns the advance outcome:
  - `{ "type": "finished", "value": { "ok": ... } }` — execution completed
  - `{ "type": "in_progress", "pending_state": {...} }` — execution advanced but not yet finished
- `404 Not Found`: Execution not found.
- `422 Unprocessable Entity`: Advance failed. Error types:
  - `no_writes` — no captured writes provided
  - `replay_error` — replay during advance encountered an error
  - `version_mismatch` — the execution was modified since the replay
  - `replay_mismatch` — the replayed state doesn't match the captured writes

#### Example request

```sh
# 1. Create a paused execution
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions" -H content-type:application/json -X POST -d \
'{ "ffqn":"my:app/workflow.run", "params": [], "paused": true }'

# 2. Replay to preview the next step
REPLAY=$(curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/replay" -X PUT -H accept:application/json)

# 3. Advance to apply the captured writes
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/advance" -X PUT \
  -H content-type:application/json -H accept:application/json \
  -d "{\"captured_writes\": $(echo $REPLAY | jq .captured_writes)}"
```

---

## Delays

### `PUT /v1/delays/{delay-id}/pause`

Pauses a pending delay request, preventing it from firing until unpaused.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/delays/${DELAY_ID}/pause" -X PUT -H accept:application/json
```

---

### `PUT /v1/delays/{delay-id}/unpause`

Resumes a previously paused delay request.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/delays/${DELAY_ID}/unpause" -X PUT -H accept:application/json
```

---

## Functions

### `GET /v1/functions`

Lists all available functions across all components.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/functions" -H accept:application/json
```

---

### `GET /v1/functions/wit`

Retrieves the WIT definition for a specific function.

**Query Parameters:**

| Parameter | Type   | Description                   |
| :-------- | :----- | :---------------------------- |
| `ffqn`    | String | Function Fully Qualified Name |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/functions/wit?ffqn=testing:fibo/fibo.fibo"
```

---

## Deployments

### `GET /v1/deployment-id`

Retrieves the current deployment ID.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployment-id" -H accept:application/json
```

---

### `GET /v1/deployments`

Lists deployment states.

**Query Parameters:**

| Parameter                   | Type    | Description                                     | Default        |
| :-------------------------- | :------ | :---------------------------------------------- | :------------- |
| `cursor_from`               | String  | Deployment ID cursor for pagination             | `None`         |
| `length`                    | Integer | Number of items to return                       | System Default |
| `including_cursor`          | Boolean | Include the cursor item in the result           | `false`        |
| `include_derived`           | Boolean | Include child executions in execution summaries | `false`        |
| `include_component_summary` | Boolean | Include component counts by manifest section    | `false`        |

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments" -H accept:application/json
```

```json
[
  {
    "deployment_id": "Dep_01KN1NK9A6NMHP31TVJ875X599",
    "description": "production",
    "digest": "sha256:...",
    "status": "active",
    "created_at": "2026-03-31T10:04:01.736281506Z",
    "last_active_at": "2026-03-31T10:04:01.736491095Z",
    "locked": 0,
    "pending": 0,
    "scheduled": 0,
    "blocked": 0,
    "paused": 0,
    "cancelling": 0,
    "finished_ok": 6,
    "finished_error": 0,
    "finished_execution_failure": 0,
    "component_summary": null
  }
]
```

---

### `GET /v1/deployments/{deployment-id}`

Returns the full details of a specific deployment, including its stored `deployment.toml`.

**Path Parameters:**

- `deployment-id`: The deployment ID.

**Responses:**

- `200 OK`: Returns a `DeploymentRecord` object.
- `404 Not Found`: Deployment not found.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599" -H accept:application/json
```

```json
{
  "deployment_id": "Dep_01KN1NK9A6NMHP31TVJ875X599",
  "description": "production",
  "digest": "sha256:...",
  "status": "active",
  "created_at": "2026-03-31T10:04:01.736281506Z",
  "last_active_at": "2026-03-31T10:04:01.736491095Z",
  "deployment_toml": "..."
}
```

---

### `POST /v1/deployments`

Submits a new deployment package and stores it in the database. Returns the new deployment ID. The
deployment is not yet activated; use `PUT /v1/deployments/{id}/switch` to activate it.

**Request Body (JSON):**

| Field                              | Type    | Description                                                                                                                                                     |
| :--------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment_toml`                  | String  | Verbatim deployment manifest                                                                                                                                    |
| `description`                      | String  | Optional human-readable description                                                                                                                             |
| `allow_unavailable_runtime_config` | Boolean | Tolerate runtime requirements unavailable on this server, such as missing environment variables / secrets or server capabilities like exec activities (`false`) |
| `deployment_id`                    | String  | Optional client-supplied deployment ID for idempotent submission                                                                                                |

The field was renamed from `allow_missing_runtime_config`; the old name is still accepted as an
alias so 0.39.x HTTP clients keep working for now.

`POST /v1/deployments` also accepts `multipart/form-data`. Use text fields for `deployment_toml`,
`description`, `allow_unavailable_runtime_config`, and `deployment_id`. Every other part is treated
as a deployment-owned file blob; its `filename` is the deployment-relative path and the form-field
name is either the claimed `sha256:...` digest or `file`.

**Responses:**

- `200 OK`: Deployment submitted; returns the new deployment ID string.
- `400 Bad Request`: Invalid configuration.
- `409 Conflict`: Incomplete or invalid package. The JSON body lists missing digest fields, missing
  files, unexpected files, digest mismatches, and oversized files. No deployment is stored.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments" -H content-type:application/json -X POST -d \
  "$(jq -Rs '{deployment_toml: ., description: "production"}' deployment.toml)"
```

Multipart package with a deployment-owned script:

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments" -X POST \
  -F deployment_toml=@deployment.toml \
  -F 'file=@scripts/run.sh;filename=scripts/run.sh'
```

---

### `PUT /v1/deployments/{deployment-id}/switch`

Activates a previously submitted deployment. Supports hot-redeploy (apply without a server restart)
or enqueue (activate on next restart).

**Path Parameters:**

- `deployment-id`: The deployment ID to switch to.

**Request Body (JSON):**

| Field                              | Type    | Description                                                                                                                                                                            |
| :--------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hot_redeploy`                     | Boolean | If `true`, apply immediately without restarting (default: `false`)                                                                                                                     |
| `allow_unavailable_runtime_config` | Boolean | Tolerate runtime requirements unavailable on this server before switching (accepts the former `allow_missing_runtime_config` as an alias). Hot redeploy always requires strict config. |

**Responses:**

- `200 OK`: Returns `"switched"` (hot-redeployed) or `"restart_required"` (enqueued for next
  restart).
- `404 Not Found`: Deployment not found.
- `400 Bad Request`: Switch or validation failed.

#### Example request

```sh
# Enqueue a deployment (activates on next restart)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599/switch" \
  -H content-type:application/json -X PUT -d '{"hot_redeploy": false}'

# Hot-redeploy immediately
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599/switch" \
  -H content-type:application/json -X PUT -d '{"hot_redeploy": true}'
```

```json
"switched"
```

---

## Cancellation requests

### `PUT /v1/executions/{execution-id}/cancel`

Cancels an active activity or cancellable workflow execution. Workflow cancellation is accepted only
when the workflow's exported function name ends in `-cancellable`.

Cancelling a workflow requests structured-concurrency teardown: Obelisk stops advancing that
workflow, closes its join sets from the persisted execution log, cancels activities, delays, and
cancellable workflow children, and waits for any non-cancellable workflow children. This is useful
for operator cleanup of workflows stuck on long-lived stubs or stranded by a failed upgrade. See
{{ doc_link(title="Cancellation", path="concepts/structured-concurrency.md#cancellation") }}.

#### Example request

```sh
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep/sleep.sleep", "params": [{"seconds":100}] }'

curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/cancel" -X PUT -H accept:application/json
```

```json
{ "ok": "cancelled" }
```

---

### `PUT /v1/delays/{delay-id}/cancel`

Cancels a request for
{{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}.

**Path Parameters:**

- `delay-id`: The unique ID of the delay.

#### Example request

```sh
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep-workflow/workflow.sleep-host-activity", "params": [{"seconds":100}] }'
# Create the expected delay id based on code or execution log
DELAY_ID="Delay_${EXECUTION_ID#E_}.o:1-sleep_1"
# Optionally verify the id:
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:text/plain | grep $DELAY_ID
# returns a row containing: HistoryEvent(JoinSetRequest(DelayRequest(Delay_01KDNCA38TYGKHF7GKH3XQJH02.o:1-sleep_1, expires_at: `2025-12-29 15:43:39.751469133 UTC`, schedule_at: `In(150s)`)))

curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/delays/${DELAY_ID}/cancel" -X PUT -H accept:application/json
```

```json
{ "ok": "cancelled" }
```

---

## Data Reference

### Component Type

When filtering components or reading the `component_type` field in responses, use these values:

- `activity`
- `activity_stub`
- `workflow`
- `webhook_endpoint`
- `cron`

### Execution Result

The result object returned when an execution finishes (from `GET /v1/executions/{id}`):

- `{ "ok": ... }`: Function succeeded; contains the return value (or `null` for no-value results).
- `{ "err": ... }`: Function returned an error variant.
- `{ "execution_failure": { "kind": "...", "reason": "..." } }`: Execution failed (trap, timeout,
  etc.).

The `result_kind` field in status/list responses summarises the outcome:

- `"ok"` — function returned successfully.
- `{ "err": { "execution_failure": "<kind>" } }` — execution failed (same `kind` values as
  `execution_failure.kind`).

#### Execution Failure Kind

One of:

- `timed_out`: Applicable to activities only, last attempt timed out.
- `nondeterminism_detected`: Applicable to workflows.
- `out_of_fuel`: Applicable to WASM components.
- `cancelled`: Applicable to activities and cancellable workflows.
- `paused`: Execution was paused.
- `uncategorized`: Uncategorized, e.g. WASM trap.

### Errors

Errors are returned with appropriate HTTP status codes:

- **400 Bad Request**:
  - Invalid parameters (`ParamsInvalid`).
  - Attempting to submit a child ID as a top-level execution (`ExecutionIdMustBeTopLevel`).
- **404 Not Found**:
  - Component, Function (FFQN), or Execution not found.
- **409 Conflict**:
  - Execution already finished (when trying to cancel).
  - Execution exists with different parameters (when submitting/idempotency check fails).
- **425 Too Early**:
  - Execution result requested but not yet finished (when `follow=false`).
- **503 Service Unavailable**:
  - Transient database errors or connection issues.
- **500 Internal Server Error**:
  - Non-retriable database errors or other generic failures.

**Response Format:**

- **JSON**: `{ "err": "Description of error" }`
- **Text**: `Description of error`
