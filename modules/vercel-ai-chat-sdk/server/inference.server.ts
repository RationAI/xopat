import { generateText } from 'ai';
import { ChatServerRegistry, resolveUserScope, normalizeContexts, isProviderAccessError, CHAT_ERR_UNKNOWN_PROVIDER, type ResolvedTranscriptionModel } from './chatRegistry.server';
import type { TranscriptionModelV3 } from '@ai-sdk/provider';
import { createTimeoutLinkedSignal } from './abort-utils';

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

// Large report schemas make extraction replies long; too low a cap truncates the
// JSON. 4096 is generous by default and env-tunable for models/prompts that need
// more headroom. (`readPositiveEnvInt` is a hoisted function declaration.)
const VISION_MAX_OUTPUT_TOKENS = readPositiveEnvInt('XOPAT_PATHOLOGY_VISION_MAX_OUTPUT_TOKENS', 4096);

function readPositiveEnvInt(name: string, fallback: number): number {
    const raw = Number((globalThis as any)?.process?.env?.[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Vision inference is slow on CPU-only backends (self-hosted MedGemma via Ollama
// can take minutes). The default was too low; make it generous and env-tunable.
// Keep client-side RPC timeouts (e.g. the pathology-medgemma driver) >= this so
// the server's result/timeout is what ends the call, not the client giving up.
const VISION_TIMEOUT_MS = Math.max(30_000, readPositiveEnvInt('XOPAT_PATHOLOGY_VISION_TIMEOUT_MS', 300_000));
// Deadline handed to the SDK, deliberately inside the RPC policy timeout above:
// whoever fires first wins, and we want that to be us, so the caller gets the
// real upstream error instead of the RPC layer's opaque 504.
const VISION_BUDGET_MS = Math.max(15_000, Math.floor(VISION_TIMEOUT_MS * 0.9));
// One retry, not the SDK's default 2. Retries share the budget above, so this
// only decides how the budget is spent — a hard-down upstream should not eat it
// three times over before reporting.
const VISION_MAX_RETRIES = 1;

const TRANSCRIBE_TIMEOUT_MS = Math.max(15_000, readPositiveEnvInt('XOPAT_STT_TRANSCRIBE_TIMEOUT_MS', 120_000));

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
    listTranscriptionProviders: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 16 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
};

export interface RunVisionInferenceInput {
    /** A provider REFERENCE — instance id, managed key, plugin id or type id (see
     *  `shared/providerRef.ts`). Use a dedicated pathology provider, not the agent's. */
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
    /**
     * Optional per-call output cap. Clamps the server default DOWN (never up) so a caller
     * that knows the target model's context window (e.g. a small-context vision model) can
     * avoid the "max_tokens too large" rejection. Ignored if >= the server default.
     */
    maxOutputTokens?: number | null;
}

export async function runVisionInference(ctx: any, input: RunVisionInferenceInput): Promise<{ text: string }> {
    if (!input?.providerId) {
        throw new Error("runVisionInference requires a providerId (a dedicated pathology provider instance).");
    }
    // Spends a provider credential — require an identified caller at the call
    // site so a misconfigured `rpcVerifiers` cannot re-expose it.
    resolveUserScope(ctx);

    const registry = ChatServerRegistry.instance();
    // Reference-tolerant: this provider id comes from deployment config (a pathology driver's
    // `providerId`, mixture-report-assist's `extractionProviderId`), and a managed instance id is
    // re-minted on every server start, so config can only name a provider by a stable reference.
    const runtime = await registry.resolveProviderRuntime(input.providerId, { ctx, userScope: safeUserScope(ctx) });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

    const modelId = input.model || runtime.instance.defaultModelId || runtime.type.defaultModelId || '';
    // Name what actually resolved, not the reference: '…provider "chat-openai-compatible" has no
    // default model' would send the operator hunting through the wrong config block.
    if (!modelId) throw new Error(`No model specified and provider '${runtime.instance.id}' has no default model.`);

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

    // Caller may clamp the cap DOWN for a known small-context model; never let it raise ours.
    const requested = Number(input.maxOutputTokens);
    let maxOutputTokens = Number.isFinite(requested) && requested > 0
        ? Math.min(VISION_MAX_OUTPUT_TOKENS, Math.floor(requested))
        : VISION_MAX_OUTPUT_TOKENS;

    const signal = createTimeoutLinkedSignal(ctx?.signal, VISION_BUDGET_MS);
    // Self-heal against models whose whole context is smaller than our output cap: the provider
    // rejects with a "max_tokens too large / context length" error. Halve and retry (bounded) so a
    // small-context vision model degrades gracefully instead of hard-failing every call.
    let result;
    for (let attempt = 0; ; attempt++) {
        try {
            result = await generateText({
                model,
                messages,
                maxOutputTokens,
                abortSignal: signal,
                maxRetries: VISION_MAX_RETRIES,
            });
            break;
        } catch (e: any) {
            const msg = String(e?.message || e || '').toLowerCase();
            const capTooLarge = (msg.includes('max_tokens') || msg.includes('max_completion_tokens'))
                && (msg.includes('too large') || msg.includes('context length') || msg.includes('maximum context'));
            if (capTooLarge && attempt < 4 && maxOutputTokens > 256) {
                maxOutputTokens = Math.max(256, Math.floor(maxOutputTokens / 2));
                continue;
            }
            throw e;
        }
    }

    return { text: typeof result?.text === 'string' ? result.text : '' };
}

// ---- Speech-to-text -------------------------------------------------------

export interface RunTranscriptionInput {
    /** A provider REFERENCE — instance id, managed key, plugin id or type id (see
     *  `shared/providerRef.ts`) — whose adapter supports transcription (resolveTranscriptionModel). */
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
 * {@link runVisionInference}. It resolves an AI SDK transcription model through
 * the provider registry (same access/context chokepoint as chat and vision) and
 * calls the versioned TranscriptionModelV3 spec directly — `doGenerate` accepts
 * the exact `mediaType` the client captured, which `experimental_transcribe`
 * would discard in favor of byte-sniffing.
 *
 * Transcription is an OPTIONAL adapter capability: a provider whose adapter
 * does not implement `resolveTranscriptionModel` fails here with an explicit
 * error naming the adapter — there is no fallback transport. The error
 * propagates through the RPC layer to the client driver, which surfaces it via
 * the speech-to-text module's `transcription-error` event.
 *
 * SSRF CONTRACT — the primary egress guard lives in the adapter, but this
 * function keeps a best-effort backstop: when the resolved config exposes a
 * transcription endpoint URL (`baseUrl`/`baseURL`) it pre-vets it via
 * `validateUpstreamUrl` before the adapter runs, so a config-supplied private/
 * metadata destination is refused even if a future adapter forgets to. It still
 * resolves an opaque `TranscriptionModelV3` and only forwards a timeout-linked
 * abort signal; the model may carry its own HTTP client this function never
 * sees, so the adapter remains responsible for connect-time egress. Every
 * `resolveTranscriptionModel` implementation that hands a config-supplied
 * endpoint to an HTTP transport MUST still enforce AGENTS.md §4 itself:
 * validate the baseUrl (HTTPS-only, no embedded credentials, operator origin
 * allowlist via `validateUpstreamUrl`) and egress through `XOPAT_SERVER.safeRequest`
 * / `safeFetch` (connect-time private/metadata-IP rejection, no-redirect). The
 * shipped openai-compatible adapter satisfies this through the reusable
 * transcription shim; a native `@ai-sdk` provider that brings its own `fetch` must
 * pre-vet its endpoint the same way before returning the model. There is no
 * core-level backstop, so an adapter that skips this uploads audio unguarded.
 */
/**
 * Wire sentinel prefixed onto every NON-RECOVERABLE transcription CONFIG error (wrong/unknown
 * adapter, non-transcription provider, unsupported model spec, no matching provider). It is the
 * cross-RPC contract the speech-to-text vercel driver keys on to mark a binding permanently
 * unavailable — matching this stable token instead of brittle english phrases means a reworded
 * message never silently downgrades a permanent failure to a retried-forever transient one.
 * MUST stay in sync with the same literal in modules/speech-to-text/drivers/vercelTranscribe.ts.
 */
export const TRANSCRIPTION_CONFIG_ERROR_TAG = '[stt-config-error]';
/**
 * A PERMANENT misconfiguration. The speech-to-text driver latches on this tag and
 * marks the binding dead until a page reload (see
 * modules/speech-to-text/drivers/vercelTranscribe.ts), so never tag a recoverable
 * failure with it — an auth-context denial clears the moment the user logs in and
 * must stay retryable. Those propagate as ChatProviderAccessError instead.
 */
function transcriptionConfigError(message: string): Error {
    return new Error(`${TRANSCRIPTION_CONFIG_ERROR_TAG} ${message}`);
}

export async function runTranscription(ctx: any, input: RunTranscriptionInput): Promise<{ text: string; language?: string; durationInSeconds?: number }> {
    if (!input?.providerId) throw new Error('runTranscription requires a providerId.');
    if (!input?.audioBase64) throw new Error('runTranscription requires audioBase64.');
    // Spends a provider credential — require an identified caller at the call
    // site so a misconfigured `rpcVerifiers` cannot re-expose it.
    resolveUserScope(ctx);

    const registry = ChatServerRegistry.instance();
    const runtime = await resolveTranscriptionRuntime(registry, ctx, input.providerId);
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw transcriptionConfigError(`Unknown provider adapter '${runtime.type.adapter}'.`);
    if (typeof adapter.resolveTranscriptionModel !== 'function') {
        throw transcriptionConfigError(
            `Provider '${input.providerId}' (adapter '${runtime.type.adapter}') does not support transcription. ` +
            `Bind the speech-to-text vercel driver to a transcription-capable provider ` +
            `(see listTranscriptionProviders).`
        );
    }

    const modelId = input.model || runtime.instance.defaultModelId || runtime.type.defaultModelId || 'whisper-1';

    // Core egress backstop (degrade closed): if the resolved config carries a
    // transcription endpoint URL, pre-vet it here before the adapter builds a
    // model over it. Adapters MUST still validate + egress via the SSRF guard
    // themselves (the opaque model may bring its own HTTP client this function
    // never sees), but this ensures a config-supplied baseUrl is rejected for a
    // private/metadata destination even if a future adapter forgets to.
    const server: any = (globalThis as any).XOPAT_SERVER;
    const cfgBaseUrl = String(runtime.config?.baseUrl || runtime.config?.baseURL || '').trim();
    if (cfgBaseUrl && typeof server?.validateUpstreamUrl === 'function') {
        await server.validateUpstreamUrl(cfgBaseUrl);
    }

    const resolved = await adapter.resolveTranscriptionModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId,
        contextId: runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
        // Operator-configured request budget (XOPAT_STT_TRANSCRIBE_TIMEOUT_MS). Adapters whose
        // model performs its own HTTP (e.g. the openai-compatible shim's safeRequest) must apply
        // this as their per-request timeout — otherwise the shim's own 120s default caps the
        // request below a raised env value even though the abort signal is linked to it.
        transcribeTimeoutMs: TRANSCRIBE_TIMEOUT_MS,
    });
    const { model, providerOptionsName } = (resolved && typeof resolved === 'object' && 'model' in resolved)
        ? resolved as ResolvedTranscriptionModel
        : { model: resolved as TranscriptionModelV3, providerOptionsName: undefined };
    // v3 and v4 of the transcription spec are structurally identical (same
    // doGenerate call options and result) — only the discriminant differs, so
    // both are accepted; provider packages on either provider-spec major work.
    const specVersion = (model as any)?.specificationVersion;
    if (!model || (specVersion !== 'v3' && specVersion !== 'v4')) {
        throw transcriptionConfigError(
            `Transcription model for provider '${input.providerId}' has an unsupported ` +
            `specification version '${String(specVersion)}' (expected 'v3' or 'v4').`
        );
    }

    // Whisper-style hints travel as provider-namespaced options; the adapter
    // names the namespace its SDK package reads (defaults to model.provider).
    const hints: Record<string, unknown> = {};
    if (input.language) hints.language = String(input.language);
    const bias = String(input.prompt ?? '').trim().slice(0, TRANSCRIBE_MAX_PROMPT_CHARS);
    if (bias) hints.prompt = bias;

    const result = await model.doGenerate({
        audio: new Uint8Array(Buffer.from(input.audioBase64, 'base64')),
        mediaType: input.mediaType || 'audio/webm',
        providerOptions: Object.keys(hints).length
            ? { [providerOptionsName || model.provider]: hints } as any
            : undefined,
        abortSignal: createTimeoutLinkedSignal(ctx?.signal, TRANSCRIBE_TIMEOUT_MS),
    });

    return {
        text: typeof result?.text === 'string' ? result.text : '',
        ...(result?.language ? { language: String(result.language) } : {}),
        ...(typeof result?.durationInSeconds === 'number' ? { durationInSeconds: result.durationInSeconds } : {}),
    };
}

/**
 * List provider instances whose adapter supports transcription. Unlike the
 * chat `listProviders`, `metadata.hidden` providers are INCLUDED (hidden means
 * "out of the chat picker"; dedicated transcription providers are typically
 * exactly those) — the flag is passed through instead. Context restrictions
 * narrow the list degrade-open, mirroring the chat picker; the real gate stays
 * `getProviderRuntime` at transcription time.
 */
export async function listTranscriptionProviders(ctx: any): Promise<{
    providers: Array<{
        id: string;
        typeId: string;
        label: string;
        description?: string;
        defaultModelId: string | null;
        hidden?: boolean;
    }>;
}> {
    const registry = ChatServerRegistry.instance();
    const all = await registry.listProviderInstances({ ownerPrincipal: safeUserScope(ctx) });
    const ctxContextId = typeof ctx?.contextId === 'string' && ctx.contextId ? ctx.contextId : null;
    const providers = all
        .filter((p: any) => {
            const type = registry.getProviderType(p.typeId);
            const adapter = type ? registry.getAdapter(type.adapter) : undefined;
            if (typeof adapter?.resolveTranscriptionModel !== 'function') return false;
            const allowed = normalizeContexts(p?.metadata?.contexts ?? type?.metadata?.contexts);
            return !allowed.length || !ctxContextId || allowed.includes(ctxContextId);
        })
        // Non-secret projection only — never config/secrets/secretKeys.
        .map((p: any) => ({
            id: String(p.id),
            typeId: String(p.typeId),
            label: String(p.label || p.id),
            ...(p.description ? { description: String(p.description) } : {}),
            defaultModelId: p.defaultModelId ?? null,
            ...(p?.metadata?.hidden === true ? { hidden: true } : {}),
        }));
    return { providers };
}

/**
 * Resolve a transcription provider from a reference, tagging the config-error case.
 *
 * The reference resolution itself now lives in `ChatServerRegistry.resolveProviderRuntime`
 * (shared with `runVisionInference`, algorithm in `shared/providerRef.ts`). What remains here is
 * transcription-specific: an unresolvable reference is a PERMANENT deployment mistake, so it must
 * carry the `[stt-config-error]` tag that makes `speech-to-text` latch the binding dead instead of
 * retrying every utterance forever. Note this also fixes an exact-but-dead `vercel.providerId`,
 * which previously threw untagged from `getProviderRuntime` and was retried indefinitely.
 *
 * An ownership or auth-context refusal is NOT re-tagged: it clears the moment the user logs in and
 * must stay retryable. Recognised by `.code`, never `instanceof` — each `*.server.ts` entry is
 * bundled independently, so the class object here is not the one chatRegistry threw.
 */
async function resolveTranscriptionRuntime(registry: any, ctx: any, providerId: string): Promise<any> {
    try {
        return await registry.resolveProviderRuntime(providerId, { ctx, userScope: safeUserScope(ctx) });
    } catch (e: any) {
        if (isProviderAccessError(e)) throw e;
        if (e?.code === CHAT_ERR_UNKNOWN_PROVIDER) {
            throw transcriptionConfigError(
                `No transcription provider matches '${providerId}' ` +
                `(tried exact id, managed key, plugin id, and type id).`);
        }
        throw e;
    }
}

