import { NotifyBuildStatus } from './interface/NotifyBuildStatus';
import { NotifyDestroy } from './interface/NotifyDestroy';
import { NotifyOwnerChange } from './interface/NotifyOwnerChange';
import { NotifyUnspawn } from './interface/NotifyUnspawn';
import { Building, BuildStatus } from '@/game/gameobject/Building';
import { ObjectType } from '@/engine/type/ObjectType';
import { RadialBackFirstTileFinder } from '@/game/map/tileFinder/RadialBackFirstTileFinder';

/**
 * Yuri's slave miner (Enslaves=SLAV): the building acts as a refinery (flags
 * derived in TechnoRules) and this trait manages its slave workforce —
 * spawned when the miner finishes, transferred with the miner on capture,
 * and freed to the attacker when the miner dies (retail behavior: killing a
 * slave miner liberates the surviving slaves to the liberator). On undeploy
 * the workforce is dismissed so a redeploy doesn't duplicate slaves.
 */
export class SlaveMinerTrait {
    private slaves = new Set<any>();

    [NotifyBuildStatus.onStatusChange](oldStatus: BuildStatus, building: Building, context: any): void {
        if (building.buildStatus !== BuildStatus.Ready ||
            oldStatus !== BuildStatus.BuildUp ||
            (building.owner as any).isNeutral) {
            return;
        }
        const rules: any = building.rules;
        if (!context.rules.hasObject(rules.enslaves, ObjectType.Infantry)) {
            console.warn(`Slave type "${rules.enslaves}" is not an infantry type.`);
            return;
        }
        const slaveRules = context.rules.getObject(rules.enslaves, ObjectType.Infantry);
        for (let i = 0; i < rules.slavesNumber; i++) {
            const slave = context.createUnitForPlayer(slaveRules, building.owner);
            let fallbackTile: any;
            const spawnTile = new RadialBackFirstTileFinder(context.map.tiles, context.map.mapBounds, building.tile, building.getFoundation(), 1, 2, (tile: any) => {
                const isValidTile = context.map.terrain.getPassableSpeed(tile, slave.rules.speedType, true, false) > 0 &&
                    Math.abs(tile.z - building.tile.z) < 2 &&
                    !context.map.terrain.findObstacles({ tile, onBridge: undefined }, slave).length;
                if (!fallbackTile && isValidTile) {
                    fallbackTile = tile;
                }
                return isValidTile;
            }).getNextTile() ?? fallbackTile;
            if (!spawnTile) {
                building.owner.removeOwnedObject(slave);
                slave.dispose();
                console.warn(`[SlaveMinerTrait] no spawn tile for slave ${i + 1}/${rules.slavesNumber} of "${building.name}"#${building.id}`);
                continue;
            }
            context.spawnObject(slave, spawnTile);
            this.slaves.add(slave);
        }
    }

    [NotifyOwnerChange.onChange](building: any, oldOwner: any, world: any): void {
        // Captured miner: the workforce follows the new owner.
        for (const slave of this.aliveSlaves()) {
            if (slave.owner === oldOwner) {
                world.changeObjectOwner(slave, building.owner);
            }
        }
    }

    [NotifyDestroy.onDestroy](building: any, world: any, attacker: any): void {
        const liberator = attacker?.player ?? attacker?.obj?.owner ?? attacker?.owner;
        for (const slave of this.aliveSlaves()) {
            if (slave.owner === building.owner &&
                liberator &&
                liberator !== building.owner &&
                !liberator.defeated &&
                (liberator.isCombatant?.() ?? true)) {
                world.changeObjectOwner(slave, liberator);
            }
        }
        this.slaves.clear();
    }

    [NotifyUnspawn.onUnspawn](building: any, world: any): void {
        // Undeploy back into the mobile miner: dismiss the workforce instead
        // of letting a redeploy mint a fresh set alongside the old one.
        if (!building.isDestroyed) {
            for (const slave of this.aliveSlaves()) {
                if (slave.owner === building.owner) {
                    world.destroyObject(slave, undefined, true);
                }
            }
        }
        this.slaves.clear();
    }

    private aliveSlaves(): any[] {
        return [...this.slaves].filter(slave => slave.isSpawned && !slave.isDestroyed && !slave.isDisposed);
    }
}
