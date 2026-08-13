/// <reference path="../../../src/types/globals.d.ts" />

import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult, normalizeResult, DriverConfigurationError} from "./driver";

/**
 * Deployment-controlled config for the Vercel-chat transcription driver. Read
 * from `getStaticMeta("vercel", ...)` — trusted (§7).
 */
export interface VercelTranscribeConfig {
    /**
     * OPTIONAL provider REFERENCE into the vercel-ai-chat-sdk chat registry, whose
     * adapter must support transcription (`resolveTranscriptionModel` — e.g.
     * chat-openai-compatible, chat-openai). Resolved in this order: instance id →
     * managed key (`<plugin>:<type>:default`) → plugin id → provider type id, and
     * only ever to an operator-registered provider. Prefer the plugin id: managed
     * instance ids are re-minted on every server start, so they cannot be written
     * into static config. See "Referencing a provider from static config" in
     * modules/vercel-ai-chat-sdk/README.md.
     *
     * OMIT IT for auto mode: the server then picks a transcription-capable
     * operator provider itself (deterministically — nominate one with
     * `metadata.role: 'transcription-default'`). Name one explicitly only to pin
     * a specific provider, e.g. a dedicated one separate from the agent's chat
     * provider. Candidates can be listed via the `listTranscriptionProviders` RPC.
     */
    providerId?: string;
    /**
     * Transcription model id (e.g. "whisper-1", "whisper-large-v3-turbo"). Omit to
     * let the server resolve the provider's transcription default
     * (`config.defaultTranscriptionModelId` → `metadata.transcriptionModelId` →
     * instance/type default → "whisper-1").
     */
    model?: string;
    /** Owning server module id; defaults to the chat SDK. */
    moduleId?: string;
    /**
     * Client-side deadline per transcription, ms (default {@link DEFAULT_TIMEOUT_MS}).
     * MUST be set explicitly: without it the RPC inherits `HttpClient`'s 30 s
     * default, which also counts the request scheduler's queue wait — under tile
     * load a queued utterance was aborted before it ever reached the server, and
     * its words were lost silently. `0` disables the client timer (server-side
     * `XOPAT_STT_TRANSCRIBE_TIMEOUT_MS` still bounds the call).
     */
    timeoutMs?: number;
}

/** Comfortably above a long utterance + scheduler wait; below the 120 s server bound. */
const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Lifetime of the auto-mode provider probe. Short enough that a provider plugin registering
 * late (server module load races the first utterance) is picked up within a dictation session,
 * long enough that a continuous session does not probe per segment.
 */
const PROBE_TTL_MS = 30_000;

/**
 * Cloud transcription via the vercel-ai-chat-sdk server. It reuses that
 * module's provider registry (endpoint + server-held API key) through the
 * `runTranscription` RPC, which brokers AI SDK transcription models resolved
 * from the bound provider's adapter — the key never reaches the browser and
 * audio egress stays server-side behind the SSRF guard. Not local; sits ahead
 * of the WASM driver in the module's fallback chain, so if the RPC/provider is
 * missing or errors, transcription degrades to in-browser Whisper automatically.
 *
 * With no `providerId` the driver runs in AUTO mode: the server selects a
 * transcription-capable provider (and its transcription model) itself, so a
 * deployment only has to say `"driver": "vercel"`. The client never ranks
 * providers — one selection rule, server-side, is what keeps the choice
 * consistent with `listTranscriptionProviders` and with reference resolution.
 *
 * Transcription is an OPTIONAL provider capability: binding a provider whose
 * adapter cannot transcribe yields a permanent {@link DriverConfigurationError}
 * on first use — surfaced via the module's `driver-error` event — and the
 * driver marks itself unavailable so the misconfiguration doesn't re-upload
 * audio on every utterance.
 */
export class VercelTranscribeDriver implements TranscriptionDriver {
    readonly id: string;
    readonly label = "Cloud transcription (chat provider)";
    readonly local = false;

    private _cfg: VercelTranscribeConfig;
    private _moduleId: string;
    /** Set when the server reported a permanent config problem (unsupported provider). */
    private _configError: DriverConfigurationError | null = null;
    /** Auto mode only: memoized "does the server have a transcription provider" verdict. */
    private _probe: {at: number, ok: boolean} | null = null;
    /** Auto mode only: in-flight probe, so a burst of segments shares one RPC. */
    private _probePending: Promise<boolean> | null = null;

    constructor(id: string, cfg: VercelTranscribeConfig = {}) {
        this.id = id;
        this._cfg = cfg || {};
        this._moduleId = this._cfg.moduleId || "vercel-ai-chat-sdk";
    }

    /** The server RPC surface exposed by the chat SDK module, if loaded. */
    private _scope(): any {
        return (window as any).xserver?.module?.[this._moduleId];
    }

    async isAvailable(): Promise<boolean> {
        // Cheap structural check only; real reachability is proven by the first
        // call and covered by the module's fallback chain. Once the server has
        // reported the bound provider as transcription-incapable, stay
        // unavailable — retrying the same config cannot succeed.
        if (this._configError) return false;
        const scope = this._scope();
        if (typeof scope?.runTranscription !== "function") return false;
        // A pinned providerId is the server's problem to resolve (and a dead one
        // latches permanently on first use). Auto mode has nothing to fail on
        // structurally, so ask — cheaply and without audio — whether the registry
        // has any transcription provider at all.
        if (this._cfg.providerId) return true;
        return await this._hasProvider();
    }

    /**
     * Auto mode: is there a transcription-capable provider server-side? Answered by the
     * audio-free `listTranscriptionProviders` RPC and memoized for {@link PROBE_TTL_MS},
     * so a provider-less deployment falls straight to WASM instead of uploading every
     * utterance to learn the same thing again — and recovers on its own once a provider
     * plugin registers (the negative verdict expires).
     *
     * Fails OPEN: a probe that errors must not cost a transcription, so the driver stays
     * available and the real call decides.
     */
    private async _hasProvider(): Promise<boolean> {
        const now = Date.now();
        if (this._probe && (now - this._probe.at) < PROBE_TTL_MS) return this._probe.ok;
        if (this._probePending) return await this._probePending;
        const scope = this._scope();
        if (typeof scope?.listTranscriptionProviders !== "function") return true; // older server: fail open
        this._probePending = (async () => {
            try {
                const res = await scope.listTranscriptionProviders({}, {priority: "background-urgent"});
                const ok = Array.isArray(res?.providers) && res.providers.length > 0;
                this._probe = {at: Date.now(), ok};
                return ok;
            } catch (_e) {
                this._probe = null;   // no verdict cached: retry the probe next time
                return true;
            } finally {
                this._probePending = null;
            }
        })();
        return await this._probePending;
    }

    async transcribe(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        if (this._configError) throw this._configError;
        const scope = this._scope();
        if (typeof scope?.runTranscription !== "function") {
            throw new Error(`[speech-to-text] "${this._moduleId}" runTranscription RPC unavailable.`);
        }
        const audioBase64 = await blobToBase64(audio, opts.signal);
        try {
            const res = await scope.runTranscription({
                // Omitted in auto mode: the server owns selection (one ranking, one place),
                // so the client never re-derives which provider "no reference" means.
                ...(this._cfg.providerId ? {providerId: this._cfg.providerId} : {}),
                model: this._cfg.model,
                audioBase64,
                mediaType: audio.type || "audio/webm",
                language: opts.language,
                // Domain/vocabulary biasing hint, forwarded to the transcription model.
                prompt: opts.prompt,
            }, {
                // Yield connection slots to interactive tile loading: transcription is a
                // seconds-long POST per utterance on the app origin; without this it competes
                // with tiles uncounted. The request scheduler folds it into the same bounded
                // per-origin background budget as inference (with a starvation escape so
                // dictation never freezes). "background-urgent" keeps it in that budget but
                // jumps ahead of bulk extraction chunks so captions aren't stuck behind them.
                // See src/classes/app/request-scheduler.ts.
                priority: "background-urgent",
                signal: opts.signal,
                timeoutMs: opts.timeoutMs ?? this._cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            });
            return normalizeResult(res);
        } catch (e: any) {
            // The server tags EVERY non-recoverable config failure (unknown/incapable adapter,
            // unsupported model spec, no matching provider) with a stable wire sentinel. Match
            // the sentinel — not english phrases — so a reworded server message can never let a
            // permanent failure be retried forever (re-uploading the audio each utterance).
            // MUST stay in sync with TRANSCRIPTION_CONFIG_ERROR_TAG in
            // modules/vercel-ai-chat-sdk/server/inference.server.ts.
            const TRANSCRIPTION_CONFIG_ERROR_TAG = "[stt-config-error]";
            const message = String(e?.message || "");
            if (message.includes(TRANSCRIPTION_CONFIG_ERROR_TAG)) {
                this._configError = new DriverConfigurationError(
                    `[speech-to-text] vercel driver "${this.id}" is bound to provider ` +
                    `'${this._cfg.providerId || "(auto)"}' which cannot transcribe: ${message}`,
                    {cause: e},
                );
                throw this._configError;
            }
            // Retryable failure. In auto mode drop the memoized "a provider exists" verdict so
            // the next segment re-probes (audio-free) instead of assuming the registry is still
            // populated — a provider going away is exactly the case that must stop uploading.
            // Keyed on the absence of the tag, never on message text.
            if (!this._cfg.providerId) this._probe = null;
            throw e;
        }
    }
}

/** Blob → base64 (no data-URL prefix). */
function blobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
            return;
        }
        const reader = new FileReader();
        const onAbort = () => {
            cleanup();
            try { reader.abort(); } catch (_e) { /* ignore */ }
            reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        reader.onload = () => {
            cleanup();
            resolve(String(reader.result).split(",")[1] || "");
        };
        reader.onerror = (ev) => {
            cleanup();
            reject((ev?.target as FileReader | null)?.error ?? new Error("Failed to read blob."));
        };
        reader.onabort = () => {
            cleanup();
            reject(signal?.reason ?? reader.error ?? new DOMException("The operation was aborted.", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, {once: true});
        reader.readAsDataURL(blob);
    });
}
