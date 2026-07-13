/// <reference path="../../../src/types/globals.d.ts" />

import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult, normalizeResult} from "./driver";

/**
 * Deployment-controlled config for the in-browser WASM driver. Read from
 * `getStaticMeta("wasm", ...)` — trusted (§7). Every field is optional: with no
 * config at all the driver loads a pinned transformers.js build and a small
 * default Whisper model, so `"driver": "wasm"` works out of the box.
 */
export interface WasmWhisperConfig {
    /** Absolute/protocol-relative URL of the transformers.js ESM bundle. */
    library?: string;
    /**
     * SHA-256 hex of the library bundle. Optional in normal mode (the CDN import
     * is used directly); REQUIRED in secureMode, where the bundle is fetched and
     * verified before import (supply-chain safety, like the SAM tool).
     */
    hash?: string;
    /** HF model id for automatic-speech-recognition. */
    model?: string;
    /** Set true for multilingual models so the language hint is forwarded. */
    multilingual?: boolean;
    /** "webgpu" | "wasm"; auto-detects WebGPU when omitted. */
    device?: string;
    /** Quantization dtype passed to the pipeline (e.g. "q8", "fp32"). */
    dtype?: string;
}

// Pinned to the same transformers.js the SAM tool vendors, INCLUDING its
// verified SHA-256 (see plugins/sam-segment-tool-experimental/include.json), so
// the default path always fetches through HttpClient and verifies integrity —
// no bare CDN import, and still zero config.
const DEFAULT_LIBRARY = "//cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const DEFAULT_LIBRARY_HASH = "aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa";
// Small English model (~40 MB) — a sensible default for evaluation.
const DEFAULT_MODEL = "Xenova/whisper-tiny.en";
// q8 is ~2× faster than fp32 on the CPU/WASM backend with minimal quality loss,
// and is widely supported. Overridable via `wasm.dtype`.
const DEFAULT_DTYPE = "q8";

/**
 * In-browser Whisper via transformers.js. Audio never leaves the machine. In
 * normal mode the pinned library is imported directly from the CDN; in
 * secureMode a hash-pinned bundle is fetched and SHA-256-verified before import
 * (and loading is refused if no hash is configured).
 */
export class WasmWhisperDriver implements TranscriptionDriver {
    readonly id: string;
    readonly label = "In-browser Whisper (WASM)";
    readonly local = true;

    private _cfg: WasmWhisperConfig;
    private _pipelinePromise: Promise<any> | null = null;
    private _lib: any = null;

    constructor(id: string, cfg: WasmWhisperConfig) {
        this.id = id;
        this._cfg = cfg || {};
    }

    private get _secure(): boolean {
        return !!(window as any).APPLICATION_CONTEXT?.secure;
    }

    /** Effective integrity hash: explicit config, or the default only when the
     * default library URL is in use (a custom URL must bring its own hash). */
    private get _effectiveHash(): string | undefined {
        if (this._cfg.hash) return this._cfg.hash;
        return this._cfg.library ? undefined : DEFAULT_LIBRARY_HASH;
    }

    async isAvailable(): Promise<boolean> {
        // secureMode can only load a hash-verifiable bundle.
        if (this._secure && !this._effectiveHash) return false;
        return true;
    }

    /** Load transformers.js — fetch+verify when a hash is known, else CDN import. */
    private async _loadLibrary(): Promise<any> {
        if (this._lib) return this._lib;

        let libPath = this._cfg.library || DEFAULT_LIBRARY;
        if (libPath.startsWith("//")) libPath = `https:${libPath}`;

        const hash = this._effectiveHash;
        if (hash) {
            // Fetch through HttpClient and verify integrity before importing.
            this._lib = await this._fetchVerifyImport(libPath, hash);
            return this._lib;
        }
        if (this._secure) {
            throw new Error("[speech-to-text] secureMode requires a wasm.hash for a custom library URL.");
        }

        // Custom URL without a hash, non-secure: import the CDN module directly.
        this._lib = await import(/* @vite-ignore */ /* webpackIgnore: true */ libPath);
        return this._lib;
    }

    private async _fetchVerifyImport(libPath: string, expectedHash: string): Promise<any> {
        const client = new (window as any).HttpClient({baseURL: libPath});
        const scriptText: string = await client.request(libPath, {method: "GET", expect: "text"});

        if (!globalThis.crypto?.subtle) {
            throw new Error("[speech-to-text] Web Crypto API (crypto.subtle) is unavailable. A secure context (HTTPS or localhost) is required to hash-verify the WASM library.");
        }
        const data = new TextEncoder().encode(scriptText);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        if (hashHex !== expectedHash) {
            throw new Error("[speech-to-text] WASM library hash verification failed.");
        }

        const blobUrl = URL.createObjectURL(new Blob([scriptText], {type: "application/javascript"}));
        try {
            return await import(/* @vite-ignore */ /* webpackIgnore: true */ blobUrl);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    }

    private _pipeline(): Promise<any> {
        if (this._pipelinePromise) return this._pipelinePromise;
        this._pipelinePromise = (async () => {
            const lib = await this._loadLibrary();
            const model = this._cfg.model || DEFAULT_MODEL;
            const wantDevice = this._cfg.device || ((navigator as any).gpu ? "webgpu" : "wasm");
            const dtype = this._cfg.dtype || DEFAULT_DTYPE;
            const build = (device: string, dt?: string) => {
                console.info(`[speech-to-text] loading ${model} on device=${device}${dt ? ` dtype=${dt}` : ""}`);
                return lib.pipeline("automatic-speech-recognition", model, {
                    device,
                    ...(dt ? {dtype: dt} : {}),
                });
            };
            try {
                return await build(wantDevice, dtype);
            } catch (e) {
                // WebGPU/quantization aren't universally reliable; retry on the WASM
                // backend without a forced dtype rather than failing the feature.
                if (wantDevice !== "wasm" || dtype) {
                    console.warn("[speech-to-text] pipeline load failed, retrying on WASM (default dtype):", e);
                    return await build("wasm");
                }
                throw e;
            }
        })().catch(e => {
            this._pipelinePromise = null; // allow a later retry
            throw e;
        });
        return this._pipelinePromise;
    }

    /** Kick off model download/compile ahead of time (idempotent, never throws). */
    prewarm(): void {
        try { void this._pipeline().catch(() => { /* surfaced on real transcribe */ }); }
        catch (_e) { /* ignore */ }
    }

    async transcribe(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const asr = await this._pipeline();
        // transformers.js decodes audio from a URL via WebAudio; a blob URL bridges
        // the recorded utterance. English-only models reject a `language` option,
        // so only forward it for models explicitly marked multilingual.
        const url = URL.createObjectURL(audio);
        try {
            const runOpts: any = {
                // Curb the model's tendency to loop / hallucinate stock captions on
                // near-silent audio. Post-filtering in normalizeResult catches the rest.
                no_repeat_ngram_size: 3,
                temperature: 0,
            };
            if (this._cfg.multilingual && opts.language) runOpts.language = opts.language;
            const out = await asr(url, runOpts);
            return normalizeResult(out);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    dispose(): void {
        this._pipelinePromise = null;
        this._lib = null;
    }
}
