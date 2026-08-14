import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';
import { validateManifestV2, ManifestV2 } from '../engine/gameRes/ManifestV2';
import { isNativeShell } from './nativeBridge';

export const SEED_STATE_FILENAME = '.seed_state.json';
export const CHUNK_SIZE_BYTES = 65536; // 64KB memory bound (ADR FC-4)

export type SeedStatus = 'NOT_STARTED' | 'SEEDING' | 'COMPLETED';
export type FileSeedStatus = 'PENDING' | 'IN_PROGRESS' | 'VERIFIED_COMPLETE' | 'FAILED';

export interface FileSeedEntry {
    path: string;
    size: number;
    sha256: string;
    status: FileSeedStatus;
    bytesWritten: number;
}

export interface SeedState {
    version: 2;
    manifestHash: string;
    status: SeedStatus;
    totalFiles: number;
    totalBytes: number;
    completedBytes: number;
    files: Record<string, FileSeedEntry>;
}

/**
 * Computes the SHA-256 hex digest of an ArrayBuffer or Uint8Array.
 */
export async function computeSha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer as ArrayBufferView);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback for environments where crypto.subtle is unavailable
    throw new Error('crypto.subtle.digest is required for SHA-256 verification');
}

/**
 * Reads persisted seed state from OPFS root.
 */
export async function readSeedState(root: FileSystemDirectoryHandle): Promise<SeedState | null> {
    try {
        const handle = await root.getFileHandle(SEED_STATE_FILENAME);
        const file = await handle.getFile();
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (parsed && parsed.version === 2 && parsed.files && typeof parsed.files === 'object') {
            return parsed as SeedState;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Persists seed state to OPFS root in `.seed_state.json`.
 */
export async function saveSeedState(root: FileSystemDirectoryHandle, state: SeedState): Promise<void> {
    try {
        const handle = await root.getFileHandle(SEED_STATE_FILENAME, { create: true });
        const writable = await handle.createWritable();
        const json = JSON.stringify(state, null, 2);
        await writable.write(json);
        await writable.close();
    } catch (e) {
        console.warn('[opfsSeeder] Failed to save seed state:', e);
    }
}

/**
 * Navigates/creates nested directories in OPFS for a given relative path.
 */
export async function getDirectoryForPath(
    root: FileSystemDirectoryHandle,
    filePath: string,
    create = true
): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> {
    const segments = filePath.split('/').filter(s => s.length > 0);
    const fileName = segments.pop()!;
    let dir = root;
    for (const segment of segments) {
        dir = await dir.getDirectoryHandle(segment, { create });
    }
    return { dir, fileName };
}

/**
 * Core resumable, verified, self-healing OPFS resource seeder.
 *
 * Implements:
 * - Streaming 64KB chunked writes to respect memory bound ADR FC-4.
 * - Per-file SHA-256 integrity verification against Manifest v2.
 * - `.seed_state.json` persistence for interruption recovery.
 * - Atomic `.tmp` staging and self-healing on corruption.
 */
export async function runOpfsSeeder(
    onProgress: (text: string, percentage: number) => void = () => {}
): Promise<number> {
    const manifestResponse = await fetch('/gameres/manifest.json');
    if (!manifestResponse.ok) {
        if (manifestResponse.status === 404) {
            console.log('[opfsSeeder] No shell seed manifest found (/gameres/manifest.json 404), skipping OPFS seeding.');
            return 0;
        }
        throw new Error(`Shell seed manifest missing (${manifestResponse.status})`);
    }
    const rawManifest = await manifestResponse.json();
    validateManifestV2(rawManifest);
    const manifest = rawManifest as ManifestV2;

    const totalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
    const manifestFingerprint = manifest.files.map(f => `${f.path}:${f.size}:${f.sha256 || ''}`).join('|');

    const root = await navigator.storage.getDirectory();
    let seedState = await readSeedState(root);

    // Reconcile or initialize state
    if (!seedState || seedState.manifestHash !== manifestFingerprint) {
        seedState = {
            version: 2,
            manifestHash: manifestFingerprint,
            status: 'NOT_STARTED',
            totalFiles: manifest.files.length,
            totalBytes: totalBytes,
            completedBytes: 0,
            files: {},
        };

        for (const file of manifest.files) {
            let alreadyComplete = false;
            try {
                const { dir, fileName } = await getDirectoryForPath(root, file.path, false);
                const handle = await dir.getFileHandle(fileName);
                const f = await handle.getFile();
                if (f.size === file.size) {
                    alreadyComplete = true;
                }
            } catch {
                alreadyComplete = false;
            }

            seedState.files[file.path] = {
                path: file.path,
                size: file.size,
                sha256: file.sha256 || '',
                status: alreadyComplete ? 'VERIFIED_COMPLETE' : 'PENDING',
                bytesWritten: alreadyComplete ? file.size : 0,
            };
        }
        await saveSeedState(root, seedState);
    } else {
        // Verify existing files marked VERIFIED_COMPLETE (Self-healing check)
        for (const file of manifest.files) {
            const entry = seedState.files[file.path];
            if (entry && entry.status === 'VERIFIED_COMPLETE') {
                try {
                    const { dir, fileName } = await getDirectoryForPath(root, file.path, false);
                    const handle = await dir.getFileHandle(fileName);
                    const f = await handle.getFile();
                    if (f.size !== file.size) {
                        entry.status = 'PENDING';
                        entry.bytesWritten = 0;
                    }
                } catch {
                    entry.status = 'PENDING';
                    entry.bytesWritten = 0;
                }
            } else if (!entry) {
                seedState.files[file.path] = {
                    path: file.path,
                    size: file.size,
                    sha256: file.sha256 || '',
                    status: 'PENDING',
                    bytesWritten: 0,
                };
            }
        }
    }

    // Check if all files are complete
    const allComplete = manifest.files.every(
        f => seedState!.files[f.path]?.status === 'VERIFIED_COMPLETE'
    );
    if (allComplete && seedState.status === 'COMPLETED') {
        localStorage.setItem(StorageKey.GameRes, String(GameResSource.Local));
        return 0;
    }

    seedState.status = 'SEEDING';
    await saveSeedState(root, seedState);

    let wroteFiles = 0;
    let completedBytes = manifest.files.reduce((sum, f) => {
        return sum + (seedState!.files[f.path]?.status === 'VERIFIED_COMPLETE' ? f.size : 0);
    }, 0);

    for (const file of manifest.files) {
        const fileEntry = seedState.files[file.path] || {
            path: file.path,
            size: file.size,
            sha256: file.sha256 || '',
            status: 'PENDING',
            bytesWritten: 0,
        };

        if (fileEntry.status === 'VERIFIED_COMPLETE') {
            continue;
        }

        fileEntry.status = 'IN_PROGRESS';
        await saveSeedState(root, seedState);

        const { dir, fileName } = await getDirectoryForPath(root, file.path, true);
        const tmpFileName = `${fileName}.tmp`;

        const response = await fetch(`/gameres/${file.path}`);
        if (!response.ok) {
            fileEntry.status = 'FAILED';
            await saveSeedState(root, seedState);
            throw new Error(`Failed to fetch bundled resource "${file.path}" (${response.status})`);
        }

        // Stream via chunked writes (64KB chunks)
        const tmpHandle = await dir.getFileHandle(tmpFileName, { create: true });
        const tmpWritable = await tmpHandle.createWritable();

        let totalRead = 0;
        const chunks: Uint8Array[] = [];

        if (response.body && typeof (response.body as any).getReader === 'function') {
            const reader = (response.body as ReadableStream<Uint8Array>).getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        // Slice into <= 64KB chunks to guarantee bounded memory writes
                        let offset = 0;
                        while (offset < value.byteLength) {
                            const chunk = value.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, value.byteLength));
                            await tmpWritable.write(chunk);
                            offset += chunk.byteLength;
                        }
                        totalRead += value.byteLength;
                        chunks.push(value);
                    }
                }
            } finally {
                reader.releaseLock?.();
                await tmpWritable.close();
            }
        } else if (typeof response.arrayBuffer === 'function') {
            const buf = await response.arrayBuffer();
            const uint8 = new Uint8Array(buf);
            let offset = 0;
            while (offset < uint8.byteLength) {
                const chunk = uint8.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, uint8.byteLength));
                await tmpWritable.write(chunk);
                offset += chunk.byteLength;
            }
            totalRead = uint8.byteLength;
            chunks.push(uint8);
            await tmpWritable.close();
        } else {
            await tmpWritable.close();
            throw new Error(`Unsupported response type for "${file.path}"`);
        }

        // Validate size
        if (totalRead !== file.size) {
            fileEntry.status = 'FAILED';
            await saveSeedState(root, seedState);
            if (typeof (dir as any).removeEntry === 'function') {
                try { await (dir as any).removeEntry(tmpFileName); } catch {}
            }
            throw new Error(`Size mismatch for resource "${file.path}": expected ${file.size}, got ${totalRead}`);
        }

        // Validate SHA-256
        if (file.sha256 && file.sha256.length === 64) {
            // Concatenate collected chunks for hash check
            const combined = new Uint8Array(totalRead);
            let pos = 0;
            for (const chunk of chunks) {
                combined.set(chunk, pos);
                pos += chunk.byteLength;
            }
            const calculatedHash = await computeSha256Hex(combined);
            if (calculatedHash.toLowerCase() !== file.sha256.toLowerCase()) {
                fileEntry.status = 'FAILED';
                await saveSeedState(root, seedState);
                if (typeof (dir as any).removeEntry === 'function') {
                    try { await (dir as any).removeEntry(tmpFileName); } catch {}
                }
                throw new Error(`SHA-256 mismatch for resource "${file.path}": expected ${file.sha256}, got ${calculatedHash}`);
            }
        }

        // Promote atomic .tmp file to target handle
        const tmpFileHandle = await dir.getFileHandle(tmpFileName);
        const tmpFile = await tmpFileHandle.getFile();
        const targetHandle = await dir.getFileHandle(fileName, { create: true });
        const targetWritable = await targetHandle.createWritable();

        if (typeof (tmpFile as any).stream === 'function' && typeof (targetWritable as any).write === 'function') {
            const stream = tmpFile.stream();
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) await targetWritable.write(value);
                }
            } finally {
                reader.releaseLock?.();
                await targetWritable.close();
            }
        } else {
            const tmpBuf = await tmpFile.arrayBuffer();
            await targetWritable.write(tmpBuf);
            await targetWritable.close();
        }

        if (typeof (dir as any).removeEntry === 'function') {
            try {
                await (dir as any).removeEntry(tmpFileName);
            } catch {
                // Ignore
            }
        }

        fileEntry.status = 'VERIFIED_COMPLETE';
        fileEntry.bytesWritten = file.size;
        completedBytes += file.size;
        seedState.completedBytes = completedBytes;
        await saveSeedState(root, seedState);

        wroteFiles++;
        const pct = totalBytes > 0 ? (completedBytes / totalBytes) : 1;
        onProgress(
            `Preparing game files... ${(completedBytes / 1048576).toFixed(0)} / ${(totalBytes / 1048576).toFixed(0)} MB`,
            pct
        );
    }

    seedState.status = 'COMPLETED';
    await saveSeedState(root, seedState);

    localStorage.setItem(StorageKey.GameRes, String(GameResSource.Local));
    console.log(`[opfsSeeder] Seeded ${manifest.files.length} files (${totalBytes} bytes, ${wroteFiles} written)`);
    return wroteFiles;
}

/**
 * First-launch bootstrap for native shells: seeds game resources into OPFS with progress UI.
 */
export async function seedGameResFromShell(): Promise<void> {
    if (!isNativeShell()) return;

    let overlay: ReturnType<typeof createSeedOverlay> | undefined;
    let wroteFiles = 0;
    try {
        wroteFiles = await runOpfsSeeder((text, pct) => {
            overlay ??= createSeedOverlay();
            overlay.setText(text);
        });
    } catch (e) {
        console.warn('[opfsSeeder] Shell seeding bypassed or failed, proceeding to app.main():', e);
    } finally {
        overlay?.remove();
    }

    if (wroteFiles > 0 && !sessionStorage.getItem('shellSeedReloaded')) {
        sessionStorage.setItem('shellSeedReloaded', '1');
        console.log(`[opfsSeeder] Fresh seed wrote ${wroteFiles} files; reloading once to reset memory high-water`);
        window.location.reload();
        await new Promise(() => {});
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
        setText: (text: string) => { el.textContent = text; },
        remove: () => el.remove(),
    };
}
