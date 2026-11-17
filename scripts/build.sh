#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

render_markdown() {
    local html=$1 markdown=${1%.html}.md
    if rg -q "<main>" "$html"; then
        htmlq main --remove-nodes "script, style, .breadcrumb, .docs-nav, .page-toc, .back-link, svg" < "$html" |
            sed -E 's/<pre[^>]*><code data-lang="([^"]*)">/<pre class="\1"><code>/g; s/<pre class="qs-code">/<pre>/g' |
            pandoc --from html --to gfm-raw_html --wrap none > "$markdown"
    elif ! rg -qi "<!doctype html|<html" "$html"; then
        cp "$html" "$markdown"
    fi
}
export -f render_markdown

zola build "$@"
find public -name index.html -print0 | xargs -0 -P 8 -I '{}' bash -euo pipefail -c 'render_markdown "$1"' _ '{}'
