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
    /**
     * Stall timeout (ms) for model load: if the pipeline makes NO progress for
     * this long (a hung WebGPU init, a dead download), the attempt is abandoned
     * and retried on the WASM backend, and finally rejected rather than hanging
     * forever. It is a *no-progress* window, not a total budget — a slow but
     * progressing 40 MB download is never cut. Default 30000.
     */
    loadTimeoutMs?: number;
    /**
     * Internal (not deployment config): the module injects this to surface model
     * download/compile progress. Receives normalized `{status, file, progress
     * (0..1), loaded, total, done}`. Never set from include.json/ENV.
     */
    onProgress?: (progress: {
        status?: string; file?: string; progress?: number;
        loaded?: number; total?: number; done?: boolean;
    }) => void;
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
    /** Wall-clock of the last observed load-progress tick (for the stall timeout). */
    private _lastProgressAt = 0;

    constructor(id: string, cfg: WasmWhisperConfig) {
        this.id = id;
        this._cfg = cfg || {};
    }

    private get _secure(): boolean {
        return !!(window as any).APPLICATION_CONTEXT?.secureMode;
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
        this._pipelinePromise = this._buildPipeline()
            .then((p) => { this._reportProgress({status: "ready", progress: 1, done: true}); return p; })
            .catch((e) => {
                this._pipelinePromise = null; // allow a later retry
                this._reportProgress({status: "error", done: true});
                throw e;
            });
        return this._pipelinePromise;
    }

    /**
     * Load the ASR pipeline.
     *
     * Default path = a SINGLE, unbounded load on the WASM backend — the same
     * known-good shape the SAM tool uses (`samInference.ts`: one `from_pretrained`
     * on the default backend, no WebGPU pin). Crucially it does NOT wrap the WASM
     * load in a stall timeout: the model *compile* phase emits no progress ticks,
     * so a stall timeout there would abandon the (uncancellable) first
     * `lib.pipeline()` and start a second concurrent load of the same backend —
     * two ORT sessions contending, which reads as "stuck". Cancellation of a truly
     * hung WASM load is handled by abort-on-stop in the module, not by restarting.
     *
     * WebGPU is opt-in only (`wasm.device: "webgpu"`). Because a WebGPU init can
     * genuinely hang (not throw), THAT attempt is bounded by the no-progress stall
     * timeout and, on stall/throw, falls back to one plain WASM load.
     */
    private async _buildPipeline(): Promise<any> {
        const lib = await this._loadLibrary();
        const model = this._cfg.model || DEFAULT_MODEL;
        const dtype = this._cfg.dtype || DEFAULT_DTYPE;
        const build = (device: string, dt?: string) => {
            console.info(`[speech-to-text] loading ${model} on device=${device}${dt ? ` dtype=${dt}` : ""}`);
            this._bumpProgress(); // reset the stall clock at the start of each attempt
            return lib.pipeline("automatic-speech-recognition", model, {
                device,
                ...(dt ? {dtype: dt} : {}),
                progress_callback: (p: any) => this._reportProgress(p),
            });
        };

        // WebGPU only when explicitly configured — and only THIS attempt is bounded
        // (it can hang). On stall/throw we fall through to the single WASM load.
        if (this._cfg.device === "webgpu") {
            try {
                return await this._raceStall(build("webgpu", dtype), this._loadTimeoutMs());
            } catch (e) {
                console.warn("[speech-to-text] WebGPU pipeline load failed/stalled, falling back to WASM:", e);
            }
        }

        // Single, unbounded default load. `device` may name a non-webgpu backend if
        // an operator configured one; otherwise plain WASM at q8 (SAM-proven).
        const device = this._cfg.device && this._cfg.device !== "webgpu" ? this._cfg.device : "wasm";
        return await build(device, dtype);
    }

    /** Effective stall timeout in ms (no-progress window); 0/negative disables it. */
    private _loadTimeoutMs(): number {
        const ms = Number(this._cfg.loadTimeoutMs);
        return Number.isFinite(ms) && ms >= 0 ? ms : 30000;
    }

    /** Record a progress tick so the stall watchdog knows the load is alive. */
    private _bumpProgress(): void {
        try { this._lastProgressAt = Date.now(); } catch (_e) { this._lastProgressAt = 0; }
    }

    /** Normalize a transformers.js progress event and forward it to the module. */
    private _reportProgress(p: any): void {
        this._bumpProgress();
        const cb = this._cfg.onProgress;
        if (typeof cb !== "function") return;
        try {
            const loaded = typeof p?.loaded === "number" ? p.loaded : undefined;
            const total = typeof p?.total === "number" && p.total > 0 ? p.total : undefined;
            let progress = typeof p?.progress === "number" ? p.progress : undefined;
            if (progress !== undefined && progress > 1) progress = progress / 100; // 0..100 → 0..1
            // The reverse proxy often strips content-length, so the library reports
            // no `progress`; derive it from loaded/total when the total is known.
            if (progress === undefined && loaded !== undefined && total !== undefined) {
                progress = loaded / total;
            }
            cb({status: p?.status, file: p?.file || p?.name, progress, loaded, total, done: !!p?.done});
        } catch (_e) { /* progress reporting must never break the load */ }
    }

    /**
     * Reject `p` if it makes no progress for `ms` (a *no-progress* window reset by
     * every {@link _reportProgress} tick — a slow but advancing download is never
     * cut). Resolves/rejects with `p`'s own settlement otherwise.
     */
    private _raceStall<T>(p: Promise<T>, ms: number): Promise<T> {
        if (!ms || ms <= 0) return p;
        this._bumpProgress();
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const timer = setInterval(() => {
                if (settled) return;
                let now = 0;
                try { now = Date.now(); } catch (_e) { now = this._lastProgressAt; }
                if (now - this._lastProgressAt > ms) {
                    settled = true; clearInterval(timer);
                    reject(new Error(`[speech-to-text] WASM model load stalled (no progress for ${ms}ms).`));
                }
            }, Math.min(ms, 2000));
            p.then(
                (v) => { if (!settled) { settled = true; clearInterval(timer); resolve(v); } },
                (e) => { if (!settled) { settled = true; clearInterval(timer); reject(e); } },
            );
        });
    }

    /** Reject as soon as `signal` aborts; otherwise settle with `p`. */
    private _raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
        if (!signal) return p;
        if (signal.aborted) {
            return Promise.reject((signal as any).reason ?? new DOMException("Aborted", "AbortError"));
        }
        return new Promise<T>((resolve, reject) => {
            const onAbort = () => reject((signal as any).reason ?? new DOMException("Aborted", "AbortError"));
            signal.addEventListener("abort", onAbort, {once: true});
            p.then(
                (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
                (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
            );
        });
    }

    /** Kick off model download/compile ahead of time (idempotent, never throws). */
    prewarm(): void {
        try { void this._pipeline().catch(() => { /* surfaced on real transcribe */ }); }
        catch (_e) { /* ignore */ }
    }

    async transcribe(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const signal = opts.signal;
        if (signal?.aborted) throw (signal as any).reason ?? new DOMException("Aborted", "AbortError");
        // Race the (potentially slow) model load against the abort signal so a
        // hung load can be cancelled — e.g. when a continuous session is stopped.
        const asr = await this._raceAbort(this._pipeline(), signal);
        // transformers.js decodes audio from a URL via WebAudio; a blob URL bridges
        // the recorded utterance. English-only models reject a `language` option,
        // so only forward it for models explicitly marked multilingual.
        const url = URL.createObjectURL(audio);
        try {
            const runOpts: any = {
                // Curb the model's tendency to loop / hallucinate stock captions on
                // near-silent audio. `repetition_penalty` discourages the decoder from
                // re-emitting recent tokens (the "…of the information of the…" loop);
                // `looksRepetitive` in normalizeResult is the reliable backstop.
                no_repeat_ngram_size: 3,
                repetition_penalty: 1.15,
                temperature: 0,
            };
            if (this._cfg.multilingual && opts.language) runOpts.language = opts.language;
            // `opts.prompt` (vocabulary biasing) is intentionally ignored here:
            // transformers.js ASR exposes no Whisper `prompt`/`initial_prompt`
            // decoder-conditioning option, so a domain hint is a best-effort no-op
            // on the in-browser path (the remote/vercel drivers apply it).
            const out = await this._raceAbort(asr(url, runOpts), signal);
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
