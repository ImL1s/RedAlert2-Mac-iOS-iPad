import { AiDifficulty } from '../gameopts/GameOpts';
import { Bot } from './Bot';
import { DummyBot } from './DummyBot';
import { BuiltInBotAdapter } from '../ai/thirdpartbot/builtIn/BuiltInBotAdapter';
import { BRUTAL_BOT_PROFILE, EASY_BOT_PROFILE, NORMAL_BOT_PROFILE } from '../ai/thirdpartbot/builtIn/botProfiles';
import { BotRegistry } from '../ai/thirdpartbot/BotRegistry';
import { ThirdPartyBotAdapter } from '../ai/thirdpartbot/ThirdPartyBotAdapter';
export class BotFactory {
    private botsLib: any;
    constructor(botsLib: any) {
        this.botsLib = botsLib;
    }
    create(player: {
        isAi: boolean;
        name: string;
        aiDifficulty: AiDifficulty;
        country: {
            name: string;
        };
        customBotId?: string;
    }): Bot {
        if (!player.isAi) {
            throw new Error(`Player "${player.name}" is not an AI`);
        }

        if (player.aiDifficulty === AiDifficulty.Custom) {
            const registry = BotRegistry.getInstance();
            if (player.customBotId) {
                const meta = registry.get(player.customBotId);
                if (meta) {
                    console.info(`[BotFactory] Using bot "${meta.displayName}" for "${player.name}"`);
                    return new ThirdPartyBotAdapter(player.name, player.country.name, meta);
                }
                console.warn(`[BotFactory] Custom bot "${player.customBotId}" not found, trying fallback`);
            }
            const uploadedBots = registry.getUploadedBots();
            if (uploadedBots.length > 0) {
                const meta = uploadedBots[0];
                console.info(`[BotFactory] Using uploaded bot "${meta.displayName}" for "${player.name}"`);
                return new ThirdPartyBotAdapter(player.name, player.country.name, meta);
            }
            console.warn(`[BotFactory] Custom AI selected but no uploaded bot found, falling back to BuiltInBotAdapter`);
            return new BuiltInBotAdapter(player.name, player.country.name);
        }
        if (player.aiDifficulty === AiDifficulty.Easy) {
            return new BuiltInBotAdapter(player.name, player.country.name, EASY_BOT_PROFILE);
        }
        if (player.aiDifficulty === AiDifficulty.Normal) {
            return new BuiltInBotAdapter(player.name, player.country.name, NORMAL_BOT_PROFILE);
        }
        if (player.aiDifficulty === AiDifficulty.Brutal) {
            return new BuiltInBotAdapter(player.name, player.country.name, BRUTAL_BOT_PROFILE);
        }
        // Medium doubles as the stationary "Training Dummy" lobby option.
        if (player.aiDifficulty === AiDifficulty.Medium ||
            player.aiDifficulty === AiDifficulty.MediumSea) {
            return new DummyBot(player.name, player.country.name);
        }
        throw new Error(`Unsupported AI difficulty "${player.aiDifficulty}"`);
    }
}
