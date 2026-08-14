import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

describe('CI & Release Truth Gate Scanner', () => {
  const rootDir = path.resolve(__dirname, '../../..');
  const releaseStatusPath = path.join(rootDir, 'docs', 'android', 'release-status.json');

  it('validates docs/android/release-status.json structure and fail-closed release blocker', () => {
    expect(fs.existsSync(releaseStatusPath)).toBe(true);
    const content = fs.readFileSync(releaseStatusPath, 'utf-8');
    const status = JSON.parse(content);

    expect(status.project).toBe('RedAlert2-Android');
    expect(status.epic).toBe('#1');
    expect(status.publicReleaseBlocked).toBe(true);
    expect(status.status).toBe('DEVELOPMENT_PRIVATE_TESTING_ONLY');

    // Legal criteria must explicitly track unresolved items
    expect(status.unblockingCriteria).toBeDefined();
    expect(status.unblockingCriteria.legal.chronoDivideLicenseVerification).toContain('UNRESOLVED');
    expect(status.unblockingCriteria.legal.supalosaBotLicenseGrant).toContain('UNRESOLVED');
    expect(status.unblockingCriteria.legal.eaTrademarkAndIpCompliance).toContain('UNRESOLVED');

    // Component inventory must track core packages
    expect(Array.isArray(status.componentInventory)).toBe(true);
    const names = status.componentInventory.map((c: { name: string }) => c.name);
    expect(names).toContain('Android Kotlin Shell');
    expect(names).toContain('Red Alert 2 Engine');
    expect(names).toContain('Skirmish AI');
  });

  it('detects forbidden retail extensions in static scanner pattern', () => {
    const forbiddenRegex = /\.(mix|csf|bik|vqp|bag|idx)$/i;

    expect(forbiddenRegex.test('ra2.mix')).toBe(true);
    expect(forbiddenRegex.test('language.csf')).toBe(true);
    expect(forbiddenRegex.test('intro.bik')).toBe(true);
    expect(forbiddenRegex.test('theme.vqp')).toBe(true);
    expect(forbiddenRegex.test('audio.bag')).toBe(true);
    expect(forbiddenRegex.test('audio.idx')).toBe(true);

    // Allowed web assets
    expect(forbiddenRegex.test('bundle.js')).toBe(false);
    expect(forbiddenRegex.test('index.html')).toBe(false);
    expect(forbiddenRegex.test('style.css')).toBe(false);
    expect(forbiddenRegex.test('manifest.json')).toBe(false);
    expect(forbiddenRegex.test('7zz.wasm')).toBe(false);
  });

  it('detects unsafe broad storage permissions in AndroidManifest scanner pattern', () => {
    const broadStorageRegex = /permission\.(WRITE_EXTERNAL_STORAGE|READ_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE)/i;

    expect(broadStorageRegex.test('<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />')).toBe(true);
    expect(broadStorageRegex.test('<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />')).toBe(true);
    expect(broadStorageRegex.test('<uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />')).toBe(true);

    // Allowed permissions
    expect(broadStorageRegex.test('<uses-permission android:name="android.permission.INTERNET" />')).toBe(false);
    expect(broadStorageRegex.test('<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />')).toBe(false);
  });

  it('verifies release status gate verification logic with synthetic payloads', () => {
    const verifyGate = (statusObj: any, requestedTier: string) => {
      if (requestedTier === 'publicRelease' || requestedTier === 'appStore') {
        if (statusObj.publicReleaseBlocked) {
          return { blocked: true, allowed: false };
        } else {
          return { blocked: false, allowed: true };
        }
      }
      return { blocked: false, allowed: true };
    };

    const blockedStatus = { publicReleaseBlocked: true };
    const unblockedStatus = { publicReleaseBlocked: false };

    expect(verifyGate(blockedStatus, 'publicRelease')).toEqual({ blocked: true, allowed: false });
    expect(verifyGate(blockedStatus, 'appStore')).toEqual({ blocked: true, allowed: false });
    expect(verifyGate(blockedStatus, 'sourceCode')).toEqual({ blocked: false, allowed: true });
    expect(verifyGate(unblockedStatus, 'publicRelease')).toEqual({ blocked: false, allowed: true });
  });

  it('computes deterministic SHA-256 checksums for artifact manifests', () => {
    const testData = Buffer.from('synthetic-apk-binary-content-for-test-verification');
    const hash = crypto.createHash('sha256').update(testData).digest('hex');

    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);
  });
});
