import { RadialTileFinder } from "@/game/map/tileFinder/RadialTileFinder";
import { SuperWeaponEffect } from "@/game/superweapon/SuperWeaponEffect";
import { Game } from "@/game/Game";

/**
 * Force Shield (battle labs): buildings around the target become
 * invulnerable for ForceShieldDuration, at the price of a power blackout
 * for the caster (ForceShieldBlackoutDuration).
 */
export class ForceShieldEffect extends SuperWeaponEffect {
    onStart(game: Game): void {
        const general = (game.rules as any).ini.getSection("General");
        const radius = general?.getNumber("ForceShieldRadius", 4) ?? 4;
        const duration = general?.getNumber("ForceShieldDuration", 500) ?? 500;
        const blackout = general?.getNumber("ForceShieldBlackoutDuration", 1000) ?? 1000;
        const shielded = new Set<any>();
        const tileFinder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, this.tile, { width: 1, height: 1 }, 0, Math.max(0, Math.ceil(radius)), () => true);
        let tile;
        while ((tile = tileFinder.getNextTile())) {
            for (const object of game.map.getGroundObjectsOnTile(tile)) {
                if (object.isBuilding() && !object.isDestroyed && !shielded.has(object)) {
                    shielded.add(object);
                    object.invulnerableTrait.setActiveFor(duration, game.currentTick);
                }
            }
        }
        this.owner.powerTrait?.setBlackoutFor(blackout, game);
    }
}
