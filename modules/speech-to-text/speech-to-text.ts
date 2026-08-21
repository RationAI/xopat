/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

import {AudioCapture, CaptureError, CaptureResult, SegmentMeta} from "./audioCapture";
import type {CaptureAliveBeat, CaptureErrorCode, CaptureHealth} from "./audioCapture";
import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult} from "./drivers/driver";
import {RemoteWhisperConfig, RemoteWhisperDriver} from "./drivers/remoteWhisper";
import {WasmWhisperConfig, WasmWhisperDriver} from "./drivers/wasmWhisper";
import {VercelTranscribeConfig, VercelTranscribeDriver} from "./drivers/vercelTranscribe";
import {MicButton, MicButtonOptions} from "./ui/MicButton";
import {CaptionOverlay} from "./ui/CaptionOverlay";

/**
 * Deadline for one archive window (~90 s of audio). Generous because it runs in the
 * background where nobody is waiting on it, but bounded so a stuck request cannot
 * hold up the whole chain behind it.
 */
const WINDOW_TIMEOUT_MS = 120_000;

/**
 * Handle returned by {@link SpeechToTextModule.startDictation}: lets the caller
 * stop capture and (for hands-free flows) await the final transcript.
 */
export interface DictationHandle {
    /** Stop capture; the pending transcription then resolves via `done`. */
    stop(): void;
    /** Resolves with the transcript once capture stops and the driver returns. */
    done: Promise<TranscriptionResult>;
}

/** Incremental update delivered as each in-order segment finishes transcribing. */
export interface ContinuousPartial {
    /** The full concatenated transcript so far. */
    text: string;
    /** Just the newly-appended segment text (what this update added). */
    appended: string;
    /** 0-based capture index of the segment this update corresponds to. */
    index: number;
    /** The raw driver result for the appended segment. */
    result: TranscriptionResult;
}

/** One completed speaking turn delivered by `onTurn` (see {@link ContinuousDictationOptions}). */
export interface ContinuousTurn {
    /** The concatenated, accepted text of this turn. Never empty. */
    text: string;
    /** 0-based sequence number of the turn within the session. */
    index: number;
}

export interface ContinuousDictationOptions extends TranscriptionOptions {
    /** Silence window (ms) that cuts one segment. Falls back to the module default. */
    silenceMs?: number;
    /** Live 0..1 input level, fired continuously for a recording meter. */
    onLevel?: (level: number) => void;
    /**
     * Capture heartbeat (see {@link CaptureAliveBeat}) — recorder bytes landing, or a
     * confirmed-healthy poll. A consumer watching for a dead session must measure
     * staleness from THIS, not from `onLevel`: the level clock stalls for reasons
     * that say nothing about the microphone, and a watchdog reading it as capture
     * liveness ends dictations that are working fine.
     */
    onAlive?: (beat: CaptureAliveBeat) => void;
    /** Fired as each in-order segment is transcribed and appended. */
    onPartial?: (partial: ContinuousPartial) => void;
    /** Max transcriptions in flight at once (throttles a remote endpoint). Default 2. */
    maxConcurrent?: number;
    /**
     * Longer, session-level silence (ms) marking the end of a speaking turn.
     * When set, `onTurnIdle` fires once the speaker has been quiet this long after
     * speaking. Capture keeps running; the consumer decides whether to `stop()`.
     */
    turnSilenceMs?: number;
    /** Fired when `turnSilenceMs` of silence follows speech (re-arms on new speech). */
    onTurnIdle?: () => void;
    /** VAD: how far above the noise floor a peak must sit to count as speech (default 3.0). */
    speechFloorMult?: number;
    /** VAD: min sustained ms above the gate before a peak is speech onset (default 200). */
    minSpeechMs?: number;
    /**
     * Content gate: return false to reject a transcribed segment as non-speech
     * (background noise / mistranscription). Rejected segments are NOT concatenated
     * and do NOT fire `onPartial` — so noise never enters the turn. Applied on top
     * of the built-in empty-text skip. `stripNonSpeech`/operator filters run first.
     */
    validateSegment?: (result: TranscriptionResult) => boolean;
    /**
     * Minimum voiced milliseconds a segment must contain to be transcribed at all.
     * Sub-threshold segments (a click or cough that snuck past the onset gate)
     * never reach a driver — no audio egress, no hallucination. Falls back to the
     * module's `minVoicedMs` static meta (default 250).
     */
    minVoicedMs?: number;
    /**
     * Turn-based delivery for conversation consumers. When set, the session keeps
     * capturing indefinitely and each time the speaker goes quiet for
     * `turnSilenceMs`, the accepted segments since the previous turn are
     * concatenated and delivered here as one completed turn (only once every
     * in-flight transcription of the turn has drained — text is never split or
     * lost). Silent stretches produce no turns at all. `stop()` ends the session
     * and DISCARDS an unfinished (not-yet-idle) turn — though it remains part of
     * the final `done` transcript. `finish()` instead ends the session gracefully
     * and delivers those trailing pieces as one last turn (see the handle).
     */
    onTurn?: (turn: ContinuousTurn) => void;
    /**
     * Safety cap (ms) for `finish()`'s graceful drain: if the trailing
     * transcriptions do not complete within this window the in-flight work is
     * aborted so `finish()` can never hang. Default 8000.
     */
    finishTimeoutMs?: number;
    /**
     * Hard cap (ms) on a single segment's length. During uninterrupted speech the
     * segment is cut at this bound even without a silence boundary, so partial
     * text keeps flowing (`onPartial`) mid-monologue instead of waiting for the
     * speaker to pause. Falls back to the capture default (60000).
     */
    maxSegmentMs?: number;
    /**
     * How many characters of already-transcribed text to feed back as the biasing
     * prompt of the NEXT segment (default from the `contextPromptChars` static meta,
     * 240). Segments are decoded independently, so without this the model starts each
     * one blind — the main source of mis-heard domain vocabulary mid-dictation. `0`
     * disables it and restores the session-constant prompt. See `_composePrompt`.
     */
    contextPromptChars?: number;
    /**
     * Keep a continuous recording of the whole session, retrievable from the handle
     * via `getSessionAudio()` once it ends. Lets a consumer re-transcribe everything
     * in one pass ({@link SpeechToTextModule.transcribeAudio}) for a materially more
     * accurate final transcript than the concatenated per-segment text. Off by
     * default — it retains audio in memory for the session's lifetime.
     */
    archive?: boolean;
    /** Cap the archive (bytes / ms); past it recording stops and `archiveTruncated` is set. */
    archiveMaxBytes?: number;
    archiveMaxMs?: number;
    /**
     * With `archive`, seal the recording into WINDOWS of roughly this length (ms) and
     * transcribe each in the background as it closes, instead of leaving the whole
     * recording to be decoded at the end. Default 90 s; `0` restores one end-of-session
     * pass. See {@link SpeechToTextModule.transcribeSessionAudio}.
     */
    windowMs?: number;
    /** Called with each window's transcript as it lands (in seal order, best-effort). */
    onWindow?: (window: TranscribedWindow) => void;
}

/** A sealed archive window plus the text it transcribed to. */
export interface TranscribedWindow {
    index: number;
    text: string;
    /** Capture-relative segment span, for ordering — see `ArchiveWindow`. */
    fromSegment: number;
    toSegment: number;
    final: boolean;
}

/**
 * Handle for a continuous dictation session. Capture keeps running (the mic stays
 * open across segments), so transcription of one segment overlaps recording of the
 * next and nothing spoken during transcription is lost.
 */
export interface ContinuousDictationHandle {
    /**
     * Stop capture hard: abort in-flight transcriptions and resolve promptly. An
     * unfinished (not-yet-idle) turn is discarded — see `onTurn`. Use for teardown
     * or when the last utterance does not matter.
     */
    stop(): Promise<TranscriptionResult>;
    /**
     * Stop capture gracefully: let the trailing transcriptions drain (bounded by
     * `finishTimeoutMs`) and deliver the open, not-yet-idle turn as one final
     * `onTurn` before resolving — so the last thing the speaker said is not lost.
     * Use when a manual stop means "finish and submit".
     */
    finish(): Promise<TranscriptionResult>;
    /** Resolves when capture has ended and every segment has been transcribed. */
    done: Promise<TranscriptionResult>;
    /**
     * The retained recordings when `archive` was requested, else null — one entry per
     * capture (pause/resume yields several). Read after the session ended (a live read
     * misses the unflushed tail). `truncated` marks an archive that hit its
     * size/duration cap and stops short of the end.
     */
    getSessionAudio(): { blobs: Blob[]; truncated: boolean } | null;
}

/**
 * Speech-to-Text module.
 *
 * A standalone, viewer-agnostic capability: capture microphone audio and turn it
 * into text through a pluggable driver (remote self-hosted Whisper by default,
 * in-browser WASM fallback). It owns no UI beyond an optional reusable mic button
 * that any consumer (chat, annotations, plugins) can mount; consumers reach it
 * via `singletonModule('speech-to-text')`.
 *
 * Security: driver/endpoint selection comes only from `getStaticMeta` (ENV,
 * trusted), never from per-session `getOption` (§7). All upstream audio goes
 * through `HttpClient`; the WASM library is hash-verified before import.
 */
class SpeechToTextModule extends (XOpatModuleSingleton as any) {
    private _drivers: Map<string, TranscriptionDriver>;
    private _activeDriverId: string | null;
    private _capture: AudioCapture;
    private _defaults: { language?: string; silenceMs?: number; prompt?: string };
    /** Hard cap on the biasing prompt sent to a driver (~224 Whisper tokens ≈ 1000 chars). */
    private static readonly MAX_PROMPT_CHARS = 1000;
    private _localeReady: Promise<void>;
    /** Operator-configured extra non-speech patterns (on top of the built-ins). */
    private _filterPatterns: RegExp[];
    /** Minimum voiced ms a capture/segment needs before it may reach a driver. */
    private _minVoicedMs: number;
    /** Default rolling-context length fed back as the next segment's prompt. */
    private _contextPromptChars: number;
    /**
     * Abort controller of the current continuous session, if any. `stop()` aborts
     * it so in-flight transcriptions are cancelled and the session's drain can
     * finalize even if a driver (e.g. a hung local model load) would otherwise
     * never resolve. One-shot dictation is deliberately NOT bound to this — its
     * `stop()` means "finish and transcribe", not "discard".
     */
    private _continuousAbort: AbortController | null = null;
    /**
     * Backstop timeout (ms) for a single blob transcription. Even a driver that
     * ignores the abort signal cannot stall the continuous ordered-drain forever:
     * on timeout the chain advances / the segment is recorded empty. 0 disables.
     */
    private _transcribeTimeoutMs: number;

    /**
     * Archive windows and their transcripts. `blob` is held only until the window has
     * been decoded — audio is both sensitive and the bulk of the memory a long
     * dictation holds, and the text is what every consumer actually wants.
     */
    private _windows: Array<{ index: number; text: string; fromSegment: number; toSegment: number; final: boolean; blob: Blob | null }> = [];
    /**
     * Serializes window transcription. Windows are big requests and strictly lower
     * priority than live segments: one at a time means they fill the gaps in the
     * scheduler's reserved urgent slot instead of competing with the captions and
     * extraction the pathologist is watching.
     */
    private _windowChain: Promise<void> | null = null;

    /** Live-caption overlay (lazily built the first time captions are enabled). */
    private _captions: CaptionOverlay | null = null;
    /** How many caption consumers have asked for captions (ref-counted enable). */
    private _captionRefs = 0;
    /** Recent shown segments (newest last); only the last few are rendered. */
    private _captionRecent: string[] = [];
    /** Bound event handlers while captions are on, so they can be detached. */
    private _captionHandlers: Array<[string, (e: any) => void]> = [];
    private _captionIdleTimer: any = null;
    private _captionHideTimer: any = null;
    private _captionRecording = false;
    /** How many recent segments to keep on screen at once. */
    private static readonly CAPTION_LINES = 2;
    /** Clear the shown text after this long with no new segment (subtitle fade). */
    private static readonly CAPTION_IDLE_MS = 6000;
    /** Keep the last caption this long after recording stops, then hide. */
    private static readonly CAPTION_LINGER_MS = 2500;

    constructor() {
        super();
        this._drivers = new Map();
        this._activeDriverId = null;
        // The VAD worklet is a static module asset (never bundled); with the URL
        // the capture drives speech evidence from the audio render thread, so a
        // hidden/unfocused tab keeps capturing (rAF-only VAD froze there).
        let workletUrl: string | undefined;
        try { workletUrl = `${this.MODULE_ROOT}/vad-worklet.js`; }
        catch (_e) { workletUrl = undefined; /* uninitialized module: rAF fallback */ }
        this._capture = new AudioCapture({workletUrl});
        this._localeReady = this.loadLocale().catch((e: any) =>
            console.warn("[speech-to-text] locale load failed:", e));

        const language = this.getStaticMeta("language", undefined) as string | undefined;
        const silenceMs = this.getStaticMeta("silenceMs", 0) as number;
        // Deployment-wide domain biasing prompt (trusted ENV/include.json, §7).
        // Per-call `opts.prompt` overrides it; consumers (e.g. chat) usually supply
        // a richer, live prompt at the call site.
        const prompt = this.getStaticMeta("prompt", undefined) as string | undefined;
        this._defaults = {language, silenceMs: this.getStaticMeta("autoStop", false) ? (silenceMs || 1500) : silenceMs, prompt};
        // A real word carries ≥ ~250ms of voice; anything the VAD heard less of
        // is a blip that must never reach a transcription model (hallucination
        // source). Deployment-tunable, and overridable per call.
        this._minVoicedMs = Math.max(0, Number(this.getStaticMeta("minVoicedMs", 250)) || 0);
        // Enough to carry the current sentence plus the one before it into the next
        // segment's decode, while leaving most of the prompt budget to the glossary.
        this._contextPromptChars = Math.max(0, Number(this.getStaticMeta("contextPromptChars", 240)) || 0);
        // OFF by default: this is a TOTAL wall-clock bound and a driver's transcribe
        // may legitimately include a slow first-time model download (~40 MB), which
        // must not be killed. The real hang guards are abort-on-stop and the WASM
        // driver's own progress-aware load stall timeout; this is an opt-in extra
        // for operators who want a hard per-segment ceiling. 0 disables.
        this._transcribeTimeoutMs = Math.max(0, Number(this.getStaticMeta("transcribeTimeoutMs", 0)) || 0);

        // Extra hallucination filters. Models vary in how they render non-speech
        // audio (e.g. "*Buzzing*", "(coughs)"); the built-in stripNonSpeech covers
        // the common syntaxes, and operators can add regex strings for the rest.
        const rawFilters = this.getStaticMeta("filterPatterns", []);
        this._filterPatterns = (Array.isArray(rawFilters) ? rawFilters : [])
            .map((src: unknown) => {
                if (typeof src !== "string") { console.warn(`[speech-to-text] ignoring non-string filterPatterns entry:`, src); return null; }
                try { return new RegExp(src, "gi"); }
                catch (e) { console.warn(`[speech-to-text] invalid filterPatterns entry ${JSON.stringify(src)}:`, e); return null; }
            })
            .filter(Boolean) as RegExp[];
        if (!Array.isArray(rawFilters) && rawFilters != null) {
            console.warn(`[speech-to-text] filterPatterns must be an array; ignoring:`, rawFilters);
        }

        this._buildConfiguredDrivers();
    }

    /**
     * Effective BCP-47 language: explicit call value, else the module default,
     * else the live UI locale. Inheriting the locale keeps transcription pinned to
     * the app's language instead of letting the model free-detect it (stabilizing
     * language level). Read live so a runtime locale switch is reflected; falls
     * through to `undefined` (driver free-detects) when i18n isn't ready.
     */
    private _resolveLanguage(language?: string): string | undefined {
        if (language) return language;
        if (this._defaults.language) return this._defaults.language;
        try {
            const lng = ($ as any)?.i18n?.language;
            if (typeof lng === "string" && lng.trim()) return lng.trim();
        } catch (_e) { /* i18n not ready — let the driver free-detect */ }
        return undefined;
    }

    /** Effective biasing prompt (call override, else module default), length-capped. */
    private _resolvePrompt(prompt?: string): string | undefined {
        const p = (prompt ?? this._defaults.prompt);
        const s = String(p ?? "").trim();
        if (!s) return undefined;
        return s.length > SpeechToTextModule.MAX_PROMPT_CHARS
            ? s.slice(0, SpeechToTextModule.MAX_PROMPT_CHARS)
            : s;
    }

    /**
     * Compose the per-segment biasing prompt: the static domain glossary followed
     * by the tail of what has already been transcribed this session.
     *
     * A segment is decoded with no knowledge of the segments around it, which is
     * precisely where Whisper-family models mis-hear domain vocabulary and invent
     * plausible words — a fragment starting mid-sentence has nothing to anchor it.
     * Whisper's `prompt` is the supported channel for that missing context, so we
     * feed the previous words back in. Recent transcript goes LAST: it is the
     * strongest bias and belongs closest to the audio being decoded, so when the
     * combined text exceeds the cap the glossary is what gets trimmed.
     *
     * Returns the composed prompt plus the context tail it used, since echo
     * stripping treats the two parts differently (see {@link _stripPromptEcho}).
     */
    private _composePrompt(glossary: string | undefined, transcript: string, contextChars: number): { prompt?: string; context?: string } {
        const base = String(glossary || "").trim();
        const cap = SpeechToTextModule.MAX_PROMPT_CHARS;
        if (contextChars <= 0) return {prompt: base ? base.slice(0, cap) : undefined};
        const full = String(transcript || "").replace(/\s+/g, " ").trim();
        if (!full) return {prompt: base ? base.slice(0, cap) : undefined};
        // Cut the tail on a word boundary — half a word biases toward nonsense.
        let tail = full.slice(-Math.min(contextChars, cap));
        if (tail.length < full.length) {
            const space = tail.indexOf(" ");
            if (space > 0) tail = tail.slice(space + 1);
        }
        const room = cap - tail.length - 1;
        const head = room > 0 ? base.slice(0, room) : "";
        const prompt = head ? `${head} ${tail}` : tail;
        return {prompt, context: tail};
    }

    /** Apply operator-configured extra filters; returns "" when nothing remains. */
    private _applyExtraFilters(text: string): string {
        let t = String(text || "");
        for (const re of this._filterPatterns) {
            try { re.lastIndex = 0; t = t.replace(re, " "); } catch (_e) { /* ignore */ }
        }
        return t.replace(/\s+/g, " ").trim();
    }

    /**
     * Strip biasing-prompt echo from a transcript.
     *
     * Whisper-family models, fed a long domain-biasing prompt (the pathology
     * glossary the chat sends) over (near-)silent audio, regurgitate that prompt
     * verbatim as the "transcript" — often repeated and interleaved with markers
     * like "context:" / "###". Left in, that echo is treated as real speech: it
     * floods the transcript, and (worse) a probe segment that "transcribes to
     * text" flips the whole session fail-open, disabling the voiced-ms gate so
     * ALL later silence gets transcribed too. Removing the prompt's own phrases
     * blanks such a segment, and an empty transcript is "no speech" everywhere
     * downstream — so the echo never renders and never trips fail-open.
     *
     * Only removes runs that ARE the prompt (≥25 chars, so individual glossary
     * words a pathologist genuinely says survive); real dictation mixed with an
     * echo keeps its real words.
     *
     * `context` — the rolling previous-transcript tail (see {@link _composePrompt}) —
     * is matched only as a WHOLE run, never split into sentences: a speaker
     * legitimately repeating a phrase they just said ("mild loose fibrosis and mild
     * dense fibrosis") must keep it, while a model regurgitating the entire context
     * block instead of transcribing must not.
     */
    private _stripPromptEcho(text: string, prompt?: string, context?: string): string {
        const original = String(text || "");
        const contextNorm = String(context || "").replace(/\s+/g, " ").trim();
        // Only the glossary part is fragment-split; the context tail is excluded
        // from it so its sentences are not individually removable.
        let promptNorm = String(prompt || "").replace(/\s+/g, " ").trim();
        if (contextNorm && promptNorm.endsWith(contextNorm)) {
            promptNorm = promptNorm.slice(0, -contextNorm.length).trim();
        }
        if (!original.trim() || (promptNorm.length < 25 && contextNorm.length < 25)) return original;

        // Candidate fragments: the whole prompt plus its sentence/section splits;
        // ≥25 chars keeps single terms out. Longest first so a big run is removed
        // before its sub-parts (avoids leaving orphan slivers).
        const frags = new Set<string>();
        if (promptNorm.length >= 25) frags.add(promptNorm);
        if (contextNorm.length >= 25) frags.add(contextNorm);
        for (const part of promptNorm.split(/[.:]|#{2,}/)) {
            const p = part.trim();
            if (p.length >= 25) frags.add(p);
        }
        const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let t = ` ${original.replace(/\s+/g, " ").trim()} `;
        for (const f of [...frags].sort((a, b) => b.length - a.length)) {
            try { t = t.replace(new RegExp(escape(f), "gi"), " "); }
            catch (_e) { /* skip a fragment that won't compile */ }
        }
        // Markers the echo introduces around the repeated prompt.
        t = t.replace(/\b(?:context|prompt)\s*:/gi, " ").replace(/#{2,}/g, " ");
        t = t.replace(/\s+/g, " ").trim();

        // Nothing but stray punctuation left ⇒ it was pure echo ⇒ no speech.
        return /[a-z0-9]/i.test(t) ? t : "";
    }

    /** Instantiate drivers declared in ENV/include.json and pick the active one. */
    private _buildConfiguredDrivers(): void {
        const requested = String(this.getStaticMeta("driver", "remote"));

        const remote = this.getStaticMeta("remote", null) as RemoteWhisperConfig | Record<string, RemoteWhisperConfig> | null;
        if (remote) {
            // Accept either a single endpoint object or a map of { id: config }.
            const entries: Array<[string, RemoteWhisperConfig]> = (remote as any).path
                ? [["remote", remote as RemoteWhisperConfig]]
                : Object.entries(remote as Record<string, RemoteWhisperConfig>);
            for (const [id, cfg] of entries) {
                try {
                    this.registerDriver(new RemoteWhisperDriver(id, cfg));
                } catch (e) {
                    console.error(`[speech-to-text] failed to build remote driver "${id}":`, e);
                }
            }
        }

        // Vercel-chat transcription driver(s). Reuse the vercel-ai-chat-sdk
        // provider registry (server-held endpoint + key) via its runTranscription
        // RPC, which brokers AI SDK transcription models — the bound provider's
        // adapter must support transcription (see listTranscriptionProviders).
        // Registered before WASM so they're preferred, with WASM as the fallback.
        // `providerId` is OPTIONAL: without it the server picks a transcription-capable
        // provider itself, so `{"driver": "vercel"}` alone is a complete configuration.
        const vercel = this.getStaticMeta("vercel", null) as VercelTranscribeConfig | Record<string, VercelTranscribeConfig> | boolean | null;
        if (vercel || requested === "vercel") {
            for (const [id, cfg] of this._vercelEntries(vercel)) {
                try {
                    this.registerDriver(new VercelTranscribeDriver(id, cfg));
                } catch (e) {
                    console.error(`[speech-to-text] failed to build vercel driver "${id}":`, e);
                }
            }
        }

        // WASM (in-browser transformers.js) driver. Always registered as the
        // guaranteed offline fallback (it needs no config — sensible CDN library +
        // default Whisper model), so a preferred remote/cloud model can be missing
        // or fail and we still degrade to local Whisper. Opt out with
        // `disableWasmFallback: true`. isAvailable() still gates it in secureMode.
        const wasm = this.getStaticMeta("wasm", null) as WasmWhisperConfig | null;
        if (this.getStaticMeta("disableWasmFallback", false) !== true) {
            try {
                // Inject a progress hook so the (potentially slow, ~40 MB first-run)
                // in-browser model load surfaces as a `model-loading` event the UI
                // can reflect instead of looking frozen.
                this.registerDriver(new WasmWhisperDriver("wasm", {
                    ...(wasm || {}),
                    onProgress: (p) => this._onModelProgress("wasm", p),
                }));
            } catch (e) {
                console.error("[speech-to-text] failed to build wasm driver:", e);
            }
        }

        // Prefer the explicitly requested driver, else the first registered one.
        if (this._drivers.has(requested)) this._activeDriverId = requested;
        else if (this._drivers.size) this._activeDriverId = this._drivers.keys().next().value;
    }

    /**
     * Normalize the `vercel` meta into `[id, config]` pairs. Three shapes are accepted:
     * `true`/absent (a single auto driver), one config object, or a `{id: config}` map.
     *
     * The map is recognised by "every value is an object" rather than by the presence of
     * `providerId` — since that key became optional, a single auto config `{timeoutMs: 1000}`
     * would otherwise be read as a map of one driver named "timeoutMs".
     */
    private _vercelEntries(meta: VercelTranscribeConfig | Record<string, VercelTranscribeConfig> | boolean | null): Array<[string, VercelTranscribeConfig]> {
        if (!meta || typeof meta !== "object") return [["vercel", {}]];
        const values = Object.values(meta as Record<string, unknown>);
        const isMap = values.length > 0 && values.every(v => v !== null && typeof v === "object" && !Array.isArray(v));
        if (!isMap) return [["vercel", meta as VercelTranscribeConfig]];
        return Object.entries(meta as Record<string, VercelTranscribeConfig>);
    }

    // ---- driver registry (consumers may add their own transport) ----

    registerDriver(driver: TranscriptionDriver): void {
        if (!driver?.id || typeof driver.transcribe !== "function") {
            throw new Error("[speech-to-text] a driver needs an id and a transcribe() method.");
        }
        this._drivers.set(driver.id, driver);
        if (!this._activeDriverId) this._activeDriverId = driver.id;
        this.raiseEvent("drivers-changed");
    }

    unregisterDriver(id: string): void {
        const d = this._drivers.get(id);
        try { d?.dispose?.(); } catch (_e) { /* ignore */ }
        this._drivers.delete(id);
        if (this._activeDriverId === id) {
            this._activeDriverId = this._drivers.size ? this._drivers.keys().next().value : null;
        }
        this.raiseEvent("drivers-changed");
    }

    listDrivers(): Array<{ id: string; label: string; local: boolean; active: boolean }> {
        return Array.from(this._drivers.values()).map(d => ({
            id: d.id, label: d.label, local: d.local, active: d.id === this._activeDriverId,
        }));
    }

    getActiveDriverId(): string | null {
        return this._activeDriverId;
    }

    /** Switch the active driver by id (no-op if unknown). */
    setActiveDriver(id: string): boolean {
        if (!this._drivers.has(id)) return false;
        this._activeDriverId = id;
        this.raiseEvent("active-driver-changed", {id});
        return true;
    }

    private _activeDriver(): TranscriptionDriver | null {
        return this._activeDriverId ? this._drivers.get(this._activeDriverId) || null : null;
    }

    // ---- capability probe ----

    /** True when capture is supported, permission is grantable, and a driver is reachable. */
    async isAvailable(): Promise<boolean> {
        const driver = this._activeDriver();
        if (!driver) return false;
        if (!(await this._capture.canCapture())) return false;
        try {
            return await driver.isAvailable();
        } catch (_e) {
            return false;
        }
    }

    // ---- transcription ----

    /**
     * True when a capture carries too little speech evidence to be worth (or safe)
     * transcribing. Tracked-but-speechless audio is the hallucination vector:
     * Whisper-family models invent plausible phrases ("Thank you.", "Okay.") from
     * silence, and those phrases are model-dependent, so the only reliable defense
     * is to never send such audio to a driver. Untracked captures (no Web Audio)
     * degrade open.
     */
    private _isNoSpeech(evidence: { heardSpeech: boolean; voicedMs: number; tracked: boolean }, minVoicedMs?: number): boolean {
        if (!evidence.tracked) return false;
        if (!evidence.heardSpeech) return true;
        return evidence.voicedMs < Math.max(0, minVoicedMs ?? this._minVoicedMs);
    }

    /**
     * Capture a single utterance and resolve to its transcript. Auto-stops on
     * silence when `silenceMs`/`autoStop` is configured; otherwise stops at the
     * safety max duration or when {@link stop} is called. A capture without
     * detected speech resolves `{text: "", noSpeech: true}` without ever sending
     * the audio to a driver.
     */
    async transcribeOnce(opts: TranscriptionOptions & { silenceMs?: number; minVoicedMs?: number; onLevel?: (level: number) => void } = {}): Promise<TranscriptionResult> {
        const driver = this._activeDriver();
        if (!driver) throw new CaptureError("capture-failed", "no transcription driver");

        // Warm the model while the user speaks so download/compile overlaps the
        // utterance instead of being serialized in front of inference.
        try { driver.prewarm?.(); } catch (_e) { /* best-effort */ }

        this.raiseEvent("recording-started");
        let cap: CaptureResult;
        try {
            cap = await this._capture.record({
                silenceMs: opts.silenceMs ?? this._defaults.silenceMs,
                onLevel: opts.onLevel,
                onDeviceError: (err) => this._reportCaptureWarning(err),
            });
        } finally {
            this.raiseEvent("recording-stopped");
        }

        const language = this._resolveLanguage(opts.language);
        if (this._isNoSpeech(cap, opts.minVoicedMs)) {
            return {text: "", language, noSpeech: true};
        }
        this.raiseEvent("transcription-started");
        return this._transcribeBlob(cap.blob, {language, prompt: this._resolvePrompt(opts.prompt), signal: opts.signal});
    }

    /**
     * Run one audio blob through the driver fallback chain: try the active driver
     * first, then any others, with local (WASM) drivers last as the guaranteed
     * offline fallback. This is what makes a remote/cloud model safe to prefer even
     * when it isn't guaranteed to be present — if it's unavailable or errors, we
     * degrade to in-browser Whisper instead of failing. Shared by the one-shot and
     * continuous paths; emits `transcription` / `transcription-error`.
     */
    private async _transcribeBlob(audio: Blob, opts: TranscriptionOptions & { context?: string; allowFallback?: boolean } = {}): Promise<TranscriptionResult> {
        const {language, prompt, signal, context, timeoutMs} = opts;
        const active = this._activeDriver();
        if (!active) throw new CaptureError("capture-failed", "no transcription driver");
        const chain = opts.allowFallback === false ? [active] : this._driverChain(active);
        let lastError: any = null;
        // A permanent (config/auth) failure from a preferred driver must not be lost
        // when a later driver — WASM sorts LAST — also fails: it is the actionable
        // one. Keep the first permanent error and let it win the final event so the
        // operator sees "transcription is misconfigured", not the fallback's generic
        // failure (which reads as transient and hides the real cause).
        let permanentError: any = null;
        for (const d of chain) {
            try {
                if (signal?.aborted) throw signal.reason;
                // The ACTIVE driver is gated too: `isAvailable()` is the only way a driver can
                // decline *before* the audio is uploaded (the vercel driver in auto mode asks
                // the server whether any transcription provider exists at all). Drivers keep it
                // cheap and fail open, so a declining one is a real "cannot serve this", and the
                // chain simply moves on to the next — WASM last — instead of paying an egress.
                if (!(await d.isAvailable())) continue;
                const raw = await this._withTimeout(d.transcribe(audio, {language, prompt, signal, timeoutMs}), this._transcribeTimeoutMs);
                // Built-in stripNonSpeech ran in the driver; apply operator filters
                // and strip biasing-prompt echo on top so a hallucinated non-speech
                // transcript is blanked (and thus never submitted by consumers).
                const cleaned = this._stripPromptEcho(this._applyExtraFilters(raw.text), prompt, context);
                const result = {...raw, text: cleaned, ...(cleaned ? {} : {noSpeech: true})};
                this.raiseEvent("transcription", {result, driverId: d.id});
                return result;
            } catch (e) {
                if (signal?.aborted || (e as any)?.name === "AbortError") throw e;
                lastError = e;
                const permanent = (e as any)?.permanent === true;
                if (permanent && !permanentError) permanentError = e;
                // Surface every per-driver failure (fallback may still succeed and
                // swallow it otherwise). Permanent = configuration error (e.g. a
                // vercel driver bound to a provider that cannot transcribe) — that
                // is an operator problem, so log it as an error, not a warning.
                this.raiseEvent("driver-error", {driverId: d.id, error: e, permanent});
                if (permanent) {
                    console.error(`[speech-to-text] driver "${d.id}" is misconfigured; trying fallback:`, e);
                } else {
                    console.warn(`[speech-to-text] driver "${d.id}" failed; trying fallback:`, e);
                }
            }
        }
        // Prefer the permanent config error over the last (typically WASM-fallback)
        // one so consumers can distinguish "operator must fix this" from transient.
        const finalError = permanentError ?? lastError;
        this.raiseEvent("transcription-error", {error: finalError, permanent: !!permanentError});
        throw finalError ?? new CaptureError("capture-failed", "transcription failed");
    }

    /**
     * Transcribe an audio blob the caller already has — no capture involved.
     *
     * The reason this exists is quality: a consumer that recorded a whole session
     * (see `archive` in {@link startContinuousDictation}) can re-transcribe it in one
     * pass, which reads far better than the concatenation of independently-decoded
     * segments — the model sees the entire context instead of a few seconds of it.
     * Meant for an end-of-session upgrade of the authoritative transcript, not for
     * the live path.
     *
     * `allowFallback` defaults to **false** here, unlike the live path: silently
     * degrading a one-shot authoritative pass to the in-browser tiny model would
     * produce a *worse* transcript than the segments it is meant to replace, with
     * nothing in the UI to say so. Failing loudly lets the caller keep what it has.
     */
    async transcribeAudio(audio: Blob, opts: TranscriptionOptions & { allowFallback?: boolean } = {}): Promise<TranscriptionResult> {
        if (!(audio instanceof Blob) || audio.size <= 0) {
            throw new CaptureError("capture-failed", "no audio to transcribe");
        }
        // Pairs with the `transcription` / `transcription-error` events raised by
        // _transcribeBlob, which is what clears a "transcribing" indicator.
        this.raiseEvent("transcription-started");
        return this._transcribeBlob(audio, {
            language: this._resolveLanguage(opts.language),
            prompt: this._resolvePrompt(opts.prompt),
            signal: opts.signal,
            timeoutMs: opts.timeoutMs,
            allowFallback: opts.allowFallback === true,
        });
    }

    /** Active driver first, then the rest with local (offline) drivers last. */
    private _driverChain(active: TranscriptionDriver): TranscriptionDriver[] {
        const others = Array.from(this._drivers.values()).filter(d => d !== active);
        others.sort((a, b) => Number(a.local) - Number(b.local)); // local drivers last
        return [active, ...others];
    }

    /**
     * Start manual (push-to-talk) dictation. Returns a handle whose `stop()`
     * ends capture; `done` resolves with the transcript. Useful when the caller
     * drives start/stop from its own UI instead of silence detection.
     */
    startDictation(opts: TranscriptionOptions = {}): DictationHandle {
        const done = this.transcribeOnce({...opts, silenceMs: 0});
        return {
            stop: () => this._capture.stop(),
            done,
        };
    }

    /**
     * Start a **continuous** dictation session. Unlike {@link transcribeOnce}, the
     * microphone is kept open across many segments: each silence-delimited segment
     * is transcribed *while the next one is already being recorded*, so nothing the
     * user says during transcription is lost. Segments transcribe concurrently but
     * are concatenated strictly in capture order; empty/invalid segments are skipped
     * without dropping their neighbors.
     *
     * This is a first-class, reusable API — any consumer wanting a live mic stream
     * fed incrementally to a model can use `onPartial` and await the final transcript:
     *
     * ```ts
     * const h = singletonModule('speech-to-text').startContinuousDictation({
     *     language: 'en',
     *     onPartial: ({ appended }) => feedToModel(appended),
     * });
     * const final = await h.stop();
     * ```
     */
    startContinuousDictation(opts: ContinuousDictationOptions = {}): ContinuousDictationHandle {
        const driver = this._activeDriver();
        if (!driver) throw new CaptureError("capture-failed", "no transcription driver");

        // Warm the model so the first segment's inference isn't stalled by download.
        try { driver.prewarm?.(); } catch (_e) { /* best-effort */ }

        const language = this._resolveLanguage(opts.language);
        const glossary = this._resolvePrompt(opts.prompt);
        // Rolling context: each segment is biased with the tail of what has already
        // been transcribed, so the model decodes it with the surrounding dictation in
        // view instead of blind (see _composePrompt).
        const contextChars = Math.max(0, Number(opts.contextPromptChars ?? this._contextPromptChars) || 0);
        const requestedConcurrency = Number(opts.maxConcurrent);
        const maxConcurrent = Number.isFinite(requestedConcurrency)
            ? Math.min(8, Math.max(1, Math.floor(requestedConcurrency)))
            : 2;
        const minVoicedMs = Math.max(0, opts.minVoicedMs ?? this._minVoicedMs);

        // The session owns an abort controller so `stop()` (or the module-level
        // `stop()`) cancels in-flight transcriptions — otherwise a hung driver
        // (e.g. a stuck local model load) would keep `active > 0` and the drain
        // could never finalize. Merged with any consumer-supplied signal.
        const abort = new AbortController();
        this._continuousAbort = abort;
        const signal = this._mergeSignal(opts.signal, abort.signal);
        const releaseAbort = () => { if (this._continuousAbort === abort) this._continuousAbort = null; };

        let fullText = "";
        let nextEmit = 0;                              // next segment index to append
        const ready = new Map<number, TranscriptionResult>();
        const queue: Array<{ blob: Blob; index: number; probe?: boolean }> = [];
        let active = 0;                                // transcriptions in flight
        let captureEnded = false;                      // no more segments incoming
        let settled = false;
        // Set by finish(): deliver the trailing (not-yet-idle) turn as one last
        // onTurn before resolving, instead of stop()'s discard.
        let finishing = false;

        // ---- turn-based delivery (see ContinuousDictationOptions.onTurn) ----
        let deliveredMax = -1;                         // highest index handed over by capture
        let turnPieces: string[] = [];                 // accepted pieces of the open turn
        let turnCount = 0;
        // FIFO of turn boundaries: each entry is the highest segment index that
        // belongs to the idled turn. A boundary is consumable once the ordered
        // drain has advanced past it (all of the turn's transcriptions landed).
        const turnBoundaries: number[] = [];

        const flushTurns = (): void => {
            if (!opts.onTurn) return;
            while (turnBoundaries.length && nextEmit > turnBoundaries[0]) {
                turnBoundaries.shift();
                const text = turnPieces.join(" ").trim();
                turnPieces = [];
                if (!text) continue; // silence/noise-only turn: nothing to deliver
                try { opts.onTurn({text, index: turnCount++}); } catch (_e) { /* consumer callback error is theirs */ }
            }
        };

        let resolveDone!: (r: TranscriptionResult) => void;
        let rejectDone!: (e: any) => void;
        const done = new Promise<TranscriptionResult>((res, rej) => { resolveDone = res; rejectDone = rej; });

        const settleError = (err: any, reject: boolean = true): void => {
            if (settled) return;
            settled = true;
            captureEnded = true;
            queue.length = 0;
            releaseAbort();
            this.raiseEvent("recording-stopped");
            this.raiseEvent("transcription-error", {error: err});
            if (reject) rejectDone(err);
        };

        const finalize = (): void => {
            if (settled) return;
            // Only finalize once capture has ended AND every queued/in-flight segment
            // has drained. `captureEnded` is set by onStopped, which fires *after* the
            // final segment was delivered — so we never resolve before the tail.
            if (!captureEnded || active > 0 || queue.length > 0) return;
            // Graceful finish: hand the trailing pieces of the still-open turn to
            // the consumer as a final turn. stop() skips this (mid-turn = discard);
            // finish() opts in so the last utterance is not lost.
            if (finishing && opts.onTurn) {
                const text = turnPieces.join(" ").trim();
                turnPieces = [];
                if (text) {
                    try { opts.onTurn({text, index: turnCount++}); } catch (_e) { /* consumer callback error is theirs */ }
                }
            }
            settled = true;
            releaseAbort();
            this.raiseEvent("recording-stopped");
            resolveDone({text: fullText.trim(), language});
        };

        const drain = (): void => {
            if (settled) return;
            // Append every contiguous ready segment. _transcribeBlob already applied
            // the non-speech + operator filters, so an empty text means "no speech" —
            // skip it, but keep advancing so neighbors are never lost.
            while (ready.has(nextEmit)) {
                const r = ready.get(nextEmit)!;
                ready.delete(nextEmit);
                const idx = nextEmit;
                nextEmit++;
                const piece = String(r.text || "").trim();
                // Skip empty (no speech) and consumer-rejected (noise / mistranscription)
                // segments — they never enter the concatenated turn nor fire onPartial,
                // but their index is still consumed so neighbors are not lost.
                if (!piece) continue;
                if (opts.validateSegment) {
                    let ok = true;
                    try { ok = opts.validateSegment(r); } catch (_e) { ok = true; }
                    if (!ok) continue;
                }
                fullText = fullText ? `${fullText} ${piece}` : piece;
                turnPieces.push(piece);
                try {
                    opts.onPartial?.({text: fullText, appended: piece, index: idx, result: r});
                } catch (_e) { /* consumer callback error is theirs */ }
            }
            flushTurns();
            finalize();
        };

        const pump = (): void => {
            if (settled) return;
            // An aborted session must not START anything. stop() aborts and THEN ends
            // capture, and the capture's final flush segment — emitted regardless of
            // speech evidence — still arrives here asynchronously afterwards. Starting
            // it would raise `transcription-started` for a blob `_transcribeBlob`
            // rejects on the spot (signal.aborted, rethrown WITHOUT a terminal event),
            // leaving every consumer's "transcribing" indicator up with nothing to
            // bring it down: the chat composer sat behind a spinning overlay, input
            // and all, until the panel was rebuilt.
            if (signal?.aborted) {
                // Same result the abort path already produces below, minus the phantom
                // event and the pointless driver call: an empty result keeps the
                // ordered drain moving so `done` still settles.
                while (queue.length) ready.set(queue.shift()!.index, {text: ""});
                drain();
                return;
            }
            while (active < maxConcurrent && queue.length) {
                const {blob, index, probe} = queue.shift()!;
                // Raised when a transcription batch actually begins (in-flight count
                // leaves 0), so "transcribing" indicators reflect real work — not the
                // whole session lifetime. Cosmetic limitation: with overlapping blobs
                // the first per-blob `transcription` end event drops the indicator
                // while a sibling is still in flight; it re-raises on the next 0→1.
                // Rare at segment cadence — not worth a refcount protocol.
                if (active === 0) this.raiseEvent("transcription-started");
                active++;
                // Composed per segment, not once per session: the context tail is
                // whatever has drained so far. Out-of-order completions simply get a
                // slightly older tail — still context, never wrong context.
                const {prompt, context} = this._composePrompt(glossary, fullText, contextChars);
                this._transcribeBlob(blob, {language, prompt, context, signal})
                    .then((r) => {
                        ready.set(index, r);
                        // A probe is a segment the VAD wanted to discard. Real text
                        // coming back means the gate is misjudging speech — flip the
                        // capture to fail-open and tell the UI. (_transcribeBlob output
                        // is post text-filters, so silence hallucinations stay empty.)
                        if (probe && String(r.text || "").trim()) {
                            try { this._capture.enterFailOpen(); } catch (_e) { /* ignore */ }
                            this._reportCaptureWarning(new CaptureError("vad-degraded"));
                        }
                    })
                    .catch((_e) => {
                        // A failed segment must not stall the ordered drain or drop
                        // its neighbors: record an empty result so drain skips it.
                        ready.set(index, {text: ""});
                    })
                    .finally(() => {
                        active--;
                        if (settled) return;
                        drain();
                        pump();
                    });
            }
        };

        this.raiseEvent("recording-started");
        try {
            this._capture.startSegmented({
                silenceMs: opts.silenceMs ?? this._defaults.silenceMs,
                onLevel: opts.onLevel,
                onAlive: opts.onAlive,
                turnSilenceMs: opts.turnSilenceMs,
                onTurnIdle: () => {
                    if (opts.onTurn) {
                        // Everything delivered so far belongs to the turn that just
                        // went idle; later segments open the next turn. The turn is
                        // handed out by flushTurns() once its transcriptions drain.
                        turnBoundaries.push(deliveredMax);
                        flushTurns();
                    }
                    try { opts.onTurnIdle?.(); } catch (_e) { /* consumer callback error is theirs */ }
                },
                speechFloorMult: opts.speechFloorMult,
                minSpeechMs: opts.minSpeechMs,
                onDeviceError: (err) => this._reportCaptureWarning(err),
                maxDurationMs: opts.maxSegmentMs,
                archive: opts.archive,
                archiveMaxBytes: opts.archiveMaxBytes,
                archiveMaxMs: opts.archiveMaxMs,
                windowMs: opts.windowMs,
                // Only ask for windows when the caller archives — without archiving
                // there is no recording to slice.
                onWindow: opts.archive
                    ? (w) => this._enqueueWindow(w, {language, glossary, contextChars, onWindow: opts.onWindow})
                    : undefined,
                onSegment: (blob, index, meta: SegmentMeta) => {
                    if (settled) return;
                    deliveredMax = index;
                    // Voiced-content gate: a segment the VAD barely heard never
                    // reaches a driver (no audio egress, no hallucination). Record
                    // an empty result so the ordered drain still consumes its index.
                    // Probe / fail-open / final-flush segments bypass the gate — the
                    // whole point is to let the text filters judge them (the VAD
                    // verdict is suspect or overridden by explicit user intent).
                    const bypassGate = !!(meta?.probe || meta?.failOpen || meta?.flush);
                    if (!bypassGate && meta?.tracked && meta.voicedMs < minVoicedMs) {
                        ready.set(index, {text: "", noSpeech: true});
                        drain();
                        return;
                    }
                    queue.push({blob, index, probe: !!meta?.probe});
                    pump();
                },
                onStopped: () => {
                    if (settled) return;
                    captureEnded = true;
                    finalize();
                },
                onError: (err) => { settleError(err); },
            });
        } catch (e) {
            settleError(e, false);
            throw e;
        }

        const stop = (): Promise<TranscriptionResult> => {
            // Ends capture; the final segment is flushed via onSegment, then onStopped
            // fires and finalize() resolves once the tail transcription completes.
            // Also abort in-flight transcriptions so a hung driver can't hold the
            // drain open — aborted segments resolve empty and let `done` settle.
            try { abort.abort(); } catch (_e) { /* ignore */ }
            this._capture.stop();
            return done;
        };

        const finish = (): Promise<TranscriptionResult> => {
            // Graceful stop: do NOT abort — let the trailing segment(s) transcribe
            // and drain so finalize() can deliver the open turn (see above). Bound
            // the wait with a safety timeout so a stuck driver can't hang finish().
            finishing = true;
            const capMs = Number(opts.finishTimeoutMs);
            const timeoutMs = Number.isFinite(capMs) ? Math.max(0, capMs) : 8000;
            if (timeoutMs > 0) {
                const timer = setTimeout(() => {
                    if (settled) return;
                    console.warn("[speech-to-text] finish() safety timeout — aborting trailing transcriptions");
                    // Abort any stuck transcription, then force the drain gate open
                    // and finalize so `done` can never hang (e.g. if capture stop
                    // never delivered onStopped). finalize() is a no-op if already
                    // settled or still draining an in-flight segment (its .finally
                    // re-runs finalize once it lands).
                    try { abort.abort(); } catch (_e) { /* ignore */ }
                    captureEnded = true;
                    finalize();
                }, timeoutMs);
                done.then(() => clearTimeout(timer), () => clearTimeout(timer));
            }
            this._capture.stop();
            return done;
        };

        return {stop, finish, done, getSessionAudio: () => this.getSessionAudio()};
    }

    /**
     * The recordings retained by `archive: true` dictation, or null when there are
     * none. One entry per capture — pausing and resuming dictation yields several,
     * which is why this is a list: separate recordings cannot be concatenated as
     * bytes, so a caller transcribes each and joins the TEXT.
     *
     * Module-level rather than handle-only because the interesting moment is *after*
     * the session ended, by which point consumers have usually dropped the handle.
     * Retained until {@link clearSessionAudio} — pause/resume does not discard it.
     */
    getSessionAudio(): { blobs: Blob[]; truncated: boolean } | null {
        const blobs = this._capture.getArchiveBlobs();
        return blobs.length ? {blobs, truncated: this._capture.archiveTruncated} : null;
    }

    /**
     * Live capture health (see {@link CaptureHealth}). Exposed on the module so a
     * consumer in another module — which may not import across the boundary — can
     * base its session watchdog on real capture liveness instead of the level meter.
     */
    getCaptureHealth(): CaptureHealth {
        return this._capture.getHealth();
    }

    /**
     * True when the archive hit its size/duration cap, so the recording — and any
     * transcript derived from it — stops short of the dictation.
     *
     * Separate from {@link getSessionAudio} because with windowing on there are no
     * retained blobs to carry the flag (each window is handed over as it seals), yet
     * a consumer adopting the window transcripts as authoritative still has to know
     * they may be incomplete.
     */
    get sessionAudioTruncated(): boolean {
        return this._capture.archiveTruncated;
    }

    /**
     * The whole dictation as one transcript, decoded with real context rather than a
     * few seconds at a time. See {@link transcribeAudio} for why that beats the live
     * per-segment text.
     *
     * With windowing on (the default for archived dictation) most of this has ALREADY
     * happened: each ~90 s window was transcribed in the background while the
     * pathologist kept talking, so this joins the retained texts and only decodes
     * whatever tail has not been sealed yet. That is the difference between a
     * multi-minute wait at review time and a couple of seconds.
     *
     * Returns "" when nothing was recorded; rejects if a pass fails. Any window whose
     * background pass failed is retried here.
     */
    async transcribeSessionAudio(opts: TranscriptionOptions & { allowFallback?: boolean } = {}): Promise<string> {
        // Let an in-flight background window land rather than decoding it twice.
        if (this._windowChain) { try { await this._windowChain; } catch (_e) { /* retried below */ } }
        const parts: string[] = [];
        for (const w of this._windows) {
            if (w.text) { parts.push(w.text); continue; }
            if (!w.blob) continue;                       // failed and its audio was freed
            const res = await this.transcribeAudio(w.blob, opts);
            w.text = String(res?.text || "").trim();
            w.blob = null;
            if (w.text) parts.push(w.text);
        }
        // Un-windowed captures (windowMs 0, or an archive with no window consumer)
        // still live as retained blobs.
        const audio = this.getSessionAudio();
        for (const blob of (audio?.blobs || [])) {
            const res = await this.transcribeAudio(blob, opts);
            const text = String(res?.text || "").trim();
            if (text) parts.push(text);
        }
        return parts.join(" ");
    }

    /**
     * Queue one sealed archive window for background transcription.
     *
     * Deliberately NOT bound to the dictation session's abort controller: a window
     * sealed moments before the pathologist stops is exactly the audio the review
     * transcript needs, and aborting it on stop would throw away the last minute and a
     * half of the case. It is bounded instead by the driver timeout and by being one
     * at a time.
     * @private
     */
    private _enqueueWindow(
        w: { blob: Blob; index: number; fromSegment: number; toSegment: number; final: boolean },
        ctx: { language?: string; glossary?: string; contextChars: number; onWindow?: (t: TranscribedWindow) => void },
    ): void {
        const record = {index: w.index, text: "", fromSegment: w.fromSegment, toSegment: w.toSegment, final: w.final, blob: w.blob as Blob | null};
        this._windows.push(record);
        const run = async () => {
            try {
                // Same rolling-context trick as segments, one level up: the tail of the
                // PREVIOUS window's transcript orients the model at this one's opening,
                // which is otherwise the least-anchored part of it.
                const prior = this._windows
                    .filter((x) => x !== record && x.text)
                    .map((x) => x.text)
                    .join(" ");
                const {prompt, context} = this._composePrompt(ctx.glossary, prior, ctx.contextChars);
                const res = await this._transcribeBlob(record.blob!, {
                    language: ctx.language,
                    prompt,
                    context,
                    // A tiny-model window would be worse than the segments it is meant
                    // to replace, and nothing in the UI would say so.
                    allowFallback: false,
                    timeoutMs: WINDOW_TIMEOUT_MS,
                });
                record.text = String(res?.text || "").trim();
            } catch (e) {
                // Keep the blob so transcribeSessionAudio can retry it at review time.
                console.warn(`[speech-to-text] window ${record.index} transcription failed; will retry at review`, e);
                return;
            } finally {
                if (record.text) record.blob = null;   // decoded — free the audio
            }
            if (record.text && ctx.onWindow) {
                try {
                    ctx.onWindow({index: record.index, text: record.text, fromSegment: record.fromSegment, toSegment: record.toSegment, final: record.final});
                } catch (_e) { /* consumer error is theirs */ }
            }
        };
        this._windowChain = (this._windowChain || Promise.resolve()).then(run, run);
    }

    /** The transcribed windows so far, in seal order. Empty when windowing is off. */
    getSessionWindows(): TranscribedWindow[] {
        return this._windows
            .filter((w) => w.text)
            .map(({index, text, fromSegment, toSegment, final}) => ({index, text, fromSegment, toSegment, final}));
    }

    /** Drop the retained session recording once a consumer is done with it. */
    clearSessionAudio(): void {
        this._capture.clearArchive();
        this._windows = [];
    }

    /**
     * Stop any in-progress capture (resolves the pending transcription). For a
     * continuous session this also aborts in-flight transcriptions so the session
     * finalizes promptly even if a driver is stuck (e.g. a hung local model load).
     * One-shot dictation is unaffected — its capture stop means "finish and
     * transcribe", so the transcript is still produced.
     */
    stop(): void {
        try { this._continuousAbort?.abort(); } catch (_e) { /* ignore */ }
        this._capture.stop();
    }

    /**
     * Announce a non-fatal capture problem (the Web Audio device/renderer failing) so
     * the UI can explain to the user why voice went dead. Recording still runs — the
     * mic just lost VAD and metering — so this is a warning, never an error that aborts
     * the turn. Consumers subscribe via `addHandler('capture-warning', e => …)`.
     */
    private _reportCaptureWarning(error: CaptureError): void {
        console.warn(`[speech-to-text] capture warning (${error.code}):`, error.message || "");
        this.raiseEvent("capture-warning", {error, code: error.code});
    }

    /**
     * Surface driver model-load progress so the UI can show "Loading local model…"
     * instead of an indistinguishable-from-frozen spinner. `progress` is 0..1;
     * `done` marks the terminal (ready or failed) tick. Consumers subscribe via
     * `addHandler('model-loading', e => …)`.
     */
    private _onModelProgress(driverId: string, p: {
        status?: string; file?: string; progress?: number;
        loaded?: number; total?: number; done?: boolean;
    }): void {
        this.raiseEvent("model-loading", {
            driverId,
            status: p?.status,
            file: p?.file,
            progress: typeof p?.progress === "number" ? p.progress : undefined,
            loaded: p?.loaded,
            total: p?.total,
            done: !!p?.done,
        });
    }

    /** Reject `p` after `ms`; a stuck driver can never stall the ordered drain. */
    private _withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
        if (!ms || ms <= 0) return p;
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) { settled = true; reject(new CaptureError("capture-failed", `transcription timed out after ${ms}ms`)); }
            }, ms);
            p.then(
                (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
                (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
            );
        });
    }

    /** A signal that aborts when EITHER input aborts (used to merge the session's own abort with a consumer signal). */
    private _mergeSignal(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
        if (!a) return b;
        if (!b) return a;
        const anyFn = (AbortSignal as any).any;
        if (typeof anyFn === "function") { try { return anyFn([a, b]); } catch (_e) { /* fall through */ } }
        const ac = new AbortController();
        const link = (s: AbortSignal) => {
            if (s.aborted) { ac.abort((s as any).reason); return; }
            s.addEventListener("abort", () => ac.abort((s as any).reason), {once: true});
        };
        link(a); link(b);
        return ac.signal;
    }

    /**
     * Why voice capture is unavailable in this environment, or null if it should work.
     * A distinct `insecure-context` reason lets the caller tell "serve over https" apart
     * from "your browser lacks the API" — the two are otherwise indistinguishable.
     */
    captureSupportIssue(): CaptureErrorCode | null {
        return AudioCapture.supportIssue();
    }

    // ---- UI factory (consumers can't ES-import across boundaries) ----

    /**
     * Build a reusable mic button bound to this module. Mount it anywhere:
     * `singletonModule('speech-to-text').createMicButton({onResult}).attachTo(el)`.
     */
    createMicButton(options: MicButtonOptions = {}): MicButton {
        return new MicButton({...options, module: this});
    }

    // ---- Live captions (video-subtitle-style overlay over the viewer) ----

    /**
     * Turn the live-caption overlay on or off. Ref-counted, so multiple consumers
     * (e.g. a report session + something else) can independently request it; the
     * band shows while at least one wants it. The overlay reflects THIS module's
     * own transcription events, so it works for any `startContinuousDictation`
     * session regardless of who owns it — a consumer only has to toggle this.
     *
     * No word-level interim exists (drivers transcribe whole segments), so the
     * band updates once per completed segment and shows "Listening…" in between.
     */
    setCaptionsEnabled(enabled: boolean): void {
        if (enabled) {
            this._captionRefs++;
            if (this._captionRefs === 1) this._captionsOn();
        } else {
            this._captionRefs = Math.max(0, this._captionRefs - 1);
            if (this._captionRefs === 0) this._captionsOff();
        }
    }

    private _captionOverlay(): CaptionOverlay | null {
        if (this._captions) return this._captions;
        try {
            this._captions = new CaptionOverlay();
            // Mount into the viewer bounding box; absent (headless) => no captions.
            if (document.getElementById(this._captions.mountId)) {
                this._captions.attachTo(this._captions.mountId);
            }
        } catch (e) {
            console.warn("[speech-to-text] caption overlay unavailable:", e);
            this._captions = null;
        }
        return this._captions;
    }

    private _captionsOn(): void {
        const overlay = this._captionOverlay();
        if (!overlay) return;
        this._captionRecent = [];
        overlay.clear().setHint(this.t("listening"));

        const on = (name: string, fn: (e: any) => void) => {
            try { this.addHandler(name, fn); this._captionHandlers.push([name, fn]); }
            catch (_e) { /* events best-effort */ }
        };
        on("recording-started", () => {
            this._captionRecording = true;
            this._clearCaptionTimers();
            overlay.setHint(this.t("listening")).setVisible(true);
        });
        on("transcription-started", () => {
            if (!this._captionRecent.length) overlay.setHint(this.t("processing"));
        });
        on("transcription", (e: any) => this._onCaptionSegment(e));
        on("recording-stopped", () => {
            this._captionRecording = false;
            // Keep the last words up briefly, then fade the band out.
            if (this._captionHideTimer) clearTimeout(this._captionHideTimer);
            this._captionHideTimer = setTimeout(() => overlay.setVisible(false),
                SpeechToTextModule.CAPTION_LINGER_MS);
        });
        const onErr = (e: any) => {
            overlay.setVisible(true).setText(this.t("transcriptionFailed"), {dim: true});
        };
        on("transcription-error", onErr);
        on("driver-error", (e: any) => { if (e?.permanent) onErr(e); });

        // Register with the top-bar "hide UI" button so it hides captions too.
        try {
            const chrome = (globalThis as any).USER_INTERFACE?.AppBar?.Chrome;
            chrome?.register?.("speech-captions", {
                is: () => overlay.isShown(),
                on: () => overlay.setChromeHidden(false),
                off: () => overlay.setChromeHidden(true),
            });
        } catch (_e) { /* hide-UI enrolment is best-effort */ }
    }

    private _captionsOff(): void {
        for (const [name, fn] of this._captionHandlers) {
            try { this.removeHandler(name, fn); } catch (_e) { /* ignore */ }
        }
        this._captionHandlers = [];
        this._clearCaptionTimers();
        this._captionRecording = false;
        this._captionRecent = [];
        try {
            (globalThis as any).USER_INTERFACE?.AppBar?.Chrome?.unregister?.("speech-captions");
        } catch (_e) { /* ignore */ }
        this._captions?.clear().setVisible(false);
    }

    /** Fold one finished, post-filter segment into the caption band. */
    private _onCaptionSegment(e: any): void {
        const overlay = this._captions;
        if (!overlay) return;
        const result = e?.result;
        const text = String(result?.text || "").trim();
        if (!text || result?.noSpeech) return;   // silence/hallucination filtered upstream

        this._captionRecent.push(text);
        while (this._captionRecent.length > SpeechToTextModule.CAPTION_LINES) this._captionRecent.shift();
        const dim = typeof result?.confidence === "number" && result.confidence < 0.5;
        overlay.setVisible(true).setText(this._captionRecent.join("\n"), {dim});

        // Subtitle fade: drop the text after a quiet spell (keep the band + hint
        // while still recording, otherwise let recording-stopped hide it).
        if (this._captionIdleTimer) clearTimeout(this._captionIdleTimer);
        this._captionIdleTimer = setTimeout(() => {
            this._captionRecent = [];
            overlay.clear();
            if (this._captionRecording) overlay.setHint(this.t("listening"));
        }, SpeechToTextModule.CAPTION_IDLE_MS);
    }

    private _clearCaptionTimers(): void {
        if (this._captionIdleTimer) { clearTimeout(this._captionIdleTimer); this._captionIdleTimer = null; }
        if (this._captionHideTimer) { clearTimeout(this._captionHideTimer); this._captionHideTimer = null; }
    }

    /** Resolve a localized string from this module's namespace. */
    t(key: string, options?: any): string {
        return $.t(key, {ns: this.id, ...(options || {})});
    }

    /** Await first-time locale load (mainly for UI that renders labels immediately). */
    whenLocaleReady(): Promise<void> {
        return this._localeReady;
    }
}

addModule("speech-to-text", SpeechToTextModule as any, true);

export {SpeechToTextModule};
