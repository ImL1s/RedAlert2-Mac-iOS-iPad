import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
    getShellPlatform,
    isNativeShell,
    isIOSNativeShell,
    isAndroidNativeShell,
    seedGameResFromShell,
} from '../shell/nativeBridge';

describe('Adversarial Stress Test Harness — Milestone M1', () => {
    let originalWindow: any;
    let originalNavigator: any;
    let originalSessionStorage: any;
    let originalLocalStorage: any;
    let originalDocument: any;
    let originalFetch: any;

    beforeEach(() => {
        originalWindow = (globalThis as any).window;
        originalNavigator = (globalThis as any).navigator;
        originalSessionStorage = (globalThis as any).sessionStorage;
        originalLocalStorage = (globalThis as any).localStorage;
        originalDocument = (globalThis as any).document;
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
        (globalThis as any).sessionStorage = originalSessionStorage;
        (globalThis as any).localStorage = originalLocalStorage;
        (globalThis as any).document = originalDocument;
        (globalThis as any).fetch = originalFetch;
    });

    describe('1. Bridge Platform Detection Edge Cases & Malformed Inputs', () => {
        test('Missing window.__RA2_SHELL__ (undefined / null)', () => {
            (globalThis as any).window.__RA2_SHELL__ = undefined;
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);

            (globalThis as any).window.__RA2_SHELL__ = null;
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);
        });

        test('Primitive non-object values assigned to window.__RA2_SHELL__', () => {
            for (const primitive of [true, false, 'android', 'ios', 123, Symbol('shell')]) {
                (globalThis as any).window.__RA2_SHELL__ = primitive as any;
                expect(getShellPlatform()).toBe('browser');
                expect(isNativeShell()).toBe(false);
                expect(isAndroidNativeShell()).toBe(false);
                expect(isIOSNativeShell()).toBe(false);
            }
        });

        test('Malformed properties on window.__RA2_SHELL__', () => {
            // Empty object
            (globalThis as any).window.__RA2_SHELL__ = {} as any;
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);

            // Null platform
            (globalThis as any).window.__RA2_SHELL__ = { platform: null } as any;
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);

            // Empty string platform
            (globalThis as any).window.__RA2_SHELL__ = { platform: '' } as any;
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);

            // Uppercase platform string "ANDROID" (case sensitivity behavior)
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'ANDROID' } as any;
            expect(getShellPlatform()).toBe('ANDROID' as any);
            expect(isNativeShell()).toBe(true);
            expect(isAndroidNativeShell()).toBe(false); // Exact match requires 'android'

            // Arbitrary invalid platform string
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'custom_shell' } as any;
            expect(getShellPlatform()).toBe('custom_shell' as any);
            expect(isNativeShell()).toBe(true);
            expect(isAndroidNativeShell()).toBe(false);
            expect(isIOSNativeShell()).toBe(false);
        });

        test('URL Search Parameter edge cases when window.__RA2_SHELL__ is missing', () => {
            const cases: Array<{ search: string; expectedPlatform: string; expectedNative: boolean }> = [
                { search: '?shell=android', expectedPlatform: 'android', expectedNative: true },
                { search: '?shell=ios', expectedPlatform: 'ios', expectedNative: true },
                { search: '?shell=true', expectedPlatform: 'ios', expectedNative: true },
                { search: '?shell=1', expectedPlatform: 'ios', expectedNative: true },
                { search: '?shell', expectedPlatform: 'ios', expectedNative: true },
                { search: '?other=123', expectedPlatform: 'browser', expectedNative: false },
                { search: '', expectedPlatform: 'browser', expectedNative: false },
            ];

            for (const c of cases) {
                delete (globalThis as any).window.__RA2_SHELL__;
                (globalThis as any).window.location.search = c.search;
                expect(getShellPlatform()).toBe(c.expectedPlatform as any);
                expect(isNativeShell()).toBe(c.expectedNative);
            }
        });

        test('Behavioral Flaw Verification: Negative/Falsy URL search params (?shell=false, ?shell=0, ?shell=browser)', () => {
            delete (globalThis as any).window.__RA2_SHELL__;

            // Notice: ?shell=false has params.has('shell') === true, which falls through line 35 to return 'ios'
            (globalThis as any).window.location.search = '?shell=false';
            expect(getShellPlatform()).toBe('ios'); // Empirical proof of fallback behavior

            (globalThis as any).window.location.search = '?shell=0';
            expect(getShellPlatform()).toBe('ios');

            (globalThis as any).window.location.search = '?shell=browser';
            expect(getShellPlatform()).toBe('ios');
        });
    });

    describe('2. OPFS Seeder Early Return & Error Recovery Stress Harness', () => {
        test('Early Return: seedGameResFromShell exits immediately when not in native shell', async () => {
            delete (globalThis as any).window.__RA2_SHELL__;
            (globalThis as any).window.location.search = '';

            const fetchMock = mock(async () => ({ ok: true }));
            (globalThis as any).fetch = fetchMock;

            let storageAccessed = false;
            (globalThis as any).navigator = {
                storage: {
                    getDirectory: async () => {
                        storageAccessed = true;
                        return {};
                    },
                },
            };

            await seedGameResFromShell();

            expect(fetchMock).not.toHaveBeenCalled();
            expect(storageAccessed).toBe(false);
        });

        test('Error Recovery: Manifest 404 failure cleans up DOM overlay and rejects cleanly', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

            const DOMNodes: any[] = [];
            (globalThis as any).document = {
                body: {
                    appendChild: (node: any) => DOMNodes.push(node),
                },
                createElement: () => {
                    const node: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = DOMNodes.indexOf(node);
                            if (idx >= 0) DOMNodes.splice(idx, 1);
                        },
                    };
                    return node;
                },
            };

            (globalThis as any).fetch = mock(async (url: string) => {
                return { ok: false, status: 404, statusText: 'Not Found' };
            });

            await expect(seedGameResFromShell()).rejects.toThrow('Shell seed manifest missing (404)');
            expect(DOMNodes.length).toBe(0); // Overlay removed
        });

        test('Error Recovery: Malformed JSON manifest cleans up DOM overlay and rejects with SyntaxError', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

            const DOMNodes: any[] = [];
            (globalThis as any).document = {
                body: {
                    appendChild: (node: any) => DOMNodes.push(node),
                },
                createElement: () => {
                    const node: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = DOMNodes.indexOf(node);
                            if (idx >= 0) DOMNodes.splice(idx, 1);
                        },
                    };
                    return node;
                },
            };

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
                    };
                }
                return { ok: false, status: 404 };
            });

            await expect(seedGameResFromShell()).rejects.toThrow(SyntaxError);
            expect(DOMNodes.length).toBe(0); // Overlay removed
        });

        test('Error Recovery: Resource fetch failure mid-seed writes partial files and cleans up overlay', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

            const DOMNodes: any[] = [];
            (globalThis as any).document = {
                body: { appendChild: (node: any) => DOMNodes.push(node) },
                createElement: () => {
                    const node: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = DOMNodes.indexOf(node);
                            if (idx >= 0) DOMNodes.splice(idx, 1);
                        },
                    };
                    return node;
                },
            };

            const mockStorage = new Map<string, number>();
            const mockDirHandle: any = {
                getDirectoryHandle: async () => mockDirHandle,
                getFileHandle: async (fileName: string) => ({
                    getFile: async () => {
                        if (mockStorage.has(fileName)) {
                            return { size: mockStorage.get(fileName)! };
                        }
                        throw new Error('File not found');
                    },
                    createWritable: async () => ({
                        write: async () => {},
                        close: async () => {},
                    }),
                }),
            };

            (globalThis as any).navigator = {
                storage: { getDirectory: async () => mockDirHandle },
            };

            // First run: file1 succeeds, file2 fails with HTTP 500
            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            files: [
                                { path: 'file1.mix', size: 100 },
                                { path: 'file2.mix', size: 200 },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/file1.mix') {
                    mockStorage.set('file1.mix', 100);
                    return {
                        ok: true,
                        body: { pipeTo: async () => {} },
                    };
                }
                if (url === '/gameres/file2.mix') {
                    return { ok: false, status: 500 };
                }
                return { ok: false, status: 404 };
            });

            await expect(seedGameResFromShell()).rejects.toThrow('Failed to fetch bundled resource "file2.mix" (500)');
            expect(DOMNodes.length).toBe(0);
            expect(mockStorage.has('file1.mix')).toBe(true);

            // Second run (Resumability test): file2 now succeeds
            let file1FetchedAgain = false;
            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            files: [
                                { path: 'file1.mix', size: 100 },
                                { path: 'file2.mix', size: 200 },
                            ],
                        }),
                    };
                }
                if (url === '/gameres/file1.mix') {
                    file1FetchedAgain = true;
                    return { ok: true, body: { pipeTo: async () => {} } };
                }
                if (url === '/gameres/file2.mix') {
                    mockStorage.set('file2.mix', 200);
                    return { ok: true, body: { pipeTo: async () => {} } };
                }
                return { ok: false, status: 404 };
            });

            let reloaded = false;
            (globalThis as any).window.location = {
                search: '',
                reload: () => { reloaded = true; },
            };
            const sessionStorageMap = new Map<string, string>();
            (globalThis as any).sessionStorage = {
                getItem: (k: string) => sessionStorageMap.get(k) ?? null,
                setItem: (k: string, v: string) => sessionStorageMap.set(k, v),
            };
            const localStorageMap = new Map<string, string>();
            (globalThis as any).localStorage = {
                getItem: (k: string) => localStorageMap.get(k) ?? null,
                setItem: (k: string, v: string) => localStorageMap.set(k, v),
            };

            await Promise.race([
                seedGameResFromShell(),
                new Promise((res) => setTimeout(res, 50)),
            ]);

            expect(file1FetchedAgain).toBe(false); // Resumed! File 1 was skipped because size matched
            expect(mockStorage.has('file2.mix')).toBe(true);
            expect(reloaded).toBe(true);
        });

        test('Error Recovery: OPFS storage rejection cleans up DOM overlay and propagates error', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };

            const DOMNodes: any[] = [];
            (globalThis as any).document = {
                body: { appendChild: (node: any) => DOMNodes.push(node) },
                createElement: () => {
                    const node: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = DOMNodes.indexOf(node);
                            if (idx >= 0) DOMNodes.splice(idx, 1);
                        },
                    };
                    return node;
                },
            };

            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({ files: [{ path: 'test.ini', size: 50 }] }),
                    };
                }
                return { ok: false, status: 404 };
            });

            (globalThis as any).navigator = {
                storage: {
                    getDirectory: async () => {
                        throw new Error('SecurityError: OPFS access blocked');
                    },
                },
            };

            await expect(seedGameResFromShell()).rejects.toThrow('SecurityError: OPFS access blocked');
            expect(DOMNodes.length).toBe(0);
        });
    });
});
