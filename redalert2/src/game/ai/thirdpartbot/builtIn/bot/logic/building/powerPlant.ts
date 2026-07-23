import { GameApi, PlayerData, TechnoRules } from "../../../game-api";
import { AiBuildingRules, getDefaultPlacementLocation } from "./buildingRules";
import { GlobalThreat } from "../threat/threat";

export class PowerPlant implements AiBuildingRules {
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
        const plantPower = Math.max(50, technoRules.power);
        const numOwned = game.getVisibleUnits(playerData.name, "self", (r) => r == technoRules).length;
        const cap = Math.ceil(playerData.power.drain / plantPower) + 2;
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
