import { ZoneType } from "@/game/gameobject/unit/ZoneType";
import { clamp } from "@/util/math";
import * as THREE from "three";
export class RotorHelper {
    static computeRotationStep(entity: {
        zone: ZoneType;
        rules: {
            idleRate?: number;
        };
    }, currentRotation: number, rotor: {
        speed?: number;
        idleSpeed?: number;
    }): number {
        const isAirborne = entity.zone === ZoneType.Air;
        const idleRate = entity.rules.idleRate;
        const isIdle = isAirborne || !!rotor.idleSpeed || !!idleRate;
        // NOT `??`: rotor.speed comes from IniSection.getNumber(), which
        // returns 0 (not undefined) for a missing key — and retail art has no
        // Rotor1Rate at all. With speed 0 the step below is always 0 and both
        // call sites gate on truthiness, so NO rotor in the game ever span.
        let speed = rotor.speed || 67;
        if (!isAirborne) {
            if (rotor.idleSpeed) {
                speed = rotor.idleSpeed;
            }
            else if (idleRate) {
                speed /= idleRate;
            }
        }
        const direction = Math.sign(speed);
        const maxRotation = Math.abs(THREE.MathUtils.degToRad(speed));
        const currentRotationAbs = Math.abs(currentRotation);
        return direction * clamp(currentRotationAbs + 0.1 * (isIdle ? 1 : (currentRotationAbs / maxRotation) * -0.5), 0, maxRotation);
    }
}
