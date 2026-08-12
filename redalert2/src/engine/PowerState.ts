import { BoxedVar } from '../util/BoxedVar';
import type { ThermalState } from '../shell/nativeBridge';

export type { ThermalState };

/**
 * OS-reported thermal pressure, pushed in by the native shell
 * (iOS/Android). Nothing in the browser can observe
 * this: JavaScript timing cannot tell SoC throttling apart from a heavy frame,
 * so without the shell the game has no way to know it is cooking the device.
 */
export const thermalState = new BoxedVar<ThermalState>('nominal');

/** Set when iOS/Android Low Power Mode is on. Treated the same as thermal pressure. */
export const lowPowerMode = new BoxedVar<boolean>(false);

/**
 * Render fps ceiling implied by the current power state. 0 = no ceiling.
 *
 * Only the render path is capped — the simulation tick rate is untouched, so
 * this can change mid-match without any risk to lockstep determinism. At
 * `serious` the SoC is already throttling, so halving the frame rate costs
 * less smoothness than the throttle itself would.
 */
export function powerFrameCap(): number {
    if (thermalState.value === 'critical') {
        return 15;
    }
    if (thermalState.value === 'serious' || lowPowerMode.value) {
        return 20;
    }
    return 0;
}

/**
 * Installs the receiver the native shell calls. No-op in a browser, where the
 * shell never calls it and the caps above stay inert.
 */
export function installPowerStateReceiver(): void {
    const shell = window.__RA2_SHELL__;
    if (shell?.thermalState) {
        thermalState.value = shell.thermalState;
    }
    if (shell?.lowPowerMode !== undefined) {
        lowPowerMode.value = shell.lowPowerMode;
    }
    window.__RA2_POWER__ = (state: { thermal?: ThermalState; lowPower?: boolean }) => {
        if (state?.thermal) {
            thermalState.value = state.thermal;
        }
        if (state?.lowPower !== undefined) {
            lowPowerMode.value = !!state.lowPower;
        }
    };
}
