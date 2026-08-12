package com.ammaar.ra2web

import android.content.Context
import android.graphics.Color
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.TextView
import androidx.webkit.WebViewAssetLoader
import com.ammaar.ra2web.bridge.NativeBridge
import kotlin.math.pow

class WebViewHost @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    private var webView: WebView? = null
    private var unrecoverableNotice: TextView? = null

    private var contentProcessCrashCount = 0
    private var lastCrashTimeMs: Long = 0

    companion object {
        const val DOMAIN = "appassets.androidlocal"
        const val BASE_URL = "https://$DOMAIN/WebDist/index.html"
        private const val MAX_AUTO_RECOVERIES = 3
        private const val CRASH_LOOP_WINDOW_MS = 300_000L // 5 minutes
    }

    init {
        setBackgroundColor(Color.BLACK)
    }

    fun setup(activity: MainActivity) {
        val webViewInstance = WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
        }

        val settings: WebSettings = webViewInstance.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false

        val bridge = NativeBridge(activity)
        webViewInstance.addJavascriptInterface(bridge, NativeBridge.INTERFACE_NAME)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()

        val client = LocalContentWebViewClient(
            context = context,
            assetLoader = assetLoader,
            safManager = activity.safManager
        ) { didCrash ->
            handleRenderProcessGone(didCrash, activity)
        }
        webViewInstance.webViewClient = client

        val bootstrapScript = NativeBridge.getBootstrapScript(activity.getThermalStateName(), activity.getLowPowerMode())
        webViewInstance.evaluateJavascript(bootstrapScript, null)

        addView(webViewInstance)
        this.webView = webViewInstance

        loadApp(crashed = false)
    }

    private fun loadApp(crashed: Boolean) {
        var url = BASE_URL
        if (crashed) {
            url += "?crashRecovery=$contentProcessCrashCount"
        }
        webView?.loadUrl(url)
    }

    private fun handleRenderProcessGone(didCrash: Boolean, activity: MainActivity): Boolean {
        if (didCrash) {
            android.util.Log.w("WebViewHost", "WebView renderer process crashed")
        } else {
            android.util.Log.i("WebViewHost", "WebView renderer process killed by OS (low memory)")
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastCrashTimeMs > CRASH_LOOP_WINDOW_MS) {
            contentProcessCrashCount = 0
        }
        lastCrashTimeMs = now
        contentProcessCrashCount++

        webView?.let {
            removeView(it)
            it.destroy()
        }
        webView = null

        if (contentProcessCrashCount > MAX_AUTO_RECOVERIES) {
            showUnrecoverableNotice()
            return true
        }

        val delayMs = (2.0.pow((contentProcessCrashCount - 1).toDouble()) * 1000).toLong()
        postDelayed({
            setup(activity)
            loadApp(crashed = true)
        }, delayMs)

        return true
    }

    private fun showUnrecoverableNotice() {
        if (unrecoverableNotice != null) return
        val tv = TextView(context).apply {
            text = "Red Alert 2 ran out of memory and could not recover.\n\nClose other apps, restart the device, and launch again."
            setTextColor(Color.WHITE)
            textSize = 16f
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            layoutParams = LayoutParams(
                LayoutParams.WRAP_CONTENT,
                LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = android.view.Gravity.CENTER
            }
        }
        addView(tv)
        unrecoverableNotice = tv
    }

    fun updateThermalState(thermalState: String, lowPowerMode: Boolean) {
        val js = """
            window.__RA2_SHELL__ && (window.__RA2_SHELL__.thermalState = '$thermalState');
            window.__RA2_SHELL__ && (window.__RA2_SHELL__.lowPowerMode = $lowPowerMode);
            window.__RA2_POWER__ && window.__RA2_POWER__({thermal: '$thermalState', lowPower: $lowPowerMode});
        """.trimIndent()
        webView?.evaluateJavascript(js, null)
    }

    fun updateSafeAreaInsets(top: Float, right: Float, bottom: Float, left: Float) {
        val js = """
            document.documentElement.style.setProperty('--safe-area-inset-top', '${top}px');
            document.documentElement.style.setProperty('--safe-area-inset-right', '${right}px');
            document.documentElement.style.setProperty('--safe-area-inset-bottom', '${bottom}px');
            document.documentElement.style.setProperty('--safe-area-inset-left', '${left}px');
        """.trimIndent()
        webView?.evaluateJavascript(js, null)
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

    fun evaluateJavascript(script: String) {
        webView?.evaluateJavascript(script, null)
    }

    fun canGoBack(): Boolean = webView?.canGoBack() == true
    fun goBack() { webView?.goBack() }
}
