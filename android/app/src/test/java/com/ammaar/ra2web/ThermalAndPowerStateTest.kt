package com.ammaar.ra2web

import org.junit.Assert.assertEquals
import org.junit.Test

class ThermalAndPowerStateTest {

    @Test
    fun testMapThermalStatusMappings() {
        assertEquals("nominal", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_NONE))
        assertEquals("fair", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_LIGHT))
        assertEquals("fair", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_MODERATE))
        assertEquals("serious", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_SEVERE))
        assertEquals("critical", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_CRITICAL))
        assertEquals("critical", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_EMERGENCY))
        assertEquals("critical", ThermalStatusMapper.mapThermalStatus(ThermalStatusMapper.THERMAL_STATUS_SHUTDOWN))
        assertEquals("nominal", ThermalStatusMapper.mapThermalStatus(999)) // Fallback for unknown
    }
}
