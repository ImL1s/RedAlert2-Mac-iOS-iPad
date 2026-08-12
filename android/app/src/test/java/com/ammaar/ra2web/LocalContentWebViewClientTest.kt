package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalContentWebViewClientTest {

    @Test
    fun testGetMimeType() {
        assertEquals("application/octet-stream", LocalContentWebViewClient.getMimeType("ra2.mix"))
        assertEquals("application/octet-stream", LocalContentWebViewClient.getMimeType("language.mix"))
        assertEquals("application/octet-stream", LocalContentWebViewClient.getMimeType("stringtable.csf"))
        assertEquals("application/wasm", LocalContentWebViewClient.getMimeType("7zz.wasm"))
        assertEquals("text/html", LocalContentWebViewClient.getMimeType("index.html"))
        assertEquals("text/javascript", LocalContentWebViewClient.getMimeType("main.js"))
        assertEquals("text/css", LocalContentWebViewClient.getMimeType("style.css"))
        assertEquals("application/json", LocalContentWebViewClient.getMimeType("manifest.json"))
        assertEquals("image/png", LocalContentWebViewClient.getMimeType("logo.png"))
        assertEquals("audio/mpeg", LocalContentWebViewClient.getMimeType("theme.mp3"))
        assertEquals("audio/wav", LocalContentWebViewClient.getMimeType("unit.wav"))
        assertEquals("text/plain", LocalContentWebViewClient.getMimeType("rules.ini"))
        assertEquals("application/octet-stream", LocalContentWebViewClient.getMimeType("unknown.dat"))

        // Query string and fragment stripping
        assertEquals("text/javascript", LocalContentWebViewClient.getMimeType("main.js?v=12345#section"))
        assertEquals("application/octet-stream", LocalContentWebViewClient.getMimeType("audio.mix?v=1&cache=false"))
    }

    @Test
    fun testBuildHeaders() {
        val headers = LocalContentWebViewClient.buildHeaders("application/wasm", 1024L)
        assertEquals("https://appassets.androidlocal", headers["Access-Control-Allow-Origin"])
        assertEquals("GET, HEAD, OPTIONS", headers["Access-Control-Allow-Methods"])
        assertEquals("*", headers["Access-Control-Allow-Headers"])
        assertEquals("no-cache, no-store, must-revalidate", headers["Cache-Control"])
        assertEquals("bytes", headers["Accept-Ranges"])
        assertEquals("application/wasm", headers["Content-Type"])
        assertEquals("1024", headers["Content-Length"])

        val headersNoLength = LocalContentWebViewClient.buildHeaders("text/html")
        assertNull(headersNoLength["Content-Length"])
    }

    @Test
    fun testIsPathTraversalString() {
        // Path traversal cases
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/../secret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%2e%2e/secret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%2f..%2fsecret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres\\secret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/secret.txt\u0000.jpg"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/secret.txt%00.jpg"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/.."))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/.."))

        // Adversarial double-encoding and multi-pass traversal cases
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%252e%252e/secret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%2500"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%255csecret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%25252e%25252e/secret.txt"))
        assertTrue(LocalContentWebViewClient.isPathTraversalString("/gameres/%252f..%252fsecret.txt"))

        // Valid cases
        assertFalse(LocalContentWebViewClient.isPathTraversalString("/gameres/audio.mix"))
        assertFalse(LocalContentWebViewClient.isPathTraversalString("/WebDist/index.html"))
        assertFalse(LocalContentWebViewClient.isPathTraversalString("/WebDist/assets/main.js?v=1#hash"))
        assertFalse(LocalContentWebViewClient.isPathTraversalString("/gameres/ra2.mix"))
    }
}
