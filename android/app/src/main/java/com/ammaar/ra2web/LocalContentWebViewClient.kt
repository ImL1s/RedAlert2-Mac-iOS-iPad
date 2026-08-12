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
import java.io.BufferedInputStream
import java.io.File

class LocalContentWebViewClient(
    private val context: Context? = null,
    private val assetLoader: WebViewAssetLoader,
    private val safManager: SafResourcePackManager? = null,
    private val onRenderProcessGoneCallback: (didCrash: Boolean) -> Boolean
) : WebViewClient() {

    constructor(
        assetLoader: WebViewAssetLoader,
        onRenderProcessGoneCallback: (didCrash: Boolean) -> Boolean
    ) : this(null, assetLoader, null, onRenderProcessGoneCallback)

    companion object {
        const val DOMAIN = "appassets.androidlocal"
        private const val CHUNK_BUFFER_SIZE = 64 * 1024 // 64 KB chunk buffer

        fun getMimeType(path: String): String {
            val cleanPath = path.substringBefore('?').substringBefore('#')
            val ext = cleanPath.substringAfterLast('.', "").lowercase()
            return when (ext) {
                "html", "htm" -> "text/html"
                "js", "mjs" -> "text/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "wasm" -> "application/wasm"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "gif" -> "image/gif"
                "svg" -> "image/svg+xml"
                "ico" -> "image/x-icon"
                "mp3" -> "audio/mpeg"
                "wav" -> "audio/wav"
                "ogg" -> "audio/ogg"
                "webm" -> "video/webm"
                "mp4" -> "video/mp4"
                "woff" -> "font/woff"
                "woff2" -> "font/woff2"
                "ttf" -> "font/ttf"
                "ini" -> "text/plain"
                "csf", "mix", "map", "mpr", "yro", "vqp", "pal", "shp", "vxp", "tmp" -> "application/octet-stream"
                else -> "application/octet-stream"
            }
        }

        fun buildHeaders(mimeType: String, contentLength: Long? = null): Map<String, String> {
            val headers = mutableMapOf(
                "Access-Control-Allow-Origin" to "https://$DOMAIN",
                "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers" to "*",
                "Cache-Control" to "no-cache, no-store, must-revalidate",
                "Accept-Ranges" to "bytes",
                "Content-Type" to mimeType
            )
            if (contentLength != null && contentLength >= 0) {
                headers["Content-Length"] = contentLength.toString()
            }
            return headers
        }

        fun isPathTraversalString(rawPath: String): Boolean {
            if (rawPath.contains("\u0000") || rawPath.lowercase().contains("%00")) {
                return true
            }

            if (rawPath.contains("\\") || rawPath.lowercase().contains("%5c")) {
                return true
            }

            var current = rawPath
            for (i in 0..3) {
                val lower = current.lowercase()
                if (lower.contains("..") || lower.contains("%2e%2e") || lower.contains("%5c") || lower.contains("%00") || lower.contains("\u0000") || lower.contains("\\")) {
                    return true
                }
                val next = try {
                    java.net.URLDecoder.decode(current, "UTF-8")
                } catch (e: Exception) {
                    current
                }
                if (next == current) break
                current = next
            }

            val segments = current.split('/', '\\')
            if (segments.any { it == ".." || it == "." }) {
                return true
            }

            if (current.contains("..")) {
                return true
            }

            return false
        }

        fun isPathTraversal(url: Uri): Boolean {
            val rawPath = url.encodedPath ?: url.path ?: ""
            return isPathTraversalString(rawPath) || isPathTraversalString(url.toString())
        }
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        val url: Uri = request.url

        if (url.host != null && url.host != DOMAIN) {
            return null
        }

        if (request.method.equals("OPTIONS", ignoreCase = true)) {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                200,
                "OK",
                buildHeaders("text/plain"),
                "".byteInputStream()
            )
        }

        if (isPathTraversal(url)) {
            return WebResourceResponse(
                "text/plain",
                "UTF-8",
                403,
                "Forbidden",
                buildHeaders("text/plain"),
                "Forbidden path traversal".byteInputStream()
            )
        }

        val cleanPath = (url.path ?: "").substringBefore('?').substringBefore('#')
        val decodedPath = Uri.decode(cleanPath)

        if (decodedPath.startsWith("/gameres/")) {
            val fileName = decodedPath.removePrefix("/gameres/")
            return handleGameResRequest(request, fileName)
        }

        val assetPath = if (decodedPath == "/" || decodedPath.isEmpty()) {
            "WebDist/index.html"
        } else if (decodedPath.startsWith("/WebDist/")) {
            decodedPath.removePrefix("/")
        } else {
            "WebDist" + if (decodedPath.startsWith("/")) decodedPath else "/$decodedPath"
        }

        return handleAssetRequest(request, assetPath)
    }

    private fun handleGameResRequest(request: WebResourceRequest, fileName: String): WebResourceResponse {
        val mimeType = getMimeType(fileName)
        val encoding = if (mimeType.startsWith("text/") || mimeType == "application/json") "UTF-8" else null

        if (context != null) {
            val internalFile = File(File(context.filesDir, "gameres"), fileName)
            if (internalFile.exists() && internalFile.isFile) {
                try {
                    val rootDir = File(context.filesDir, "gameres")
                    val rootCanonical = if (rootDir.canonicalPath.endsWith(File.separator)) {
                        rootDir.canonicalPath
                    } else {
                        rootDir.canonicalPath + File.separator
                    }
                    val fileCanonical = internalFile.canonicalPath
                    if (fileCanonical.startsWith(rootCanonical) || fileCanonical == rootDir.canonicalPath) {
                        val inputStream = BufferedInputStream(internalFile.inputStream(), CHUNK_BUFFER_SIZE)
                        return WebResourceResponse(
                            mimeType,
                            encoding,
                            200,
                            "OK",
                            buildHeaders(mimeType, internalFile.length()),
                            inputStream
                        )
                    }
                } catch (e: Exception) {
                    // Ignore path error
                }
            }
        }

        if (safManager != null) {
            val safStream = safManager.openResourceStream(fileName)
            if (safStream != null) {
                val bufferedStream = BufferedInputStream(safStream, CHUNK_BUFFER_SIZE)
                return WebResourceResponse(
                    mimeType,
                    encoding,
                    200,
                    "OK",
                    buildHeaders(mimeType),
                    bufferedStream
                )
            }
        }

        if (context != null) {
            try {
                val assetStream = context.assets.open("gameres/$fileName")
                val bufferedStream = BufferedInputStream(assetStream, CHUNK_BUFFER_SIZE)
                return WebResourceResponse(
                    mimeType,
                    encoding,
                    200,
                    "OK",
                    buildHeaders(mimeType),
                    bufferedStream
                )
            } catch (e: Exception) {
                // Not found in assets
            }
        }

        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            buildHeaders("text/plain"),
            "Game resource not found: $fileName".byteInputStream()
        )
    }

    private fun handleAssetRequest(request: WebResourceRequest, assetPath: String): WebResourceResponse {
        val mimeType = getMimeType(assetPath)
        val encoding = if (mimeType.startsWith("text/") || mimeType == "application/json") "UTF-8" else null

        if (context != null) {
            try {
                val assetStream = context.assets.open(assetPath)
                val bufferedStream = BufferedInputStream(assetStream, CHUNK_BUFFER_SIZE)
                return WebResourceResponse(
                    mimeType,
                    encoding,
                    200,
                    "OK",
                    buildHeaders(mimeType),
                    bufferedStream
                )
            } catch (e: Exception) {
                // Not found in context.assets directly
            }
        }

        val loaderResponse = assetLoader.shouldInterceptRequest(request.url)
        if (loaderResponse != null) {
            return loaderResponse
        }

        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            buildHeaders("text/plain"),
            "Asset not found: $assetPath".byteInputStream()
        )
    }

    override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail
    ): Boolean {
        val didCrash = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            detail.didCrash()
        } else {
            true
        }
        return onRenderProcessGoneCallback(didCrash)
    }
}
