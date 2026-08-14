package com.ammaar.ra2web

import android.content.Context
import android.net.Uri
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import com.ammaar.ra2web.security.UrlSecurityValidator
import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.URLDecoder

open class LocalWebResourceResponse(
    private val mimeTypeStr: String,
    private val encodingStr: String,
    private val status: Int,
    private val reason: String,
    private val headersMap: Map<String, String>,
    private val dataStream: InputStream?
) : WebResourceResponse(mimeTypeStr, encodingStr, status, reason, headersMap, dataStream) {
    override fun getMimeType(): String = mimeTypeStr
    override fun getEncoding(): String = encodingStr
    override fun getStatusCode(): Int = status
    override fun getReasonPhrase(): String = reason
    override fun getResponseHeaders(): Map<String, String> = headersMap
    override fun getData(): InputStream? = dataStream
}

open class LocalContentWebViewClient @JvmOverloads constructor(
    private val context: Context,
    private val filesDir: File = context.filesDir,
    private val assetLoader: WebViewAssetLoader? = null,
    private val onRenderProcessGoneListener: ((didCrash: Boolean) -> Boolean)? = null
) : WebViewClient() {

    companion object {
        const val DOMAIN = "appassets.androidplatform.net"
        const val BUFFER_SIZE_BYTES = 64 * 1024 // 64KB chunked streaming buffer

        private val GAME_ASSET_EXTENSIONS = setOf(
            "mix", "csf", "map", "mpr", "yro", "vqp", "pal", "shp", "vxp", "tmp", "bin", "dat"
        )
    }

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val url = request?.url?.toString()
        return !UrlSecurityValidator.isAllowedUrl(url)
    }

    @Deprecated("For API < 24 compatibility")
    override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
        return !UrlSecurityValidator.isAllowedUrl(url)
    }

    override fun shouldInterceptRequest(
        view: WebView?,
        request: WebResourceRequest?
    ): WebResourceResponse {
        val url = request?.url ?: return create403Response("Null request URL")
        val scheme = url.scheme ?: ""
        val host = url.host ?: ""

        // Only intercept requests for appassets.androidplatform.net under HTTPS
        if (!scheme.equals("https", ignoreCase = true) || !host.equals(DOMAIN, ignoreCase = true)) {
            return create403Response("Non-local domain request blocked")
        }

        val method = request.method ?: "GET"
        if (method.equals("OPTIONS", ignoreCase = true)) {
            return createPreflightResponse()
        }

        val path = url.path ?: ""
        if (path.startsWith("/gameres/")) {
            return handleGameResourceRequest(path)
        }

        // Delegate static assets to WebViewAssetLoader if provided
        val assetResponse = assetLoader?.shouldInterceptRequest(url)
        if (assetResponse != null) {
            return assetResponse
        }

        // Direct assets fallback for non-standard file extensions (e.g. .ini, .json)
        val cleanAssetPath = path.removePrefix("/").substringBefore('?').substringBefore('#')
        if (cleanAssetPath.isNotEmpty()) {
            try {
                val stream = context.assets.open(cleanAssetPath)
                val mime = getMimeType(cleanAssetPath)
                return create200Response(mime, BufferedInputStream(stream, BUFFER_SIZE_BYTES))
            } catch (_: Exception) {
                // Not found in bundled assets
            }
        }

        return create404Response()
    }

    fun handleGameResourceRequest(rawPath: String): WebResourceResponse {
        val cleanPath = rawPath.substringBefore('?').substringBefore('#')

        // 1. Multi-pass URL decode & path traversal security validation
        if (isPathTraversalAttempt(cleanPath)) {
            return create403Response("Path traversal attempt blocked")
        }

        val decodedPath = decodeMultiPass(cleanPath)
        val relativePath = decodedPath.removePrefix("/gameres/").trimStart('/')

        val rootDir = File(filesDir, "gameres")
        val targetFile = File(rootDir, relativePath)

        // 2. File canonical path containment check
        if (!isCanonicalContained(targetFile, rootDir)) {
            return create403Response("Canonical path containment check failed")
        }

        val mimeType = getMimeType(relativePath)

        // 3. Serve from Internal Storage if available
        if (targetFile.exists() && targetFile.isFile) {
            return try {
                val inputStream = BufferedInputStream(FileInputStream(targetFile), BUFFER_SIZE_BYTES)
                create200Response(mimeType, inputStream)
            } catch (e: Exception) {
                create404Response()
            }
        }

        // 4. Serve from Bundled Assets fallback
        return try {
            val assetPath = "gameres/$relativePath"
            val assetStream = context.assets.open(assetPath)
            val inputStream = BufferedInputStream(assetStream, BUFFER_SIZE_BYTES)
            create200Response(mimeType, inputStream)
        } catch (e: Exception) {
            create404Response()
        }
    }

    fun isPathTraversalAttempt(path: String): Boolean {
        var current = path
        val passes = mutableListOf(current)

        for (i in 0 until 4) {
            val decoded = try {
                URLDecoder.decode(current, "UTF-8")
            } catch (e: Exception) {
                current
            }
            if (decoded == current) break
            current = decoded
            passes.add(current)
        }

        val blacklist = listOf("..", "\\", "%00", "\u0000", "%5c", "%5C", "%2e%2e", "%2E%2E")

        for (p in passes) {
            for (item in blacklist) {
                if (p.contains(item, ignoreCase = true)) {
                    return true
                }
            }

            val segments = p.split('/', '\\')
            for (segment in segments) {
                if (segment == ".." || segment == ".") {
                    return true
                }
                if (segment.contains("\u0000")) {
                    return true
                }
            }
        }

        return false
    }

    fun decodeMultiPass(input: String, maxPasses: Int = 4): String {
        var current = input
        for (i in 0 until maxPasses) {
            val decoded = try {
                URLDecoder.decode(current, "UTF-8")
            } catch (e: Exception) {
                current
            }
            if (decoded == current) break
            current = decoded
        }
        return current
    }

    fun isCanonicalContained(targetFile: File, rootDir: File): Boolean {
        return try {
            val rootCanonical = rootDir.canonicalPath
            val targetCanonical = targetFile.canonicalPath
            val rootPrefix = if (rootCanonical.endsWith(File.separator)) rootCanonical else rootCanonical + File.separator
            targetCanonical.startsWith(rootPrefix) || targetCanonical == rootCanonical
        } catch (e: Exception) {
            false
        }
    }

    fun getMimeType(path: String): String {
        val clean = path.substringBefore('?').substringBefore('#')
        val ext = clean.substringAfterLast('.', "").lowercase()
        return when (ext) {
            in GAME_ASSET_EXTENSIONS -> "application/octet-stream"
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "ini", "txt" -> "text/plain"
            "wasm" -> "application/wasm"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            "wav" -> "audio/wav"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            else -> "application/octet-stream"
        }
    }

    private fun createPreflightResponse(): WebResourceResponse {
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers" to "*",
            "Access-Control-Max-Age" to "86400"
        )
        return LocalWebResourceResponse(
            "text/plain",
            "UTF-8",
            200,
            "OK",
            headers,
            ByteArrayInputStream(ByteArray(0))
        )
    }

    private fun create200Response(mimeType: String, data: InputStream): WebResourceResponse {
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*",
            "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers" to "*"
        )
        return LocalWebResourceResponse(
            mimeType,
            "UTF-8",
            200,
            "OK",
            headers,
            data
        )
    }

    fun create403Response(reason: String = "Forbidden"): WebResourceResponse {
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*"
        )
        return LocalWebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            reason,
            headers,
            ByteArrayInputStream("403 Forbidden: $reason".toByteArray(Charsets.UTF_8))
        )
    }

    fun create404Response(): WebResourceResponse {
        val headers = mapOf(
            "Access-Control-Allow-Origin" to "*"
        )
        return LocalWebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            headers,
            ByteArrayInputStream("404 Not Found".toByteArray(Charsets.UTF_8))
        )
    }

    override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        val didCrash = detail?.didCrash() ?: true
        return onRenderProcessGoneListener?.invoke(didCrash) ?: true
    }
}
