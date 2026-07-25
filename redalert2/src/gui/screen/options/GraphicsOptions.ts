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
        const isCoarsePointer = typeof window !== 'undefined'
            && window.matchMedia?.('(pointer: coarse)').matches;
        this.shadows = new BoxedVar(isCoarsePointer ? ShadowQuality.Medium : ShadowQuality.High);
        this.frameLimit = new BoxedVar(60);
    }
    unserialize(data: string): this {
        const [t, i, r, f] = data.split(",");
        this.models.value = Number(t) as ModelQuality;
        this.shadows.value = Number(i) as ShadowQuality;
        if (r !== undefined) {
            const s = r.length ? r.split("x").map((e) => Number(e)) : undefined;
            this.resolution.value = s ? { width: s[0], height: s[1] } : undefined;
        }
        if (f !== undefined && f.length) {
            this.frameLimit.value = Number(f);
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
