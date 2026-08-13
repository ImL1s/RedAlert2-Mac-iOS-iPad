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
class NativeBridge : WebViewCompat.WebMessageListener {

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy
    ) {
        val originStr = sourceOrigin.toString()
        if (!UrlSecurityValidator.isAllowedUrl(originStr)) {
            return
        }

        val response = JSONObject().apply {
            put("platform", getPlatform())
            put("version", getVersion())
            put("request", message.data)
        }
        replyProxy.postMessage(response.toString())
    }

    fun getPlatform(): String = "android"

    fun getVersion(): String = "0.1.0"

    companion object {
        const val OBJECT_NAME = "ra2NativeBridge"
    }
}
