import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
    validateManifestV2,
    runOpfsSeeder,
    readSeedState,
    saveSeedState,
    computeSha256Hex,
    SEED_STATE_FILENAME,
    ManifestV2,
} from '../shell/opfsSeeder';
import {
    getSafStatus,
    requestSafPicker,
    preflightSafManifest,
    SafStatus,
} from '../shell/nativeBridge';

describe('Milestone M2 Unit & Integration Test Suite', () => {
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

    describe('1. Manifest v2 Preflight Validation Unit Tests', () => {
        test('Validates compliant Manifest v2 structure', () => {
            const manifest = {
                version: 2,
                created: '2026-08-12T00:00:00Z',
                files: [
                    { path: 'ra2.mix', size: 100, sha256: 'a'.repeat(64) },
                    { path: 'language.mix', size: 200, sha256: 'b'.repeat(64) },
                ],
            };
            const validated = validateManifestV2(manifest);
            expect(validated.version).toBe(2);
            expect(validated.files.length).toBe(2);
        });

        test('Rejects non-version 2 manifests fail-closed', () => {
            const manifestV1 = {
                version: 1,
                files: [{ path: 'test.mix', size: 50 }],
            };
            expect(() => validateManifestV2(manifestV1)).toThrow('Unsupported manifest version: 1');
        });

        test('Rejects path traversal strings in manifest entries', () => {
            const invalidPaths = [
                '../etc/passwd',
                '../../ra2.mix',
                '/absolute/path.mix',
                'c:\\windows\\system32',
                'path:with:colon',
            ];
            for (const path of invalidPaths) {
                const manifest = {
                    version: 2,
                    files: [{ path, size: 100 }],
                };
                expect(() => validateManifestV2(manifest)).toThrow('Path traversal detected');
            }
        });

        test('Rejects duplicate file paths in manifest', () => {
            const manifest = {
                version: 2,
                files: [
                    { path: 'duplicate.mix', size: 100 },
                    { path: 'duplicate.mix', size: 100 },
                ],
            };
            expect(() => validateManifestV2(manifest)).toThrow('Duplicate manifest entry path');
        });

        test('Rejects missing path or invalid size fields', () => {
            expect(() => validateManifestV2({ version: 2, files: [{ path: '', size: 100 }] })).toThrow();
            expect(() => validateManifestV2({ version: 2, files: [{ path: 'test.mix', size: -5 }] })).toThrow();
            expect(() => validateManifestV2('not an object')).toThrow('Manifest is not a valid JSON object');
        });
    });

    describe('2. Native SAF Status & Preflight Bridge Integration Tests', () => {
        test('getSafStatus returns authorized default in non-android environment', async () => {
            delete (globalThis as any).window.AndroidNativeBridge;
            const status = await getSafStatus();
            expect(status.status).toBe('authorized');
        });

        test('getSafStatus parses AndroidNativeBridge JSON output', async () => {
            (globalThis as any).window.AndroidNativeBridge = {
                getSafStatus: () => JSON.stringify({ status: 'authorized', uri: 'content://tree/123', packName: 'RA2_Pack' }),
            };
            const status = await getSafStatus();
            expect(status.status).toBe('authorized');
            expect(status.uri).toBe('content://tree/123');
            expect(status.packName).toBe('RA2_Pack');
        });

        test('requestSafPicker invokes native picker and resolves with callback', async () => {
            let pickerLaunched = false;
            (globalThis as any).window.AndroidNativeBridge = {
                launchSafPicker: () => {
                    pickerLaunched = true;
                    setTimeout(() => {
                        (globalThis as any).window.__RA2_ON_SAF_RESULT__({
                            success: true,
                            uri: 'content://selected/tree',
                        });
                    }, 10);
                },
            };

            const result = await requestSafPicker();
            expect(pickerLaunched).toBe(true);
            expect(result.status).toBe('authorized');
            expect(result.uri).toBe('content://selected/tree');
        });

        test('preflightSafManifest delegates to native bridge on Android', async () => {
            (globalThis as any).window.AndroidNativeBridge = {
                preflightSafManifest: () => JSON.stringify({
                    valid: true,
                    status: 'VALID',
                    fileCount: 5,
                    totalBytes: 500,
                }),
            };
            const preflight = await preflightSafManifest();
            expect(preflight.valid).toBe(true);
            expect(preflight.fileCount).toBe(5);
        });
    });

    describe('3. OPFS Seeder State Machine & Resumability Tests', () => {
        test('computeSha256Hex returns valid 64-char hex string for buffer', async () => {
            const encoder = new TextEncoder();
            const data = encoder.encode('Hello RedAlert2');
            const hash = await computeSha256Hex(data.buffer);
            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        test('runOpfsSeeder writes atomic .tmp staging file and persists state in .seed_state.json', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

            const createdFiles = new Map<string, ArrayBuffer>();
            const dirMap = new Map<string, any>();

            const createMockFileHandle = (fileName: string) => {
                return {
                    getFile: async () => {
                        if (createdFiles.has(fileName)) {
                            return { size: createdFiles.get(fileName)!.byteLength };
                        }
                        throw new Error(`File not found: ${fileName}`);
                    },
                    createWritable: async () => ({
                        write: async (buf: ArrayBuffer | string) => {
                            if (typeof buf === 'string') {
                                const enc = new TextEncoder();
                                createdFiles.set(fileName, enc.encode(buf).buffer);
                            } else {
                                createdFiles.set(fileName, buf);
                            }
                        },
                        close: async () => {},
                    }),
                };
            };

            const mockRoot: any = {
                getFileHandle: async (fileName: string, opts?: any) => {
                    return createMockFileHandle(fileName);
                },
                getDirectoryHandle: async (dirName: string, opts?: any) => {
                    if (!dirMap.has(dirName)) {
                        dirMap.set(dirName, {
                            getFileHandle: async (fn: string) => createMockFileHandle(`${dirName}/${fn}`),
                            getDirectoryHandle: async () => mockRoot,
                            removeEntry: async () => {},
                        });
                    }
                    return dirMap.get(dirName);
                },
                removeEntry: async () => {},
            };

            (globalThis as any).navigator = {
                storage: { getDirectory: async () => mockRoot },
            };

            const localStorageMap = new Map<string, string>();
            (globalThis as any).localStorage = {
                getItem: (k: string) => localStorageMap.get(k) ?? null,
                setItem: (k: string, v: string) => localStorageMap.set(k, v),
            };

            const encoder = new TextEncoder();
            const file1Buf = encoder.encode('file1_data').buffer;
            const file1Hash = await computeSha256Hex(file1Buf);

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            created: '2026-08-12T00:00:00Z',
                            files: [
                                { path: 'ra2.mix', size: file1Buf.byteLength, sha256: file1Hash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return {
                        ok: true,
                        arrayBuffer: async () => file1Buf,
                    };
                }
                return { ok: false, status: 404 };
            });

            const progressLogs: string[] = [];
            const wroteCount = await runOpfsSeeder((txt) => progressLogs.push(txt));

            expect(wroteCount).toBe(1);
            expect(createdFiles.has(SEED_STATE_FILENAME)).toBe(true);
            expect(createdFiles.has('ra2.mix')).toBe(true);

            // Read state JSON content
            const stateText = new TextDecoder().decode(createdFiles.get(SEED_STATE_FILENAME)!);
            const state = JSON.parse(stateText);
            expect(state.status).toBe('COMPLETED');
            expect(state.files['ra2.mix'].status).toBe('VERIFIED_COMPLETE');
        });

        test('runOpfsSeeder rejects file when SHA-256 hash does not match manifest', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

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

            (globalThis as any).navigator = {
                storage: { getDirectory: async () => mockRoot },
            };

            const encoder = new TextEncoder();
            const realBuf = encoder.encode('real_content').buffer;
            const tamperedBuf = encoder.encode('tampered_content').buffer;
            const realHash = await computeSha256Hex(realBuf);

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [
                                { path: 'corrupt.mix', size: tamperedBuf.byteLength, sha256: realHash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/corrupt.mix') {
                    return {
                        ok: true,
                        arrayBuffer: async () => tamperedBuf,
                    };
                }
                return { ok: false, status: 404 };
            });

            await expect(runOpfsSeeder(() => {})).rejects.toThrow('SHA-256 mismatch for resource "corrupt.mix"');
        });
    });
});
