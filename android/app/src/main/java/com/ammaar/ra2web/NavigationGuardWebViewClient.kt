package com.ammaar.ra2web

import android.content.Context
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.ammaar.ra2web.security.UrlSecurityValidator

open class NavigationGuardWebViewClient(
    private val context: Context,
    private val assetLoader: WebViewAssetLoader,
    private val onRenderProcessGoneCallback: ((WebView?, RenderProcessGoneDetail?) -> Boolean)? = null
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

    override fun onRenderProcessGone(
        view: WebView?,
        detail: RenderProcessGoneDetail?
    ): Boolean {
        return onRenderProcessGoneCallback?.invoke(view, detail)
            ?: super.onRenderProcessGone(view, detail)
    }
}
