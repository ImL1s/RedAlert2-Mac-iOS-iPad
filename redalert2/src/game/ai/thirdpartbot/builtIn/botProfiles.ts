/**
 * Difficulty profiles for the built-in (Supalosa-derived) bot.
 *
 * The knobs deliberately shape *behavior pacing* rather than cheating:
 * - apm: caps how often the bot acts (reaction speed, micro, queue upkeep).
 * - armySizeMultiplier: scales attack-composition min/max sizes.
 * - attackCooldownMultiplier: scales the pause between offensives (>1 = more passive).
 * - firstAttackDelaySeconds: grace period before the first offensive mission.
 */
export interface BotProfile {
    id: string;
    apm: number;
    armySizeMultiplier: number;
    attackCooldownMultiplier: number;
    firstAttackDelaySeconds: number;
}

// Difficulty pacing note: attack cadence per difficulty now lives in the
// attack factory's LAUNCH_GATE_BY_DIFFICULTY (retail TeamDelays ratio
// 1 : 1.25 : 1.75); attackCooldownMultiplier here stays 1 so difficulty
// isn't double-counted — personalities still multiply on top.
export const EASY_BOT_PROFILE: BotProfile = {
    id: 'easy',
    apm: 60,
    armySizeMultiplier: 0.6,
    attackCooldownMultiplier: 1,
    // Retail easy first-attack grace ≈ 3500 ticks (~235s).
    firstAttackDelaySeconds: 235,
};

export const NORMAL_BOT_PROFILE: BotProfile = {
    id: 'normal',
    apm: 300,
    armySizeMultiplier: 1,
    attackCooldownMultiplier: 1,
    firstAttackDelaySeconds: 0,
};

export const BRUTAL_BOT_PROFILE: BotProfile = {
    id: 'brutal',
    apm: 600,
    armySizeMultiplier: 1.5,
    attackCooldownMultiplier: 1,
    firstAttackDelaySeconds: 0,
};

/** How an attack squad picks its destination. */
export type TargetPreference = 'any' | 'harvester' | 'weakest';

/**
 * Per-match personality, rolled deterministically (game PRNG — lockstep-safe)
 * at game start and layered multiplicatively over the difficulty profile.
 * Same difficulty, different games: a rusher throws early cheap waves, a
 * harasser snipes harvesters from two directions, a turtle techs behind
 * defenses and arrives with a late deathball.
 */
export interface BotPersonality {
    id: string;
    attackCooldownMultiplier: number;
    firstAttackDelayMultiplier: number;
    armySizeMultiplier: number;
    /** Legacy fallback-composition weights (used when ai.ini is unavailable). */
    compositionWeights: Record<string, number>;
    /** Credits kept in reserve for structures before background unit production spends. */
    unitReserveCredits: number;
    /** How many attack missions may assemble at once (multi-prong pressure). */
    maxPreparingAttacks: number;
    /** Ticks an attack may sit assembling before it launches with what it has. */
    attackLaunchTimeoutTicks: number;
    /** Attack-team cost-class bias: multiplies trigger weights by team cost. */
    teamCostBias: { cheap: number; medium: number; heavy: number };
    /** Squad target selection preference. */
    targetPreference: TargetPreference;
    /** Scales static-defense structure priorities. */
    defensePriorityMultiplier: number;
    /** Scales tech/radar/lab structure priorities (teching speed). */
    techPriorityMultiplier: number;
    /** Extra weight per unit name for background production (default 1). */
    unitNameWeights: Record<string, number>;
    /** <1 attacks closer to parity, >1 waits for a bigger edge. */
    aggressionThreatFactor: number;
}

const NO_WEIGHTS: Record<string, number> = {};

export const BOT_PERSONALITIES: BotPersonality[] = [
    {
        // Early, constant cheap pressure; forgoes tech and defense to do it.
        id: 'rusher',
        attackCooldownMultiplier: 0.5,
        firstAttackDelayMultiplier: 0.3,
        armySizeMultiplier: 0.7,
        compositionWeights: { conscripts: 3, gis: 3, sovietTanks: 2, alliedTanks: 2, initiates: 3, yuriTanks: 2 },
        unitReserveCredits: 200,
        maxPreparingAttacks: 2,
        attackLaunchTimeoutTicks: 900,
        teamCostBias: { cheap: 3, medium: 1, heavy: 0.2 },
        targetPreference: 'any',
        defensePriorityMultiplier: 0.5,
        techPriorityMultiplier: 0.4,
        unitNameWeights: { E1: 2, E2: 2, INIT: 2, DOG: 1.5, MTNK: 1.5, HTNK: 1.5, LTNK: 1.5 },
        aggressionThreatFactor: 0.9,
    },
    {
        // Many small simultaneous raids aimed at the enemy economy.
        id: 'harasser',
        attackCooldownMultiplier: 0.6,
        firstAttackDelayMultiplier: 0.6,
        armySizeMultiplier: 0.6,
        compositionWeights: { alliedTanks: 2, sovietTanks: 2, rocketeers: 2, yuriTanks: 2 },
        unitReserveCredits: 400,
        maxPreparingAttacks: 3,
        attackLaunchTimeoutTicks: 900,
        teamCostBias: { cheap: 2, medium: 1.5, heavy: 0.3 },
        targetPreference: 'harvester',
        defensePriorityMultiplier: 0.8,
        techPriorityMultiplier: 0.8,
        unitNameWeights: { FV: 2, HTK: 2, YTNK: 2, JUMPJET: 1.5, DISK: 1.5 },
        aggressionThreatFactor: 0.85,
    },
    {
        // The all-rounder.
        id: 'balanced',
        attackCooldownMultiplier: 1,
        firstAttackDelayMultiplier: 1,
        armySizeMultiplier: 1,
        compositionWeights: NO_WEIGHTS,
        unitReserveCredits: 600,
        maxPreparingAttacks: 2,
        attackLaunchTimeoutTicks: 1350,
        teamCostBias: { cheap: 1, medium: 1.2, heavy: 1 },
        targetPreference: 'any',
        defensePriorityMultiplier: 1,
        techPriorityMultiplier: 1,
        unitNameWeights: NO_WEIGHTS,
        aggressionThreatFactor: 1,
    },
    {
        // Economy first: expands early, defends adequately, then rolls out
        // heavy late-game stacks.
        id: 'boomer',
        attackCooldownMultiplier: 1.3,
        firstAttackDelayMultiplier: 1.5,
        armySizeMultiplier: 1.4,
        compositionWeights: { heavySovietTanks: 3, heavyAlliedTanks: 3, kirovs: 2, heavyYuriTanks: 3 },
        unitReserveCredits: 1200,
        maxPreparingAttacks: 2,
        attackLaunchTimeoutTicks: 1800,
        teamCostBias: { cheap: 0.4, medium: 1, heavy: 2.5 },
        targetPreference: 'any',
        defensePriorityMultiplier: 1.2,
        techPriorityMultiplier: 1.5,
        unitNameWeights: { APOC: 2, MGTK: 2, ZEP: 1.5, MIND: 2, CMIN: 1.3, HARV: 1.3 },
        aggressionThreatFactor: 1.15,
    },
    {
        // Fortifies hard, techs to top tier, attacks rarely but massively
        // with artillery-anchored deathballs.
        id: 'turtle',
        attackCooldownMultiplier: 1.7,
        firstAttackDelayMultiplier: 1.8,
        armySizeMultiplier: 1.6,
        compositionWeights: { sovietArtillery: 3, alliedArtillery: 3, heavySovietTanks: 2, heavyAlliedTanks: 2 },
        unitReserveCredits: 800,
        maxPreparingAttacks: 1,
        attackLaunchTimeoutTicks: 2400,
        teamCostBias: { cheap: 0.3, medium: 1, heavy: 3 },
        targetPreference: 'any',
        defensePriorityMultiplier: 2.5,
        techPriorityMultiplier: 2,
        unitNameWeights: { V3: 3, SREF: 3, APOC: 1.5, MGTK: 1.5, MIND: 1.5 },
        aggressionThreatFactor: 1.3,
    },
    {
        // Watches the balance of power and pounces the moment it has an edge,
        // aiming at the weakest part of the enemy position.
        id: 'opportunist',
        attackCooldownMultiplier: 0.8,
        firstAttackDelayMultiplier: 0.8,
        armySizeMultiplier: 1,
        compositionWeights: NO_WEIGHTS,
        unitReserveCredits: 500,
        maxPreparingAttacks: 2,
        attackLaunchTimeoutTicks: 1200,
        teamCostBias: { cheap: 1, medium: 1.5, heavy: 1.2 },
        targetPreference: 'weakest',
        defensePriorityMultiplier: 1,
        techPriorityMultiplier: 1.2,
        unitNameWeights: NO_WEIGHTS,
        aggressionThreatFactor: 0.8,
    },
];

import type { MatchDoctrine } from "./bot/strategy/doctrines";

/** Fully-resolved behavior config: difficulty profile x match personality. */
export interface EffectiveBotConfig {
    apm: number;
    armySizeMultiplier: number;
    attackCooldownMultiplier: number;
    firstAttackDelaySeconds: number;
    compositionWeights: Record<string, number>;
    personalityId: string;
    difficultyId: string;
    unitReserveCredits: number;
    maxPreparingAttacks: number;
    attackLaunchTimeoutTicks: number;
    teamCostBias: { cheap: number; medium: number; heavy: number };
    targetPreference: TargetPreference;
    defensePriorityMultiplier: number;
    techPriorityMultiplier: number;
    unitNameWeights: Record<string, number>;
    aggressionThreatFactor: number;
    /** Rolled once per match in onGameStart: doctrine, jitter, opening, trigger mask. */
    matchDoctrine?: MatchDoctrine;
}

export function resolveBotConfig(profile: BotProfile, personality: BotPersonality): EffectiveBotConfig {
    return {
        apm: profile.apm,
        armySizeMultiplier: profile.armySizeMultiplier * personality.armySizeMultiplier,
        attackCooldownMultiplier: profile.attackCooldownMultiplier * personality.attackCooldownMultiplier,
        // Clamp: no difficulty x personality combo may sit passive past 4
        // minutes before its first offensive (turtle/boomer 1.5-1.8x
        // multipliers were pushing easy to 6-7 minutes of dead air).
        firstAttackDelaySeconds: Math.min(
            240,
            Math.round(profile.firstAttackDelaySeconds * personality.firstAttackDelayMultiplier),
        ),
        compositionWeights: personality.compositionWeights,
        personalityId: personality.id,
        difficultyId: profile.id,
        unitReserveCredits: personality.unitReserveCredits,
        maxPreparingAttacks: personality.maxPreparingAttacks,
        // Easy assembles slowly (lean eco texture); cap how long a wave may
        // sit assembling so easy stays visibly active.
        attackLaunchTimeoutTicks:
            profile.id === "easy"
                ? Math.min(personality.attackLaunchTimeoutTicks, 1800)
                : personality.attackLaunchTimeoutTicks,
        teamCostBias: personality.teamCostBias,
        targetPreference: personality.targetPreference,
        defensePriorityMultiplier: personality.defensePriorityMultiplier,
        techPriorityMultiplier: personality.techPriorityMultiplier,
        unitNameWeights: personality.unitNameWeights,
        aggressionThreatFactor: personality.aggressionThreatFactor,
    };
}
