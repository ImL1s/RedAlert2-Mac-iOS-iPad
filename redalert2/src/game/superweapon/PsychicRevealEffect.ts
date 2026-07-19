import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";

// Retail hardcodes the reveal radius (no [General] key in rulesmd).
const REVEAL_RADIUS = 10;

/** Yuri's Psychic Reveal (Psychic Sensor): uncovers shroud around the target. */
export class PsychicRevealEffect extends SuperWeaponEffect {
    onStart(game: Game): void {
        const shroud = (game as any).mapShroudTrait?.getPlayerShroud?.(this.owner);
        shroud?.revealAround?.(this.tile, REVEAL_RADIUS);
    }
}
