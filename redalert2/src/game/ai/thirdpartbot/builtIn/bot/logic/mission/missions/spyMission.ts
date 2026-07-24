import { ObjectType, OrderType, UnitData, Vector2 } from "../../../../game-api";
import { Mission, MissionAction, disbandMission, noop, requestUnits } from "../mission";
import { MissionController } from "../missionController";
import { DebugLogger } from "../../common/utils";
import { MissionContext, SupabotContext } from "../../common/context";
import { EffectiveBotConfig } from "../../../../botProfiles";

// All six retail infiltration effects work in this engine (AgentTrait):
// battle lab = stolen-tech units, power = blackout, refinery = credit theft,
// radar = shroud reset, superweapon = timer reset, barracks/factory =
// veteran production. Target priority favors the spectacular ones.
const LAB_NAMES = new Set(["GATECH", "NATECH", "YATECH"]);
const SW_BUILDING_NAMES = new Set(["GAWEAT", "GACSPH", "NAMISL", "NAIRON", "YAPPET", "YAGNTC"]);
const RADAR_NAMES = new Set(["NARADR", "GAAIRC", "AMRADR", "NAPSIS"]);

const SPY_ORDER_INTERVAL_TICKS = 90;
const SPY_MISSION_TIMEOUT_TICKS = 5400;
const SPY_CHECK_INTERVAL_TICKS = 900;
const SPY_START_TICK = 6000;
const MAX_SPY_MISSIONS_PER_GAME = 2;

function infiltrationValue(target: UnitData): number {
    const rules: any = target.rules;
    if (!rules.spyable) {
        return 0;
    }
    const name = rules.name;
    if (LAB_NAMES.has(name)) return 100; // stolen-tech units!
    if (SW_BUILDING_NAMES.has(name)) return 80; // reset their nuke timer
    if ((rules.power ?? 0) > 0 && (target.type as any) === ObjectType.Building) return 60; // blackout
    if (rules.refinery) return 50; // steal credits
    if (RADAR_NAMES.has(name)) return 40; // reset their shroud
    return 10;
}

/**
 * A single spy slips into the enemy base: disguise as their infantry, walk
 * in, infiltrate the juiciest building. The spy is consumed on entry.
 */
export class SpyMission extends Mission {
    private lastOrderAt = 0;
    private createdAt: number | null = null;
    private disguised = false;
    private hadSpy = false;

    constructor(uniqueName: string, logger: DebugLogger) {
        super(uniqueName, logger);
    }

    public _onAiUpdate(context: MissionContext): MissionAction {
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (this.createdAt === null) {
            this.createdAt = currentTick;
        }
        if (currentTick > this.createdAt + SPY_MISSION_TIMEOUT_TICKS) {
            return disbandMission();
        }

        const spyIds = this.getUnitIds();
        if (spyIds.length === 0) {
            if (this.hadSpy) {
                // Spy entered a building (limboed/consumed) or died. Done.
                return disbandMission();
            }
            return requestUnits({ SPY: 8 });
        }
        this.hadSpy = true;
        const spy = game.getUnitData(spyIds[0]);
        if (!spy) {
            return noop();
        }
        if (currentTick < this.lastOrderAt + SPY_ORDER_INTERVAL_TICKS) {
            return noop();
        }
        this.lastOrderAt = currentTick;

        // Step 1: copy a disguise from the nearest visible enemy infantry.
        if (!this.disguised) {
            const enemyInfantry = game
                .getVisibleUnits(context.player.name, "enemy")
                .map((id) => game.getUnitData(id))
                .filter(
                    (unit): unit is UnitData =>
                        !!unit &&
                        (unit.type as any) === ObjectType.Infantry &&
                        game.getPlayerData(unit.owner)?.isCombatant,
                );
            if (enemyInfantry.length > 0) {
                let nearest = enemyInfantry[0];
                let bestDistance = Number.POSITIVE_INFINITY;
                for (const infantry of enemyInfantry) {
                    const distance = new Vector2(spy.tile.rx, spy.tile.ry).distanceTo(
                        new Vector2(infantry.tile.rx, infantry.tile.ry),
                    );
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        nearest = infantry;
                    }
                }
                // MakesDisguise warhead: "attacking" the infantry copies its look.
                context.player.actions.orderUnits(spyIds, OrderType.Attack, nearest.id);
                this.disguised = true;
                return noop();
            }
            // No infantry seen yet — proceed undisguised (dogs are a risk
            // either way; retail spies gamble too).
            this.disguised = true;
        }

        // Step 2: infiltrate the most valuable visible enemy building.
        const targets = game
            .getVisibleUnits(context.player.name, "enemy")
            .map((id) => game.getUnitData(id))
            .filter(
                (unit): unit is UnitData =>
                    !!unit && (unit.type as any) === ObjectType.Building && infiltrationValue(unit) > 0,
            );
        if (targets.length === 0) {
            return noop();
        }
        let best = targets[0];
        let bestScore = -1;
        const spyPos = new Vector2(spy.tile.rx, spy.tile.ry);
        for (const target of targets) {
            const distance = spyPos.distanceTo(new Vector2(target.tile.rx, target.tile.ry));
            const score = infiltrationValue(target) - distance * 0.2;
            if (score > bestScore) {
                bestScore = score;
                best = target;
            }
        }
        this.logger(`Spy heading for ${best.name}.`);
        context.player.actions.orderUnits(spyIds, OrderType.Occupy, best.id);
        return noop();
    }

    public getGlobalDebugText(): string | undefined {
        return "Spy infiltration";
    }

    public getPriority() {
        return 8;
    }
}

export class SpyMissionFactory {
    private lastCheckAt = 0;
    private missionsLaunched = 0;

    constructor(private config?: EffectiveBotConfig) {}

    getName(): string {
        return "SpyMissionFactory";
    }

    maybeCreateMissions(context: SupabotContext, missionController: MissionController, logger: DebugLogger): void {
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < SPY_START_TICK || currentTick < this.lastCheckAt + SPY_CHECK_INTERVAL_TICKS) {
            return;
        }
        this.lastCheckAt = currentTick;
        if (this.missionsLaunched >= MAX_SPY_MISSIONS_PER_GAME) {
            return;
        }
        // Sneaky tempos and teching doctrines run spies.
        const personality = this.config?.personalityId;
        const doctrine = this.config?.matchDoctrine?.doctrine.id;
        if (
            personality !== "opportunist" &&
            personality !== "harasser" &&
            doctrine !== "tech"
        ) {
            return;
        }
        // Allied only in practice: SPY has to be buildable.
        const buildable = context.player.production.getAvailableObjects().some((o) => o.name === "SPY");
        if (!buildable) {
            return;
        }
        if (missionController.getMissions().some((mission) => mission instanceof SpyMission)) {
            return;
        }
        this.missionsLaunched++;
        logger(`Launching spy infiltration ${this.missionsLaunched}.`);
        missionController.addMission(new SpyMission(`spy-${currentTick}`, logger));
    }
}
