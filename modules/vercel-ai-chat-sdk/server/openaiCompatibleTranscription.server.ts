import type { TranscriptionModelV4 } from '@ai-sdk/provider';

/**
 * Reusable {@link TranscriptionModelV4} over an OpenAI-compatible
 * `/audio/transcriptions` endpoint (OpenAI, Groq, self-hosted whisper).
 *
 * The `@ai-sdk/openai-compatible` package exposes no transcription model, so
 * this shim fills the gap: it implements the versioned AI SDK provider spec on
 * top of a single multipart POST that egresses exclusively through the core
 * SSRF guard (`XOPAT_SERVER.safeRequest` — connect-time destination
 * validation, no-redirect, private/metadata IP rejection).
 *
 * NOT an RPC surface: this file exports no `policy`, so the server runtime
 * registers nothing here. Provider plugins import the factory via
 * `XOPAT_SERVER.importServerExport(ctx,
 *   "module:vercel-ai-chat-sdk/server/openaiCompatibleTranscription.server.ts",
 *   "createOpenAICompatibleTranscriptionModel")`
 * and return the model from their adapter's `resolveTranscriptionModel`.
 */

/** Hard cap on the biasing prompt forwarded upstream (~224 Whisper tokens ≈ 1000 chars). */
const MAX_PROMPT_CHARS = 1000;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Wire sentinel marking a NON-RECOVERABLE transcription config/auth failure. The
 * speech-to-text vercel driver keys on this exact token to mark a binding
 * permanently unavailable instead of retrying (re-uploading audio) every
 * utterance and letting the WASM fallback silently mask the misconfiguration.
 * MUST stay in sync with TRANSCRIPTION_CONFIG_ERROR_TAG in inference.server.ts
 * and drivers/vercelTranscribe.ts.
 */
const TRANSCRIPTION_CONFIG_ERROR_TAG = '[stt-config-error]';

const ALLOWED_ORIGIN_KEYS = ['originAllowlist', 'allowedOrigins', 'allowedOriginList', 'originAllowList'] as const;

export interface OpenAICompatibleTranscriptionOptions {
    /**
     * Stable provider name for logging and the default providerOptions
     * namespace — typically the provider instance id.
     */
    provider: string;
    modelId: string;
    /** Endpoint base URL; `/audio/transcriptions` is appended. HTTPS-only, no embedded credentials. */
    baseUrl: string;
    /** Pre-built auth/extra headers (e.g. from buildOpenAICompatibleHeaders). */
    headers?: Record<string, string>;
    /** Optional operator origin allowlist (string[], or comma-separated string). */
    originAllowlist?: string[] | string | null;
    timeoutMs?: number;
}

/**
 * Endpoint baseUrl policy: HTTPS-only, no embedded credentials, optional
 * operator origin allowlist. The generic SSRF checks (private/metadata IP
 * rejection, connect-time re-validation, no-redirect) are NOT duplicated here —
 * they run in the core guard at request time via XOPAT_SERVER.safeRequest.
 */
function validateBaseUrl(rawBaseUrl: string, originAllowlist?: string[] | string | null): URL {
    let url: URL;
    try {
        url = new URL(rawBaseUrl);
    } catch (_e) {
        throw new Error('Transcription baseUrl must be a valid absolute URL.');
    }
    if (url.protocol !== 'https:') throw new Error('Transcription baseUrl must use HTTPS.');
    if (!url.hostname) throw new Error('Transcription baseUrl must include a hostname.');
    if (url.username || url.password) throw new Error('Transcription baseUrl must not embed credentials.');

    const allowlist = normalizeOriginAllowlist(originAllowlist);
    if (allowlist.length && !allowlist.includes(url.origin)) {
        throw new Error(`Transcription origin '${url.origin}' is not in the configured allowlist.`);
    }
    return url;
}

function normalizeOriginAllowlist(raw?: string[] | string | null): string[] {
    if (raw == null) return [];
    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    const origins = new Set<string>();
    for (const item of items) {
        const trimmed = String(item || '').trim();
        if (!trimmed) continue;
        let parsed: URL;
        try {
            parsed = new URL(trimmed);
        } catch (_e) {
            throw new Error(`Invalid transcription origin allowlist entry '${trimmed}'.`);
        }
        origins.add(parsed.origin);
    }
    return Array.from(origins);
}

/** Pull the allowlist out of a raw provider config object (casing variants). */
export function transcriptionOriginAllowlistFromConfig(cfg: Record<string, unknown> | null | undefined): string[] {
    const values = ALLOWED_ORIGIN_KEYS
        .map((key) => (cfg as any)?.[key])
        .filter((value) => value != null);
    const out = new Set<string>();
    for (const value of values) {
        for (const origin of normalizeOriginAllowlist(value as any)) out.add(origin);
    }
    return Array.from(out);
}

function buildEndpointUrl(baseUrl: URL): URL {
    const normalized = new URL(baseUrl.href);
    if (!normalized.pathname.endsWith('/')) normalized.pathname = `${normalized.pathname}/`;
    return new URL('audio/transcriptions', normalized);
}

function extensionFor(mediaType: string): string {
    return mediaType.includes('wav') ? 'wav'
        : mediaType.includes('ogg') ? 'ogg'
        : mediaType.includes('mp4') || mediaType.includes('m4a') ? 'mp4'
        : mediaType.includes('mpeg') || mediaType.includes('mp3') ? 'mp3'
        : 'webm';
}

/**
 * The media type WITHOUT its parameters — `audio/webm;codecs=opus` → `audio/webm`.
 *
 * `MediaRecorder` is asked for `audio/webm;codecs=opus` (the browser needs the codec to
 * pick an encoder), and that full string ends up as the Blob's `type`, which becomes the
 * multipart file part's `Content-Type`. Upstreams parse the audio format out of that
 * header and reject the parameterised value verbatim:
 * `Unsupported file format webm;codecs=opus`.
 *
 * The container is what they need to know; the codec is inside the file. So the recording
 * keeps its codec-qualified type and only the OUTGOING label is stripped.
 */
function bareMediaType(mediaType: string): string {
    return String(mediaType || '').split(';')[0].trim() || 'audio/webm';
}

/**
 * Summarize Whisper's per-segment decode verdicts from a `verbose_json` response.
 *
 * These three numbers are what Whisper's own temperature-fallback ladder thresholds on
 * (`no_speech_threshold` 0.6, `logprob_threshold` -1.0, `compression_ratio_threshold` 2.4).
 * Surfaced to the client they replace text heuristics with the model's own verdict: a
 * "The" over room tone carries `no_speech_prob` ≈ 0.9, a repetition loop a compression
 * ratio well above 2.4. Absent (undefined) when the backend reports no segments.
 */
function summarizeSegments(segments: unknown): { noSpeechProb?: number; avgLogprob?: number; compressionRatio?: number; segmentCount: number } {
    const segs = Array.isArray(segments) ? segments : [];
    // `null` is absent, not zero: this endpoint reports `no_speech_prob: null`, and a
    // coerced 0 would read as "certainly speech" downstream.
    const nums = (pick: (s: any) => unknown) => segs.map((s) => pick(s))
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map(Number).filter((v) => Number.isFinite(v));
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);
    const noSpeech = nums((s) => s?.no_speech_prob);
    const logprob = nums((s) => s?.avg_logprob);
    const ratio = nums((s) => s?.compression_ratio);
    return {
        ...(noSpeech.length ? { noSpeechProb: mean(noSpeech) } : {}),
        ...(logprob.length ? { avgLogprob: mean(logprob) } : {}),
        ...(ratio.length ? { compressionRatio: Math.max(...ratio) } : {}),
        segmentCount: segs.length,
    };
}

/**
 * Whisper-family response formats, richest first. `verbose_json` carries the per-segment
 * verdicts above and the decoded `duration`; the plain `json` shape carries only `text`.
 * Not every OpenAI-compatible model accepts the richer one (the `gpt-4o-transcribe`
 * family rejects it with a 400 naming the parameter), so the request degrades to `json`
 * on exactly that rejection and remembers the verdict per model.
 */
const RESPONSE_FORMATS = ['verbose_json', 'json'] as const;
type ResponseFormat = typeof RESPONSE_FORMATS[number];
const formatByModel = new Map<string, ResponseFormat>();

function isResponseFormatRejection(status: number, detail: string): boolean {
    return status === 400 && /response_format|verbose_json/i.test(detail);
}

function buildForm(
    bytes: Uint8Array,
    mediaType: string,
    modelId: string,
    language?: string | null,
    prompt?: string | null,
    responseFormat: ResponseFormat = 'verbose_json'
): FormData {
    const form = new FormData();
    // `bytes.buffer` is typed `ArrayBufferLike` (it could be a SharedArrayBuffer), which is
    // not a `BlobPart` — copy into a plain ArrayBuffer view so the cast is real, not asserted.
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    form.append('file', new Blob([blobBytes.buffer], { type: bareMediaType(mediaType) }),
        `audio.${extensionFor(mediaType)}`);
    form.append('model', String(modelId));
    form.append('response_format', responseFormat);
    // Greedy decoding. Sampling randomness mostly manufactures hallucinations on the
    // silence tail of a segment, and a medical transcript must be reproducible: the
    // same audio has to yield the same words. The self-hosted driver has always sent
    // this; the OpenAI-compatible path silently ran at the endpoint's default.
    form.append('temperature', '0');
    if (language) form.append('language', String(language));
    // Domain/vocabulary biasing (Whisper `prompt`). Untrusted-shaped even when
    // sourced from trusted config — coerce to a bounded string before egress.
    const bias = String(prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
    if (bias) form.append('prompt', bias);
    return form;
}

/**
 * Build a TranscriptionModelV4 for an OpenAI-compatible endpoint. Whisper-style
 * hints are read from `providerOptions[opts.provider]` (`language`, `prompt`).
 */
export function createOpenAICompatibleTranscriptionModel(opts: OpenAICompatibleTranscriptionOptions): TranscriptionModelV4 {
    if (!opts?.baseUrl) throw new Error('createOpenAICompatibleTranscriptionModel requires a baseUrl.');
    const timeoutMs = Number.isFinite(opts.timeoutMs) && (opts.timeoutMs as number) > 0
        ? Math.floor(opts.timeoutMs as number)
        : DEFAULT_TIMEOUT_MS;

    return {
        specificationVersion: 'v4',
        provider: opts.provider,
        modelId: opts.modelId,
        async doGenerate({ audio, mediaType, providerOptions, abortSignal, headers: callHeaders }) {
            const validatedBaseUrl = validateBaseUrl(opts.baseUrl, opts.originAllowlist);
            const endpoint = buildEndpointUrl(validatedBaseUrl);

            const bytes = typeof audio === 'string'
                ? new Uint8Array(Buffer.from(audio, 'base64'))
                : audio;
            const hints: any = providerOptions?.[opts.provider] || {};
            const language = typeof hints.language === 'string' && hints.language ? hints.language : null;
            const prompt = typeof hints.prompt === 'string' && hints.prompt ? hints.prompt : null;

            const server: any = (globalThis as any).XOPAT_SERVER;
            if (!server?.safeRequest) {
                throw new Error('Core server SSRF guard (XOPAT_SERVER.safeRequest) is unavailable.');
            }
            const send = async (responseFormat: ResponseFormat) => {
                const form = buildForm(bytes, mediaType, opts.modelId, language, prompt, responseFormat);
                // Serialize the multipart body once (boundary + content-type) with
                // the platform Request encoder, then send it through the core SSRF
                // guard. See server/node/ssrf-guard.js.
                const encoded = new Request(endpoint.href, { method: 'POST', body: form });
                const bodyBuf = Buffer.from(await encoded.arrayBuffer());
                const requestHeaders: Record<string, string> = {
                    ...(opts.headers || {}),
                    'Content-Type': encoded.headers.get('content-type') || 'multipart/form-data',
                    'Content-Length': String(bodyBuf.length),
                };
                for (const [key, value] of Object.entries(callHeaders || {})) {
                    if (value != null) requestHeaders[key] = String(value);
                }
                return server.safeRequest(endpoint.href, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: bodyBuf,
                    timeoutMs,
                    signal: abortSignal,
                });
            };

            let responseFormat: ResponseFormat = formatByModel.get(opts.modelId) || RESPONSE_FORMATS[0];
            let resp = await send(responseFormat);
            if (!resp.ok) {
                const detail = await resp.text().catch(() => '');
                if (responseFormat !== 'json' && isResponseFormatRejection(resp.status, detail)) {
                    // This model does not speak verbose_json — fall back for the rest of
                    // the process lifetime rather than paying a rejected upload per utterance.
                    responseFormat = 'json';
                    formatByModel.set(opts.modelId, responseFormat);
                    resp = await send(responseFormat);
                }
                if (!resp.ok) {
                    const detail2 = responseFormat === 'json' && detail ? detail : await resp.text().catch(() => '');
                    // 401/403 mean the endpoint rejected the credential (missing/wrong
                    // key) — a config problem the operator must fix, not a transient
                    // fault. Tag it so the driver marks itself permanently unavailable
                    // rather than degrading to WASM and masking the misconfiguration
                    // (which then surfaces downstream as a misleading extraction error).
                    const configFault = resp.status === 401 || resp.status === 403;
                    const prefix = configFault ? `${TRANSCRIPTION_CONFIG_ERROR_TAG} ` : '';
                    throw new Error(`${prefix}Transcription endpoint returned ${resp.status}: ${(detail2 || detail).slice(0, 300)}`);
                }
            } else if (!formatByModel.has(opts.modelId)) {
                formatByModel.set(opts.modelId, responseFormat);
            }
            const data: any = await resp.json().catch(() => ({}));
            const verdicts = summarizeSegments(data?.segments);
            return {
                text: typeof data?.text === 'string' ? data.text : '',
                segments: [],
                language: typeof data?.language === 'string' ? data.language : undefined,
                durationInSeconds: typeof data?.duration === 'number' ? data.duration : undefined,
                warnings: [],
                // The decode verdicts ride along in provider metadata: the SDK's result
                // shape has no slot for them, and the RPC handler forwards this namespace
                // to the client as-is.
                providerMetadata: { xopat: { ...verdicts, responseFormat } },
                response: {
                    timestamp: new Date(),
                    modelId: opts.modelId,
                },
            } as any;
        },
    };
}
