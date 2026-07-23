import {
    ActionsApi,
    AttackState,
    BotContext,
    GameApi,
    GameMath,
    MovementZone,
    PlayerData,
    UnitData,
    Vector2,
    ZoneType,
} from "../../../../../game-api";
import { MatchAwareness } from "../../../awareness";
import { getAttackWeight, manageAttackMicro, manageMoveMicro } from "./common";
import { DebugLogger, isOwnedByNeutral, maxBy, minBy } from "../../../common/utils";
import { ActionBatcher, BatchableAction } from "../../actionBatcher";
import { Squad } from "./squad";
import { Mission, MissionAction, disbandMission, grabCombatants, noop } from "../../mission";
import { MissionContext } from "../../../common/context";

const TARGET_UPDATE_INTERVAL_TICKS = 10;

// Units must be in a certain radius of the center of mass before attacking.
// This scales for number of units in the squad though.
const MIN_GATHER_RADIUS = 5;

// If the radius expands beyond this amount then we should switch back to gathering mode.
const MAX_GATHER_RADIUS = 15;

const GATHER_RATIO = 10;

const ATTACK_SCAN_AREA = 15;

// How often the squad re-evaluates whether it is winning its fight.
const FIGHT_EVAL_INTERVAL_TICKS = 45;
// Consecutive losing evaluations before the squad breaks off.
const FIGHT_EVAL_LOSING_STREAK = 2;

// Long-range units hold a stand-off ring instead of walking into the base.
const STANDOFF_MIN_RANGE = 7;

// Approach waypoints are re-scored at most this often.
const WAYPOINT_REFRESH_TICKS = 150;
const SECTOR_SAMPLE_STEP = 8;

enum SquadState {
    Gathering,
    Attacking,
}

/** Reason string surfaced when a squad breaks off a losing fight. */
export const SQUAD_REPELLED = "Repelled";

/** Generals-style approach lanes: straight in, side arc, or deep flank. */
export type AttackLane = "center" | "flank" | "backdoor";

const LANE_OFFSETS: Record<AttackLane, number[]> = {
    center: [-8, 0, 8],
    flank: [-20, -12, 12, 20],
    backdoor: [-40, -28, 28, 40],
};

export class CombatSquad implements Squad {
    private lastCommand: number | null = null;
    private state = SquadState.Gathering;

    private debugLastTarget: string | undefined;

    private lastOrderGiven: { [unitId: number]: { action: BatchableAction; tick: number } } = {};

    private lastFightEvalAt = 0;
    private losingStreak = 0;

    private approachWaypoint: Vector2 | null = null;
    private waypointPickedAt: number | null = null;

    /**
     *
     * @param rallyArea the initial location to grab combatants
     * @param targetArea
     * @param radius
     * @param canRetreat whether the squad may break off a clearly-lost fight
     *                   (attack squads yes, base defense no)
     */
    constructor(
        private rallyArea: Vector2,
        private targetArea: Vector2,
        private radius: number,
        private canRetreat: boolean = false,
        private lane: AttackLane = "center",
    ) {}

    public getGlobalDebugText(): string | undefined {
        return this.debugLastTarget ?? "<none>";
    }

    public setAttackArea(targetArea: Vector2) {
        this.targetArea = targetArea;
        this.waypointPickedAt = null;
    }

    public onAiUpdate(context: MissionContext, mission: Mission<any>, logger: DebugLogger): MissionAction {
        const { game, actionBatcher, matchAwareness } = context;
        const playerData = game.getPlayerData(context.player.name);
        if (
            mission.getUnitIds().length > 0 &&
            (!this.lastCommand || game.getCurrentTick() > this.lastCommand + TARGET_UPDATE_INTERVAL_TICKS)
        ) {
            this.lastCommand = game.getCurrentTick();
            const currentTick = game.getCurrentTick();
            const centerOfMass = mission.getCenterOfMass();
            const maxDistance = mission.getMaxDistanceToCenterOfMass();
            const unitIds = mission.getUnitsMatchingByRule(game, (r) => r.isSelectableCombatant);
            const units = unitIds.map((unitId) => game.getUnitData(unitId)).filter((unit): unit is UnitData => !!unit);

            // Prune order-cache entries for units that died or left the
            // mission: stale entries would swallow a re-grabbed unit's first
            // order (value-equal dedupe) or apply a dead air cooldown, and
            // the map would grow without bound in immortal defence squads.
            const currentIdSet = new Set(mission.getUnitIds());
            for (const key of Object.keys(this.lastOrderGiven)) {
                if (!currentIdSet.has(Number(key))) {
                    delete this.lastOrderGiven[Number(key)];
                }
            }

            // Only use ground units for center of mass.
            const groundUnitIds = mission.getUnitsMatchingByRule(
                game,
                (r) =>
                    r.isSelectableCombatant &&
                    (r.movementZone === MovementZone.Infantry ||
                        r.movementZone === MovementZone.Normal ||
                        r.movementZone === MovementZone.InfantryDestroyer),
            );

            if (this.state === SquadState.Gathering) {
                const requiredGatherRadius = GameMath.sqrt(groundUnitIds.length) * GATHER_RATIO + MIN_GATHER_RADIUS;
                if (
                    centerOfMass &&
                    maxDistance &&
                    game.mapApi.getTile(centerOfMass.x, centerOfMass.y) !== undefined &&
                    maxDistance > requiredGatherRadius
                ) {
                    units.forEach((unit) => {
                        this.submitActionIfNew(actionBatcher, manageMoveMicro(unit, centerOfMass), currentTick);
                    });
                } else {
                    logger(`CombatSquad ${mission.getUniqueName()} switching back to attack mode (${maxDistance})`);
                    this.state = SquadState.Attacking;
                    this.waypointPickedAt = null;
                }
            } else {
                const targetPoint = this.targetArea || playerData.startLocation;
                const regroupRadius = GameMath.sqrt(groundUnitIds.length) * GATHER_RATIO + MAX_GATHER_RADIUS;

                // Split off stragglers (fresh reinforcements walking in from
                // home): they converge on the squad while the front line
                // keeps fighting. The old behavior flipped the WHOLE squad
                // back to Gathering, so every reinforcement grant dragged the
                // push off the fight and it yo-yoed across the map.
                let nearUnits = units;
                const validCenter =
                    centerOfMass && game.mapApi.getTile(centerOfMass.x, centerOfMass.y) !== undefined
                        ? centerOfMass
                        : null;
                if (validCenter) {
                    nearUnits = [];
                    for (const unit of units) {
                        const distance = new Vector2(unit.tile.rx, unit.tile.ry).distanceTo(validCenter);
                        if (distance > regroupRadius) {
                            this.submitActionIfNew(actionBatcher, manageMoveMicro(unit, validCenter), currentTick);
                        } else {
                            nearUnits.push(unit);
                        }
                    }
                }
                if (nearUnits.length === 0) {
                    return noop();
                }

                // Losing-fight check: break off before the squad evaporates.
                if (
                    this.canRetreat &&
                    validCenter &&
                    currentTick > this.lastFightEvalAt + FIGHT_EVAL_INTERVAL_TICKS
                ) {
                    this.lastFightEvalAt = currentTick;
                    if (this.isLosingFight(game, matchAwareness, nearUnits, validCenter)) {
                        this.losingStreak++;
                        if (this.losingStreak >= FIGHT_EVAL_LOSING_STREAK) {
                            logger(`CombatSquad ${mission.getUniqueName()} is losing the fight, breaking off.`);
                            return disbandMission(SQUAD_REPELLED);
                        }
                    } else {
                        this.losingStreak = 0;
                    }
                }

                // The unit with the shortest range chooses the target. Otherwise, a base range of 5 is chosen.
                const getRangeForUnit = (unit: UnitData) =>
                    unit.primaryWeapon?.maxRange ?? unit.secondaryWeapon?.maxRange ?? 5;
                const attackLeader = minBy(nearUnits, getRangeForUnit);
                if (!attackLeader) {
                    return noop();
                }
                // Find units within double the range of the leader.
                const nearbyHostiles = matchAwareness
                    .getHostilesNearPoint(attackLeader.tile.rx, attackLeader.tile.ry, ATTACK_SCAN_AREA)
                    .map(({ unitId }) => game.getUnitData(unitId))
                    .filter((unit) => !isOwnedByNeutral(unit)) as UnitData[];

                const squadHasAir = nearUnits.some(
                    (unit) => unit.rules.movementZone === MovementZone.Fly || unit.zone === ZoneType.Air,
                );

                // Threat-aware approach: when no enemies are engaged yet,
                // route the advance through the least-defended flank.
                const moveTarget = this.getApproachPoint(game, matchAwareness, validCenter, targetPoint, currentTick);

                for (const unit of nearUnits) {
                    // A dead target must not leave its air cooldown blocking
                    // the replacement order.
                    const last = this.lastOrderGiven[unit.id];
                    const lastTargetGone =
                        last?.action.targetId !== undefined && !game.getUnitData(last.action.targetId);
                    const bestUnit = maxBy(nearbyHostiles, (target) => getAttackWeight(unit, target, squadHasAir));
                    if (bestUnit) {
                        const standOff = this.maybeStandOff(game, unit, nearbyHostiles);
                        if (standOff) {
                            this.submitActionIfNew(actionBatcher, standOff, currentTick, lastTargetGone);
                        } else {
                            this.submitActionIfNew(
                                actionBatcher,
                                manageAttackMicro(unit, bestUnit),
                                currentTick,
                                lastTargetGone,
                            );
                        }
                        this.debugLastTarget = `Unit ${bestUnit.id.toString()}`;
                    } else {
                        this.submitActionIfNew(
                            actionBatcher,
                            manageMoveMicro(unit, moveTarget),
                            currentTick,
                            lastTargetGone,
                        );
                        this.debugLastTarget = `@${moveTarget.x},${moveTarget.y}`;
                    }
                }
            }
        }
        return noop();
    }

    /**
     * Distilled OpenRA attack-or-flee evaluation: compare our strength with
     * the hostiles around the squad; flee when clearly outmatched or nearly
     * dead. Deterministic, arithmetic only.
     */
    private isLosingFight(
        game: GameApi,
        matchAwareness: MatchAwareness,
        units: UnitData[],
        centerOfMass: Vector2,
    ): boolean {
        if (units.length === 0) {
            return true;
        }
        const hostiles = matchAwareness
            .getHostilesNearPoint2d(centerOfMass, ATTACK_SCAN_AREA)
            .map(({ unitId }) => game.getUnitData(unitId))
            .filter((unit): unit is UnitData => !!unit && !isOwnedByNeutral(unit));
        if (hostiles.length === 0) {
            return false;
        }
        const strength = (list: UnitData[]) =>
            list.reduce((sum, unit) => sum + unit.hitPoints * (unit.primaryWeapon ? 1 : 0.3), 0);
        const ownPower = strength(units);
        const enemyPower = strength(hostiles);
        const ratio = ownPower / Math.max(1, enemyPower);
        const totalMax = units.reduce((sum, unit) => sum + unit.maxHitPoints, 0);
        const healthAvg = totalMax > 0 ? units.reduce((sum, unit) => sum + unit.hitPoints, 0) / totalMax : 1;

        if (healthAvg < 0.35 && ratio < 1.2) {
            return true;
        }
        if (ratio < 0.4) {
            return true;
        }
        if (ratio < 0.6 && healthAvg < 0.75) {
            return true;
        }
        return false;
    }

    /**
     * Long-range units (V3, Prism...) kite out when hostiles get inside their
     * ring instead of trading at point blank.
     */
    private maybeStandOff(game: GameApi, unit: UnitData, hostiles: UnitData[]): BatchableAction | null {
        const range = unit.primaryWeapon?.maxRange ?? 0;
        if (range < STANDOFF_MIN_RANGE || unit.rules.movementZone === MovementZone.Fly) {
            return null;
        }
        const pos = new Vector2(unit.tile.rx, unit.tile.ry);
        const nearest = minBy(hostiles, (h) => pos.distanceTo(new Vector2(h.tile.rx, h.tile.ry)));
        if (!nearest) {
            return null;
        }
        const nearestPos = new Vector2(nearest.tile.rx, nearest.tile.ry);
        const distance = pos.distanceTo(nearestPos);
        if (distance >= range - 2.5) {
            return null;
        }
        // Back off along the threat axis to just inside max range.
        const away = pos.clone().sub(nearestPos);
        const length = Math.max(1, away.length());
        const backOff = Math.min(4, range - 1 - distance);
        const dest = new Vector2(
            Math.round(pos.x + (away.x / length) * backOff),
            Math.round(pos.y + (away.y / length) * backOff),
        );
        if (!game.mapApi.getTile(dest.x, dest.y)) {
            return null;
        }
        return manageMoveMicro(unit, dest);
    }

    /**
     * Cheap threat-aware routing: bend the approach through the flank with the
     * least diffuse sector threat. No pathfinding; 5 fixed candidates scored
     * by sampling the sector cache along both legs.
     */
    private getApproachPoint(
        game: GameApi,
        matchAwareness: MatchAwareness,
        centerOfMass: Vector2 | null,
        target: Vector2,
        currentTick: number,
    ): Vector2 {
        const from = centerOfMass ?? this.rallyArea;
        if (!from) {
            return target;
        }
        if (this.approachWaypoint && from.distanceTo(this.approachWaypoint) <= 6) {
            // Reached the waypoint; head straight in from here.
            this.approachWaypoint = null;
            this.waypointPickedAt = currentTick;
            return target;
        }
        if (this.waypointPickedAt === null || currentTick > this.waypointPickedAt + WAYPOINT_REFRESH_TICKS) {
            this.waypointPickedAt = currentTick;
            this.approachWaypoint = this.pickApproachWaypoint(game, matchAwareness, from, target);
        }
        return this.approachWaypoint ?? target;
    }

    private pickApproachWaypoint(
        game: GameApi,
        matchAwareness: MatchAwareness,
        from: Vector2,
        to: Vector2,
    ): Vector2 | null {
        const direct = from.distanceTo(to);
        if (direct < SECTOR_SAMPLE_STEP * 2) {
            return null;
        }
        const sectorCache = matchAwareness.getSectorCache();
        const mid = new Vector2((from.x + to.x) / 2, (from.y + to.y) / 2);
        const dirX = to.x - from.x;
        const dirY = to.y - from.y;
        const norm = Math.max(1, Math.sqrt(dirX * dirX + dirY * dirY));
        const perp = new Vector2(-dirY / norm, dirX / norm);

        const legThreat = (a: Vector2, b: Vector2): number | null => {
            const legLength = a.distanceTo(b);
            const steps = Math.max(1, Math.floor(legLength / SECTOR_SAMPLE_STEP));
            let total = 0;
            for (let i = 0; i <= steps; i++) {
                const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
                const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
                const cell = sectorCache.getCell?.(x, y);
                if (!cell?.value) {
                    continue;
                }
                total += Math.max(0, cell.value.diffuseThreatLevel ?? 0);
            }
            return total;
        };

        let best: { point: Vector2 | null; score: number } = { point: null, score: Number.POSITIVE_INFINITY };
        // The mission's lane decides how wide the approach arcs: center goes
        // straight, flank swings the sides, backdoor loops deep around.
        for (const offset of LANE_OFFSETS[this.lane]) {
            const candidate =
                offset === 0
                    ? null
                    : new Vector2(Math.round(mid.x + perp.x * offset), Math.round(mid.y + perp.y * offset));
            if (candidate && !game.mapApi.getTile(candidate.x, candidate.y)) {
                continue;
            }
            const via = candidate ?? mid;
            const threat = (legThreat(from, via) ?? 0) + (legThreat(via, to) ?? 0);
            // Wide lanes accept longer detours (the point IS the detour).
            const lengthPenalty = this.lane === "center" ? 0.5 : 0.15;
            const extraLength = from.distanceTo(via) + via.distanceTo(to) - direct;
            const score = threat + lengthPenalty * extraLength;
            if (score < best.score) {
                best = { point: candidate, score };
            }
        }
        return best.point;
    }

    /**
     * Sends an action to the actionBatcher if and only if the action is different from the last action we submitted to it.
     * Prevents spamming redundant orders, which affects performance and can also cause the unit to sit around doing nothing.
     * Null actions (e.g. out-of-ammo units left to rearm) are skipped, and an
     * in-flight order with a cooldown suppresses replacements until it expires
     * (unless bypassCooldown, e.g. the old order's target no longer exists).
     */
    private submitActionIfNew(
        actionBatcher: ActionBatcher,
        action: BatchableAction | null,
        currentTick: number,
        bypassCooldown: boolean = false,
    ) {
        if (!action) {
            return;
        }
        const last = this.lastOrderGiven[action.unitId];
        if (last) {
            if (last.action.isSameAs(action)) {
                return;
            }
            if (
                !bypassCooldown &&
                last.action.cooldownTicks > 0 &&
                currentTick < last.tick + last.action.cooldownTicks
            ) {
                return;
            }
        }
        actionBatcher.push(action);
        this.lastOrderGiven[action.unitId] = { action, tick: currentTick };
    }
}
