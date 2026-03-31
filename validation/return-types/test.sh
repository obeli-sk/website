#!/usr/bin/env bash
# Validates JS return/throw behaviour for result, result<string>, result<string, string>.
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

# run: always succeeds so we can inspect output
run() { obelisk execution submit --follow "$@" 2>&1 || true; }

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# --- result ---
out=$(run 'validation:return-types/activity.return-result' '["ok"]')
echo "$out" | grep -q 'OK: (no return value)' && pass "result: return -> ok" || fail "result: return -> ok | got: $out"

out=$(run 'validation:return-types/activity.return-result' '["throw_null"]')
echo "$out" | grep -q 'Error: (no return value)' && pass "result: throw null -> err (retriable)" || fail "result: throw null -> err | got: $out"

out=$(run 'validation:return-types/activity.return-result' '["throw_string"]')
echo "$out" | grep -q 'Execution failure' && echo "$out" | grep -q 'expected .throw null.' \
    && pass "result: throw string -> FatalError (no retries)" || fail "result: throw string -> FatalError | got: $out"
echo "$out" | grep -q 'Pending' && fail "result: throw string must not retry" || true

# --- result<string> ---
out=$(run 'validation:return-types/activity.return-result-string' '["ok"]')
echo "$out" | grep -q 'OK: "hello"' && pass "result<string>: return -> ok(hello)" || fail "result<string>: return | got: $out"

out=$(run 'validation:return-types/activity.return-result-string' '["throw_null"]')
echo "$out" | grep -q 'Error: (no return value)' && pass "result<string>: throw null -> err (retriable)" || fail "result<string>: throw null | got: $out"

out=$(run 'validation:return-types/activity.return-result-string' '["throw_string"]')
echo "$out" | grep -q 'Execution failure' && echo "$out" | grep -q 'expected .throw null.' \
    && pass "result<string>: throw string -> FatalError" || fail "result<string>: throw string | got: $out"

# --- result<string, string> ---
out=$(run 'validation:return-types/activity.return-result-string-string' '["ok"]')
echo "$out" | grep -q 'OK: "hello"' && pass "result<string,string>: return -> ok(hello)" || fail "result<string,string>: return | got: $out"

out=$(run 'validation:return-types/activity.return-result-string-string' '["throw_string"]')
echo "$out" | grep -q 'Error: "something went wrong"' && pass "result<string,string>: throw string -> err(string)" || fail "result<string,string>: throw string | got: $out"

out=$(run 'validation:return-types/activity.return-result-string-string' '["throw_error_object"]')
echo "$out" | grep -q 'Error: "an Error object"' && pass "result<string,string>: throw Error -> err(message)" || fail "result<string,string>: throw Error | got: $out"

echo ""
echo "All return-type tests passed."
