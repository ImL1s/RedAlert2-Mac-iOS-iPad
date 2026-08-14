package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebViewCrashRecoveryTest {

    @Test
    fun testCrashRateLimiterAllowsUnderThreshold() {
        var simulatedTime = 1000L
        val limiter = CrashRateLimiter(
            maxCrashes = 3,
            windowMillis = 300_000L,
            clock = { simulatedTime }
        )

        // 1st crash
        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertEquals(1, limiter.getRecentCrashCount())

        // 2nd crash
        simulatedTime += 10_000L
        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertEquals(2, limiter.getRecentCrashCount())

        // 3rd crash
        simulatedTime += 10_000L
        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertEquals(3, limiter.getRecentCrashCount())

        // 4th crash (exceeds 3 crashes in window)
        simulatedTime += 10_000L
        assertFalse(limiter.recordCrashAndCheckPermitted())
        assertEquals(4, limiter.getRecentCrashCount())
    }

    @Test
    fun testCrashRateLimiterSlidingWindowExpiry() {
        var simulatedTime = 0L
        val window = 300_000L // 5 minutes
        val limiter = CrashRateLimiter(
            maxCrashes = 3,
            windowMillis = window,
            clock = { simulatedTime }
        )

        // 3 crashes at t = 1000, 2000, 3000
        simulatedTime = 1000L
        assertTrue(limiter.recordCrashAndCheckPermitted())
        simulatedTime = 2000L
        assertTrue(limiter.recordCrashAndCheckPermitted())
        simulatedTime = 3000L
        assertTrue(limiter.recordCrashAndCheckPermitted())

        // 4th crash at t = 4000 (blocked)
        simulatedTime = 4000L
        assertFalse(limiter.recordCrashAndCheckPermitted())

        // Advance time past the 5-minute window from the initial crashes
        // t = 305,000 ms (window cutoff = 305,000 - 300,000 = 5,000 ms)
        // All crashes at 1000, 2000, 3000, 4000 are older than 5,000 ms and pruned
        simulatedTime = 305_000L
        assertEquals(0, limiter.getRecentCrashCount())
        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertEquals(1, limiter.getRecentCrashCount())
    }

    @Test
    fun testCrashRateLimiterReset() {
        var simulatedTime = 5000L
        val limiter = CrashRateLimiter(
            maxCrashes = 2,
            windowMillis = 60_000L,
            clock = { simulatedTime }
        )

        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertFalse(limiter.recordCrashAndCheckPermitted())

        limiter.reset()
        assertEquals(0, limiter.getRecentCrashCount())
        assertTrue(limiter.isRecoveryPermitted())
        assertTrue(limiter.recordCrashAndCheckPermitted())
    }

    @Test
    fun testIsRecoveryPermittedChecksWithoutRecording() {
        var simulatedTime = 1000L
        val limiter = CrashRateLimiter(
            maxCrashes = 2,
            windowMillis = 60_000L,
            clock = { simulatedTime }
        )

        assertTrue(limiter.isRecoveryPermitted())
        assertEquals(0, limiter.getRecentCrashCount())

        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertTrue(limiter.isRecoveryPermitted())
        assertEquals(1, limiter.getRecentCrashCount())

        assertTrue(limiter.recordCrashAndCheckPermitted())
        assertFalse(limiter.isRecoveryPermitted())
        assertEquals(2, limiter.getRecentCrashCount())
    }
}
