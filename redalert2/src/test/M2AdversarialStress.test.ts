import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
    validateManifestV2,
    runOpfsSeeder,
    readSeedState,
    saveSeedState,
    computeSha256Hex,
    SEED_STATE_FILENAME,
    SeedState,
} from '../shell/opfsSeeder';
import { preflightSafManifest } from '../shell/nativeBridge';

describe('M2 Empirical Challenger & Adversarial Stress Suite', () => {
    let originalWindow: any;
    let originalNavigator: any;
    let originalStorage: any;
    let originalFetch: any;

    beforeEach(() => {
        originalWindow = (globalThis as any).window;
        originalNavigator = (globalThis as any).navigator;
        originalStorage = (globalThis as any).localStorage;
        originalFetch = (globalThis as any).fetch;

        (globalThis as any).window = {
            location: { search: '' },
            addEventListener: mock(() => {}),
            removeEventListener: mock(() => {}),
        };
    });

    afterEach(() => {
        (globalThis as any).window = originalWindow;
        (globalThis as any).navigator = originalNavigator;
        (globalThis as any).localStorage = originalStorage;
        (globalThis as any).fetch = originalFetch;
    });

    describe('1. Manifest v2 Validation Stress & Edge Cases', () => {
        test('Rejects invalid manifest versions: 1, 3, "2", null, -1', () => {
            const invalidVersions = [1, 3, '2', null, -1, 0, 2.5];
            for (const ver of invalidVersions) {
                const manifest = {
                    version: ver,
                    created: '2026-08-12T00:00:00Z',
                    files: [{ path: 'test.mix', size: 100 }],
                };
                expect(() => validateManifestV2(manifest)).toThrow();
            }
        });

        test('Rejects non-object or missing manifest root', () => {
            expect(() => validateManifestV2(null)).toThrow('Manifest is not a valid JSON object');
            expect(() => validateManifestV2(undefined)).toThrow('Manifest is not a valid JSON object');
            expect(() => validateManifestV2('{"version": 2}')).toThrow('Manifest is not a valid JSON object');
            expect(() => validateManifestV2(12345)).toThrow('Manifest is not a valid JSON object');
        });

        test('Rejects missing or non-array files property', () => {
            expect(() => validateManifestV2({ version: 2 })).toThrow('Manifest "files" property must be an array');
            expect(() => validateManifestV2({ version: 2, files: null })).toThrow('Manifest "files" property must be an array');
            expect(() => validateManifestV2({ version: 2, files: 'not an array' })).toThrow('Manifest "files" property must be an array');
            expect(() => validateManifestV2({ version: 2, files: {} })).toThrow('Manifest "files" property must be an array');
        });

        test('Rejects path traversal attacks: ../, ..\\, leading /, leading \\, colon :', () => {
            const traversalPaths = [
                '../ra2.mix',
                '..\\ra2.mix',
                'sub/../../ra2.mix',
                'sub\\..\\..\\ra2.mix',
                '/absolute/path.mix',
                '\\windows\\system32',
                'C:\\ra2.mix',
                'http://malicious.com/ra2.mix',
                'file:stream.mix',
                'aux:device.mix',
            ];
            for (const path of traversalPaths) {
                const manifest = {
                    version: 2,
                    files: [{ path, size: 100 }],
                };
                expect(() => validateManifestV2(manifest)).toThrow('Path traversal detected');
            }
        });

        test('Rejects duplicate manifest entry paths', () => {
            const manifest = {
                version: 2,
                files: [
                    { path: 'maps/map1.map', size: 50 },
                    { path: 'maps/map1.map', size: 50 },
                ],
            };
            expect(() => validateManifestV2(manifest)).toThrow('Duplicate manifest entry path: maps/map1.map');
        });

        test('Rejects missing path, empty path, or invalid size fields', () => {
            expect(() => validateManifestV2({ version: 2, files: [{ path: '', size: 100 }] })).toThrow('Manifest file entry missing required non-empty path or valid size');
            expect(() => validateManifestV2({ version: 2, files: [{ size: 100 }] })).toThrow('Manifest file entry missing required non-empty path or valid size');
            expect(() => validateManifestV2({ version: 2, files: [{ path: 'test.mix', size: -1 }] })).toThrow('Manifest file entry missing required non-empty path or valid size');
            expect(() => validateManifestV2({ version: 2, files: [{ path: 'test.mix', size: '100' }] })).toThrow('Manifest file entry missing required non-empty path or valid size');
            expect(() => validateManifestV2({ version: 2, files: [null] })).toThrow('Manifest file entry missing required non-empty path or valid size');
        });

        test('Evaluates size validation under numeric edge cases (NaN, Infinity)', () => {
            // Test if NaN or Infinity trigger errors or bypass size checks
            const manifestNaN = { version: 2, files: [{ path: 'test.mix', size: NaN }] };
            const manifestInf = { version: 2, files: [{ path: 'test.mix', size: Infinity }] };

            // We test whether validateManifestV2 handles NaN or Infinity
            let nanThrew = false;
            try {
                validateManifestV2(manifestNaN);
            } catch {
                nanThrew = true;
            }
            
            let infThrew = false;
            try {
                validateManifestV2(manifestInf);
            } catch {
                infThrew = true;
            }

            // Record findings for report
            console.log(`[Challenger Edge Case] size=NaN threw error: ${nanThrew}`);
            console.log(`[Challenger Edge Case] size=Infinity threw error: ${infThrew}`);
        });

        test('Validates SHA-256 hash tampering during OPFS seeding', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) return { size: createdFiles.get(fileName)!.byteLength };
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => { createdFiles.set(fileName, buf); },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async () => {},
            };
            (globalThis as any).navigator = { storage: { getDirectory: async () => mockRoot } };

            const encoder = new TextEncoder();
            const realBuf = encoder.encode('authentic_game_file_content').buffer;
            const tamperedHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [{ path: 'ra2.mix', size: realBuf.byteLength, sha256: tamperedHash }],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return { ok: true, arrayBuffer: async () => realBuf };
                }
                return { ok: false, status: 404 };
            });

            await expect(runOpfsSeeder(() => {})).rejects.toThrow('SHA-256 mismatch');
        });

        test('Handles missing file (404 HTTP status) during OPFS seeding', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => { throw new Error('Not found'); },
                    createWritable: async () => ({
                        write: async (buf: any) => { createdFiles.set(fileName, buf); },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async () => {},
            };
            (globalThis as any).navigator = { storage: { getDirectory: async () => mockRoot } };

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [{ path: 'missing.mix', size: 500, sha256: '' }],
                        }),
                    };
                }
                if (url === '/gameres/missing.mix') {
                    return { ok: false, status: 404 };
                }
                return { ok: false, status: 404 };
            });

            await expect(runOpfsSeeder(() => {})).rejects.toThrow('Failed to fetch bundled resource "missing.mix" (404)');
        });
    });

    describe('2. Native Preflight & Insufficient Storage Stress Tests', () => {
        test('Propagates INSUFFICIENT_STORAGE error code from Native SAF bridge', async () => {
            (globalThis as any).window.AndroidNativeBridge = {
                preflightSafManifest: () => JSON.stringify({
                    valid: false,
                    status: 'INSUFFICIENT_STORAGE',
                    error: 'Available disk space (1000 bytes) is less than required safety margin (1100 bytes)',
                    requiredBytes: 1100,
                    availableBytes: 1000,
                }),
            };

            const result = await preflightSafManifest();
            expect(result.valid).toBe(false);
            expect(result.status).toBe('INSUFFICIENT_STORAGE');
            expect(result.requiredBytes).toBe(1100);
            expect(result.availableBytes).toBe(1000);
        });

        test('Propagates HASH_MISMATCH error code from Native SAF bridge', async () => {
            (globalThis as any).window.AndroidNativeBridge = {
                preflightSafManifest: () => JSON.stringify({
                    valid: false,
                    status: 'HASH_MISMATCH',
                    failedFile: 'theme.mix',
                    error: 'SHA-256 hash mismatch for theme.mix',
                }),
            };

            const result = await preflightSafManifest();
            expect(result.valid).toBe(false);
            expect(result.status).toBe('HASH_MISMATCH');
            expect(result.failedFile).toBe('theme.mix');
        });
    });

    describe('3. OPFS Seeder State Machine & Recovery Stress Tests', () => {
        test('Recovers gracefully from corrupted .seed_state.json (malformed JSON text)', async () => {
            const createdFiles = new Map<string, ArrayBuffer>();
            const encoder = new TextEncoder();

            // Insert corrupted JSON into .seed_state.json
            createdFiles.set(SEED_STATE_FILENAME, encoder.encode('{ corrupted json string: [unclosed').buffer);

            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) return { size: createdFiles.get(fileName)!.byteLength, text: async () => new TextDecoder().decode(createdFiles.get(fileName)!) };
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => {
                            if (typeof buf === 'string') createdFiles.set(fileName, encoder.encode(buf).buffer);
                            else createdFiles.set(fileName, buf);
                        },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async () => {},
            };

            const state = await readSeedState(mockRoot);
            expect(state).toBeNull();
        });

        test('Recovers gracefully from invalid SeedState schema (version != 2)', async () => {
            const createdFiles = new Map<string, ArrayBuffer>();
            const encoder = new TextEncoder();

            const invalidState = JSON.stringify({ version: 1, status: 'COMPLETED', files: {} });
            createdFiles.set(SEED_STATE_FILENAME, encoder.encode(invalidState).buffer);

            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) return { size: createdFiles.get(fileName)!.byteLength, text: async () => new TextDecoder().decode(createdFiles.get(fileName)!) };
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => {},
                        close: async () => {},
                    }),
                }),
            };

            const state = await readSeedState(mockRoot);
            expect(state).toBeNull();
        });

        test('Cleans up and overwrites partial .tmp files upon process resume', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const removedFiles: string[] = [];
            const encoder = new TextEncoder();

            // Simulate leftover .tmp file from previous crashed run
            createdFiles.set('ra2.mix.tmp', encoder.encode('partial_leftover_data').buffer);

            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) return { size: createdFiles.get(fileName)!.byteLength };
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => { createdFiles.set(fileName, buf); },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async (fn: string) => {
                    removedFiles.push(fn);
                    createdFiles.delete(fn);
                },
            };
            (globalThis as any).navigator = { storage: { getDirectory: async () => mockRoot } };

            const fileBuf = encoder.encode('full_valid_content').buffer;
            const fileHash = await computeSha256Hex(fileBuf);

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [{ path: 'ra2.mix', size: fileBuf.byteLength, sha256: fileHash }],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return { ok: true, arrayBuffer: async () => fileBuf };
                }
                return { ok: false, status: 404 };
            });

            const count = await runOpfsSeeder(() => {});
            expect(count).toBe(1);
            expect(createdFiles.has('ra2.mix')).toBe(true);
            expect(removedFiles).toContain('ra2.mix.tmp');
            expect(createdFiles.has('ra2.mix.tmp')).toBe(false);
        });

        test('Verifies seeder idempotence: second run skips already verified complete files', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const encoder = new TextEncoder();

            const fileBuf = encoder.encode('repeatable_file_data').buffer;
            const fileHash = await computeSha256Hex(fileBuf);

            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) {
                            return {
                                size: createdFiles.get(fileName)!.byteLength,
                                text: async () => new TextDecoder().decode(createdFiles.get(fileName)!),
                            };
                        }
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => {
                            if (typeof buf === 'string') createdFiles.set(fileName, encoder.encode(buf).buffer);
                            else createdFiles.set(fileName, buf);
                        },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async () => {},
            };
            (globalThis as any).navigator = { storage: { getDirectory: async () => mockRoot } };

            let fetchCount = 0;
            (globalThis as any).fetch = mock(async (url: string) => {
                fetchCount++;
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [{ path: 'ra2.mix', size: fileBuf.byteLength, sha256: fileHash }],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return { ok: true, arrayBuffer: async () => fileBuf };
                }
                return { ok: false, status: 404 };
            });

            // First run: downloads and seeds file
            const run1Wrote = await runOpfsSeeder(() => {});
            expect(run1Wrote).toBe(1);
            const fetchesFirstRun = fetchCount;

            // Second run: should discover completed state and return 0 wrote files
            const run2Wrote = await runOpfsSeeder(() => {});
            expect(run2Wrote).toBe(0);
            // Fetch should only be called once for manifest on second run, NOT for ra2.mix
            expect(fetchCount - fetchesFirstRun).toBe(1);
        });

        test('Self-healing state: resets VERIFIED_COMPLETE to PENDING if local file on disk is corrupted/truncated', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const encoder = new TextEncoder();

            const fileBuf = encoder.encode('original_full_length_data').buffer;
            const fileHash = await computeSha256Hex(fileBuf);

            // Pre-seed state marked VERIFIED_COMPLETE, but simulate file on disk truncated by user/crash
            const initialSeedState: SeedState = {
                version: 2,
                manifestHash: `ra2.mix:${fileBuf.byteLength}:${fileHash}`,
                status: 'SEEDING',
                totalFiles: 1,
                totalBytes: fileBuf.byteLength,
                completedBytes: fileBuf.byteLength,
                files: {
                    'ra2.mix': {
                        path: 'ra2.mix',
                        size: fileBuf.byteLength,
                        sha256: fileHash,
                        status: 'VERIFIED_COMPLETE',
                        bytesWritten: fileBuf.byteLength,
                    },
                },
            };

            createdFiles.set(SEED_STATE_FILENAME, encoder.encode(JSON.stringify(initialSeedState)).buffer);
            // Truncated file on disk (size 5 instead of fileBuf.byteLength)
            createdFiles.set('ra2.mix', encoder.encode('trunc').buffer);

            const mockRoot: any = {
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (createdFiles.has(fileName)) {
                            return {
                                size: createdFiles.get(fileName)!.byteLength,
                                text: async () => new TextDecoder().decode(createdFiles.get(fileName)!),
                            };
                        }
                        throw new Error('Not found');
                    },
                    createWritable: async () => ({
                        write: async (buf: any) => {
                            if (typeof buf === 'string') createdFiles.set(fileName, encoder.encode(buf).buffer);
                            else createdFiles.set(fileName, buf);
                        },
                        close: async () => {},
                    }),
                }),
                getDirectoryHandle: async () => mockRoot,
                removeEntry: async () => {},
            };
            (globalThis as any).navigator = { storage: { getDirectory: async () => mockRoot } };

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [{ path: 'ra2.mix', size: fileBuf.byteLength, sha256: fileHash }],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return { ok: true, arrayBuffer: async () => fileBuf };
                }
                return { ok: false, status: 404 };
            });

            // Execution: seeder detects truncated ra2.mix on disk, resets status to PENDING, re-downloads and completes
            const count = await runOpfsSeeder(() => {});
            expect(count).toBe(1);
            expect(createdFiles.get('ra2.mix')!.byteLength).toBe(fileBuf.byteLength);
        });
    });
});
