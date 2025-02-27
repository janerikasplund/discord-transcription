import { Client, VoiceState, TextChannel, ChannelType, GuildMember, Collection, Snowflake } from 'discord.js';
import { joinVoiceChannel, VoiceConnection, entersState, VoiceConnectionStatus, getVoiceConnection } from '@discordjs/voice';
import { createListeningStream } from './createListeningStream';
import { generateTranscript, generateSummary, generateTitle, sendTranscriptAndSummary } from './transcriptManager';
import { getTranscriptChannel } from './utils';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { defaultChannel, transcriptChannelId } = require('../auth.json');

// Store active recordings by guild ID
interface RecordingData {
    connection: VoiceConnection;
    channelId: string;
    channelName: string;
    recordable: Set<string>;
    recording: Set<string>;
    startTime: Date;
    notificationMessageId?: string;
    isManualRecording?: boolean; // Flag to indicate if this was started manually via /record
}

const activeRecordings = new Map<string, RecordingData>();

/**
 * Handle voice state updates to automatically start/stop recordings
 */
export async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState, client: Client) {
    // Skip bot voice state updates
    if (newState.member?.user.bot) return;

    const guildId = newState.guild.id;

    // Handle member joining a voice channel
    if (newState.channelId && (!oldState.channelId || oldState.channelId !== newState.channelId)) {
        console.log(`👂 Member ${newState.member?.displayName} joined voice channel ${newState.channel?.name}`);
        await handleMemberJoin(newState, client);
    }

    // Handle member leaving a voice channel
    if (oldState.channelId && (!newState.channelId || oldState.channelId !== newState.channelId)) {
        console.log(`👋 Member ${oldState.member?.displayName} left voice channel ${oldState.channel?.name}`);
        await handleMemberLeave(oldState, client);
    }
}

/**
 * Handle a member joining a voice channel
 */
async function handleMemberJoin(state: VoiceState, client: Client) {
    const guildId = state.guild.id;
    const channelId = state.channelId;
    
    if (!channelId) return;
    
    // Get the voice channel
    const channel = state.channel;
    if (!channel) return;
    
    // Count human members in the channel (excluding bots)
    const humanMembers = channel.members.filter(member => !member.user.bot);
    const memberCount = humanMembers.size;
    
    console.log(`🔢 Voice channel ${channel.name} has ${memberCount} human members`);
    
    // Only start recording if there are at least 2 real human members
    if (memberCount >= 2) {
        // Check if we're already recording in this guild
        if (activeRecordings.has(guildId)) {
            console.log(`⏺️ Already recording in guild ${guildId}`);
            
            // If we're recording in a different channel, we might want to move
            const recordingData = activeRecordings.get(guildId)!;
            if (recordingData.channelId !== channelId) {
                console.log(`🔄 Currently recording in ${recordingData.channelName}, but new activity in ${channel.name}`);
                // For now, we'll stick with the current recording
            }
            
            return;
        }
        
        console.log(`🎙️ Starting automatic recording in ${channel.name} with ${memberCount} members`);
        
        try {
            // Join the voice channel
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                selfDeaf: false,
                selfMute: true,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });
            
            // Wait for the connection to be ready
            await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
            console.log(`✅ Connected to voice channel ${channel.name}`);
            
            // Initialize recording data
            const recordable = new Set<string>();
            const recording = new Set<string>();
            
            // Add all current members to recordable
            humanMembers.forEach(member => {
                recordable.add(member.id);
            });
            
            // Store recording data
            activeRecordings.set(guildId, {
                connection,
                channelId: channel.id,
                channelName: channel.name,
                recordable,
                recording,
                startTime: new Date(),
                isManualRecording: false // This is an automatic recording
            });
            
            // Send notification to transcript channel
            const notificationMessage = await sendRecordingNotification(
                client, 
                guildId, 
                channel.name, 
                humanMembers
            );
            
            if (notificationMessage) {
                const recordingData = activeRecordings.get(guildId)!;
                recordingData.notificationMessageId = notificationMessage.id;
            }
            
            // Set up the recording
            setupRecording(connection, recordable, recording, client, guildId);
            
        } catch (error) {
            console.error(`❌ Error starting automatic recording: ${error}`);
        }
    }
}

/**
 * Handle a member leaving a voice channel
 */
async function handleMemberLeave(state: VoiceState, client: Client) {
    const guildId = state.guild.id;
    const channelId = state.channelId;
    
    if (!channelId) return;
    
    // Check if we're recording in this channel
    const recordingData = activeRecordings.get(guildId);
    if (!recordingData || recordingData.channelId !== channelId) {
        return;
    }
    
    // Get the voice channel
    const channel = state.channel;
    if (!channel) return;
    
    // Count human members in the channel (excluding bots)
    const humanMembers = channel.members.filter(member => !member.user.bot);
    const memberCount = humanMembers.size;
    
    console.log(`🔢 Voice channel ${channel.name} now has ${memberCount} human members after someone left`);
    
    // For automatic recordings, stop if only 1 or 0 human members remain
    // For manual recordings, stop if only the bot remains (0 human members)
    if ((recordingData.isManualRecording && memberCount === 0) || 
        (!recordingData.isManualRecording && memberCount <= 1)) {
        console.log(`⏹️ Stopping recording in ${channel.name} as ${memberCount} human members remain`);
        await stopRecording(guildId, client);
    }
}

/**
 * Set up recording for a voice connection
 */
function setupRecording(
    connection: VoiceConnection, 
    recordable: Set<string>, 
    recording: Set<string>, 
    client: Client,
    guildId: string
) {
    const receiver = connection.receiver;
    
    // Listen for speaking events
    receiver.speaking.on('start', async (userId) => {
        if (recordable.has(userId)) {
            // Get the member
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return;
            
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;
            
            const displayName = member.displayName;
            
            if (recording.has(userId)) {
                // Already recording this user
                return;
            }
            
            recording.add(userId);
            
            try {
                // Find our default channel for transcription
                const channel = client.channels.cache.find(
                    channel => channel && 
                    channel.type === ChannelType.GuildText && 
                    'name' in channel && 
                    channel.name === defaultChannel
                );
                
                if (!channel || !(channel instanceof TextChannel)) {
                    console.error(`❌ Could not find channel to transcribe to!`);
                    recording.delete(userId);
                    return;
                }
                
                // Get or create webhook
                const webhooks = await channel.fetchWebhooks();
                let webhook = webhooks.find(wh => wh.name === "Deepgram");
                const avatarUrl = member.displayAvatarURL();
                
                if (webhook) {
                    createListeningStream(webhook, recording, receiver, userId, displayName, avatarUrl, guildId);
                } else {
                    console.log(`🔧 Creating Deepgram webhook...`);
                    const newWebhook = await channel.createWebhook({
                        name: "Deepgram",
                        avatar: "https://www.deepgram.com/favicon.ico"
                    });
                    console.log(`✅ Created Deepgram webhook ${newWebhook.id}`);
                    createListeningStream(newWebhook, recording, receiver, userId, displayName, avatarUrl, guildId);
                }
            } catch (error) {
                console.error(`❌ Error setting up transcription for ${displayName}: ${error}`);
                recording.delete(userId);
            }
        }
    });
    
    // Handle connection state changes
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
            // Try to reconnect if disconnected
            await Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
        } catch (error) {
            // If we can't reconnect, stop the recording
            console.log(`❌ Voice connection disconnected and couldn't reconnect: ${error}`);
            connection.destroy();
            activeRecordings.delete(guildId);
        }
    });
}

/**
 * Stop recording in a guild
 */
export async function stopRecording(guildId: string, client: Client) {
    const recordingData = activeRecordings.get(guildId);
    if (!recordingData) {
        console.log(`⚠️ No active recording found for guild ${guildId}`);
        return;
    }
    
    try {
        // Destroy the connection
        recordingData.connection.destroy();
        console.log(`🛑 Destroyed voice connection for guild ${guildId}`);
        
        // Clear recording sets
        recordingData.recording.clear();
        
        // Get recorded users
        const recordedUsers = Array.from(recordingData.recordable).map(userId => {
            const member = client.guilds.cache.get(guildId)?.members.cache.get(userId);
            return member ? member.displayName : userId;
        });
        
        // Remove from active recordings
        activeRecordings.delete(guildId);
        
        console.log(`✅ Successfully stopped recording in guild ${guildId}`);
        
        // Wait a moment for any final transcripts to be processed
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate transcript
        const transcript = await generateTranscript(guildId, client);
        if (!transcript) {
            console.log(`⚠️ No transcript generated for guild ${guildId}`);
            await sendStopRecordingNotification(client, guildId, recordingData);
            return;
        }
        
        console.log(`📝 Generated transcript for guild ${guildId} (${transcript.length} chars)`);
        
        // Generate summary
        const summary = await generateSummary(transcript);
        if (!summary) {
            console.log(`⚠️ No summary generated for guild ${guildId}`);
            await sendStopRecordingNotification(client, guildId, recordingData);
            return;
        }
        
        console.log(`📋 Generated summary for guild ${guildId} (${summary.length} chars)`);
        
        // Generate title
        const title = await generateTitle(summary);
        console.log(`🏷️ Generated title for guild ${guildId}: ${title}`);
        
        // Send transcript and summary
        await sendTranscriptAndSummary(
            client,
            guildId,
            transcript,
            summary,
            title,
            recordedUsers
        );
    } catch (error) {
        console.error(`❌ Error stopping recording: ${error}`);
        
        // Try to send a basic notification
        try {
            if (recordingData) {
                await sendStopRecordingNotification(client, guildId, recordingData);
            }
        } catch (innerError) {
            console.error(`❌ Error sending stop notification: ${innerError}`);
        }
    }
}

/**
 * Send a notification that recording has started
 */
async function sendRecordingNotification(
    client: Client, 
    guildId: string, 
    channelName: string, 
    members: Collection<string, GuildMember>
) {
    try {
        // Get the transcript channel
        const transcriptChannel = await getTranscriptChannel(client);
        if (!transcriptChannel) {
            console.error(`❌ Could not find transcript channel`);
            return null;
        }
        
        // Format member names
        const memberNames = members.map(member => member.displayName).join(', ');
        
        // Send notification
        const message = await transcriptChannel.send(
            `🔴 Started recording in ${channelName} with ${members.size} members: ${memberNames}\n` +
            `A transcript and summary will be generated when the recording ends.`
        );
        
        console.log(`✅ Sent recording notification to ${transcriptChannel.name}`);
        return message;
    } catch (error) {
        console.error(`❌ Error sending recording notification: ${error}`);
        return null;
    }
}

/**
 * Send a notification that recording has stopped
 */
async function sendStopRecordingNotification(
    client: Client, 
    guildId: string, 
    recordingData: RecordingData
) {
    try {
        // Get the transcript channel
        const transcriptChannel = await getTranscriptChannel(client);
        if (!transcriptChannel) {
            console.error(`❌ Could not find transcript channel`);
            return;
        }
        
        // Calculate recording duration
        const duration = Math.round((new Date().getTime() - recordingData.startTime.getTime()) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        
        // Send notification
        await transcriptChannel.send(
            `⏹️ Recording stopped in ${recordingData.channelName} after ${minutes}m ${seconds}s\n` +
            `Generating transcript and summary... please wait.`
        );
        
        console.log(`✅ Sent recording stopped notification to ${transcriptChannel.name}`);
    } catch (error) {
        console.error(`❌ Error sending recording stopped notification: ${error}`);
    }
}

/**
 * Check if a guild is currently being recorded
 */
export function isRecording(guildId: string): boolean {
    return activeRecordings.has(guildId);
}

/**
 * Get all active recordings
 */
export function getActiveRecordings(): Map<string, RecordingData> {
    return activeRecordings;
}

/**
 * Start a manual recording initiated by the /record command
 */
export async function startManualRecording(
    guildId: string,
    channelId: string,
    channelName: string,
    humanMembers: Collection<string, GuildMember>,
    connection: VoiceConnection,
    client: Client
) {
    // Check if we're already recording in this guild
    if (activeRecordings.has(guildId)) {
        console.log(`⏺️ Already recording in guild ${guildId}`);
        return;
    }
    
    console.log(`🎙️ Starting manual recording in ${channelName} with ${humanMembers.size} members`);
    
    try {
        // Wait for the connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 20e3);
        console.log(`✅ Connected to voice channel ${channelName}`);
        
        // Initialize recording data
        const recordable = new Set<string>();
        const recording = new Set<string>();
        
        // Add all current members to recordable
        humanMembers.forEach(member => {
            recordable.add(member.id);
        });
        
        // Store recording data
        activeRecordings.set(guildId, {
            connection,
            channelId,
            channelName,
            recordable,
            recording,
            startTime: new Date(),
            isManualRecording: true // Mark this as a manual recording
        });
        
        // Send notification to transcript channel
        const notificationMessage = await sendRecordingNotification(
            client, 
            guildId, 
            channelName, 
            humanMembers
        );
        
        if (notificationMessage) {
            const recordingData = activeRecordings.get(guildId)!;
            recordingData.notificationMessageId = notificationMessage.id;
        }
        
        // Set up the recording
        setupRecording(connection, recordable, recording, client, guildId);
        
        return true;
    } catch (error) {
        console.error(`❌ Error starting manual recording: ${error}`);
        return false;
    }
} 