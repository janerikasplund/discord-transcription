import { Client, AttachmentBuilder } from 'discord.js';
import { getTranscriptChannel } from './utils';
import * as fs from 'fs';
import * as path from 'path';
import { Anthropic } from '@anthropic-ai/sdk';
import config from './config';

const { claudeApiKey } = config;

// Initialize Anthropic client
let anthropic: Anthropic | null = null;
if (claudeApiKey) {
    try {
        anthropic = new Anthropic({
            apiKey: claudeApiKey,
        });
        console.log('✅ Anthropic client initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Anthropic client:', error);
    }
}

// Store transcripts by guild ID and user ID
interface TranscriptData {
    userId: string;
    displayName: string;
    messages: TranscriptMessage[];
    startTime: Date;
}

interface TranscriptMessage {
    text: string;
    timestamp: Date;
}

// Map of guild ID -> Map of user ID -> transcript data
const transcripts = new Map<string, Map<string, TranscriptData>>();

/**
 * Add a message to the transcript
 */
export function addTranscriptMessage(
    guildId: string,
    userId: string,
    displayName: string,
    text: string
) {
    // Get or create guild transcript map
    if (!transcripts.has(guildId)) {
        transcripts.set(guildId, new Map<string, TranscriptData>());
    }
    
    const guildTranscripts = transcripts.get(guildId)!;
    
    // Get or create user transcript data
    if (!guildTranscripts.has(userId)) {
        guildTranscripts.set(userId, {
            userId,
            displayName,
            messages: [],
            startTime: new Date()
        });
    }
    
    const userTranscript = guildTranscripts.get(userId)!;
    
    // Add message to transcript
    userTranscript.messages.push({
        text,
        timestamp: new Date()
    });
    
    console.log(`📝 Added transcript message for ${displayName}: ${text}`);
}

/**
 * Generate a transcript for a guild
 */
export async function generateTranscript(guildId: string, client: Client): Promise<string | null> {
    const guildTranscripts = transcripts.get(guildId);
    if (!guildTranscripts || guildTranscripts.size === 0) {
        console.log(`⚠️ No transcript data found for guild ${guildId}`);
        return null;
    }
    
    console.log(`📄 Generating transcript for guild ${guildId} with ${guildTranscripts.size} speakers`);
    
    // Collect all messages from all users
    const allMessages: {
        userId: string;
        displayName: string;
        text: string;
        timestamp: Date;
    }[] = [];
    
    guildTranscripts.forEach((userData, userId) => {
        userData.messages.forEach(message => {
            allMessages.push({
                userId,
                displayName: userData.displayName,
                text: message.text,
                timestamp: message.timestamp
            });
        });
    });
    
    // Sort messages by timestamp
    allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Generate transcript text
    let transcript = '';
    let currentSpeaker = '';
    
    allMessages.forEach(message => {
        if (message.displayName !== currentSpeaker) {
            transcript += `\n\nSpeaker @${message.displayName}: `;
            currentSpeaker = message.displayName;
        }
        transcript += `${message.text} `;
    });
    
    // Clear transcript data for this guild
    transcripts.delete(guildId);
    
    return transcript.trim();
}

/**
 * Generate a summary of a transcript using Claude
 */
export async function generateSummary(transcript: string): Promise<string | null> {
    if (!claudeApiKey || !anthropic) {
        console.error('❌ No Claude API key found in auth.json or client initialization failed!');
        return null;
    }
    
    console.log(`🤖 Generating summary using Claude...`);
    
    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-latest',
            max_tokens: 8000,
            system: `You are a helpful assistant that converts raw meeting transcripts among colleageues at the company Sacra into a clear, concise summary. YOUR SUMMARY MUST BE 250 WORDS MAXIMUM.

Your goal is to produce a well-structured Markdown summary in this style:

### High-Level Overview
- Summarize the overall purpose and context of the conversation.
- List any key topics or themes that emerged.
### Key Discussion Points
- Organize the main ideas under headings or bullet points.
- Capture essential details and reasoning behind any decisions.
### Decisions & Outcomes
- Clearly state any final decisions, agreements, or conclusions reached.
- Note any unresolved questions or open items that need follow-up.

Instructions:
- Use H3 headings and bullet points to keep the notes scannable and organized.
- No line breaks between sections.
- Be concise—avoid unnecessary repetition or filler text.
- If participants mention specific data, numbers, or technical details, include them accurately.
- If there's any ambiguity in the transcript, indicate that clarification is needed.
- Write in a neutral, professional tone.

BEGIN YOUR RESPONSE WITH THE HIGH-LEVEL OVERVIEW. DO NOT ADD ANY PREFACE OR MENTION THE FACT THAT YOU'RE STARTING YOUR SUMMARY. DO NOT START WITH A "### SUMMARY" HEADER OR A "SUMMARY:" OR ANYTHING LIKE THAT.`,
            messages: [
                {
                    role: 'user',
                    content: transcript
                }
            ]
        });
        
        // Check if the content is a text block
        if (response.content[0].type === 'text') {
            const summary = response.content[0].text;
            console.log(`✅ Generated summary (${summary.length} chars)`);
            return summary;
        } else {
            console.error('❌ Unexpected response format from Claude');
            return null;
        }
    } catch (error) {
        console.error(`❌ Error generating summary: ${error}`);
        return null;
    }
}

/**
 * Generate a title for a meeting using Claude
 */
export async function generateTitle(summary: string): Promise<string> {
    if (!claudeApiKey || !anthropic) {
        console.error('❌ No Claude API key found in auth.json or client initialization failed!');
        return `Meeting Transcript (${new Date().toLocaleDateString()})`;
    }
    
    console.log(`🏷️ Generating title using Claude...`);
    
    try {
        const date = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        
        const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-latest',
            max_tokens: 50,
            system: `You are a helpful assistant that creates concise, descriptive titles for meeting summaries.
                
Instructions:
1. Read the meeting summary and identify the main topic or purpose of the meeting.
2. Create a title that is brief (3-5 words) but descriptive of the meeting content.
3. Include the date (${date}) in parentheses at the end of the title.
4. Format should be: "Main Topic (${date})"
5. Examples: "Product Roadmap Discussion (${date})", "Team Standup Meeting (${date})", "Client Onboarding Call (${date})"

Your response should ONLY include the title, nothing else.`,
            messages: [
                {
                    role: 'user',
                    content: summary
                }
            ]
        });
        
        // Check if the content is a text block
        if (response.content[0].type === 'text') {
            const title = response.content[0].text.trim();
            console.log(`✅ Generated title: ${title}`);
            return title;
        } else {
            console.error('❌ Unexpected response format from Claude');
            return `Meeting Transcript (${new Date().toLocaleDateString()})`;
        }
    } catch (error) {
        console.error(`❌ Error generating title: ${error}`);
        return `Meeting Transcript (${new Date().toLocaleDateString()})`;
    }
}

/**
 * Request a more concise summary from Claude
 */
async function getCondensedSummary(summary: string, maxWords: number): Promise<string | null> {
    if (!claudeApiKey || !anthropic) {
        console.error('❌ No Claude API key found in auth.json or client initialization failed!');
        return null;
    }
    
    console.log(`🤖 Requesting condensed summary (max ${maxWords} words) using Claude...`);
    
    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-latest',
            max_tokens: 4000,
            system: `You are a skilled assistant that condenses meeting summaries into shorter versions while preserving the most important information. 
            
Your task is to condense the provided summary to be no more than ${maxWords} words maximum, while maintaining the following structure:

### High-Level Overview
- Essential context and purpose
### Key Discussion Points
- Only the most critical information
### Decisions & Outcomes
- Only definitive decisions and immediate action items

Instructions:
- Use H3 headings and bullet points.
- Be extremely concise and direct.
- Prioritize decisions and action items over general discussion.
- Remove all repetition and non-essential details.
- Maintain professional tone.

BEGIN YOUR RESPONSE WITH THE HIGH-LEVEL OVERVIEW WITHOUT ANY PREFACE.`,
            messages: [
                {
                    role: 'user',
                    content: summary
                }
            ]
        });
        
        // Check if the content is a text block
        if (response.content[0].type === 'text') {
            const condensedSummary = response.content[0].text;
            console.log(`✅ Generated condensed summary (${condensedSummary.length} chars)`);
            return condensedSummary;
        } else {
            console.error('❌ Unexpected response format from Claude');
            return null;
        }
    } catch (error) {
        console.error(`❌ Error generating condensed summary: ${error}`);
        return null;
    }
}

/**
 * Send transcript and summary to the transcript channel
 */
export async function sendTranscriptAndSummary(
    client: Client,
    guildId: string,
    transcript: string,
    summary: string,
    title: string,
    recordedUsers: string[]
) {
    try {
        // Log the Claude-generated summary
        console.log(`🤖 Claude-generated summary:\n${summary}`);
        
        // Get the transcript channel
        const transcriptChannel = await getTranscriptChannel(client);
        if (!transcriptChannel) {
            console.error(`❌ Could not find transcript channel`);
            return;
        }
        
        // Prepare summary content
        let summaryContent = `**${title}**\n\n**Recording finished for:** ${recordedUsers.join(', ')}\n\n**Summary:**\n${summary}`;
        
        // Check if the message exceeds Discord's character limit (1950 to leave some buffer)
        const DISCORD_CHAR_LIMIT = 1950;
        let attempts = 0;
        const MAX_ATTEMPTS = 3;
        let currentSummary = summary;
        
        while (summaryContent.length > DISCORD_CHAR_LIMIT && attempts < MAX_ATTEMPTS) {
            console.log(`⚠️ Summary content exceeds Discord character limit (${summaryContent.length} > ${DISCORD_CHAR_LIMIT})`);
            
            attempts++;
            // Calculate a reasonable word count target (roughly 75% of current length each time)
            const currentWordCount = currentSummary.split(/\s+/).length;
            const targetWordCount = Math.floor(currentWordCount * 0.75);
            
            console.log(`🔄 Attempt ${attempts}/${MAX_ATTEMPTS}: Requesting condensed summary (${targetWordCount} words)`);
            
            // Get a more condensed summary
            const condensedSummary = await getCondensedSummary(currentSummary, targetWordCount);
            
            if (condensedSummary) {
                currentSummary = condensedSummary;
                summaryContent = `**${title}**\n\n**Recording finished for:** ${recordedUsers.join(', ')}\n\n**Summary:**\n${currentSummary}`;
                console.log(`📏 New summary content length: ${summaryContent.length} chars`);
            } else {
                // If we can't get a condensed summary, break the loop and we'll handle it below
                console.error('❌ Failed to condense summary');
                break;
            }
        }
        
        // If still too long after all attempts, truncate with notice
        if (summaryContent.length > DISCORD_CHAR_LIMIT) {
            console.warn(`⚠️ Still exceeding Discord limit after ${attempts} attempts. Truncating.`);
            summaryContent = summaryContent.substring(0, DISCORD_CHAR_LIMIT - 100) + 
                '\n\n*[Summary truncated due to Discord character limit. See full transcript file for details.]*';
        }
        
        // Send summary
        await transcriptChannel.send(summaryContent);
        
        // Format the transcript in markdown
        const transcriptMd = `# ${title}\n\n${transcript}`;
        
        // Create transcript file
        const transcriptDir = path.join(process.cwd(), 'transcripts');
        if (!fs.existsSync(transcriptDir)) {
            fs.mkdirSync(transcriptDir, { recursive: true });
        }
        
        const filename = `transcript-${Date.now()}.md`;
        const filepath = path.join(transcriptDir, filename);
        
        fs.writeFileSync(filepath, transcriptMd);
        
        // Create file attachment
        const attachment = new AttachmentBuilder(filepath, { name: filename });
        
        // Send the transcript file
        await transcriptChannel.send({
            content: '**Full Transcript:**',
            files: [attachment]
        });
        
        console.log(`✅ Sent transcript and summary to ${transcriptChannel.name}`);
        return true;
    } catch (error) {
        console.error(`❌ Error sending transcript and summary: ${error}`);
        return false;
    }
} 