import {
    ActionsApi,
    AttackState,
    BotContext,
    GameApi,
    GameMath,
    MovementZone,
    ObjectType,
    OrderType,
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

// Hard ceiling on assembly. Gathering's only other exit is maxSpread dropping
// under the gather radius, so ONE member that cannot close (stranded across
// water, frozen deployed, mind-controlled and driven away) pins the whole
// squad — and its locked units — at home for the rest of the match.
const MAX_GATHER_TICKS = 450;

// Long-range units hold a stand-off ring instead of walking into the base.
const STANDOFF_MIN_RANGE = 7;

// Approach waypoints are re-scored at most this often.
const WAYPOINT_REFRESH_TICKS = 150;
const SECTOR_SAMPLE_STEP = 8;

// Stuck detection (OpenRA: ~63 ticks of no leader progress): re-path first,
// abort the push after repeated strikes.
const STUCK_CHECK_INTERVAL_TICKS = 90;
const STUCK_STRIKES_TO_ABORT = 3;

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

    // First tick this squad entered Gathering (see MAX_GATHER_TICKS).
    private gatheringSinceTick: number | null = null;

    private approachWaypoint: Vector2 | null = null;
    private waypointPickedAt: number | null = null;

    // Leader-based movement (OpenRA): the SLOWEST ground unit leads so the
    // squad arrives as one force instead of a fast-unit dribble.
    private leaderId: number | null = null;
    // Stuck detection: leader position + target unchanged => re-path/give up.
    private lastLeaderTile: { x: number; y: number } | null = null;
    private lastProgressCheckAt = 0;
    private stuckStrikes = 0;

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
            const groundUnits = units.filter(
                (unit) =>
                    unit.rules.movementZone === MovementZone.Infantry ||
                    unit.rules.movementZone === MovementZone.Normal ||
                    unit.rules.movementZone === MovementZone.InfantryDestroyer,
            );
            const groundUnitIds = groundUnits.map((unit) => unit.id);

            // Leader election: keep the current leader while it lives; else
            // the slowest ground unit (everyone can keep up with it),
            // tie-break lowest id for determinism. Air-only squads follow
            // their slowest flyer.
            let leader = units.find((unit) => unit.id === this.leaderId) ?? null;
            if (!leader) {
                const pool = groundUnits.length > 0 ? groundUnits : units;
                leader = pool.reduce<UnitData | null>((best, unit) => {
                    if (!best) return unit;
                    const bestSpeed = (best.rules as any).speed ?? 999;
                    const unitSpeed = (unit.rules as any).speed ?? 999;
                    if (unitSpeed < bestSpeed || (unitSpeed === bestSpeed && unit.id < best.id)) {
                        return unit;
                    }
                    return best;
                }, null);
                this.leaderId = leader?.id ?? null;
            }
            const leaderPos = leader ? new Vector2(leader.tile.rx, leader.tile.ry) : null;

            if (this.state === SquadState.Gathering) {
                if (this.gatheringSinceTick === null) {
                    this.gatheringSinceTick = currentTick;
                }
                const gatherTimedOut = currentTick > this.gatheringSinceTick + MAX_GATHER_TICKS;
                const requiredGatherRadius = GameMath.sqrt(groundUnitIds.length) * GATHER_RATIO + MIN_GATHER_RADIUS;
                const gatherPoint =
                    leaderPos && game.mapApi.getTile(leaderPos.x, leaderPos.y) !== undefined ? leaderPos : centerOfMass;
                const maxSpread = leaderPos
                    ? units.reduce(
                          (max, unit) =>
                              Math.max(max, new Vector2(unit.tile.rx, unit.tile.ry).distanceTo(leaderPos)),
                          0,
                      )
                    : maxDistance;
                // Battle Fortress boarding: while the squad assembles, fill
                // open-topped transports with squad infantry — the fortress
                // fights with its passengers' guns (OpenTopped) and the foot
                // troops ride instead of straggling.
                const fortress = units.find(
                    (unit) =>
                        unit.name === "BFRT" &&
                        (unit.passengerSlotCount ?? 0) < ((unit.passengerSlotMax ?? 0) || 0),
                );
                if (fortress) {
                    const fortressPos = new Vector2(fortress.tile.rx, fortress.tile.ry);
                    const freeSlots = (fortress.passengerSlotMax ?? 0) - (fortress.passengerSlotCount ?? 0);
                    const riders = units
                        .filter(
                            (unit) =>
                                (unit.type as any) === ObjectType.Infantry &&
                                new Vector2(unit.tile.rx, unit.tile.ry).distanceTo(fortressPos) < 15,
                        )
                        .slice(0, freeSlots);
                    if (riders.length > 0) {
                        // Transport must be idle to accept passengers.
                        this.submitActionIfNew(
                            actionBatcher,
                            BatchableAction.noTarget(fortress.id, OrderType.Stop),
                            currentTick,
                        );
                        for (const rider of riders) {
                            this.submitActionIfNew(
                                actionBatcher,
                                BatchableAction.toTargetId(rider.id, OrderType.EnterTransport, fortress.id),
                                currentTick,
                            );
                        }
                    }
                }

                if (
                    !gatherTimedOut &&
                    gatherPoint &&
                    maxSpread &&
                    game.mapApi.getTile(gatherPoint.x, gatherPoint.y) !== undefined &&
                    maxSpread > requiredGatherRadius
                ) {
                    units.forEach((unit) => {
                        if (unit.id === this.leaderId) {
                            return; // the leader anchors the gather
                        }
                        this.submitActionIfNew(actionBatcher, manageMoveMicro(unit, gatherPoint), currentTick);
                    });
                } else {
                    logger(`CombatSquad ${mission.getUniqueName()} switching back to attack mode (${maxSpread})`);
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
                // Anchor on the leader (fall back to center of mass): the
                // squad's shape follows the slowest unit, not an average that
                // fast units drag forward.
                const anchor =
                    leaderPos && game.mapApi.getTile(leaderPos.x, leaderPos.y) !== undefined ? leaderPos : centerOfMass;
                const validCenter =
                    anchor && game.mapApi.getTile(anchor.x, anchor.y) !== undefined ? anchor : null;
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
                    // Guarded: stale quadtree ids resolve to undefined and
                    // must not reach the combat math.
                    .filter((unit): unit is UnitData => !!unit && !isOwnedByNeutral(unit));

                const airUnits = nearUnits.filter((unit) => unit.rules.movementZone === MovementZone.Fly);
                const squadHasAir = airUnits.length > 0 || nearUnits.some((unit) => unit.zone === ZoneType.Air);

                // OpenRA air doctrine: a strike zone is safe for our air only
                // while local AA x3 < our air count. Otherwise the flyers
                // break off (rearmable aircraft go home; the rest fall back)
                // instead of feeding the flak.
                const localAaCount = nearbyHostiles.filter(
                    (hostile) =>
                        hostile.primaryWeapon?.projectileRules.isAntiAir ||
                        hostile.secondaryWeapon?.projectileRules.isAntiAir,
                ).length;
                const airUnsafe = airUnits.length > 0 && localAaCount * 3 > airUnits.length;

                // A PURE-air squad that can't approach must end the mission,
                // not bounce between rally and target forever: break off so
                // the trigger pool learns and the units go home properly.
                if (this.canRetreat && airUnsafe && airUnits.length === nearUnits.length) {
                    logger(`CombatSquad ${mission.getUniqueName()}: air squad outmatched by AA, breaking off.`);
                    return disbandMission(SQUAD_REPELLED);
                }

                // Stuck detection: attacking, nothing to shoot, and the
                // leader hasn't moved — re-path once, then give up so the
                // factory can retarget the whole effort.
                if (nearbyHostiles.length === 0 && leaderPos) {
                    if (currentTick > this.lastProgressCheckAt + STUCK_CHECK_INTERVAL_TICKS) {
                        this.lastProgressCheckAt = currentTick;
                        if (
                            this.lastLeaderTile &&
                            this.lastLeaderTile.x === leaderPos.x &&
                            this.lastLeaderTile.y === leaderPos.y
                        ) {
                            this.stuckStrikes++;
                            this.waypointPickedAt = null; // force a fresh route
                            if (this.stuckStrikes >= STUCK_STRIKES_TO_ABORT && this.canRetreat) {
                                logger(`CombatSquad ${mission.getUniqueName()} is stuck, giving up this push.`);
                                // Undefined reason: a pathing failure is not a
                                // verdict on the composition (no weight hit).
                                return disbandMission(undefined);
                            }
                        } else {
                            this.stuckStrikes = 0;
                        }
                        this.lastLeaderTile = { x: leaderPos.x, y: leaderPos.y };
                    }
                } else {
                    this.stuckStrikes = 0;
                }

                // Threat-aware approach: when no enemies are engaged yet,
                // route the advance through the least-defended flank.
                const moveTarget = this.getApproachPoint(game, matchAwareness, validCenter, targetPoint, currentTick);

                for (const unit of nearUnits) {
                    // A dead target must not leave its air cooldown blocking
                    // the replacement order.
                    const last = this.lastOrderGiven[unit.id];
                    const lastTargetGone =
                        last?.action.targetId !== undefined && !game.getUnitData(last.action.targetId);

                    // Air discipline: flyers disengage from AA-heavy zones.
                    if (airUnsafe && unit.rules.movementZone === MovementZone.Fly) {
                        if ((unit.rules as any).airportBound) {
                            // Rearmable aircraft: leave alone when empty (the
                            // engine flies them home), else pull them back.
                            if (unit.ammo !== 0) {
                                this.submitActionIfNew(
                                    actionBatcher,
                                    manageMoveMicro(unit, this.rallyArea),
                                    currentTick,
                                    lastTargetGone,
                                );
                            }
                        } else {
                            this.submitActionIfNew(
                                actionBatcher,
                                manageMoveMicro(unit, this.rallyArea),
                                currentTick,
                                lastTargetGone,
                            );
                        }
                        continue;
                    }

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
            // Only things that actually fight count toward "losing": unarmed
            // economy structures inflated enemy power and caused false
            // Repelled retreats in enemy base assaults.
            .filter(
                (unit): unit is UnitData =>
                    !!unit &&
                    !isOwnedByNeutral(unit) &&
                    ((unit.rules as any).isSelectableCombatant || (unit.rules as any).isBaseDefense),
            );
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
