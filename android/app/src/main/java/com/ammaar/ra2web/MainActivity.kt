package com.ammaar.ra2web

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    lateinit var safManager: SafResourcePackManager
        private set

    private lateinit var webViewHost: WebViewHost
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
    private var powerSaveReceiver: BroadcastReceiver? = null

    private val safPickerLauncher = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            safManager.persistUriPermission(uri)
            notifySafResult(true, uri.toString(), null)
        } else {
            notifySafResult(false, null, "User cancelled folder selection")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        safManager = SafResourcePackManager(this)
        super.onCreate(savedInstanceState)
        
        setupFullscreen()

        webViewHost = WebViewHost(this)
        setContentView(webViewHost)
        webViewHost.setup(this)

        setupBackNavigation()
        setupAudioManagement()
        setupThermalAndPowerMonitoring()
        setupSafeAreaInsets()
    }

    fun launchSafPicker() {
        runOnUiThread {
            safPickerLauncher.launch(null)
        }
    }

    fun generateDiagnosticBundle(): String {
        val manager = DiagnosticBundleManager(this)
        return manager.generateBundleJson()
    }

    private fun notifySafResult(success: Boolean, uri: String?, error: String?) {
        val jsonObj = JSONObject().apply {
            put("success", success)
            if (uri != null) put("uri", uri)
            if (error != null) put("error", error)
        }
        val js = "window.__RA2_ON_SAF_RESULT__ && window.__RA2_ON_SAF_RESULT__($jsonObj);"
        webViewHost.evaluateJavascript(js)
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

    private fun setupSafeAreaInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(webViewHost) { _, insets ->
            val cutout = insets.displayCutout
            val density = resources.displayMetrics.density
            val top = (cutout?.safeInsetTop ?: 0) / density
            val right = (cutout?.safeInsetRight ?: 0) / density
            val bottom = (cutout?.safeInsetBottom ?: 0) / density
            val left = (cutout?.safeInsetLeft ?: 0) / density

            webViewHost.updateSafeAreaInsets(top, right, bottom, left)
            insets
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val playbackAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(playbackAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener { focusChange ->
                    when (focusChange) {
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK,
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                            val js = "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: true });"
                            webViewHost.evaluateJavascript(js)
                        }
                        AudioManager.AUDIOFOCUS_LOSS -> {
                            val js = "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: false });"
                            webViewHost.evaluateJavascript(js)
                        }
                        AudioManager.AUDIOFOCUS_GAIN -> {
                            val js = "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: true, duck: false });"
                            webViewHost.evaluateJavascript(js)
                        }
                    }
                }
                .build()
        }
    }

    private fun setupThermalAndPowerMonitoring() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            thermalListener = PowerManager.OnThermalStatusChangedListener { status ->
                val thermalState = mapThermalStatus(status)
                val lowPowerMode = powerManager.isPowerSaveMode
                webViewHost.updateThermalState(thermalState, lowPowerMode)
            }
            try {
                powerManager.addThermalStatusListener(thermalListener!!)
            } catch (_: Exception) {}
        }

        powerSaveReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (PowerManager.ACTION_POWER_SAVE_MODE_CHANGED == intent?.action) {
                    val thermalState = getThermalStateName()
                    val lowPowerMode = powerManager.isPowerSaveMode
                    webViewHost.updateThermalState(thermalState, lowPowerMode)
                }
            }
        }
        val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
        registerReceiver(powerSaveReceiver, filter)
    }

    private fun unregisterThermalAndPowerMonitoring() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && thermalListener != null) {
            try {
                powerManager?.removeThermalStatusListener(thermalListener!!)
            } catch (_: Exception) {}
            thermalListener = null
        }
        if (powerSaveReceiver != null) {
            try {
                unregisterReceiver(powerSaveReceiver)
            } catch (_: Exception) {}
            powerSaveReceiver = null
        }
    }

    private fun mapThermalStatus(status: Int): String {
        return when (status) {
            PowerManager.THERMAL_STATUS_NONE -> "nominal"
            PowerManager.THERMAL_STATUS_LIGHT,
            PowerManager.THERMAL_STATUS_MODERATE -> "fair"
            PowerManager.THERMAL_STATUS_SEVERE -> "serious"
            PowerManager.THERMAL_STATUS_CRITICAL,
            PowerManager.THERMAL_STATUS_EMERGENCY,
            PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
            else -> "nominal"
        }
    }

    fun getThermalStateName(): String {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            val status = powerManager?.currentThermalStatus ?: return "nominal"
            return mapThermalStatus(status)
        }
        return "nominal"
    }

    fun getLowPowerMode(): Boolean {
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.isPowerSaveMode == true
    }

    override fun onResume() {
        super.onResume()
        setupFullscreen()
        webViewHost.onResume()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.requestAudioFocus(it) }
        }
        val js = "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'resume' });"
        webViewHost.evaluateJavascript(js)
    }

    override fun onPause() {
        super.onPause()
        webViewHost.onPause()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
        }
        val js = "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'pause' });"
        webViewHost.evaluateJavascript(js)
    }

    override fun onStop() {
        super.onStop()
        val js = "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'stop' });"
        webViewHost.evaluateJavascript(js)
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterThermalAndPowerMonitoring()
        webViewHost.onDestroy()
    }
}
