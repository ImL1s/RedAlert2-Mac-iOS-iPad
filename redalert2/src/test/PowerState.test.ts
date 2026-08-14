import { describe, expect, test, beforeEach } from 'bun:test';
import {
    thermalState,
    lowPowerMode,
    powerFrameCap,
    installPowerStateReceiver,
    ThermalState
} from '../engine/PowerState';

describe('PowerState & Thermal Throttling', () => {
    beforeEach(() => {
        thermalState.value = 'nominal';
        lowPowerMode.value = false;
        (globalThis as any).window = {};
    });

    test('powerFrameCap returns 0 (uncapped) on nominal and fair thermal states', () => {
        thermalState.value = 'nominal';
        lowPowerMode.value = false;
        expect(powerFrameCap()).toBe(0);

        thermalState.value = 'fair';
        expect(powerFrameCap()).toBe(0);
    });

    test('powerFrameCap returns 20 FPS on serious thermal state or low power mode', () => {
        thermalState.value = 'serious';
        lowPowerMode.value = false;
        expect(powerFrameCap()).toBe(20);

        thermalState.value = 'nominal';
        lowPowerMode.value = true;
        expect(powerFrameCap()).toBe(20);

        thermalState.value = 'fair';
        lowPowerMode.value = true;
        expect(powerFrameCap()).toBe(20);
    });

    test('powerFrameCap returns 15 FPS on critical thermal state regardless of lowPowerMode', () => {
        thermalState.value = 'critical';
        lowPowerMode.value = false;
        expect(powerFrameCap()).toBe(15);

        thermalState.value = 'critical';
        lowPowerMode.value = true;
        expect(powerFrameCap()).toBe(15);
    });

    test('installPowerStateReceiver reads initial state from __RA2_SHELL__', () => {
        (globalThis as any).window.__RA2_SHELL__ = {
            platform: 'android',
            version: '0.1.0',
            thermalState: 'serious' as ThermalState,
            lowPowerMode: true,
        };

        installPowerStateReceiver();

        expect(thermalState.value).toBe('serious');
        expect(powerFrameCap()).toBe(20);
    });

    test('installPowerStateReceiver sets up __RA2_POWER__ listener for runtime updates', () => {
        installPowerStateReceiver();
        expect(typeof (globalThis as any).window.__RA2_POWER__).toBe('function');

        (globalThis as any).window.__RA2_POWER__({ thermal: 'critical', lowPower: true });
        expect(thermalState.value).toBe('critical');
        expect(lowPowerMode.value).toBe(true);
        expect(powerFrameCap()).toBe(15);

        (globalThis as any).window.__RA2_POWER__({ thermal: 'nominal', lowPower: false });
        expect(thermalState.value).toBe('nominal');
        expect(lowPowerMode.value).toBe(false);
        expect(powerFrameCap()).toBe(0);
    });
});
