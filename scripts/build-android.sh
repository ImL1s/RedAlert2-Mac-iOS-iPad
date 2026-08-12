#!/bin/bash
# Build the RA2 web engine and package it into the Android Kotlin shell.
#
# Usage:
#   ./scripts/build-android.sh              # build web + stage + build debug APK
#   ./scripts/build-android.sh --no-web     # skip vite build (reuse dist)
#   ./scripts/build-android.sh --release    # assemble release APK
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/redalert2"
ANDROID="$ROOT/android"
ASSETS_WEBDIST="$ANDROID/app/src/main/assets/WebDist"
export PATH="/mnt/c/Users/aa223/.bun/bin:/mnt/c/nvm4w/nodejs:/c/Users/aa223/.bun/bin:C:/Users/aa223/.bun/bin:/c/nvm4w/nodejs:C:/nvm4w/nodejs:$HOME/.bun/bin:$PATH"

SKIP_WEB=0
BUILD_TYPE="assembleDebug"

for arg in "$@"; do
  case "$arg" in
    --no-web) SKIP_WEB=1 ;;
    --release) BUILD_TYPE="assembleRelease" ;;
  esac
done

if [[ $SKIP_WEB -eq 0 ]]; then
  echo "==> Building web app (vite build)"
  if command -v bun &> /dev/null; then
    (cd "$WEB" && bun --bun vite build)
  elif command -v bun.exe &> /dev/null; then
    (cd "$WEB" && bun.exe --bun vite build)
  elif command -v node &> /dev/null; then
    (cd "$WEB" && node ./node_modules/vite/bin/vite.js build)
  elif command -v node.exe &> /dev/null; then
    (cd "$WEB" && node.exe ./node_modules/vite/bin/vite.js build)
  else
    echo "Error: Neither bun nor node found to build web app" >&2
    exit 1
  fi
fi

echo "==> Staging WebDist to Android assets"
rm -rf "$ASSETS_WEBDIST"
mkdir -p "$ANDROID/app/src/main/assets"
cp -R "$WEB/dist" "$ASSETS_WEBDIST"

# Remove 430MB import archive if present (browser-only asset)
rm -rf "$ASSETS_WEBDIST/local-pack"

echo "==> Staged assets summary:"
du -sh "$ASSETS_WEBDIST"

echo "==> Verifying no retail assets exist in WebDist"
if find "$ASSETS_WEBDIST" \( -name "*.mix" -o -name "*.csf" \) 2>/dev/null | grep -q .; then
  echo "ERROR: Retail asset leakage detected in WebDist! Found .mix or .csf files:" >&2
  find "$ASSETS_WEBDIST" \( -name "*.mix" -o -name "*.csf" \) >&2
  exit 1
fi

if [[ -f "$ANDROID/gradlew" ]]; then
  echo "==> Building Android application ($BUILD_TYPE)"
  (cd "$ANDROID" && ./gradlew "$BUILD_TYPE")
  echo "==> Build complete"
else
  echo "==> Android Gradle wrapper script staged."
fi
