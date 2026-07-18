import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';

declare global {
    interface Window {
        __RA2_SHELL__?: { platform: string; version: string };
    }
}

interface SeedManifest {
    files: { path: string; size: number }[];
}

/**
 * Debug aid: mirrors console output to a dev machine over HTTP so WKWebView
 * logs are visible without attaching Safari's inspector. Silently inert when
 * no dev receiver is listening.
 */
export function installShellDebugLog(): void {
    if (!isNativeShell())
        return;
    const post = (level: string, args: unknown[]) => {
        try {
            const text = args
                .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
                .join(' ');
            void fetch('http://127.0.0.1:4100/log', {
                method: 'POST',
                body: `[${level}] ${text}`,
            }).catch(() => { });
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
    window.addEventListener('error', (e) => post('uncaught', [e.message, e.filename, e.lineno]));
    window.addEventListener('unhandledrejection', (e) => post('unhandledrejection', [String(e.reason)]));
}

export function isNativeShell(): boolean {
    if (window.__RA2_SHELL__)
        return true;
    // Dev aid: lets a desktop browser exercise the shell code paths.
    return new URLSearchParams(window.location.search).has('shell');
}

/**
 * First-launch bootstrap for the native shell: copies the bundled, pre-imported
 * game resources (served by the shell at /gameres/) into origin-private storage,
 * then marks the import as complete exactly like GameResImporter would.
 *
 * No-op outside the shell, or once storage is already seeded.
 */
export async function seedGameResFromShell(): Promise<void> {
    if (!isNativeShell())
        return;
    // Never trust the localStorage flag alone: the OS can purge origin storage
    // (iOS disk pressure) while localStorage survives, or vice versa. The seed
    // itself verifies per-file sizes and only copies what is missing or stale,
    // so running it on every launch is cheap and self-healing.
    let overlay: ReturnType<typeof createSeedOverlay> | undefined;
    try {
        await runSeed((text) => {
            overlay ??= createSeedOverlay();
            overlay.setText(text);
        });
    }
    finally {
        overlay?.remove();
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

async function runSeed(onProgress: (text: string) => void): Promise<void> {
    const manifestResponse = await fetch('/gameres/manifest.json');
    if (!manifestResponse.ok) {
        throw new Error(`Shell seed manifest missing (${manifestResponse.status})`);
    }
    const manifest: SeedManifest = await manifestResponse.json();
    const totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    let copiedBytes = 0;
    const root = await navigator.storage.getDirectory();
    for (const file of manifest.files) {
        const segments = file.path.split('/');
        const fileName = segments.pop()!;
        let dir = root;
        for (const segment of segments) {
            dir = await dir.getDirectoryHandle(segment, { create: true });
        }
        const existing = await dir
            .getFileHandle(fileName)
            .then((h) => h.getFile())
            .catch(() => undefined);
        if (existing && existing.size === file.size) {
            copiedBytes += file.size;
            continue;
        }
        const response = await fetch(`/gameres/${file.path}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch bundled resource "${file.path}" (${response.status})`);
        }
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await response.body!.pipeTo(writable);
        copiedBytes += file.size;
        onProgress(
            `Preparing game files... ${(copiedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`,
        );
    }
    const config = String(GameResSource.Local);
    localStorage.setItem(StorageKey.GameRes, config);
    console.log(`[iosSeed] Seeded ${manifest.files.length} files (${totalBytes} bytes) from shell bundle`);
}
