package com.ammaar.ra2web

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LifecycleAndAudioFocusTest {

    object LifecycleBridgeContracts {
        fun buildAudioFocusJs(focusChange: Int): String? {
            return when (focusChange) {
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                    "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: true });"
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                AudioManager.AUDIOFOCUS_LOSS ->
                    "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: false, duck: false });"
                AudioManager.AUDIOFOCUS_GAIN ->
                    "window.__RA2_AUDIO_FOCUS__ && window.__RA2_AUDIO_FOCUS__({ focused: true, duck: false });"
                else -> null
            }
        }

        fun buildLifecycleJs(type: String): String {
            return "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: '$type' });"
        }

        fun buildBackPressedJs(): String {
            return "window.__RA2_ON_BACK_PRESSED__ && window.__RA2_ON_BACK_PRESSED__();"
        }

        fun buildAutosaveJs(): String {
            return "window.__RA2_AUTOSAVE__ && window.__RA2_AUTOSAVE__();"
        }
    }

    @Test
    fun testAudioFocusMappingTransientCanDuck() {
        val js = LifecycleBridgeContracts.buildAudioFocusJs(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        assertNotNull(js)
        assertTrue(js!!.contains("focused: false"))
        assertTrue(js.contains("duck: true"))
    }

    @Test
    fun testAudioFocusMappingTransientLoss() {
        val js = LifecycleBridgeContracts.buildAudioFocusJs(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        assertNotNull(js)
        assertTrue(js!!.contains("focused: false"))
        assertTrue(js.contains("duck: false"))
    }

    @Test
    fun testAudioFocusMappingPermanentLoss() {
        val js = LifecycleBridgeContracts.buildAudioFocusJs(AudioManager.AUDIOFOCUS_LOSS)
        assertNotNull(js)
        assertTrue(js!!.contains("focused: false"))
        assertTrue(js.contains("duck: false"))
    }

    @Test
    fun testAudioFocusMappingGain() {
        val js = LifecycleBridgeContracts.buildAudioFocusJs(AudioManager.AUDIOFOCUS_GAIN)
        assertNotNull(js)
        assertTrue(js!!.contains("focused: true"))
        assertTrue(js.contains("duck: false"))
    }

    @Test
    fun testLifecycleScriptGeneration() {
        assertEquals(
            "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'resume' });",
            LifecycleBridgeContracts.buildLifecycleJs("resume")
        )
        assertEquals(
            "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'pause' });",
            LifecycleBridgeContracts.buildLifecycleJs("pause")
        )
        assertEquals(
            "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'stop' });",
            LifecycleBridgeContracts.buildLifecycleJs("stop")
        )
        assertEquals(
            "window.__RA2_LIFECYCLE__ && window.__RA2_LIFECYCLE__({ type: 'destroy' });",
            LifecycleBridgeContracts.buildLifecycleJs("destroy")
        )
    }

    @Test
    fun testBackPressedScriptGeneration() {
        val js = LifecycleBridgeContracts.buildBackPressedJs()
        assertEquals(
            "window.__RA2_ON_BACK_PRESSED__ && window.__RA2_ON_BACK_PRESSED__();",
            js
        )
    }

    @Test
    fun testAutosaveScriptGeneration() {
        val js = LifecycleBridgeContracts.buildAutosaveJs()
        assertEquals(
            "window.__RA2_AUTOSAVE__ && window.__RA2_AUTOSAVE__();",
            js
        )
    }
}
