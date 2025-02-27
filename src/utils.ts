import { Client, TextChannel, ChannelType } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import config from './config';

const { transcriptChannelId, defaultChannel } = config;

/**
 * Get the transcript channel
 */
export async function getTranscriptChannel(client: Client): Promise<TextChannel | null> {
    // If transcriptChannelId is defined, use that
    if (transcriptChannelId) {
        const channel = await client.channels.fetch(transcriptChannelId).catch(() => null);
        if (channel && channel.type === ChannelType.GuildText) {
            return channel as TextChannel;
        }
    }
    
    // Otherwise, fall back to the default channel
    const channel = client.channels.cache.find(
        channel => channel && 
        channel.type === ChannelType.GuildText && 
        'name' in channel && 
        channel.name === defaultChannel
    );
    
    return channel as TextChannel || null;
}

/**
 * Ensure a directory exists
 */
export function ensureDirectoryExists(dirPath: string): void {
    const absolutePath = path.isAbsolute(dirPath) 
        ? dirPath 
        : path.join(process.cwd(), dirPath);
        
    if (!fs.existsSync(absolutePath)) {
        fs.mkdirSync(absolutePath, { recursive: true });
        console.log(`📁 Created directory: ${absolutePath}`);
    }
} 