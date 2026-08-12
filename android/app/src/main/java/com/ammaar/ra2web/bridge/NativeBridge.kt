package com.ammaar.ra2web.bridge

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.Keep
import com.ammaar.ra2web.security.UrlSecurityValidator

@Keep
class NativeBridge(private val webView: WebView) {

    private fun isOriginAllowed(): Boolean {
        return UrlSecurityValidator.isAllowedUrl(webView.url)
    }

    @Keep
    @JavascriptInterface
    fun getPlatform(): String {
        if (!isOriginAllowed()) return ""
        return "android"
    }

    @Keep
    @JavascriptInterface
    fun getVersion(): String {
        if (!isOriginAllowed()) return ""
        return "0.1.0"
    }

    companion object {
        const val INTERFACE_NAME = "AndroidNativeBridge"
    }
}
