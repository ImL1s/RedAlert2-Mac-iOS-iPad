import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';
import { runOpfsSeeder } from './opfsSeeder';
import { installNativeLifecycleListeners } from './nativeLifecycleBridge';

export * from './nativeLifecycleBridge';
installNativeLifecycleListeners();

export type ShellPlatform = 'ios' | 'android' | 'browser';
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical' | 'unknown';

export interface RA2ShellHost {
    platform: ShellPlatform;
    version: string;
    thermalState?: ThermalState;
    lowPowerMode?: boolean;
}

export interface SafStatus {
    status: 'authorized' | 'not_selected' | 'permission_denied';
    uri?: string;
    packName?: string;
}

export interface SafManifestPreflight {
    valid: boolean;
    status?: string;
    error?: string;
    failedFile?: string;
    fileCount?: number;
    totalBytes?: number;
    requiredBytes?: number;
    availableBytes?: number;
}

export interface RA2LifecycleEvent {
    type: 'stop' | 'pause' | 'resume';
}

export interface RA2AudioFocusEvent {
    focused: boolean;
    duck: boolean;
}

export interface RA2AndroidNativeBridge {
    getPlatform(): string;
    getVersion(): string;
    getThermalState(): string;
    getSafStatus(): string;
    launchSafPicker(): void;
    preflightSafManifest(): string;
    generateDiagnosticBundle?(): string;
    finishActivity?(): void;
}

declare global {
    interface Window {
        __RA2_SHELL__?: RA2ShellHost;
        __RA2_POWER__?: (state: { thermal?: ThermalState; lowPower?: boolean }) => void;
        __RA2_LIFECYCLE__?: (event: RA2LifecycleEvent) => void;
        __RA2_AUDIO_FOCUS__?: (event: RA2AudioFocusEvent) => void;
        __RA2_ON_BACK_PRESSED__?: () => void;
        __RA2_ON_SAF_RESULT__?: (result: { success: boolean; uri?: string; error?: string }) => void;
        AndroidNativeBridge?: RA2AndroidNativeBridge;
    }
}

const DEBUG_NET_ALLOWED = !!(import.meta as any).env?.DEV
    || !!(import.meta as any).env?.VITE_DEBUG_NET_FORCE;

export function getShellPlatform(): ShellPlatform {
    if (window.__RA2_SHELL__?.platform) {
        return window.__RA2_SHELL__.platform;
    }
    const params = new URLSearchParams(window.location.search);
    const shellParam = params.get('shell');
    if (shellParam === 'android') return 'android';
    if (shellParam === 'ios' || shellParam === 'true' || shellParam === '1' || params.has('shell')) return 'ios';
    return 'browser';
}

export function isNativeShell(): boolean {
    return getShellPlatform() !== 'browser';
}

export function isIOSNativeShell(): boolean {
    return getShellPlatform() === 'ios';
}

export function isAndroidNativeShell(): boolean {
    return getShellPlatform() === 'android';
}

export async function getSafStatus(): Promise<SafStatus> {
    if (window.AndroidNativeBridge?.getSafStatus) {
        try {
            return JSON.parse(window.AndroidNativeBridge.getSafStatus());
        } catch {
            return { status: 'permission_denied' };
        }
    }
    return { status: 'authorized' }; // Default for browser / iOS
}

export async function requestSafPicker(): Promise<SafStatus> {
    return new Promise((resolve) => {
        if (!window.AndroidNativeBridge?.launchSafPicker) {
            resolve({ status: 'authorized' });
            return;
        }
        window.__RA2_ON_SAF_RESULT__ = (result) => {
            if (result.success) {
                resolve({ status: 'authorized', uri: result.uri });
            } else {
                resolve({ status: 'permission_denied' });
            }
        };
        window.AndroidNativeBridge.launchSafPicker();
    });
}

export async function preflightSafManifest(): Promise<SafManifestPreflight> {
    if (window.AndroidNativeBridge?.preflightSafManifest) {
        try {
            return JSON.parse(window.AndroidNativeBridge.preflightSafManifest());
        } catch (e: any) {
            return { valid: false, error: e?.message || 'Failed to execute native SAF preflight' };
        }
    }
    return { valid: true }; // Default for non-android
}

export async function generateDiagnosticBundle(): Promise<any> {
    if (window.AndroidNativeBridge?.generateDiagnosticBundle) {
        try {
            return JSON.parse(window.AndroidNativeBridge.generateDiagnosticBundle());
        } catch (e: any) {
            console.error('Failed to parse native diagnostic bundle JSON:', e);
        }
    }
    return {
        timestamp: new Date().toISOString(),
        metadata: {
            appVersion: '0.1.0',
            androidVersion: 'Android 14 (API 34)',
            deviceModel: 'Browser M2/M5 Web Host',
            webpackageVersion: 'v2.0',
        },
        safStatus: 'authorized',
        thermalState: 'nominal',
        lowPowerMode: false,
        logcat: ['[RA2] Web nativeBridge mock logcat trace'],
    };
}

export function installShellDebugLog(): void {
    if (!isNativeShell() || !DEBUG_NET_ALLOWED)
        return;
    const host = (import.meta as any).env?.VITE_DEBUG_LOG_HOST;
    if (!host)
        return;
    const endpoint = `http://${host}:4100/log`;
    const safeArg = (a: unknown): string => {
        if (a instanceof Error)
            return `${a.name}: ${a.message}\n${a.stack ?? '(no stack)'}`;
        if (a === null || a === undefined)
            return String(a);
        if (typeof a !== 'object')
            return String(a).slice(0, 2000);
        if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer)
            return `[binary ${(a as any).byteLength ?? '?'}b]`;
        try {
            return JSON.stringify(a).slice(0, 2000);
        }
        catch {
            return Object.prototype.toString.call(a);
        }
    };
    const post = (level: string, args: unknown[]) => {
        try {
            const text = args.map(safeArg).join(' ').slice(0, 4000);
            void fetch(endpoint, { method: 'POST', body: `[${level}] ${text}` }).catch(() => { });
        }
        catch { }
    };
    for (const level of ['log', 'warn', 'error'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            post(level, args);
        };
    }
    window.addEventListener('error', (e) => post('uncaught', [e.message, e.filename, e.lineno, (e.error?.stack ?? '')]));
    window.addEventListener('unhandledrejection', (e) => post('unhandledrejection', [e.reason]));
}

export function installShellRepl(): void {
    if (!isNativeShell() || !DEBUG_NET_ALLOWED)
        return;
    if (!(import.meta as any).env?.VITE_DEBUG_REPL)
        return;
    const host = (import.meta as any).env?.VITE_DEBUG_LOG_HOST || '127.0.0.1';
    console.log(`[repl] polling http://${host}:4100/cmd`);
    let logged = false;
    const poll = async () => {
        try {
            const response = await fetch(`http://${host}:4100/cmd`, { method: 'POST', body: 'poll' });
            if (!logged) {
                logged = true;
                console.log(`[repl] first poll status ${response.status}`);
            }
            if (response.status === 200) {
                const { id, code } = await response.json();
                let result: string;
                try {
                    // eslint-disable-next-line no-eval
                    result = String(await (0, eval)(code));
                }
                catch (error: any) {
                    result = `EVALERR: ${error?.message ?? error}\n${error?.stack ?? ''}`;
                }
                await fetch(`http://${host}:4100/result?id=${encodeURIComponent(id)}`, {
                    method: 'POST',
                    body: result.slice(0, 500000),
                }).catch(() => { });
            }
        }
        catch (error: any) {
            if (!logged) {
                logged = true;
                console.warn(`[repl] poll failed: ${error?.message ?? error}`);
            }
        }
        setTimeout(poll, 2000);
    };
    poll();
}

export async function seedGameResFromShell(): Promise<void> {
    if (!isNativeShell())
        return;
    let overlay: ReturnType<typeof createSeedOverlay> | undefined;
    let wroteFiles = 0;
    try {
        wroteFiles = await runOpfsSeeder((text) => {
            overlay ??= createSeedOverlay();
            overlay.setText(text);
        });
    }
    finally {
        overlay?.remove();
    }
    if (wroteFiles > 0 && !sessionStorage.getItem('shellSeedReloaded')) {
        sessionStorage.setItem('shellSeedReloaded', '1');
        console.log(`[nativeBridge] Fresh seed wrote ${wroteFiles} files; reloading once to reset memory high-water`);
        window.location.reload();
        await new Promise(() => { });
    }
}

function createSeedOverlay(): { setText: (text: string) => void; remove: () => void } {
    const el = document.createElement('div');
    el.style.cssText =
        'position:fixed;inset:0;background:#000;color:#c00;display:flex;' +
        'align-items:center;justify-content:center;z-index:99999;' +
        'font:16px monospace;text-align:center;';
    el.textContent = 'Preparing game files...';
    document.body.appendChild(el);
    return {
        setText: (text) => { el.textContent = text; },
        remove: () => el.remove(),
    };
}
