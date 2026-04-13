#!/usr/bin/env bash
# Validates the JS webhook example from the 0.37 announcement:
# POST /weather accepts {"cities": [...]} and schedules a parallel weather workflow.
# Requires outbound network access (fetches temperatures from wttr.in).
set -uo pipefail
cd "$(dirname "$0")"

obelisk server run --deployment deployment.toml --clean-sqlite-directory &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

# Wait for server
for i in $(seq 1 20); do
    curl -sf http://127.0.0.1:5005/v1/executions > /dev/null 2>&1 && break
    sleep 0.5
done

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# POST to the webhook
response=$(curl -sf -X POST http://127.0.0.1:9090/weather \
    -H "content-type: application/json" \
    -d '{"cities":["London","Tokyo"]}') || fail "webhook POST failed"

echo "Webhook response: $response"

# Extract execId
exec_id=$(echo "$response" | grep -o '"execId":"[^"]*"' | cut -d'"' -f4)
[ -n "$exec_id" ] || fail "no execId in webhook response: $response"
pass "webhook returned execId: $exec_id"

# Wait for the workflow to finish and get the result
result=$(curl -sf "http://127.0.0.1:5005/v1/executions/${exec_id}?follow=true") \
    || fail "failed to get execution result for $exec_id"

echo "Workflow result: $result"

echo "$result" | grep -q '"ok":' \
    && pass "workflow returned ok result" \
    || fail "workflow did not return ok | got: $result"
echo "$result" | grep -q 'London' \
    && pass "result contains London" \
    || fail "result missing London | got: $result"
echo "$result" | grep -q 'Tokyo' \
    && pass "result contains Tokyo" \
    || fail "result missing Tokyo | got: $result"

echo ""
echo "All JS webhook tests passed."
