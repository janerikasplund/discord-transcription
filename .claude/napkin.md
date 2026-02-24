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
- `@anthropic-ai/sdk@0.38.0` in this repo lacks typed support for Claude 4.6 `thinking: {type: "adaptive"}` and `effort`; model string `claude-sonnet-4-6` still compiles.
- 2026-02-19: User chose to keep current Anthropic integration as-is for now (no SDK upgrade yet). Revisit later to adopt Claude 4.6 `thinking: {type: "adaptive"}` + `effort` once SDK support is upgraded.
- 2026-02-19: Deepgram streaming model remains `nova-3` for this bot; keep README/docs aligned with runtime model setting.
- 2026-02-19: Summary prompts now include canonical-name normalization (Jan, Walter, Marcelo, Danny, Trey) and username mapping (`smalter` -> Walter, `loopboi` -> Danny), plus a one-line `Easter Egg` ending.
- 2026-02-19: Self mistake: introduced duplicate `keyterm` field while editing `src/createListeningStream.ts`; fixed immediately by removing the duplicate key.
- 2026-02-19: User wants the summary ending `Easter Egg` to sound like a personal in-house assistant rooting for the team, with motivation grounded in the specific meeting content.
- 2026-02-19: Easter Egg line must be the final line of summary output and formatted as dialogue with robot emoji + quotes: `🤖 "<one sentence>"`.
- 2026-02-19: User prefers non-corny summary endings; switched final line format to `:happysacraman: "<one sentence>"` and toned voice down to understated, concrete operator-style language.
- 2026-02-19: Reverted ending style from operator-note to classical quote line. Final line should be `:happysacraman: "<quote>" — <author>`, chosen from approved philosopher/strategist pool and tangentially related to meeting content.
- 2026-02-19: User prefers no hardcoded quotes. Prompt now provides only preferred authors (Caesar, Seneca, Nietzsche, Aristotle, Aurelius, Sun Tzu, Drucker) and asks Claude to generate a quote-like line inspired by one selected author.
- 2026-02-19: Removed `:happysacraman:` from final quote line because it did not render correctly in Discord; format is now `"<quote>" — <author>`.
- 2026-02-19: Removed re-condensing/truncation flow for summaries. New behavior: ask Claude to target ~1400 chars and split across multiple Discord messages only at section boundaries when needed.
