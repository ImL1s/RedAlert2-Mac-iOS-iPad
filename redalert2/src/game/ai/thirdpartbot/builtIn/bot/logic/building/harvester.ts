import { GameApi, PlayerData, TechnoRules } from "../../../game-api";
import { GlobalThreat } from "../threat/threat";
import { BasicGroundUnit } from "./basicGroundUnit";

const IDEAL_HARVESTERS_PER_REFINERY = 2;
const MAX_HARVESTERS_PER_REFINERY = 4;

// because refineries also scales based on harvesters, we need a cap
const MAX_HARVESTERS_TOTAL = 10;

export class Harvester extends BasicGroundUnit {
    constructor(
        basePriority: number,
        baseAmount: number,
        private minNeeded: number,
    ) {
        super(basePriority, baseAmount, 0, 0);
    }

    // Priority goes up when we have fewer than this many refineries.
    getPriority(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number {
        const refineries = game.getVisibleUnits(playerData.name, "self", (r) => r.refinery).length;
        const harvesters = game.getVisibleUnits(playerData.name, "self", (r) => r.harvester).length;

        const boost = harvesters < this.minNeeded ? 3 : harvesters > refineries * MAX_HARVESTERS_PER_REFINERY ? 0 : 1;

        return this.basePriority * (refineries / Math.max(harvesters / IDEAL_HARVESTERS_PER_REFINERY, 1)) * boost;
    }

    /**
     * Never a background filler. Without this override the inherited
     * BasicGroundUnit weight (basePriority = 15) is the HIGHEST weight in the
     * vehicle pool, so the moment getPriority() returns 0 because the fleet is
     * already oversized, the bot goes right on buying miners forever — and the
     * war factory never gets around to tanks.
     */
    public getBackgroundWeight(): number {
        return 0;
    }

    getMaxCount(game: GameApi, playerData: PlayerData, technoRules: TechnoRules, threatCache: GlobalThreat | null): number | null {
        return MAX_HARVESTERS_TOTAL;
    }
}
