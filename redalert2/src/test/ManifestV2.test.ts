import { describe, expect, test } from 'bun:test';
import { validateManifestV2 } from '../engine/gameRes/ManifestV2';

describe('validateManifestV2', () => {
    const VALID_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    test('accepts well-formed v2 manifest', () => {
        const manifest = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: 12345678, sha256: VALID_SHA256 },
                { path: 'general.csf', size: 54321, sha256: VALID_SHA256 }
            ]
        };
        const isValid = validateManifestV2(manifest);
        expect(isValid).toBe(true);
        if (validateManifestV2(manifest)) {
            expect(manifest.version).toBe(2);
            expect(manifest.files.length).toBe(2);
            expect(manifest.files[0].sha256).toBe(VALID_SHA256);
        }
    });

    test('rejects v1 manifest (no version field)', () => {
        const v1Manifest = {
            files: [
                { path: 'ra2.mix', size: 12345678 }
            ]
        };
        expect(() => validateManifestV2(v1Manifest)).toThrow(/missing version field/i);
    });

    test('rejects version !== 2', () => {
        const version1 = {
            version: 1,
            files: []
        };
        expect(() => validateManifestV2(version1)).toThrow(/version must be 2/i);

        const version3 = {
            version: 3,
            files: []
        };
        expect(() => validateManifestV2(version3)).toThrow(/version must be 2/i);
    });

    test('rejects entries with missing sha256', () => {
        const missingSha = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: 1000 }
            ]
        };
        expect(() => validateManifestV2(missingSha)).toThrow(/sha256/i);
    });

    test('rejects entries with empty sha256', () => {
        const emptySha = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: 1000, sha256: '' }
            ]
        };
        expect(() => validateManifestV2(emptySha)).toThrow(/sha256/i);
    });

    test('rejects entries with non-hex sha256', () => {
        const nonHexSha = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: 1000, sha256: 'not-a-hex-string-123456' }
            ]
        };
        expect(() => validateManifestV2(nonHexSha)).toThrow(/sha256/i);
    });

    test('rejects entries with wrong length sha256', () => {
        const shortSha = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: 1000, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85' } // 63 chars
            ]
        };
        expect(() => validateManifestV2(shortSha)).toThrow(/sha256/i);
    });

    test('rejects null or non-object manifest', () => {
        expect(() => validateManifestV2(null)).toThrow(/expected an object/i);
        expect(() => validateManifestV2("invalid")).toThrow(/expected an object/i);
    });

    test('rejects non-array files', () => {
        const invalidFiles = {
            version: 2,
            files: "not-an-array"
        };
        expect(() => validateManifestV2(invalidFiles)).toThrow(/"files" field must be an array/i);
    });

    test('rejects file entry with empty path or negative size', () => {
        const invalidPath = {
            version: 2,
            files: [
                { path: '   ', size: 1000, sha256: VALID_SHA256 }
            ]
        };
        expect(() => validateManifestV2(invalidPath)).toThrow(/path must be a non-empty string/i);

        const negativeSize = {
            version: 2,
            files: [
                { path: 'ra2.mix', size: -1, sha256: VALID_SHA256 }
            ]
        };
        expect(() => validateManifestV2(negativeSize)).toThrow(/size must be a non-negative number/i);
    });
});
