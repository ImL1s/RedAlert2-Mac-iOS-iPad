import * as THREE from "three";
const BERSERK_TINT = 0.4;
export class ExtraLightHelper {
    static multiplyShp(target: THREE.Color, source: THREE.Color, intensity: number): void {
        target.copy(source).add(source.clone().addScalar(1).multiplyScalar(intensity));
    }
    static multiplyVxl(target: THREE.Color, source: THREE.Color, intensity: number, radius: number): void {
        target.copy(source).multiplyScalar(Math.max(0, 1 + radius));
    }
    // Iron curtain shimmer: retail pulses invulnerable objects toward red-hot,
    // not plain white. v is the anim value (0..1).
    static ironCurtainVxl(target: any, source: any, v: number): void {
        target.x = source.x * (1 + v);
        target.y = source.y * (1 - 0.35 * v);
        target.z = source.z * (1 - 0.5 * v);
    }
    static ironCurtainShp(target: any, source: any, v: number): void {
        target.x = (source.x + 1) * (1 + v) - 1;
        target.y = (source.y + 1) * (1 - 0.35 * v) - 1;
        target.z = (source.z + 1) * (1 - 0.5 * v) - 1;
    }
    // Berserk (Chaos gas) tint: steady deep red.
    // Shp extraLight is applied in the shader as color * (1 + extraLight),
    // so scale green/blue in that domain to end up multiplied by the tint.
    static tintShpRed(target: THREE.Vector3): void {
        target.y = (1 + target.y) * BERSERK_TINT - 1;
        target.z = (1 + target.z) * BERSERK_TINT - 1;
    }
    // Vxl extraLight is a direct per-channel cell-light multiplier.
    static tintVxlRed(target: THREE.Vector3): void {
        target.y *= BERSERK_TINT;
        target.z *= BERSERK_TINT;
    }
}
