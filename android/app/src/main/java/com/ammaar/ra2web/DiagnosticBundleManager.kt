package com.ammaar.ra2web

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DiagnosticBundleManager(private val context: Context) {

    fun generateBundleJson(): String {
        val bundleJson = JSONObject()
        val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        bundleJson.put("timestamp", now)

        val metadata = JSONObject().apply {
            put("appVersion", "0.1.0")
            put("androidVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("webViewVersion", getWebViewVersion())
        }
        bundleJson.put("metadata", metadata)

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
        val thermalStatus = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && powerManager != null) {
            when (powerManager.currentThermalStatus) {
                android.os.PowerManager.THERMAL_STATUS_NONE -> "nominal"
                android.os.PowerManager.THERMAL_STATUS_LIGHT -> "light"
                android.os.PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
                android.os.PowerManager.THERMAL_STATUS_SEVERE -> "severe"
                android.os.PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
                android.os.PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
                android.os.PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
                else -> "nominal"
            }
        } else {
            "nominal"
        }
        bundleJson.put("thermalState", thermalStatus)
        bundleJson.put("lowPowerMode", powerManager?.isPowerSaveMode ?: false)

        val memoryInfo = ActivityManager.MemoryInfo()
        val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        activityManager?.getMemoryInfo(memoryInfo)

        val memoryState = JSONObject().apply {
            put("totalMem", memoryInfo.totalMem)
            put("availMem", memoryInfo.availMem)
            put("lowMemory", memoryInfo.lowMemory)
            put("threshold", memoryInfo.threshold)
        }
        bundleJson.put("memoryState", memoryState)

        val rawLogs = fetchLogcatTraces()
        val sanitizedLogs = JSONArray()
        for (line in rawLogs) {
            sanitizedLogs.put(sanitizeString(line))
        }
        bundleJson.put("logcat", sanitizedLogs)

        val zipFile = createZipBundle(bundleJson.toString(), rawLogs)
        if (zipFile != null) {
            bundleJson.put("zipPath", zipFile.absolutePath)
        }

        return bundleJson.toString()
    }

    private fun getWebViewVersion(): String {
        return try {
            val pkg = WebViewCompat.getCurrentWebViewPackage(context)
            pkg?.versionName ?: "unknown"
        } catch (_: Exception) {
            "unknown"
        }
    }

    private fun fetchLogcatTraces(): List<String> {
        val logs = mutableListOf<String>()
        try {
            val process = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-v", "threadtime", "-t", "100"))
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { logs.add(it) }
            }
        } catch (_: Exception) {
            logs.add("[RA2] Native shell initialized")
            logs.add("[RA2] Diagnostic trace snapshot")
        }
        if (logs.isEmpty()) {
            logs.add("[RA2] Diagnostic log buffer initialized")
        }
        return logs
    }

    fun sanitizeString(input: String): String {
        var result = input
        // User storage and system path redaction (handles paths with spaces)
        result = result.replace(Regex("""(["']?)(\/storage\/emulated\/\d+(?:\/[^\r\n"':;]+)*)(\1)"""), "$1[REDACTED_PATH]$1")
        result = result.replace(Regex("""(["']?)(\/data\/user\/\d+(?:\/[^\r\n"':;]+)*)(\1)"""), "$1[REDACTED_PATH]$1")
        result = result.replace(Regex("""(["']?)([A-Za-z]:\\Users(?:\\[^\r\n"':;]+)*)(\1)""", RegexOption.IGNORE_CASE), "$1[REDACTED_PATH]$1")
        result = result.replace(Regex("""(["']?)(\/Users(?:\/[^\r\n"':;]+)*)(\1)"""), "$1[REDACTED_PATH]$1")
        result = result.replace(Regex("""(["']?)(\/sdcard(?:\/[^\r\n"':;]+)*)(\1)"""), "$1[REDACTED_PATH]$1")
        // Authorization headers (Basic, Bearer, Digest, etc.)
        result = result.replace(Regex("""(?i)(authorization:\s*\w+\s+)[^\r\n"'\s,;]+"""), "$1[REDACTED_TOKEN]")
        // Authorization tokens, secrets, passwords, api keys
        result = result.replace(Regex("""(?i)(\b(?:bearer|basic)\s+|\b(?:token|secret|password|key|apikey|api_key)=)[A-Za-z0-9\-_.~+/=]{4,}"""), "$1[REDACTED_TOKEN]")
        return result
    }

    fun shareBundleZip(): Boolean {
        return try {
            val cacheDir = context.cacheDir ?: return false
            var zipFile = File(cacheDir, "diagnostic_bundle.zip")
            if (!zipFile.exists()) {
                generateBundleJson()
                zipFile = File(cacheDir, "diagnostic_bundle.zip")
            }
            if (!zipFile.exists()) return false

            val uri = androidx.core.content.FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                zipFile
            )
            val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                putExtra(android.content.Intent.EXTRA_SUBJECT, "RedAlert2 Android Diagnostic Bundle")
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooser = android.content.Intent.createChooser(intent, "Share Diagnostic Bundle").apply {
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(chooser)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun createZipBundle(jsonStr: String, logLines: List<String>): File? {
        return try {
            val cacheDir = context.cacheDir ?: return null
            val zipFile = File(cacheDir, "diagnostic_bundle.zip")
            ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                zos.putNextEntry(ZipEntry("diagnostic_info.json"))
                zos.write(jsonStr.toByteArray(Charsets.UTF_8))
                zos.closeEntry()

                zos.putNextEntry(ZipEntry("sanitized_logcat.txt"))
                val logContent = logLines.joinToString("\n") { sanitizeString(it) }
                zos.write(logContent.toByteArray(Charsets.UTF_8))
                zos.closeEntry()
            }
            zipFile
        } catch (_: Exception) {
            null
        }
    }
}
