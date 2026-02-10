#!/usr/bin/env bash
set -euo pipefail

# Bump the latest Obelisk version on the website.
#
# Usage: scripts/bump-version.sh <new-version> <docs-link-target>
#
# Example: scripts/bump-version.sh v0.36.0 v0.35.0
#   - Creates symlink content/docs/v0.36.0 -> v0.35.0
#   - Updates content/docs/latest -> v0.36.0
#   - Adds v0.36.0 to the versions list in config.toml
#   - Sets latest = "v0.36.0" in config.toml

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <new-version> <docs-link-target>" >&2
    echo "Example: $0 v0.36.0 v0.35.0" >&2
    exit 1
fi

NEW_VERSION="$1"
LINK_TARGET="$2"

# Resolve repo root (script lives in scripts/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCS_DIR="$REPO_ROOT/content/docs"
CONFIG="$REPO_ROOT/config.toml"

# Validate inputs
if [[ ! "$NEW_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must match vX.Y.Z (got '$NEW_VERSION')" >&2
    exit 1
fi

if [[ -e "$DOCS_DIR/$NEW_VERSION" ]]; then
    echo "Error: $DOCS_DIR/$NEW_VERSION already exists" >&2
    exit 1
fi

if [[ ! -e "$DOCS_DIR/$LINK_TARGET" ]]; then
    echo "Error: link target $DOCS_DIR/$LINK_TARGET does not exist" >&2
    exit 1
fi

# 1. Create version symlink
ln -s "$LINK_TARGET" "$DOCS_DIR/$NEW_VERSION"
echo "Created symlink: content/docs/$NEW_VERSION -> $LINK_TARGET"

# 2. Update latest symlink
ln -sfn "$NEW_VERSION" "$DOCS_DIR/latest"
echo "Updated symlink: content/docs/latest -> $NEW_VERSION"

# 3. Update config.toml: set latest
OLD_LATEST=$(grep -oP '^latest = "\Kv[^"]+' "$CONFIG")
sed -i "s/^latest = \"$OLD_LATEST\"/latest = \"$NEW_VERSION\"/" "$CONFIG"
echo "Updated config.toml: latest = \"$NEW_VERSION\" (was \"$OLD_LATEST\")"

# 4. Update config.toml: add new version to top of versions list
# Insert after the "versions = [" line
sed -i "/^versions = \[/a\    \"$NEW_VERSION\"," "$CONFIG"
echo "Added \"$NEW_VERSION\" to versions list in config.toml"

echo
echo "Done. Review changes with: git diff"
