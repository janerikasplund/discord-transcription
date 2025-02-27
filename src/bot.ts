import { Client, GatewayIntentBits, Interaction, ChannelType, TextChannel, DiscordAPIError } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { deploy } from './deploy';
import { interactionHandlers } from './interactions';
import { handleVoiceStateUpdate, isRecording, stopRecording } from './voiceStateManager';
import { ensureDirectoryExists } from './utils';
import config from './config';

// Extract config values
const { token, defaultChannel, claudeApiKey, deepgram_token } = config;

// Validate required tokens
if (!token) {
    console.error('❌ ERROR: No Discord bot token found!');
    process.exit(1);
}

if (!deepgram_token) {
    console.error('❌ WARNING: No Deepgram API token found!');
    console.error('Transcription will not work without a Deepgram API token.');
}

if (!claudeApiKey) {
    console.error('❌ WARNING: No Claude API key found!');
    console.error('Summary generation will not work without a Claude API key.');
}

// Ensure necessary directories exist
ensureDirectoryExists('./recordings');
ensureDirectoryExists('./transcripts');

const client = new Client({ 
    intents: [
        GatewayIntentBits.GuildVoiceStates, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

client.on('ready', () => {
    console.log(`🤖 Bot is ready! Logged in as ${client.user?.tag}`);
    console.log(`🌐 Connected to ${client.guilds.cache.size} servers`);
    client.guilds.cache.forEach(guild => {
        console.log(`   - ${guild.name} (${guild.id})`);
    });
});

client.on('messageCreate', async (message) => {
	if (!message.guild) return;
	if (!client.application?.owner) await client.application?.fetch();

	if (message.content.toLowerCase() === '!deploy' && message.author.id === client.application?.owner?.id) {
		await deploy(message.guild);

        try {
            const webhooks = await message.guild.fetchWebhooks();
            const webhook = webhooks.find(wh => wh.name === "Deepgram");

            const channel = message.guild.channels.cache.find(
                channel => channel && 
                channel.type === ChannelType.GuildText && 
                channel.name === defaultChannel
            ) as TextChannel | null;

            if (webhook) {
                console.log(`Found existing Deepgram webhook ${webhook.id}`);
            } else if (channel && channel instanceof TextChannel) {
                try {
                    const newWebhook = await channel.createWebhook({
                        name: "Deepgram",
                        avatar: "https://www.deepgram.com/favicon.ico"
                    });
                    console.log(`Created Deepgram webhook ${newWebhook.id}`);
                } catch (error) {
                    if (error instanceof DiscordAPIError && error.code === 50013) {
                        console.error('Bot lacks permission to create webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
                        await message.reply('Error: Bot lacks permission to create webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
                    } else {
                        console.error('Error creating webhook:', error);
                        await message.reply('Error creating webhook. Check console for details.');
                    }
                }
            } else {
                console.error(`Could not find channel ${defaultChannel}`);
                await message.reply(`Error: Could not find channel #${defaultChannel}`);
            }
        } catch (error) {
            if (error instanceof DiscordAPIError && error.code === 50013) {
                console.error('Bot lacks permission to fetch webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
                await message.reply('Error: Bot lacks permission to fetch webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
            } else {
                console.error('Error fetching webhooks:', error);
                await message.reply('Error fetching webhooks. Check console for details.');
            }
            return;
        }

		await message.reply('Deployed!');
	}
});

/**
 * The IDs of the users that can be recorded by the bot.
 */
const recordable = new Set<string>();
const recording = new Set<string>();

client.on('interactionCreate', async (interaction: Interaction) => {
	console.log('=== INTERACTION RECEIVED ===');
	console.log('Interaction type:', interaction.type);
	console.log('Is command:', interaction.isChatInputCommand());
	console.log('Guild ID:', interaction.guildId);
	
	if (!interaction.isChatInputCommand() || !interaction.guildId) {
		console.log('Ignoring interaction - not a command or not in a guild');
		return;
	}

	console.log('Command name:', interaction.commandName);
	const handler = interactionHandlers.get(interaction.commandName);
	console.log('Handler found:', !!handler);

	try {
		if (handler) {
			// Check if there's an existing voice connection
			const existingConnection = getVoiceConnection(interaction.guildId);
			console.log('Existing voice connection:', !!existingConnection);
			
			await handler(interaction, recordable, recording, client, existingConnection);
		} else {
			await interaction.reply('Unknown command');
		}
	} catch (error) {
		console.warn('Error handling interaction:', error);
	}
});

// Handle voice state updates for automatic recording
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        await handleVoiceStateUpdate(oldState, newState, client);
    } catch (error) {
        console.error('Error handling voice state update:', error);
    }
});

// Handle process termination
process.on('SIGINT', async () => {
    console.log('Received SIGINT. Cleaning up...');
    
    // Stop all active recordings
    const promises = [];
    for (const guild of client.guilds.cache.values()) {
        if (isRecording(guild.id)) {
            console.log(`Stopping recording in ${guild.name}`);
            promises.push(stopRecording(guild.id, client));
        }
    }
    
    // Wait for all recordings to stop
    await Promise.all(promises);
    
    // Destroy the client
    client.destroy();
    console.log('Cleanup complete. Exiting...');
    process.exit(0);
});

client.on('error', console.warn);

void client.login(token);
