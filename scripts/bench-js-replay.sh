#!/usr/bin/env bash
set -euo pipefail

if (( $# < 3 )); then
  echo "Usage: OBELISK_API_TOKEN=... $0 RUNTIME API_URL EXECUTION_ID..." >&2
  exit 1
fi

runtime=$1
api_url=${2%/}
shift 2
: "${OBELISK_API_TOKEN:?Set the benchmark server token}"

for execution_id in "$@"; do
  for sample in {0..9}; do
    response=$(curl --fail-with-body --silent --show-error --max-time 120 \
      -X PUT -H "Authorization: Bearer $OBELISK_API_TOKEN" \
      -H 'Accept: application/json' "$api_url/v1/executions/$execution_id/replay")
    jq -e '.type == "blocked" or .type == "finished"' <<<"$response" >/dev/null
    if (( sample > 0 )); then
      jq -c --arg runtime "$runtime" --arg execution_id "$execution_id" \
        --argjson sample "$sample" \
        '{runtime: $runtime, execution_id: $execution_id, sample: $sample,
          outcome: .type, replayed_event_count, replay_version, replay_duration_ms}' <<<"$response"
    fi
  done
done
