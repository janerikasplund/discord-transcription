import { EndBehaviorType, VoiceReceiver } from '@discordjs/voice';
import { Webhook } from 'discord.js';
import { pipeline } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { addTranscriptMessage } from './transcriptManager';
import { ensureDirectoryExists } from './utils';
import config from './config';

// Get Deepgram token from config
const { deepgram_token } = config;

// Validate Deepgram token
if (!deepgram_token) {
	console.error('❌ ERROR: No Deepgram API token found!');
	console.error('Please add your Deepgram API key to your configuration');
}

console.log('🔑 Initializing Deepgram client with token:', deepgram_token ? `${deepgram_token.substring(0, 8)}...` : 'MISSING');

// Create a Deepgram client
let deepgram;
try {
	deepgram = createClient(deepgram_token);
	console.log('✅ Deepgram client initialized successfully');
} catch (error) {
	console.error('❌ Failed to initialize Deepgram client:', error);
	throw error; // Re-throw to prevent the application from continuing with a broken Deepgram client
}

// Ensure recordings directory exists
ensureDirectoryExists('./recordings');

export function createListeningStream(
	webhook: Webhook,
	recording: Set<string>,
	receiver: VoiceReceiver,
	userId: string,
	displayName: string,
	avatarUrl: string,
	guildId?: string,
) {
	console.log(`🚀 Starting transcription for ${displayName} (${userId})`);
	console.log(`🔗 Using webhook: ${webhook.id} in channel: ${webhook.channelId}`);

	// Create a flag to track if we've already cleaned up
	let hasCleanedUp = false;

	// Create a cleanup function to ensure we only clean up once
	const cleanup = () => {
		if (hasCleanedUp) return;
		hasCleanedUp = true;

		console.log(`🧹 Cleaning up resources for ${displayName}`);
		
		// Remove from recording set
		if (recording.has(userId)) {
			recording.delete(userId);
			console.log(`✅ Removed ${displayName} from recording set`);
		}

		// Try to close Deepgram connection if it exists and is open
		if (deepgramLive && deepgramLive.getReadyState() === 1) {
			try {
				deepgramLive.finish();
				console.log(`✅ Gracefully closed Deepgram connection for ${displayName}`);
			} catch (error) {
				console.error(`❌ Error closing Deepgram connection: ${error}`);
			}
		}
	};

	const opusStream = receiver.subscribe(userId, {
		end: {
			behavior: EndBehaviorType.AfterSilence,
			duration: 1000,
		},
	});

	console.log(`👂 Started recording ${displayName}`);

	const filename = `./recordings/${Date.now()}-${userId}.pcm`;
	console.log(`📁 Writing to file: ${filename}`);

	const out = createWriteStream(filename);

	// Handle errors on the output stream
	out.on('error', (err) => {
		console.error(`🔥 Error on output stream for ${filename}: ${err.message}`);
		// Don't close the stream here, let the pipeline handle it
	});

	// Handle file stream close
	out.on('close', () => {
		console.log(`📁 File stream closed for ${filename}`);
	});

	opusStream.on('data', (data) => {
		// Removed verbose log about received audio data
	});

	// Handle errors on the opus stream
	opusStream.on('error', (err) => {
		console.error(`🔥 Error on opus stream for ${displayName}: ${err.message}`);
		// Don't close the stream here, let the pipeline handle it
	});

	pipeline(opusStream, out, (err) => {
		if (err) {
			// Check if it's a "Premature close" error, which is common when users disconnect
			if (err.message === 'Premature close') {
				console.log(`ℹ️ User ${displayName} disconnected, recording ended normally.`);
			} else {
				console.warn(`❌ Error recording file ${filename} - ${err.message}`);
			}
		} else {
			console.log(`✅ Recorded ${filename}`);
		}
		
		// Run cleanup when the pipeline ends
		cleanup();
	});

	// Create a websocket connection to Deepgram using the new SDK pattern
	const deepgramLive = deepgram.listen.live({
		punctuate: true,
		interim_results: false,
		language: 'en-US',
		model: 'nova-3',
		smart_format: true,
		keyterm: ['Sacra', 'Pinegrove', 'Augment', 'Caplight', 'Forerunner', 'Decades', 'Goodfin'],
		encoding: 'opus',
		channels: 1,
		sample_rate: 48000,
	});

	// Listen for the connection to open and send streaming audio to Deepgram
	deepgramLive.on(LiveTranscriptionEvents.Open, () => {
		console.log(`🎙️ Connected to Deepgram for ${displayName}`);
		console.log(`🔧 Using model: nova-3 with smart_format enabled`);

		if (opusStream.readable) {
			console.log(`🔄 Audio stream is readable, will forward data to Deepgram`);
			opusStream.on('data', (data: Buffer) => {
				if (deepgramLive.getReadyState() === 1) {
					// Removed verbose log about sending bytes to Deepgram
					deepgramLive.send(data);
				} else {
					console.log(`⚠️ Deepgram connection not ready, state: ${deepgramLive.getReadyState()}`);
				}
			});
		} else {
			console.error(`❌ Audio stream is not readable for ${displayName}`);
		}
	});

	// Listen for transcripts from Deepgram
	deepgramLive.on(LiveTranscriptionEvents.Transcript, (transcript) => {
		console.log(`📥 Received transcript data from Deepgram`);
		console.log(JSON.stringify(transcript, null, 2));
		
		// Check if we have a transcript with content
		if (transcript.channel?.alternatives?.[0]?.transcript) {
			const text = transcript.channel.alternatives[0].transcript;
			console.log(`🔊 ${displayName}: ${text}`);

			// We're no longer sending real-time transcripts to Discord
			// Instead, just accumulate them for the final transcript
			
			// Add to transcript manager if guildId is provided
			if (guildId) {
				addTranscriptMessage(guildId, userId, displayName, text);
				console.log(`✅ Added message to transcript (not streaming to Discord)`);
			}
		} else {
			console.log(`⚠️ Received empty transcript from Deepgram`);
		}
	});

	// Listen for connection close
	deepgramLive.on(LiveTranscriptionEvents.Close, () => {
		console.log(`🔌 Connection to Deepgram closed for ${displayName}`);
		
		// Run cleanup when Deepgram connection closes
		cleanup();
	});

	// Listen for connection errors
	deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
		console.error(`🔥 Deepgram error for ${displayName}:`, error);
		
		// Don't run cleanup here, let the close event handle it
	});

	// Handle the end of the audio stream
	opusStream.on('end', () => {
		console.log(`🏁 Stream ended for ${displayName}`);
		
		try {
			// Gracefully finish the Deepgram connection
			if (deepgramLive.getReadyState() === 1) {
				deepgramLive.finish();
				console.log(`✅ Successfully finished Deepgram connection for ${displayName}`);
			}
		} catch (error) {
			console.error(`❌ Error finishing Deepgram connection for ${displayName}:`, error);
		}
		
		// Run cleanup when the stream ends
		cleanup();
	});
	
	// Handle process exit to ensure cleanup
	process.on('SIGINT', () => {
		console.log(`⚠️ Process interrupted, cleaning up for ${displayName}`);
		cleanup();
	});
	
	process.on('SIGTERM', () => {
		console.log(`⚠️ Process terminated, cleaning up for ${displayName}`);
		cleanup();
	});
}
