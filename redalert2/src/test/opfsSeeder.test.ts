import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
    computeSha256Hex,
    runOpfsSeeder,
    readSeedState,
    saveSeedState,
    SEED_STATE_FILENAME,
    SeedState
} from '../shell/opfsSeeder';
import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';

describe('OPFS Seeder', () => {
    describe('computeSha256Hex', () => {
        test('computes correct 64-char hex string for buffer', async () => {
            const encoder = new TextEncoder();
            const data = encoder.encode('Hello RedAlert2 OPFS Seeder');
            const hash = await computeSha256Hex(data.buffer);
            expect(hash).toHaveLength(64);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });
    });

    describe('runOpfsSeeder state persistence, resumption, and self-healing', () => {
        let createdFiles: Map<string, Uint8Array>;
        let dirMap: Map<string, any>;
        let localStorageMap: Map<string, string>;
        let mockRoot: any;

        const createMockFileHandle = (fileName: string) => {
            return {
                getFile: async () => {
                    if (createdFiles.has(fileName)) {
                        const content = createdFiles.get(fileName)!;
                        return {
                            size: content.byteLength,
                            text: async () => new TextDecoder().decode(content),
                            arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
                        };
                    }
                    throw new Error(`File not found: ${fileName}`);
                },
                createWritable: async () => ({
                    write: async (buf: Uint8Array | ArrayBuffer | string) => {
                        if (typeof buf === 'string') {
                            createdFiles.set(fileName, new TextEncoder().encode(buf));
                        } else if (buf instanceof Uint8Array) {
                            const existing = createdFiles.get(fileName);
                            if (existing) {
                                const merged = new Uint8Array(existing.byteLength + buf.byteLength);
                                merged.set(existing, 0);
                                merged.set(buf, existing.byteLength);
                                createdFiles.set(fileName, merged);
                            } else {
                                createdFiles.set(fileName, new Uint8Array(buf));
                            }
                        } else {
                            const uint8 = new Uint8Array(buf);
                            createdFiles.set(fileName, uint8);
                        }
                    },
                    close: async () => {},
                }),
            };
        };

        beforeEach(() => {
            createdFiles = new Map<string, Uint8Array>();
            dirMap = new Map<string, any>();
            localStorageMap = new Map<string, string>();

            mockRoot = {
                getFileHandle: async (fileName: string, opts?: any) => {
                    if (opts?.create || createdFiles.has(fileName)) {
                        return createMockFileHandle(fileName);
                    }
                    throw new Error(`File not found: ${fileName}`);
                },
                getDirectoryHandle: async (dirName: string, opts?: any) => {
                    if (!dirMap.has(dirName)) {
                        const subDir: any = {
                            getFileHandle: async (fn: string, o?: any) => {
                                const fullPath = `${dirName}/${fn}`;
                                if (o?.create || createdFiles.has(fullPath)) {
                                    return createMockFileHandle(fullPath);
                                }
                                throw new Error(`File not found: ${fullPath}`);
                            },
                            getDirectoryHandle: async () => subDir,
                            removeEntry: async (fn: string) => {
                                createdFiles.delete(`${dirName}/${fn}`);
                            },
                        };
                        dirMap.set(dirName, subDir);
                    }
                    return dirMap.get(dirName);
                },
                removeEntry: async (fn: string) => {
                    createdFiles.delete(fn);
                },
            };

            (globalThis as any).navigator = {
                storage: { getDirectory: async () => mockRoot },
            };

            (globalThis as any).localStorage = {
                getItem: (k: string) => localStorageMap.get(k) ?? null,
                setItem: (k: string, v: string) => localStorageMap.set(k, v),
            };

            (globalThis as any).window = {
                __RA2_SHELL__: { platform: 'android', version: '0.1.0' },
                location: { search: '' },
            };
        });

        test('seeds all files fresh, writes .seed_state.json, and sets GameRes in localStorage', async () => {
            const enc = new TextEncoder();
            const ra2Data = enc.encode('ra2_mix_content');
            const audioData = enc.encode('audio_bag_content');
            const ra2Hash = await computeSha256Hex(ra2Data);
            const audioHash = await computeSha256Hex(audioData);

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [
                                { path: 'ra2.mix', size: ra2Data.byteLength, sha256: ra2Hash },
                                { path: 'audio.bag', size: audioData.byteLength, sha256: audioHash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    return {
                        ok: true,
                        body: {
                            getReader: () => {
                                let done = false;
                                return {
                                    read: async () => {
                                        if (done) return { done: true, value: undefined };
                                        done = true;
                                        return { done: false, value: ra2Data };
                                    },
                                    releaseLock: () => {},
                                };
                            },
                        },
                    };
                }
                if (url === '/gameres/audio.bag') {
                    return {
                        ok: true,
                        body: {
                            getReader: () => {
                                let done = false;
                                return {
                                    read: async () => {
                                        if (done) return { done: true, value: undefined };
                                        done = true;
                                        return { done: false, value: audioData };
                                    },
                                    releaseLock: () => {},
                                };
                            },
                        },
                    };
                }
                return { ok: false, status: 404 };
            });

            const progressReports: { text: string; pct: number }[] = [];
            const count = await runOpfsSeeder((text, pct) => {
                progressReports.push({ text, pct });
            });

            expect(count).toBe(2);
            expect(createdFiles.has(SEED_STATE_FILENAME)).toBe(true);
            expect(createdFiles.has('ra2.mix')).toBe(true);
            expect(createdFiles.has('audio.bag')).toBe(true);
            expect(localStorageMap.get(StorageKey.GameRes)).toBe(String(GameResSource.Local));
            expect(progressReports.length).toBeGreaterThan(0);

            const state = await readSeedState(mockRoot);
            expect(state).not.toBeNull();
            expect(state?.status).toBe('COMPLETED');
            expect(state?.files['ra2.mix'].status).toBe('VERIFIED_COMPLETE');
            expect(state?.files['audio.bag'].status).toBe('VERIFIED_COMPLETE');
        });

        test('resumes and skips already complete files from previous session', async () => {
            const enc = new TextEncoder();
            const ra2Data = enc.encode('ra2_mix_content');
            const audioData = enc.encode('audio_bag_content');
            const ra2Hash = await computeSha256Hex(ra2Data);
            const audioHash = await computeSha256Hex(audioData);

            // Pre-seed ra2.mix
            createdFiles.set('ra2.mix', ra2Data);

            const manifestFingerprint = `ra2.mix:${ra2Data.byteLength}:${ra2Hash}|audio.bag:${audioData.byteLength}:${audioHash}`;
            const initialState: SeedState = {
                version: 2,
                manifestHash: manifestFingerprint,
                status: 'SEEDING',
                totalFiles: 2,
                totalBytes: ra2Data.byteLength + audioData.byteLength,
                completedBytes: ra2Data.byteLength,
                files: {
                    'ra2.mix': {
                        path: 'ra2.mix',
                        size: ra2Data.byteLength,
                        sha256: ra2Hash,
                        status: 'VERIFIED_COMPLETE',
                        bytesWritten: ra2Data.byteLength,
                    },
                    'audio.bag': {
                        path: 'audio.bag',
                        size: audioData.byteLength,
                        sha256: audioHash,
                        status: 'PENDING',
                        bytesWritten: 0,
                    },
                },
            };
            await saveSeedState(mockRoot, initialState);

            let ra2Fetched = false;
            let audioFetched = false;

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [
                                { path: 'ra2.mix', size: ra2Data.byteLength, sha256: ra2Hash },
                                { path: 'audio.bag', size: audioData.byteLength, sha256: audioHash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    ra2Fetched = true;
                    return { ok: true, arrayBuffer: async () => ra2Data.buffer };
                }
                if (url === '/gameres/audio.bag') {
                    audioFetched = true;
                    return { ok: true, arrayBuffer: async () => audioData.buffer };
                }
                return { ok: false, status: 404 };
            });

            const count = await runOpfsSeeder();
            expect(count).toBe(1); // Only audio.bag was written
            expect(ra2Fetched).toBe(false);
            expect(audioFetched).toBe(true);

            const state = await readSeedState(mockRoot);
            expect(state?.status).toBe('COMPLETED');
            expect(state?.files['audio.bag'].status).toBe('VERIFIED_COMPLETE');
        });

        test('self-heals when a previously completed file is truncated or corrupted', async () => {
            const enc = new TextEncoder();
            const ra2Data = enc.encode('ra2_mix_content');
            const audioData = enc.encode('audio_bag_content');
            const ra2Hash = await computeSha256Hex(ra2Data);
            const audioHash = await computeSha256Hex(audioData);

            // Corrupted/truncated ra2.mix exists on disk (1 byte instead of full size)
            createdFiles.set('ra2.mix', new Uint8Array([0x00]));

            const manifestFingerprint = `ra2.mix:${ra2Data.byteLength}:${ra2Hash}|audio.bag:${audioData.byteLength}:${audioHash}`;
            const initialState: SeedState = {
                version: 2,
                manifestHash: manifestFingerprint,
                status: 'SEEDING',
                totalFiles: 2,
                totalBytes: ra2Data.byteLength + audioData.byteLength,
                completedBytes: ra2Data.byteLength,
                files: {
                    'ra2.mix': {
                        path: 'ra2.mix',
                        size: ra2Data.byteLength,
                        sha256: ra2Hash,
                        status: 'VERIFIED_COMPLETE', // Claims complete but disk is truncated
                        bytesWritten: ra2Data.byteLength,
                    },
                },
            };
            await saveSeedState(mockRoot, initialState);

            let ra2Fetched = false;
            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [
                                { path: 'ra2.mix', size: ra2Data.byteLength, sha256: ra2Hash },
                                { path: 'audio.bag', size: audioData.byteLength, sha256: audioHash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/ra2.mix') {
                    ra2Fetched = true;
                    return { ok: true, arrayBuffer: async () => ra2Data.buffer };
                }
                if (url === '/gameres/audio.bag') {
                    return { ok: true, arrayBuffer: async () => audioData.buffer };
                }
                return { ok: false, status: 404 };
            });

            const count = await runOpfsSeeder();
            expect(ra2Fetched).toBe(true); // Re-fetched and repaired
            expect(count).toBe(2);
            expect(createdFiles.get('ra2.mix')?.byteLength).toBe(ra2Data.byteLength);
        });

        test('aborts with error on SHA-256 mismatch', async () => {
            const enc = new TextEncoder();
            const realData = enc.encode('original_content');
            const tamperedData = enc.encode('tampered_content');
            const realHash = await computeSha256Hex(realData);

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            version: 2,
                            files: [
                                { path: 'bad.mix', size: tamperedData.byteLength, sha256: realHash },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/bad.mix') {
                    return { ok: true, arrayBuffer: async () => tamperedData.buffer };
                }
                return { ok: false, status: 404 };
            });

            await expect(runOpfsSeeder()).rejects.toThrow(/SHA-256 mismatch/);
            const state = await readSeedState(mockRoot);
            expect(state?.files['bad.mix'].status).toBe('FAILED');
        });
    });
});
