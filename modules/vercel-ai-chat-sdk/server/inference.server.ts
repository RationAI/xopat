import { generateText } from 'ai';
import { ChatServerRegistry, resolveUserScope } from './chatRegistry.server';

// Tolerant scope resolution: inference must keep working for callers without a
// user/session identity — no scope just means no BYOK secrets overlay.
function safeUserScope(ctx: any): string | null {
    try {
        return resolveUserScope(ctx);
    } catch {
        return null;
    }
}

/**
 * Stateless one-shot vision/text inference primitive.
 *
 * This is the deliberately-isolated entry point used by the `pathology`
 * foundation-model broker when it is configured with a `vercel`-type driver. It
 * reuses the chat provider registry purely to RESOLVE a model and run a single
 * `generateText` — it MUST NOT share any context with the chat agent:
 *
 *   - no session is created, hydrated, read, or written (the session store is
 *     never touched);
 *   - no chat history, personality, or system preamble from a conversation is
 *     loaded — the caller supplies the full `messages` content;
 *   - the caller passes its own `providerId`, so a dedicated pathology provider
 *     instance (its own model + secrets) keeps it separate from whatever model
 *     is driving the agent above.
 *
 * The agent calls the `pathology` namespace; the underlying request runs here in
 * a fresh context. The two never bleed into each other.
 */

const VISION_MAX_OUTPUT_TOKENS = 1536;

function readPositiveEnvInt(name: string, fallback: number): number {
    const raw = Number((globalThis as any)?.process?.env?.[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Vision inference is slow on CPU-only backends (self-hosted MedGemma via Ollama
// can take minutes). The default was too low; make it generous and env-tunable.
// Keep client-side RPC timeouts (e.g. the pathology-medgemma driver) >= this so
// the server's result/timeout is what ends the call, not the client giving up.
const VISION_TIMEOUT_MS = Math.max(30_000, readPositiveEnvInt('XOPAT_PATHOLOGY_VISION_TIMEOUT_MS', 300_000));

const TRANSCRIBE_TIMEOUT_MS = Math.max(15_000, readPositiveEnvInt('XOPAT_STT_TRANSCRIBE_TIMEOUT_MS', 120_000));
const TRANSCRIPTION_ALLOWED_ORIGIN_KEYS = ['originAllowlist', 'allowedOrigins', 'allowedOriginList', 'originAllowList'] as const;

export const policy = {
    runVisionInference: {
        // Requires a logged-in session like the other model-invoking RPCs, but
        // never reads or mutates chat sessions.
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: VISION_TIMEOUT_MS, maxBodyBytes: 12 * 1024 * 1024, maxConcurrency: 4, queueLimit: 16 },
    },
    runTranscription: {
        auth: { public: false, requireSession: true },
        // Audio blobs are small; 25 MB covers a long utterance at webm/opus rates.
        runtime: { timeoutMs: TRANSCRIBE_TIMEOUT_MS, maxBodyBytes: 25 * 1024 * 1024, maxConcurrency: 4, queueLimit: 16 },
    },
};

export interface RunVisionInferenceInput {
    /** A provider INSTANCE id from the chat registry — use a dedicated pathology provider, not the agent's. */
    providerId: string;
    /** Model id; defaults to the provider/type default when omitted. */
    model?: string | null;
    /** Optional system instruction for this one-shot call. */
    system?: string | null;
    /** User prompt / question. */
    prompt?: string | null;
    /** Base64 image (no data-URL prefix). */
    imageBase64?: string | null;
    /** Image media type, e.g. "image/png". */
    mediaType?: string | null;
}

export async function runVisionInference(ctx: any, input: RunVisionInferenceInput): Promise<{ text: string }> {
    if (!input?.providerId) {
        throw new Error("runVisionInference requires a providerId (a dedicated pathology provider instance).");
    }

    const registry = ChatServerRegistry.instance();
    const runtime = await registry.getProviderRuntime(input.providerId, { userScope: safeUserScope(ctx) });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

    const modelId = input.model || runtime.instance.defaultModelId || runtime.type.defaultModelId || '';
    if (!modelId) throw new Error(`No model specified and provider '${input.providerId}' has no default model.`);

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId,
        contextId: runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });

    // Build a FRESH message — no conversation, no stored history.
    const content: any[] = [];
    if (input.prompt) content.push({ type: 'text', text: String(input.prompt) });
    if (input.imageBase64) {
        const mediaType = input.mediaType || 'image/png';
        // Pass raw bytes, NOT a `data:` URL string. A string image is treated as
        // a URL by the AI SDK; providers that don't accept image URLs then try to
        // download it, and Node's fetch rejects the `data:` scheme
        // ("URL scheme must be http or https, got data:"). Bytes are inlined
        // directly — the same path the chat screenshot flow uses.
        const bytes = new Uint8Array(Buffer.from(input.imageBase64, 'base64'));
        content.push({
            type: 'image',
            image: bytes,
            mediaType,
        });
    }
    if (!content.length) throw new Error("runVisionInference requires a prompt and/or an image.");

    const messages: any[] = [];
    if (input.system) messages.push({ role: 'system', content: String(input.system) });
    messages.push({ role: 'user', content });

    const result = await generateText({
        model,
        messages,
        maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
    });

    return { text: typeof result?.text === 'string' ? result.text : '' };
}

// ---- Speech-to-text -------------------------------------------------------

export interface RunTranscriptionInput {
    /** A provider INSTANCE id from the chat registry whose endpoint implements
     *  OpenAI's `/v1/audio/transcriptions` (OpenAI, Groq, self-hosted whisper). */
    providerId: string;
    /** Transcription model id; defaults to the provider/type default or "whisper-1". */
    model?: string | null;
    /** Base64 audio (no data-URL prefix). */
    audioBase64: string;
    /** Audio media type, e.g. "audio/webm". */
    mediaType?: string | null;
    /** Optional BCP-47 language hint. */
    language?: string | null;
    /**
     * Optional domain/vocabulary biasing hint (OpenAI Whisper `prompt`). Free
     * text; length-capped server-side before it is forwarded to the endpoint.
     */
    prompt?: string | null;
}

/** Hard cap on the biasing prompt forwarded upstream (~224 Whisper tokens ≈ 1000 chars). */
const TRANSCRIBE_MAX_PROMPT_CHARS = 1000;

/**
 * Stateless speech-to-text primitive, deliberately isolated like
 * {@link runVisionInference}. It REUSES the chat provider registry only to
 * resolve an endpoint's `baseUrl` + `apiKey` from a dedicated provider instance,
 * then makes a single OpenAI-compatible `/audio/transcriptions` request. The
 * `@ai-sdk/openai-compatible` adapter exposes no transcription model, so we post
 * directly rather than pull in another provider package — the key stays
 * server-side and audio egress is confined to the operator-configured endpoint.
 */
export async function runTranscription(ctx: any, input: RunTranscriptionInput): Promise<{ text: string }> {
    if (!input?.providerId) throw new Error('runTranscription requires a providerId.');
    if (!input?.audioBase64) throw new Error('runTranscription requires audioBase64.');

    const registry = ChatServerRegistry.instance();
    const runtime = await resolveProviderRuntime(registry, ctx, input.providerId);

    // Read endpoint + key defensively: provider config schemas vary in casing.
    const cfg: any = runtime.config || {};
    const secrets: any = runtime.secrets || {};
    const baseUrl = String(cfg.baseUrl || cfg.baseURL || cfg.url || '').replace(/\/+$/, '');
    const apiKey = secrets.apiKey || secrets.api_key || secrets.key || cfg.apiKey || '';
    if (!baseUrl) throw new Error(`Provider '${input.providerId}' has no baseUrl for transcription.`);
    const validatedBaseUrl = validateTranscriptionBaseUrl(baseUrl, cfg);

    const modelId = input.model || runtime.instance.defaultModelId || runtime.type.defaultModelId || 'whisper-1';
    const mediaType = input.mediaType || 'audio/webm';
    const ext = mediaType.includes('wav') ? 'wav'
        : mediaType.includes('ogg') ? 'ogg'
        : mediaType.includes('mp4') || mediaType.includes('m4a') ? 'mp4'
        : 'webm';

    const bytes = new Uint8Array(Buffer.from(input.audioBase64, 'base64'));
    const endpoint = buildTranscriptionEndpointUrl(validatedBaseUrl);
    const form = buildTranscriptionForm(bytes, mediaType, ext, modelId, input.language, input.prompt);
    // Serialize the multipart body once (boundary + content-type) with the
    // platform Request encoder. The browser HttpClient (window.HttpClient) can't
    // load in this server runtime, so the request goes out through the core
    // server SSRF guard (globalThis.XOPAT_SERVER.safeRequest) — which validates
    // the destination at CONNECT time (closing DNS-rebinding TOCTOU), enforces
    // no-redirect, and blocks private/metadata IPs. See server/node/ssrf-guard.js.
    const encoded = new Request(endpoint.href, { method: 'POST', body: form });
    const bodyBuf = Buffer.from(await encoded.arrayBuffer());
    const headers: Record<string, string> = {
        'Content-Type': encoded.headers.get('content-type') || 'multipart/form-data',
        'Content-Length': String(bodyBuf.length),
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const server: any = (globalThis as any).XOPAT_SERVER;
    if (!server?.safeRequest) {
        throw new Error('Core server SSRF guard (XOPAT_SERVER.safeRequest) is unavailable.');
    }
    const resp = await server.safeRequest(endpoint.href, {
        method: 'POST',
        headers,
        body: bodyBuf,
        timeoutMs: TRANSCRIBE_TIMEOUT_MS,
        signal: createTimeoutLinkedSignal(ctx?.signal, TRANSCRIBE_TIMEOUT_MS),
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => '');
        throw new Error(`Transcription endpoint returned ${resp.status}: ${detail.slice(0, 300)}`);
    }
    const data: any = await resp.json().catch(() => ({}));
    return { text: typeof data?.text === 'string' ? data.text : '' };
}

function buildTranscriptionForm(
    bytes: Uint8Array,
    mediaType: string,
    ext: string,
    modelId: string,
    language?: string | null,
    prompt?: string | null
): FormData {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mediaType }), `audio.${ext}`);
    form.append('model', String(modelId));
    form.append('response_format', 'json');
    if (language) form.append('language', String(language));
    // Domain/vocabulary biasing (Whisper `prompt`). Untrusted-shaped even when
    // sourced from trusted config — coerce to a bounded string before egress.
    const bias = String(prompt ?? '').trim().slice(0, TRANSCRIBE_MAX_PROMPT_CHARS);
    if (bias) form.append('prompt', bias);
    return form;
}

function buildTranscriptionEndpointUrl(baseUrl: URL): URL {
    const normalized = new URL(baseUrl.href);
    if (!normalized.pathname.endsWith('/')) normalized.pathname = `${normalized.pathname}/`;
    return new URL('audio/transcriptions', normalized);
}

// Transcription-specific baseUrl policy: HTTPS-only, no embedded credentials,
// and an optional operator origin allowlist. The generic SSRF checks
// (private/metadata IP rejection, connect-time re-validation, no-redirect) are
// NOT duplicated here — they run in the core guard at request time via
// XOPAT_SERVER.safeRequest.
function validateTranscriptionBaseUrl(rawBaseUrl: string, cfg: any): URL {
    let url: URL;
    try {
        url = new URL(rawBaseUrl);
    } catch (_e) {
        throw new Error('Transcription baseUrl must be a valid absolute URL.');
    }
    if (url.protocol !== 'https:') throw new Error('Transcription baseUrl must use HTTPS.');
    if (!url.hostname) throw new Error('Transcription baseUrl must include a hostname.');
    if (url.username || url.password) throw new Error('Transcription baseUrl must not embed credentials.');

    const allowlist = getTranscriptionOriginAllowlist(cfg);
    if (allowlist.length && !allowlist.includes(url.origin)) {
        throw new Error(`Transcription origin '${url.origin}' is not in the configured allowlist.`);
    }

    return url;
}

function getTranscriptionOriginAllowlist(cfg: any): string[] {
    const rawValues = TRANSCRIPTION_ALLOWED_ORIGIN_KEYS
        .map((key) => cfg?.[key])
        .filter((value) => value != null);
    const origins = new Set<string>();

    for (const raw of rawValues) {
        const items = Array.isArray(raw) ? raw : String(raw).split(',');
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
    }
    return Array.from(origins);
}

/**
 * Resolve a provider runtime by an exact instance id OR — because plugin-managed
 * provider instances get random ids (`prov_…`) that can't be referenced from
 * static config — by a STABLE key: the owning plugin id (`metadata.managedByPlugin`)
 * or the provider type id. So `providerId: "chat-openai-compatible"` reuses that
 * plugin's managed provider (endpoint + server-held key) for transcription.
 */
async function resolveProviderRuntime(registry: any, ctx: any, providerId: string): Promise<any> {
    const userScope = safeUserScope(ctx);
    try {
        return await registry.getProviderRuntime(providerId, { userScope });
    } catch (_e) {
        const list = await registry.listProviderInstances({ userId: ctx?.user?.id ?? null });
        const match = (Array.isArray(list) ? list : []).find((p: any) =>
            p?.metadata?.managedByPlugin === providerId || p?.typeId === providerId);
        if (!match?.id) {
            throw new Error(`No transcription provider matches '${providerId}' (tried exact id, plugin id, and type id).`);
        }
        return await registry.getProviderRuntime(match.id, { userScope });
    }
}

function createTimeoutLinkedSignal(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
    const timeoutSignal = typeof AbortSignal?.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : createTimeoutAbortController(timeoutMs).signal;

    if (!signal) return timeoutSignal;
    if (signal.aborted) return signal;

    if (typeof AbortSignal?.any === 'function') {
        return AbortSignal.any([signal, timeoutSignal]);
    }

    const controller = new AbortController();
    const forwardAbort = (source: AbortSignal) => {
        if (!controller.signal.aborted) controller.abort(source.reason);
    };
    signal.addEventListener('abort', () => forwardAbort(signal), { once: true });
    timeoutSignal.addEventListener('abort', () => forwardAbort(timeoutSignal), { once: true });
    return controller.signal;
}

function createTimeoutAbortController(timeoutMs: number): AbortController {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    return controller;
}
