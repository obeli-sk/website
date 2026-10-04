#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

asset_dir=static/blog/2026-10-04-obelisk-0-42
chart_data=$(mktemp)
chart_labels=$(mktemp)
chart_svg=$(mktemp)
trap 'rm -f "$chart_data" "$chart_labels" "$chart_svg"' EXIT

jq -r '.samples | group_by(.runtime)
  | sort_by(if .[0].runtime == "v8" then 0 elif .[0].runtime == "rust-wasm" then 1 else 2 end)
  | length as $count | to_entries[] | .key as $row | .value
  | (map(.replay_duration_ms) | sort | .[length / 2 | floor]) as $median
  | [($count - 1 - $row), $median, "\($median) ms",
      (if .[0].runtime == "v8" then "JavaScript / V8"
       elif .[0].runtime == "rust-wasm" then "Rust / Wasmtime" else "JavaScript / Boa WASM" end)]
  | @tsv' "$asset_dir/js-replay.json" > "$chart_data"
awk -F '\t' '{
  printf "set label %d '\''%s'\'' at screen 0.0263158, first %s left\n", NR*2, $4, $1
  printf "set label %d '\''%s'\'' at screen 0.881579, first %s left\n", NR*2+1, $3, $1
}' "$chart_data" > "$chart_labels"
bar_count=$(jq '.samples | group_by(.runtime) | length' "$asset_dir/js-replay.json")
event_count=$(jq '.samples[0].replayed_event_count' "$asset_dir/js-replay.json")
description=$(jq -r '.samples | group_by(.runtime)
  | map("\(.[0].runtime): \(map(.replay_duration_ms) | sort | .[length / 2 | floor]) ms")
  | "Median workflow replay time. " + join("; ") + "."' "$asset_dir/js-replay.json")

gnuplot -e "data_file='$chart_data'; label_file='$chart_labels'; output_file='$chart_svg'; bar_count=$bar_count; event_count=$event_count" - <<'PLOT'
set terminal svg size 760,190 font 'system-ui, sans-serif,14' noenhanced
set output output_file
set datafile separator '\t'
stats data_file using 2 nooutput
scale_max = ceil(STATS_max/500)*500
set xrange [0:scale_max]
set yrange [-0.6:bar_count-0.2]
unset xtics
unset ytics
unset border
set lmargin at screen 0.263158
set rmargin at screen 0.789474
set tmargin at screen 0.80
set bmargin at screen 0.27
set label 20 sprintf('Workflow-agent replay: %d events', event_count) at screen 0.0263158, screen 0.92 left
set label 21 sprintf('scale: 0–%d ms', scale_max) at screen 0.77, screen 0.92 left
set label 22 'Replay time (ms), lower is faster' at screen 0.0263158, screen 0.10 left
load label_file
set arrow 1 from graph 0, graph 0 to graph 0, graph 1 nohead lc rgb '#888888'
set arrow 2 from graph 1, graph 0 to graph 1, graph 1 nohead lc rgb '#888888'
unset key
set style fill solid 1.0 noborder
plot data_file using ($2/2):1:(0):2:($1-0.22):($1+0.22) with boxxyerrorbars lc rgb '#00aaaa'
PLOT

sed -e '/^<?xml /d' -e '/^<!DOCTYPE /d' \
  -e 's/<svg /<svg role="img" aria-labelledby="js-replay-title js-replay-desc" style="display:block;width:760px;max-width:none;height:auto;color:var(--text)" /' \
  -e 's/<title>Gnuplot<\/title>/<title id="js-replay-title">Workflow-agent replay time<\/title>/' \
  -e "s@<desc>Produced by GNUPLOT.*</desc>@<desc id=\"js-replay-desc\">$description</desc>@" \
  -e 's/<text>Workflow-agent replay/<text font-weight="700">Workflow-agent replay/' \
  -e 's/rgb(  0, 170, 170)/var(--primary, currentColor)/g' \
  -e 's/rgb(136, 136, 136)/color-mix(in srgb, var(--text, currentColor) 35%, transparent)/g' \
  -e "s/fill = '\([^']*\)'/style=\"fill:\1\"/g" \
  -e 's/="black"/="currentColor"/g' \
  -e "s/='black'/='currentColor'/g" \
  -e 's/color="white"/color="currentColor"/g' \
  -e "s/flood-color='white'/flood-color='var(--bg)'/g" \
  "$chart_svg" > "$asset_dir/js-replay.svg"
