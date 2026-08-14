package com.ammaar.ra2web

import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.ammaar.ra2web.bridge.NativeBridge
import org.json.JSONObject

class MainActivity : AppCompatActivity(), NativeBridge.SafBridgeHandler {

    private lateinit var webViewHost: WebViewHost
    private lateinit var safManager: SafResourcePackManager
    private var pendingSafPickCallback: ((JSONObject) -> Unit)? = null

    private val openDocumentTreeLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri != null) {
            val success = safManager.persistUriPermission(uri)
            val response = JSONObject().apply {
                put("action", "requestSafPick")
                put("status", if (success) "ok" else "error")
                put("hasPermission", success)
                put("uri", uri.toString())
                if (!success) put("error", "Failed to persist URI permission")
            }
            pendingSafPickCallback?.invoke(response)
        } else {
            val response = JSONObject().apply {
                put("action", "requestSafPick")
                put("status", "cancelled")
                put("hasPermission", safManager.hasPersistedUriPermission())
            }
            pendingSafPickCallback?.invoke(response)
        }
        pendingSafPickCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        safManager = SafResourcePackManager(this)
        webViewHost = WebViewHost(this, safBridgeHandler = this)
        setContentView(webViewHost)
        setupFullscreen()
        webViewHost.setup()
    }

    override fun onGetSafStatus(): JSONObject {
        val persistedUri = safManager.getPersistedUri()
        val hasPermission = persistedUri != null
        return JSONObject().apply {
            put("action", "getSafStatus")
            put("status", "ok")
            put("hasPermission", hasPermission)
            if (persistedUri != null) {
                put("uri", persistedUri.toString())
            } else {
                put("uri", JSONObject.NULL)
            }
        }
    }

    override fun onRequestSafPick(callback: (JSONObject) -> Unit) {
        pendingSafPickCallback = callback
        openDocumentTreeLauncher.launch(null)
    }

    override fun onClearSafUri(): JSONObject {
        safManager.clearPersistedUri()
        return JSONObject().apply {
            put("action", "clearSafUri")
            put("status", "ok")
            put("hasPermission", false)
        }
    }

    private fun setupFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            )
        }
    }

    override fun onResume() {
        super.onResume()
        setupFullscreen()
        webViewHost.onResume()
    }

    override fun onPause() {
        super.onPause()
        webViewHost.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        webViewHost.onDestroy()
    }
}
