package com.ammaar.ra2web

import android.os.SystemClock

class CrashRateLimiter(
    val maxCrashes: Int = MAX_CRASHES_DEFAULT,
    val windowMillis: Long = WINDOW_MILLIS_DEFAULT,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() }
) {
    companion object {
        const val MAX_CRASHES_DEFAULT = 3
        const val WINDOW_MILLIS_DEFAULT = 5 * 60 * 1000L // 5 minutes
    }

    private val crashTimestamps = mutableListOf<Long>()

    /**
     * Records a crash occurrence at the current time and returns true if recovery is permitted,
     * or false if the bounded retry limit has been exceeded within the sliding time window.
     */
    @Synchronized
    fun recordCrashAndCheckPermitted(): Boolean {
        val now = clock()
        pruneOldCrashes(now)
        crashTimestamps.add(now)
        return crashTimestamps.size <= maxCrashes
    }

    /**
     * Current number of crashes within the active sliding time window.
     */
    @Synchronized
    fun getRecentCrashCount(): Int {
        pruneOldCrashes(clock())
        return crashTimestamps.size
    }

    /**
     * Checks whether a recovery attempt is currently permitted without recording a new crash.
     */
    @Synchronized
    fun isRecoveryPermitted(): Boolean {
        pruneOldCrashes(clock())
        return crashTimestamps.size < maxCrashes
    }

    /**
     * Resets all recorded crashes.
     */
    @Synchronized
    fun reset() {
        crashTimestamps.clear()
    }

    private fun pruneOldCrashes(now: Long) {
        val cutoff = now - windowMillis
        crashTimestamps.removeAll { it < cutoff }
    }
}
