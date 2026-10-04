#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

asset_dir=static/blog/2026-10-04-obelisk-0-42
chart_data=$(mktemp)
chart_labels=$(mktemp)
chart_svg=$(mktemp)
chart_style=$(mktemp)
trap 'rm -f "$chart_data" "$chart_labels" "$chart_svg" "$chart_style"' EXIT

jq -r '.samples | group_by(.runtime)
  | sort_by(if .[0].runtime == "v8" then 0 elif .[0].runtime == "rust-wasm" then 1 else 2 end)
  | length as $count | to_entries[] | .key as $row | .value
  | (map(.replay_duration_ms) | sort | .[length / 2 | floor]) as $median
  | (map(.replay_duration_ms) | min) as $min
  | (map(.replay_duration_ms) | max) as $max
  | [($count - 1 - $row), ($median / 1000),
      (if $max < 1000 then "\($min)–\($max) ms"
       else "\(($min / 100 | round) / 10)–\(($max / 100 | round) / 10) s" end),
      (if .[0].runtime == "v8" then "JavaScript / V8"
       elif .[0].runtime == "rust-wasm" then "Rust / Wasmtime" else "JavaScript / Boa WASM" end),
      ($min / 1000), ($max / 1000)]
  | @tsv' "$asset_dir/js-replay.json" > "$chart_data"
awk -F '\t' '{
  label = $3;
  if ($6 >= 1) label = sprintf("%.1f–%.1f s", $5, $6);
  printf "set label %d '\''%s'\'' at screen 0.0263158, first %s left\n", NR*2, $4, $1
  printf "set label %d '\''%s'\'' at screen 0.881579, first %s left\n", NR*2+1, label, $1
}' "$chart_data" > "$chart_labels"
bar_count=$(jq '.samples | group_by(.runtime) | length' "$asset_dir/js-replay.json")
event_count=$(jq '.samples[0].replayed_event_count' "$asset_dir/js-replay.json")
description=$(jq -r '.samples | group_by(.runtime)
  | map("\(.[0].runtime): median \(map(.replay_duration_ms) | sort | .[length / 2 | floor]) ms, range \(map(.replay_duration_ms) | min)–\(map(.replay_duration_ms) | max) ms")
  | "Workflow replay time over nine measured calls. " + join("; ") + "."' "$asset_dir/js-replay.json")

cat > "$chart_style" <<'AWK'
/<polygon style="fill:var\(--primary/ {
  split($0, fields, "points = ");
  gsub(/[^0-9., ]/, "", fields[2]);
  split(fields[2], points, " ");
  split(points[1], bottom_left, ",");
  split(points[2], bottom_right, ",");
  split(points[3], top_right, ",");
  printf "<rect x=\"%.2f\" y=\"%.2f\" width=\"%.2f\" height=\"%.2f\" rx=\"3\" style=\"fill:var(--primary)\"/>\n", bottom_left[1], top_right[2], bottom_right[1]-bottom_left[1], bottom_left[2]-top_right[2];
  next;
}
{ print; }
AWK

gnuplot -e "data_file='$chart_data'; label_file='$chart_labels'; output_file='$chart_svg'; bar_count=$bar_count; event_count=$event_count" - <<'PLOT'
set terminal svg size 760,190 font 'system-ui, sans-serif,14' noenhanced
set output output_file
set datafile separator '\t'
stats data_file using 6 nooutput
scale_max = ceil(STATS_max)
set xrange [0:scale_max]
set yrange [-0.6:bar_count-0.2]
unset xtics
unset ytics
unset border
set lmargin at screen 0.263158
set rmargin at screen 0.789474
set tmargin at screen 0.80
set bmargin at screen 0.27
set label 20 sprintf('Workflow-agent replay: %d events', event_count) at screen 0.0263158, screen 0.88 left
set label 21 sprintf('scale: 0–%d s', scale_max) at screen 0.77, screen 0.88 left
set label 22 'Median bars; labels show observed ranges' at screen 0.0263158, screen 0.10 left
load label_file
set arrow 1 from graph 0, graph 0 to graph 0, graph 1 nohead lc rgb '#888888'
set arrow 2 from graph 1, graph 0 to graph 1, graph 1 nohead lc rgb '#888888'
unset key
set style fill solid 1.0 noborder
plot data_file using ($2/2):1:(0):2:($1-0.32):($1+0.32) with boxxyerrorbars lc rgb '#00aaaa'
PLOT

sed -e '/^<?xml /d' -e '/^<!DOCTYPE /d' \
  -e 's/<svg /<svg role="img" aria-labelledby="js-replay-title js-replay-desc" style="display:block;width:760px;max-width:none;height:auto;color:var(--text)" /' \
  -e 's/<title>Gnuplot<\/title>/<title id="js-replay-title">Workflow-agent replay time<\/title>/' \
  -e "s@<desc>Produced by GNUPLOT.*</desc>@<desc id=\"js-replay-desc\">$description</desc>@" \
  -e 's/<text>Workflow-agent replay/<text font-weight="700">Workflow-agent replay/' \
  -e 's/rgb(  0, 170, 170)/var(--primary, currentColor)/g' \
  -e 's/rgb(  0,   0,   0)/currentColor/g' \
  -e 's/rgb(136, 136, 136)/color-mix(in srgb, var(--text, currentColor) 35%, transparent)/g' \
  -e "s/fill = '\([^']*\)'/style=\"fill:\1\"/g" \
  -e 's/="black"/="currentColor"/g' \
  -e "s/='black'/='currentColor'/g" \
  -e 's/color="white"/color="currentColor"/g' \
  -e "s/flood-color='white'/flood-color='var(--bg)'/g" \
  -e "s/shape-rendering='crispEdges'/shape-rendering='geometricPrecision'/g" \
  "$chart_svg" | awk -f "$chart_style" > "$asset_dir/workflow-replay-range.svg"
