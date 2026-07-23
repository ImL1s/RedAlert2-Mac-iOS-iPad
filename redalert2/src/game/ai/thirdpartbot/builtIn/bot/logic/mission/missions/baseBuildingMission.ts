import { GameApi, PlayerData, QueueStatus, QueueType, TechnoRules } from "../../../../game-api";
import { MissionContext } from "../../common/context";
import { DebugLogger, maxBy } from "../../common/utils";
import { buildStructureAtLocation, Mission, MissionAction, noop } from "../mission";
import { GlobalThreat } from "../../threat/threat";
import {
    BUILDING_NAME_TO_RULES,
    DEFAULT_BUILDING_PRIORITY,
    getDefaultPlacementLocation,
} from "../../building/buildingRules";
import { AntiGroundStaticDefence } from "../../building/antiGroundStaticDefence";
import { AntiAirStaticDefence } from "../../building/antiAirStaticDefence";
import { queueTypeToName } from "../../building/queueController";
import { EffectiveBotConfig } from "../../../../botProfiles";

// Tier/tech unlock structures: a teching personality rushes these, a rusher
// deprioritizes them. Superweapon buildings ride the same knob.
const TECH_STRUCTURE_NAMES = new Set([
    "GATECH", "NATECH", "YATECH",
    "GAAIRC", "AMRADR", "NARADR", "NAPSIS", "NACLON",
    "GAWEAT", "GACSPH", "NAMISL", "NAIRON", "YAPPET", "YAGNTC",
    "GASPYSAT", "GAOREP", "GAGAP", "GAROBO",
]);

// Production buildings that a cash-rich bot doubles down on (OpenRA's
// "spend as fast as we earn" rule): parallel factories instead of a bank.
const PRODUCTION_STRUCTURE_NAMES = new Set([
    "GAWEAP", "NAWEAP", "YAWEAP",
    "GAPILE", "NAHAND", "YABRCK",
]);
const CASH_RICH_THRESHOLD = 5000;

// Retail difficulty texture (probed rulesmd): easy AIs are nearly undefended
// (6 statics vs 25 on brutal), run leaner economies (AIExtraRefineries=2,1,0;
// AISlaveMinerNumber=4,3,2).
const DEFENSE_CAP_BY_DIFFICULTY: Record<string, number> = { brutal: 25, normal: 20, easy: 6 };
const EXTRA_REFINERIES_BY_DIFFICULTY: Record<string, number> = { brutal: 2, normal: 1, easy: 0 };
const SLAVE_MINERS_BY_DIFFICULTY: Record<string, number> = { brutal: 4, normal: 3, easy: 2 };
const REFINERY_NAMES = new Set(["GAREFN", "NAREFN"]);
const SLAVE_MINER_NAME = "YAREFN";

// Legacy mission encompassing the old "build queue" logic.
export class BaseBuildingMission extends Mission {
    constructor(
        private queueType: QueueType,
        logger: DebugLogger,
        private config?: EffectiveBotConfig,
    ) {
        super(`building-mission-${queueTypeToName(queueType)}`, logger);
    }

    _onAiUpdate(context: MissionContext): MissionAction {
        const options = context.player.production.getAvailableObjects(this.queueType);
        const playerData = context.game.getPlayerData(context.player.name);

        // Structure queues hold a single item, so while something is in
        // production the "best available" recomputation flips to the next-best
        // building. Committing to a new choice every tick makes the queue
        // controller dequeue the in-progress item and the bot oscillates
        // forever without completing anything. Stick with the current item
        // until it is placed.
        const queueData = context.player.production.getQueueData(this.queueType);
        if (queueData.status !== QueueStatus.Idle && queueData.items.length > 0) {
            const current = queueData.items[0].rules;
            const location = this.getBestLocationForStructure(context.game, playerData, current);
            if (location) {
                const priority = Math.max(
                    1,
                    this.getPriorityForBuildingOption(
                        current,
                        context.game,
                        playerData,
                        context.matchAwareness.getThreatCache(),
                    ),
                );
                return buildStructureAtLocation(current.name, priority, location.rx, location.ry);
            }
            return noop();
        }

        if (options.length === 0) {
            return noop();
        }

        const { game, matchAwareness } = context;
        const threatCache = matchAwareness.getThreatCache();

        const optionWithPriority = options.map((option) => {
            return {
                option,
                priority: this.getPriorityForBuildingOption(option, game, playerData, threatCache),
            };
        });

        const bestOption = maxBy(optionWithPriority, (option) => option.priority);

        if (!bestOption || bestOption.priority === 0) {
            return noop();
        }

        const bestLocation = this.getBestLocationForStructure(game, playerData, bestOption.option);

        if (!bestLocation) {
            return noop();
        }

        return buildStructureAtLocation(bestOption.option.name, bestOption.priority, bestLocation.rx, bestLocation.ry);
    }

    getGlobalDebugText(): string | undefined {
        return undefined;
    }

    getPriority(): number {
        return 0;
    }

    private getPriorityForBuildingOption(
        option: TechnoRules,
        game: GameApi,
        playerStatus: PlayerData,
        threatCache: GlobalThreat | null,
    ) {
        if (BUILDING_NAME_TO_RULES.has(option.name)) {
            let logic = BUILDING_NAME_TO_RULES.get(option.name)!;
            let priority = logic.getPriority(game, playerStatus, option, threatCache);
            // Personality flavor: turtles fortify and tech, rushers skip both.
            if (this.config && priority > 0) {
                if (logic instanceof AntiGroundStaticDefence || logic instanceof AntiAirStaticDefence) {
                    priority *= this.config.defensePriorityMultiplier * (this.config.matchDoctrine?.doctrine.defensePriorityMultiplier ?? 1);
                    // Retail per-difficulty static-defense budget.
                    const defenseCap = DEFENSE_CAP_BY_DIFFICULTY[this.config.difficultyId] ?? 20;
                    const owned = game.getVisibleUnits(playerStatus.name, "self", (r) => (r as any).isBaseDefense).length;
                    if (owned >= defenseCap) {
                        priority = 0;
                    }
                } else if (REFINERY_NAMES.has(option.name)) {
                    // Retail AIExtraRefineries: 1 + {2,1,0} by difficulty.
                    const refineryCap = 1 + (EXTRA_REFINERIES_BY_DIFFICULTY[this.config.difficultyId] ?? 1);
                    const owned = game.getVisibleUnits(playerStatus.name, "self", (r) => r.name === option.name).length;
                    if (owned >= refineryCap) {
                        priority = 0;
                    }
                } else if (option.name === SLAVE_MINER_NAME) {
                    // Retail AISlaveMinerNumber: 4/3/2 by difficulty.
                    const minerCap = SLAVE_MINERS_BY_DIFFICULTY[this.config.difficultyId] ?? 3;
                    const owned = game.getVisibleUnits(playerStatus.name, "self", (r) => r.name === SLAVE_MINER_NAME).length;
                    if (owned >= minerCap) {
                        priority = 0;
                    }
                } else if (TECH_STRUCTURE_NAMES.has(option.name)) {
                    priority *= this.config.techPriorityMultiplier * (this.config.matchDoctrine?.doctrine.techPriorityMultiplier ?? 1);
                }
                // Cash-rich: convert the bank into parallel production.
                if (PRODUCTION_STRUCTURE_NAMES.has(option.name) && playerStatus.credits > CASH_RICH_THRESHOLD) {
                    priority *= 2;
                }
                // Opening book shapes the first minutes of the match.
                const doctrine = this.config.matchDoctrine;
                if (doctrine && game.getCurrentTick() < doctrine.openingUntilTick) {
                    priority *= doctrine.openingMultipliers[option.name] ?? 1;
                }
            }
            return priority;
        } else {
            // Fallback priority when there are no rules.
            return (
                DEFAULT_BUILDING_PRIORITY - game.getVisibleUnits(playerStatus.name, "self", (r) => r == option).length
            );
        }
    }

    private getBestLocationForStructure(
        game: GameApi,
        playerData: PlayerData,
        objectReady: TechnoRules,
    ): { rx: number; ry: number } | undefined {
        if (BUILDING_NAME_TO_RULES.has(objectReady.name)) {
            let logic = BUILDING_NAME_TO_RULES.get(objectReady.name)!;
            return logic.getPlacementLocation(game, playerData, objectReady);
        } else {
            // fallback placement logic
            return getDefaultPlacementLocation(game, playerData, playerData.startLocation, objectReady);
        }
    }

    private handleBuildingReady(context: MissionContext, objectReady: TechnoRules) {
        const { game, player } = context;
        const { actions: actionsApi } = player;
        const playerData = game.getPlayerData(player.name);
        let location: { rx: number; ry: number } | undefined = this.getBestLocationForStructure(
            game,
            playerData,
            objectReady,
        );
        if (location !== undefined) {
            this.logger(
                `Completed (${queueTypeToName(this.queueType)}): ${objectReady.name}, placing at ${location.rx},${
                    location.ry
                }`,
            );
            actionsApi.placeBuilding(objectReady.name, location.rx, location.ry);
        } else {
            this.logger(`Completed (${queueTypeToName(this.queueType)}): ${objectReady.name} but nowhere to place it`);
        }
    }
}
