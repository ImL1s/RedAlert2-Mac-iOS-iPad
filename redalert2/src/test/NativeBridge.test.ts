import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import {
    getShellPlatform,
    isNativeShell,
    isIOSNativeShell,
    isAndroidNativeShell,
} from '../shell/nativeBridge';

describe('nativeBridge platform detection', () => {
    beforeEach(() => {
        if (typeof globalThis.window === 'undefined') {
            (globalThis as any).window = { location: { search: '' } };
        } else {
            delete (globalThis as any).window.__RA2_SHELL__;
            (globalThis as any).window.location = { search: '' };
        }
    });

    test('defaults to browser platform when __RA2_SHELL__ is undefined', () => {
        expect(getShellPlatform()).toBe('browser');
        expect(isNativeShell()).toBe(false);
        expect(isIOSNativeShell()).toBe(false);
        expect(isAndroidNativeShell()).toBe(false);
    });

    test('detects android platform from __RA2_SHELL__', () => {
        (globalThis as any).window.__RA2_SHELL__ = {
            platform: 'android',
            version: '0.1.0',
            thermalState: 'nominal',
        };

        expect(getShellPlatform()).toBe('android');
        expect(isNativeShell()).toBe(true);
        expect(isIOSNativeShell()).toBe(false);
        expect(isAndroidNativeShell()).toBe(true);
    });

    test('detects ios platform from __RA2_SHELL__', () => {
        (globalThis as any).window.__RA2_SHELL__ = {
            platform: 'ios',
            version: '1.0.0',
            thermalState: 'fair',
        };

        expect(getShellPlatform()).toBe('ios');
        expect(isNativeShell()).toBe(true);
        expect(isIOSNativeShell()).toBe(true);
        expect(isAndroidNativeShell()).toBe(false);
    });
});
