import { DiscordGatewayAdapterCreator, entersState, joinVoiceChannel, VoiceConnection, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import { Client, ChatInputCommandInteraction, GuildMember, Snowflake, User, ChannelType, TextChannel, DiscordAPIError } from 'discord.js';
import { createListeningStream } from './createListeningStream';
import { isRecording, stopRecording, startManualRecording } from './voiceStateManager';
import config from './config';

const { defaultChannel } = config;

function getDisplayName(interaction: ChatInputCommandInteraction, client: Client, userId: string) {
    const member = interaction.guild?.members.cache.get(userId);
    if (member instanceof GuildMember) { 
        return member.displayName;
    }
    const user: User | undefined = client.users.cache.get(userId);
	return (user ? `${user.username}` : userId);
}

async function join(
	interaction: ChatInputCommandInteraction,
	recordable: Set<Snowflake>,
	recording: Set<Snowflake>,
	client: Client,
	connection?: VoiceConnection,
) {
	await interaction.deferReply();
	
	// Add more detailed debugging information
	console.log('=== JOIN COMMAND DEBUG ===');
	console.log('User ID:', interaction.user.id);
	console.log('Guild ID:', interaction.guildId);
	console.log('Member object:', interaction.member);
	console.log('Member type:', interaction.member ? typeof interaction.member : 'null');
	console.log('Is GuildMember:', interaction.member instanceof GuildMember);
	
	// Force fetch the member to ensure we have the latest data
	try {
		if (interaction.guildId) {
			const guild = client.guilds.cache.get(interaction.guildId);
			if (guild) {
				const member = await guild.members.fetch(interaction.user.id);
				console.log('Fetched member:', member.id);
				console.log('Member in voice:', !!member.voice.channel);
				
				if (member.voice.channel) {
					console.log('Voice channel ID:', member.voice.channel.id);
					console.log('Voice channel name:', member.voice.channel.name);
					
					// Try to join using the freshly fetched member data
					if (!connection) {
						console.log('Attempting to join voice channel:', member.voice.channel.name);
						
						try {
							connection = joinVoiceChannel({
								channelId: member.voice.channel.id,
								guildId: member.voice.channel.guild.id,
								selfDeaf: false,
								selfMute: true,
								adapterCreator: member.voice.channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
							});
							
							console.log('Voice connection created successfully');
						} catch (error) {
							console.error('Error joining voice channel:', error);
							await interaction.followUp('Error joining voice channel. Check console for details.');
							return;
						}
					}
				} else {
					console.log('Member is not in a voice channel after fetch');
					await interaction.followUp('You need to join a voice channel first!');
					return;
				}
			} else {
				console.log('Could not find guild:', interaction.guildId);
				await interaction.followUp('Error: Could not find guild');
				return;
			}
		} else {
			console.log('No guild ID available');
			await interaction.followUp('Error: No guild ID available');
			return;
		}
	} catch (error) {
		console.error('Error fetching member:', error);
		
		// Fall back to the original method if fetching fails
		console.log('Falling back to original method...');
		
		if (!connection) {
			if (interaction.member instanceof GuildMember && interaction.member.voice.channel) {
				const channel = interaction.member.voice.channel;
				console.log('Attempting to join voice channel (fallback):', channel.name, channel.id);
				
				connection = joinVoiceChannel({
					channelId: channel.id,
					guildId: channel.guild.id,
					selfDeaf: false,
					selfMute: true,
					adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
				});
			} else {
				console.log('Failed voice channel check (fallback):');
				console.log('- Member is GuildMember:', interaction.member instanceof GuildMember);
				console.log('- Has voice channel:', interaction.member instanceof GuildMember ? !!interaction.member.voice.channel : 'N/A');
				
				await interaction.followUp('Join a voice channel and then try that again!');
				return;
			}
		}
	}

	try {
		console.log('Waiting for connection to be ready...');
		await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
		console.log('Connection is ready!');
		const receiver = connection.receiver;

		receiver.speaking.on('start', async (userId) => {
			if (recordable.has(userId)) {
                const displayName: string = getDisplayName(interaction, client, userId);

                if (recording.has(userId)) { 
                    //console.log(`✋ Already recording ${displayName}!`); 
                    return 
                }

                recording.add(userId);

                try {
                    // Find our default channel, if it exists
                    const channel = client.channels.cache.find(
                        channel => channel && 
                        channel.type === ChannelType.GuildText && 
                        'name' in channel && 
                        channel.name === defaultChannel
                    );
                    
                    if (!channel || !(channel instanceof TextChannel)) { 
                        console.error(`Could not find channel to transcribe to!`);
                        return;
                    }

                    try {
                        const webhooks = await channel.fetchWebhooks();
                        let webhook = webhooks.find(wh => wh.name === "Deepgram");
                        const member = interaction.guild?.members.cache.get(userId);
                        const avatarUrl = member?.displayAvatarURL() || '';
                        
                        if (webhook) {
                            createListeningStream(webhook, recording, receiver, userId, displayName, avatarUrl, interaction.guildId);
                        } else {
                            console.log(`Could not find webhook! Creating...`);
                            
                            try {
                                const newWebhook = await channel.createWebhook({
                                    name: "Deepgram",
                                    avatar: "https://www.deepgram.com/favicon.ico"
                                });
                                console.log(`Created Deepgram webhook ${newWebhook.id}`);
                                createListeningStream(newWebhook, recording, receiver, userId, displayName, avatarUrl, interaction.guildId);
                            } catch (error) {
                                if (error instanceof DiscordAPIError && error.code === 50013) {
                                    console.error('Bot lacks permission to create webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
                                } else {
                                    console.error('Error creating webhook:', error);
                                }
                                recording.delete(userId);
                            }
                        }
                    } catch (error) {
                        if (error instanceof DiscordAPIError && error.code === 50013) {
                            console.error('Bot lacks permission to fetch webhooks. Please ensure the bot has the "Manage Webhooks" permission.');
                        } else {
                            console.error('Error fetching webhooks:', error);
                        }
                        recording.delete(userId);
                    }
                } catch (error) {
                    console.error('Error setting up transcription:', error);
                    recording.delete(userId);
                }
            }
		});
	} catch (error) {
		console.warn('Connection error:', error);
		await interaction.followUp('Failed to join voice channel within 20 seconds, please try again later!');
		return;
	}

	await interaction.followUp('Ready!');
}

async function record(
	interaction: ChatInputCommandInteraction,
	recordable: Set<Snowflake>,
	_recording: Set<Snowflake>,
	client: Client,
	connection?: VoiceConnection,
) {
	console.log('=== RECORD COMMAND DEBUG ===');
	console.log('User ID:', interaction.user.id);
	console.log('Guild ID:', interaction.guildId);
	console.log('Connection exists:', !!connection);
	
	// If no connection exists, try to establish one first
	if (!connection && interaction.guildId) {
		console.log('No connection exists, attempting to join voice channel first');
		
		try {
			// Try to fetch the member to get their voice channel
			const guild = client.guilds.cache.get(interaction.guildId);
			if (guild) {
				const member = await guild.members.fetch(interaction.user.id);
				
				if (member.voice.channel) {
					console.log('Found voice channel:', member.voice.channel.name);
					
					// Join the voice channel
					connection = joinVoiceChannel({
						channelId: member.voice.channel.id,
						guildId: member.voice.channel.guild.id,
						selfDeaf: false,
						selfMute: true,
						adapterCreator: member.voice.channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
					});
					
					// Wait for the connection to be ready
					try {
						await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
						console.log('Connection established for record command');
					} catch (error) {
						console.error('Failed to establish connection:', error);
						await interaction.reply({ ephemeral: true, content: 'Failed to join voice channel. Please try the /join command first.' });
						return;
					}
				} else {
					console.log('User is not in a voice channel');
					await interaction.reply({ ephemeral: true, content: 'You need to join a voice channel first!' });
					return;
				}
			}
		} catch (error) {
			console.error('Error setting up connection for record command:', error);
			await interaction.reply({ ephemeral: true, content: 'Error setting up voice connection. Please try the /join command first.' });
			return;
		}
	}
	
	if (connection) {
		// Mark this as a manual recording in the voiceStateManager
		if (interaction.guildId) {
			const guild = client.guilds.cache.get(interaction.guildId);
			if (guild) {
				const member = await guild.members.fetch(interaction.user.id);
				if (member.voice.channel) {
					// Start a manual recording
					const humanMembers = member.voice.channel.members.filter(m => !m.user.bot);
					await startManualRecording(
						interaction.guildId,
						member.voice.channel.id,
						member.voice.channel.name,
						humanMembers,
						connection,
						client
					);
				}
			}
		}
		
		await interaction.reply({ 
			ephemeral: true, 
			content: `Started recording everyone in your voice channel. A transcript and summary will be generated when the recording ends.` 
		});
	} else {
		await interaction.reply({ ephemeral: true, content: 'Join a voice channel and then try that again!' });
	}
}

async function leave(
	interaction: ChatInputCommandInteraction,
	_recordable: Set<Snowflake>,
	recording: Set<Snowflake>,
	client: Client,
	connection?: VoiceConnection,
) {
	if (interaction.guildId && isRecording(interaction.guildId)) {
        await interaction.deferReply({ ephemeral: true });
        await stopRecording(interaction.guildId, client);
        await interaction.followUp({ ephemeral: true, content: 'Left the channel and stopped recording!' });
    } else if (connection) {
		connection.destroy();
        recording.clear();
		await interaction.reply({ ephemeral: true, content: 'Left the channel!' });
	} else {
		await interaction.reply({ ephemeral: true, content: 'Not playing in this server!' });
	}
}

// Add a new command to stop recording
async function stopRecordingCommand(
    interaction: ChatInputCommandInteraction,
    _recordable: Set<Snowflake>,
    _recording: Set<Snowflake>,
    client: Client,
    _connection?: VoiceConnection,
) {
    if (!interaction.guildId) {
        await interaction.reply({ ephemeral: true, content: 'This command can only be used in a server.' });
        return;
    }
    
    if (isRecording(interaction.guildId)) {
        await interaction.deferReply({ ephemeral: true });
        await stopRecording(interaction.guildId, client);
        await interaction.followUp({ ephemeral: true, content: 'Recording stopped!' });
    } else {
        await interaction.reply({ ephemeral: true, content: 'No active recording to stop.' });
    }
}

export const interactionHandlers = new Map<
	string,
	(
		interaction: ChatInputCommandInteraction,
		recordable: Set<Snowflake>,
		recording: Set<Snowflake>,
		client: Client,
		connection?: VoiceConnection,
	) => Promise<void>
>();
interactionHandlers.set('join', join);
interactionHandlers.set('record', record);
interactionHandlers.set('leave', leave);
interactionHandlers.set('stop_recording', stopRecordingCommand);
