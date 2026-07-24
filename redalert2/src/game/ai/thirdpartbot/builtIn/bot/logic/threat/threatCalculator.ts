import {
    GameApi,
    GameMath,
    GameObjectData,
    MovementZone,
    ObjectType,
    PlayerData,
    ProjectileRules,
    UnitData,
    WeaponRules,
} from "../../../game-api";
import { GlobalThreat } from "./threat";
import { getCachedTechnoRules } from "../common/rulesCache";

export function calculateGlobalThreat(game: GameApi, playerData: PlayerData, visibleAreaPercent: number): GlobalThreat {
    // ONE enemy pass + ONE self pass (this used to be 8 world scans — with
    // multiple bots at a 30-tick cadence it dominated the sim budget).
    // Each object's firepower is computed once and bucketed into every
    // category it belongs to.
    let observedGroundThreat = 0;
    let observedAirThreat = 0;
    let observedAntiAirThreat = 0;
    let observedGroundDefence = 0;
    for (const unitId of game.getVisibleUnits(playerData.name, "enemy")) {
        const data = game.getGameObjectData(unitId);
        if (!data) continue;
        const rules: any = (data as any).rules;
        if (!rules) continue;
        let firepower: number | null = null;
        const power = () => (firepower ??= calculateFirepowerForUnit(game, data));
        if (rules.type == ObjectType.Vehicle || rules.type == ObjectType.Infantry) {
            observedGroundThreat += power();
        }
        if (rules.movementZone == MovementZone.Fly) {
            observedAirThreat += power();
        }
        if (rules.type == ObjectType.Building && isAntiGround(game, unitId)) {
            observedGroundDefence += power();
        }
        if (rules.type != ObjectType.Building && isAntiAir(game, unitId)) {
            observedAntiAirThreat += power();
        }
    }

    let ourAntiGroundPower = 0;
    let ourAntiAirPower = 0;
    let ourAirPower = 0;
    let ourGroundDefencePower = 0;
    for (const unitId of game.getVisibleUnits(playerData.name, "self")) {
        const data = game.getGameObjectData(unitId);
        if (!data) continue;
        const rules: any = (data as any).rules;
        if (!rules) continue;
        let firepower: number | null = null;
        const power = () => (firepower ??= calculateFirepowerForUnit(game, data));
        const isBuilding = rules.type === ObjectType.Building;
        if (rules.isSelectableCombatant && isAntiGround(game, unitId)) {
            ourAntiGroundPower += power();
        }
        if ((rules.isSelectableCombatant || isBuilding) && isAntiAir(game, unitId)) {
            ourAntiAirPower += power();
        }
        if (isBuilding && isAntiGround(game, unitId)) {
            ourGroundDefencePower += power();
        }
        if (rules.movementZone == MovementZone.Fly && rules.isSelectableCombatant) {
            ourAirPower += power();
        }
    }

    return new GlobalThreat(
        visibleAreaPercent,
        observedGroundThreat,
        observedAirThreat,
        observedAntiAirThreat,
        observedGroundDefence,
        ourGroundDefencePower,
        ourAntiGroundPower,
        ourAntiAirPower,
        ourAirPower,
    );
}

// For the purposes of determining if units can target air/ground, we look purely at the technorules and only the base weapon (not elite)
// This excludes some special cases such as IFVs changing turrets, but we have to deal with it for now.
function isAntiGround(gameApi: GameApi, unitId: any): boolean {
    return testProjectile(gameApi, unitId, (p) => p.isAntiGround);
}
function isAntiAir(gameApi: GameApi, unitId: any): boolean {
    return testProjectile(gameApi, unitId, (p) => p.isAntiAir);
}

function testProjectile(gameApi: GameApi, unitId: any, test: (p: ProjectileRules) => boolean) {
    const rules = getCachedTechnoRules(gameApi, unitId);
    if (!rules || !(rules.primary || rules.secondary)) {
        return false;
    }

    const primaryWeapon = rules.primary ? gameApi.rulesApi.getWeapon(rules.primary) : null;
    const primaryProjectile = getProjectileRules(gameApi, primaryWeapon);
    if (primaryProjectile && test(primaryProjectile)) {
        return true;
    }

    const secondaryWeapon = rules.secondary ? gameApi.rulesApi.getWeapon(rules.secondary) : null;
    const secondaryProjectile = getProjectileRules(gameApi, secondaryWeapon);
    if (secondaryProjectile && test(secondaryProjectile)) {
        return true;
    }

    return false;
}

function getProjectileRules(gameApi: GameApi, weapon: WeaponRules | null): ProjectileRules | null {
    const primaryProjectile = weapon ? gameApi.rulesApi.getProjectile(weapon.projectile) : null;
    return primaryProjectile;
}

function calculateFirepowerForUnit(gameApi: GameApi, gameObjectData: GameObjectData): number {
    const rules = getCachedTechnoRules(gameApi, gameObjectData.id);
    if (!rules) {
        return 0;
    }
    const currentHp = gameObjectData?.hitPoints || 0;
    const maxHp = gameObjectData?.maxHitPoints || 0;
    let threat = 0;
    const hpRatio = currentHp / Math.max(1, maxHp);

    if (rules.primary) {
        const weapon = gameApi.rulesApi.getWeapon(rules.primary);
        threat += (hpRatio * ((weapon.damage + 1) * GameMath.sqrt(weapon.range + 1))) / Math.max(weapon.rof, 1);
    }
    if (rules.secondary) {
        const weapon = gameApi.rulesApi.getWeapon(rules.secondary);
        threat += (hpRatio * ((weapon.damage + 1) * GameMath.sqrt(weapon.range + 1))) / Math.max(weapon.rof, 1);
    }
    return Math.min(800, threat);
}

function calculateFirepowerForUnits(game: GameApi, unitIds: any[]) {
    let threat = 0;
    unitIds.forEach((unitId) => {
        const gameObjectData = game.getGameObjectData(unitId);
        if (gameObjectData) {
            threat += calculateFirepowerForUnit(game, gameObjectData);
        }
    });
    return threat;
}
