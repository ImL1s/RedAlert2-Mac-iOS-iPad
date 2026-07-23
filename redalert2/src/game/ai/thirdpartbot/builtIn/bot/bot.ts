import { ApiEventType, Bot, GameApi, ApiEvent, ObjectType, FactoryType, QueueType, OrderType } from "../game-api";

import { MissionController } from "./logic/mission/missionController";
import { QueueController } from "./logic/building/queueController";
import { MatchAwareness, MatchAwarenessImpl } from "./logic/awareness";
import { Countries, formatTimeDuration } from "./logic/common/utils";
import { IncrementalGridCache } from "./logic/map/incrementalGridCache";
import { SupabotContext } from "./logic/common/context";
import { Strategy } from "./strategy/strategy";
import { DefaultStrategy } from "./strategy/defaultStrategy";
import { BOT_PERSONALITIES, BotProfile, NORMAL_BOT_PROFILE, resolveBotConfig } from "../botProfiles";
import { BaseBuildingMission } from "./logic/mission/missions/baseBuildingMission";
import { SuperweaponOfficer } from "./logic/superweapons";
import { AttackMission, AttackMissionState } from "./logic/mission/missions/attackMission";
import { DefenceMission } from "./logic/mission/missions/defenceMission";

const DEBUG_STATE_UPDATE_INTERVAL_SECONDS = 6;

const DEBUG_MESSAGES_BUFFER_LENGTH = 20;

// Number of ticks per second at the base speed.
const NATURAL_TICK_RATE = 15;

export class BuiltInBot extends Bot {
    private tickRatio?: number;
    private queueController: QueueController;
    private tickOfLastAttackOrder: number = 0;
    private lastDeployAttemptTick: number = -9999;
    private deployAttemptCount: number = 0;

    private missionController: MissionController | null = null;
    private matchAwareness: MatchAwareness | null = null;
    private strategy: Strategy;
    private superweaponOfficer: SuperweaponOfficer | null = null;
    private lastRecallCheckAt = 0;

    // Messages to display in visualisation mode only.
    public _debugMessages: string[] = [];
    public _globalDebugText: string = "";
    public _debugGridCaches: { grid: IncrementalGridCache<any>; tag: string }[] = [];

    constructor(
        name: string,
        country: Countries,
        private tryAllyWith: string[] = [],
        private enableLogging = true,
        private profile: BotProfile = NORMAL_BOT_PROFILE,
        private strategyOverride?: Strategy,
    ) {
        super(name, country);
        this.queueController = new QueueController();
        // Placeholder until onGameStart rolls the match personality.
        this.strategy = strategyOverride ?? new DefaultStrategy();
    }

    override onGameStart(game: GameApi) {
        const gameRate = game.getTickRate();
        const botApm = this.profile.apm;
        const botRate = botApm / 60;
        this.tickRatio = Math.ceil(gameRate / botRate);

        // Roll a per-match personality with the shared game PRNG (never
        // Math.random — bots run in lockstep on every client).
        const personality = BOT_PERSONALITIES[game.generateRandomInt(0, BOT_PERSONALITIES.length - 1)];
        const config = resolveBotConfig(this.profile, personality);
        if (!this.strategyOverride) {
            this.strategy = new DefaultStrategy(config);
        }
        this.queueController.setConfig(config);
        this.superweaponOfficer = new SuperweaponOfficer(config);
        this.logBotStatus(`Difficulty "${this.profile.id}", personality "${personality.id}"`);
        console.log(`[BuiltInBot] "${this.name}" rolled personality "${personality.id}" (difficulty "${this.profile.id}")`);

        const myPlayer = game.getPlayerData(this.name);

        if (!myPlayer.country) {
            throw new Error(`Player ${this.name} has no country`);
        }
        this.missionController = new MissionController((message, sayInGame) => this.logBotStatus(message, sayInGame));

        // TODO: Strategy should have an onGameStart call which sets up the initial missions.
        this.missionController.addMission(
            new BaseBuildingMission(QueueType.Structures, (message, sayInGame) =>
                this.logBotStatus(message, sayInGame),
            config),
        );
        this.missionController.addMission(
            new BaseBuildingMission(QueueType.Armory, (message, sayInGame) => this.logBotStatus(message, sayInGame),
            config),
        );

        this.matchAwareness = new MatchAwarenessImpl(
            game,
            myPlayer,
            null,
            myPlayer.startLocation,
            (message, sayInGame) => this.logBotStatus(message, sayInGame),
            config.aggressionThreatFactor,
        );

        this._debugGridCaches = [
            { grid: this.matchAwareness.getSectorCache(), tag: "sector-cache" },
            { grid: this.matchAwareness.getBuildSpaceCache()._cache, tag: "build-cache" },
        ];

        this.matchAwareness.onGameStart(game, myPlayer);

        this.tryAllyWith
            .filter((playerName) => playerName !== this.name)
            .forEach((playerName) => this.actionsApi.toggleAlliance(playerName, true));
    }

    override onGameTick(game: GameApi) {
        if (!this.matchAwareness || !this.missionController || !this.strategy) {
            if (game.getCurrentTick() % 150 === 0) {
                console.warn(`[BuiltInBot] "${this.name}" tick skipped: awareness=${!!this.matchAwareness} missions=${!!this.missionController} strategy=${!!this.strategy}`);
            }
            return;
        }

        // Periodic heartbeat log
        if (game.getCurrentTick() % 300 === 0) {
            const myPlayer = game.getPlayerData(this.name);
            const conYards = game.getVisibleUnits(this.name, 'self', (r) => r.constructionYard);
            const allUnits = game.getVisibleUnits(this.name, 'self');
            console.log(`[BuiltInBot] "${this.name}" tick=${game.getCurrentTick()} credits=${myPlayer.credits} units=${allUnits.length} conyards=${conYards.length}`);
        }

        let threatCache = this.matchAwareness.getThreatCache();

        if ((game.getCurrentTick() / NATURAL_TICK_RATE) % DEBUG_STATE_UPDATE_INTERVAL_SECONDS === 0) {
            this.updateDebugState(game);
        }

        if (game.getCurrentTick() % this.tickRatio! === 0) {
            this.tryInitialMcvDeploy(game);

            try {
                this.matchAwareness.onAiUpdate(this.context);
                threatCache = this.matchAwareness.getThreatCache();
            } catch (err) {
                this.logger?.error?.("BuiltIn awareness update failed", err);
            }

            const fullContext: SupabotContext = {
                ...this.context,
                matchAwareness: this.matchAwareness,
            };

            // hacky resign condition
            const armyUnits = game.getVisibleUnits(this.name, "self", (r) => r.isSelectableCombatant);
            const mcvUnits = game.getVisibleUnits(
                this.name,
                "self",
                (r) => !!r.deploysInto && game.getGeneralRules().baseUnit.includes(r.name),
            );
            const productionBuildings = game.getVisibleUnits(
                this.name,
                "self",
                (r) => r.type == ObjectType.Building && r.factory != FactoryType.None,
            );
            if (armyUnits.length == 0 && productionBuildings.length == 0 && mcvUnits.length == 0) {
                this.logBotStatus(`No army or production left, quitting.`);
                this.context.player.actions.quitGame();
            }

            // Mission/strategy logic every 3 ticks.
            if (this.context.game.getCurrentTick() % 3 === 0) {
                this.missionController.onAiUpdate(fullContext);
                this.strategy = this.strategy.onAiUpdate(fullContext, this.missionController, (message, sayInGame) =>
                    this.logBotStatus(message, sayInGame),
                );
                this.superweaponOfficer?.onAiUpdate(fullContext, this.missionController, (message, sayInGame) =>
                    this.logBotStatus(message, sayInGame),
                );
                this.maybeRecallDefenders(fullContext);
            }

            const unitTypeRequests = this.missionController.getRequestedUnitTypes();

            // Queue-controller logic.
            this.queueController.onAiUpdate(fullContext, threatCache, unitTypeRequests, (message) =>
                this.logBotStatus(message),
            );
        }
    }

    /**
     * When home defence is clearly outgunned, pull the weakest attacking
     * squad back (forced disband -> automatic retreat home, where the
     * defence mission's grab picks the survivors up). Runs sparsely.
     */
    private maybeRecallDefenders(context: SupabotContext): void {
        const { game, matchAwareness } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastRecallCheckAt + 300 || !this.missionController) {
            return;
        }
        this.lastRecallCheckAt = currentTick;

        const missions = this.missionController.getMissions();
        const activeDefences = missions.filter(
            (mission): mission is DefenceMission => mission instanceof DefenceMission && mission.getPriority() > 0,
        );
        if (activeDefences.length === 0) {
            return;
        }
        const defenderCount = activeDefences.reduce((sum, mission) => sum + mission.getUnitIds().length, 0);
        // Count hostiles around whichever defended point (main base OR
        // expansion) is under the heaviest pressure.
        let hostilesNearBase = 0;
        for (const defence of activeDefences) {
            const hostiles = matchAwareness.getHostilesNearPoint2d(defence.getDefendedPoint(), 25).length;
            hostilesNearBase = Math.max(hostilesNearBase, hostiles);
        }
        if (hostilesNearBase <= Math.max(3, defenderCount * 1.5)) {
            return;
        }

        const attacking = missions.filter(
            (mission): mission is AttackMission =>
                mission instanceof AttackMission && mission.getState() === AttackMissionState.Attacking,
        );
        if (attacking.length === 0) {
            return;
        }
        const weakest = attacking.reduce((a, b) => (a.getUnitIds().length <= b.getUnitIds().length ? a : b));
        this.logBotStatus(
            `Base under heavy attack (${hostilesNearBase} hostiles vs ${defenderCount} defenders) — recalling ${weakest.getUniqueName()}.`,
        );
        this.missionController.disbandMission(weakest.getUniqueName());
    }

    private tryInitialMcvDeploy(game: GameApi): void {
        const hasConyard = game.getVisibleUnits(this.name, "self", (r) => r.constructionYard).length > 0;
        if (hasConyard) {
            this.deployAttemptCount = 0;
            return;
        }

        if (game.getCurrentTick() < this.lastDeployAttemptTick + 30) {
            return;
        }

        const mcvUnits = game.getVisibleUnits(
            this.name,
            "self",
            (r) => !!r.deploysInto && game.getGeneralRules().baseUnit.includes(r.name),
        );

        if (mcvUnits.length === 0) {
            return;
        }

        this.deployAttemptCount++;

        if (this.deployAttemptCount > 5) {
            // Deploy keeps failing — current position is blocked, find a clear spot
            const mcvData = game.getUnitData(mcvUnits[0]);
            if (mcvData?.tile && mcvData.rules?.deploysInto) {
                const cx = mcvData.tile.rx;
                const cy = mcvData.tile.ry;
                for (let radius = 2; radius <= 10; radius++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        for (let dy = -radius; dy <= radius; dy++) {
                            if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                            try {
                                if (game.canPlaceBuilding(this.name, mcvData.rules.deploysInto, { rx: cx + dx, ry: cy + dy })) {
                                    this.actionsApi.orderUnits([mcvUnits[0]], OrderType.Move, cx + dx, cy + dy);
                                    this.deployAttemptCount = 0;
                                    this.lastDeployAttemptTick = game.getCurrentTick();
                                    return;
                                }
                            } catch (_e) { /* skip */ }
                        }
                    }
                }
            }
            // Nothing found, scatter
            this.actionsApi.orderUnits([mcvUnits[0]], OrderType.Scatter);
            this.deployAttemptCount = 0;
        } else {
            this.actionsApi.orderUnits([mcvUnits[0]], OrderType.DeploySelected);
        }
        this.lastDeployAttemptTick = game.getCurrentTick();
    }

    private getHumanTimestamp(game: GameApi) {
        return formatTimeDuration(game.getCurrentTick() / NATURAL_TICK_RATE);
    }

    private logBotStatus(message: string, sayInGame: boolean = false) {
        if (!this.enableLogging) {
            return;
        }
        this.logger.info(message);
        const timestamp = this.getHumanTimestamp(this.gameApi);
        if (sayInGame) {
            this.actionsApi.sayAll(`${timestamp}: ${message}`);
        }
        this.pushDebugMessage(`${timestamp}: ${message}`);
    }

    private updateDebugState(game: GameApi) {
        if (!this.getDebugMode() || !this.missionController) {
            return;
        }
        // Update the global debug text.
        const myPlayer = game.getPlayerData(this.name);
        const harvesters = game.getVisibleUnits(this.name, "self", (r) => r.harvester).length;

        let globalDebugText = `Cash: ${myPlayer.credits} | Harvesters: ${harvesters}\n`;
        globalDebugText += this.queueController.getGlobalDebugText(this.gameApi, this.productionApi);
        globalDebugText += this.missionController.getGlobalDebugText(this.gameApi);
        globalDebugText += this.matchAwareness?.getGlobalDebugText();

        this.missionController.updateDebugText(this.actionsApi);

        // Tag enemy units with IDs
        game.getVisibleUnits(this.name, "enemy").forEach((unitId) => {
            this.actionsApi.setUnitDebugText(unitId, unitId.toString());
        });

        this.actionsApi.setGlobalDebugText(globalDebugText);
        this._globalDebugText = globalDebugText;
    }

    override onGameEvent(ev: ApiEvent) {
        switch (ev.type) {
            case ApiEventType.ObjectDestroy: {
                // Add to the stalemate detection.
                if (ev.attackerInfo?.playerName == this.name) {
                    this.tickOfLastAttackOrder += (this.gameApi.getCurrentTick() - this.tickOfLastAttackOrder) / 2;
                }
                break;
            }
            default:
                break;
        }
    }

    protected pushDebugMessage(message: string) {
        if (this._debugMessages.length + 1 > DEBUG_MESSAGES_BUFFER_LENGTH) {
            this._debugMessages.shift();
        }
        this._debugMessages.push(message);
    }
}
