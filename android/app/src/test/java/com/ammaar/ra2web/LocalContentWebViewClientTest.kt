package com.ammaar.ra2web

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
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
import java.io.IOException

class LocalContentWebViewClientTest {

    @get:Rule
    val tempFolder = TemporaryFolder()

    private lateinit var client: LocalContentWebViewClient
    private lateinit var filesDir: File

    private class DummyContext : android.content.ContextWrapper(null) {
        override fun getAssets(): android.content.res.AssetManager {
            throw IOException("No assets in JVM test environment")
        }
        override fun getCacheDir(): File = File(".")
        override fun getFilesDir(): File = File(".")
        override fun getApplicationContext(): Context = this
        override fun getPackageName(): String = "com.ammaar.ra2web.test"
        override fun getClassLoader(): ClassLoader = ClassLoader.getSystemClassLoader()
    }

    @Before
    fun setUp() {
        filesDir = tempFolder.newFolder("files")
        val gameresDir = File(filesDir, "gameres")
        gameresDir.mkdirs()

        val dummyAsset = File(gameresDir, "ra2.mix")
        dummyAsset.writeText("DUMMY MIX CONTENT")

        val subDir = File(gameresDir, "maps")
        subDir.mkdirs()
        val dummyMap = File(subDir, "map01.map")
        dummyMap.writeText("DUMMY MAP CONTENT")

        client = LocalContentWebViewClient(
            context = DummyContext(),
            filesDir = filesDir
        )
    }

    @Test
    fun testPathTraversalEdgeCases() {
        val edgeCases = listOf(
            "/gameres/../secret.txt",
            "/gameres/..%2Fsecret.txt",
            "/gameres/%2e%2e/secret.txt",
            "/gameres/%252e%252e/secret.txt",
            "/gameres/%252e%252e%252fsecret.txt",
            "/gameres/..\\secret.txt",
            "/gameres/..%5csecret.txt",
            "/gameres/%255csecret.txt",
            "/gameres/ra2.mix%00.png",
            "/gameres/ra2.mix\u0000.png",
            "/gameres/ra2.mix%2500.png",
            "/gameres/sub/../../etc/passwd",
            "/gameres/%2e%2e%5c",
            "/gameres/foo/bar/../../../etc/shadow"
        )

        for (path in edgeCases) {
            assertTrue("Should detect path traversal for: $path", client.isPathTraversalAttempt(path))
            val response = client.handleGameResourceRequest(path)
            assertEquals("Response status should be 403 for: $path", 403, response.statusCode)
        }
    }

    @Test
    fun testCanonicalPathContainmentCheck() {
        val rootDir = File(filesDir, "gameres")
        val safeFile = File(rootDir, "ra2.mix")
        val escapedFile = File(rootDir, "../secret.txt")
        val siblingFile = File(filesDir, "gameres_fake/secret.txt")

        assertTrue(client.isCanonicalContained(safeFile, rootDir))
        assertFalse(client.isCanonicalContained(escapedFile, rootDir))
        assertFalse(client.isCanonicalContained(siblingFile, rootDir))
    }

    @Test
    fun testValidGameResourceStreaming() {
        val response = client.handleGameResourceRequest("/gameres/ra2.mix")
        assertEquals(200, response.statusCode)
        assertEquals("application/octet-stream", response.mimeType)
        assertNotNull(response.data)
        val content = response.data?.readBytes()?.toString(Charsets.UTF_8)
        assertEquals("DUMMY MIX CONTENT", content)
    }

    @Test
    fun testSubdirectoryGameResourceStreaming() {
        val response = client.handleGameResourceRequest("/gameres/maps/map01.map")
        assertEquals(200, response.statusCode)
        assertEquals("application/octet-stream", response.mimeType)
        assertNotNull(response.data)
        val content = response.data?.readBytes()?.toString(Charsets.UTF_8)
        assertEquals("DUMMY MAP CONTENT", content)
    }

    @Test
    fun testMissingFileReturns404() {
        val response = client.handleGameResourceRequest("/gameres/nonexistent.mix")
        assertEquals(404, response.statusCode)
    }

    @Test
    fun testMimeTypes() {
        assertEquals("application/octet-stream", client.getMimeType("ra2.mix"))
        assertEquals("application/octet-stream", client.getMimeType("language.csf"))
        assertEquals("application/octet-stream", client.getMimeType("map.map"))
        assertEquals("application/octet-stream", client.getMimeType("test.mpr"))
        assertEquals("application/octet-stream", client.getMimeType("game.yro"))
        assertEquals("application/octet-stream", client.getMimeType("sound.vqp"))
        assertEquals("application/octet-stream", client.getMimeType("palette.pal"))
        assertEquals("application/octet-stream", client.getMimeType("unit.shp"))
        assertEquals("application/octet-stream", client.getMimeType("vox.vxp"))
        assertEquals("application/octet-stream", client.getMimeType("temp.tmp"))
        assertEquals("application/octet-stream", client.getMimeType("data.bin"))
        assertEquals("application/octet-stream", client.getMimeType("raw.dat"))
        assertEquals("text/html", client.getMimeType("index.html"))
        assertEquals("text/javascript", client.getMimeType("bundle.js"))
        assertEquals("text/css", client.getMimeType("style.css"))
        assertEquals("application/json", client.getMimeType("data.json"))
        assertEquals("application/wasm", client.getMimeType("engine.wasm"))
        assertEquals("image/png", client.getMimeType("logo.png"))
        assertEquals("image/jpeg", client.getMimeType("photo.jpg"))
        assertEquals("image/gif", client.getMimeType("anim.gif"))
        assertEquals("image/svg+xml", client.getMimeType("icon.svg"))
        assertEquals("audio/wav", client.getMimeType("effect.wav"))
        assertEquals("audio/mpeg", client.getMimeType("music.mp3"))
        assertEquals("audio/ogg", client.getMimeType("voice.ogg"))
        assertEquals("application/octet-stream", client.getMimeType("unknown.xyz"))
    }

    @Test
    fun testMultiPassUrlDecoder() {
        assertEquals("../secret.txt", client.decodeMultiPass("%252e%252e/secret.txt"))
        assertEquals("..\\secret.txt", client.decodeMultiPass("%252e%252e%255csecret.txt"))
        assertEquals("foo/bar", client.decodeMultiPass("foo/bar"))
    }

    @Test
    fun testRenderProcessGoneDelegation() {
        var callbackTriggered = false
        var crashedValue = false
        val customClient = LocalContentWebViewClient(
            context = DummyContext(),
            filesDir = filesDir,
            onRenderProcessGoneListener = { didCrash ->
                callbackTriggered = true
                crashedValue = didCrash
                true
            }
        )

        val result = customClient.onRenderProcessGone(null, null)
        assertTrue(callbackTriggered)
        assertTrue(crashedValue)
        assertTrue(result)
    }

    @Test
    fun testQueryStringAndFragmentStripping() {
        val response = client.handleGameResourceRequest("/gameres/ra2.mix?version=1.0.0#section")
        assertEquals(200, response.statusCode)
        assertEquals("application/octet-stream", response.mimeType)
        assertNotNull(response.data)
        val content = response.data?.readBytes()?.toString(Charsets.UTF_8)
        assertEquals("DUMMY MIX CONTENT", content)
    }

    @Test
    fun testNullByteAndEncodedNullByteTraversal() {
        val paths = listOf(
            "/gameres/ra2.mix%00.ext",
            "/gameres/ra2.mix\u0000.ext",
            "/gameres/ra2.mix%2500.ext"
        )
        for (p in paths) {
            assertTrue("Path traversal should be detected for null byte: $p", client.isPathTraversalAttempt(p))
            val res = client.handleGameResourceRequest(p)
            assertEquals(403, res.statusCode)
        }
    }

    @Test
    fun testDoubleAndTripleEncodedDotDotTraversal() {
        val paths = listOf(
            "/gameres/%252e%252e/etc/passwd",
            "/gameres/%252e%252e%252fetc/passwd",
            "/gameres/%2e%2e%5cconfig"
        )
        for (p in paths) {
            assertTrue("Path traversal should be detected for encoded dot-dot: $p", client.isPathTraversalAttempt(p))
            val res = client.handleGameResourceRequest(p)
            assertEquals(403, res.statusCode)
        }
    }

    @Test
    fun testBackslashAndEncodedBackslashTraversal() {
        val paths = listOf(
            "/gameres/..\\secret.txt",
            "/gameres/..%5csecret.txt",
            "/gameres/%255csecret.txt"
        )
        for (p in paths) {
            assertTrue("Path traversal should be detected for backslash: $p", client.isPathTraversalAttempt(p))
            val res = client.handleGameResourceRequest(p)
            assertEquals(403, res.statusCode)
        }
    }

    @Test
    fun testShouldInterceptRequestNullHandling() {
        val response = client.shouldInterceptRequest(null, null as WebResourceRequest?)
        assertNull(response)
    }
}
