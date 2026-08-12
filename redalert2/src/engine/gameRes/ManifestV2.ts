export interface ManifestV2Entry {
    path: string;
    size: number;
    sha256: string;
}

export interface ManifestV2 {
    version: 2;
    files: ManifestV2Entry[];
}

const SHA256_HEX_REGEX = /^[a-fA-F0-9]{64}$/;

/**
 * Validates a Resource Pack Manifest v2 structure.
 * 
 * Rejections:
 * - Missing version field (v1 manifest)
 * - version !== 2
 * - Non-array `files`
 * - File entry with missing/empty path or size < 0
 * - File entry with missing, empty, or non-64-char hex sha256
 */
export function validateManifestV2(manifest: unknown): manifest is ManifestV2 {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('Invalid manifest: expected an object');
    }

    const m = manifest as Record<string, unknown>;

    if (!('version' in m) || m.version === undefined || m.version === null) {
        throw new Error('Invalid manifest: missing version field (v1 manifests are not supported)');
    }

    if (typeof m.version !== 'number' || m.version !== 2) {
        throw new Error(`Invalid manifest: version must be 2, got ${String(m.version)}`);
    }

    if (!Array.isArray(m.files)) {
        throw new Error('Invalid manifest: "files" field must be an array');
    }

    for (let i = 0; i < m.files.length; i++) {
        const file = m.files[i];
        if (!file || typeof file !== 'object') {
            throw new Error(`Invalid manifest: file entry at index ${i} is not an object`);
        }

        const f = file as Record<string, unknown>;

        if (typeof f.path !== 'string' || !f.path.trim()) {
            throw new Error(`Invalid manifest entry at index ${i}: path must be a non-empty string`);
        }

        if (typeof f.size !== 'number' || f.size < 0) {
            throw new Error(`Invalid manifest entry "${f.path}": size must be a non-negative number`);
        }

        if (!('sha256' in f) || typeof f.sha256 !== 'string' || !f.sha256.trim()) {
            throw new Error(`Invalid manifest entry "${f.path}": sha256 must be a non-empty string`);
        }

        if (!SHA256_HEX_REGEX.test(f.sha256)) {
            throw new Error(`Invalid manifest entry "${f.path}": sha256 must be a 64-character hex string, got "${f.sha256}"`);
        }
    }

    return true;
}
