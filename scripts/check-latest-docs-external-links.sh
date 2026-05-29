#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

latest_target="$(readlink content/docs/latest)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$tmpdir/content/docs" "$tmpdir/templates" "$tmpdir/sass" "$tmpdir/static"

cp config.toml "$tmpdir/"
cp -a templates/. "$tmpdir/templates/"
cp -a sass/. "$tmpdir/sass/"
cp -a static/. "$tmpdir/static/"
cp content/docs/_index.md "$tmpdir/content/docs/_index.md"
cp -aL "content/docs/$latest_target" "$tmpdir/content/docs/$latest_target"
ln -s "$latest_target" "$tmpdir/content/docs/latest"

mkdir -p "$tmpdir/content/blog" "$tmpdir/content/features" "$tmpdir/content/install"
cat > "$tmpdir/content/blog/_index.md" <<'EOF'
+++
title = "Blog"
+++
EOF
cat > "$tmpdir/content/features/_index.md" <<'EOF'
+++
title = "Features"
+++
EOF
cat > "$tmpdir/content/install/_index.md" <<'EOF'
+++
title = "Install"
+++
EOF

while IFS= read -r blog_path; do
  cat > "$tmpdir/content/blog/$blog_path" <<EOF
+++
title = "${blog_path%.md}"
+++
EOF
done < <(
  rg --no-filename -o '@/blog/[^)]+' "content/docs/$latest_target" \
    | sed 's#@/blog/##' \
    | sort -u
)

find "$tmpdir/content/docs" -type f -name '*.md' -exec sed -Ei \
  -e 's#\[http://localhost:([0-9]+)\]\(http://localhost:\1\)#`http://localhost:\1`#g' \
  -e 's#\[http://127\.0\.0\.1:([0-9]+)\]\(http://127\.0\.0\.1:\1\)#`http://127.0.0.1:\1`#g' \
  -e 's#\[http://127\.1:([0-9]+)\]\(http://127\.1:\1\)#`http://127.1:\1`#g' \
  -e 's#http://localhost:([0-9]+)#`http://localhost:\1`#g' \
  -e 's#http://127\.0\.0\.1:([0-9]+)#`http://127.0.0.1:\1`#g' \
  -e 's#http://127\.1:([0-9]+)#`http://127.1:\1`#g' {} +

awk '
  /^\[extra\]/ { exit }
  { print }
' "$tmpdir/config.toml" > "$tmpdir/config.toml.tmp"

cat >> "$tmpdir/config.toml.tmp" <<EOF
[extra]
latest = "$latest_target"
versions = [
    "$latest_target",
]
EOF

mv "$tmpdir/config.toml.tmp" "$tmpdir/config.toml"

(
  cd "$tmpdir"
  zola check
)
