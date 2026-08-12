import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import {
    getShellPlatform,
    isNativeShell,
    isIOSNativeShell,
    isAndroidNativeShell,
    installShellDebugLog,
    installShellRepl,
    seedGameResFromShell,
} from '../shell/nativeBridge';

import * as iosSeed from '../shell/iosSeed';
import { Strings } from '../data/Strings';

describe('M1 Empirical Challenge Suite — Native Bridge & Platform Detection', () => {
    let originalWindow: any;
    let originalNavigator: any;
    let originalSessionStorage: any;

    beforeEach(() => {
        originalWindow = (globalThis as any).window;
        originalNavigator = (globalThis as any).navigator;
        originalSessionStorage = (globalThis as any).sessionStorage;

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
    });

    describe('1. Global Variable & URL Simulation Matrix', () => {
        test('window.__RA2_SHELL__ = { platform: "android" }', () => {
            (globalThis as any).window.__RA2_SHELL__ = {
                platform: 'android',
                version: '0.1.0',
                thermalState: 'nominal',
            };
            expect(getShellPlatform()).toBe('android');
            expect(isNativeShell()).toBe(true);
            expect(isAndroidNativeShell()).toBe(true);
            expect(isIOSNativeShell()).toBe(false);
        });

        test('window.__RA2_SHELL__ = { platform: "ios" }', () => {
            (globalThis as any).window.__RA2_SHELL__ = {
                platform: 'ios',
                version: '1.0.0',
                thermalState: 'fair',
            };
            expect(getShellPlatform()).toBe('ios');
            expect(isNativeShell()).toBe(true);
            expect(isAndroidNativeShell()).toBe(false);
            expect(isIOSNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ = { platform: "browser" }', () => {
            (globalThis as any).window.__RA2_SHELL__ = {
                platform: 'browser',
                version: '1.0.0',
            };
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);
            expect(isAndroidNativeShell()).toBe(false);
            expect(isIOSNativeShell()).toBe(false);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "?shell=android"', () => {
            (globalThis as any).window.location.search = '?shell=android';
            expect(getShellPlatform()).toBe('android');
            expect(isAndroidNativeShell()).toBe(true);
            expect(isNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "?shell=ios"', () => {
            (globalThis as any).window.location.search = '?shell=ios';
            expect(getShellPlatform()).toBe('ios');
            expect(isIOSNativeShell()).toBe(true);
            expect(isNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "?shell=true"', () => {
            (globalThis as any).window.location.search = '?shell=true';
            expect(getShellPlatform()).toBe('ios');
            expect(isIOSNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "?shell=1"', () => {
            (globalThis as any).window.location.search = '?shell=1';
            expect(getShellPlatform()).toBe('ios');
            expect(isIOSNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "?shell"', () => {
            (globalThis as any).window.location.search = '?shell';
            expect(getShellPlatform()).toBe('ios');
            expect(isIOSNativeShell()).toBe(true);
        });

        test('window.__RA2_SHELL__ is undefined, URL search "" (default browser)', () => {
            (globalThis as any).window.location.search = '';
            expect(getShellPlatform()).toBe('browser');
            expect(isNativeShell()).toBe(false);
        });

        test('Edge case: window.__RA2_SHELL__ = {} (empty object / platform undefined)', () => {
            (globalThis as any).window.__RA2_SHELL__ = {} as any;
            (globalThis as any).window.location.search = '?shell=android';
            expect(getShellPlatform()).toBe('android');
            expect(isAndroidNativeShell()).toBe(true);
        });
    });

    describe('2. Backward Compatibility of iosSeed.ts', () => {
        test('iosSeed.ts exports match nativeBridge.ts functions exactly', () => {
            expect(iosSeed.getShellPlatform).toBe(getShellPlatform);
            expect(iosSeed.isNativeShell).toBe(isNativeShell);
            expect(iosSeed.isIOSNativeShell).toBe(isIOSNativeShell);
            expect(iosSeed.isAndroidNativeShell).toBe(isAndroidNativeShell);
            expect(iosSeed.installShellDebugLog).toBe(installShellDebugLog);
            expect(iosSeed.installShellRepl).toBe(installShellRepl);
            expect(iosSeed.seedGameResFromShell).toBe(seedGameResFromShell);
        });
    });

    describe('3. OPFS Seeder & Native Bridge Stress Testing', () => {
        test('seedGameResFromShell returns early if not native shell', async () => {
            (globalThis as any).window.location.search = '';
            await seedGameResFromShell();
        });

        test('seedGameResFromShell cleans up overlay on manifest 404 error', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };
            
            const elements: any[] = [];
            (globalThis as any).document = {
                body: {
                    appendChild: (el: any) => elements.push(el),
                },
                createElement: () => {
                    const el: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = elements.indexOf(el);
                            if (idx >= 0) elements.splice(idx, 1);
                        },
                    };
                    return el;
                },
            };

            (globalThis as any).fetch = mock(async () => ({
                ok: false,
                status: 404,
            }));

            await expect(seedGameResFromShell()).rejects.toThrow('Shell seed manifest missing (404)');
            expect(elements.length).toBe(0);
        });

        test('seedGameResFromShell successfully seeds files into mock OPFS and triggers reload on first write', async () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };
            
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

            const elements: any[] = [];
            (globalThis as any).document = {
                body: {
                    appendChild: (el: any) => elements.push(el),
                },
                createElement: () => {
                    const el: any = {
                        style: {},
                        textContent: '',
                        remove: () => {
                            const idx = elements.indexOf(el);
                            if (idx >= 0) elements.splice(idx, 1);
                        },
                    };
                    return el;
                },
            };

            // Mock OPFS handles
            const writtenFiles = new Map<string, ArrayBuffer>();
            const mockDirHandle: any = {
                getDirectoryHandle: async (name: string, opts?: any) => mockDirHandle,
                getFileHandle: async (fileName: string, opts?: any) => {
                    return {
                        getFile: async () => {
                            if (!writtenFiles.has(fileName)) throw new Error('Not found');
                            return { size: writtenFiles.get(fileName)!.byteLength };
                        },
                        createWritable: async () => {
                            return {
                                write: async (data: any) => {},
                                close: async () => {},
                            };
                        },
                    };
                },
            };

            (globalThis as any).navigator = {
                storage: {
                    getDirectory: async () => mockDirHandle,
                },
            };

            // Mock manifest and resource fetches
            (globalThis as any).fetch = mock(async (url: string) => {
                if (url === '/gameres/manifest.json') {
                    return {
                        ok: true,
                        json: async () => ({
                            files: [
                                { path: 'test.ini', size: 100 },
                                { path: 'sub/data.mix', size: 200 },
                            ],
                        }),
                    };
                }
                if (url.startsWith('/gameres/')) {
                    return {
                        ok: true,
                        body: {
                            pipeTo: async (writable: any) => {
                                writtenFiles.set(url, new ArrayBuffer(100));
                            },
                        },
                    };
                }
                return { ok: false, status: 404 };
            });

            // Execute seedGameResFromShell wrapped in Promise.race because reload halts JS in production
            await Promise.race([
                seedGameResFromShell(),
                new Promise((res) => setTimeout(res, 50)),
            ]);

            expect(sessionStorageMap.get('shellSeedReloaded')).toBe('1');
            expect(reloaded).toBe(true);
            expect(elements.length).toBe(0);
        });

        test('installShellDebugLog intercepts console and fetch without recursion', () => {
            (globalThis as any).window.__RA2_SHELL__ = { platform: 'android', version: '0.1.0' };
            
            const originalConsoleLog = console.log;
            const originalConsoleError = console.error;

            (globalThis as any).fetch = mock(async () => ({ ok: true }));

            try {
                const circularObj: any = { a: 1 };
                circularObj.self = circularObj;

                installShellDebugLog();

                console.log('Testing log', circularObj, new Error('Test Error'), new ArrayBuffer(1024), null, undefined);
                console.error('Testing error', new Error('Fail'));
            } finally {
                console.log = originalConsoleLog;
                console.error = originalConsoleError;
            }
        });
    });

    describe('4. CSF De-embedding & Fallback Verification', () => {
        test('Strings class can be populated from open locale JSON', () => {
            const strings = new Strings();
            const mockJsonLocale = {
                'GUI:OK': 'OK',
                'GUI:Cancel': 'Cancel',
                'TXT_GAME_TITLE': 'Red Alert 2',
            };

            strings.fromJson(mockJsonLocale);

            expect(strings.get('GUI:OK')).toBe('OK');
            expect(strings.get('GUI:Cancel')).toBe('Cancel');
            expect(strings.get('TXT_GAME_TITLE')).toBe('Red Alert 2');
        });
    });
});
