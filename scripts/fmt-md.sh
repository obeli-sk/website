#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
prettier "${@:---write}" --prose-wrap always --print-width 100 'content/**/*.md'
