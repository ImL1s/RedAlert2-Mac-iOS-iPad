import { GameApi, OrderType, Vector2 } from "../../../../game-api";
import { Mission, MissionAction, disbandMission, noop, requestUnits } from "../mission";
import { MissionController } from "../missionController";
import { DebugLogger, toVector2 } from "../../common/utils";
import { MissionContext, SupabotContext } from "../../common/context";
import { EffectiveBotConfig } from "../../../../botProfiles";

// Infantry we are willing to spend on a garrison, by side (any buildable
// subset works — production requests ignore unavailable names).
const GARRISON_INFANTRY_PRIORITIES: Record<string, number> = { E1: 6, GGI: 5, E2: 6, INIT: 6 };

const GARRISON_ORDER_INTERVAL_TICKS = 90;
const GARRISON_MISSION_TIMEOUT_TICKS = 2700;
const MAX_ACTIVE_GARRISON_MISSIONS = 2;
const GARRISON_CHECK_INTERVAL_TICKS = 600;
// Only garrison buildings roughly between our base and the front.
const GARRISON_SEARCH_RADIUS = 35;

/**
 * Urban-combat flavor: claim a civilian building on the approach lane and
 * fill it with infantry. First entrant claims the structure for us; the
 * engine then arms it with the occupants' weapons.
 */
export class GarrisonMission extends Mission {
    private lastOrderAt = 0;
    private createdAt: number | null = null;
    private neutralOwner: string | null = null;

    constructor(
        uniqueName: string,
        private buildingId: number,
        private desiredCount: number,
        logger: DebugLogger,
    ) {
        super(uniqueName, logger);
    }

    public _onAiUpdate(context: MissionContext): MissionAction {
        const { game } = context;
        const currentTick = game.getCurrentTick();
        if (this.createdAt === null) {
            this.createdAt = currentTick;
        }
        if (currentTick > this.createdAt + GARRISON_MISSION_TIMEOUT_TICKS) {
            return disbandMission();
        }

        const building = game.getGameObjectData(this.buildingId);
        if (!building) {
            return disbandMission();
        }
        const owner = (building as any).owner;
        if (owner === context.player.name) {
            // Claimed: entrants are inside (limboed) and the building fights
            // for us. Job done; release any stragglers.
            return disbandMission();
        }
        if (this.neutralOwner === null) {
            this.neutralOwner = owner ?? null;
        } else if (owner !== this.neutralOwner) {
            // Someone else grabbed it first.
            return disbandMission();
        }

        const unitIds = this.getUnitIds();
        if (unitIds.length === 0) {
            return requestUnits(GARRISON_INFANTRY_PRIORITIES);
        }
        if (currentTick > this.lastOrderAt + GARRISON_ORDER_INTERVAL_TICKS) {
            this.lastOrderAt = currentTick;
            context.player.actions.orderUnits(unitIds, OrderType.Occupy, this.buildingId);
        }
        // Units that make it inside are limboed and drop out of the roster
        // automatically; when the building flips to us we disband above.
        return noop();
    }

    public getGlobalDebugText(): string | undefined {
        return `Garrison building ${this.buildingId}`;
    }

    public getPriority() {
        return 6;
    }
}

export class GarrisonMissionFactory {
    private lastCheckAt = 0;

    constructor(private config?: EffectiveBotConfig) {}

    getName(): string {
        return "GarrisonMissionFactory";
    }

    maybeCreateMissions(context: SupabotContext, missionController: MissionController, logger: DebugLogger): void {
        const { game, matchAwareness } = context;
        const currentTick = game.getCurrentTick();
        if (currentTick < this.lastCheckAt + GARRISON_CHECK_INTERVAL_TICKS) {
            return;
        }
        this.lastCheckAt = currentTick;

        // Personality/doctrine gate: turtles and infantry/siege doctrines
        // garrison; rushers don't spend bodies on real estate.
        const personality = this.config?.personalityId;
        const doctrine = this.config?.matchDoctrine?.doctrine.id;
        const affinity =
            (personality === "turtle" || personality === "balanced" || personality === "opportunist" ? 1 : 0) +
            (doctrine === "infantry" || doctrine === "siege" ? 1 : 0);
        if (affinity === 0) {
            return;
        }

        const active = missionController
            .getMissions()
            .filter((mission) => mission instanceof GarrisonMission).length;
        if (active >= MAX_ACTIVE_GARRISON_MISSIONS) {
            return;
        }

        const playerData = game.getPlayerData(context.player.name);
        const rally = matchAwareness.getMainRallyPoint();
        const anchor = rally ?? toVector2(playerData.startLocation);

        // Nearest visible, unclaimed, garrisonable civilian building near the
        // rally lane that we aren't already working on.
        const takenIds = new Set(
            missionController
                .getMissions()
                .filter((mission): mission is GarrisonMission => mission instanceof GarrisonMission)
                .map((mission) => (mission as any).buildingId),
        );
        let best: { id: number; distance: number } | null = null;
        for (const id of game.getNeutralUnits((r: any) => r.canBeOccupied && (r.maxNumberOccupants ?? 0) > 0)) {
            if (takenIds.has(id)) {
                continue;
            }
            const data = game.getGameObjectData(id);
            if (!data?.tile) {
                continue;
            }
            // Shrouded targets silently drop occupy orders — visible only.
            const tile = game.mapApi.getTile(data.tile.rx, data.tile.ry);
            if (!tile || !game.mapApi.isVisibleTile(tile, context.player.name)) {
                continue;
            }
            const distance = new Vector2(data.tile.rx, data.tile.ry).distanceTo(anchor);
            if (distance > GARRISON_SEARCH_RADIUS) {
                continue;
            }
            if (!best || distance < best.distance) {
                best = { id, distance };
            }
        }
        if (!best) {
            return;
        }
        logger(`Garrisoning civilian building ${best.id} near the front.`);
        missionController.addMission(
            new GarrisonMission(`garrison-${best.id}`, best.id, 3, logger),
        );
    }
}
