/// <reference path="../../../src/types/globals.d.ts" />

import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult, normalizeResult} from "./driver";

/**
 * Deployment-controlled config for the Vercel-chat transcription driver. Read
 * from `getStaticMeta("vercel", ...)` — trusted (§7).
 */
export interface VercelTranscribeConfig {
    /**
     * A provider INSTANCE id registered in the vercel-ai-chat-sdk chat registry
     * whose endpoint implements OpenAI's `/v1/audio/transcriptions` (OpenAI,
     * Groq, or a self-hosted whisper server). Use a dedicated provider, not the
     * agent's chat provider, unless that one also serves transcription.
     */
    providerId: string;
    /** Transcription model id (e.g. "whisper-1", "whisper-large-v3-turbo"). */
    model?: string;
    /** Owning server module id; defaults to the chat SDK. */
    moduleId?: string;
}

/**
 * Cloud/self-hosted Whisper via the vercel-ai-chat-sdk server. It reuses that
 * module's provider registry (endpoint + server-held API key) through the
 * `runTranscription` RPC — the key never reaches the browser and audio egress is
 * confined to the operator-configured endpoint. Not local; sits ahead of the
 * WASM driver in the module's fallback chain, so if the RPC/provider is missing
 * or errors, transcription degrades to in-browser Whisper automatically.
 */
export class VercelTranscribeDriver implements TranscriptionDriver {
    readonly id: string;
    readonly label = "Cloud Whisper (chat provider)";
    readonly local = false;

    private _cfg: VercelTranscribeConfig;
    private _moduleId: string;

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
        // call and covered by the module's fallback chain.
        return !!this._cfg.providerId && typeof this._scope()?.runTranscription === "function";
    }

    async transcribe(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const scope = this._scope();
        if (typeof scope?.runTranscription !== "function") {
            throw new Error(`[speech-to-text] "${this._moduleId}" runTranscription RPC unavailable.`);
        }
        const audioBase64 = await blobToBase64(audio, opts.signal);
        const res = await scope.runTranscription({
            providerId: this._cfg.providerId,
            model: this._cfg.model,
            audioBase64,
            mediaType: audio.type || "audio/webm",
            language: opts.language,
        }, opts.signal ? {signal: opts.signal} : undefined);
        return normalizeResult(res);
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
