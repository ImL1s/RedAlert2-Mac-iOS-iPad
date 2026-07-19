import { NotifyDestroy } from './interface/NotifyDestroy';
import { NotifyUnspawn } from './interface/NotifyUnspawn';
import { RadialTileFinder } from '@/game/map/tileFinder/RadialTileFinder';
import { ScatterTask } from '@/game/gameobject/task/ScatterTask';
import { ArmedTrait } from '@/game/gameobject/trait/ArmedTrait';
import { AttackTrait } from '@/game/gameobject/trait/AttackTrait';
import { Weapon } from '@/game/Weapon';
import { WeaponType } from '@/game/WeaponType';
import { fnv32a } from '@/util/math';

/**
 * Yuri's Tank Bunker (Bunker=yes): holds one ground vehicle. While manned,
 * the bunker itself carries the occupant's weapons — the dug-in tank fires
 * out, enemies target the bunker, and the tank emerges unharmed when the
 * bunker is undeployed, sold, or destroyed.
 */
export class TankBunkerTrait {
    private building: any;
    private unit: any;

    constructor(building: any) {
        this.building = building;
    }

    isOccupied(): boolean {
        return !!this.unit;
    }

    store(unit: any, game: any): void {
        this.unit = unit;
        const building = this.building;
        if (!building.armedTrait) {
            building.armedTrait = new ArmedTrait(building, game.rules);
            building.addTrait(building.armedTrait);
        }
        if (!building.attackTrait) {
            building.attackTrait = new AttackTrait(game.map.tiles, game.map.tileOccupation);
            building.addTrait(building.attackTrait);
        }
        const rules = unit.rules;
        building.armedTrait.primaryWeapon = rules.primary
            ? Weapon.factory(rules.primary, WeaponType.Primary, building, game.rules)
            : undefined;
        building.armedTrait.secondaryWeapon = rules.secondary
            ? Weapon.factory(rules.secondary, WeaponType.Secondary, building, game.rules)
            : undefined;
        building.attackTrait.setDisabled(false);
    }

    release(game: any, destroyOccupant: boolean = false): void {
        const unit = this.unit;
        if (!unit) {
            return;
        }
        this.unit = undefined;
        this.disarm();
        if (destroyOccupant) {
            game.destroyObject(unit, undefined, true);
            return;
        }
        const building = this.building;
        const finder = new RadialTileFinder(game.map.tiles, game.map.mapBounds, building.tile, building.art.foundation, 1, 2, (tile: any) => {
            return game.map.terrain.getPassableSpeed(tile, unit.rules.speedType, false, false) > 0 &&
                Math.abs(tile.z - building.tile.z) < 2 &&
                !game.map.terrain.findObstacles({ tile, onBridge: undefined }, unit).length;
        });
        const exitTile = finder.getNextTile();
        if (exitTile) {
            game.unlimboObject(unit, exitTile);
            unit.unitOrderTrait.addTask(new ScatterTask(game));
        }
        else {
            // Fully sealed in — the crew doesn't make it out.
            game.destroyObject(unit, { player: unit.owner });
        }
    }

    private disarm(): void {
        const building = this.building;
        if (building.armedTrait) {
            building.armedTrait.primaryWeapon = undefined;
            building.armedTrait.secondaryWeapon = undefined;
        }
        if (building.attackTrait) {
            building.attackTrait.setDisabled(true);
        }
        building.unitOrderTrait?.getTasks?.().forEach((task: any) => task.cancel?.());
    }

    [NotifyDestroy.onDestroy](building: any, context: any, reason: any, isImmediate: boolean): void {
        this.release(context, isImmediate);
    }

    [NotifyUnspawn.onUnspawn](building: any, context: any): void {
        // Selling or undeploying an occupied bunker frees the tank first.
        if (this.unit && !building.isDestroyed) {
            this.release(context);
        }
    }

    getHash(): number {
        return fnv32a([this.unit ? this.unit.getHash() : 0]);
    }

    debugGetState() {
        return { unit: this.unit ? this.unit.name + '#' + this.unit.id : null };
    }

    dispose(): void {
        this.building = undefined;
        this.unit = undefined;
    }
}
