package com.ammaar.ra2web.bridge

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.Keep
import com.ammaar.ra2web.security.UrlSecurityValidator
import java.util.concurrent.atomic.AtomicReference

@Keep
class NativeBridge(private val webView: WebView) {

    /**
     * Tracks the last known trusted URL, updated from the main thread via
     * NavigationGuardWebViewClient.onPageFinished(). This avoids calling
     * webView.url from the @JavascriptInterface background thread, which
     * would throw a wrong-thread exception on modern Android.
     */
    private val lastTrustedUrl = AtomicReference<String?>(null)

    /** Called from the main thread by NavigationGuardWebViewClient.onPageFinished(). */
    fun onTrustedPageLoaded(url: String?) {
        lastTrustedUrl.set(url)
    }

    private fun isOriginAllowed(): Boolean {
        return UrlSecurityValidator.isAllowedUrl(lastTrustedUrl.get())
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
