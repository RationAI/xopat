import { generateText } from 'ai';
import { ChatServerRegistry } from './chatRegistry.server';

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

export const policy = {
    runVisionInference: {
        // Requires a logged-in session like the other model-invoking RPCs, but
        // never reads or mutates chat sessions.
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 90_000, maxBodyBytes: 12 * 1024 * 1024, maxConcurrency: 4, queueLimit: 16 },
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
    const runtime = await registry.getProviderRuntime(input.providerId);
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
        content.push({
            type: 'image',
            image: `data:${mediaType};base64,${input.imageBase64}`,
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
