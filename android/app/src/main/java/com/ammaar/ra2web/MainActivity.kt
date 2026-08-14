package com.ammaar.ra2web

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.ammaar.ra2web.bridge.NativeBridge
import org.json.JSONObject

class MainActivity : AppCompatActivity(), NativeBridge.SafBridgeHandler {

    private lateinit var webViewHost: WebViewHost
    private lateinit var safManager: SafResourcePackManager
    private var pendingSafPickCallback: ((JSONObject) -> Unit)? = null

    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var legacyAudioFocusListener: AudioManager.OnAudioFocusChangeListener? = null

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
        setupBackNavigation()
        setupAudioManagement()
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

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val js = "window.__RA2_ON_BACK_PRESSED__ && window.__RA2_ON_BACK_PRESSED__();"
                webViewHost.evaluateJavascript(js)
            }
        })
    }

    private fun setupAudioManagement() {
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager

        val focusChangeListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
            handleAudioFocusChange(focusChange)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build()
        } else {
            legacyAudioFocusListener = focusChangeListener
        }
    }

    fun handleAudioFocusChange(focusChange: Int) {
        val js = when (focusChange) {
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: true });"
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS ->
                "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: false });"
            AudioManager.AUDIOFOCUS_GAIN ->
                "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: true, duck: false });"
            else -> null
        }
        if (js != null) {
            webViewHost.evaluateJavascript(js)
        }
    }

    private fun requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.requestAudioFocus(it) }
        } else {
            @Suppress("DEPRECATION")
            legacyAudioFocusListener?.let {
                audioManager?.requestAudioFocus(it, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
            }
        }
    }

    private fun abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            legacyAudioFocusListener?.let {
                audioManager?.abandonAudioFocus(it)
            }
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
        requestAudioFocus()
        webViewHost.evaluateJavascript("window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'resume' });")
    }

    override fun onPause() {
        super.onPause()
        // Forward autosave hook before backgrounding
        webViewHost.evaluateJavascript("window.__RA2_AUTOSAVE__ && window.__RA2_AUTOSAVE__();")
        webViewHost.evaluateJavascript("window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'pause' });")
        abandonAudioFocus()
        webViewHost.onPause()
    }

    override fun onStop() {
        super.onStop()
        webViewHost.evaluateJavascript("window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'stop' });")
    }

    override fun onDestroy() {
        webViewHost.evaluateJavascript("window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'destroy' });")
        webViewHost.onDestroy()
        super.onDestroy()
    }
}
