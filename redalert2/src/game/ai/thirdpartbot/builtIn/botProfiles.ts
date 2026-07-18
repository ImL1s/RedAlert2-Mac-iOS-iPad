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

export const EASY_BOT_PROFILE: BotProfile = {
    id: 'easy',
    apm: 60,
    armySizeMultiplier: 0.6,
    attackCooldownMultiplier: 2.5,
    firstAttackDelaySeconds: 360,
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
    attackCooldownMultiplier: 0.5,
    firstAttackDelaySeconds: 0,
};

/**
 * Per-match personality, rolled deterministically (game PRNG — lockstep-safe)
 * at game start and layered multiplicatively over the difficulty profile.
 * Same difficulty, different games: a rusher harasses early with cheap units,
 * a boomer turtles up then arrives with a heavy doom-stack.
 *
 * compositionWeights keys match DEFAULT_COMPOSITIONS ids; missing ids weigh 1.
 */
export interface BotPersonality {
    id: string;
    attackCooldownMultiplier: number;
    firstAttackDelayMultiplier: number;
    armySizeMultiplier: number;
    compositionWeights: Record<string, number>;
}

export const BOT_PERSONALITIES: BotPersonality[] = [
    {
        id: 'rusher',
        attackCooldownMultiplier: 0.6,
        firstAttackDelayMultiplier: 0.5,
        armySizeMultiplier: 0.8,
        compositionWeights: {
            conscripts: 3, gis: 3,
            sovietTanks: 2, alliedTanks: 2,
            rocketeers: 1.5,
            heavySovietTanks: 0.4, heavyAlliedTanks: 0.4,
            sovietArtillery: 0.4, alliedArtillery: 0.4,
            kirovs: 0.2,
        },
    },
    {
        id: 'balanced',
        attackCooldownMultiplier: 1,
        firstAttackDelayMultiplier: 1,
        armySizeMultiplier: 1,
        compositionWeights: {},
    },
    {
        id: 'boomer',
        attackCooldownMultiplier: 1.4,
        firstAttackDelayMultiplier: 1.5,
        armySizeMultiplier: 1.35,
        compositionWeights: {
            heavySovietTanks: 3, heavyAlliedTanks: 3,
            kirovs: 2,
            sovietTanks: 1.5, alliedTanks: 1.5,
            conscripts: 0.4, gis: 0.4,
        },
    },
    {
        id: 'sieger',
        attackCooldownMultiplier: 1.6,
        firstAttackDelayMultiplier: 1.3,
        armySizeMultiplier: 1.2,
        compositionWeights: {
            sovietArtillery: 3, alliedArtillery: 3,
            heavySovietTanks: 1.5, heavyAlliedTanks: 1.5,
            kirovs: 1.5,
            conscripts: 0.4, gis: 0.4,
        },
    },
];

/** Fully-resolved behavior config: difficulty profile x match personality. */
export interface EffectiveBotConfig {
    apm: number;
    armySizeMultiplier: number;
    attackCooldownMultiplier: number;
    firstAttackDelaySeconds: number;
    compositionWeights: Record<string, number>;
    personalityId: string;
}

export function resolveBotConfig(profile: BotProfile, personality: BotPersonality): EffectiveBotConfig {
    return {
        apm: profile.apm,
        armySizeMultiplier: profile.armySizeMultiplier * personality.armySizeMultiplier,
        attackCooldownMultiplier: profile.attackCooldownMultiplier * personality.attackCooldownMultiplier,
        firstAttackDelaySeconds: Math.round(profile.firstAttackDelaySeconds * personality.firstAttackDelayMultiplier),
        compositionWeights: personality.compositionWeights,
        personalityId: personality.id,
    };
}
