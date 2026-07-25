import { GameApi, PlayerData, TechnoRules } from "../../../game-api";
import { AiBuildingRules, getDefaultPlacementLocation } from "./buildingRules";
import { GlobalThreat } from "../threat/threat";

export class PowerPlant implements AiBuildingRules {
    // Worst legitimate case is brutal Yuri (25 defenses + full tech,
    // ~1900 drain / 150-power reactors ~= 15); anything past this is a bug.
    static readonly ABSOLUTE_MAX_PLANTS = 16;

    getPlacementLocation(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules
    ): { rx: number; ry: number } | undefined {
        return getDefaultPlacementLocation(game, playerData, playerData.startLocation, technoRules, false, 2);
    }

    getPriority(game: GameApi, playerData: PlayerData, technoRules: TechnoRules): number {
        // Hard cap: enough plants to cover the drain plus a small buffer.
        // Without this, any accounting hiccup (e.g. occupancy-boosted Yuri
        // bio reactors) turns "low power" into an endless reactor farm.
        // Count by NAME so the cap can never be defeated by a rules-object
        // identity mismatch, and clamp with an absolute ceiling so a
        // drain-side accounting bug cannot walk the cap upward.
        const plantPower = Math.max(50, technoRules.power);
        const numOwned = game.getVisibleUnits(playerData.name, "self", (r) => r.name === technoRules.name).length;
        const cap = Math.min(
            Math.ceil(playerData.power.drain / plantPower) + 2,
            PowerPlant.ABSOLUTE_MAX_PLANTS,
        );
        if (numOwned >= cap) {
            return 0;
        }
        if (playerData.power.total < playerData.power.drain) {
            return 100;
        } else if (playerData.power.total < playerData.power.drain + technoRules.power / 2) {
            return 20;
        } else {
            return 0;
        }
    }

    getMaxCount(
        game: GameApi,
        playerData: PlayerData,
        technoRules: TechnoRules,
        threatCache: GlobalThreat | null
    ): number | null {
        return null;
    }
}
