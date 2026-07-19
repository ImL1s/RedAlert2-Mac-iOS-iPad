import { Strategy } from "./strategy";
import { ExpansionMissionFactory } from "../logic/mission/missions/expansionMission";
import { ScoutingMissionFactory } from "../logic/mission/missions/scoutingMission";
import { AttackMissionFactory } from "../logic/mission/missions/attackMission";
import { DefenceMissionFactory } from "../logic/mission/missions/defenceMission";
import { EngineerMissionFactory } from "../logic/mission/missions/engineerMission";
import { SupabotContext } from "../logic/common/context";
import { MissionController } from "../logic/mission/missionController";
import { DebugLogger } from "../logic/common/utils";
import { Compositions, getValidCompositions, SideComposition } from "./compositionUtils";
import { EffectiveBotConfig, NORMAL_BOT_PROFILE, resolveBotConfig, BOT_PERSONALITIES } from "../../botProfiles";

const DEFAULT_CONFIG: EffectiveBotConfig = resolveBotConfig(
    NORMAL_BOT_PROFILE,
    BOT_PERSONALITIES.find((p) => p.id === 'balanced')!,
);

// These could be loaded from ai.ini
const DEFAULT_COMPOSITIONS: Compositions = {
    conscripts: {
        composition: {
            E2: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    gis: {
        composition: {
            E1: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    sovietTanks: {
        composition: {
            HTNK: 5,
            HTK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    alliedTanks: {
        composition: {
            MTNK: 5,
            FV: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    kirovs: {
        composition: {
            KIROV: 1,
        },
        minimumUnits: 1,
        maximumUnits: 3,
    },
    rocketeers: {
        composition: {
            JUMPJET: 1,
        },
        minimumUnits: 2,
        maximumUnits: 6,
    },
    heavySovietTanks: {
        composition: {
            APOC: 2,
            HTNK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    heavyAlliedTanks: {
        composition: {
            MTNK: 2,
            MGTK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    sovietArtillery: {
        composition: {
            V3: 2,
            HTNK: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    alliedArtillery: {
        composition: {
            SREF: 2,
            MTNK: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    initiates: {
        composition: {
            INIT: 1,
        },
        minimumUnits: 3,
        maximumUnits: 10,
    },
    yuriTanks: {
        composition: {
            LTNK: 5,
            YTNK: 1,
        },
        minimumUnits: 2,
        maximumUnits: 20,
    },
    heavyYuriTanks: {
        composition: {
            LTNK: 3,
            MIND: 1,
        },
        minimumUnits: 2,
        maximumUnits: 10,
    },
    discs: {
        composition: {
            DISK: 1,
        },
        minimumUnits: 1,
        maximumUnits: 3,
    },
};

export class DefaultStrategy implements Strategy {
    private expansionFactory = new ExpansionMissionFactory();
    private scoutingFactory = new ScoutingMissionFactory();
    private attackFactory: AttackMissionFactory;
    private defenceFactory = new DefenceMissionFactory();
    private engineerFactory = new EngineerMissionFactory();

    constructor(private config: EffectiveBotConfig = DEFAULT_CONFIG) {
        this.attackFactory = new AttackMissionFactory(config);
    }

    onAiUpdate(context: SupabotContext, missionController: MissionController, logger: DebugLogger) {
        this.expansionFactory.maybeCreateMissions(context, missionController, logger);
        this.scoutingFactory.maybeCreateMissions(context, missionController, logger);

        const composition = this.selectRandomAttackComposition(context, logger);
        if (composition) {
            this.attackFactory.maybeCreateMissions(context, missionController, logger, composition);
        }

        this.defenceFactory.maybeCreateMissions(context, missionController, logger);
        this.engineerFactory.maybeCreateMissions(context, missionController, logger);

        return this;
    }

    private selectRandomAttackComposition(context: SupabotContext, logger: DebugLogger): SideComposition | null {
        const playerData = context.game.getPlayerData(context.player.name);
        const side = playerData.country?.side;
        if (side === undefined) {
            return null;
        }

        const validCompositions = getValidCompositions(context, DEFAULT_COMPOSITIONS);

        if (validCompositions.length === 0) {
            return null;
        }

        logger(`Valid compositions: ${validCompositions.join(", ")}`);

        const compositionId = this.pickWeightedComposition(context, validCompositions);
        return this.scaleComposition(DEFAULT_COMPOSITIONS[compositionId]);
    }

    /**
     * Personality-weighted pick (integer-scaled weights + game PRNG so the
     * choice stays deterministic across lockstep clients).
     */
    private pickWeightedComposition(context: SupabotContext, compositionIds: string[]): string {
        const weights = compositionIds.map((id) =>
            Math.max(1, Math.round((this.config.compositionWeights[id] ?? 1) * 10)),
        );
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = context.game.generateRandomInt(0, totalWeight - 1);
        for (let i = 0; i < compositionIds.length; i++) {
            roll -= weights[i];
            if (roll < 0) {
                return compositionIds[i];
            }
        }
        return compositionIds[compositionIds.length - 1];
    }

    private scaleComposition(composition: SideComposition): SideComposition {
        const multiplier = this.config.armySizeMultiplier;
        if (multiplier === 1) {
            return composition;
        }
        const minimumUnits = Math.max(1, Math.round(composition.minimumUnits * multiplier));
        return {
            ...composition,
            minimumUnits,
            maximumUnits: Math.max(minimumUnits, Math.round(composition.maximumUnits * multiplier)),
        };
    }
}
