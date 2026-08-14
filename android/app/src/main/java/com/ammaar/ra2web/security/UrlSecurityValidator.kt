package com.ammaar.ra2web.security

object UrlSecurityValidator {
    const val ALLOWED_DOMAIN = "appassets.androidplatform.net"
    const val ALLOWED_ORIGIN = "https://$ALLOWED_DOMAIN"

    fun isAllowedUrl(url: String?): Boolean {
        if (url == null) return false
        if (url == ALLOWED_ORIGIN) return true
        if (url.startsWith("$ALLOWED_ORIGIN/")) return true
        return false
    }
}
