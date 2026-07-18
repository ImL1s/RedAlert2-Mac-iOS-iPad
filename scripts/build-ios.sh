#!/bin/bash
# Build the RA2 web engine and package it into the iOS shell.
#
# Usage:
#   ./scripts/build-ios.sh              # build web + stage + generate + build for simulator
#   ./scripts/build-ios.sh --no-web     # skip the vite build (reuse existing dist)
#   ./scripts/build-ios.sh --device     # build for a connected device (needs RA2_TEAM_ID)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/redalert2"
IOS="$ROOT/ios"
GAMERES="$ROOT/gameres-export"
export PATH="$HOME/.bun/bin:$PATH"

SKIP_WEB=0
DEVICE=0
for arg in "$@"; do
  case "$arg" in
    --no-web) SKIP_WEB=1 ;;
    --device) DEVICE=1 ;;
  esac
done

if [[ $SKIP_WEB -eq 0 ]]; then
  echo "==> Building web app"
  (cd "$WEB" && bun --bun vite build)
fi

echo "==> Staging WebDist"
rm -rf "$IOS/Resources/WebDist"
mkdir -p "$IOS/Resources"
cp -R "$WEB/dist" "$IOS/Resources/WebDist"
# The 430MB import archive is only needed for browser-based import, not the shell.
rm -rf "$IOS/Resources/WebDist/local-pack"

echo "==> Staging GameRes"
if [[ ! -d "$GAMERES" ]]; then
  echo "error: $GAMERES not found. Export game resources first." >&2
  exit 1
fi
rm -rf "$IOS/Resources/GameRes"
cp -R "$GAMERES" "$IOS/Resources/GameRes"

echo "==> Generating GameRes manifest"
python3 - "$IOS/Resources/GameRes" <<'EOF'
import json, os, sys
root = sys.argv[1]
files = []
for dirpath, _, names in os.walk(root):
    for name in sorted(names):
        if name == ".DS_Store" or name == "manifest.json":
            continue
        full = os.path.join(dirpath, name)
        rel = os.path.relpath(full, root)
        files.append({"path": rel.replace(os.sep, "/"), "size": os.path.getsize(full)})
with open(os.path.join(root, "manifest.json"), "w") as f:
    json.dump({"files": files}, f, indent=1)
print(f"manifest: {len(files)} files, {sum(f['size'] for f in files)/1048576:.1f} MB")
EOF

echo "==> Generating Xcode project"
(cd "$IOS" && RA2_TEAM_ID="${RA2_TEAM_ID:-}" xcodegen generate)

echo "==> Building"
if [[ $DEVICE -eq 1 ]]; then
  xcodebuild -project "$IOS/RA2.xcodeproj" -scheme RA2 \
    -destination 'generic/platform=iOS' \
    -allowProvisioningUpdates build
else
  xcodebuild -project "$IOS/RA2.xcodeproj" -scheme RA2 \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
    build
fi
echo "==> Done"
