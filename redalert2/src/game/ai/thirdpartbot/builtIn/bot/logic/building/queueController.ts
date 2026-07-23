import {
    ActionsApi,
    GameApi,
    MovementZone,
    ObjectType,
    PlayerData,
    ProductionApi,
    QueueStatus,
    QueueType,
    TechnoRules,
    Vector2,
} from "../../../game-api";
import { GlobalThreat } from "../threat/threat";
import { BUILDING_NAME_TO_RULES, TechnoRulesWithPriority, getDefaultPlacementLocation } from "./buildingRules";
import { BasicGroundUnit } from "./basicGroundUnit";
import { BasicAirUnit } from "./basicAirUnit";
import { SupabotContext } from "../common/context";
import { UnitRequest } from "../mission/missionController";
import { EffectiveBotConfig } from "../../../botProfiles";

export const QUEUES = [
    QueueType.Structures,
    QueueType.Armory,
    QueueType.Infantry,
    QueueType.Vehicles,
    QueueType.Aircrafts,
    QueueType.Ships,
];

function isBuildingQueue(queueType: QueueType): boolean {
    return queueType === QueueType.Structures || queueType === QueueType.Armory;
}

export const queueTypeToName = (queue: QueueType) => {
    switch (queue) {
        case QueueType.Structures:
            return "Structures";
        case QueueType.Armory:
            return "Armory";
        case QueueType.Infantry:
            return "Infantry";
        case QueueType.Vehicles:
            return "Vehicles";
        case QueueType.Aircrafts:
            return "Aircrafts";
        case QueueType.Ships:
            return "Ships";
        default:
            return "Unknown";
    }
};

type QueueState = {
    queue: QueueType;
    /** sorted in ascending order (last item is the topItem) */
    items: TechnoRulesWithPriority[];
    topItem: TechnoRulesWithPriority | undefined;
};

// Retail [AI] CreditReserve=100: don't wrench-repair below this bank
// (conyard exempt — always worth repairing). Check cadence per difficulty
// from retail RepairDelay (.02/.02/.05 min): easy bases smolder longer.
const REPAIR_CREDIT_FLOOR = 100;
const REPAIR_CHECK_INTERVAL_BY_DIFFICULTY: Record<string, number> = {
    brutal: 18,
    normal: 18,
    easy: 45,
};
const PLACEMENT_FAILURE_RETRY_THRESHOLD = 3;
const PLACEMENT_FAILURE_CANCEL_THRESHOLD = 10;

// Unit queues that background production keeps busy.
const BACKGROUND_PRODUCTION_QUEUES = [QueueType.Infantry, QueueType.Vehicles, QueueType.Aircrafts];

// Counter-composition: when the enemy census skews air/armor/infantry, these
// names get a production boost (side-agnostic sets; unavailable names are
// simply never candidates).
const AA_CAPABLE_NAMES = new Set(["GGI", "NASAM", "JUMPJET", "FV", "HTK", "FLAKT", "YTNK", "GATT"]);
const ANTI_ARMOR_NAMES = new Set(["TNKD", "MGTK", "APOC", "DRON", "TTNK", "SHK", "BRUTE", "TELE", "SREF", "V3"]);
const ANTI_INFANTRY_NAMES = new Set(["DESO", "VIRUS", "SNIPE", "MTNK", "HTNK", "LTNK", "SCHP", "GHOST"]);
const CENSUS_INTERVAL_TICKS = 450;

export class QueueController {
    private queueStates: QueueState[] = [];
    private lastRepairCheckAt = 0;
    private placementFailures: Map<string, number> = new Map();
    private config?: EffectiveBotConfig;
    private lastCensusAt = -CENSUS_INTERVAL_TICKS;
    private counterMultipliers: { aa: number; antiArmor: number; antiInfantry: number } = {
        aa: 1,
        antiArmor: 1,
        antiInfantry: 1,
    };
    // Retail AIForcePredictionFudge: how badly this difficulty misjudges the
    // enemy army when picking counters (easy bots build the wrong things).
    private static readonly CENSUS_FUDGE_BY_DIFFICULTY: Record<string, number> = {
        brutal: 5,
        normal: 25,
        easy: 80,
    };

    constructor() {}

    public setConfig(config: EffectiveBotConfig): void {
        this.config = config;
    }

    /**
     * Counter-composition: census the visible enemy army and shift background
     * production toward its counters. This is what makes a rematch diverge —
     * the bot answers what YOU are doing.
     */
    private updateEnemyCensus(context: SupabotContext): void {
        const { game, player } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastCensusAt + CENSUS_INTERVAL_TICKS) {
            return;
        }
        this.lastCensusAt = currentTick;
        let air = 0;
        let armor = 0;
        let infantry = 0;
        let total = 0;
        for (const id of game.getVisibleUnits(player.name, "enemy")) {
            const data = game.getGameObjectData(id);
            const rules: any = data?.rules;
            if (!rules?.isSelectableCombatant) {
                continue;
            }
            total++;
            if (rules.movementZone === MovementZone.Fly) {
                air++;
            } else if ((data!.type as any) === ObjectType.Vehicle) {
                armor++;
            } else if ((data!.type as any) === ObjectType.Infantry) {
                infantry++;
            }
        }
        if (total < 5) {
            this.counterMultipliers = { aa: 1, antiArmor: 1, antiInfantry: 1 };
            return;
        }
        // Fudge the appraisal per difficulty (retail AIForcePredictionFudge):
        // easy bots misjudge your composition by up to +/-80% and answer with
        // the wrong counters; brutal reads you nearly perfectly.
        const fudge = QueueController.CENSUS_FUDGE_BY_DIFFICULTY[this.config?.difficultyId ?? "normal"] ?? 25;
        const misjudge = (fraction: number): number => {
            const jitter = game.generateRandomInt(-fudge, fudge) / 100;
            return Math.max(0, fraction * (1 + jitter));
        };
        const airFrac = misjudge(air / total);
        const armorFrac = misjudge(armor / total);
        const infFrac = misjudge(infantry / total);
        this.counterMultipliers = {
            aa: Math.min(2.5, 1 + airFrac * 3),
            antiArmor: Math.min(2, 1 + armorFrac * 1.2),
            antiInfantry: Math.min(2, 1 + infFrac * 1.2),
        };
    }

    public onAiUpdate(
        context: SupabotContext,
        threatCache: GlobalThreat | null,
        unitTypeRequests: Map<string, UnitRequest>,
        logger: (message: string) => void,
    ) {
        const { game, player } = context;
        const { production: productionApi, actions: actionsApi } = player;
        const playerData = game.getPlayerData(player.name);
        this.queueStates = QUEUES.map((queueType) => {
            const options = productionApi.getAvailableObjects(queueType);
            const items = QueueController.getPrioritiesForBuildingOptions(options, unitTypeRequests);
            const topItem = items.length > 0 ? items[items.length - 1] : undefined;
            return {
                queue: queueType,
                items,
                // only if the top item has a  priority above zero
                topItem: topItem && topItem.priority > 0 ? topItem : undefined,
            };
        });
        const totalWeightAcrossQueues = this.queueStates
            .map((decision) => decision.topItem?.priority!)
            .reduce((pV, cV) => pV + cV, 0);
        const totalCostAcrossQueues = this.queueStates
            .map((decision) => decision.topItem?.unit.cost!)
            .reduce((pV, cV) => pV + cV, 0);

        this.queueStates.forEach((decision) => {
            this.updateBuildQueue(
                game,
                productionApi,
                actionsApi,
                playerData,
                threatCache,
                unitTypeRequests,
                decision.queue,
                decision.topItem,
                totalWeightAcrossQueues,
                totalCostAcrossQueues,
                logger,
            );
        });

        // Background army production: never let a factory sit idle while we
        // can afford units. Missions still outprioritize (their requests own
        // the topItem slot); this fills the gaps so a standing army is always
        // growing and attack squads can assemble from free units instantly.
        this.updateBackgroundProduction(context, threatCache, logger);

        // Repair with retail economics: $100 floor (conyard exempt) and a
        // per-difficulty cadence.
        const repairInterval = REPAIR_CHECK_INTERVAL_BY_DIFFICULTY[this.config?.difficultyId ?? "normal"] ?? 30;
        if (playerData.credits > 0 && game.getCurrentTick() > this.lastRepairCheckAt + repairInterval) {
            game.getVisibleUnits(playerData.name, "self", (r) => r.repairable).forEach((unitId) => {
                const unit = game.getUnitData(unitId);
                if (!unit || !unit.hitPoints || !unit.maxHitPoints || unit.hasWrenchRepair) {
                    return;
                }
                if (playerData.credits <= REPAIR_CREDIT_FLOOR && !(unit.rules as any).constructionYard) {
                    return;
                }
                if (unit.hitPoints < unit.maxHitPoints) {
                    actionsApi.toggleRepairWrench(unitId);
                }
            });
            this.lastRepairCheckAt = game.getCurrentTick();
        }
    }

    /**
     * Queues a personality-weighted unit on any idle unit queue that has no
     * pending mission request, as long as credits stay above the structure
     * reserve. Harvester shortfalls take precedence (economy first).
     */
    private updateBackgroundProduction(
        context: SupabotContext,
        threatCache: GlobalThreat | null,
        logger: (message: string) => void,
    ): void {
        const { game, player } = context;
        const { production: productionApi, actions: actionsApi } = player;
        const playerData = game.getPlayerData(player.name);
        const reserve = this.config?.unitReserveCredits ?? 600;
        if (playerData.credits <= reserve) {
            return;
        }
        this.updateEnemyCensus(context);
        // Doctrine-merged weights (personality x doctrine x country x jitter)
        // when rolled; raw personality weights otherwise.
        const nameWeights = this.config?.matchDoctrine?.mergedUnitWeights ?? this.config?.unitNameWeights ?? {};
        const counters = this.counterMultipliers;
        const counterWeight = (name: string): number => {
            let multiplier = 1;
            if (AA_CAPABLE_NAMES.has(name)) multiplier *= counters.aa;
            if (ANTI_ARMOR_NAMES.has(name)) multiplier *= counters.antiArmor;
            if (ANTI_INFANTRY_NAMES.has(name)) multiplier *= counters.antiInfantry;
            return multiplier;
        };

        for (const queueType of BACKGROUND_PRODUCTION_QUEUES) {
            const queueData = productionApi.getQueueData(queueType);
            if (queueData.status !== QueueStatus.Idle) {
                continue;
            }
            const queueState = this.queueStates.find((state) => state.queue === queueType);
            if (queueState?.topItem) {
                // A mission requested something here; the normal flow handles it.
                continue;
            }
            const options = productionApi.getAvailableObjects(queueType);
            const candidates: { unit: TechnoRules; weight: number }[] = [];
            let explicitBest: { unit: TechnoRules; weight: number } | null = null;
            for (const option of options) {
                const rules = BUILDING_NAME_TO_RULES.get(option.name);
                if (!rules) {
                    continue;
                }
                // Explicit priorities (harvesters when the eco is short) win
                // outright — economy before army.
                const explicit = rules.getPriority(game, playerData, option, threatCache);
                if (explicit > 0) {
                    if (!explicitBest || explicit > explicitBest.weight) {
                        explicitBest = { unit: option, weight: explicit };
                    }
                    continue;
                }
                if (rules instanceof BasicGroundUnit || rules instanceof BasicAirUnit) {
                    const weight =
                        rules.getBackgroundWeight() * (nameWeights[option.name] ?? 1) * counterWeight(option.name);
                    if (weight > 0) {
                        candidates.push({ unit: option, weight });
                    }
                }
            }
            if (explicitBest) {
                actionsApi.queueForProduction(queueType, explicitBest.unit.name, explicitBest.unit.type, 1);
                continue;
            }
            if (candidates.length === 0) {
                continue;
            }
            const weights = candidates.map((c) => Math.max(1, Math.round(c.weight * 10)));
            const total = weights.reduce((sum, w) => sum + w, 0);
            let roll = game.generateRandomInt(0, total - 1);
            let picked = candidates[candidates.length - 1].unit;
            for (let i = 0; i < candidates.length; i++) {
                roll -= weights[i];
                if (roll < 0) {
                    picked = candidates[i].unit;
                    break;
                }
            }
            actionsApi.queueForProduction(queueType, picked.name, picked.type, 1);
        }
    }

    private updateBuildQueue(
        game: GameApi,
        productionApi: ProductionApi,
        actionsApi: ActionsApi,
        playerData: PlayerData,
        threatCache: GlobalThreat | null,
        unitTypeRequests: Map<string, UnitRequest>,
        queueType: QueueType,
        decision: TechnoRulesWithPriority | undefined,
        totalWeightAcrossQueues: number,
        totalCostAcrossQueues: number,
        logger: (message: string) => void,
    ): void {
        const myCredits = playerData.credits;

        const queueData = productionApi.getQueueData(queueType);
        if (queueData.status == QueueStatus.Idle) {
            // Start building the decided item.
            if (decision !== undefined) {
                logger(`Decision (${queueTypeToName(queueType)}): ${decision.unit.name}`);
                actionsApi.queueForProduction(queueType, decision.unit.name, decision.unit.type, 1);
            }
        } else if (queueData.status == QueueStatus.Ready && queueData.items.length > 0) {
            if (isBuildingQueue(queueType)) {
                const readyUnit = queueData.items[0].rules;
                const currentRequest = unitTypeRequests.get(readyUnit.name);
                if (!currentRequest) {
                    // No one is requesting this anymore, cancel
                    logger(`Cancelling ready ${readyUnit.name} because no one is requesting anymore`);
                    actionsApi.unqueueFromProduction(queueType, readyUnit.name, readyUnit.type, 1);
                    this.placementFailures.delete(readyUnit.name);
                    return;
                }
                if (!currentRequest.specificLocation) {
                    // No one is requesting this anymore, cancel
                    logger(`Cancelling ready ${readyUnit.name} because location is unspecified`);
                    actionsApi.unqueueFromProduction(queueType, readyUnit.name, readyUnit.type, 1);
                    this.placementFailures.delete(readyUnit.name);
                    return;
                }

                const failures = this.placementFailures.get(readyUnit.name) ?? 0;

                // If too many failures, cancel the building to unblock the queue
                if (failures >= PLACEMENT_FAILURE_CANCEL_THRESHOLD) {
                    logger(`Cancelling ready ${readyUnit.name} after ${failures} placement failures`);
                    actionsApi.unqueueFromProduction(queueType, readyUnit.name, readyUnit.type, 1);
                    this.placementFailures.delete(readyUnit.name);
                    return;
                }

                let placeX = currentRequest.specificLocation.x;
                let placeY = currentRequest.specificLocation.y;

                // Check if the suggested location is valid
                const canPlace = game.canPlaceBuilding(playerData.name, readyUnit.name, { rx: placeX, ry: placeY });

                if (!canPlace) {
                    this.placementFailures.set(readyUnit.name, failures + 1);

                    // After threshold, try to find an alternative placement location
                    if (failures >= PLACEMENT_FAILURE_RETRY_THRESHOLD) {
                        const conYards = game.getVisibleUnits(playerData.name, "self", (r: TechnoRules) => r.constructionYard);
                        if (conYards.length > 0) {
                            const conYardData = game.getUnitData(conYards[0]);
                            if (conYardData?.tile) {
                                const altLocation = getDefaultPlacementLocation(
                                    game,
                                    playerData,
                                    new Vector2(conYardData.tile.rx, conYardData.tile.ry),
                                    readyUnit,
                                );
                                if (altLocation) {
                                    logger(`Retrying ${readyUnit.name} at alternative location (${altLocation.rx},${altLocation.ry}) after ${failures} failures`);
                                    actionsApi.placeBuilding(readyUnit.name, altLocation.rx, altLocation.ry);
                                    this.placementFailures.delete(readyUnit.name);
                                    return;
                                }
                            }
                        }
                        logger(`Cannot find alternative location for ${readyUnit.name} (failure #${failures + 1})`);
                    }
                    return;
                }

                // Location is valid, place the building
                actionsApi.placeBuilding(readyUnit.name, placeX, placeY);
                this.placementFailures.delete(readyUnit.name);
            }
        } else if (queueData.status == QueueStatus.Active && queueData.items.length > 0 && decision != null) {
            // Consider cancelling if something else is significantly higher priority than what is currently being produced.

            const currentProduction = queueData.items[0].rules;
            if (decision.unit != currentProduction) {
                // Changing our mind. Only preempt an item that is still actively
                // requested; a missing request means the requesting mission moved
                // on for this tick, and treating that as priority 0 causes an
                // endless queue/dequeue oscillation that stalls all production.
                const currentRequest = unitTypeRequests.get(currentProduction.name);
                if (!currentRequest) {
                    return;
                }
                const currentItemPriority = currentRequest.priority;
                const newItemPriority = decision.priority;
                if (newItemPriority > currentItemPriority * 2) {
                    logger(
                        `Dequeueing queue ${queueTypeToName(queueData.type)} unit ${currentProduction.name} because ${
                            decision.unit.name
                        } has 2x higher priority.`,
                    );
                    actionsApi.unqueueFromProduction(queueData.type, currentProduction.name, currentProduction.type, 1);
                }
            } else {
                // Not changing our mind, but maybe other queues are more important for now.
                // Only building queues participate in the pause-to-save-money
                // dance: pausing a unit queue also blocks background army
                // production (it skips non-Idle queues), and low-priority
                // reinforcement requests would stall it for minutes.
                if (
                    isBuildingQueue(queueType) &&
                    totalCostAcrossQueues > myCredits &&
                    decision.priority < totalWeightAcrossQueues * 0.25
                ) {
                    logger(
                        `Pausing queue ${queueTypeToName(queueData.type)} because weight is low (${
                            decision.priority
                        }/${totalWeightAcrossQueues})`,
                    );
                    actionsApi.pauseProduction(queueData.type);
                }
            }
        } else if (queueData.status == QueueStatus.OnHold) {
            // Unit queues never stay paused (see above); building queues
            // resume when priority or credits justify it.
            if (!isBuildingQueue(queueType)) {
                logger(`Resuming unit queue ${queueTypeToName(queueData.type)}`);
                actionsApi.resumeProduction(queueData.type);
            } else if (myCredits >= totalCostAcrossQueues) {
                logger(`Resuming queue ${queueTypeToName(queueData.type)} because credits are high`);
                actionsApi.resumeProduction(queueData.type);
            } else if (decision && decision.priority >= totalWeightAcrossQueues * 0.25) {
                logger(
                    `Resuming queue ${queueTypeToName(queueData.type)} because weight is high (${
                        decision.priority
                    }/${totalWeightAcrossQueues})`,
                );
                actionsApi.resumeProduction(queueData.type);
            }
        }
    }

    private static getPrioritiesForBuildingOptions(
        options: TechnoRules[],
        unitTypeRequests: Map<string, UnitRequest>,
    ): TechnoRulesWithPriority[] {
        let priorityQueue: TechnoRulesWithPriority[] = [];
        options.forEach((option) => {
            const priority = unitTypeRequests.get(option.name)?.priority ?? 0;
            if (priority > 0) {
                priorityQueue.push({ unit: option, priority });
            }
        });

        priorityQueue = priorityQueue.sort((a, b) => a.priority - b.priority);
        return priorityQueue;
    }

    public getGlobalDebugText(gameApi: GameApi, productionApi: ProductionApi) {
        const productionState = QUEUES.reduce((prev, queueType) => {
            if (productionApi.getQueueData(queueType).size === 0) {
                return prev;
            }
            const paused = productionApi.getQueueData(queueType).status === QueueStatus.OnHold;
            return (
                prev +
                " [" +
                queueTypeToName(queueType) +
                (paused ? " PAUSED" : "") +
                ": " +
                productionApi
                    .getQueueData(queueType)
                    .items.map((item) => item.rules.name + (item.quantity > 1 ? "x" + item.quantity : "")) +
                "]"
            );
        }, "");

        const queueStates = this.queueStates
            .filter((queueState) => queueState.items.length > 0)
            .map((queueState) => {
                const queueString = queueState.items
                    .map((item) => item.unit.name + "(" + Math.round(item.priority * 10) / 10 + ")")
                    .join(", ");
                return `${queueTypeToName(queueState.queue)} Prios: ${queueString}\n`;
            })
            .join("");

        return `Production: ${productionState}\n${queueStates}`;
    }
}
