import * as crypto from 'crypto';

export interface ManifestV2Entry {
  path: string;
  size: number;
  sha256: string;
}

export interface ManifestV2 {
  version: number;
  created: string;
  files: ManifestV2Entry[];
}

export interface MockAssetSpec {
  path: string;
  sizeBytes?: number;
  content?: string | Uint8Array;
  tamperHash?: boolean;
  tamperSize?: boolean;
  overrideSha256?: string;
  overrideSize?: number;
}

export interface PreflightResult {
  status:
    | 'VALID'
    | 'MISSING_MANIFEST'
    | 'UNSUPPORTED_MANIFEST_VERSION'
    | 'MANIFEST_PARSE_ERROR'
    | 'MISSING_REQUIRED_FIELDS'
    | 'MISSING_FILE'
    | 'SIZE_MISMATCH'
    | 'HASH_MISMATCH'
    | 'INSUFFICIENT_STORAGE'
    | 'PATH_TRAVERSAL_DETECTED'
    | 'DUPLICATE_MANIFEST_ENTRY';
  errorDetails?: string;
  failedFile?: string;
  requiredBytes?: number;
  availableBytes?: number;
}

/**
 * Calculates SHA-256 hex string for given binary buffer or string payload.
 */
export function calculateSha256(data: Uint8Array | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Creates synthetic binary payload buffer of specified size (0 retail assets).
 */
export function createSyntheticPayload(sizeBytes: number = 1024, fillByte: number = 0x5a): Uint8Array {
  const buf = new Uint8Array(sizeBytes);
  buf.fill(fillByte);
  return buf;
}

/**
 * Generates a complete mock resource pack containing synthetic files and a valid or custom Manifest v2.
 */
export function generateMockResourcePack(
  specs: MockAssetSpec[] = [
    { path: 'audio.mix', sizeBytes: 1024 },
    { path: 'ra2.mix', sizeBytes: 2048 },
    { path: 'theme.mix', sizeBytes: 512 },
  ],
  manifestOverrides: { version?: number; created?: string } = {}
): {
  files: Map<string, Uint8Array>;
  manifest: ManifestV2;
  manifestJson: string;
} {
  const files = new Map<string, Uint8Array>();
  const entries: ManifestV2Entry[] = [];

  for (const spec of specs) {
    const content = spec.content
      ? typeof spec.content === 'string'
        ? Buffer.from(spec.content, 'utf-8')
        : spec.content
      : createSyntheticPayload(spec.sizeBytes ?? 1024);

    if (!spec.path.includes('..') && !spec.path.startsWith('/')) {
      files.set(spec.path, content);
    }

    const actualSize = content.length;
    const actualHash = calculateSha256(content);

    const entrySize = spec.overrideSize ?? (spec.tamperSize ? actualSize + 100 : actualSize);
    const entryHash = spec.overrideSha256 ?? (spec.tamperHash ? '0000000000000000000000000000000000000000000000000000000000000000' : actualHash);

    entries.push({
      path: spec.path,
      size: entrySize,
      sha256: entryHash,
    });
  }

  // Deterministically sort entries by path
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const manifest: ManifestV2 = {
    version: manifestOverrides.version ?? 2,
    created: manifestOverrides.created ?? '2026-08-12T00:00:00.000Z',
    files: entries,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  files.set('manifest.json', Buffer.from(manifestJson, 'utf-8'));

  return { files, manifest, manifestJson };
}

/**
 * Validates Manifest v2 and resource pack files against preflight contracts.
 * Simulates Android SafResourcePackManager preflight verification.
 */
export function validateResourcePackPreflight(
  manifestInput: string | any,
  availableFiles?: Map<string, Uint8Array>,
  diskSpaceOptions?: { availableDiskBytes?: number; requiredSpaceMarginBytes?: number }
): PreflightResult {
  if (manifestInput === null || manifestInput === undefined) {
    return { status: 'MISSING_MANIFEST', errorDetails: 'manifest.json is missing or null' };
  }

  let manifest: any;
  if (typeof manifestInput === 'string') {
    try {
      manifest = JSON.parse(manifestInput);
    } catch (e: any) {
      return { status: 'MANIFEST_PARSE_ERROR', errorDetails: `Invalid JSON syntax: ${e.message}` };
    }
  } else {
    manifest = manifestInput;
  }

  if (typeof manifest !== 'object' || manifest === null) {
    return { status: 'MANIFEST_PARSE_ERROR', errorDetails: 'Manifest root must be an object' };
  }

  if (manifest.version !== 2) {
    if (typeof manifest.version !== 'number') {
      return { status: 'MISSING_REQUIRED_FIELDS', errorDetails: 'Manifest version field missing' };
    }
    return { status: 'UNSUPPORTED_MANIFEST_VERSION', errorDetails: `Version ${manifest.version} is not supported. Required: 2` };
  }

  if (!manifest.created || !Array.isArray(manifest.files)) {
    return { status: 'MISSING_REQUIRED_FIELDS', errorDetails: 'Manifest missing created timestamp or files array' };
  }

  const seenPaths = new Set<string>();
  let totalRequiredBytes = 0;

  for (const entry of manifest.files) {
    if (!entry.path || typeof entry.size !== 'number' || !entry.sha256) {
      return { status: 'MISSING_REQUIRED_FIELDS', errorDetails: 'Entry missing path, size, or sha256' };
    }

    if (entry.path.includes('..') || entry.path.startsWith('/')) {
      return { status: 'PATH_TRAVERSAL_DETECTED', errorDetails: `Path traversal attempt detected in entry: ${entry.path}`, failedFile: entry.path };
    }

    if (seenPaths.has(entry.path)) {
      return { status: 'DUPLICATE_MANIFEST_ENTRY', errorDetails: `Duplicate manifest entry: ${entry.path}`, failedFile: entry.path };
    }
    seenPaths.add(entry.path);

    totalRequiredBytes += entry.size;
  }

  // Disk space validation check (Default requirement: 750MB + 20% margin = 900MB)
  const defaultRequiredMargin = 750 * 1024 * 1024 * 1.2;
  const availableDiskBytes = diskSpaceOptions?.availableDiskBytes ?? 2 * 1024 * 1024 * 1024; // Default 2GB available
  const requiredThreshold = diskSpaceOptions?.requiredSpaceMarginBytes ?? defaultRequiredMargin;

  if (availableDiskBytes < requiredThreshold) {
    return {
      status: 'INSUFFICIENT_STORAGE',
      errorDetails: `Available disk space (${availableDiskBytes} bytes) is below minimum threshold (${requiredThreshold} bytes)`,
      requiredBytes: requiredThreshold,
      availableBytes: availableDiskBytes,
    };
  }

  // Check file presence, size, and hash if availableFiles map provided
  if (availableFiles) {
    for (const entry of manifest.files) {
      const fileData = availableFiles.get(entry.path);
      if (!fileData) {
        return { status: 'MISSING_FILE', errorDetails: `Required file missing: ${entry.path}`, failedFile: entry.path };
      }

      if (fileData.length !== entry.size) {
        return {
          status: 'SIZE_MISMATCH',
          errorDetails: `File size mismatch for ${entry.path}. Expected ${entry.size}, got ${fileData.length}`,
          failedFile: entry.path,
        };
      }

      const hash = calculateSha256(fileData);
      if (hash.toLowerCase() !== entry.sha256.toLowerCase()) {
        return {
          status: 'HASH_MISMATCH',
          errorDetails: `File SHA-256 mismatch for ${entry.path}. Expected ${entry.sha256}, got ${hash}`,
          failedFile: entry.path,
        };
      }
    }
  }

  return { status: 'VALID' };
}
