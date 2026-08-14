package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeAreaHelperTest {

    @Test
    fun testCalculateNormalizedInsets() {
        val insets1x = SafeAreaHelper.calculateNormalizedInsets(48, 24, 0, 24, 1.0f)
        assertEquals(48.0f, insets1x.top, 0.01f)
        assertEquals(24.0f, insets1x.right, 0.01f)
        assertEquals(0.0f, insets1x.bottom, 0.01f)
        assertEquals(24.0f, insets1x.left, 0.01f)

        val insets2x = SafeAreaHelper.calculateNormalizedInsets(96, 48, 0, 48, 2.0f)
        assertEquals(48.0f, insets2x.top, 0.01f)
        assertEquals(24.0f, insets2x.right, 0.01f)
        assertEquals(0.0f, insets2x.bottom, 0.01f)
        assertEquals(24.0f, insets2x.left, 0.01f)
    }

    @Test
    fun testGenerateCssVariablesScript() {
        val insets = InsetsDpi(32.0f, 16.0f, 0.0f, 16.0f)
        val script = SafeAreaHelper.generateCssVariablesScript(insets)

        assertTrue(script.contains("--safe-area-inset-top', '32.0px'"))
        assertTrue(script.contains("--safe-area-inset-right', '16.0px'"))
        assertTrue(script.contains("--safe-area-inset-bottom', '0.0px'"))
        assertTrue(script.contains("--safe-area-inset-left', '16.0px'"))
    }
}
