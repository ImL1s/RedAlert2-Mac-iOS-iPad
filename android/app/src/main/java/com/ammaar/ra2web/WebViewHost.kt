package com.ammaar.ra2web

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.ammaar.ra2web.bridge.NativeBridge

class WebViewHost @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
    private val safBridgeHandler: NativeBridge.SafBridgeHandler? = null,
    val crashRateLimiter: CrashRateLimiter = CrashRateLimiter()
) : FrameLayout(context, attrs, defStyleAttr) {

    private var webView: WebView? = null
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

    fun createAndAttachWebView(isRecovery: Boolean = false, crashCount: Int = 0) {
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
                version: '0.1.0',
                isRecovery: $isRecovery,
                crashCount: $crashCount
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
            onRenderProcessGoneListener = { _ ->
                handleRenderProcessGone(webViewInstance)
            }
        )

        addView(webViewInstance)
        this.webView = webViewInstance

        webViewInstance.loadUrl(BASE_URL)
    }

    fun handleRenderProcessGone(deadView: WebView?): Boolean {
        val targetView = deadView ?: webView
        targetView?.let {
            (it.parent as? ViewGroup)?.removeView(it)
            it.destroy()
        }
        if (targetView == webView) {
            webView = null
        }

        val permitted = crashRateLimiter.recordCrashAndCheckPermitted()
        if (!permitted) {
            val windowMinutes = crashRateLimiter.windowMillis / 60000
            showErrorState("WebView renderer process crashed repeatedly (${crashRateLimiter.maxCrashes} times in $windowMinutes minutes). Execution halted to prevent infinite crash loops.")
            return true
        }

        if (isResumed) {
            createAndAttachWebView(isRecovery = true, crashCount = crashRateLimiter.getRecentCrashCount())
        } else {
            pendingRecovery = true
        }
        return true
    }

    private fun showErrorState(message: String) {
        removeAllViews()
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.rgb(24, 24, 24))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val titleView = TextView(context).apply {
            text = "Renderer Crash"
            setTextColor(Color.RED)
            textSize = 20f
            setTypeface(null, Typeface.BOLD)
            setPadding(0, 0, 0, 16)
        }
        container.addView(titleView)

        val messageView = TextView(context).apply {
            text = message
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(0, 0, 0, 24)
        }
        container.addView(messageView)

        addView(container)
    }

    fun evaluateJavascript(script: String, resultCallback: ((String?) -> Unit)? = null) {
        webView?.evaluateJavascript(script, resultCallback)
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
            if (crashRateLimiter.isRecoveryPermitted()) {
                createAndAttachWebView(isRecovery = true, crashCount = crashRateLimiter.getRecentCrashCount())
            } else {
                val windowMinutes = crashRateLimiter.windowMillis / 60000
                showErrorState("WebView renderer process crashed repeatedly (${crashRateLimiter.maxCrashes} times in $windowMinutes minutes). Execution halted to prevent infinite crash loops.")
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

    // Inspection helpers for unit tests and diagnostics
    fun isResumedForTest(): Boolean = isResumed
    fun isPendingRecoveryForTest(): Boolean = pendingRecovery
    fun setResumedForTest(resumed: Boolean) { isResumed = resumed }
    fun setPendingRecoveryForTest(pending: Boolean) { pendingRecovery = pending }
    fun getWebViewForTest(): WebView? = webView
}
