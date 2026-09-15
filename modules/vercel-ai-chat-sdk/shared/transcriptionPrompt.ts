/**
 * The server-side allowance for a transcription biasing prompt.
 *
 * Pure so it can be unit-tested without the registry. The DEFAULT is zero — no prompt at
 * all — because on a self-hosted `whisper-large-v3` endpoint the prompt made the decoder
 * drop whole stretches of audio in proportion to its length: measured on one 93 s
 * dictation, no prompt → the full text; a 495-char glossary → the last third gone;
 * ~870 chars (glossary + report terms) → 30 s of the middle and nothing else.
 *
 * A provider opts in with `transcriptionPromptMaxChars` on its resolved config. The
 * shipped adapters copy it from `providerDefaults` (secure config) into the type's
 * `fixedConfig`; it is deliberately not a `configSchema` key, so an RPC caller cannot
 * write it into `configOverrides`. OpenAI's `gpt-4o-transcribe` family has no measured
 * pathology and takes the full ceiling; the whisper measurement above is why the default
 * stays off rather than model-detected.
 */

/** Hard ceiling on the biasing prompt forwarded upstream, whatever the provider asks for. */
export const TRANSCRIBE_MAX_PROMPT_CHARS = 1000;

/** The prompt cap this provider allows: its `transcriptionPromptMaxChars`, else 0 (off). */
export function promptCapFor(config: any): number {
    const raw = Number(config?.transcriptionPromptMaxChars);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(Math.floor(raw), TRANSCRIBE_MAX_PROMPT_CHARS);
}
