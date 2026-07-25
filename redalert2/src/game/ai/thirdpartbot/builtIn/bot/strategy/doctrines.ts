import { GameApi } from "../../game-api";

/**
 * Per-match strategic doctrine, rolled at game start with the shared game
 * PRNG (lockstep-safe) and layered over the personality. Personality sets
 * the TEMPO (when/how hard to attack); doctrine sets the TOOLS (which part
 * of the faction's arsenal carries the game). 6 personalities x 5 doctrines
 * x weight jitter x opening book x trigger mask = no two matches alike.
 */
export interface BotDoctrine {
    id: string;
    /** Extra weight per unit name for background production (multiplies personality weights). */
    unitNameWeights: Record<string, number>;
    /** Multiplies tech-structure priorities. */
    techPriorityMultiplier: number;
    /** Multiplies static-defense priorities. */
    defensePriorityMultiplier: number;
    /** Multiplies attack-team cost-class bias toward heavy teams. */
    heavyTeamBias: number;
}

export const BOT_DOCTRINES: BotDoctrine[] = [
    {
        // Massed vehicles: the classic tank column.
        id: "armor",
        unitNameWeights: {
            MTNK: 1.8, MGTK: 1.8, TNKD: 1.5, BFRT: 1.5, ROBO: 1.4,
            HTNK: 1.8, APOC: 1.8, TTNK: 1.5, DRON: 1.3,
            LTNK: 1.8, YTNK: 1.4, TELE: 1.3, MIND: 1.4,
        },
        techPriorityMultiplier: 1,
        defensePriorityMultiplier: 0.8,
        heavyTeamBias: 1.5,
    },
    {
        // Owns the skies: rocketeers, harriers, discs, kirovs.
        id: "air",
        unitNameWeights: {
            JUMPJET: 2.5, ORCA: 2.2, BEAG: 2.2,
            ZEP: 2, SCHP: 1.8,
            DISK: 2.5,
            GAAIRC: 1.5, AMRADR: 1.5,
        },
        techPriorityMultiplier: 1.2,
        defensePriorityMultiplier: 1,
        heavyTeamBias: 1,
    },
    {
        // Human wave: infantry masses, urban garrisons, support specialists.
        id: "infantry",
        unitNameWeights: {
            E1: 2.2, GGI: 2, SNIPE: 1.6, GHOST: 1.4, TANY: 1.3,
            E2: 2.2, SHK: 2, DESO: 1.6, IVAN: 1.4, TERROR: 1.6,
            INIT: 2.2, BRUTE: 2, VIRUS: 1.8, YURIPR: 1.3,
        },
        techPriorityMultiplier: 0.8,
        defensePriorityMultiplier: 1.1,
        heavyTeamBias: 0.6,
    },
    {
        // Race to tier 10: labs, superweapons, elite toys.
        id: "tech",
        unitNameWeights: {
            MGTK: 1.5, BFRT: 1.6, TANY: 1.5, ROBO: 1.3,
            APOC: 1.6, TTNK: 1.4, BORIS: 1.6, DTRUCK: 1.4,
            MIND: 1.6, YURIPR: 1.6, DISK: 1.4,
        },
        techPriorityMultiplier: 2,
        defensePriorityMultiplier: 1,
        heavyTeamBias: 1.3,
    },
    {
        // Creeping siege: artillery, deployables, fortified ground.
        id: "siege",
        unitNameWeights: {
            SREF: 2.2, GGI: 1.5, SNIPE: 1.5,
            V3: 2.2, DESO: 1.8, SCHP: 1.8,
            YTNK: 1.5, VIRUS: 1.8, TELE: 1.5,
        },
        techPriorityMultiplier: 1.2,
        defensePriorityMultiplier: 1.8,
        heavyTeamBias: 1.2,
    },
];

/**
 * Country flavor: each country's signature units get a standing boost so a
 * random Iraq opponent FEELS like Iraq (Desolator pushes), Cuba sends
 * terrorists, France turtles behind Grand Cannons...
 * Keyed by country name as it appears in rules ([Countries] section names).
 */
export const COUNTRY_FLAVOR: Record<string, Record<string, number>> = {
    Americans: { AMRADR: 1.5 },
    Alliance: { BEAG: 1.6 }, // Korea
    French: { GTGCAN: 2 },
    Germans: { TNKD: 2 },
    British: { SNIPE: 2, GGI: 1.3 },
    Russians: { TTNK: 2 },
    Arabs: { DESO: 2.5 }, // Iraq
    Confederation: { TERROR: 2, IVAN: 1.3 }, // Cuba
    Africans: { DTRUCK: 2 }, // Libya
};

/** Opening book: shapes the first minutes so early games diverge. */
export interface OpeningBook {
    id: string;
    /** Building-name priority multipliers applied for the first N ticks. */
    buildingMultipliers: Record<string, number>;
    durationTicks: number;
}

export const OPENING_BOOKS: OpeningBook[] = [
    { id: "standard", buildingMultipliers: {}, durationTicks: 0 },
    {
        id: "barracks-first",
        buildingMultipliers: {
            GAPILE: 1.8, NAHAND: 1.8, YABRCK: 1.8,
            GAWEAP: 0.7, NAWEAP: 0.7, YAWEAP: 0.7,
        },
        durationTicks: 4500,
    },
    {
        id: "eco-first",
        buildingMultipliers: {
            GAREFN: 1.6, NAREFN: 1.6, YAREFN: 1.6,
            GAPILL: 0.5, NALASR: 0.5, YAGGUN: 0.5,
        },
        durationTicks: 4500,
    },
];

/** Everything rolled once per match per bot. */
export interface MatchDoctrine {
    doctrine: BotDoctrine;
    opening: OpeningBook;
    /** Merged per-unit-name production weights: doctrine x country x jitter. */
    mergedUnitWeights: Record<string, number>;
    /** Building priority multipliers (opening book + doctrine SW flavor). */
    openingMultipliers: Record<string, number>;
    openingUntilTick: number;
    /** Trigger ids masked out for this whole match (~25% of the pool). */
    maskedTriggerRoll: number;
}

/**
 * Roll the match doctrine. All randomness through game.generateRandomInt.
 * The jitter multiplies EVERY named weight by 0.6-1.4 so even the same
 * personality+doctrine+country fields a different mix next match.
 */
/**
 * Personality+doctrine pairs already fielded this match, keyed by the
 * per-game GameApi instance (BotManager creates one per game), so entries
 * are per-match and GC with the game. Lockstep-safe: every client rolls
 * the same bots in the same order, so this set evolves identically on
 * all clients.
 */
const ROLLED_THIS_MATCH: WeakMap<GameApi, Set<string>> = new WeakMap();

export interface MatchIdentityRoll {
    personalityIndex: number;
    doctrineIndex: number;
    openingIndex: number;
}

/**
 * Roll personality+doctrine+opening for one bot, biased away from
 * personality+doctrine pairs earlier bots in this match already took:
 * up to 2 re-rolls (all draws via game.generateRandomInt — deterministic),
 * keeping the final roll if every attempt collides. A multi-bot lobby
 * therefore almost always fields visibly different opponents.
 */
export function rollMatchIdentity(game: GameApi, personalityCount: number): MatchIdentityRoll {
    let taken = ROLLED_THIS_MATCH.get(game);
    if (!taken) {
        taken = new Set();
        ROLLED_THIS_MATCH.set(game, taken);
    }
    let personalityIndex = 0;
    let doctrineIndex = 0;
    let openingIndex = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
        personalityIndex = game.generateRandomInt(0, personalityCount - 1);
        doctrineIndex = game.generateRandomInt(0, BOT_DOCTRINES.length - 1);
        openingIndex = game.generateRandomInt(0, OPENING_BOOKS.length - 1);
        if (!taken.has(`${personalityIndex}:${doctrineIndex}`)) {
            break;
        }
    }
    taken.add(`${personalityIndex}:${doctrineIndex}`);
    return { personalityIndex, doctrineIndex, openingIndex };
}

export function rollMatchDoctrine(
    game: GameApi,
    personalityWeights: Record<string, number>,
    countryName: string | undefined,
    identity?: MatchIdentityRoll,
): MatchDoctrine {
    const doctrine = BOT_DOCTRINES[identity ? identity.doctrineIndex : game.generateRandomInt(0, BOT_DOCTRINES.length - 1)];
    const opening = OPENING_BOOKS[identity ? identity.openingIndex : game.generateRandomInt(0, OPENING_BOOKS.length - 1)];

    const merged: Record<string, number> = {};
    const applyWeights = (weights: Record<string, number>) => {
        for (const [name, weight] of Object.entries(weights)) {
            merged[name] = (merged[name] ?? 1) * weight;
        }
    };
    applyWeights(personalityWeights);
    applyWeights(doctrine.unitNameWeights);
    if (countryName && COUNTRY_FLAVOR[countryName]) {
        applyWeights(COUNTRY_FLAVOR[countryName]);
    }
    // Per-name jitter on every unit we have an opinion about.
    for (const name of Object.keys(merged)) {
        merged[name] *= (60 + game.generateRandomInt(0, 80)) / 100;
    }

    return {
        doctrine,
        opening,
        mergedUnitWeights: merged,
        openingMultipliers: opening.buildingMultipliers,
        openingUntilTick: opening.durationTicks,
        maskedTriggerRoll: game.generateRandomInt(0, 1 << 30),
    };
}

/** Deterministic per-match mask: drops ~25% of attack triggers for variety. */
export function isTriggerMasked(triggerIndex: number, maskRoll: number): boolean {
    // Cheap integer hash, identical on all clients.
    let hash = (triggerIndex * 2654435761 + maskRoll) >>> 0;
    hash = (hash ^ (hash >>> 16)) >>> 0;
    return hash % 100 < 25;
}
