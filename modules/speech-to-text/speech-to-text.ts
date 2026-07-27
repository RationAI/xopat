/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

import {AudioCapture, CaptureError, CaptureResult, SegmentMeta} from "./audioCapture";
import type {CaptureErrorCode} from "./audioCapture";
import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult} from "./drivers/driver";
import {RemoteWhisperConfig, RemoteWhisperDriver} from "./drivers/remoteWhisper";
import {WasmWhisperConfig, WasmWhisperDriver} from "./drivers/wasmWhisper";
import {VercelTranscribeConfig, VercelTranscribeDriver} from "./drivers/vercelTranscribe";
import {MicButton, MicButtonOptions} from "./ui/MicButton";

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
     */
    private _stripPromptEcho(text: string, prompt?: string): string {
        const original = String(text || "");
        const promptNorm = String(prompt || "").replace(/\s+/g, " ").trim();
        if (!original.trim() || promptNorm.length < 25) return original;

        // Candidate fragments: the whole prompt plus its sentence/section splits;
        // ≥25 chars keeps single terms out. Longest first so a big run is removed
        // before its sub-parts (avoids leaving orphan slivers).
        const frags = new Set<string>([promptNorm]);
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
        const vercel = this.getStaticMeta("vercel", null) as VercelTranscribeConfig | Record<string, VercelTranscribeConfig> | null;
        if (vercel) {
            // Accept either a single provider object or a map of { id: config },
            // mirroring the `remote` shape above.
            const entries: Array<[string, VercelTranscribeConfig]> = (vercel as any).providerId
                ? [["vercel", vercel as VercelTranscribeConfig]]
                : Object.entries(vercel as Record<string, VercelTranscribeConfig>);
            for (const [id, cfg] of entries) {
                if (!cfg?.providerId) {
                    console.error(`[speech-to-text] vercel driver "${id}" is missing 'providerId', skipping.`);
                    continue;
                }
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
    private async _transcribeBlob(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const {language, prompt, signal} = opts;
        const active = this._activeDriver();
        if (!active) throw new CaptureError("capture-failed", "no transcription driver");
        const chain = this._driverChain(active);
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
                if (d !== active && !(await d.isAvailable())) continue;
                const raw = await this._withTimeout(d.transcribe(audio, {language, prompt, signal}), this._transcribeTimeoutMs);
                // Built-in stripNonSpeech ran in the driver; apply operator filters
                // and strip biasing-prompt echo on top so a hallucinated non-speech
                // transcript is blanked (and thus never submitted by consumers).
                const cleaned = this._stripPromptEcho(this._applyExtraFilters(raw.text), prompt);
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
        const prompt = this._resolvePrompt(opts.prompt);
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
                this._transcribeBlob(blob, {language, prompt, signal})
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

        return {stop, finish, done};
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
