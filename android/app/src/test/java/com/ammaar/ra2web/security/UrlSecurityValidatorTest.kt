package com.ammaar.ra2web.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlSecurityValidatorTest {

    @Test
    fun testAllowedAppAssetsUrl() {
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidplatform.net/index.html"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidplatform.net/WebDist/index.html"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidplatform.net/res/img/logo.png"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidplatform.net"))
    }

    @Test
    fun testBlockedExternalUrls() {
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://evil.com"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("http://evil.com"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("http://appassets.androidplatform.net/"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://evil.com/appassets.androidplatform.net"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://appassets.androidplatform.net.evil.com/"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("file:///android_asset/index.html"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("javascript:alert(1)"))
        assertFalse(UrlSecurityValidator.isAllowedUrl(null))
    }
}
