package com.ammaar.ra2web

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import com.ammaar.ra2web.bridge.NativeBridge

class WebViewHost @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    private var webView: WebView? = null
    var onRenderProcessGoneCallback: ((Boolean) -> Unit)? = null

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val BASE_URL = "https://$DOMAIN/WebDist/index.html"
    }

    init {
        setBackgroundColor(Color.BLACK)
    }

    fun setup() {
        val webViewInstance = WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        val settings: WebSettings = webViewInstance.settings
        @Suppress("SetJavaScriptEnabled")
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        val bridge = NativeBridge(webViewInstance)
        webViewInstance.addJavascriptInterface(bridge, NativeBridge.INTERFACE_NAME)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

        val webViewClient = LocalContentWebViewClient(
            context = context,
            assetLoader = assetLoader,
            onRenderProcessGoneListener = { didCrash ->
                onDestroy()
                onRenderProcessGoneCallback?.invoke(didCrash)
                true
            }
        )

        webViewInstance.webViewClient = webViewClient

        addView(webViewInstance)
        this.webView = webViewInstance

        webViewInstance.loadUrl(BASE_URL)
    }

    fun onPause() {
        webView?.onPause()
    }

    fun onResume() {
        webView?.onResume()
    }

    fun onDestroy() {
        webView?.destroy()
        webView = null
    }
}
