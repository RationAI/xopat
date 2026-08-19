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

function buildForm(
    bytes: Uint8Array,
    mediaType: string,
    modelId: string,
    language?: string | null,
    prompt?: string | null
): FormData {
    const form = new FormData();
    // `bytes.buffer` is typed `ArrayBufferLike` (it could be a SharedArrayBuffer), which is
    // not a `BlobPart` — copy into a plain ArrayBuffer view so the cast is real, not asserted.
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    form.append('file', new Blob([blobBytes.buffer], { type: mediaType }), `audio.${extensionFor(mediaType)}`);
    form.append('model', String(modelId));
    form.append('response_format', 'json');
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

            const form = buildForm(bytes, mediaType, opts.modelId, language, prompt);
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

            const server: any = (globalThis as any).XOPAT_SERVER;
            if (!server?.safeRequest) {
                throw new Error('Core server SSRF guard (XOPAT_SERVER.safeRequest) is unavailable.');
            }
            const resp = await server.safeRequest(endpoint.href, {
                method: 'POST',
                headers: requestHeaders,
                body: bodyBuf,
                timeoutMs,
                signal: abortSignal,
            });
            if (!resp.ok) {
                const detail = await resp.text().catch(() => '');
                // 401/403 mean the endpoint rejected the credential (missing/wrong
                // key) — a config problem the operator must fix, not a transient
                // fault. Tag it so the driver marks itself permanently unavailable
                // rather than degrading to WASM and masking the misconfiguration
                // (which then surfaces downstream as a misleading extraction error).
                const configFault = resp.status === 401 || resp.status === 403;
                const prefix = configFault ? `${TRANSCRIPTION_CONFIG_ERROR_TAG} ` : '';
                throw new Error(`${prefix}Transcription endpoint returned ${resp.status}: ${detail.slice(0, 300)}`);
            }
            const data: any = await resp.json().catch(() => ({}));
            return {
                text: typeof data?.text === 'string' ? data.text : '',
                segments: [],
                language: typeof data?.language === 'string' ? data.language : undefined,
                durationInSeconds: typeof data?.duration === 'number' ? data.duration : undefined,
                warnings: [],
                response: {
                    timestamp: new Date(),
                    modelId: opts.modelId,
                },
            };
        },
    };
}
