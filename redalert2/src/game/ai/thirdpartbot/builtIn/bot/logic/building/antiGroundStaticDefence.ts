import { GameApi, PlayerData, TechnoRules, Vector2 } from "../../../game-api";
import { getPointTowardsOtherPoint } from "../map/map";
import { GlobalThreat } from "../threat/threat";
import { AiBuildingRules, getDefaultPlacementLocation, numBuildingsOwnedOfType } from "./buildingRules";
import { getStaticDefencePlacement } from "./common";

export class AntiGroundStaticDefence implements AiBuildingRules {
    constructor(
        protected basePriority: number,
        protected baseAmount: number,
        protected groundStrength: number,
        protected limit: number,
    ) {}

    getPlacementLocation(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
    ): { rx: number; ry: number } | undefined {
        return getStaticDefencePlacement(game, playerData, technoRules);
    }

    getPriority(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number {
        const numOwned = numBuildingsOwnedOfType(game, playerData, technoRules);
        if (numOwned >= this.limit) {
            return 0;
        }
        // If the enemy's ground power is increasing we should try to keep up.
        if (threatCache) {
            let denominator =
                threatCache.totalAvailableAntiGroundFirepower + threatCache.totalDefensivePower + this.groundStrength;
            if (threatCache.totalOffensiveLandThreat > denominator * 1.1) {
                return this.basePriority * (threatCache.totalOffensiveLandThreat / Math.max(1, denominator));
            } else {
                return 0;
            }
        }
        const strengthPerCost = (this.groundStrength / technoRules.cost) * 1000;
        return this.basePriority * (1.0 - numOwned / this.baseAmount) * strengthPerCost;
    }

    getMaxCount(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number | null {
        return null;
    }
}

/**
 * Base defence that shoots BOTH air and ground (Yuri's Gattling Cannon is the
 * faction's only AA structure). Takes the higher of the anti-ground and the
 * anti-air response so a Yuri bot answers rocketeers/Kirovs the way NASAM and
 * NAFLAK let the other two sides. Still an AntiGroundStaticDefence, so the
 * per-difficulty defence cap and defensePriorityMultiplier in
 * baseBuildingMission still apply.
 */
export class DualPurposeStaticDefence extends AntiGroundStaticDefence {
    constructor(
        basePriority: number,
        baseAmount: number,
        groundStrength: number,
        limit: number,
        private airStrength: number,
    ) {
        super(basePriority, baseAmount, groundStrength, limit);
    }

    getPriority(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number {
        if (numBuildingsOwnedOfType(game, playerData, technoRules) >= this.limit) {
            return 0;
        }
        const groundPriority = super.getPriority(game, playerData, technoRules, threatCache);
        let airPriority = 0;
        if (threatCache) {
            const denominator = threatCache.totalAvailableAntiAirFirepower + this.airStrength;
            if (threatCache.totalOffensiveAirThreat > denominator * 1.1) {
                airPriority = this.basePriority * (threatCache.totalOffensiveAirThreat / Math.max(1, denominator));
            }
        }
        return Math.max(groundPriority, airPriority);
    }
}
