/**
 * Platform-neutral native shell bridge.
 *
 * Provides platform detection, type definitions, and shared host contracts
 * for all native shells (iOS WKWebView, Android WebView, desktop browser).
 *
 * This module is the single source of truth for `isNativeShell()`,
 * `getShellPlatform()`, and the `window.__RA2_SHELL__` contract. Platform-
 * specific logic (iOS seeding, Android SAF) lives in separate modules and
 * imports from here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShellPlatform = 'ios' | 'android' | 'browser';

export interface RA2ShellHost {
    platform: ShellPlatform;
    version: string;
}

declare global {
    interface Window {
        /** Set by native shells to identify themselves at injection time. */
        __RA2_SHELL__?: RA2ShellHost;
    }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

/**
 * Identifies the current host platform.
 *
 * Detection order:
 *   1. `window.__RA2_SHELL__.platform` — injected by the native shell.
 *   2. `?shell=android` / `?shell` / `?shell=ios` query params — dev aid.
 *   3. Fallback: `'browser'`.
 */
export function getShellPlatform(): ShellPlatform {
    if (window.__RA2_SHELL__?.platform) {
        return window.__RA2_SHELL__.platform as ShellPlatform;
    }
    const params = new URLSearchParams(window.location.search);
    const shellParam = params.get('shell');
    if (shellParam === 'android') return 'android';
    if (
        shellParam === 'ios' ||
        shellParam === 'true' ||
        shellParam === '1' ||
        params.has('shell')
    ) {
        return 'ios';
    }
    return 'browser';
}

/** True when running inside any native shell (iOS or Android). */
export function isNativeShell(): boolean {
    return getShellPlatform() !== 'browser';
}

/** True when running inside the iOS WKWebView shell. */
export function isIOSNativeShell(): boolean {
    return getShellPlatform() === 'ios';
}

/** True when running inside the Android WebView shell. */
export function isAndroidNativeShell(): boolean {
    return getShellPlatform() === 'android';
}
