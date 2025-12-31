+++
title = "Programmatic access"
template = "docs.html"
weight = 0
+++


## gRPC, gRPC-Web

See {{ github(title="obelisk.proto", path="proto/obelisk.proto") }} schema for details.

## WebAPI

This document describes the REST-like API for managing components and executions.

## General Information

### Base URL
All endpoints are prefixed with `/v1`.

## Content Negotiation

The API supports content negotiation via the `Accept` header.
- `application/json` (Default): Returns structured JSON data.
- `text/plain`: Returns a human-readable string representation (e.g., raw IDs or formatted lists).

---

## Components

### `GET /v1/components`
Lists all registered components in the system.

**Query Parameters:**
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `type` | String | Filter by [Component Type](#component-type). |
| `name` | String | Filter by component name. |
| `digest` | String | Filter by `sha256sum` of the component's WASM file. |
| `exports` | Boolean | Include exported functions in the response. |
| `imports` | Boolean | Include imported functions in the response. |
| `submittable`| Boolean | Filter functions that can be directly submitted. |
| `extensions` | Boolean | Include extension exports. |

#### Example request
```sh
curl "127.1:5005/v1/components?exports=true&imports=false" -H accept:application/json
```
```json
[
  {
    "component_id": {
      "component_type": "activity_wasm",
      "name": "test_programs_fibo_activity",
      "input_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0"
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

---

### `GET /v1/components/{digest}/wit`
Retrieves the WebAssembly Interface Type (WIT) definition for a specific component.

**Path Parameters:**
- `digest`: `sha256sum` of the component's WASM file.

**Returns:**
- `200 OK`: The WIT text.
- `204 No Content`: If the component exists but has no WIT definition.
- `404 Not Found`: Component not found.

#### Example request
```sh
curl '127.1:5005/v1/components/sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0/wit'
```
```
package root:component;

world root {
  import wasi:io/error@0.2.6;
  import wasi:io/streams@0.2.6;
  import wasi:cli/environment@0.2.6;
  import wasi:cli/exit@0.2.6;
  import wasi:cli/stderr@0.2.6;

  export testing:fibo/fibo;
  export testing:fibo-obelisk-ext/fibo;
  export testing:fibo-obelisk-schedule/fibo;
}
package testing:fibo {
  interface fibo {
    fibo: func(n: u8) -> result<u64>;
  }
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
| Parameter | Type | Description |
| :--- | :--- | :--- |
| `ffqn_prefix` | String | Filter by Function Fully Qualified Name or its prefix. |
| `show_derived`| Boolean | If `true`, includes child executions. (Default: `false`). |
| `hide_finished` | Boolean | Show only unfinished executions. |
| `execution_id_prefix` | String | Filter by Execution ID or its prefix. |
| `cursor` | String/Date| Pagination cursor (Timestamp or Execution ID). |
| `length` | Integer | Number of items to return. |
| `direction` | String | `older` (default) or `newer`. |
| `including_cursor`| Boolean| Include the cursor item in the result. |

#### Example request
```sh
curl "127.1:5005/v1/executions" -H accept:application/json
```
```json
[
  {
    "execution_id": "E_01KDJH6F811F2E0Q7AC4PDR9WE",
    "ffqn": "obelisk-flyio:workflow/workflow@1.0.0-beta.app-init",
    "pending_state": {
      "status": "Finished",
      "version": 16,
      "finished_at": "2025-12-28T13:09:50.226429459Z",
      "result_kind": "ok"
    },
    "created_at": "2025-12-28T13:08:38.274234577Z",
    "first_scheduled_at": "2025-12-28T13:08:38.274234577Z",
    "component_digest": "sha256:b2ee4bdf32367e5d4eaf3643b95b9d7261996a5fe03582bff58cc59a884dc29b"
  },
  ...
]
```

---

### `POST /v1/executions`
Submits a new execution. The system will automatically generate an Execution ID.

**Query Parameters:**
- `follow`: (Boolean) If `true`, the request blocks and streams the result once finished.


#### Example request
```sh
curl '127.1:5005/v1/executions' -H content-type:application/json -H accept:application/json -X POST -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```
```json
{"ok":"E_01KDN8Y8ZZ4XYG2J0XJW5A8WE5"}
```

With `follow` set to `true`:
```sh
curl '127.1:5005/v1/executions?follow=true' -H content-type:application/json -X POST -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```
```json
{"ok":5}
```

---

### `PUT /v1/executions/{execution-id}`
Submits an execution with a client-provided ID. This is idempotent; if the execution already exists with the same parameters, it returns `200 OK`.

**Path Parameters:**
- `execution-id`: The unique ID for this execution.

**Query Parameters:**
- `follow`: (Boolean) Block and stream the result.

#### Example request
```sh
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)
curl "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -H accept:application/json -X PUT -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```
```json
{"ok":"E_01KDN9422HAK2AHY9EXZA201TD"}
```
Resending with `follow` set to `true`:
```sh
curl "127.1:5005/v1/executions/${EXECUTION_ID}"?follow=true -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:fibo/fibo.fibo", "params": [5] }'
```
```json
{"ok":5}
```

---

### `GET /v1/executions/{execution-id}`
Retrieves the result of an execution.

**Query Parameters:**
- `follow`: (Boolean) If the execution is not finished, the connection stays open and streams the result as soon as it completes.

**Responses:**
- `200 OK`: Returns the [Execution Result](#execution-result).
- `425 Too Early`: Execution is still in progress (only returned if `follow=false`).


#### Example request
```sh
curl "127.1:5005/v1/executions/${EXECUTION_ID}"
```
```json
{"ok":5}
```

---

### `GET /v1/executions/{execution-id}/status`
Returns the current lifecycle status (e.g., `pending`, `running`, `finished`).

#### Example request
```sh
curl "127.1:5005/v1/executions/${EXECUTION_ID}/status" -H accept:application/json
```
```json
{
  "execution_id": "E_01KDQR2TGJR2XWEDM4CS6E4TF1",
  "ffqn": "testing:fibo/fibo.fibo",
  "pending_state": {
    "status": "Finished",
    "version": 2,
    "finished_at": "2025-12-30T13:45:14.993810795Z",
    "result_kind": "ok"
  },
  "created_at": "2025-12-30T13:45:14.968745786Z",
  "first_scheduled_at": "2025-12-30T13:45:14.968745786Z",
  "component_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0"
}
```
---

### `GET /v1/executions/{execution-id}/events`
Retrieves the history of events for an execution.

**Query Parameters:**
- `version_from`: Start from this event version.
- `length`: Max number of events.
- `include_backtrace_id`: Include debugging backtrace IDs.

#### Example request
```sh
curl "127.1:5005/v1/executions/${EXECUTION_ID}/events" -H accept:application/json
```
```json
[
  {
    "created_at": "2025-12-29T14:46:33.030449088Z",
    "event": {
      "Created": {
        "ffqn": "testing:fibo/fibo.fibo",
        "params": [
          5
        ],
        "parent": null,
        "scheduled_at": "2025-12-29T14:46:33.030449088Z",
        "component_id": {
          "component_type": "activity_wasm",
          "name": "test_programs_fibo_activity",
          "input_digest": "sha256:6a4566fb2de6564b4cbdaa6572983612d10cfe5558cb48b631e303e1d6a9e2d0"
        },
        "metadata": {},
        "scheduled_by": null
      }
    },
    "version": 0
  },
  ...
]
```

---

### `GET /v1/executions/{execution-id}/responses`
Retrieves responses associated with an execution (used for long-running interactions).

**Query Parameters:**
- `cursor_from`: Start from this cursor index.
- `length`: Max number of responses.


#### Example request
```sh
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)

curl "127.1:5005/v1/executions/${EXECUTION_ID}"?follow=true -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:fibo-workflow/workflow.fiboa", "params": [5,5] }'

curl "127.1:5005/v1/executions/${EXECUTION_ID}/responses" -H accept:application/json
```
```json
[
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
            "Ok": {
              "ok": {
                "type": "u64",
                "value": 5
              }
            }
          }
        }
      }
    },
    "cursor": 67
  },
  ...
]
```

---

### `PUT /v1/executions/{execution-id}/stub`
Manually provides a return value for a stubbed execution.

**Request Body (JSON):**
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
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)
# Submit a workflow that submits a stub activity
curl "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -H accept:application/json -X PUT -d \
'{ "ffqn":"testing:stub-workflow/workflow.submit-await", "params": ["test"] }'
# Create the expected child execution id based on code or execution log
CHILD_EXECUTION_ID="${EXECUTION_ID}.o:1-foo_1"
# Optionally verify the id:
curl "127.1:5005/v1/executions/${EXECUTION_ID}/events"  | grep $CHILD_EXECUTION_ID
# returns a row containing: HistoryEvent(JoinSetRequest(ChildExecutionRequest(E_01KDNB650P06H69YR1FD973MA0.o:1-foo_1, testing:stub-activity/activity.foo, params: ["test"])))

curl "127.1:5005/v1/executions/${CHILD_EXECUTION_ID}/stub" -H content-type:application/json -X PUT -d \
'{"ok": "some return value"}'
```
```json
{"ok":"stubbed"}
```

---

### `PUT /v1/executions/{execution-id}/upgrade`
Upgrade an execution to run on with different WASM component. Upgrading only makes sense when the executor is configured
to lock executions by its WASM's sha256 digest:
```toml
exec.locking_strategy = "by_component_id"
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
obelisk server run -c obelisk.toml # start with components downloaded from Docker Hub.
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)
# Submit a workflow
curl "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep-workflow/workflow.sleep-host-activity", "params": [{"seconds":10}] }'

# Shutdown the server before the execution finishes.
obelisk server run -c obelisk-local.toml # Start with components built locally.
# Find the old and new sha256 digest
OLD=$(curl "127.1:5005/v1/executions/${EXECUTION_ID}/status"  -H accept:application/json | jq .component_digest)
NEW=$(curl '127.1:5005/v1/components?name=test_programs_sleep_workflow' -H 'accept:application/json' | jq .[0].component_id.input_digest)

curl "127.1:5005/v1/executions/${EXECUTION_ID}/upgrade" -H content-type:application/json -X PUT -d \
'{"old":'$OLD', "new": '$NEW' }'
```
```json
{"ok":"upgraded"}
```

---

## Cancellation requests

### `PUT /v1/executions/{execution-id}/cancel`
Cancels an active execution.
*Note: This is only permitted for Activity components.*

#### Example request
```sh
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)
curl "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep/sleep.sleep", "params": [{"seconds":100}] }'

curl "127.1:5005/v1/executions/${EXECUTION_ID}/cancel" -X PUT -H accept:application/json
```
```json
{"ok":"cancelled"}
```

---
### `PUT /v1/delays/{delay-id}/cancel`
Cancels a request for {{ doc_link(title="persistent sleep", path="concepts/workflows/persistent-sleep.md") }}.

**Path Parameters:**
- `delay-id`: The unique ID of the delay.


#### Example request
```sh
EXECUTION_ID=$(curl 127.1:5005/v1/execution-id)
curl "127.1:5005/v1/executions/${EXECUTION_ID}" -H content-type:application/json -X PUT -d \
'{ "ffqn":"testing:sleep-workflow/workflow.sleep-host-activity", "params": [{"seconds":100}] }'
# Create the expected delay id based on code or execution log
DELAY_ID="Delay_${EXECUTION_ID#E_}.o:1-sleep_1"
# Optionally verify the id:
curl "127.1:5005/v1/executions/${EXECUTION_ID}/events"  | grep $DELAY_ID
# returns a row containing: HistoryEvent(JoinSetRequest(DelayRequest(Delay_01KDNCA38TYGKHF7GKH3XQJH02.o:1-sleep_1, expires_at: `2025-12-29 15:43:39.751469133 UTC`, schedule_at: `In(150s)`)))

curl "127.1:5005/v1/delays/${DELAY_ID}/cancel" -X PUT -H accept:application/json
```
```json
{"ok":"cancelled"}
```

---

## Data Reference

### Component Type
When filtering components, use these values:
- `activity_wasm`
- `activity_stub`
- `activity_external`
- `workflow`
- `webhook_endpoint`

### Execution Result
The result object returned when an execution finishes:
*  `{ "ok": ... }`: Optional value returned if function succeeded.
* `{ "err": ... }`: Optional value returned if function returned an error.
* `{ "execution_error": ... }`: Optional value returned if the execution failed. Contains fields `kind`, and optionally `reason`, `detail`.

#### Execution Error Kind
One of
* `timed_out`: Applicable to activities only, last attempt timed out
* `nondeterminism_detected`: Applicable to workflows
* `out_of_fuel`: Applicable to WASM components
* `cancelled`: Applicable to activities
* `uncategorized`: Uncategorized, e.g. WASM trap



### Errors
Errors are returned with appropriate HTTP status codes (400, 404, 409, 503).
- **JSON**: `{ "err": "Description of error" }`
- **Text**: `Description of error`