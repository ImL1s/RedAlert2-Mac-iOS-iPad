package com.ammaar.ra2web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.zip.ZipFile

class DiagnosticBundleManagerTest {

    @Test
    fun testSanitizeStringUserPaths() {
        val manager = DiagnosticBundleManager(object : android.content.ContextWrapper(null) {
            override fun getApplicationContext(): android.content.Context = this
        })

        val rawUserPathWin = "Error at C:\\Users\\alice smith\\AppData\\Local\\Temp\\log.txt"
        val sanitizedWin = manager.sanitizeString(rawUserPathWin)
        assertTrue(sanitizedWin.contains("[REDACTED_PATH]"))
        assertFalse(sanitizedWin.contains("alice smith"))

        val rawUserPathLinux = "Failed opening /storage/emulated/0/My Documents/ra2.mix"
        val sanitizedLinux = manager.sanitizeString(rawUserPathLinux)
        assertTrue(sanitizedLinux.contains("[REDACTED_PATH]"))
        assertFalse(sanitizedLinux.contains("My Documents"))

        val rawDataPath = "Database file: /data/user/0/com.ammaar.ra2web/databases/main.db"
        val sanitizedData = manager.sanitizeString(rawDataPath)
        assertTrue(sanitizedData.contains("[REDACTED_PATH]"))
        assertFalse(sanitizedData.contains("main.db"))
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

        val rawBasicAuth = "Authorization: Basic dXNlcjpwYXNz"
        val sanitizedBasic = manager.sanitizeString(rawBasicAuth)
        assertTrue(sanitizedBasic.contains("[REDACTED_TOKEN]"))
        assertFalse(sanitizedBasic.contains("dXNlcjpwYXNz"))

        val rawKey = "Query param: key=AIzaSyD1234567890abcdef"
        val sanitizedKey = manager.sanitizeString(rawKey)
        assertTrue(sanitizedKey.contains("[REDACTED_TOKEN]"))
        assertFalse(sanitizedKey.contains("AIzaSyD1234567890abcdef"))
    }

    @Test
    fun testCreateZipBundle() {
        val tempDir = File(System.getProperty("java.io.tmpdir"), "ra2_diag_test_${System.currentTimeMillis()}")
        tempDir.mkdirs()

        val manager = DiagnosticBundleManager(object : android.content.ContextWrapper(null) {
            override fun getCacheDir(): File = tempDir
            override fun getApplicationContext(): android.content.Context = this
        })

        val mockJson = "{\"status\":\"ok\",\"metadata\":{\"appVersion\":\"0.1.0\"}}"
        val mockLogs = listOf(
            "2026-08-14 12:00:00 [RA2] Booting engine",
            "2026-08-14 12:00:01 [RA2] Path: /storage/emulated/0/game/ra2.mix",
            "2026-08-14 12:00:02 [RA2] Auth: Bearer mySecretToken12345"
        )

        val zipFile = manager.createZipBundle(mockJson, mockLogs)
        assertNotNull(zipFile)
        assertTrue(zipFile!!.exists())

        // Verify ZIP contents
        ZipFile(zipFile).use { zip ->
            val jsonEntry = zip.getEntry("diagnostic_info.json")
            assertNotNull(jsonEntry)

            val logEntry = zip.getEntry("sanitized_logcat.txt")
            assertNotNull(logEntry)

            val logContent = zip.getInputStream(logEntry).bufferedReader().readText()
            assertTrue(logContent.contains("[REDACTED_PATH]"))
            assertTrue(logContent.contains("[REDACTED_TOKEN]"))
            assertFalse(logContent.contains("mySecretToken12345"))
        }

        zipFile.delete()
        tempDir.delete()
    }
}
