#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "      STATIC NO-RETAIL ASSET & SECURITY SCANNER   "
echo "=================================================="

VIOLATIONS=0

ALLOWED_RA2CD_SHA256="163a264c6f2344662b0c457ab5b9bd8a9bd5562a05aa3cbe8fd0951f5f88ee79"

# 1. Git Commit History Check
echo "[1/5] Checking Git Commit History for Retail Assets..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BASELINE_SHA="991945d60a7139d3c4c438326abb6d3c093b2497"
  if git rev-parse "$BASELINE_SHA" >/dev/null 2>&1; then
    LOG_RANGE="$BASELINE_SHA..HEAD"
  else
    LOG_RANGE="-n 30"
  fi
  # Forbidden commit paths (excluding project-authored ra2cd.mix)
  FORBIDDEN_COMMITS=$(git log $LOG_RANGE --name-status --format="" 2>/dev/null | grep -iE '^[AM].*\.(mix|csf|bik|vqp|bag|idx)$' | grep -v "ra2cd.mix" || true)
  if [ -n "$FORBIDDEN_COMMITS" ]; then
    echo "ERROR: Retail asset files detected in Git commit history:" >&2
    echo "$FORBIDDEN_COMMITS" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "  -> Clean: Zero retail assets found in Git commit history."
  fi
else
  echo "  -> Skipped: Not inside a Git repository."
fi

# 2. Git Tracked Files Check
echo "[2/5] Checking Tracked Files in Git Index..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # Find any tracked forbidden files
  TRACKED_FORBIDDEN=$(git ls-files 2>/dev/null | grep -iE '(\.(mix|csf|bik|vqp|bag|idx)$|private-probe-assets/|private-smoke-assets/)' || true)
  
  # Allow only project-authored ra2cd.mix with verified hash
  for FILE in $TRACKED_FORBIDDEN; do
    if [ "$FILE" = "redalert2/public/res/ra2cd.mix" ]; then
      if [ -f "$FILE" ]; then
        ACTUAL_HASH=$(python3 -c "import hashlib; print(hashlib.sha256(open('$FILE','rb').read()).hexdigest())" 2>/dev/null || node -e "const crypto=require('crypto'),fs=require('fs');console.log(crypto.createHash('sha256').update(fs.readFileSync('$FILE')).digest('hex'))" 2>/dev/null || true)
        if [ "$ACTUAL_HASH" != "$ALLOWED_RA2CD_SHA256" ]; then
          echo "ERROR: Tracked ra2cd.mix hash mismatch! Expected $ALLOWED_RA2CD_SHA256 but got $ACTUAL_HASH" >&2
          VIOLATIONS=$((VIOLATIONS + 1))
        fi
      fi
    else
      echo "ERROR: Forbidden retail asset or private probe file tracked in Git index: $FILE" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done

  if [ $VIOLATIONS -eq 0 ]; then
    echo "  -> Clean: Zero unauthorized forbidden files tracked in Git index."
  fi
fi

# 3. Workspace Assets Scan
echo "[3/5] Scanning Workspace Assets Directory (WebDist & public)..."
SCAN_PATHS=("android/app/src/main/assets" "redalert2/public")
for SCAN_PATH in "${SCAN_PATHS[@]}"; do
  if [ -d "$SCAN_PATH" ]; then
    FOUND_FILES=$(find "$SCAN_PATH" -type f \( -name "*.mix" -o -name "*.csf" -o -name "*.bik" -o -name "*.vqp" -o -name "*.bag" \) 2>/dev/null || true)
    for FILE in $FOUND_FILES; do
      if [ "$FILE" = "redalert2/public/res/ra2cd.mix" ] || [ "$FILE" = "android/app/src/main/assets/WebDist/res/ra2cd.mix" ]; then
        ACTUAL_HASH=$(python3 -c "import hashlib; print(hashlib.sha256(open('$FILE','rb').read()).hexdigest())" 2>/dev/null || node -e "const crypto=require('crypto'),fs=require('fs');console.log(crypto.createHash('sha256').update(fs.readFileSync('$FILE')).digest('hex'))" 2>/dev/null || true)
        if [ "$ACTUAL_HASH" != "$ALLOWED_RA2CD_SHA256" ]; then
          echo "ERROR: Workspace $FILE hash mismatch! Expected $ALLOWED_RA2CD_SHA256 but got $ACTUAL_HASH" >&2
          VIOLATIONS=$((VIOLATIONS + 1))
        fi
      else
        echo "ERROR: Unauthorized retail asset file found in $SCAN_PATH: $FILE" >&2
        VIOLATIONS=$((VIOLATIONS + 1))
      fi
    done
  fi
done
if [ $VIOLATIONS -eq 0 ]; then
  echo "  -> Clean: Zero retail asset files found in workspace."
fi

# 4. AndroidManifest Permissions Check
echo "[4/5] Inspecting AndroidManifest.xml Permissions..."
MANIFEST_FILE="android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST_FILE" ]; then
  if grep -iE 'permission\.(WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)' "$MANIFEST_FILE" >/dev/null 2>&1; then
    echo "ERROR: Unsafe broad storage permissions requested in AndroidManifest.xml!" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  else
    echo "  -> Clean: Zero broad storage permissions requested (SAF enforced)."
  fi
else
  echo "  -> Warning: AndroidManifest.xml not found at $MANIFEST_FILE"
fi

# 5. Compiled APK ZIP Contents Scan (if APK exists)
echo "[5/5] Checking Compiled APK ZIP Contents..."
APK_PATH="${1:-android/app/build/outputs/apk/publicCi/debug/app-publicCi-debug.apk}"
if [ -f "$APK_PATH" ]; then
  echo "Inspecting compiled APK at: $APK_PATH"
  if command -v unzip >/dev/null 2>&1; then
    APK_FILES=$(unzip -l "$APK_PATH" | awk '{print $4}' | grep -iE '\.(mix|csf|bik|vqp|bag|idx)$' || true)
  else
    APK_FILES=$(python3 -c "
import zipfile, sys
with zipfile.ZipFile('$APK_PATH', 'r') as z:
    for name in z.namelist():
        if name.lower().endswith(('.mix','.csf','.bik','.vqp','.bag','.idx')):
            print(name)
" 2>/dev/null || true)
  fi

  for FILE in $APK_FILES; do
    if [[ "$FILE" =~ assets/WebDist/res/ra2cd\.mix$ ]]; then
      # ra2cd.mix in WebDist is allowed if stripped
      continue
    fi
    echo "ERROR: Unauthorized retail asset file found inside compiled APK: $FILE" >&2
    VIOLATIONS=$((VIOLATIONS + 1))
  done

  if [ $VIOLATIONS -eq 0 ]; then
    echo "  -> Clean: Zero unauthorized retail assets found inside compiled APK."
  fi
else
  echo "  -> Info: APK file not found at $APK_PATH (run build first to inspect APK)."
fi

echo "=================================================="
if [ $VIOLATIONS -gt 0 ]; then
  echo " FAIL: Security scan failed with $VIOLATIONS violation(s)." >&2
  exit 1
else
  echo " PASS: Security scan clean. Zero retail asset leakage."
  exit 0
fi
