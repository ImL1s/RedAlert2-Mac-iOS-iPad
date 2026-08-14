package com.ammaar.ra2web

import com.ammaar.ra2web.bridge.NativeBridge
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NativeBridgeTest {

    private lateinit var nativeBridge: NativeBridge
    private var lastReply: String? = null
    private var safStatusCalled = false
    private var safPickCalled = false
    private var safClearCalled = false

    private val fakeHandler = object : NativeBridge.SafBridgeHandler {
        override fun onGetSafStatus(): JSONObject {
            safStatusCalled = true
            return JSONObject().apply {
                put("action", "getSafStatus")
                put("status", "ok")
                put("hasPermission", true)
                put("uri", "content://test/tree")
            }
        }

        override fun onRequestSafPick(callback: (JSONObject) -> Unit) {
            safPickCalled = true
            callback(JSONObject().apply {
                put("action", "requestSafPick")
                put("status", "ok")
                put("hasPermission", true)
                put("uri", "content://test/tree/picked")
            })
        }

        override fun onClearSafUri(): JSONObject {
            safClearCalled = true
            return JSONObject().apply {
                put("action", "clearSafUri")
                put("status", "ok")
                put("hasPermission", false)
            }
        }
    }

    @Before
    fun setUp() {
        lastReply = null
        safStatusCalled = false
        safPickCalled = false
        safClearCalled = false
        nativeBridge = NativeBridge(fakeHandler)
    }

    @Test
    fun testOriginSecurityValidationBlocksDisallowedOrigin() {
        nativeBridge.processMessage(
            "{\"action\":\"getSafStatus\"}",
            "https://evil.attacker.com"
        ) { reply ->
            lastReply = reply
        }

        assertNull(lastReply)
        org.junit.Assert.assertFalse(safStatusCalled)
    }

    @Test
    fun testGetSafStatusAction() {
        nativeBridge.processMessage(
            "{\"action\":\"getSafStatus\",\"id\":\"123\"}",
            "https://appassets.androidplatform.net"
        ) { reply ->
            lastReply = reply
        }

        assertTrue(safStatusCalled)
        assertNotNull(lastReply)
        val json = JSONObject(lastReply!!)
        assertEquals("getSafStatus", json.getString("action"))
        assertEquals("ok", json.getString("status"))
        assertTrue(json.getBoolean("hasPermission"))
        assertEquals("123", json.getString("id"))
    }

    @Test
    fun testRequestSafPickAction() {
        nativeBridge.processMessage(
            "{\"action\":\"requestSafPick\",\"id\":\"456\"}",
            "https://appassets.androidplatform.net"
        ) { reply ->
            lastReply = reply
        }

        assertTrue(safPickCalled)
        assertNotNull(lastReply)
        val json = JSONObject(lastReply!!)
        assertEquals("requestSafPick", json.getString("action"))
        assertEquals("ok", json.getString("status"))
        assertEquals("content://test/tree/picked", json.getString("uri"))
        assertEquals("456", json.getString("id"))
    }

    @Test
    fun testClearSafUriAction() {
        nativeBridge.processMessage(
            "{\"action\":\"clearSafUri\",\"id\":\"789\"}",
            "https://appassets.androidplatform.net"
        ) { reply ->
            lastReply = reply
        }

        assertTrue(safClearCalled)
        assertNotNull(lastReply)
        val json = JSONObject(lastReply!!)
        assertEquals("clearSafUri", json.getString("action"))
        assertEquals("ok", json.getString("status"))
        org.junit.Assert.assertFalse(json.getBoolean("hasPermission"))
        assertEquals("789", json.getString("id"))
    }

    @Test
    fun testGetPlatformAction() {
        nativeBridge.processMessage(
            "{\"action\":\"getPlatform\"}",
            "https://appassets.androidplatform.net"
        ) { reply ->
            lastReply = reply
        }

        assertNotNull(lastReply)
        val json = JSONObject(lastReply!!)
        assertEquals("getPlatform", json.getString("action"))
        assertEquals("android", json.getString("platform"))
        assertEquals("0.1.0", json.getString("version"))
    }
}
