/// <reference path="../../../src/types/globals.d.ts" />

import {TranscriptionDriver, TranscriptionOptions, TranscriptionResult, normalizeResult} from "./driver";

/**
 * Deployment-controlled config for a remote Whisper-compatible endpoint. Read
 * from `getStaticMeta("remote", ...)` — trusted (ENV/include.json), never from
 * per-session `getOption` (§7).
 */
export interface RemoteWhisperConfig {
    /** Optional label for diagnostics. */
    name?: string;
    /** Base URL of the server (e.g. a self-hosted whisper.cpp / faster-whisper). */
    path: string;
    /** Path appended to `path` for transcription. Defaults to an OpenAI-compatible route. */
    endpoint?: string;
    /** Model id the server should use, when it accepts one. */
    model?: string;
    /** Form field name for the audio file. Defaults to "file". */
    fileField?: string;
    /** Optional health-probe path (GET). Defaults to trying the endpoint with OPTIONS. */
    probe?: string;
    /**
     * Auth context id whose JWT should be attached (via HttpClient). Omit for an
     * unauthenticated same-origin/self-hosted server.
     */
    contextId?: string;
    /** Require auth to be present (fail closed) when a contextId is given. */
    requiresLogin?: boolean;
}

/**
 * Default driver: POST captured audio to a self-hosted, Whisper-compatible
 * server through `window.HttpClient` so JWT/CSRF injection, proxy-alias
 * resolution, and secureMode policy all apply (§0/§4). Audio leaves the browser
 * only to the operator's own server — never to a third-party cloud.
 *
 * One `HttpClient` is built per driver instance, mirroring the SAM tool's
 * per-GPU-server client pattern (`plugins/sam-segment-tool-experimental/samInference.ts`).
 */
export class RemoteWhisperDriver implements TranscriptionDriver {
    readonly id: string;
    readonly label: string;
    readonly local = false;

    private _cfg: RemoteWhisperConfig;
    private _client: any;
    private _endpoint: string;
    private _fileField: string;

    constructor(id: string, cfg: RemoteWhisperConfig) {
        if (!cfg?.path) throw new Error("[speech-to-text] remote driver requires a 'path'.");
        this.id = id;
        this.label = cfg.name || `Remote Whisper (${id})`;
        this._cfg = cfg;
        this._endpoint = cfg.endpoint || "v1/audio/transcriptions";
        this._fileField = cfg.fileField || "file";

        const HttpClientCtor = (window as any).HttpClient;
        const auth = cfg.contextId
            ? {contextId: cfg.contextId, types: ["jwt"], required: cfg.requiresLogin !== false, refreshOn401: true}
            : undefined;
        this._client = new HttpClientCtor({baseURL: cfg.path, ...(auth ? {auth} : {})});
    }

    async isAvailable(): Promise<boolean> {
        try {
            if (this._cfg.probe) {
                await this._client.request(this._cfg.probe, {method: "GET"});
                return true;
            }
            // No dedicated probe: assume configured endpoints are reachable and let
            // the first real transcription surface any error to the user. Avoids a
            // spurious pre-flight against servers that reject OPTIONS/HEAD.
            return true;
        } catch (_e) {
            return false;
        }
    }

    async transcribe(audio: Blob, opts: TranscriptionOptions = {}): Promise<TranscriptionResult> {
        const form = new FormData();
        const ext = (audio.type && audio.type.includes("wav")) ? "wav"
            : (audio.type && audio.type.includes("ogg")) ? "ogg" : "webm";
        form.append(this._fileField, audio, `audio.${ext}`);
        if (this._cfg.model) form.append("model", this._cfg.model);
        if (opts.language) form.append("language", opts.language);
        // Whisper-compatible servers accept a plain text or json response format.
        form.append("response_format", "json");

        const raw = await this._client.request(this._endpoint, {
            method: "POST",
            body: form,
            signal: opts.signal,
        });
        return normalizeResult(raw);
    }
}
