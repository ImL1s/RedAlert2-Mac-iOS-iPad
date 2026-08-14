package com.ammaar.ra2web.bridge

import android.net.Uri
import android.webkit.WebView
import androidx.annotation.Keep
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import com.ammaar.ra2web.security.UrlSecurityValidator
import org.json.JSONObject

@Keep
class NativeBridge(
    private val safBridgeHandler: SafBridgeHandler? = null
) : WebViewCompat.WebMessageListener {

    interface SafBridgeHandler {
        fun onGetSafStatus(): JSONObject
        fun onRequestSafPick(callback: (JSONObject) -> Unit)
        fun onClearSafUri(): JSONObject
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy
    ) {
        val originStr = sourceOrigin.toString()
        val rawData = message.data ?: ""
        processMessage(rawData, originStr) { replyMessage ->
            replyProxy.postMessage(replyMessage)
        }
    }

    /**
     * Process an incoming bridge message with origin security validation.
     */
    fun processMessage(
        rawData: String,
        originStr: String,
        replyCallback: (String) -> Unit
    ) {
        if (!UrlSecurityValidator.isAllowedUrl(originStr)) {
            return
        }

        try {
            val json = JSONObject(rawData)
            val action = json.optString("action", "")
            val id = json.optString("id", "")

            when (action) {
                "getSafStatus" -> {
                    val res = safBridgeHandler?.onGetSafStatus() ?: JSONObject().apply {
                        put("action", "getSafStatus")
                        put("status", "error")
                        put("error", "SAF handler not configured")
                    }
                    if (id.isNotEmpty()) res.put("id", id)
                    replyCallback(res.toString())
                }
                "requestSafPick" -> {
                    if (safBridgeHandler != null) {
                        safBridgeHandler.onRequestSafPick { res ->
                            if (id.isNotEmpty()) res.put("id", id)
                            replyCallback(res.toString())
                        }
                    } else {
                        val res = JSONObject().apply {
                            put("action", "requestSafPick")
                            put("status", "error")
                            put("error", "SAF handler not configured")
                            if (id.isNotEmpty()) put("id", id)
                        }
                        replyCallback(res.toString())
                    }
                }
                "clearSafUri" -> {
                    val res = safBridgeHandler?.onClearSafUri() ?: JSONObject().apply {
                        put("action", "clearSafUri")
                        put("status", "error")
                        put("error", "SAF handler not configured")
                    }
                    if (id.isNotEmpty()) res.put("id", id)
                    replyCallback(res.toString())
                }
                "getPlatform" -> {
                    val response = JSONObject().apply {
                        put("action", "getPlatform")
                        put("platform", getPlatform())
                        put("version", getVersion())
                        if (id.isNotEmpty()) put("id", id)
                    }
                    replyCallback(response.toString())
                }
                else -> {
                    val response = JSONObject().apply {
                        put("platform", getPlatform())
                        put("version", getVersion())
                        put("request", rawData)
                        if (id.isNotEmpty()) put("id", id)
                    }
                    replyCallback(response.toString())
                }
            }
        } catch (e: Exception) {
            // Non-JSON fallback response
            val response = JSONObject().apply {
                put("platform", getPlatform())
                put("version", getVersion())
                put("request", rawData)
            }
            replyCallback(response.toString())
        }
    }

    fun getPlatform(): String = "android"

    fun getVersion(): String = "0.1.0"

    companion object {
        const val OBJECT_NAME = "ra2NativeBridge"
    }
}
