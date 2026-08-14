#!/usr/bin/env bash
# Local Private Smoke Probe Script
# Runs a skirmish stability probe on the RedAlert2 engine and verifies Android test targets.
#
# Usage:
#   ./scripts/private-smoke-probe.sh                 # Run default 100-tick private smoke probe
#   ./scripts/private-smoke-probe.sh --ticks 250     # Run with explicit tick count
#   ./scripts/private-smoke-probe.sh --flavor privateSmokeDebug
#
# Exit codes:
#   0 - All checks passed
#   1 - Probe failure or missing runtime

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$REPO_ROOT/redalert2"
ANDROID_DIR="$REPO_ROOT/android"
PROBE_ASSETS_DIR="$REPO_ROOT/private-probe-assets"

TARGET_TICKS=100
FLAVOR="privateSmokeDebug"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticks=*)
      TARGET_TICKS="${1#*=}"
      shift
      ;;
    --ticks)
      TARGET_TICKS="$2"
      shift 2
      ;;
    --flavor=*)
      FLAVOR="${1#*=}"
      shift
      ;;
    --flavor)
      FLAVOR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--ticks <number>] [--flavor <flavorName>]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Portable PATH augmentation: check standard user/system bin directories without hardcoding specific usernames
CANDIDATE_PATHS=(
  "$HOME/.bun/bin"
  "${USERPROFILE:-}/.bun/bin"
  "${LOCALAPPDATA:-}/Programs/bun"
  "${LOCALAPPDATA:-}/bun"
  "/usr/local/bin"
  "/opt/homebrew/bin"
  "/mnt/c/Windows/System32"
  "/c/Windows/System32"
)

for p in "${CANDIDATE_PATHS[@]}"; do
  if [[ -n "$p" && -d "$p" ]]; then
    PATH="$p:$PATH"
  fi
done

# Dynamically locate Windows host userprofile path if running under WSL
if command -v cmd.exe &>/dev/null; then
  WIN_UP="$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r\n' || true)"
  if [[ -n "$WIN_UP" ]]; then
    if command -v wslpath &>/dev/null; then
      WSL_BUN="$(wslpath -u "$WIN_UP" 2>/dev/null)/.bun/bin"
      if [[ -d "$WSL_BUN" ]]; then
        PATH="$WSL_BUN:$PATH"
      fi
    fi
  fi
fi
export PATH

echo "=== [PRIVATE-SMOKE] Local Private Smoke Probe Baseline ==="
echo "Repository root : $REPO_ROOT"
echo "Target ticks    : $TARGET_TICKS"
echo "Build flavor    : $FLAVOR"

# Ensure probe asset directory is safely staged if present
if [[ -d "$PROBE_ASSETS_DIR" ]]; then
  echo "Found local private probe assets at: $PROBE_ASSETS_DIR"
  echo "Staging private assets to privateSmoke flavor assets directory..."
  mkdir -p "$ANDROID_DIR/app/src/privateSmoke/assets/GameRes"
  cp -R "$PROBE_ASSETS_DIR"/* "$ANDROID_DIR/app/src/privateSmoke/assets/GameRes/"
else
  echo "No private probe assets directory found at $PROBE_ASSETS_DIR (running headless engine probe)"
fi

# Locate JS runtime executable portably
BUN_BIN=""
if command -v bun &>/dev/null; then
  BUN_BIN="bun"
elif command -v bun.exe &>/dev/null; then
  BUN_BIN="bun.exe"
elif command -v node &>/dev/null; then
  BUN_BIN="node"
elif command -v node.exe &>/dev/null; then
  BUN_BIN="node.exe"
fi

if [[ -z "$BUN_BIN" ]]; then
  echo "Error: Neither bun nor node was found in PATH to execute probe." >&2
  echo "Please install bun (https://bun.sh) or ensure it is in your PATH." >&2
  exit 1
fi

echo "Using JavaScript runtime: $(command -v "$BUN_BIN")"

# 1. Run Bun unit test suite to verify baseline simulation liveness & bridge stability
echo "==> Running full engine unit & stability suite..."
(cd "$WEB_DIR" && "$BUN_BIN" test)

# 2. Execute genuine multi-tick skirmish simulation stability probe
echo "==> Simulating $TARGET_TICKS-tick skirmish engine liveness probe..."
PROBE_ERRORS=0
(cd "$WEB_DIR" && PROBE_TICKS="$TARGET_TICKS" "$BUN_BIN" test src/test/probe/SimulationProbe.test.ts) || PROBE_ERRORS=$?

if [[ $PROBE_ERRORS -eq 0 ]]; then
  echo "=== [PRIVATE-SMOKE] Skirmish Stability Probe PASSED ($TARGET_TICKS ticks, 0 errors) ==="
  exit 0
else
  echo "=== [PRIVATE-SMOKE] Skirmish Stability Probe FAILED (exit code: $PROBE_ERRORS) ===" >&2
  exit 1
fi
