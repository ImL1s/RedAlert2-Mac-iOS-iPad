package com.ammaar.ra2web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticBundleManagerTest {

    @Test
    fun testSanitizeStringUserPaths() {
        val manager = DiagnosticBundleManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val rawUserPathWin = "Error at C:\\Users\\alice\\AppData\\Local\\Temp\\log.txt"
        val sanitizedWin = manager.sanitizeString(rawUserPathWin)
        assertTrue(sanitizedWin.contains("[REDACTED_PATH]"))
        assertFalse(sanitizedWin.contains("alice"))

        val rawUserPathLinux = "Failed opening /storage/emulated/0/Download/ra2.mix"
        val sanitizedLinux = manager.sanitizeString(rawUserPathLinux)
        assertTrue(sanitizedLinux.contains("[REDACTED_PATH]"))
        assertFalse(sanitizedLinux.contains("Download"))
    }

    @Test
    fun testSanitizeStringTokens() {
        val manager = DiagnosticBundleManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val rawToken = "Auth header: Bearer abc123secrettoken456"
        val sanitizedToken = manager.sanitizeString(rawToken)
        assertTrue(sanitizedToken.contains("[REDACTED_TOKEN]"))
        assertFalse(sanitizedToken.contains("abc123secrettoken456"))
    }
}
