# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|

## User Preferences
- Keep responses concise and practical.

## Patterns That Work
- Use `rg` for fast repo-wide searches before patching.

## Patterns That Don't Work
- None recorded yet.

## Domain Notes
- Project: `discord-transcription`.
- User wants Anthropic model references modernized from Sonnet 3.7-era naming to `claude-sonnet-4-6`.
- Anthropic model is hardcoded in `src/transcriptManager.ts` at each `anthropic.messages.create` call; keep these in sync when changing models.
