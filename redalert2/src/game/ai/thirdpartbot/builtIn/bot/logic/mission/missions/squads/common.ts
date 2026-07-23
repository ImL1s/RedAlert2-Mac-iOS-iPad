import { AttackState, MovementZone, ObjectType, OrderType, StanceType, UnitData, Vector2, ZoneType } from "../../../../../game-api";
import { getDistanceBetweenPoints, getDistanceBetweenUnits } from "../../../map/map";
import { BatchableAction } from "../../actionBatcher";

const NONCE_GI_DEPLOY = 0;
const NONCE_GI_UNDEPLOY = 1;

// Infantry that deploy to bring out their real weapon (GI, Guardian GI,
// Desolator's radiation field).
const DEPLOY_TO_FIRE_INFANTRY = new Set(["E1", "GGI", "DESO"]);

// Per-name micro roles: without these, specialists fight like line tanks and
// look dumber than not building them at all.
// Terror drones only hunt vehicles (their parasite is wasted on anything else).
const VEHICLE_HUNTER_NAMES = new Set(["DRON"]);
// Commandos: C4 erases buildings; their guns only threaten infantry.
const COMMANDO_NAMES = new Set(["TANY", "GHOST"]);
// Suicide units: worth spending only on structures and big game.
const SUICIDE_NAMES = new Set(["DTRUCK", "TERROR"]);

// Flying units churn (endless re-turning, never firing) when their orders are
// re-issued every squad update; give their orders a cooldown window instead.
function withAirCooldown(attacker: UnitData, action: BatchableAction): BatchableAction {
    if (attacker.rules.movementZone === MovementZone.Fly) {
        // jumpjetTurnRate is degrees/tick post-parse (~5.6 for rocketeers);
        // clamp so slow turners aren't frozen for hundreds of ticks.
        const turnRate = (attacker.rules as any).jumpjetTurnRate || 4;
        return action.withCooldown(Math.min(60, Math.max(30, Math.round(600 / turnRate))));
    }
    return action;
}

// Micro methods
export function manageMoveMicro(attacker: UnitData, attackPoint: Vector2): BatchableAction | null {
    // Out-of-ammo units (aircraft mostly) must be left alone so the engine's
    // return-and-rearm logic can run; re-ordering them cancels the rearm.
    if (attacker.ammo === 0) {
        return null;
    }
    if (DEPLOY_TO_FIRE_INFANTRY.has(attacker.name)) {
        const isDeployed = (attacker.stance as any) === StanceType.Deployed;
        if (isDeployed) {
            return BatchableAction.noTarget(attacker.id, OrderType.DeploySelected, NONCE_GI_UNDEPLOY);
        }
    }

    return withAirCooldown(attacker, BatchableAction.toPoint(attacker.id, OrderType.AttackMove, attackPoint));
}

export function manageAttackMicro(attacker: UnitData, target: UnitData): BatchableAction | null {
    if (attacker.ammo === 0) {
        return null;
    }
    const distance = getDistanceBetweenUnits(attacker, target);
    if (DEPLOY_TO_FIRE_INFANTRY.has(attacker.name)) {
        // Para (deployed weapon) range is 5.
        const deployedWeaponRange = attacker.secondaryWeapon?.maxRange || 5;
        const isDeployed = (attacker.stance as any) === StanceType.Deployed;
        if (!isDeployed && (distance <= deployedWeaponRange || (attacker.attackState as any) === AttackState.JustFired)) {
            return BatchableAction.noTarget(attacker.id, OrderType.DeploySelected, NONCE_GI_DEPLOY);
        } else if (isDeployed && distance > deployedWeaponRange) {
            return BatchableAction.noTarget(attacker.id, OrderType.DeploySelected, NONCE_GI_UNDEPLOY);
        }
    }
    let orderType: OrderType = OrderType.Attack;
    if (target?.rules.canDisguise || (target?.rules as any).underwater) {
        // Disguised (mirage/spy) and underwater targets need a force-attack
        // or our units just sit next to them doing nothing.
        orderType = OrderType.ForceAttack;
    }
    return withAirCooldown(attacker, BatchableAction.toTargetId(attacker.id, orderType, target.id));
}

/**
 *
 * @param attacker
 * @param target
 * @param squadHasAir whether the attacker's squad contains air units (AA gets priority)
 * @returns A number describing the weight of the given target for the attacker, or null if it should not attack it.
 */
export function getAttackWeight(attacker: UnitData, target: UnitData, squadHasAir: boolean = false): number | null {
    const { rx: x, ry: y } = attacker.tile;
    const { rx: hX, ry: hY } = target.tile;

    if (!attacker.primaryWeapon?.projectileRules.isAntiAir && target.zone === ZoneType.Air) {
        return null;
    }

    if (!attacker.primaryWeapon?.projectileRules.isAntiGround && target.zone === ZoneType.Ground) {
        return null;
    }

    const distance = getDistanceBetweenPoints(new Vector2(x, y), new Vector2(hX, hY));

    // Specialist role gates.
    const targetIsBuilding = (target.type as any) === ObjectType.Building;
    if (VEHICLE_HUNTER_NAMES.has(attacker.name) && (target.type as any) !== ObjectType.Vehicle) {
        // Terror drones ignore everything that can't be infested.
        return null;
    }
    if (COMMANDO_NAMES.has(attacker.name) && (target.type as any) === ObjectType.Vehicle) {
        // Tanya/SEAL guns can't scratch vehicles; don't pick that fight.
        return null;
    }

    // Focus-fire shaping: each bonus point is worth ~1 tile of distance.
    let bonus = 0;
    if (COMMANDO_NAMES.has(attacker.name) && targetIsBuilding) {
        // C4 one-shots structures: commandos beeline for them.
        bonus += 12;
    }
    if (SUICIDE_NAMES.has(attacker.name) && targetIsBuilding) {
        // A demo truck traded for a war factory is a good trade; for a
        // conscript it is not.
        bonus += 8;
    }
    // Finish wounded targets instead of spreading damage.
    if (target.maxHitPoints > 0) {
        bonus += (1 - target.hitPoints / target.maxHitPoints) * 8;
    }
    // Armed targets shoot back; silence them before chewing on walls.
    if (target.primaryWeapon) {
        bonus += 3;
    }
    // Long-range units pick off base defenses first (they outrange them).
    if ((target.rules as any).isBaseDefense && (attacker.primaryWeapon?.maxRange ?? 0) >= 6) {
        bonus += 5;
    }
    // Protect our air force: AA dies first when we brought planes.
    if (squadHasAir && target.primaryWeapon?.projectileRules.isAntiAir) {
        bonus += 5;
    }
    // Harvester snipes win games.
    if (target.rules.harvester) {
        bonus += 6;
    }

    return 1000000 - distance + bonus;
}
