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

export * from './nativeLifecycleBridge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShellPlatform = 'ios' | 'android' | 'browser';

export interface RA2ShellHost {
    platform: ShellPlatform;
    version: string;
    isRecovery?: boolean;
    crashCount?: number;
    thermalState?: 'nominal' | 'fair' | 'serious' | 'critical' | string;
    lowPowerMode?: boolean;
}

export interface SafStatusResponse {
    action: string;
    status: 'ok' | 'error' | 'cancelled';
    hasPermission: boolean;
    uri?: string | null;
    error?: string;
    id?: string;
}

export interface AndroidNativeBridgeListener {
    postMessage(message: string): void;
    onmessage?: (event: { data: string }) => void;
}

declare global {
    interface Window {
        /** Set by native shells to identify themselves at injection time. */
        __RA2_SHELL__?: RA2ShellHost;
        /** Injected by Android WebViewCompat addWebMessageListener. */
        ra2NativeBridge?: AndroidNativeBridgeListener;
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

// ---------------------------------------------------------------------------
// Android Native Bridge Communication
// ---------------------------------------------------------------------------

let messageRequestId = 0;

/**
 * Sends a message to the Android native bridge and awaits a response.
 */
export function postAndroidBridgeMessage<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
        if (!window.ra2NativeBridge || typeof window.ra2NativeBridge.postMessage !== 'function') {
            reject(new Error('Android native bridge is not available'));
            return;
        }

        const id = `req_${++messageRequestId}_${Date.now()}`;
        const requestPayload = { ...payload, id };

        const previousOnMessage = window.ra2NativeBridge.onmessage;
        const handler = (event: { data: string }) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.id === id || (!parsed.id && parsed.action === payload.action)) {
                    resolve(parsed as T);
                    return;
                }
            } catch (err) {
                // Not JSON or unmatched
            }
            if (previousOnMessage) {
                previousOnMessage(event);
            }
        };

        window.ra2NativeBridge.onmessage = handler;
        window.ra2NativeBridge.postMessage(JSON.stringify(requestPayload));
    });
}

/**
 * Queries Android SAF persisted permission status.
 */
export async function getAndroidSafStatus(): Promise<SafStatusResponse> {
    if (!isAndroidNativeShell()) {
        return { action: 'getSafStatus', status: 'ok', hasPermission: false, uri: null };
    }
    return postAndroidBridgeMessage<SafStatusResponse>({ action: 'getSafStatus' });
}

/**
 * Requests the Android native SAF folder picker.
 */
export async function requestAndroidSafPick(): Promise<SafStatusResponse> {
    if (!isAndroidNativeShell()) {
        throw new Error('SAF folder picker is only available in Android native shell');
    }
    return postAndroidBridgeMessage<SafStatusResponse>({ action: 'requestSafPick' });
}

/**
 * Clears the persisted Android SAF resource pack URI.
 */
export async function clearAndroidSafUri(): Promise<SafStatusResponse> {
    if (!isAndroidNativeShell()) {
        return { action: 'clearSafUri', status: 'ok', hasPermission: false };
    }
    return postAndroidBridgeMessage<SafStatusResponse>({ action: 'clearSafUri' });
}

/**
 * Invokes the Android native bridge to retrieve a sanitized diagnostic bundle JSON.
 */
export async function getDiagnosticBundle(): Promise<any> {
    if (!isAndroidNativeShell()) {
        return null;
    }
    return postAndroidBridgeMessage({ action: 'getDiagnosticBundle' });
}

/**
 * Invokes the Android native bridge to export and share the sanitized diagnostic ZIP.
 */
export async function shareDiagnosticBundle(): Promise<boolean> {
    if (!isAndroidNativeShell()) {
        return false;
    }
    const res = await postAndroidBridgeMessage<{ success?: boolean }>({ action: 'shareDiagnosticBundle' });
    return res?.success ?? false;
}

/**
 * Invokes the Android native bridge to clear cache and trigger reseed.
 */
export async function clearCacheAndReseed(): Promise<boolean> {
    if (!isAndroidNativeShell()) {
        return false;
    }
    const res = await postAndroidBridgeMessage<{ success?: boolean }>({ action: 'clearCacheAndReseed' });
    return res?.success ?? false;
}
