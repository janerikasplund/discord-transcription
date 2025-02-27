import { EndBehaviorType, VoiceReceiver } from '@discordjs/voice';
import { Webhook } from 'discord.js';
import { pipeline } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const { deepgram_token } = require('../auth.json');

// Validate Deepgram token
if (!deepgram_token) {
	console.error('❌ ERROR: No Deepgram API token found in auth.json!');
	console.error('Please add your Deepgram API key as "deepgram_token" in auth.json');
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

export function createListeningStream(
	webhook: Webhook,
	recording: Set<string>,
	receiver: VoiceReceiver,
	userId: string,
	displayName: string,
	avatarUrl: string,
) {
	console.log(`🚀 Starting transcription for ${displayName} (${userId})`);
	console.log(`🔗 Using webhook: ${webhook.id} in channel: ${webhook.channelId}`);

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

	opusStream.on('data', (data) => {
		console.log(`📊 Received audio data from ${displayName}: ${data.length} bytes`);
	});

	pipeline(opusStream, out, (err) => {
		if (err) {
			console.warn(`❌ Error recording file ${filename} - ${err.message}`);
		} else {
			console.log(`✅ Recorded ${filename}`);
		}
		recording.delete(userId);
	});

	// Create a websocket connection to Deepgram using the new SDK pattern
	const deepgramLive = deepgram.listen.live({
		punctuate: true,
		interim_results: false,
		language: 'en-US',
		model: 'nova-3',
		smart_format: true,
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
					console.log(`📤 Sending ${data.length} bytes to Deepgram`);
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

			// Send the transcript to the Discord channel
			webhook.send({
				content: text,
				username: displayName,
				avatarURL: avatarUrl,
			}).then(() => {
				console.log(`✅ Sent message to Discord via webhook`);
			}).catch(error => {
				console.error(`❌ Error sending webhook message:`, error);
			});
		} else {
			console.log(`⚠️ Received empty transcript from Deepgram`);
		}
	});

	// Listen for connection close
	deepgramLive.on(LiveTranscriptionEvents.Close, () => {
		console.log(`🔌 Connection to Deepgram closed for ${displayName}`);
	});

	// Listen for connection errors
	deepgramLive.on(LiveTranscriptionEvents.Error, (error) => {
		console.error(`🔥 Deepgram error for ${displayName}:`, error);
	});

	// Handle the end of the audio stream
	opusStream.on('end', () => {
		console.log(`🏁 Stream ended for ${displayName}`);
		deepgramLive.finish();
	});
}
