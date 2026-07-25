import { GameApi, PlayerData, TechnoRules, Tile, Vector2 } from "../../../game-api";
import { AiBuildingRules, getDefaultPlacementLocation, numBuildingsOwnedOfType } from "./buildingRules";
import { GlobalThreat } from "../threat/threat";

export class BasicBuilding implements AiBuildingRules {
    constructor(
        protected basePriority: number,
        protected maxNeeded: number,
        protected onlyBuildWhenFloatingCreditsAmount?: number,
    ) {}

    getPlacementLocation(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
    ): { rx: number; ry: number } | undefined {
        // Prefer spawning close to conyard
        const conyardVectors = game
            .getVisibleUnits(playerData.name, "self", (r) => r.constructionYard)
            .map((r) => game.getGameObjectData(r)?.tile)
            .filter((t): t is Tile => !!t)
            .map((t) => new Vector2(t.rx, t.ry));

        if (conyardVectors.length === 0) {
            return undefined;
        }
        return getDefaultPlacementLocation(game, playerData, conyardVectors[0], technoRules, false, 2);
    }

    getPriority(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number {
        const numOwned = numBuildingsOwnedOfType(game, playerData, technoRules);
        const calcMaxCount = this.getMaxCount(game, playerData, technoRules, threatCache);
        const max = calcMaxCount ?? this.maxNeeded;
        if (numOwned >= max) {
            return -100;
        }

        const priority = this.basePriority * (1.0 - numOwned / max);

        if (this.onlyBuildWhenFloatingCreditsAmount && playerData.credits < this.onlyBuildWhenFloatingCreditsAmount) {
            const scale = playerData.credits / this.onlyBuildWhenFloatingCreditsAmount;
            // Retail techs on a SCHEDULE, not on a bank balance. A healthy bot
            // spends to zero every pass (that is the normal state), so scaling
            // desire by current credits meant radar/battle lab/superweapon
            // requests never formed at all — and the pause-to-save mechanism
            // can only save toward a request that exists. Once a war factory
            // stands (core base established), keep at least 40% desire so the
            // tech ladder enters the queue and completes as income arrives.
            const hasWarFactory =
                game.getVisibleUnits(
                    playerData.name,
                    "self",
                    (r) => r.name === "GAWEAP" || r.name === "NAWEAP" || r.name === "YAWEAP",
                ).length > 0;
            return priority * (hasWarFactory ? Math.max(scale, 0.4) : scale);
        }

        return priority;
    }

    getMaxCount(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null,
    ): number | null {
        return this.maxNeeded;
    }
}
