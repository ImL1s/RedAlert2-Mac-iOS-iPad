package com.ammaar.ra2web

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.ammaar.ra2web.security.UrlSecurityValidator

open class NavigationGuardWebViewClient(
    private val context: Context,
    private val assetLoader: WebViewAssetLoader
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString()
        if (!UrlSecurityValidator.isAllowedUrl(url)) {
            return true
        }
        return false
    }

    @Deprecated("For API < 24 compatibility")
    override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
        if (!UrlSecurityValidator.isAllowedUrl(url)) {
            return true
        }
        return false
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse? {
        val url = request?.url ?: return null
        return assetLoader.shouldInterceptRequest(url)
    }

    override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        if (UrlSecurityValidator.isAllowedUrl(url)) {
            val script = """
                if (!window.__RA2_SHELL__) {
                    window.__RA2_SHELL__ = {
                        platform: 'android',
                        version: '0.1.0'
                    };
                }
            """.trimIndent()
            view?.evaluateJavascript(script, null)
        }
    }
}
