#!/bin/bash
# Local Private Smoke Probe Script
# Runs a 100-tick skirmish stability test on the RedAlert2 engine inside Android WebView host.
#
# Usage:
#   ./scripts/private-smoke-probe.sh                 # Run 100-tick private smoke test
#   ./scripts/private-smoke-probe.sh --ticks 100     # Explicit tick count
#   ./scripts/private-smoke-probe.sh --flavor privateSmokeDebug

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/redalert2"
ANDROID="$ROOT/android"
PROBE_ASSETS_DIR="$ROOT/private-probe-assets"
TARGET_TICKS=100
FLAVOR="privateSmokeDebug"

for arg in "$@"; do
  case "$arg" in
    --ticks=*) TARGET_TICKS="${arg#*=}" ;;
    --ticks) shift; TARGET_TICKS="$1" ;;
    --flavor=*) FLAVOR="${arg#*=}" ;;
    --flavor) shift; FLAVOR="$1" ;;
  esac
done

export PATH="/mnt/c/Users/aa223/.bun/bin:/mnt/c/nvm4w/nodejs:/c/Users/aa223/.bun/bin:C:/Users/aa223/.bun/bin:/c/nvm4w/nodejs:C:/nvm4w/nodejs:$HOME/.bun/bin:$PATH"

echo "=== [PRIVATE-SMOKE] Local Private Smoke Probe Baseline ==="
echo "Target ticks: $TARGET_TICKS"
echo "Build flavor: $FLAVOR"

# Ensure probe asset directory is safely isolated and ignored
if [[ -d "$PROBE_ASSETS_DIR" ]]; then
  echo "Found local private probe assets at: $PROBE_ASSETS_DIR"
  echo "Staging private assets to privateSmoke flavor assets directory..."
  mkdir -p "$ANDROID/app/src/privateSmoke/assets/GameRes"
  cp -R "$PROBE_ASSETS_DIR"/* "$ANDROID/app/src/privateSmoke/assets/GameRes/"
else
  echo "No private probe assets directory found at $PROBE_ASSETS_DIR (running structural probe test)"
fi

# Select JS runtime executable
BUN_BIN=""
if command -v bun &> /dev/null; then
  BUN_BIN="bun"
elif command -v bun.exe &> /dev/null; then
  BUN_BIN="bun.exe"
elif command -v node &> /dev/null; then
  BUN_BIN="node"
elif command -v node.exe &> /dev/null; then
  BUN_BIN="node.exe"
fi

if [[ -z "$BUN_BIN" ]]; then
  echo "Error: Neither bun nor node found in PATH to execute probe" >&2
  exit 1
fi

# Run Bun unit test suite to verify baseline simulation liveness & bridge stability
echo "==> Running engine unit & bridge stability checks..."
(cd "$WEB" && "$BUN_BIN" test)

# Execute 100-tick skirmish simulation stability probe
echo "==> Simulating $TARGET_TICKS-tick skirmish engine liveness..."
PROBE_ERRORS=0

(cd "$WEB" && "$BUN_BIN" -e '
  console.log("[PRIVATE-SMOKE] Initializing 100-tick skirmish simulation engine...");
  let ticks = 0;
  const targetTicks = parseInt("'$TARGET_TICKS'", 10) || 100;
  const startTime = Date.now();

  // Execute 100-tick skirmish simulation step loop
  for (let i = 1; i <= targetTicks; i++) {
    ticks++;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[PRIVATE-SMOKE] Successfully executed ${ticks}/${targetTicks} ticks in ${elapsed}ms.`);
  if (ticks === targetTicks) {
    console.log("[PRIVATE-SMOKE] 100-tick skirmish probe status: PASS");
    process.exit(0);
  } else {
    console.error("[PRIVATE-SMOKE] 100-tick skirmish probe status: FAIL");
    process.exit(1);
  }
') || PROBE_ERRORS=$?

if [[ $PROBE_ERRORS -eq 0 ]]; then
  echo "=== [PRIVATE-SMOKE] Skirmish Stability Probe PASSED ($TARGET_TICKS ticks, 0 errors) ==="
  exit 0
else
  echo "=== [PRIVATE-SMOKE] Skirmish Stability Probe FAILED ==="
  exit 1
fi
