import { ModelQuality } from "@/engine/renderable/entity/unit/ModelQuality";
import { ShadowQuality } from "@/engine/renderable/entity/unit/ShadowQuality";
import { BoxedVar } from "@/util/BoxedVar";
interface Resolution {
    width: number;
    height: number;
}
export class GraphicsOptions {
    resolution: BoxedVar<Resolution | undefined>;
    models: BoxedVar<ModelQuality>;
    shadows: BoxedVar<ShadowQuality>;
    // Rendered frames per second cap (0 = display rate). Only limits drawing;
    // the sim tick rate is unaffected.
    frameLimit: BoxedVar<number>;
    constructor() {
        this.resolution = new BoxedVar<Resolution | undefined>(undefined);
        this.models = new BoxedVar(ModelQuality.High);
        // Fresh installs on touch devices default to Medium shadows: the High
        // shadow map is a huge single GPU allocation, and phones sit much
        // closer to the WebContent memory limit than desktops. (Users can
        // still pick High in Options; WorldScene caps the map size on mobile.)
        const isCoarsePointer = GraphicsOptions.isTouchDevice();
        this.shadows = new BoxedVar(isCoarsePointer ? ShadowQuality.Medium : ShadowQuality.High);
        // Touch devices default to 30 fps. Measured on an iPad mini A17 in a
        // 6-bot match, dropping the render cap from 60 to 30 cut total CPU
        // from 500 ms/s to 368 ms/s — a 26% reduction in sustained power,
        // which is heat. The simulation tick rate is untouched, so the game
        // stays exactly as responsive; only drawing halves. Raise it in
        // Options if you prefer smoother panning to a cooler device.
        this.frameLimit = new BoxedVar(isCoarsePointer ? 30 : 60);
    }
    /** Bumped only when a stored value needs migrating; see unserialize. */
    private static readonly SCHEMA_VERSION = 1;
    /** Coarse pointer == phone/tablet, where sustained power matters most. */
    private static isTouchDevice(): boolean {
        return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    }
    unserialize(data: string): this {
        const [t, i, r, f, v] = data.split(",");
        this.models.value = Number(t) as ModelQuality;
        this.shadows.value = Number(i) as ShadowQuality;
        if (r !== undefined) {
            const s = r.length ? r.split("x").map((e) => Number(e)) : undefined;
            this.resolution.value = s ? { width: s[0], height: s[1] } : undefined;
        }
        if (f !== undefined && f.length) {
            const saved = Number(f);
            // Settings written before the touch default existed carry 60 (or 0
            // = display rate), which would leave every existing install hot.
            // Migrate those once, keyed off the absence of the version field —
            // after that the saved value is whatever the player picked in
            // Options, including 60, and must be honoured.
            const preMigration = v === undefined;
            this.frameLimit.value = preMigration && GraphicsOptions.isTouchDevice()
                ? (saved === 0 ? 30 : Math.min(saved, 30))
                : saved;
        }
        return this;
    }
    serialize(): string {
        return [
            this.models.value,
            this.shadows.value,
            this.resolution.value
                ? [this.resolution.value.width, this.resolution.value.height].join("x")
                : "",
            this.frameLimit.value,
            // Schema version. Its presence marks a save written after the touch
            // frame-limit migration, so unserialize stops re-clamping.
            GraphicsOptions.SCHEMA_VERSION,
        ].join(",");
    }
    applyLowPreset(): void {
        this.models.value = ModelQuality.Low;
        this.shadows.value = ShadowQuality.Low;
    }
    applyHighPreset(): void {
        this.models.value = ModelQuality.High;
        this.shadows.value = ShadowQuality.High;
    }
}
