package com.ammaar.ra2web.security

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlSecurityValidatorTest {

    @Test
    fun testAllowedAppAssetsUrl() {
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidlocal/index.html"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidlocal/WebDist/index.html"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidlocal/res/img/logo.png"))
        assertTrue(UrlSecurityValidator.isAllowedUrl("https://appassets.androidlocal"))
    }

    @Test
    fun testBlockedExternalUrls() {
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://evil.com"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("http://evil.com"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("http://appassets.androidlocal/"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://evil.com/appassets.androidlocal"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("https://appassets.androidlocal.evil.com/"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("file:///android_asset/index.html"))
        assertFalse(UrlSecurityValidator.isAllowedUrl("javascript:alert(1)"))
        assertFalse(UrlSecurityValidator.isAllowedUrl(null))
    }
}
