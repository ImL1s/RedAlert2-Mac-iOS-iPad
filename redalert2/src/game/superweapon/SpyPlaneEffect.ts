import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";

// The recon pass uncovers a corridor around the target (simplified: no
// plane flyover, the reveal itself is what matters).
const REVEAL_RADIUS = 7;

/** Soviet Spy Plane (radar SW in YR). */
export class SpyPlaneEffect extends SuperWeaponEffect {
    onStart(game: Game): void {
        const shroud = (game as any).mapShroudTrait?.getPlayerShroud?.(this.owner);
        shroud?.revealAround?.(this.tile, REVEAL_RADIUS);
    }
}
