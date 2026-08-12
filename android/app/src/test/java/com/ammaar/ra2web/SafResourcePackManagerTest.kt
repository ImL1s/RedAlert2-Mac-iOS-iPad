package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SafResourcePackManagerTest {

    @Test
    fun testParseManifestV2Success() {
        // Context is only used for SharedPreferences/ContentResolver in SAF operations, parseManifestV2 is pure logic
        val manager = SafResourcePackManager(null as? android.content.Context ?: object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val json = """
            {
                "version": 2,
                "created": "2026-08-12T00:00:00Z",
                "files": [
                    { "path": "ra2.mix", "size": 100, "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
                ]
            }
        """.trimIndent()

        val (err, manifest) = manager.parseManifestV2(json)
        assertNull(err)
        assertNotNull(manifest)
        assertEquals(2, manifest!!.version)
        assertEquals(1, manifest.files.size)
        assertEquals("ra2.mix", manifest.files[0].path)
    }

    @Test
    fun testParseManifestV1Unsupported() {
        val manager = SafResourcePackManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val json = """
            {
                "version": 1,
                "created": "2026-08-12T00:00:00Z",
                "files": [{ "path": "ra2.mix", "size": 100 }]
            }
        """.trimIndent()

        val (err, manifest) = manager.parseManifestV2(json)
        assertNull(manifest)
        assertNotNull(err)
        assertEquals(SafResourcePackManager.PreflightStatus.UNSUPPORTED_MANIFEST_VERSION, err!!.status)
    }

    @Test
    fun testParseManifestPathTraversal() {
        val manager = SafResourcePackManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val json = """
            {
                "version": 2,
                "created": "2026-08-12T00:00:00Z",
                "files": [{ "path": "../etc/passwd", "size": 100 }]
            }
        """.trimIndent()

        val (err, manifest) = manager.parseManifestV2(json)
        assertNull(manifest)
        assertNotNull(err)
        assertEquals(SafResourcePackManager.PreflightStatus.PATH_TRAVERSAL_DETECTED, err!!.status)
        assertEquals("../etc/passwd", err.failedFile)
    }

    @Test
    fun testParseManifestDuplicateEntry() {
        val manager = SafResourcePackManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val json = """
            {
                "version": 2,
                "created": "2026-08-12T00:00:00Z",
                "files": [
                    { "path": "ra2.mix", "size": 100 },
                    { "path": "ra2.mix", "size": 100 }
                ]
            }
        """.trimIndent()

        val (err, manifest) = manager.parseManifestV2(json)
        assertNull(manifest)
        assertNotNull(err)
        assertEquals(SafResourcePackManager.PreflightStatus.DUPLICATE_MANIFEST_ENTRY, err!!.status)
    }
}
