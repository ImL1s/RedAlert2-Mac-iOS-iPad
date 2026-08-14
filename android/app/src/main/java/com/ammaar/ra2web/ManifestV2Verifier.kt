package com.ammaar.ra2web

import android.content.Context
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

data class ManifestV2Entry(
    val path: String,
    val size: Long,
    val sha256: String
)

data class ManifestV2(
    val version: Int,
    val files: List<ManifestV2Entry>
)

enum class PreflightStatus {
    VALID,
    UNSUPPORTED_MANIFEST_VERSION,
    MISSING_REQUIRED_FIELDS,
    MANIFEST_PARSE_ERROR,
    PATH_TRAVERSAL_DETECTED,
    DUPLICATE_MANIFEST_ENTRY,
    INSUFFICIENT_STORAGE,
    MISSING_FILE,
    SIZE_MISMATCH,
    HASH_MISMATCH
}

data class PreflightResult(
    val status: PreflightStatus,
    val errorDetails: String? = null,
    val failedFile: String? = null,
    val fileCount: Int = 0,
    val totalBytes: Long = 0L,
    val requiredBytes: Long = 0L,
    val availableBytes: Long = 0L
) {
    val isValid: Boolean get() = status == PreflightStatus.VALID
}

class ManifestV2Verifier {

    companion object {
        const val MANIFEST_FILE_NAME = "manifest.json"
        const val STORAGE_SAFETY_MARGIN_FACTOR = 1.1
        const val CHUNK_BUFFER_SIZE = 64 * 1024 // 64KB streaming buffer

        private val SHA256_REGEX = Regex("^[a-fA-F0-9]{64}$")
    }

    /**
     * Parses and validates a Manifest v2 JSON string.
     * Enforces fail-closed rules:
     * - version must be 2
     * - files must be a non-empty array
     * - each entry must have non-empty path, size >= 0, and non-empty valid 64-char hex sha256
     * - reject path traversal attempts
     * - reject duplicate paths
     */
    fun parseManifest(jsonStr: String): Pair<PreflightResult?, ManifestV2?> {
        return try {
            val root = JSONObject(jsonStr)

            if (!root.has("version")) {
                return Pair(
                    PreflightResult(
                        status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                        errorDetails = "Manifest missing required 'version' field"
                    ),
                    null
                )
            }

            val version = root.optInt("version", -1)
            if (version != 2) {
                return Pair(
                    PreflightResult(
                        status = PreflightStatus.UNSUPPORTED_MANIFEST_VERSION,
                        errorDetails = "Unsupported manifest version: $version. Expected version 2."
                    ),
                    null
                )
            }

            if (!root.has("files")) {
                return Pair(
                    PreflightResult(
                        status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                        errorDetails = "Manifest missing required 'files' array"
                    ),
                    null
                )
            }

            val filesArray = root.optJSONArray("files")
                ?: return Pair(
                    PreflightResult(
                        status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                        errorDetails = "Manifest 'files' field is not an array"
                    ),
                    null
                )

            val entries = mutableListOf<ManifestV2Entry>()
            val seenPaths = HashSet<String>()

            for (i in 0 until filesArray.length()) {
                val obj = filesArray.optJSONObject(i)
                    ?: return Pair(
                        PreflightResult(
                            status = PreflightStatus.MANIFEST_PARSE_ERROR,
                            errorDetails = "Invalid file entry object at index $i"
                        ),
                        null
                    )

                if (!obj.has("path")) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry at index $i missing required 'path' field"
                        ),
                        null
                    )
                }
                val path = obj.optString("path", "").trim()
                if (path.isEmpty()) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry at index $i has empty 'path'"
                        ),
                        null
                    )
                }

                // Path traversal check
                if (isPathTraversal(path)) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.PATH_TRAVERSAL_DETECTED,
                            errorDetails = "Path traversal or illegal path detected: $path",
                            failedFile = path
                        ),
                        null
                    )
                }

                if (!obj.has("size")) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry '$path' missing required 'size' field",
                            failedFile = path
                        ),
                        null
                    )
                }
                val size = obj.optLong("size", -1L)
                if (size < 0) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry '$path' has invalid negative size: $size",
                            failedFile = path
                        ),
                        null
                    )
                }

                if (!obj.has("sha256")) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry '$path' missing required 'sha256' field",
                            failedFile = path
                        ),
                        null
                    )
                }
                val sha256 = obj.optString("sha256", "").trim()
                if (sha256.isEmpty()) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MISSING_REQUIRED_FIELDS,
                            errorDetails = "File entry '$path' has empty 'sha256' hash",
                            failedFile = path
                        ),
                        null
                    )
                }

                if (!SHA256_REGEX.matches(sha256)) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.MANIFEST_PARSE_ERROR,
                            errorDetails = "File entry '$path' has invalid SHA-256 format: '$sha256'",
                            failedFile = path
                        ),
                        null
                    )
                }

                val normalizedPath = path.replace('\\', '/').trimStart('/')
                if (!seenPaths.add(normalizedPath.lowercase())) {
                    return Pair(
                        PreflightResult(
                            status = PreflightStatus.DUPLICATE_MANIFEST_ENTRY,
                            errorDetails = "Duplicate file path in manifest: $path",
                            failedFile = path
                        ),
                        null
                    )
                }

                entries.add(ManifestV2Entry(path = normalizedPath, size = size, sha256 = sha256.lowercase()))
            }

            Pair(null, ManifestV2(version = version, files = entries))
        } catch (e: Exception) {
            Pair(
                PreflightResult(
                    status = PreflightStatus.MANIFEST_PARSE_ERROR,
                    errorDetails = "JSON syntax error in manifest: ${e.message}"
                ),
                null
            )
        }
    }

    /**
     * Checks for path traversal sequences and invalid path separators.
     */
    fun isPathTraversal(path: String): Boolean {
        if (path.contains("..") ||
            path.startsWith("/") ||
            path.startsWith("\\") ||
            path.contains(":") ||
            path.contains("\u0000") ||
            path.contains("%00")
        ) {
            return true
        }

        val segments = path.split('/', '\\')
        for (segment in segments) {
            if (segment == ".." || segment == ".") {
                return true
            }
        }
        return false
    }

    /**
     * Verifies a resource pack stored in a local directory.
     */
    fun verifyDirectory(directory: File, availableSpace: Long = directory.usableSpace): PreflightResult {
        if (!directory.exists() || !directory.isDirectory) {
            return PreflightResult(
                status = PreflightStatus.MISSING_FILE,
                errorDetails = "Resource pack directory not found: ${directory.absolutePath}"
            )
        }

        val manifestFile = File(directory, MANIFEST_FILE_NAME)
        if (!manifestFile.exists() || !manifestFile.isFile) {
            return PreflightResult(
                status = PreflightStatus.MISSING_FILE,
                errorDetails = "Manifest file '$MANIFEST_FILE_NAME' missing in directory",
                failedFile = MANIFEST_FILE_NAME
            )
        }

        val manifestJson = try {
            manifestFile.readText(Charsets.UTF_8)
        } catch (e: Exception) {
            return PreflightResult(
                status = PreflightStatus.MANIFEST_PARSE_ERROR,
                errorDetails = "Failed to read '$MANIFEST_FILE_NAME': ${e.message}"
            )
        }

        return verifyWithStreamProvider(
            manifestJson = manifestJson,
            openStream = { relPath ->
                val file = File(directory, relPath)
                if (file.exists() && file.isFile) FileInputStream(file) else null
            },
            getFileSize = { relPath ->
                val file = File(directory, relPath)
                if (file.exists() && file.isFile) file.length() else null
            },
            availableSpace = availableSpace
        )
    }

    /**
     * Verifies a resource pack given an openStream and getFileSize provider.
     */
    fun verifyWithStreamProvider(
        manifestJson: String,
        openStream: (String) -> InputStream?,
        getFileSize: (String) -> Long?,
        availableSpace: Long
    ): PreflightResult {
        val (parseError, manifest) = parseManifest(manifestJson)
        if (parseError != null) {
            return parseError
        }
        if (manifest == null) {
            return PreflightResult(
                status = PreflightStatus.MANIFEST_PARSE_ERROR,
                errorDetails = "Failed to parse manifest"
            )
        }

        val totalBytes = manifest.files.sumOf { it.size }
        val requiredBytes = (totalBytes * STORAGE_SAFETY_MARGIN_FACTOR).toLong()

        // Storage preflight check
        if (availableSpace < requiredBytes) {
            return PreflightResult(
                status = PreflightStatus.INSUFFICIENT_STORAGE,
                errorDetails = "Available storage ($availableSpace bytes) is less than required ($requiredBytes bytes including 10% safety margin)",
                fileCount = manifest.files.size,
                totalBytes = totalBytes,
                requiredBytes = requiredBytes,
                availableBytes = availableSpace
            )
        }

        val digest = try {
            MessageDigest.getInstance("SHA-256")
        } catch (e: Exception) {
            return PreflightResult(
                status = PreflightStatus.MANIFEST_PARSE_ERROR,
                errorDetails = "SHA-256 algorithm unavailable: ${e.message}"
            )
        }
        val buffer = ByteArray(CHUNK_BUFFER_SIZE)

        for (entry in manifest.files) {
            val actualSize = getFileSize(entry.path)
                ?: return PreflightResult(
                    status = PreflightStatus.MISSING_FILE,
                    errorDetails = "Missing resource file: ${entry.path}",
                    failedFile = entry.path,
                    fileCount = manifest.files.size,
                    totalBytes = totalBytes,
                    requiredBytes = requiredBytes,
                    availableBytes = availableSpace
                )

            if (actualSize != entry.size) {
                return PreflightResult(
                    status = PreflightStatus.SIZE_MISMATCH,
                    errorDetails = "Size mismatch for '${entry.path}': expected ${entry.size} bytes, got $actualSize bytes",
                    failedFile = entry.path,
                    fileCount = manifest.files.size,
                    totalBytes = totalBytes,
                    requiredBytes = requiredBytes,
                    availableBytes = availableSpace
                )
            }

            val stream = openStream(entry.path)
                ?: return PreflightResult(
                    status = PreflightStatus.MISSING_FILE,
                    errorDetails = "Cannot open stream for: ${entry.path}",
                    failedFile = entry.path,
                    fileCount = manifest.files.size,
                    totalBytes = totalBytes,
                    requiredBytes = requiredBytes,
                    availableBytes = availableSpace
                )

            val calculatedHash = try {
                computeSha256(stream, digest, buffer)
            } catch (e: Exception) {
                return PreflightResult(
                    status = PreflightStatus.MANIFEST_PARSE_ERROR,
                    errorDetails = "Error calculating SHA-256 for '${entry.path}': ${e.message}",
                    failedFile = entry.path,
                    fileCount = manifest.files.size,
                    totalBytes = totalBytes,
                    requiredBytes = requiredBytes,
                    availableBytes = availableSpace
                )
            }

            if (!calculatedHash.equals(entry.sha256, ignoreCase = true)) {
                return PreflightResult(
                    status = PreflightStatus.HASH_MISMATCH,
                    errorDetails = "SHA-256 hash mismatch for '${entry.path}': expected ${entry.sha256}, got $calculatedHash",
                    failedFile = entry.path,
                    fileCount = manifest.files.size,
                    totalBytes = totalBytes,
                    requiredBytes = requiredBytes,
                    availableBytes = availableSpace
                )
            }
        }

        return PreflightResult(
            status = PreflightStatus.VALID,
            fileCount = manifest.files.size,
            totalBytes = totalBytes,
            requiredBytes = requiredBytes,
            availableBytes = availableSpace
        )
    }

    /**
     * Verifies a resource pack in a SAF DocumentFile directory tree.
     */
    fun verifyDocumentTree(
        context: Context,
        treeDoc: DocumentFile,
        availableSpace: Long = context.filesDir.usableSpace
    ): PreflightResult {
        if (!treeDoc.exists() || !treeDoc.isDirectory) {
            return PreflightResult(
                status = PreflightStatus.MISSING_FILE,
                errorDetails = "Selected SAF document tree does not exist or is not a directory"
            )
        }

        val manifestDoc = treeDoc.findFile(MANIFEST_FILE_NAME)
            ?: return PreflightResult(
                status = PreflightStatus.MISSING_FILE,
                errorDetails = "Manifest file '$MANIFEST_FILE_NAME' missing in selected directory",
                failedFile = MANIFEST_FILE_NAME
            )

        val manifestJson = try {
            context.contentResolver.openInputStream(manifestDoc.uri)?.use { stream ->
                stream.bufferedReader(Charsets.UTF_8).readText()
            }
        } catch (e: Exception) {
            null
        } ?: return PreflightResult(
            status = PreflightStatus.MANIFEST_PARSE_ERROR,
            errorDetails = "Failed to read '$MANIFEST_FILE_NAME' from SAF document tree"
        )

        // Index the directory recursively for fast lookups
        val fileMap = HashMap<String, DocumentFile>()
        indexDirectory(treeDoc, "", fileMap)

        return verifyWithStreamProvider(
            manifestJson = manifestJson,
            openStream = { relPath ->
                val doc = fileMap[relPath.lowercase()]
                if (doc != null) context.contentResolver.openInputStream(doc.uri) else null
            },
            getFileSize = { relPath ->
                fileMap[relPath.lowercase()]?.length()
            },
            availableSpace = availableSpace
        )
    }

    private fun indexDirectory(dirDoc: DocumentFile, currentPath: String, fileMap: MutableMap<String, DocumentFile>) {
        for (file in dirDoc.listFiles()) {
            val name = file.name ?: continue
            val relPath = if (currentPath.isEmpty()) name else "$currentPath/$name"
            if (file.isDirectory) {
                indexDirectory(file, relPath, fileMap)
            } else {
                fileMap[relPath.lowercase()] = file
            }
        }
    }

    private fun computeSha256(stream: InputStream, digest: MessageDigest, buffer: ByteArray): String {
        digest.reset()
        BufferedInputStream(stream, CHUNK_BUFFER_SIZE).use { bis ->
            var bytesRead: Int
            while (bis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }

        val hashBytes = digest.digest()
        val sb = StringBuilder(64)
        for (b in hashBytes) {
            sb.append(String.format("%02x", b))
        }
        return sb.toString()
    }
}
