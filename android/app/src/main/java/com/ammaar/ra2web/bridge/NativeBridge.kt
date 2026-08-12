package com.ammaar.ra2web.bridge

import android.webkit.JavascriptInterface
import com.ammaar.ra2web.MainActivity

class NativeBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun getPlatform(): String {
        return "android"
    }

    @JavascriptInterface
    fun getVersion(): String {
        return "0.1.0"
    }

    @JavascriptInterface
    fun getThermalState(): String {
        return activity.getThermalStateName()
    }

    @JavascriptInterface
    fun getSafStatus(): String {
        return activity.safManager.getStatusJson()
    }

    @JavascriptInterface
    fun launchSafPicker() {
        activity.launchSafPicker()
    }

    @JavascriptInterface
    fun preflightSafManifest(): String {
        return activity.safManager.preflightSafManifest()
    }

    @JavascriptInterface
    fun finishActivity() {
        activity.runOnUiThread {
            activity.finish()
        }
    }

    @JavascriptInterface
    fun generateDiagnosticBundle(): String {
        return activity.generateDiagnosticBundle()
    }

    companion object {
        const val INTERFACE_NAME = "AndroidNativeBridge"

        fun getBootstrapScript(thermalState: String, lowPowerMode: Boolean = false): String {
            return """
                window.__RA2_SHELL__ = {
                    platform: 'android',
                    version: '0.1.0',
                    thermalState: '$thermalState',
                    lowPowerMode: $lowPowerMode
                };
            """.trimIndent()
        }
    }
}
