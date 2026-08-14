package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class ManifestV2VerifierTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var verifier: ManifestV2Verifier
    private lateinit var packDir: File

    private fun sha256Hex(content: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(content.toByteArray(Charsets.UTF_8))
        return hash.joinToString("") { "%02x".format(it) }
    }

    @Before
    fun setUp() {
        verifier = ManifestV2Verifier()
        packDir = tempFolder.newFolder("pack")
    }

    @Test
    fun testParseWellFormedManifestV2() {
        val json = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100,
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    }
                ]
            }
        """.trimIndent()

        val (error, manifest) = verifier.parseManifest(json)
        assertNull(error)
        assertNotNull(manifest)
        assertEquals(2, manifest!!.version)
        assertEquals(1, manifest.files.size)
        assertEquals("ra2.mix", manifest.files[0].path)
        assertEquals(100L, manifest.files[0].size)
        assertEquals("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", manifest.files[0].sha256)
    }

    @Test
    fun testParseRejectsMissingVersion() {
        val json = """
            {
                "files": []
            }
        """.trimIndent()

        val (error, manifest) = verifier.parseManifest(json)
        assertNull(manifest)
        assertNotNull(error)
        assertEquals(PreflightStatus.MISSING_REQUIRED_FIELDS, error!!.status)
    }

    @Test
    fun testParseRejectsUnsupportedVersion() {
        val json = """
            {
                "version": 1,
                "files": []
            }
        """.trimIndent()

        val (error, manifest) = verifier.parseManifest(json)
        assertNull(manifest)
        assertNotNull(error)
        assertEquals(PreflightStatus.UNSUPPORTED_MANIFEST_VERSION, error!!.status)
    }

    @Test
    fun testParseRejectsNonArrayFiles() {
        val json = """
            {
                "version": 2,
                "files": "not an array"
            }
        """.trimIndent()

        val (error, manifest) = verifier.parseManifest(json)
        assertNull(manifest)
        assertNotNull(error)
        assertEquals(PreflightStatus.MISSING_REQUIRED_FIELDS, error!!.status)
    }

    @Test
    fun testParseRejectsEmptyOrMissingSha256() {
        val missingShaJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100
                    }
                ]
            }
        """.trimIndent()

        val (err1, _) = verifier.parseManifest(missingShaJson)
        assertEquals(PreflightStatus.MISSING_REQUIRED_FIELDS, err1!!.status)

        val emptyShaJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100,
                        "sha256": ""
                    }
                ]
            }
        """.trimIndent()

        val (err2, _) = verifier.parseManifest(emptyShaJson)
        assertEquals(PreflightStatus.MISSING_REQUIRED_FIELDS, err2!!.status)
    }

    @Test
    fun testParseRejectsInvalidSha256Format() {
        val invalidHexJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100,
                        "sha256": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
                    }
                ]
            }
        """.trimIndent()

        val (err1, _) = verifier.parseManifest(invalidHexJson)
        assertEquals(PreflightStatus.MANIFEST_PARSE_ERROR, err1!!.status)

        val wrongLengthJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100,
                        "sha256": "abcd1234"
                    }
                ]
            }
        """.trimIndent()

        val (err2, _) = verifier.parseManifest(wrongLengthJson)
        assertEquals(PreflightStatus.MANIFEST_PARSE_ERROR, err2!!.status)
    }

    @Test
    fun testParseRejectsPathTraversal() {
        val traversalPaths = listOf(
            "../secret.txt",
            "/absolute/path.mix",
            "\\\\windows\\\\path.mix",
            "dir/../../etc/passwd",
            "file.mix%00.png"
        )

        for (p in traversalPaths) {
            val json = """
                {
                    "version": 2,
                    "files": [
                        {
                            "path": "$p",
                            "size": 100,
                            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                        }
                    ]
                }
            """.trimIndent()

            val (error, _) = verifier.parseManifest(json)
            assertNotNull("Should fail for path: $p", error)
            assertEquals("Should detect path traversal for: $p", PreflightStatus.PATH_TRAVERSAL_DETECTED, error!!.status)
        }

        assertTrue(verifier.isPathTraversal(".."))
        assertTrue(verifier.isPathTraversal("../file"))
        assertTrue(verifier.isPathTraversal("/file"))
        assertTrue(verifier.isPathTraversal("\\file"))
        assertTrue(verifier.isPathTraversal("dir/..\\file"))
        assertTrue(verifier.isPathTraversal("file\u0000.png"))
        assertTrue(verifier.isPathTraversal("file%00.png"))
        assertTrue(verifier.isPathTraversal("c:file"))
    }

    @Test
    fun testParseRejectsDuplicatePaths() {
        val json = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 100,
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    },
                    {
                        "path": "RA2.MIX",
                        "size": 100,
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    }
                ]
            }
        """.trimIndent()

        val (error, _) = verifier.parseManifest(json)
        assertNotNull(error)
        assertEquals(PreflightStatus.DUPLICATE_MANIFEST_ENTRY, error!!.status)
    }

    @Test
    fun testVerifyDirectoryFullSuccess() {
        val content1 = "Hello RA2 Web"
        val hash1 = sha256Hex(content1)
        val file1 = File(packDir, "ra2.mix")
        file1.writeText(content1)

        val subDir = File(packDir, "maps")
        subDir.mkdirs()
        val content2 = "Map file content"
        val hash2 = sha256Hex(content2)
        val file2 = File(subDir, "eb3.map")
        file2.writeText(content2)

        val manifestJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": ${content1.toByteArray(Charsets.UTF_8).size},
                        "sha256": "$hash1"
                    },
                    {
                        "path": "maps/eb3.map",
                        "size": ${content2.toByteArray(Charsets.UTF_8).size},
                        "sha256": "$hash2"
                    }
                ]
            }
        """.trimIndent()

        val manifestFile = File(packDir, "manifest.json")
        manifestFile.writeText(manifestJson)

        val result = verifier.verifyDirectory(packDir, availableSpace = 1000000L)
        assertTrue(result.isValid)
        assertEquals(PreflightStatus.VALID, result.status)
        assertEquals(2, result.fileCount)
    }

    @Test
    fun testVerifyFailsOnInsufficientStorage() {
        val content = "Test Content"
        val hash = sha256Hex(content)
        val size = content.toByteArray(Charsets.UTF_8).size.toLong()

        val manifestJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": $size,
                        "sha256": "$hash"
                    }
                ]
            }
        """.trimIndent()

        // Required bytes = (size * 1.1).toLong()
        val requiredBytes = (size * 1.1).toLong()
        val insufficientSpace = requiredBytes - 1L

        val result = verifier.verifyWithStreamProvider(
            manifestJson = manifestJson,
            openStream = { content.byteInputStream() },
            getFileSize = { size },
            availableSpace = insufficientSpace
        )

        assertFalse(result.isValid)
        assertEquals(PreflightStatus.INSUFFICIENT_STORAGE, result.status)
    }

    @Test
    fun testVerifyFailsOnMissingFile() {
        val file1 = File(packDir, "ra2.mix")
        file1.writeText("content")

        val manifestJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 7,
                        "sha256": "${sha256Hex("content")}"
                    },
                    {
                        "path": "missing.mix",
                        "size": 100,
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    }
                ]
            }
        """.trimIndent()
        File(packDir, "manifest.json").writeText(manifestJson)

        val result = verifier.verifyDirectory(packDir, availableSpace = 100000L)
        assertFalse(result.isValid)
        assertEquals(PreflightStatus.MISSING_FILE, result.status)
        assertEquals("missing.mix", result.failedFile)
    }

    @Test
    fun testVerifyFailsOnSizeMismatch() {
        val file1 = File(packDir, "ra2.mix")
        file1.writeText("content")

        val manifestJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 9999,
                        "sha256": "${sha256Hex("content")}"
                    }
                ]
            }
        """.trimIndent()
        File(packDir, "manifest.json").writeText(manifestJson)

        val result = verifier.verifyDirectory(packDir, availableSpace = 100000L)
        assertFalse(result.isValid)
        assertEquals(PreflightStatus.SIZE_MISMATCH, result.status)
        assertEquals("ra2.mix", result.failedFile)
    }

    @Test
    fun testVerifyFailsOnHashMismatch() {
        val file1 = File(packDir, "ra2.mix")
        file1.writeText("actual content")

        val manifestJson = """
            {
                "version": 2,
                "files": [
                    {
                        "path": "ra2.mix",
                        "size": 14,
                        "sha256": "${sha256Hex("corrupted content")}"
                    }
                ]
            }
        """.trimIndent()
        File(packDir, "manifest.json").writeText(manifestJson)

        val result = verifier.verifyDirectory(packDir, availableSpace = 100000L)
        assertFalse(result.isValid)
        assertEquals(PreflightStatus.HASH_MISMATCH, result.status)
        assertEquals("ra2.mix", result.failedFile)
    }
}
