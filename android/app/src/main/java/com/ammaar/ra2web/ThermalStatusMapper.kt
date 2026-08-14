package com.ammaar.ra2web

object ThermalStatusMapper {
    const val THERMAL_STATUS_NONE = 0
    const val THERMAL_STATUS_LIGHT = 1
    const val THERMAL_STATUS_MODERATE = 2
    const val THERMAL_STATUS_SEVERE = 3
    const val THERMAL_STATUS_CRITICAL = 4
    const val THERMAL_STATUS_EMERGENCY = 5
    const val THERMAL_STATUS_SHUTDOWN = 6

    fun mapThermalStatus(status: Int): String {
        return when (status) {
            THERMAL_STATUS_NONE -> "nominal"
            THERMAL_STATUS_LIGHT,
            THERMAL_STATUS_MODERATE -> "fair"
            THERMAL_STATUS_SEVERE -> "serious"
            THERMAL_STATUS_CRITICAL,
            THERMAL_STATUS_EMERGENCY,
            THERMAL_STATUS_SHUTDOWN -> "critical"
            else -> "nominal"
        }
    }
}
