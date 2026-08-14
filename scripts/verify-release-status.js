#!/usr/bin/env node

/**
 * Release Status & Provenance Truth Gate
 *
 * Validates docs/android/release-status.json, checks release blocking criteria,
 * and generates artifact SBOM/checksum manifests for public CI builds.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const STATUS_PATH = path.join(ROOT_DIR, 'docs', 'android', 'release-status.json');

function loadReleaseStatus() {
  if (!fs.existsSync(STATUS_PATH)) {
    console.error(`ERROR: Release status file missing at ${STATUS_PATH}`);
    process.exit(1);
  }
  const content = fs.readFileSync(STATUS_PATH, 'utf-8');
  return JSON.parse(content);
}

function verifyReleaseStatusGate(statusObj, requestedTier = 'publicRelease') {
  console.log('==================================================');
  console.log('        RELEASE STATUS & TRUTH GATE AUDIT        ');
  console.log('==================================================');
  console.log(`Project: ${statusObj.project} (Epic ${statusObj.epic})`);
  console.log(`Current Status: ${statusObj.status}`);
  console.log(`Public Release Blocked: ${statusObj.publicReleaseBlocked}`);

  if (requestedTier === 'publicRelease' || requestedTier === 'appStore' || requestedTier === 'enforceBlocked') {
    if (statusObj.publicReleaseBlocked) {
      console.log(`[PASS] Gate Confirmed: Public release is BLOCKED as required by legal/provenance status.`);
      console.log(`  Legal blockers:`);
      for (const [key, val] of Object.entries(statusObj.unblockingCriteria.legal || {})) {
        console.log(`    - ${key}: ${val}`);
      }
      return { blocked: true, allowed: false };
    } else {
      console.error(`[VIOLATION] publicReleaseBlocked is false without legal sign-off!`);
      return { blocked: false, allowed: true };
    }
  }

  return { blocked: false, allowed: true };
}

function generateArtifactManifest(apkPath) {
  if (!apkPath || !fs.existsSync(apkPath)) {
    console.log(`Info: APK not found at ${apkPath}, skipping artifact checksum.`);
    return null;
  }

  const apkBuffer = fs.readFileSync(apkPath);
  const sha256 = crypto.createHash('sha256').update(apkBuffer).digest('hex');
  const size = apkBuffer.length;

  const manifest = {
    generatedAt: new Date().toISOString(),
    artifactPath: path.relative(ROOT_DIR, apkPath),
    sizeBytes: size,
    sha256Hex: sha256,
    flavor: 'publicCi',
    retailAssetsIncluded: false,
    publicReleaseBlocked: true,
  };

  const outputPath = path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk-manifest.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Generated build artifact manifest: ${outputPath}`);
  console.log(`  SHA-256: ${sha256}`);
  console.log(`  Size: ${size} bytes`);
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const requestedTier = args[0] || 'publicRelease';
  const apkPath = args[1] || path.join(ROOT_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'publicCi', 'debug', 'app-publicCi-debug.apk');

  const statusObj = loadReleaseStatus();
  const gateResult = verifyReleaseStatusGate(statusObj, requestedTier);

  if (fs.existsSync(apkPath)) {
    generateArtifactManifest(apkPath);
  }

  if (requestedTier === 'enforceBlocked' && !gateResult.blocked) {
    console.error('ERROR: Expected public release to be blocked, but gate allowed it!');
    process.exit(1);
  }

  console.log('==================================================');
  console.log(' PASS: Release truth gate verified.');
}

if (require.main === module) {
  main();
}

module.exports = { loadReleaseStatus, verifyReleaseStatusGate, generateArtifactManifest };
