/// <reference path="../../../src/types/globals.d.ts" />

import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult, normalizeResult, DriverConfigurationError} from "./driver";

/**
 * Deployment-controlled config for the Vercel-chat transcription driver. Read
 * from `getStaticMeta("vercel", ...)` — trusted (§7).
 */
export interface VercelTranscribeConfig {
    /**
     * A provider INSTANCE id (or stable plugin/type key) registered in the
     * vercel-ai-chat-sdk chat registry whose adapter supports transcription
     * (`resolveTranscriptionModel` — e.g. chat-openai-compatible, chat-openai).
     * Use a dedicated provider, not the agent's chat provider, unless that one
     * also serves transcription. Transcription-capable providers can be listed
     * via the `listTranscriptionProviders` RPC.
     */
    providerId: string;
    /** Transcription model id (e.g. "whisper-1", "whisper-large-v3-turbo"). */
    model?: string;
    /** Owning server module id; defaults to the chat SDK. */
    moduleId?: string;
}

/**
 * Cloud transcription via the vercel-ai-chat-sdk server. It reuses that
 * module's provider registry (endpoint + server-held API key) through the
 * `runTranscription` RPC, which brokers AI SDK transcription models resolved
 * from the bound provider's adapter — the key never reaches the browser and
 * audio egress stays server-side behind the SSRF guard. Not local; sits ahead
 * of the WASM driver in the module's fallback chain, so if the RPC/provider is
 * missing or errors, transcription degrades to in-browser Whisper automatically.
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

    constructor(id: string, cfg: VercelTranscribeConfig) {
        if (!cfg?.providerId) throw new Error("[speech-to-text] vercel driver requires a 'providerId'.");
        this.id = id;
        this._cfg = cfg;
        this._moduleId = cfg.moduleId || "vercel-ai-chat-sdk";
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
        return !!this._cfg.providerId && typeof this._scope()?.runTranscription === "function";
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
                providerId: this._cfg.providerId,
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
                    `'${this._cfg.providerId}' which cannot transcribe: ${message}`,
                    {cause: e},
                );
                throw this._configError;
            }
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
