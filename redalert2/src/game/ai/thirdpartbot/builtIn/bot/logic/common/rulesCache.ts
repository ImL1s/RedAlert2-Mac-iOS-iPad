import { GameApi, TechnoRules } from "../../../game-api";

// checking technorules directly reduces the amount of calls to getUnitData(), which is a relatively expensive function.
// A null value indicates an object that does not have TechnoRules.
// The cache is keyed by the game's RulesApi instance: rules differ per match
// (map inis, game-mode overrides), and a module-global cache would serve a
// PREVIOUS game's TechnoRules — a lockstep divergence for any client whose
// cache is warm when another client's is cold.
let cachedRulesApi: any = null;
let technoRulesCache: { [rulesName: string]: TechnoRules | null } = {};

export const getCachedTechnoRules = (gameApi: GameApi, unitId: any): TechnoRules | null => {
    const gameObject = gameApi.getGameObjectData(unitId);
    if (!gameObject) {
        return null;
    }
    const { rulesApi } = gameApi;
    if (rulesApi !== cachedRulesApi) {
        // New game (or first call): drop the previous match's rules.
        cachedRulesApi = rulesApi;
        technoRulesCache = {};
    }
    const { name } = gameObject;

    if (technoRulesCache[name]) {
        // object is present in cache, either with TechnoRules or null (indicating that it does not have TechnoRules)
        return technoRulesCache[name];
    }

    const aircraftRules = rulesApi.aircraftRules.get(name);
    if (aircraftRules) {
        technoRulesCache[name] = aircraftRules;
        return aircraftRules;
    }

    const buildingRules = rulesApi.buildingRules.get(name);
    if (buildingRules) {
        technoRulesCache[name] = buildingRules;
        return buildingRules;
    }

    const infantryRules = rulesApi.infantryRules.get(name);
    if (infantryRules) {
        technoRulesCache[name] = infantryRules;
        return infantryRules;
    }

    const vehicleRules = rulesApi.vehicleRules.get(name);
    if (vehicleRules) {
        technoRulesCache[name] = vehicleRules;
        return vehicleRules;
    }

    technoRulesCache[name] = null;
    return null;
};
