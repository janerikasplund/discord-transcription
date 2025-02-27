# Discord Voice Transcript Bot - Product Requirements Document (NodeJS Version)

## Product Overview

The Discord Voice Transcript Bot automatically records, transcribes, and summarizes voice conversations in Discord servers using a streaming architecture. This NodeJS implementation leverages Deepgram's real-time streaming API for continuous transcription while maintaining the same user experience as the Python version.

## Core Technical Requirements

### Streaming Audio Architecture

1. **Real-time Audio Capture**
   - Capture Discord voice data as continuous audio streams per user
   - Maintain separate audio streams for each participant for speaker attribution
   - Process audio in real-time rather than waiting for recording completion

2. **Deepgram Streaming Integration**
   - Use Deepgram's streaming API endpoint instead of the pre-recorded audio endpoint
   - Establish WebSocket connections to Deepgram for each active speaker
   - Stream audio chunks continuously as they become available
   - Process transcription results as they arrive in real-time

3. **Continuous Transcription Processing**
   - Accumulate transcription results during the recording session
   - Handle word-level data with timestamps and speaker information
   - Maintain proper ordering of transcribed content from multiple speakers

## Core User Experience (Unchanged)

### Automatic Recording

The bot intelligently monitors voice channels and automatically manages the recording process:

1. **Automatic Join & Recording Start**
   - When a second person joins a voice channel (creating a 2+ person conversation), the bot automatically joins the channel
   - Streaming and transcription begins immediately without any manual commands
   - A notification message is sent to a designated transcript channel: "🔴 Automatically started recording in [channel name] as [number] members are present: [member names]"

2. **Automatic Recording Stop**
   - When members leave and only one person remains in the voice channel, streaming stops automatically
   - The bot disconnects from the voice channel
   - Final processing of the accumulated transcription begins immediately

3. **Manual Controls (Optional)**
   - Users can manually start recording with the `/record` command
   - Users can manually stop recording with the `/stop_recording` command

### Transcription Process

The streaming architecture changes how transcription is processed internally:

1. **Real-time Audio Processing**
   - Audio is streamed to Deepgram's API as it's captured
   - Interim transcription results are received and processed during the conversation
   - Final transcription is compiled from accumulated streaming results

2. **Transcript Generation**
   - A complete transcript is generated with clear speaker attribution
   - Format: "Speaker @username: [transcribed text]"
   - Punctuation and formatting are automatically applied

### AI Summary Generation

The bot leverages Claude (Anthropic) to create a concise, structured summary:

1. **Summary Structure**
   - **High-Level Overview**: Overall purpose and key themes
   - **Key Discussion Points**: Main ideas organized with bullet points
   - **Decisions & Outcomes**: Conclusions and action items

2. **Title Generation**
   - An appropriate title is generated based on the meeting content
   - Format: "Main Topic (MM/DD/YYYY)"

### Results Delivery

The completed transcript and summary are delivered to users:

1. **Channel Delivery**
   - Both the summary and full transcript are sent to a designated transcript channel
   - Summary appears first, followed by the full transcript as a Markdown file

2. **Format**
   - Summary: Formatted text message with clear sections
   - Transcript: Markdown file with speaker attribution

## Implementation Considerations

1. **Memory Management**
   - Implement efficient buffering of streaming audio data
   - Properly manage WebSocket connections to prevent memory leaks
   - Handle accumulated transcription data efficiently during long sessions

2. **Error Handling**
   - Implement robust reconnection logic for WebSocket disconnections
   - Handle streaming API errors gracefully
   - Maintain partial results in case of service interruptions

3. **Performance Optimization**
   - Optimize audio encoding for streaming to reduce bandwidth
   - Implement efficient speaker diarization with the streaming API
   - Balance real-time processing with system resource constraints

4. **Concurrency Management**
   - Support multiple simultaneous recording sessions (up to 5)
   - Manage multiple WebSocket connections efficiently
   - Ensure proper isolation between different voice channel recordings

## Limitations

- Maximum recording length: 1 hour per session
- Maximum concurrent recordings: 5 across all servers
- Requires at least 2 participants to begin recording
- Requires clear audio for optimal transcription quality
- Network stability is more critical for streaming implementation

## Privacy Considerations

- The bot clearly indicates when recording is active with a "🔴 Listening to this conversation" message
- Recordings automatically stop when conversations end
- Transcripts are only shared in the designated transcript channel

# Code Example from Python 

import discord
from dotenv import load_dotenv
from os import environ as env
from deepgram import DeepgramClient, PrerecordedOptions, FileSource
from anthropic import AsyncAnthropic
import io
import logging
from logging.handlers import RotatingFileHandler
import datetime
import asyncio
import random
import sys
import signal
from functools import wraps
from supabase import create_client, Client
import threading

# Load environment variables
load_dotenv()

# =============== CONFIGURATION ===============

class Config:
    # Discord settings
    TRANSCRIPT_CHANNEL_ID = 740936087412801617
    
    # Recording limits
    MAX_RECORDING_LENGTH = 60 * 60  # 1 hour in seconds
    MAX_CONCURRENT_RECORDINGS = 5
    INACTIVE_TIMEOUT = 60 * 5  # 5 minutes of silence
    CHUNK_DURATION = 60 * 5  # 5 minutes per chunk
    
    # API retry settings
    MAX_RETRIES = 3
    INITIAL_BACKOFF = 1  # Initial backoff in seconds
    MAX_BACKOFF = 60  # Maximum backoff in seconds
    
    # Deepgram configuration
    DEEPGRAM_MODEL = "nova-3"
    
    # Claude configuration
    CLAUDE_MODEL = "claude-3-7-sonnet-latest"
    CLAUDE_MAX_TOKENS = 8000
    
    # Audio settings
    MIN_AUDIO_SIZE = 1000  # Minimum size in bytes to consider audio not empty
    
    # Supabase configuration
    SUPABASE_TABLE = "transcripts"
    CONFIG_TABLE = "bot_config"  # Correct table name for configuration
    
    # Heroku configuration
    PORT = int(env.get("PORT", 8080))
    
    @classmethod
    async def refresh_from_db(cls, supabase_client=None):
        """Refresh configuration from the database"""
        if not supabase_client:
            # Use global supabase client if not provided
            global supabase
            supabase_client = supabase
            
        try:
            logger.info("Refreshing configuration from database")
            # Fetch the most recent settings from the database
            response = supabase_client.table(cls.CONFIG_TABLE).select("*").order("updated_at", desc=True).limit(1).execute()
            
            if hasattr(response, 'data') and response.data and len(response.data) > 0:
                settings = response.data[0]
                logger.info(f"Found settings in database: {settings}")
                
                # Update configuration values from database
                if 'transcript_channel_id' in settings and settings['transcript_channel_id']:
                    cls.TRANSCRIPT_CHANNEL_ID = int(settings['transcript_channel_id'])
                    logger.info(f"Updated TRANSCRIPT_CHANNEL_ID to {cls.TRANSCRIPT_CHANNEL_ID}")
                
                if 'max_recording_length' in settings and settings['max_recording_length']:
                    cls.MAX_RECORDING_LENGTH = int(settings['max_recording_length'])
                
                if 'max_concurrent_recordings' in settings and settings['max_concurrent_recordings']:
                    cls.MAX_CONCURRENT_RECORDINGS = int(settings['max_concurrent_recordings'])
                
                if 'inactive_timeout' in settings and settings['inactive_timeout']:
                    cls.INACTIVE_TIMEOUT = int(settings['inactive_timeout'])
                
                if 'deepgram_model' in settings and settings['deepgram_model']:
                    cls.DEEPGRAM_MODEL = settings['deepgram_model']
                
                if 'claude_model' in settings and settings['claude_model']:
                    cls.CLAUDE_MODEL = settings['claude_model']
                
                if 'claude_max_tokens' in settings and settings['claude_max_tokens']:
                    cls.CLAUDE_MAX_TOKENS = int(settings['claude_max_tokens'])
                
                if 'min_audio_size' in settings and settings['min_audio_size']:
                    cls.MIN_AUDIO_SIZE = int(settings['min_audio_size'])
                
                if 'supabase_table' in settings and settings['supabase_table']:
                    cls.SUPABASE_TABLE = settings['supabase_table']
                
                logger.info("Configuration refreshed successfully")
                return True
            else:
                logger.warning("No settings found in database")
                return False
        except Exception as e:
            logger.error(f"Error refreshing configuration from database: {e}", exc_info=True)
            return False

# =============== LOGGING SETUP ===============

def setup_logging():
    """Set up enhanced logging with file rotation and console output"""
    log_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    console_handler.setLevel(logging.INFO)
    
    # File handler with rotation
    file_handler = RotatingFileHandler(
        'transcript_bot.log',
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5
    )
    file_handler.setFormatter(log_formatter)
    file_handler.setLevel(logging.DEBUG)
    
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    # Clear any existing handlers to prevent duplicate logging
    if root_logger.handlers:
        root_logger.handlers.clear()
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)
    
    # Return the main application logger
    logger = logging.getLogger('transcript_bot')
    # Prevent propagation to root logger to avoid duplicate logs
    logger.propagate = False
    return logger

# =============== UTILITY FUNCTIONS ===============

logger = setup_logging()

def async_retry_with_backoff(max_retries=Config.MAX_RETRIES, initial_backoff=Config.INITIAL_BACKOFF, 
                             max_backoff=Config.MAX_BACKOFF, exceptions=(Exception,)):
    """Retry decorator with exponential backoff for async functions"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            retries = 0
            backoff = initial_backoff
            
            while True:
                try:
                    return await func(*args, **kwargs)
                except exceptions as e:
                    retries += 1
                    if retries > max_retries:
                        logger.error(f"Max retries exceeded for {func.__name__}: {e}")
                        raise
                    
                    # Calculate backoff with jitter
                    backoff = min(max_backoff, backoff * 2)
                    sleep_time = backoff + random.uniform(0, 1)
                    
                    logger.warning(f"Retry {retries}/{max_retries} for {func.__name__} after {sleep_time:.2f}s. Error: {e}")
                    await asyncio.sleep(sleep_time)
        
        return wrapper
    return decorator

def is_audio_empty(audio_data):
    """Check if audio data is empty or just silence"""
    if len(audio_data) < Config.MIN_AUDIO_SIZE:
        return True
    
    # More sophisticated silence detection could be added here
    return False

# =============== SUPABASE INTEGRATION ===============

# Initialize Supabase client
supabase_url = env.get("SUPABASE_URL")
supabase_key = env.get("SUPABASE_KEY")
supabase: Client = create_client(supabase_url, supabase_key)

@async_retry_with_backoff(max_retries=Config.MAX_RETRIES)
async def generate_title(client, summary, date=None):
    """Generate a title for the meeting using Anthropic based on the summary"""
    logger.info("Generating title for meeting using Claude based on summary")
    
    if date is None:
        date = datetime.datetime.now().strftime("%m/%d/%Y")
    
    system_prompt = f"""
    You are a helpful assistant that creates concise, descriptive titles for meeting summaries.
    
    Instructions:
    1. Read the meeting summary and identify the main topic or purpose of the meeting.
    2. Create a title that is brief (3-5 words) but descriptive of the meeting content.
    3. Include the date ({date}) in parentheses at the end of the title.
    4. Format should be: "Main Topic ({date})"
    5. Examples: "Product Roadmap Discussion ({date})", "Team Standup Meeting ({date})", "Client Onboarding Call ({date})"
    
    Your response should ONLY include the title, nothing else.
    """
    
    try:
        # Call Claude API
        message = await client.messages.create(
            model=Config.CLAUDE_MODEL,
            max_tokens=50,  # Small limit since we only need a title
            system=system_prompt,
            messages=[
                {
                    "role": "user", 
                    "content": summary  # Use the entire summary
                }
            ]
        )
        
        # Extract title
        title = message.content[0].text.strip()
        logger.info(f"Generated title: {title}")
        
        return title
    except Exception as e:
        logger.error(f"Error generating title with Claude: {e}")
        # Fallback title if generation fails
        return f"Meeting Transcript ({date})"

async def save_to_supabase(transcript, summary, title, recorded_users, words_list):
    """Save transcript and summary to Supabase database"""
    try:
        logger.info(f"Saving transcript and summary to Supabase table: {Config.SUPABASE_TABLE}")
        
        # Format the transcript in markdown
        transcript_md = "# Voice Chat Transcript\n\n"
        current_speaker = None
        
        for word in words_list:
            if "speaker" in word and word["speaker"] != current_speaker:
                transcript_md += f"\n\n### Speaker <@{word['speaker']}>\n"
                current_speaker = word["speaker"]
            transcript_md += f"{word['punctuated_word']} "
        
        # Prepare data for Supabase
        data = {
            "title": title,
            "transcript": transcript,
            "transcript_formatted": transcript_md,
            "summary": summary,
            "participants": ", ".join(recorded_users),
            "created_at": datetime.datetime.now().isoformat(),
        }
        
        # Insert data into Supabase
        response = supabase.table(Config.SUPABASE_TABLE).insert(data).execute()
        
        if hasattr(response, 'error') and response.error:
            logger.error(f"Error saving to Supabase: {response.error}")
            return False
        
        logger.info(f"Successfully saved transcript to Supabase with title: {title}")
        return True
    
    except Exception as e:
        logger.error(f"Error saving to Supabase: {e}", exc_info=True)
        return False

# =============== RECORDING MANAGER ===============

class RecordingManager:
    """Manages active voice recordings"""
    
    def __init__(self):
        self.active_recordings = {}  # guild_id -> recording_data
        self.recording_timers = {}   # guild_id -> asyncio.Task
    
    def add_recording(self, guild_id, vc, notification=None, channel=None):
        """Add a new recording session"""
        start_time = datetime.datetime.now()
        
        # Store recording data
        self.active_recordings[guild_id] = {
            "vc": vc,
            "notification": notification,
            "start_time": start_time,
            "channel": channel
        }
        
        # Set up timeout timer
        self.recording_timers[guild_id] = asyncio.create_task(
            self._recording_timeout(guild_id, start_time)
        )
        
        logger.info(f"Recording started in guild {guild_id} at {start_time}")
        return self.active_recordings[guild_id]
    
    async def stop_recording(self, guild_id):
        """Stop an active recording"""
        if guild_id in self.active_recordings:
            # Cancel the timeout timer
            if guild_id in self.recording_timers:
                self.recording_timers[guild_id].cancel()
                del self.recording_timers[guild_id]
            
            # Get recording data
            recording_data = self.active_recordings[guild_id]
            
            # Stop recording if it's still active
            try:
                recording_data["vc"].stop_recording()
                logger.info(f"Recording stopped for guild {guild_id}")
            except Exception as e:
                logger.error(f"Error stopping recording for guild {guild_id}: {e}")
            
            # Clean up
            del self.active_recordings[guild_id]
            return recording_data
        
        return None
    
    async def _recording_timeout(self, guild_id, start_time):
        """Automatically stop recording after MAX_RECORDING_LENGTH"""
        try:
            # Wait until max recording time is reached
            await asyncio.sleep(Config.MAX_RECORDING_LENGTH)
            
            # Check if recording is still active
            if guild_id in self.active_recordings:
                logger.warning(f"Recording in guild {guild_id} reached maximum length of {Config.MAX_RECORDING_LENGTH}s, stopping")
                recording_data = await self.stop_recording(guild_id)
                
                # Notify the channel
                if recording_data and recording_data["channel"]:
                    try:
                        await recording_data["channel"].send("⚠️ Recording stopped: Maximum recording length reached.")
                    except Exception as e:
                        logger.error(f"Failed to send max length notification: {e}")
        
        except asyncio.CancelledError:
            # Task was cancelled normally, no need to log
            pass
        except Exception as e:
            logger.error(f"Error in recording timeout task for guild {guild_id}: {e}")
    
    async def start_watchdog(self):
        """Start a watchdog task to clean up stale or zombie recordings"""
        async def watchdog_task():
            while True:
                try:
                    # Check all active recordings
                    current_time = datetime.datetime.now()
                    guild_ids = list(self.active_recordings.keys())
                    
                    for guild_id in guild_ids:
                        recording_data = self.active_recordings[guild_id]
                        start_time = recording_data["start_time"]
                        duration = (current_time - start_time).total_seconds()
                        
                        # Check if recording has been going for too long
                        if duration > Config.MAX_RECORDING_LENGTH:
                            logger.warning(f"Watchdog detected stale recording in guild {guild_id} running for {duration:.1f}s")
                            await self.stop_recording(guild_id)
                            
                            # Notify if possible
                            if recording_data.get("channel"):
                                try:
                                    await recording_data["channel"].send("⚠️ Recording stopped by watchdog (exceeded time limit).")
                                except Exception:
                                    pass
                                    
                        # Check if the voice client is still connected
                        vc = recording_data["vc"]
                        if not vc.is_connected():
                            logger.warning(f"Watchdog detected zombie recording in guild {guild_id} (voice client disconnected)")
                            await self.stop_recording(guild_id)
                
                except Exception as e:
                    logger.error(f"Error in recording watchdog: {e}")
                
                # Run every minute
                await asyncio.sleep(60)
        
        # Start the watchdog task
        asyncio.create_task(watchdog_task())
    
    def get_active_count(self):
        """Get the number of active recordings"""
        return len(self.active_recordings)
    
    def is_recording(self, guild_id):
        """Check if a guild is currently being recorded"""
        return guild_id in self.active_recordings
    
    async def cleanup_all(self):
        """Stop all active recordings"""
        guild_ids = list(self.active_recordings.keys())
        for guild_id in guild_ids:
            await self.stop_recording(guild_id)

class ChunkedRecordingManager(RecordingManager):
    """Manages voice recordings split into chunks to reduce memory usage"""
    
    def __init__(self, bot=None, deepgram=None, claude_client=None, deepgram_options=None):
        super().__init__()
        self.chunks = {}  # guild_id -> list of chunk data
        self.chunk_timers = {}  # guild_id -> asyncio.Task
        self.words_by_guild = {}  # guild_id -> all processed words from all chunks
        self.recorded_users_by_guild = {}  # guild_id -> set of recorded user IDs
        
        # Store dependencies
        self.bot = bot
        self.deepgram = deepgram
        self.claude_client = claude_client
        self.deepgram_options = deepgram_options
        
    def add_recording(self, guild_id, vc, notification=None, channel=None):
        """Start a new chunked recording session"""
        # Initialize data structures for this guild
        self.chunks[guild_id] = []
        self.words_by_guild[guild_id] = []
        self.recorded_users_by_guild[guild_id] = set()
        
        # Call parent implementation for basic recording setup
        recording_data = super().add_recording(guild_id, vc, notification, channel)
        
        # Start the first chunk
        self._start_new_chunk(guild_id)
        
        return recording_data
    
    def _start_new_chunk(self, guild_id):
        """Start a new recording chunk"""
        if guild_id not in self.active_recordings:
            logger.warning(f"Cannot start new chunk: No active recording for guild {guild_id}")
            return
            
        # Get voice client
        vc = self.active_recordings[guild_id]["vc"]
        
        # Start recording this chunk
        chunk_index = len(self.chunks[guild_id])
        logger.info(f"Starting chunk #{chunk_index + 1} for guild {guild_id}")
        
        # Create sink for this chunk
        sink = discord.sinks.OGGSink()
        
        # Store chunk data
        chunk_data = {
            "start_time": datetime.datetime.now(),
            "index": chunk_index,
            "sink": sink,
            "processed": False
        }
        self.chunks[guild_id].append(chunk_data)
        
        # Start recording to this chunk's sink
        # We include a dummy callback as required by Discord.py/Py-cord
        # This won't actually be called as we manually stop recording in _process_chunk
        vc.start_recording(
            sink,
            self._chunk_callback,
            guild_id,
            chunk_index
        )
        
        # Set up timer to end this chunk
        self.chunk_timers[guild_id] = asyncio.create_task(
            self._chunk_timeout(guild_id, chunk_index)
        )
    
    async def _chunk_callback(self, sink, guild_id, chunk_index):
        """Dummy callback for chunk recording completion
        This won't normally be called as we manually stop recording in _process_chunk
        It's here as a fallback and to satisfy the API requirements"""
        logger.info(f"Chunk callback called for chunk #{chunk_index + 1} in guild {guild_id} (unexpected)")
        # We don't need to do anything here, as our chunk processing is handled by the _process_chunk method
    
    async def _chunk_timeout(self, guild_id, chunk_index):
        """End the current chunk after CHUNK_DURATION and start a new one"""
        try:
            # Wait until chunk duration is reached
            await asyncio.sleep(Config.CHUNK_DURATION)
            
            # Check if recording is still active
            if guild_id in self.active_recordings:
                # Process the completed chunk
                await self._process_chunk(guild_id, chunk_index)
                
                # Start a new chunk if we're still recording
                if guild_id in self.active_recordings:
                    self._start_new_chunk(guild_id)
        
        except asyncio.CancelledError:
            # Task was cancelled normally
            pass
        except Exception as e:
            logger.error(f"Error in chunk timeout task for guild {guild_id}: {e}")
    
    async def _process_chunk(self, guild_id, chunk_index):
        """Process a completed chunk while continuing to record"""
        try:
            if guild_id not in self.active_recordings:
                return
                
            # Get voice client and recording data
            vc = self.active_recordings[guild_id]["vc"]
            recording_data = self.active_recordings[guild_id]
            
            # Get chunk data
            chunk_data = self.chunks[guild_id][chunk_index]
            sink = chunk_data["sink"]
            
            # IMPORTANT: Make a safe copy of the audio data BEFORE stopping the recording
            # This prevents race conditions with the Discord sink cleanup
            safe_audio_data = {}
            for user_id, audio in sink.audio_data.items():
                try:
                    # Create a copy of the audio data
                    audio.file.seek(0)
                    audio_bytes = audio.file.read()
                    
                    # Only keep non-empty audio
                    if len(audio_bytes) >= Config.MIN_AUDIO_SIZE:
                        # Store in a dictionary with the same structure
                        safe_audio_data[user_id] = {
                            "bytes": audio_bytes,
                            "user_id": user_id
                        }
                except Exception as e:
                    logger.error(f"Error copying audio data for user {user_id} in chunk #{chunk_index + 1}: {e}")
            
            # Now stop the recording
            vc.stop_recording()
            logger.info(f"Stopped recording chunk #{chunk_index + 1} for guild {guild_id}")
            
            # Record the end time
            chunk_data["end_time"] = datetime.datetime.now()
            chunk_data["duration"] = (chunk_data["end_time"] - chunk_data["start_time"]).total_seconds()
            
            # Add a small delay to ensure the cleanup has completed
            await asyncio.sleep(0.5)
            
            # Process this chunk in the background using our safe copy
            asyncio.create_task(
                self._process_chunk_audio(
                    guild_id, 
                    chunk_index,
                    safe_audio_data,
                    recording_data["channel"]
                )
            )
            
        except Exception as e:
            logger.error(f"Error processing chunk #{chunk_index + 1} for guild {guild_id}: {e}")
    
    async def _process_chunk_audio(self, guild_id, chunk_index, safe_audio_data, channel):
        """Process the audio data from a single chunk"""
        # No longer importing from __main__, use instance variables instead
        try:
            logger.info(f"Processing audio from chunk #{chunk_index + 1} for guild {guild_id}")
            
            # Check if any audio was recorded
            if not safe_audio_data:
                logger.warning(f"No audio data in chunk #{chunk_index + 1} for guild {guild_id}")
                return
            
            # Track recorded users across all chunks
            for user_id in safe_audio_data.keys():
                self.recorded_users_by_guild[guild_id].add(f"<@{user_id}>")
            
            # Process each user's audio
            for user_id, audio_info in safe_audio_data.items():
                try:
                    audio_bytes = audio_info["bytes"]
                    
                    # Check if audio is empty - should be redundant but let's be safe
                    if len(audio_bytes) < Config.MIN_AUDIO_SIZE:
                        logger.warning(f"Empty audio in chunk #{chunk_index + 1} for user {user_id}")
                        continue
                    
                    # Create a BytesIO object from the audio bytes
                    audio_file = io.BytesIO(audio_bytes)
                    
                    # Prepare payload for Deepgram - use bytes directly for consistency
                    payload = {
                        "buffer": audio_file,
                    }
                    
                    # Transcribe with Deepgram
                    logger.info(f"Sending chunk #{chunk_index + 1} audio from user {user_id} to Deepgram")
                    start_time = datetime.datetime.now()
                    
                    response = await transcribe_audio(self.deepgram, payload, self.deepgram_options)
                    
                    end_time = datetime.datetime.now()
                    logger.info(f"Chunk #{chunk_index + 1} transcription completed in {(end_time - start_time).total_seconds():.2f} seconds")
                    
                    # Extract words from response
                    result = response.results.channels[0].alternatives[0]
                    words = result.words
                    
                    # Process words with speaker diarization and add time offset based on chunk
                    chunk_start_time = self.chunks[guild_id][chunk_index]["start_time"].timestamp()
                    for word in words:
                        speaker_id = word.speaker if hasattr(word, 'speaker') and word.speaker != 0 else user_id
                        
                        new_word = {
                            "word": word.word,
                            "start": word.start + chunk_start_time,  # Add chunk start time offset
                            "end": word.end + chunk_start_time,  # Add chunk start time offset
                            "confidence": word.confidence,
                            "punctuated_word": word.punctuated_word,
                            "speaker": speaker_id,
                            "speaker_confidence": getattr(word, 'speaker_confidence', 0),
                            "chunk": chunk_index  # Track which chunk this came from
                        }
                        self.words_by_guild[guild_id].append(new_word)
                
                except Exception as e:
                    logger.error(f"Error processing user {user_id} in chunk #{chunk_index + 1}: {e}")
            
            # Mark chunk as processed
            self.chunks[guild_id][chunk_index]["processed"] = True
            logger.info(f"Chunk #{chunk_index + 1} for guild {guild_id} processed, total words: {len(self.words_by_guild[guild_id])}")
            
            # We don't send progress updates to users to hide chunking implementation
            
        except Exception as e:
            logger.error(f"Error processing chunk #{chunk_index + 1} audio: {e}", exc_info=True)
    
    async def stop_recording(self, guild_id):
        """Stop an active chunked recording and process final results"""
        try:
            if guild_id not in self.active_recordings:
                return None
            
            # Cancel the current chunk timer
            if guild_id in self.chunk_timers:
                self.chunk_timers[guild_id].cancel()
                del self.chunk_timers[guild_id]
            
            # Get recording data
            recording_data = self.active_recordings[guild_id]
            
            # Process the final chunk if there are any
            if guild_id in self.chunks and self.chunks[guild_id]:
                final_chunk_index = len(self.chunks[guild_id]) - 1
                
                # Get final chunk data
                chunk_data = self.chunks[guild_id][final_chunk_index]
                sink = chunk_data["sink"]
                
                # Make a safe copy of the audio data BEFORE stopping the recording
                safe_audio_data = {}
                for user_id, audio in sink.audio_data.items():
                    try:
                        # Create a copy of the audio data
                        audio.file.seek(0)
                        audio_bytes = audio.file.read()
                        
                        # Only keep non-empty audio
                        if len(audio_bytes) >= Config.MIN_AUDIO_SIZE:
                            # Store in a dictionary with the same structure
                            safe_audio_data[user_id] = {
                                "bytes": audio_bytes,
                                "user_id": user_id
                            }
                    except Exception as e:
                        logger.error(f"Error copying audio data for user {user_id} in final chunk: {e}")
                
                # Now stop the recording
                recording_data["vc"].stop_recording()
                logger.info(f"Stopped final chunk #{final_chunk_index + 1} for guild {guild_id}")
                
                # Record end time
                chunk_data["end_time"] = datetime.datetime.now()
                
                # Add a small delay to ensure the cleanup has completed
                await asyncio.sleep(0.5)
                
                # Process the final chunk with our safe copy
                await self._process_chunk_audio(guild_id, final_chunk_index, safe_audio_data, recording_data["channel"])
            else:
                # No chunks to process, just stop recording
                try:
                    recording_data["vc"].stop_recording()
                except Exception as e:
                    logger.error(f"Error stopping recording for guild {guild_id}: {e}")
            
            # Wait for all chunks to be processed
            await self._wait_for_all_chunks(guild_id)
            
            # Generate complete transcript and summary
            await self._finalize_recording(guild_id, recording_data["channel"])
            
            # Clean up
            result = super().stop_recording(guild_id)
            
            # Clean up chunk data
            if guild_id in self.chunks:
                del self.chunks[guild_id]
            if guild_id in self.words_by_guild:
                del self.words_by_guild[guild_id]
            if guild_id in self.recorded_users_by_guild:
                del self.recorded_users_by_guild[guild_id]
            
            return result
            
        except Exception as e:
            logger.error(f"Error stopping chunked recording for guild {guild_id}: {e}", exc_info=True)
            # Try basic cleanup
            return super().stop_recording(guild_id)
    
    async def _wait_for_all_chunks(self, guild_id):
        """Wait for all chunks to be processed before finalizing"""
        try:
            if guild_id not in self.chunks:
                return
                
            chunks = self.chunks[guild_id]
            max_wait = 300  # Maximum 5 minutes to wait
            wait_interval = 1  # Check every second
            
            for i in range(max_wait):
                # Check if all chunks are processed
                if all(chunk.get("processed", False) for chunk in chunks):
                    logger.info(f"All {len(chunks)} chunks processed for guild {guild_id}")
                    return
                
                # Wait and check again
                await asyncio.sleep(wait_interval)
            
            # If we get here, not all chunks were processed in time
            unprocessed = sum(1 for chunk in chunks if not chunk.get("processed", False))
            logger.warning(f"Timed out waiting for chunks. {unprocessed}/{len(chunks)} chunks not processed for guild {guild_id}")
            
        except Exception as e:
            logger.error(f"Error waiting for chunks to process: {e}")
    
    async def _finalize_recording(self, guild_id, channel):
        """Generate final transcript and summary from all chunks"""
        # No longer importing from __main__, use instance variables
        try:
            if guild_id not in self.words_by_guild or not self.words_by_guild[guild_id]:
                logger.warning(f"No words to finalize for guild {guild_id}")
                return
                
            words_list = self.words_by_guild[guild_id]
            
            # Sort all words by timestamp
            words_list.sort(key=lambda x: x["start"])
            logger.info(f"Sorted {len(words_list)} words from all chunks by timestamp")
            
            # Get unique recorded users
            recorded_users = list(self.recorded_users_by_guild[guild_id])
            
            # Generate transcript
            transcript = build_transcript(words_list)
            logger.info(f"Generated complete transcript with {len(transcript)} characters from all chunks")
            
            # Generate summary with Claude
            try:
                summary = await generate_summary(self.claude_client, transcript)
                
                # Generate title
                title = await generate_title(self.claude_client, summary)
                
                # Send results to transcript channel
                await send_transcript_and_summary(self.bot, transcript, summary, recorded_users, words_list)
                
                # Save to Supabase
                await save_to_supabase(transcript, summary, title, recorded_users, words_list)
                
            except Exception as e:
                logger.error(f"Error in summary generation for complete recording: {e}", exc_info=True)
                
                # Try to at least send the transcript
                try:
                    transcript_channel = await get_transcript_channel(self.bot)
                    target_channel = transcript_channel or channel
                    
                    await target_channel.send(
                        f"⚠️ Recording finished but summarization failed. Here's the raw transcript:\n\n"
                        f"```\n{transcript[:1900]}...\n```"
                    )
                    
                    # Create transcript file
                    transcript_md = "# Voice Chat Transcript\n\n" + transcript
                    transcript_file = discord.File(
                        io.StringIO(transcript_md),
                        filename="transcript.md"
                    )
                    
                    await target_channel.send(file=transcript_file)
                    
                except Exception as e2:
                    logger.error(f"Failed to send fallback transcript: {e2}")
            
        except Exception as e:
            logger.error(f"Error finalizing recording: {e}", exc_info=True)
    
# =============== TRANSCRIPT PROCESSING ===============

async def get_transcript_channel(bot):
    """Get the dedicated transcript channel or None if not found"""
    # Refresh configuration from database before getting the channel
    try:
        await Config.refresh_from_db()
        logger.info(f"Using transcript channel ID from database: {Config.TRANSCRIPT_CHANNEL_ID}")
    except Exception as e:
        logger.warning(f"Failed to refresh configuration for transcript channel: {e}")
        logger.info(f"Using current transcript channel ID: {Config.TRANSCRIPT_CHANNEL_ID}")
    
    channel = bot.get_channel(Config.TRANSCRIPT_CHANNEL_ID)
    if not channel:
        logger.error(f"Transcript channel not found (ID: {Config.TRANSCRIPT_CHANNEL_ID})")
    return channel

@async_retry_with_backoff(max_retries=Config.MAX_RETRIES)
async def transcribe_audio(deepgram, payload, options):
    """Transcribe audio with Deepgram with retries"""
    try:
        if "buffer" in payload:
            # Handle BytesIO objects correctly for async client
            buffer = payload["buffer"]
            buffer.seek(0)  # Ensure we're at the start of the buffer
            audio_bytes = buffer.read()  # Read the buffer into bytes
            
            # Create a proper source object for the Deepgram API
            source = {
                "buffer": audio_bytes,
                "mimetype": "audio/ogg"  # Since we're using OGGSink
            }
            
            # Use the correct async method for buffer data
            return await deepgram.listen.asyncrest.v("1").transcribe(source, options)
        else:
            # Original method for file paths
            return await deepgram.listen.asyncrest.v("1").transcribe_file(payload, options)
    except Exception as e:
        logger.error(f"Error in transcribe_audio: {e}")
        raise

def build_transcript(words_list):
    """Build a transcript from the list of words"""
    transcript = ""
    current_speaker = None
    
    for word in words_list:
        if "speaker" in word and word["speaker"] != current_speaker:
            transcript += f"\n\nSpeaker <@{word['speaker']}>: "
            current_speaker = word["speaker"]
        transcript += f"{word['punctuated_word']} "
    
    return transcript.strip()

@async_retry_with_backoff(max_retries=Config.MAX_RETRIES)
async def generate_summary(client, transcript):
    """Generate a summary of the transcript using Claude"""
    logger.info("Sending transcript to Claude for summarization")
    start_time = datetime.datetime.now()
    
    # Claude system prompt
    system_prompt = """
    You are a helpful assistant that converts raw meeting transcripts into a clear, concise summary. YOU MUST LIMIT THE SUMMARY TO 250 WORDS MAXIMUM. Your goal is to produce a well-structured Markdown summary in this style:

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

    Here are some guidelines that can help you turn the transcripts into more meaningful notes and summaries:
    - Our company is called "Sacra". We create research on companies in the private markets and distribute it to people through our email newsletter and through API relationships with partners like Augment, Nasdaq Private Market, Caplight, and others.
    - Our team is as follows: Walter (CEO), Jan, Marcelo (Head of Research), Danny (developer) and Trey (developer).

    BEGIN YOUR RESPONSE WITH THE HIGH-LEVEL OVERVIEW. DO NOT ADD ANY PREFACE OR MENTION THE FACT THAT YOU'RE STARTING YOUR SUMMARY. DO NOT START WITH A "### SUMMARY" HEADER. DO NOT SAY ANYTHING LIKE "Here's a structured summary...
    
    YOU MUST LIMIT THE SUMMARY TO 250 WORDS MAXIMUM.
    """
    
    try:
        # Call Claude API
        message = await client.messages.create(
            model=Config.CLAUDE_MODEL,
            max_tokens=Config.CLAUDE_MAX_TOKENS,
            system=system_prompt,
            messages=[
                {
                    "role": "user", 
                    "content": transcript
                }
            ]
        )
        
        end_time = datetime.datetime.now()
        logger.info(f"Claude summarization completed in {(end_time - start_time).total_seconds():.2f} seconds")
        
        # Extract summary
        summary_text = message.content[0].text
        logger.info("Generated summary:")
        logger.info("-" * 80)
        logger.info(summary_text)
        logger.info("-" * 80)
        
        return summary_text
    except Exception as e:
        logger.error(f"Error generating summary with Claude: {e}")
        raise

async def process_audio_data(bot, deepgram, claude_client, deepgram_options, audio_data, guild_name, recorded_users, channel):
    """Process the recorded audio data with robust error handling"""
    words_list = []
    logger.info(f"Processing {len(audio_data)} audio recordings from {guild_name}")
    processed_users = 0
    
    # Process each user's audio
    for user_id, audio in audio_data.items():
        try:
            # Check if the audio is empty
            audio.file.seek(0)
            audio_bytes = audio.file.read()
            
            if is_audio_empty(audio_bytes):
                logger.warning(f"Empty or silent audio detected for user {user_id}")
                continue
            
            # Reset file position for transcription
            audio.file.seek(0)
            
            # Prepare payload for Deepgram - use bytes directly for consistency
            audio_bytes = audio.file.read()
            payload = {
                "buffer": io.BytesIO(audio_bytes),
            }
            
            # Transcribe with Deepgram (with retry built in via decorator)
            logger.info(f"Sending audio from user {user_id} to Deepgram")
            start_time = datetime.datetime.now()
            
            try:
                response = await transcribe_audio(deepgram, payload, deepgram_options)
                
                end_time = datetime.datetime.now()
                logger.info(f"Deepgram transcription completed in {(end_time - start_time).total_seconds():.2f} seconds")
                
                # Extract words from response
                result = response.results.channels[0].alternatives[0]
                words = result.words
                logger.info(f"Received {len(words)} words from Deepgram for user {user_id}")
                processed_users += 1
                
                # Process words with speaker diarization
                for word in words:
                    speaker_id = word.speaker if word.speaker != 0 else user_id
                    
                    new_word = {
                        "word": word.word,
                        "start": word.start,
                        "end": word.end,
                        "confidence": word.confidence,
                        "punctuated_word": word.punctuated_word,
                        "speaker": speaker_id,
                        "speaker_confidence": word.speaker_confidence,
                    }
                    words_list.append(new_word)
            
            except Exception as e:
                logger.error(f"Error transcribing audio for user {user_id}: {e}", exc_info=True)
                # Continue to next user if one fails
                
        except Exception as e:
            logger.error(f"Error processing audio for user {user_id}: {e}", exc_info=True)
    
    # Check if we processed any audio successfully
    if processed_users == 0:
        logger.warning(f"No audio was successfully processed from {len(audio_data)} recordings")
        
        # Get transcript channel
        transcript_channel = await get_transcript_channel(bot)
        target_channel = transcript_channel or channel
        
        await target_channel.send(
            f"⚠️ Recording finished for: {', '.join(recorded_users)}\n"
            f"Failed to process any audio. There may have been an issue with the audio quality or service availability."
        )
        return
    
    # Check if we got any words
    if not words_list:
        logger.warning(f"No words transcribed from audio in {guild_name}")
        
        # Get transcript channel
        transcript_channel = await get_transcript_channel(bot)
        target_channel = transcript_channel or channel
        
        await target_channel.send(
            f"⚠️ Recording finished for: {', '.join(recorded_users)}\n"
            f"No speech was detected. Make sure your microphone is working and users were speaking."
        )
        return
    
    # Sort words by timestamp
    words_list.sort(key=lambda x: x["start"])
    logger.info(f"Sorted {len(words_list)} words by timestamp")
    
    # Generate transcript
    transcript = build_transcript(words_list)
    logger.info(f"Generated transcript with {len(transcript)} characters")
    
    # Generate summary with Claude
    try:
        summary = await generate_summary(claude_client, transcript)
        
        # Generate title for the meeting
        title = await generate_title(claude_client, summary)
        
        # Send results to transcript channel
        await send_transcript_and_summary(bot, transcript, summary, recorded_users, words_list)
        
        # Save to Supabase
        await save_to_supabase(transcript, summary, title, recorded_users, words_list)
        
    except Exception as e:
        logger.error(f"Error in summary generation: {e}", exc_info=True)
        
        # Try to at least send the transcript
        try:
            transcript_channel = await get_transcript_channel(bot)
            target_channel = transcript_channel or channel
            
            await target_channel.send(
                f"⚠️ Recording finished but summarization failed. Here's the raw transcript:\n\n"
                f"```\n{transcript[:1900]}...\n```"
            )
            
            # Create transcript file
            transcript_md = "# Voice Chat Transcript\n\n" + transcript
            transcript_file = discord.File(
                io.StringIO(transcript_md),
                filename="transcript.md"
            )
            
            await target_channel.send(file=transcript_file)
            
        except Exception as e2:
            logger.error(f"Failed to send fallback transcript: {e2}")

async def send_transcript_and_summary(bot, transcript, summary, recorded_users, words_list):
    """Send the transcript and summary to the designated channel with error handling"""
    # Prepare summary content
    summary_content = (
        f"**Recording finished for:** {', '.join(recorded_users)}\n\n"
        f"**Summary:**\n{summary}\n\n"
        f"*This transcript and summary have been saved to the database.*"
    )
    
    # Get transcript channel
    transcript_channel = await get_transcript_channel(bot)
    if not transcript_channel:
        logger.error(f"Could not find transcript channel with ID {Config.TRANSCRIPT_CHANNEL_ID}")
        return False
    
    try:
        # Send summary
        logger.info(f"Sending summary to transcript channel (ID: {Config.TRANSCRIPT_CHANNEL_ID})")
        await transcript_channel.send(summary_content)
        
        # Format the transcript in markdown
        transcript_md = "# Voice Chat Transcript\n\n"
        current_speaker = None
        
        for word in words_list:
            if "speaker" in word and word["speaker"] != current_speaker:
                transcript_md += f"\n\n### Speaker <@{word['speaker']}>\n"
                current_speaker = word["speaker"]
            transcript_md += f"{word['punctuated_word']} "
        
        # Create file object with the transcript
        transcript_file = discord.File(
            io.StringIO(transcript_md),
            filename="transcript.md"
        )
        
        # Send the transcript file
        logger.info("Sending full transcript file to transcript channel")
        await transcript_channel.send(
            "**Full Transcript:**",
            file=transcript_file
        )
        logger.info("Transcript processing complete")
        return True
    
    except discord.Forbidden:
        logger.error(f"Bot doesn't have permission to send messages to transcript channel {Config.TRANSCRIPT_CHANNEL_ID}")
    except discord.HTTPException as e:
        logger.error(f"HTTP error sending transcript: {e}")
    except Exception as e:
        logger.error(f"Unexpected error sending transcript: {e}", exc_info=True)
    
    return False

# =============== BOT SETUP AND EVENTS ===============

def setup_bot():
    """Set up the Discord bot with all dependencies"""
    # Set up logging first
    logger = setup_logging()
    
    # Load environment variables
    load_dotenv()
    
    # Check required environment variables
    required_env_vars = ["DEEPGRAM_API_TOKEN", "ANTHROPIC_API_KEY", "DISCORD_BOT_TOKEN"]
    missing_vars = [var for var in required_env_vars if not env.get(var)]
    if missing_vars:
        logger.critical(f"Missing required environment variables: {', '.join(missing_vars)}")
        sys.exit(1)
    
    # Initialize Discord bot
    bot = discord.Bot()
    
    # Initialize API clients
    try:
        logger.info("Initializing API clients...")
        deepgram = DeepgramClient(env.get("DEEPGRAM_API_TOKEN"))
        claude_client = AsyncAnthropic(api_key=env.get("ANTHROPIC_API_KEY"))
        
        # Initialize Deepgram options
        deepgram_options = PrerecordedOptions(
            model=Config.DEEPGRAM_MODEL,
            smart_format=True,
            utterances=True,
            punctuate=True,
            diarize=True,
            detect_language=True,
        )
        
        # Initialize recording manager with chunking support and dependencies
        recording_manager = ChunkedRecordingManager(
            bot=bot,
            deepgram=deepgram,
            claude_client=claude_client,
            deepgram_options=deepgram_options
        )
        
        logger.info("API clients initialized successfully")
    except Exception as e:
        logger.critical(f"Failed to initialize API clients: {e}")
        sys.exit(1)
    
    # Load opus library with better error handling
    try:
        # For Docker environment - this should work with the installed libopus0 package
        discord.opus.load_opus("/usr/lib/x86_64-linux-gnu/libopus.so.0")
        logger.info("Loaded opus from Docker system path")
    except (discord.opus.OpusNotLoaded, OSError):
        try:
            # Try generic system path
            discord.opus.load_opus("libopus.so.0")
            logger.info("Loaded opus from system path")
        except (discord.opus.OpusNotLoaded, OSError):
            try:
                # Fallback to homebrew path (for development on macOS)
                discord.opus.load_opus("/opt/homebrew/Cellar/opus/1.5.2/lib/libopus.0.dylib")
                logger.info("Loaded opus from homebrew path")
            except (discord.opus.OpusNotLoaded, OSError) as e:
                logger.warning(f"Failed to load opus codec, voice features may not work: {e}")
                # Continue without opus - the bot will work but voice recording won't
    
    return bot, recording_manager, deepgram, claude_client, deepgram_options, logger

# =============== SIGNAL HANDLING ===============

def setup_signal_handlers(bot, recording_manager, logger):
    """Set up graceful shutdown handlers"""
    
    async def shutdown(signal_type):
        logger.info(f"Received {signal_type.name}, shutting down...")
        await recording_manager.cleanup_all()
        await bot.close()
    
    for signal_type in [signal.SIGINT, signal.SIGTERM]:
        try:
            bot.loop.add_signal_handler(
                signal_type,
                lambda s=signal_type: asyncio.create_task(shutdown(s))
            )
        except NotImplementedError:
            # Windows doesn't support POSIX signals properly
            logger.warning(f"Could not set up signal handler for {signal_type.name}")

# =============== BOT EVENT HANDLERS ===============

async def once_done(sink, channel, *args):
    """Process recorded audio once recording stops"""
    # NOTE: With ChunkedRecordingManager, this function is not used.
    # Chunked recordings are processed directly by the manager.
    # This function is kept for backwards compatibility.
    
    # Access global variables through args
    bot, recording_manager, deepgram, claude_client, deepgram_options, logger = args
    
    guild_id = sink.vc.guild.id
    guild_name = sink.vc.guild.name
    logger.info(f"Processing recording from server {guild_name} (ID: {guild_id})")
    
    # Get recording data and clean it up
    recording_data = recording_manager.active_recordings.get(guild_id, {})
    await recording_manager.stop_recording(guild_id)
    
    # Try to delete the notification message
    if recording_data and "notification" in recording_data:
        try:
            notification = recording_data["notification"]
            logger.info(f"Deleting notification message with ID: {notification.id}")
            await notification.delete()
        except Exception as e:
            logger.error(f"Failed to delete notification: {e}")
    
    # Disconnect from voice
    try:
        await sink.vc.disconnect()
        logger.info(f"Disconnected from voice channel in {guild_name}")
    except Exception as e:
        logger.error(f"Error disconnecting from voice channel: {e}")
    
    # Get recorded users
    recorded_users = [f"<@{user_id}>" for user_id, audio in sink.audio_data.items()]
    logger.info(f"Recorded {len(recorded_users)} users: {', '.join(recorded_users)}")
    
    # Check if any audio was recorded
    if not sink.audio_data:
        logger.warning(f"No audio data recorded in {guild_name}")
        
        try:
            # Get transcript channel
            transcript_channel = await get_transcript_channel(bot)
            target_channel = transcript_channel or channel
            
            await target_channel.send("⚠️ No audio was recorded. Make sure your microphone is working and users were speaking.")
        except Exception as e:
            logger.error(f"Error sending empty recording notification: {e}")
        
        return
    
    # Process audio data
    try:
        await process_audio_data(
            bot, deepgram, claude_client, deepgram_options, 
            sink.audio_data, guild_name, recorded_users, channel
        )
    except Exception as e:
        logger.error(f"Error processing audio data: {e}", exc_info=True)
        
        try:
            # Notify about the error
            await channel.send(f"⚠️ Error processing recording: {e}")
        except:
            pass

# =============== BOT COMMANDS ===============

def register_commands(bot, recording_manager, deepgram, claude_client, deepgram_options, logger):
    """Register bot commands"""
    
    @bot.event
    async def on_ready():
        logger.info(f"Bot is ready! Logged in as {bot.user} (ID: {bot.user.id})")
        logger.info(f"Bot is in {len(bot.guilds)} servers")
        for guild in bot.guilds:
            logger.info(f" - {guild.name} (ID: {guild.id})")
        logger.info(f"Invite link: https://discord.com/api/oauth2/authorize?client_id={bot.user.id}&permissions=8&scope=bot%20applications.commands")
        
        # Refresh configuration from database
        await Config.refresh_from_db()
        logger.info(f"Configuration loaded from database. Using transcript channel ID: {Config.TRANSCRIPT_CHANNEL_ID}")
        
        # Start the recording watchdog
        await recording_manager.start_watchdog()
        
        # Start the configuration refresh task
        asyncio.create_task(config_refresh_task())
    
    async def config_refresh_task():
        """Task to periodically refresh configuration from database"""
        try:
            while True:
                # Sleep for 5 minutes before checking for config updates
                await asyncio.sleep(5 * 60)
                logger.debug("Periodic configuration refresh check")
                await Config.refresh_from_db()
        except asyncio.CancelledError:
            logger.info("Configuration refresh task cancelled")
        except Exception as e:
            logger.error(f"Error in configuration refresh task: {e}", exc_info=True)
    
    @bot.event
    async def on_error(event, *args, **kwargs):
        logger.error(f"Unhandled error in {event}", exc_info=True)
    
    @bot.command()
    async def record(ctx):
        """Start recording in the voice channel"""
        logger.info(f"Record command received from {ctx.author} in server {ctx.guild.name}")
        
        # Check if user is in a voice channel
        voice = ctx.author.voice
        if not voice:
            logger.warning(f"User {ctx.author} tried to record but is not in a voice channel")
            await ctx.respond("⚠️ You aren't in a voice channel!")
            return
        
        # Check if already recording in this guild
        if recording_manager.is_recording(ctx.guild.id):
            logger.warning(f"Attempted to start recording when already recording in {ctx.guild.name}")
            await ctx.respond("⚠️ Already recording in this server! Use `/stop_recording` to stop.")
            return
        
        # Check concurrent recording limit
        if recording_manager.get_active_count() >= Config.MAX_CONCURRENT_RECORDINGS:
            logger.warning(f"Max concurrent recordings limit reached, rejecting request from {ctx.guild.name}")
            await ctx.respond(f"⚠️ Maximum limit of {Config.MAX_CONCURRENT_RECORDINGS} concurrent recordings reached. Please try again later.")
            return
        
        try:
            # Connect to voice channel
            logger.info(f"Connecting to voice channel: {voice.channel.name}")
            vc = await voice.channel.connect()
            
            # Send notification
            notification = await ctx.respond("🔴 Listening to this conversation.")
            
            try:
                # Get the actual message object
                notification_message = await notification.original_response()
                logger.info(f"Stored notification message with ID: {notification_message.id}")
                
                # Add recording to manager - this will start the first chunk automatically
                recording_manager.add_recording(
                    ctx.guild.id, 
                    vc, 
                    notification=notification_message,
                    channel=ctx.channel
                )
                
            except Exception as e:
                logger.error(f"Failed to get original message: {e}")
                # Add recording to manager without notification
                recording_manager.add_recording(ctx.guild.id, vc, channel=ctx.channel)
            
            logger.info(f"Started recording in {voice.channel.name}")
            
        except discord.ClientException as e:
            logger.error(f"Discord client error when trying to connect: {e}")
            await ctx.respond(f"⚠️ Error connecting to voice channel: {e}")
        except discord.opus.OpusNotLoaded:
            logger.error("Opus library not loaded, cannot record audio")
            await ctx.respond("⚠️ Audio subsystem not available. Please contact the bot administrator.")
        except Exception as e:
            logger.error(f"Unexpected error starting recording: {e}", exc_info=True)
            await ctx.respond(f"⚠️ An unexpected error occurred: {e}")
    
    @bot.command()
    async def stop_recording(ctx):
        """Stop an active recording"""
        logger.info(f"Stop recording command received from {ctx.author} in server {ctx.guild.name}")
        
        if not recording_manager.is_recording(ctx.guild.id):
            logger.warning(f"Stop recording command received but no active recording found in {ctx.guild.name}")
            await ctx.respond("🚫 Not recording in this server")
            return
        
        try:
            await recording_manager.stop_recording(ctx.guild.id)
            # Try to delete the command message
            try:
                await ctx.delete()
            except:
                await ctx.respond("✅ Recording stopped")
        except Exception as e:
            logger.error(f"Error stopping recording: {e}", exc_info=True)
            await ctx.respond(f"⚠️ Error stopping recording: {e}")
    
    @bot.event
    async def on_voice_state_update(member, before, after):
        """Handle voice state updates for auto-recording"""
        # Skip bot voice state updates
        if member.bot:
            return
    
        # Handle people joining (auto-start recording)
        if after and after.channel:
            # Only trigger if this is a genuine join (person wasn't in voice before or changed channels)
            is_new_join = before.channel != after.channel
            if not is_new_join:
                return
                
            # Don't auto-record if already recording in this guild
            if recording_manager.is_recording(after.channel.guild.id):
                return
                
            # Double-check member count - wait briefly to ensure Discord state is updated
            await asyncio.sleep(0.5)
            
            # Re-fetch the channel to get up-to-date members
            channel = bot.get_channel(after.channel.id)
            if not channel:
                logger.warning(f"Failed to get channel {after.channel.id} for member counting")
                return
                
            # Count real human members in the channel (excluding bots)
            human_members = [m for m in channel.members if not m.bot]
            member_count = len(human_members)
            
            logger.info(f"Voice channel {channel.name} has {member_count} human members after {member} joined")
            
            # Only start recording if there are at least 2 real human members
            if member_count >= 2:
                logger.info(f"Auto-recording triggered: {member} joined {channel.name}, {member_count} human members present")
                
                # Check concurrent recording limit
                if recording_manager.get_active_count() >= Config.MAX_CONCURRENT_RECORDINGS:
                    logger.warning(f"Cannot auto-record in {channel.guild.name}: Maximum concurrent recordings reached")
                    return
                
                try:
                    # Connect to voice channel
                    vc = await channel.connect()
                    
                    # Get transcript channel for notification
                    transcript_channel = await get_transcript_channel(bot)
                    
                    # Send notification if possible
                    if transcript_channel:
                        try:
                            notification = await transcript_channel.send(
                                f"🔴 Automatically started recording in {channel.name} "
                                f"as {member_count} members are present: {', '.join([m.display_name for m in human_members])}"
                            )
                            # Add recording to manager - this will start the first chunk automatically
                            recording_manager.add_recording(
                                channel.guild.id, 
                                vc, 
                                notification=notification,
                                channel=transcript_channel
                            )
                            logger.info(f"Auto-recording notification sent to transcript channel")
                        except Exception as e:
                            logger.error(f"Failed to send auto-recording notification: {e}")
                            recording_manager.add_recording(
                                channel.guild.id, 
                                vc,
                                channel=channel.guild.text_channels[0] if channel.guild.text_channels else None
                            )
                    else:
                        # No notification if no channel
                        fallback_channel = channel.guild.text_channels[0] if channel.guild.text_channels else None
                        recording_manager.add_recording(channel.guild.id, vc, channel=fallback_channel)
                        logger.warning("Transcript channel not found, no notification sent")
                    
                    logger.info(f"Started auto-recording in {channel.name}")
                        
                except Exception as e:
                    logger.error(f"Failed to auto-start recording: {e}", exc_info=True)
    
        # Handle people leaving (auto-shutdown)
        if before.channel and (not after.channel or before.channel != after.channel):
            guild_id = before.channel.guild.id
            if recording_manager.is_recording(guild_id):
                # Count remaining non-bot members
                remaining_members = len([m for m in before.channel.members if not m.bot])
                
                if remaining_members <= 1:
                    logger.info(f"Auto-stopping recording: {member} left {before.channel.name}, only {remaining_members} members remain")
                    await recording_manager.stop_recording(guild_id)

# =============== MAIN ENTRY POINT ===============

def run_bot():
    """Run the bot with error handling"""
    try:
        # Set up bot and dependencies first
        bot, recording_manager, deepgram, claude_client, deepgram_options, logger = setup_bot()
        
        # Initial configuration load from database (synchronously)
        try:
            bot.loop.run_until_complete(Config.refresh_from_db())
            logger.info(f"Initial configuration loaded from database. Using transcript channel ID: {Config.TRANSCRIPT_CHANNEL_ID}")
        except Exception as e:
            logger.warning(f"Failed to load initial configuration from database: {e}")
            logger.info(f"Using default configuration values. Transcript channel ID: {Config.TRANSCRIPT_CHANNEL_ID}")
        
        # Set up HTTP server for Heroku
        def start_http_server(logger):
            from webapp.app import app
            
            # Inject datetime into templates
            @app.context_processor
            def inject_now():
                return {'now': datetime.datetime.now()}
            
            # Start the Flask app
            port = Config.PORT
            logger.info(f"Starting Flask web app on port {port}")
            app.run(host='0.0.0.0', port=port, debug=False)
            
        # Start HTTP server in a separate thread
        http_thread = threading.Thread(target=start_http_server, args=(logger,), daemon=True)
        http_thread.start()
        
        # Set up signal handlers
        setup_signal_handlers(bot, recording_manager, logger)
        
        # Register commands
        register_commands(bot, recording_manager, deepgram, claude_client, deepgram_options, logger)
        
        # Start the bot
        logger.info("Starting bot...")
        bot.run(env.get("DISCORD_BOT_TOKEN"))
        
    except discord.LoginFailure:
        logger.critical("Invalid Discord token. Please check your DISCORD_BOT_TOKEN environment variable.")
        sys.exit(1)
    except Exception as e:
        logger.critical(f"Failed to start bot: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    run_bot()