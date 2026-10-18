+++
title = "API Access"
template = "docs.html"
weight = 2
+++

## OpenAPI Schema

The Web API has an auto-generated OpenAPI schema available at
{{ github(title="assets/schemas/openapi.json", path="assets/schemas/openapi.json", version="v0.43.0-rc.6") }}.

## gRPC, gRPC-Web

See {{ github(title="obelisk.proto", path="proto/obelisk.proto", version="v0.43.0-rc.6") }} schema
for details.

> **Deprecated:** gRPC and gRPC-web are deprecated in 0.42. The web API below covers the same
> feature set; new clients should use `/v1`.

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
configured as SHA-256 hashes. See
{{ doc_link(title="Authentication", path="access/authentication.md") }} for how to generate and
configure tokens. The `--no-auth` server flag accepts unauthenticated requests on the API port, for
development or recovery.

All `curl` examples below use `$OBELISK_API_AUTH` defined above.

## Content Negotiation

Structured resources and actions use `application/json`; their former `text/plain` representations
were removed in 0.43. WIT, source files, IDs, scalar app-config digests, execution-log streams, and
SSE retain their supported representations. Send an explicit `Accept` header when needed.

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
| `extensions`    | Boolean | Include {{ doc_link(title="Extension Functions", path="wasm/extensions.md") }} exports (e.g. `-schedule` variant).               | `false`            |

#### Export extension classification

With `exports=true&extensions=true`, each generated export has an `extension` string. Ordinary
exports omit that field. The values are:

| Export suffix       | `extension` value  |
| ------------------- | ------------------ |
| `-submit`           | `submit`           |
| `-await-next`       | `await_next`       |
| `-get`              | `get`              |
| `-schedule`         | `schedule`         |
| `-schedule-with-id` | `schedule_with_id` |
| `-stub`             | `stub`             |

`-schedule-with-id` is classified as `schedule_with_id`, not `schedule`. Clients decoding the enum
must accept this new value in 0.43. These values were checked against the 0.43.0-rc.1 binary with
workflow and stub exports through this endpoint.

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
    "files": [
      {
        "file": {
          "path": "target/wasm-cache/test_programs_fibo_activity.wasm",
          "digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0",
          "size": 331911
        },
        "role": "wasm_component"
      }
    ],
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

Filter by FFQN prefix using JSON:

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/components?exports=true&ffqn=testing:fibo/fibo.fibo" -H accept:application/json
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

### `GET /v1/components/{digest}/source`

Retrieves a source file of a component, such as a JavaScript module or a file referenced by
backtrace source mappings.

**Query Parameters:**

| Parameter | Type   | Description                                                  | Default  |
| :-------- | :----- | :----------------------------------------------------------- | :------- |
| `file`    | String | File path to retrieve. Suffix matching is used if not exact. | Required |

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
| `package`             | String  | Exact package scope, for example `ns:pkg`.                          | `None`         |
| `interface`           | String  | Exact interface scope, for example `ns:pkg/ifc`.                    | `None`         |
| `function`            | String  | Exact Function Fully Qualified Name, for example `ns:pkg/ifc.fn`.   | `None`         |
| `state`               | String  | Match any of the given states. Repeat the parameter for several.    | `None`         |
| `show_derived`        | Boolean | If `true`, includes child executions.                               | `false`        |
| `hide_finished`       | Boolean | Show only unfinished executions.                                    | `false`        |
| `execution_id_prefix` | String  | Filter by Execution ID or its prefix.                               | `None`         |
| `component_digest`    | String  | Filter by component digest (see `digest` in `GET /v1/components`).  | `None`         |
| `deployment_id`       | String  | Filter by deployment ID.                                            | `None`         |
| `cursor`              | String  | Pagination cursor. Can be an ISO 8601 Timestamp or an Execution ID. | `None`         |
| `length`              | Integer | Number of items to return.                                          | System Default |
| `direction`           | String  | `older` or `newer`.                                                 | `older`        |
| `including_cursor`    | Boolean | Include the cursor item in the result.                              | `false`        |

`state` accepts `locked`, `pending`, `scheduled`, `blocked`, `paused`, `cancelling`, `finished`,
`finished_ok`, `finished_error`, and `finished_execution_failure`, e.g.
`?state=pending&state=blocked`.

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

- `follow`: (Boolean) If `true`, the response is a [server-sent event stream](#following-results)
  that delivers the result once the execution finishes.

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

```
event: result
id: 1
data: {"ok":5}
```

---

### `PUT /v1/executions/{execution-id}`

Submits an execution with a client-provided ID. This is idempotent; if the execution already exists
with the same parameters, it returns `200 OK`.

**Path Parameters:**

- `execution-id`: The unique ID for this execution.

**Query Parameters:**

- `follow`: (Boolean) Return a [server-sent event stream](#following-results) that delivers the
  result once the execution finishes.

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
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}?follow=true" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```

```
event: result
id: 1
data: {"ok":5}
```

---

### `GET /v1/executions/{execution-id}`

Retrieves the result of an execution.

**Query Parameters:**

- `follow`: (Boolean) Return a [server-sent event stream](#following-results) that delivers the
  result as soon as the execution completes.

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

#### Following results

With `follow=true`, the submit and result endpoints respond with `Content-Type: text/event-stream`.
The stream carries a single `result` event with ID `1` whose data is the
[Execution Result](#execution-result) JSON, then closes. While waiting, the server sends periodic
comment lines as heartbeats. A client that reconnects with `Last-Event-ID: 1` receives an empty
stream, because the result was already delivered.

---

### `GET /v1/executions/{execution-id}/status`

Returns the current lifecycle status (e.g., `pending`, `finished`). Unlike the root GET endpoint,
this returns the internal state rather than the function return value.

**Query Parameters:**

- `follow`: (Boolean) Return a server-sent event stream. Each change emits a `status` event with the
  status JSON below; the stream closes once the execution finishes. Event IDs are content digests,
  so a reconnecting client can send `Last-Event-ID` to skip a status it already received.
- `send_finished_status`: (Boolean) With `follow`, emit a final `finished_status` event carrying
  `created_at`, `scheduled_at`, `finished_at`, and the result `value`.

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

### `GET /v1/executions/{execution-id}/events-and-responses`

Returns a consistent snapshot of an execution's events and join-set responses in one request. It
uses `version_from`, `events_length`, and `include_backtrace_id` for events, plus
`responses_cursor_from`, `responses_length`, and `responses_including_cursor` for responses. These
names differ from the separate events and responses endpoints.

---

### `GET /v1/executions/{execution-id}/events`

Retrieves the history of events for an execution.

**Query Parameters:**

| Parameter              | Type    | Description                      | Default |
| :--------------------- | :------ | :------------------------------- | :------ |
| `version`              | Integer | Event version cursor.            | `0`     |
| `length`               | Integer | Max number of events.            | `20`    |
| `direction`            | String  | `older` or `newer`.              | `newer` |
| `including_cursor`     | Boolean | Include the cursor event.        | `false` |
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

### `POST /v1/executions/events/batch`

Reads the `Created` event and optional `Finished` event for each requested execution in one database
transaction. The response preserves the order of `execution_ids`. Send at least one ID; an unknown
ID returns `404` for the whole request.

```sh
curl -H "$OBELISK_API_AUTH" -H 'content-type: application/json' \
  '127.1:5005/v1/executions/events/batch' -d \
  '{"execution_ids":["E_01KDN9VJ2TJ396ZARNEMRBNBHP"]}'
```

```json
[
  {
    "execution_id": "E_01KDN9VJ2TJ396ZARNEMRBNBHP",
    "created": {
      "created_at": "...",
      "version": 0,
      "event": { "created": { "ffqn": "...", "params": [] } }
    },
    "finished": null
  }
]
```

The event bodies above show only selected fields. `finished` is `null` while the execution is in
progress. When it finishes, the field contains its `Finished` event, including the return value.

---

### `GET /v1/executions/{execution-id}/responses`

Retrieves responses associated with an execution (used for long-running interactions).

**Query Parameters:**

| Parameter          | Type    | Description                              | Default |
| :----------------- | :------ | :--------------------------------------- | :------ |
| `cursor`           | Integer | Response cursor for pagination.          | `0`     |
| `length`           | Integer | Max number of responses.                 | `20`    |
| `including_cursor` | Boolean | Include the response at `cursor`.        | `false` |
| `join_set`         | String  | Filter to responses of this join-set ID. | all     |
| `direction`        | String  | `older` or `newer`.                      | `newer` |

`join_set` takes a canonical join-set ID as shown in `join_set_id`, for example `o:1-fibo` or
`n:session-events` (URL-encode the colon as `%3A` if needed). A bare join-set name is rejected with
`400 Bad Request`.

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
            "type": "child_execution_finished",
            "child_execution_id": "E_01KDN9VJ2TJ396ZARNEMRBNBHP.o:1-fibo_1",
            "finished_version": 2,
            "result": {
              "ok": {
                "type": "u64",
                "value": 5
              }
            }
          }
        }
      },
      "cursor": 1
    }
  ],
  "max_cursor": 5,
  "scan_cursor": 1
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
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:application/json | grep $CHILD_EXECUTION_ID
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
obelisk server run -a app-testing-wasm.toml --deployment deployment-testing-wasm-oci.toml # components from Docker Hub
EXECUTION_ID=$(curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/execution-id)
# Submit a workflow
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep-workflow/workflow.sleep-host-activity", "params": [{"seconds":10}] }'

# Shutdown the server before the execution finishes.
obelisk server run -a app-testing-wasm.toml --deployment deployment-testing-wasm-local.toml # components built locally
# Find the old and new sha256 digest
OLD=$(curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/status"  -H accept:application/json | jq .component_digest)
NEW=$(curl -H "$OBELISK_API_AUTH" '127.1:5005/v1/components?name=test_programs_sleep_workflow' -H 'accept:application/json' | jq .[0].component_id.component_digest)

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

| Parameter          | Type     | Description                                      | Default |
| :----------------- | :------- | :----------------------------------------------- | :------ |
| `level`            | String   | Filter by log level; repeat for several levels   | all     |
| `stream_type`      | String   | Filter by `stdout` or `stderr`; repeat as needed | both    |
| `show_logs`        | Boolean  | Include structured log entries                   | `true`  |
| `show_streams`     | Boolean  | Include stdout/stderr stream entries             | `true`  |
| `show_derived`     | Boolean  | Include logs from all derived (child) executions | `false` |
| `show_run_id`      | Boolean  | Include run IDs in text output                   | `false` |
| `cursor`           | String   | Opaque pagination cursor returned by the API     | none    |
| `after`            | DateTime | Include only entries after this timestamp        | none    |
| `length`           | Integer  | Max entries to return                            | `20`    |
| `including_cursor` | Boolean  | Include the entry at `cursor`                    | `false` |
| `direction`        | String   | `older` or `newer`                               | `newer` |

Use `after` with an RFC 3339 timestamp for time filtering. A timestamp in `cursor` is rejected.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/logs" -H accept:application/json
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/logs?show_derived=true" -H accept:application/json
```

---

### `GET /v1/executions/{execution-id}/backtrace`

Returns a persisted call-site backtrace of a workflow execution, including WASM call frames and
source symbol information. Backtraces are stored when a webhook or workflow is configured with
`backtrace_persist`, when `advance` is called with `persist_backtrace`, or on demand with
[`PUT /v1/executions/{execution-id}/backtrace/persist`](#put-v1-executions-execution-id-backtrace-persist).
Otherwise the endpoint returns `404 Not Found`.

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
  "component_id": {
    "component_type": "workflow",
    "name": "my_workflow",
    "component_digest": "sha256:abc123..."
  },
  "version_min_including": 1,
  "version_max_excluding": 3,
  "wasm_backtrace": {
    "frames": [
      {
        "module": "my_workflow",
        "func_name": "panic_handler",
        "symbols": [{ "func_name": "my_fn", "file": "src/lib.rs", "line": 42, "col": 5 }]
      }
    ]
  }
}
```

---

### `GET /v1/executions/{execution-id}/backtrace/source`

Retrieves the source file content referenced by a backtrace frame. The component must be compiled
with debug info so frames carry file symbols, and the deployment must map those files to local
sources with `backtrace.sources`.

**Query Parameters:**

| Parameter | Type   | Description                                                              | Default  |
| :-------- | :----- | :----------------------------------------------------------------------- | :------- |
| `file`    | String | Frame `file` path; a unique trailing path suffix is also accepted        | required |
| `version` | String | Backtrace version for component lookup: `"first"`, `"last"`, or a number | `"last"` |

**Responses:**

- `200 OK`: Source file content as a string.
- `404 Not Found`: Source file not found in the component.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/backtrace/source?file=workflow/src/lib.rs"
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

Every JSON outcome also includes:

- `replayed_event_count`: number of persisted history events supplied to the workflow;
- `replay_duration_ms`: time spent executing the replay after loading its log; and
- `replay_version`: highest persisted execution-event version included in the replay. Response
  records have a separate cursor and are not included in this version.

A `replay_failed` outcome can include a structured, sanitized `failure` object in addition to its
human-readable `error` and captured writes.

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
  "captured_writes": [...],
  "persist_backtrace": false
}
```

The `captured_writes` array should contain the writes returned by a previous `replay` call. Set
`persist_backtrace` to `true` to persist fresh call-site backtraces while applying the writes.

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

### `PUT /v1/executions/{execution-id}/backtrace/persist`

Replay a workflow and persist its call-site backtraces. The operation is idempotent and skips
backtraces that are already stored.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" \
  "127.1:5005/v1/executions/${EXECUTION_ID}/backtrace/persist" \
  -X PUT -H accept:application/json
```

```json
{ "persisted_backtrace_count": 12 }
```

Returns `404` when the execution does not exist and `422` when replay fails.

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

Lists available functions across all components. Pass `extensions=true` to include extension
functions; they are omitted by default.

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
| `direction`                 | String  | `older` or `newer`                              | `older`        |
| `include_deployment_toml`   | Boolean | Include each deployment's TOML                  | `false`        |
| `include_execution_counts`  | Boolean | Include execution state counts                  | `true`         |

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
    "last_active_app_config_digest": "app-config:v1:sha256:...",
    "locked": 0,
    "pending": 0,
    "scheduled": 0,
    "blocked": 0,
    "paused": 0,
    "cancelling": 0,
    "finished_ok": 6,
    "finished_error": 0,
    "finished_execution_failure": 0,
    "component_summary": null,
    "deployment_toml": null
  }
]
```

---

### `GET /v1/deployments/{deployment-id}`

Returns the full details of a specific deployment, including its stored `deployment.toml`. Pass
`include_generated_metadata=false` to remove server-generated metadata from the returned manifest;
the stored server view is returned by default.

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
  "last_active_app_config_digest": "app-config:v1:sha256:...",
  "deployment_toml": "...",
  "files": [...]
}
```

---

### `POST /v1/deployments`

Submits a JSON or multipart deployment package under a server-generated ID and returns
`201 Created`, a `Location` header, and `{ "deployment_id": "Dep_..." }` in JSON. Use the `PUT` form
to make retries idempotent with a caller-generated ID.

---

### `PUT /v1/deployments/{deployment-id}`

Submits a deployment package under a caller-generated deployment ID and stores it in the database.
Retrying the same ID and content is idempotent; reusing an ID for different content returns a
conflict. The deployment is not yet activated; use `PUT /v1/deployments/{id}/switch` to activate it.

**Path Parameters:**

- `deployment-id`: A new deployment ID generated by the caller.

**Request Body (JSON):**

| Field                              | Type    | Description                                                                       |
| :--------------------------------- | :------ | :-------------------------------------------------------------------------------- |
| `deployment_toml`                  | String  | Verbatim deployment manifest                                                      |
| `description`                      | String  | Optional human-readable description                                               |
| `allow_unavailable_runtime_config` | Boolean | Store before runtime values or app and platform approvals are available (`false`) |

Set `allow_unavailable_runtime_config` to `true` when a developer submits a deployment for later
admin approval. Missing values, public environment declarations, secret registrations, outbound HTTP
allowances, and exec approvals are tolerated during submission. Invalid manifests, missing files,
compile errors, and link errors still fail. Submission alone does not activate the deployment;
activation requires strict verification.

The endpoint also accepts `multipart/form-data`. Use text fields for `deployment_toml`,
`description`, and `allow_unavailable_runtime_config`. Every other part is treated as a
deployment-owned file blob; its `filename` is the deployment-relative path and the form-field name
is either the claimed `sha256:...` digest or `file`.

The wire upload package (not an authored deployment file) requires generated metadata. Every
deployment-owned file referenced by `location` must carry its `content_digest` in the submitted
manifest, for example `content_digest = "sha256:..."` next to `location`. The Obelisk CLI adds these
digests automatically; raw REST clients compute the SHA-256 of each file. Files already present in
the server's content store need not be attached again.

**Responses:**

- `204 No Content`: Deployment stored (also returned when retrying the same ID and content).
- `400 Bad Request`: Invalid configuration, including a missing `content_digest`.
- `409 Conflict`: Incomplete or invalid package. The JSON body lists missing digest fields, missing
  files, unexpected files, digest mismatches, and oversized files. No deployment is stored.

#### Example request

```sh
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599" \
  -H content-type:application/json -X PUT -d \
  "$(jq -Rs '{deployment_toml: ., description: "production"}' deployment.toml)"
```

Multipart package with a deployment-owned script:

```sh
curl -H "$OBELISK_API_AUTH" \
  "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599" -X PUT \
  -F deployment_toml=@deployment.toml \
  -F 'file=@scripts/run.sh;filename=scripts/run.sh'
```

where the wire manifest declares the script with its generated digest. Authored `deployment.toml`
must omit `content_digest` and `component_files`; use the CLI to package it:

```toml
[[activity_exec]]
ffqn = "example:scripts/run.run"
location = "scripts/run.sh"
content_digest = "sha256:..." # sha256sum scripts/run.sh
return_type = "result"
```

---

### `GET /v1/files/{digest}`

Downloads a deployment-owned file from the content store by its `sha256:...` digest. Returns the raw
file bytes, or `404 Not Found` if the digest is absent.

---

### `PUT /v1/deployments/{deployment-id}/switch`

Activates a previously submitted deployment. Supports hot-redeploy (apply without a server restart)
or enqueue (activate on next restart).

**Path Parameters:**

- `deployment-id`: The deployment ID to switch to.

**Request Body (JSON):**

| Field                              | Type    | Description                                                                                                                   |
| :--------------------------------- | :------ | :---------------------------------------------------------------------------------------------------------------------------- |
| `apply`                            | Boolean | If `true`, apply immediately without restarting (default: `false`).                                                           |
| `allow_unavailable_runtime_config` | Boolean | Enqueue before runtime values or app and platform approvals are available (`false`). Applying without restart rejects `true`. |

An enqueue request with this field set to `true` can queue a deployment that does not yet fit the
app or platform policy. Startup checks the configuration strictly before activation, so supply the
values and approvals before restarting. Hot apply always requires strict verification.

**Responses:**

- `200 OK`: Returns `{ "ok": "switched" }` (hot-redeployed) or `{ "ok": "restart_required" }`
  (enqueued for next restart).
- `404 Not Found`: Deployment not found.
- `400 Bad Request`: Switch or validation failed.

#### Example request

```sh
# Enqueue a deployment (activates on next restart)
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599/switch" \
  -H content-type:application/json -X PUT -d '{"apply": false}'

# Apply immediately without restart
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/deployments/Dep_01KN1NK9A6NMHP31TVJ875X599/switch" \
  -H content-type:application/json -X PUT -d '{"apply": true}'
```

```json
{ "ok": "switched" }
```

---

## Server Information

### `GET /v1/info`

Returns the app name, Obelisk version, current deployment ID, node run ID, app config digest, and
server start time as JSON:

```json
{
  "app_name": "my-app",
  "obelisk_version": "0.43.0",
  "deployment_id": "Dep_...",
  "node_run_id": "NodeRun_...",
  "app_config_digest": "app-config:v1:sha256:...",
  "started_at": "2026-10-18T11:00:00.000Z"
}
```

---

## App Configuration

### `GET /v1/app-config`

Returns the running app policy (secrets without values, public environment names, exec approvals,
and outbound HTTP rules) together with its canonical `app_config_digest`. JSON is the default; send
`Accept: application/toml` to receive the same document as TOML. Deployments record the digest that
was in effect when they were activated, and system events carry the current digest.

```json
{
  "app_config_digest": "app-config:v1:sha256:03f0...",
  "policy": {
    "format": "obelisk-app-config-v1",
    "secrets": {},
    "public_env": [],
    "allowed_exec_activities": {},
    "outbound_http": [{ "pattern": "https://example.com", "methods": ["GET"], "...": "..." }]
  }
}
```

### `GET /v1/app-config-digest`

Returns only the current `app_config_digest`, as plain text by default.

---

## Operator Administration

The authenticated `/v1/admin` API exposes operator-only maintenance and diagnostics. Prefer the
`obelisk admin` CLI for interactive use; use the OpenAPI schema for complete request and response
types.

| Endpoint                                       | Purpose                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `GET /v1/admin/node-run-id`                    | Deprecated, removed after 0.43: use `node_run_id` from `GET /v1/info` |
| `GET /v1/admin/system-events`                  | List persisted events, filtered by run, level, code, or creation time |
| `GET /v1/admin/system-events/{event-id}`       | Retrieve one system event                                             |
| `POST /v1/admin/system-events/retain`          | Remove system events older than the requested age                     |
| `GET /v1/admin/storage`                        | Show persistent storage usage and record counts                       |
| `DELETE /v1/admin/executions/{execution-id}`   | Delete a top-level execution tree                                     |
| `POST /v1/admin/executions/retain`             | Retain execution trees by count or age in bounded batches             |
| `DELETE /v1/admin/deployments/{deployment-id}` | Delete an inactive deployment                                         |
| `POST /v1/admin/deployments/retain`            | Retain inactive deployments by count or age                           |

Deletion tombstones execution roots synchronously; automatic maintenance removes their trees and
unreferenced shared metadata and CAS blobs in bounded batches. Forced deletion can remove a
non-terminal tree unless its root belongs to the active deployment. Active and enqueued deployments
are always retained.

`POST /v1/admin/system-events/retain` accepts `max_age_seconds`, `batch_size`, and a required
`dry_run`. Omitting `dry_run` is rejected without deleting events. With `"dry_run": true` it deletes
nothing and returns the number of events the batch would delete:

```sh
curl -H "$OBELISK_API_AUTH" 127.1:5005/v1/admin/system-events/retain -H content-type:application/json \
  -d '{ "max_age_seconds": 86400, "batch_size": 1000, "dry_run": true }'
```

```json
{ "deleted": 12, "has_more": false }
```

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
{ "ok": "cancellation requested" }
```

Cancellation is asynchronous; poll the status or result endpoint to observe the `cancelled` outcome.
`409 Conflict` is returned with `already finished` or `already cancelling`.

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
curl -H "$OBELISK_API_AUTH" "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:application/json | grep $DELAY_ID
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
- `{ "execution_failed": { "kind": "...", "reason": "..." } }`: Execution failed (trap, timeout,
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
- `value_too_large`: A persisted parameter or result exceeded the execution tree's size limit.
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
