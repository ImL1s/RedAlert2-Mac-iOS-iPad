package com.ammaar.ra2web

import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.ammaar.ra2web.bridge.NativeBridge

class WebViewHost @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
    private val safBridgeHandler: NativeBridge.SafBridgeHandler? = null
) : FrameLayout(context, attrs, defStyleAttr) {

    private var webView: WebView? = null
    private var recoveryCount = 0
    private val maxRecoveryAttempts = 3
    private var isResumed = false
    private var pendingRecovery = false

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val BASE_URL = "https://$DOMAIN/WebDist/index.html"
        const val ALLOWED_ORIGIN = "https://$DOMAIN"
    }

    init {
        setBackgroundColor(Color.BLACK)
    }

    fun setup() {
        val supportsWebMessageListener = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        val supportsDocumentStartScript = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

        if (!supportsWebMessageListener || !supportsDocumentStartScript) {
            showErrorState("System WebView does not support required security features (WEB_MESSAGE_LISTENER / DOCUMENT_START_SCRIPT). Please update System WebView.")
            return
        }

        createAndAttachWebView()
    }

    private fun createAndAttachWebView() {
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
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        val documentStartScript = """
            window.__RA2_SHELL__ = {
                platform: 'android',
                version: '0.1.0'
            };
        """.trimIndent()

        WebViewCompat.addDocumentStartJavaScript(
            webViewInstance,
            documentStartScript,
            setOf(ALLOWED_ORIGIN)
        )

        val nativeBridge = NativeBridge(safBridgeHandler)
        WebViewCompat.addWebMessageListener(
            webViewInstance,
            NativeBridge.OBJECT_NAME,
            setOf(ALLOWED_ORIGIN),
            nativeBridge
        )

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

        webViewInstance.webViewClient = LocalContentWebViewClient(
            context = context,
            assetLoader = assetLoader,
            onRenderProcessGoneListener = { didCrash ->
                handleRenderProcessGone(webViewInstance)
            }
        )

        addView(webViewInstance)
        this.webView = webViewInstance

        webViewInstance.loadUrl(BASE_URL)
    }

    private fun handleRenderProcessGone(_deadView: WebView?): Boolean {
        webView?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        webView = null

        if (isResumed) {
            if (recoveryCount < maxRecoveryAttempts) {
                recoveryCount++
                createAndAttachWebView()
            } else {
                showErrorState("WebView renderer process crashed repeatedly. Execution halted.")
            }
        } else {
            pendingRecovery = true
        }
        return true
    }

    private fun showErrorState(message: String) {
        removeAllViews()
        val errorView = TextView(context).apply {
            text = message
            setTextColor(Color.RED)
            textSize = 16f
            setPadding(32, 32, 32, 32)
        }
        addView(errorView)
    }

    fun onPause() {
        isResumed = false
        webView?.onPause()
    }

    fun onResume() {
        isResumed = true
        webView?.onResume()
        if (pendingRecovery) {
            pendingRecovery = false
            if (recoveryCount < maxRecoveryAttempts) {
                recoveryCount++
                createAndAttachWebView()
            } else {
                showErrorState("WebView renderer process crashed repeatedly. Execution halted.")
            }
        }
    }

    fun onDestroy() {
        webView?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        webView = null
    }
}
