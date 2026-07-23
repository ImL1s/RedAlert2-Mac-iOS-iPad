import { GameApi, LandType, ObjectType, SuperWeaponStatus, SuperWeaponType, UnitData, Vector2 } from "../../game-api";
import { SupabotContext } from "./common/context";
import { MissionController } from "./mission/missionController";
import { AttackMission, AttackMissionState } from "./mission/missions/attackMission";
import { DefenceMission } from "./mission/missions/defenceMission";
import { DebugLogger } from "./common/utils";
import { EffectiveBotConfig } from "../../botProfiles";

// How often the officer polls superweapon state.
const SW_CHECK_INTERVAL_TICKS = 75;

// Enemy units are bucketed into cells this wide when hunting for the juiciest
// blast centroid.
const CLUSTER_CELL_TILES = 8;

// Ready-to-fire delay by difficulty (deliberation time, in ticks).
const FIRE_DELAY_BY_DIFFICULTY: Record<string, number> = {
    easy: 1350,
    normal: 450,
    brutal: 0,
};

interface Cluster {
    score: number;
    x: number;
    y: number;
    count: number;
    infantry: number;
}

/**
 * Fires the bot's superweapons like a retail AI would: nukes and storms on
 * the enemy's most valuable cluster, iron curtain on our own armored push,
 * paradrops into the fight, recon powers on cooldown. All target picks are
 * deterministic (sorted iteration, no PRNG) — bots run in lockstep.
 */
export class SuperweaponOfficer {
    private lastCheckAt = 0;
    /** SW type -> tick we first saw it Ready (for the deliberation delay). */
    private readySince = new Map<number, number>();

    constructor(private config: EffectiveBotConfig) {}

    public onAiUpdate(context: SupabotContext, missionController: MissionController, logger: DebugLogger): void {
        const { game, player, matchAwareness } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastCheckAt + SW_CHECK_INTERVAL_TICKS) {
            return;
        }
        this.lastCheckAt = currentTick;

        let allSw: { playerName: string; type: any; status: any; timerSeconds: number }[];
        try {
            allSw = (game as any).getAllSuperWeaponData?.() ?? [];
        } catch (err) {
            return;
        }
        const mySw = allSw.filter((sw) => sw.playerName === player.name);
        if (mySw.length === 0) {
            this.readySince.clear();
            return;
        }

        // Prune deliberation timers for weapons we no longer own (sold or
        // destroyed while Ready) — else a rebuilt weapon skips its delay.
        const ownedTypes = new Set(mySw.map((sw) => Number(sw.type)));
        for (const type of [...this.readySince.keys()]) {
            if (!ownedTypes.has(type)) {
                this.readySince.delete(type);
            }
        }

        const fireDelay = FIRE_DELAY_BY_DIFFICULTY[this.config.difficultyId] ?? 450;

        for (const sw of mySw) {
            const type = Number(sw.type);
            if (Number(sw.status) !== SuperWeaponStatus.Ready) {
                this.readySince.delete(type);
                continue;
            }
            if (!this.readySince.has(type)) {
                this.readySince.set(type, currentTick);
            }
            if (currentTick < this.readySince.get(type)! + fireDelay) {
                continue;
            }
            if (this.tryFire(context, missionController, type, logger)) {
                this.readySince.delete(type);
            }
        }
    }

    private tryFire(
        context: SupabotContext,
        missionController: MissionController,
        type: number,
        logger: DebugLogger,
    ): boolean {
        const { game, player, matchAwareness } = context;
        const playerData = game.getPlayerData(player.name);

        switch (type) {
            case SuperWeaponType.MultiMissile:
            case SuperWeaponType.LightningStorm:
            case SuperWeaponType.PsychicDominator: {
                const cluster = this.bestEnemyCluster(game, playerData.name, false);
                if (!cluster) {
                    return false;
                }
                logger(`Firing superweapon ${type} at enemy cluster (${cluster.x},${cluster.y}) worth ${Math.round(cluster.score)}`);
                player.actions.activateSuperWeapon(type, { rx: cluster.x, ry: cluster.y });
                return true;
            }
            case SuperWeaponType.GeneticConverter: {
                // Mutator turns infantry into Brutes for US: aim at infantry.
                const cluster = this.bestEnemyCluster(game, playerData.name, true) ?? this.bestEnemyCluster(game, playerData.name, false);
                if (!cluster) {
                    return false;
                }
                logger(`Firing genetic mutator at (${cluster.x},${cluster.y})`);
                player.actions.activateSuperWeapon(type, { rx: cluster.x, ry: cluster.y });
                return true;
            }
            case SuperWeaponType.IronCurtain: {
                // Shield our biggest armored push as it engages.
                const target = this.findArmoredPushCenter(game, missionController, 3);
                if (!target) {
                    return false;
                }
                logger(`Iron curtain on our push at (${target.x},${target.y})`);
                player.actions.activateSuperWeapon(type, { rx: target.x, ry: target.y });
                return true;
            }
            case SuperWeaponType.ForceShield: {
                // Defensive: only when the base is actually under attack.
                const underAttack = missionController
                    .getMissions()
                    .some((m) => m instanceof DefenceMission && m.getPriority() > 0);
                if (!underAttack) {
                    return false;
                }
                const conyard = game
                    .getVisibleUnits(player.name, "self", (r) => r.constructionYard)
                    .map((id) => game.getUnitData(id))
                    .find((u) => !!u);
                if (!conyard) {
                    return false;
                }
                logger(`Force shield on our conyard`);
                player.actions.activateSuperWeapon(type, { rx: conyard.tile.rx, ry: conyard.tile.ry });
                return true;
            }
            case SuperWeaponType.PsychicReveal:
            case SuperWeaponType.SpyPlane: {
                // Recon the strongest enemy's base; effectively free.
                const enemy = this.firstEnemy(game, playerData.name);
                if (!enemy) {
                    return false;
                }
                player.actions.activateSuperWeapon(type, {
                    rx: enemy.startLocation.x,
                    ry: enemy.startLocation.y,
                });
                return true;
            }
            case SuperWeaponType.ParaDrop:
            case SuperWeaponType.AmerParaDrop: {
                // Drop into our ongoing push, or defensively at the rally point.
                const pushCenter = this.findArmoredPushCenter(game, missionController, 1);
                const target = pushCenter ?? matchAwareness.getMainRallyPoint();
                if (!target) {
                    return false;
                }
                logger(`Paradrop at (${target.x},${target.y})`);
                player.actions.activateSuperWeapon(type, { rx: Math.round(target.x), ry: Math.round(target.y) });
                return true;
            }
            case SuperWeaponType.ChronoSphere: {
                // Teleport our armored push right onto its target. Requires a
                // vehicle-heavy squad (organics die in transit) and a safe
                // landing tile (water sinks vehicles).
                const push = this.findChronoCandidate(game, missionController);
                if (!push) {
                    return false;
                }
                const dest = this.findLandingTile(game, push.destination);
                if (!dest) {
                    return false;
                }
                logger(`Chronoshifting push from (${push.source.x},${push.source.y}) to (${dest.x},${dest.y})`);
                player.actions.activateSuperWeapon(
                    type,
                    { rx: push.source.x, ry: push.source.y },
                    { rx: dest.x, ry: dest.y },
                );
                return true;
            }
            default:
                // ChronoWarp (GUI alias) and anything unknown: never fire.
                return false;
        }
    }

    /** Densest enemy cluster by unit value; infantryOnly counts infantry bodies. */
    private bestEnemyCluster(game: GameApi, playerName: string, infantryOnly: boolean): Cluster | null {
        const enemyIds = game.getVisibleUnits(playerName, "enemy");
        const buckets = new Map<number, Cluster>();
        for (const id of enemyIds) {
            const unit = game.getUnitData(id);
            if (!unit) {
                continue;
            }
            const isInfantry = (unit.type as any) === ObjectType.Infantry;
            if (infantryOnly && !isInfantry) {
                continue;
            }
            const cx = Math.floor(unit.tile.rx / CLUSTER_CELL_TILES);
            const cy = Math.floor(unit.tile.ry / CLUSTER_CELL_TILES);
            const key = cx * 10000 + cy;
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { score: 0, x: 0, y: 0, count: 0, infantry: 0 };
                buckets.set(key, bucket);
            }
            const rules: any = unit.rules;
            const value = infantryOnly ? 100 : (rules.cost ?? unit.maxHitPoints) * ((unit.type as any) === ObjectType.Building ? 1.5 : 1);
            bucket.score += value;
            bucket.x += unit.tile.rx;
            bucket.y += unit.tile.ry;
            bucket.count++;
            if (isInfantry) {
                bucket.infantry++;
            }
        }
        let best: Cluster | null = null;
        // Sorted iteration keeps the pick deterministic across clients.
        const keys = [...buckets.keys()].sort((a, b) => a - b);
        for (const key of keys) {
            const bucket = buckets.get(key)!;
            if (infantryOnly && bucket.infantry < 3) {
                continue;
            }
            if (!best || bucket.score > best.score) {
                best = bucket;
            }
        }
        if (!best || best.count === 0) {
            return null;
        }
        return {
            ...best,
            x: Math.round(best.x / best.count),
            y: Math.round(best.y / best.count),
        };
    }

    /** Center of our biggest currently-attacking squad with >= minVehicles vehicles. */
    private findArmoredPushCenter(
        game: GameApi,
        missionController: MissionController,
        minVehicles: number,
    ): Vector2 | null {
        let best: { center: Vector2; vehicles: number } | null = null;
        for (const mission of missionController.getMissions()) {
            if (!(mission instanceof AttackMission) || mission.getState() !== AttackMissionState.Attacking) {
                continue;
            }
            const center = mission.getCenterOfMass();
            if (!center) {
                continue;
            }
            const vehicles = mission
                .getUnitIds()
                .map((id) => game.getUnitData(id))
                .filter((u) => u && (u.type as any) === ObjectType.Vehicle).length;
            if (vehicles >= minVehicles && (!best || vehicles > best.vehicles)) {
                best = { center, vehicles };
            }
        }
        return best ? new Vector2(Math.round(best.center.x), Math.round(best.center.y)) : null;
    }

    private findChronoCandidate(
        game: GameApi,
        missionController: MissionController,
    ): { source: Vector2; destination: Vector2 } | null {
        for (const mission of missionController.getMissions()) {
            if (!(mission instanceof AttackMission) || mission.getState() !== AttackMissionState.Attacking) {
                continue;
            }
            const center = mission.getCenterOfMass();
            const target = mission.getAttackArea();
            if (!center || !target) {
                continue;
            }
            const units = mission.getUnitIds().map((id) => game.getUnitData(id)).filter((u): u is UnitData => !!u);
            const vehicles = units.filter((u) => (u.type as any) === ObjectType.Vehicle).length;
            // Majority-vehicle squads only: chrono kills organic passengers.
            if (vehicles >= 4 && vehicles * 2 >= units.length && center.distanceTo(target) > 20) {
                return {
                    source: new Vector2(Math.round(center.x), Math.round(center.y)),
                    destination: target,
                };
            }
        }
        return null;
    }

    /** A clear-ground tile near `near` that vehicles survive landing on. */
    private findLandingTile(game: GameApi, near: Vector2): Vector2 | null {
        const offsets = [
            [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
            [5, 5], [-5, 5], [5, -5], [-5, -5],
        ];
        for (const [dx, dy] of offsets) {
            const x = Math.round(near.x + dx);
            const y = Math.round(near.y + dy);
            const tile = game.mapApi.getTile(x, y);
            if (!tile) {
                continue;
            }
            const landType = (tile as any).landType;
            if (landType === LandType.Clear || landType === LandType.Road) {
                return new Vector2(x, y);
            }
        }
        return null;
    }

    /** The scariest surviving enemy: most assets on the board (deterministic). */
    private firstEnemy(game: GameApi, playerName: string) {
        const enemies = game
            .getPlayers()
            .filter((name) => name !== playerName && !game.areAlliedPlayers(playerName, name))
            .map((name) => game.getPlayerData(name))
            .filter((p) => p.isCombatant);
        let best: any = null;
        let bestScore = -1;
        for (const enemy of enemies) {
            let score = 0;
            try {
                score = game.getVisibleUnits(enemy.name, "self").length;
            } catch (err) {
                score = 0;
            }
            if (score > bestScore) {
                bestScore = score;
                best = enemy;
            }
        }
        return best;
    }
}
