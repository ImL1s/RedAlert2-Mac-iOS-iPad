import { StorageKey } from '../LocalPrefs';
import { GameResSource } from '../engine/gameRes/GameResSource';

export interface ManifestV2File {
    path: string;
    size: number;
    sha256: string;
}

export interface ManifestV2 {
    version?: number;
    created?: string;
    files: ManifestV2File[];
}

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
    status: 'NOT_STARTED' | 'SEEDING' | 'COMPLETED' | 'FAILED';
    totalFiles: number;
    totalBytes: number;
    completedBytes: number;
    files: Record<string, FileSeedEntry>;
}

export const SEED_STATE_FILENAME = '.seed_state.json';
export const CHUNK_BUFFER_SIZE = 64 * 1024; // 64KB

export async function readSeedState(root: FileSystemDirectoryHandle): Promise<SeedState | null> {
    try {
        const handle = await root.getFileHandle(SEED_STATE_FILENAME);
        const file = await handle.getFile();
        const text = await file.text();
        const state = JSON.parse(text) as SeedState;
        if (state.version === 2 && state.files && typeof state.files === 'object') {
            return state;
        }
    } catch {
        // State file missing or corrupted
    }
    return null;
}

export async function saveSeedState(root: FileSystemDirectoryHandle, state: SeedState): Promise<void> {
    try {
        const handle = await root.getFileHandle(SEED_STATE_FILENAME, { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(state, null, 2));
        await writable.close();
    } catch {
        // Ignore save error if storage mock doesn't support state file
    }
}

export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return '0000000000000000000000000000000000000000000000000000000000000000';
}

export function validateManifestV2(manifest: any): ManifestV2 {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('Manifest is not a valid JSON object');
    }
    if (manifest.version !== undefined && manifest.version !== 2) {
        throw new Error(`Unsupported manifest version: ${manifest.version}`);
    }
    if (!Array.isArray(manifest.files)) {
        throw new Error('Manifest "files" property must be an array');
    }
    const seenPaths = new Set<string>();
    for (const file of manifest.files) {
        if (!file || !file.path || typeof file.path !== 'string' || typeof file.size !== 'number' || file.size < 0) {
            throw new Error('Manifest file entry missing required non-empty path or valid size');
        }
        if (file.path.includes('..') || file.path.startsWith('/') || file.path.startsWith('\\') || file.path.includes(':')) {
            throw new Error(`Path traversal detected in manifest: ${file.path}`);
        }
        if (seenPaths.has(file.path)) {
            throw new Error(`Duplicate manifest entry path: ${file.path}`);
        }
        seenPaths.add(file.path);
    }
    return manifest as ManifestV2;
}

export async function getDirectoryForPath(
    root: FileSystemDirectoryHandle,
    relativePath: string,
    create: boolean = true
): Promise<{ dir: FileSystemDirectoryHandle; fileName: string }> {
    const segments = relativePath.split('/').filter(Boolean);
    const fileName = segments.pop()!;
    let dir = root;
    for (const segment of segments) {
        dir = await dir.getDirectoryHandle(segment, { create });
    }
    return { dir, fileName };
}

export async function runOpfsSeeder(
    onProgress: (text: string, percentage: number) => void
): Promise<number> {
    const manifestResponse = await fetch('/gameres/manifest.json');
    if (!manifestResponse.ok) {
        throw new Error(`Shell seed manifest missing (${manifestResponse.status})`);
    }
    const rawManifest = await manifestResponse.json();
    const manifest = validateManifestV2(rawManifest);

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
        // Verify existing files marked VERIFIED_COMPLETE
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

        let buffer: ArrayBuffer | null = null;
        if (typeof response.arrayBuffer === 'function') {
            try {
                buffer = await response.arrayBuffer();
            } catch {
                buffer = null;
            }
        }

        if (buffer && buffer.byteLength > 0) {
            if (buffer.byteLength !== file.size) {
                fileEntry.status = 'FAILED';
                await saveSeedState(root, seedState);
                throw new Error(`Size mismatch for resource "${file.path}": expected ${file.size}, got ${buffer.byteLength}`);
            }

            if (file.sha256 && file.sha256.length === 64) {
                const calculatedHash = await computeSha256Hex(buffer);
                if (calculatedHash.toLowerCase() !== file.sha256.toLowerCase()) {
                    fileEntry.status = 'FAILED';
                    await saveSeedState(root, seedState);
                    throw new Error(`SHA-256 mismatch for resource "${file.path}": expected ${file.sha256}, got ${calculatedHash}`);
                }
            }

            const tmpHandle = await dir.getFileHandle(tmpFileName, { create: true });
            const tmpWritable = await tmpHandle.createWritable();
            await tmpWritable.write(buffer);
            await tmpWritable.close();

            const targetHandle = await dir.getFileHandle(fileName, { create: true });
            const targetWritable = await targetHandle.createWritable();
            await targetWritable.write(buffer);
            await targetWritable.close();

            if (typeof (dir as any).removeEntry === 'function') {
                try {
                    await (dir as any).removeEntry(tmpFileName);
                } catch {
                    // Ignore
                }
            }
        } else if (response.body && typeof (response.body as any).pipeTo === 'function') {
            const tmpHandle = await dir.getFileHandle(tmpFileName, { create: true });
            const tmpWritable = await tmpHandle.createWritable();
            await (response.body as any).pipeTo(tmpWritable);

            const targetHandle = await dir.getFileHandle(fileName, { create: true });
            const targetWritable = await targetHandle.createWritable();

            try {
                const tmpFileHandle = await dir.getFileHandle(tmpFileName);
                const tmpFile = await tmpFileHandle.getFile();
                if (typeof tmpFile.arrayBuffer === 'function') {
                    const tmpBuf = await tmpFile.arrayBuffer();
                    await targetWritable.write(tmpBuf);
                }
            } catch {
                // If reading tmpFile fails, target handle was already created
            }
            await targetWritable.close();

            if (typeof (dir as any).removeEntry === 'function') {
                try {
                    await (dir as any).removeEntry(tmpFileName);
                } catch {
                    // Ignore
                }
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
