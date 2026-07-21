import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Server host for the `pathology-medgemma` plugin.
 *
 * MedGemma (Google's medical vision-language model) is served self-hosted over
 * the OpenAI-compatible wire format (Ollama / vLLM / TGI). So there is nothing
 * MedGemma- or Ollama-specific to implement here: we reuse the chat SDK's
 * provider registry (`ensureManagedPluginProvider`) with an OpenAI-compatible
 * adapter and hand the resulting provider instance to the pathology-foundation
 * `analyze` driver (registered client-side, see index.workspace.js).
 *
 * The provider is a DEDICATED pathology provider — deliberately separate from
 * any chat-agent provider — so pathology inference never shares model, secrets,
 * or context with the conversation agent.
 *
 * All endpoint config (`baseUrl`, `apiKey`, `defaultModelId`) is server-only
 * secure config (`server.json` author tier / `core.server.secure.plugins`
 * deployer tier); it never reaches the browser.
 */

export const policy = {
    ensureMedGemmaProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
} as const;

function pick<T>(...values: T[]): T | undefined {
    for (const value of values) {
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

/** Coerce a `string | string[]` allow-list into a de-duped, trimmed string[]. */
function normalizeContexts(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const out: string[] = [];
    for (const entry of raw) {
        const id = typeof entry === "string" ? entry.trim() : "";
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}

function buildHeaders(config: Record<string, unknown>, secrets: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {};
    const apiKey = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : "";
    const headerName = typeof config.apiKeyHeader === "string" && config.apiKeyHeader ? String(config.apiKeyHeader) : "Authorization";
    if (apiKey) {
        headers[headerName] = headerName.toLowerCase() === "authorization" ? `Bearer ${apiKey}` : apiKey;
    }
    const headersJson = typeof config.headersJson === "string" ? config.headersJson.trim() : "";
    if (headersJson) {
        const extra = JSON.parse(headersJson);
        if (extra && typeof extra === "object") {
            for (const [key, value] of Object.entries(extra)) {
                if (value != null) headers[key] = String(value);
            }
        }
    }
    return headers;
}

function buildProviderType(input: {
    id: string;
    label: string;
    description?: string;
    defaultModelId?: string;
    contextId?: string | null;
    authType?: string | null;
    requiresLogin?: boolean;
    fixedConfig?: Record<string, unknown>;
    fixedSecrets?: Record<string, unknown>;
    contexts?: string[];
}): CreateProviderTypeInput {
    return {
        id: input.id,
        label: input.label,
        description: input.description || "Self-hosted MedGemma (OpenAI-compatible) vision model",
        adapter: "openai-compatible-vision",
        // MedGemma-4b-it is multimodal — advertise image support so the model
        // picker / capability layer treat it as vision-capable.
        supportsUploads: true,
        supportsImages: true,
        supportsFiles: false,
        supportsToolCalls: false,
        defaultModelId: input.defaultModelId,
        requiresLogin: input.requiresLogin,
        contextId: input.contextId ?? null,
        authType: input.authType ?? null,
        fixedConfig: input.fixedConfig,
        fixedSecrets: input.fixedSecrets,
        source: "plugin",
        // Internal-only: MedGemma is an inference backend used by the pathology
        // `analyze` driver via runVisionInference, NOT a user-facing chat agent.
        // `hidden` keeps it out of the chat provider/type pickers while it stays
        // resolvable by id server-side. An optional `contexts` allow-list further
        // restricts resolution to named verifier-backed contexts.
        metadata: { hidden: true, ...(input.contexts && input.contexts.length ? { contexts: input.contexts } : {}) },
        configSchema: [
            { key: "baseUrl", label: "Base URL", input: "url", required: true, placeholder: "http://xopat-medgemma-ollama:11434/v1" },
            { key: "apiKey", label: "API key", input: "password", secret: true, description: "Stored server-side only. Ollama needs none; leave blank." },
            { key: "apiKeyHeader", label: "API key header", input: "text", defaultValue: "Authorization" },
            { key: "headersJson", label: "Extra headers JSON", input: "textarea" },
        ],
    };
}

export async function ensureMedGemmaProvider(ctx: any, input: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) throw new Error("XOPAT_SERVER helpers are not available.");

    const pluginId = ctx?.itemId || "pathology-medgemma";
    const secure = XS.getSecurePluginConfig(ctx, pluginId);
    const defaults = secure?.providerDefaults || {};

    const ensureManagedPluginProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts",
        "ensureManagedPluginProvider"
    );
    const { validateUpstreamUrl } = XS;

    const typeId = pick(defaults.id, input.typeId, "medgemma")!;
    const label = pick(defaults.label, input.label, "MedGemma (self-hosted)")!;
    const description = pick(defaults.description, input.description, "MedGemma vision model for pathology analysis")!;
    // Contextual-availability allow-list — SECURE CONFIG ONLY. Empty ⇒ unrestricted.
    const contexts = normalizeContexts(defaults.contexts);
    // Default the routing context to the first allow-list entry when set, so the
    // analyze/runVisionInference call runs inside the allow-list the runtime gate
    // checks against; otherwise stay null (internal, unrestricted).
    const contextId = pick(defaults.contextId, input.contextId, contexts[0] || null);
    const authType = pick(defaults.authType, input.authType, null);
    const requiresLogin = pick(defaults.requiresLogin, input.requiresLogin, true)!;
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "medgemma-4b-it")!;
    const apiKey = pick(defaults.apiKey, input.apiKey, "")!;
    // Self-hosted MedGemma typically runs on an internal/private host (docker
    // network, loopback), which the SSRF guard rejects by design. The baseUrl
    // here is operator-only secure config — never user-supplied — so it is
    // trusted and the private-IP guard is skipped unless the operator opts in.
    const validateUpstream = pick(defaults.validateUpstream, input.validateUpstream, false)!;

    const providerType = buildProviderType({
        id: typeId,
        label,
        description,
        defaultModelId,
        contextId,
        authType,
        requiresLogin,
        fixedConfig: { baseUrl, defaultModelId, validateUpstream },
        fixedSecrets: { apiKey },
        contexts,
    });

    return ensureManagedPluginProvider(ctx, {
        pluginId,
        managedKey: `${pluginId}:${typeId}:default`,
        adapter: {
            id: "openai-compatible-vision",
            // No model discovery over the network: pathology only needs the
            // configured default model, and a network probe would hit the SSRF
            // guard for internal hosts. Report the configured model directly.
            async listModels({ config, type }: any) {
                const modelId = String(config.defaultModelId || type?.defaultModelId || "").trim();
                if (!modelId) return [];
                return [{
                    id: modelId,
                    label: modelId,
                    multimodal: true,
                    supportsImages: true,
                    supportsFiles: false,
                    supportsToolCalls: false,
                    capabilities: { text: "supported", images: "supported", files: "unsupported", source: "config" },
                }];
            },
            async resolveModel({ instance, modelId, config, secrets }: any) {
                const baseURL = String(config.baseUrl || config.baseURL || "").trim();
                if (!baseURL) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
                // Only vet the URL when the operator explicitly opts in (public,
                // untrusted endpoints). Internal self-hosted endpoints are
                // trusted operator config; the SDK does its own outbound fetch.
                if (config.validateUpstream === true) await validateUpstreamUrl(baseURL);
                const key = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : undefined;
                const headers = buildHeaders(config, secrets);
                return createOpenAICompatible({ name: instance.id, baseURL, apiKey: key, headers })(modelId);
            },
        },
        providerType,
        provider: {
            typeId,
            label,
            description,
            defaultModelId,
            contextId,
            authType,
            requiresLogin,
            config: { ...(input.config || {}) },
            secrets: { ...(input.secrets || {}) },
            // Mark the instance internal too; ensureManagedPluginProvider spreads
            // this metadata last, so `hidden` survives next to managedByPlugin/role.
            // Deployer `contexts` spread last so untrusted `input` cannot override.
            metadata: { hidden: true, ...(input.metadata || {}), ...(contexts.length ? { contexts } : {}) },
        },
    });
}
