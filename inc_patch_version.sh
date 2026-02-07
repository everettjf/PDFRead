#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Missing required command: node" >&2
  exit 1
fi

CURRENT_VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
NEW_VERSION=$(node -e "
const fs = require('fs');
const path = '$ROOT_DIR/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
const parts = pkg.version.split('.').map(Number);
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  throw new Error('Invalid package.json version: ' + pkg.version);
}
parts[2] += 1;
pkg.version = parts.join('.');
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\\n');
console.log(pkg.version);
")

echo "Bumping version: $CURRENT_VERSION -> $NEW_VERSION"
sed -i '' "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json

echo "Done. Updated version files only (no git tag/push)."
