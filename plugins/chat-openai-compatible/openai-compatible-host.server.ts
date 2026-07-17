import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createHash } from "node:crypto";

/**
 * Provider-factory cache: `createOpenAICompatible` was rebuilt on every single
 * turn (and probe). Keyed by the full connection identity — any config/secret
 * change changes the key, so invalidation is implicit; a module hot-reload
 * clears the map wholesale. Secrets enter the key only as a digest.
 */
const providerFactoryCache = new Map<string, (modelId: string) => any>();
const PROVIDER_FACTORY_CACHE_MAX = 32;

function providerFactoryFor(instanceId: string, baseURL: string, apiKey: string | undefined, headers: Record<string, string>): (modelId: string) => any {
    const digest = createHash("sha256")
        .update(JSON.stringify([instanceId, baseURL, apiKey || "", headers]))
        .digest("hex");
    let factory = providerFactoryCache.get(digest);
    if (!factory) {
        factory = createOpenAICompatible({ name: instanceId, baseURL, apiKey, headers }) as any;
        providerFactoryCache.set(digest, factory!);
        while (providerFactoryCache.size > PROVIDER_FACTORY_CACHE_MAX) {
            const oldest = providerFactoryCache.keys().next().value as string;
            providerFactoryCache.delete(oldest);
        }
    }
    return factory!;
}

export const policy = {
    ensureChatProviderRegistered: {
        auth: { public: false, requireSession: false },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
} as const;

function pick<T>(...values: T[]): T | undefined {
    for (const value of values) {
        if (value !== undefined && value !== null) return value;
    }
    return undefined;
}

function ensureSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
}

function resolveEndpointUrl(baseURL: string, endpoint: string): string {
    const normalizedBaseURL = String(baseURL || "").trim();
    const normalizedEndpoint = String(endpoint || "").trim();

    if (!normalizedBaseURL) return normalizedEndpoint;
    if (!normalizedEndpoint) return normalizedBaseURL;
    if (/^https?:\/\//i.test(normalizedEndpoint)) return normalizedEndpoint;

    return new URL(normalizedEndpoint.replace(/^\/+/, ""), ensureSlash(normalizedBaseURL)).toString();
}

function buildOpenAICompatibleHeaders(config: Record<string, unknown>, secrets: Record<string, unknown>): Record<string, string> {
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

function inferCapabilitiesFromModelItem(item: any): ModelCapabilities {
    const modalities = Array.isArray(item?.modalities)
        ? item.modalities.map((value: any) => String(value || "").toLowerCase())
        : [];
    const supportsVision = modalities.includes("image") || modalities.includes("vision");
    const supportsFiles = modalities.includes("file");

    return {
        text: "supported",
        images: supportsVision ? "supported" : "unsupported",
        files: supportsFiles ? "supported" : "unsupported",
        source: "provider",
    };
}

function buildOpenAICompatibleProviderType(input: {
    id: string;
    label: string;
    description?: string;
    defaultModelId?: string;
    contextId?: string | null;
    authType?: string | null;
    requiresLogin?: boolean;
    fixedConfig?: Record<string, unknown>;
    fixedSecrets?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}): CreateProviderTypeInput {
    return {
        id: input.id,
        label: input.label,
        description: input.description || "OpenAI-compatible endpoint",
        adapter: "openai-compatible",
        supportsUploads: true,
        supportsFiles: false,
        supportsImages: false,
        supportsToolCalls: false,
        defaultModelId: input.defaultModelId,
        requiresLogin: input.requiresLogin,
        contextId: input.contextId ?? null,
        authType: input.authType ?? null,
        fixedConfig: input.fixedConfig,
        fixedSecrets: input.fixedSecrets,
        metadata: input.metadata,
        source: "plugin",
        configSchema: [
            { key: "baseUrl", label: "Base URL", input: "url", required: true, placeholder: "https://example.invalid/v1" },
            { key: "modelsPath", label: "Models path", input: "text", defaultValue: "/models" },
            { key: "apiKey", label: "API key", input: "password", secret: true, description: "Stored server-side only. Leave blank to keep plugin default token." },
            { key: "apiKeyHeader", label: "API key header", input: "text", defaultValue: "Authorization" },
            { key: "headersJson", label: "Extra headers JSON", input: "textarea" },
        ],
    };
}

export async function ensureChatProviderRegistered(ctx: any, input: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) {
        throw new Error("XOPAT_SERVER helpers are not available.");
    }

    const pluginId = ctx?.itemId || "chat-openai-compatible";
    const secure = XS.getSecurePluginConfig(ctx, pluginId);
    const defaults = secure?.providerDefaults || {};

    const ensureManagedPluginProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts",
        "ensureManagedPluginProvider"
    );
    const { safeFetch, validateUpstreamUrl } = XS;

    const typeId = pick(defaults.id, input.typeId, "openai-compatible")!;
    const label = pick(defaults.label, input.label, "OpenAI-compatible")!;
    const description = pick(
        defaults.description,
        input.description,
        "OpenAI-compatible endpoint"
    )!;
    const authType = pick(defaults.authType, input.authType, "jwt")!;
    // A non-login auth mode is authoritative: never fall through to the
    // login-required default. Otherwise a provider without an explicit secure
    // `requiresLogin: false` (e.g. authMode "none") would wrongly demand login.
    const requiresLogin = authType === "none"
        ? false
        : pick(defaults.requiresLogin, input.requiresLogin, authType === "jwt")!;
    // A no-login provider must never carry an auth context id — otherwise the
    // client would route listModels/chat RPCs through the authed (refreshOn401)
    // path and 401-loop against a context it never logs into.
    const contextId = requiresLogin
        ? pick(defaults.contextId, input.contextId, "jwt")!
        : null;
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "")!;
    const modelsPath = pick(defaults.modelsPath, input.modelsPath, "/models")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "")!;
    const apiKey = pick(defaults.apiKey, input.apiKey, "")!;

    const providerType = buildOpenAICompatibleProviderType({
        id: typeId,
        label,
        description,
        contextId,
        authType,
        requiresLogin,
        fixedConfig: {
            baseUrl,
            modelsPath,
            defaultModelId,
        },
        fixedSecrets: {
            apiKey,
        },
    });
    const providerPayload = {
        typeId,
        label,
        description,
        defaultModelId,
        contextId,
        authType,
        requiresLogin,
        config: {
            ...(input.config || {}),
        },
        secrets: {
            ...(input.secrets || {}),
        },
        metadata: {
            ...(input.metadata || {}),
        },
    };

    return ensureManagedPluginProvider(ctx, {
        pluginId,
        adapter: {
            id: "openai-compatible",
            async listModels({ ctx, config, secrets, type }: any) {
                const baseURL = String(config.baseUrl || config.baseURL || "").trim();
                if (!baseURL) return [];
                const modelsPath = String(config.modelsPath || "/models");
                const url = resolveEndpointUrl(baseURL, modelsPath);
                const headers = buildOpenAICompatibleHeaders(config, secrets);
                const res = await safeFetch(url, { method: "GET", headers, signal: ctx?.signal });
                if (!res.ok) throw new Error(`Model discovery failed: ${res.status} ${res.statusText}`);
                const json = await res.json();
                const data = Array.isArray(json?.data) ? json.data : [];
                return data.map((item: any) => {
                    const capabilities = inferCapabilitiesFromModelItem(item);
                    return {
                        id: String(item.id),
                        label: item?.name || String(item.id),
                        description: item?.description || undefined,
                        multimodal: capabilities.images === "supported" || capabilities.files === "supported",
                        supportsFiles: capabilities.files === "supported",
                        supportsImages: capabilities.images === "supported",
                        supportsToolCalls: type.supportsToolCalls,
                        capabilities,
                    };
                });
            },
            async resolveModel({ instance, modelId, config, secrets }: any) {
                const baseURL = String(config.baseUrl || config.baseURL || "").trim();
                if (!baseURL) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
                // Vet the baseURL before handing it to the SDK; see the
                // analogous note in chat-anthropic for the reasoning.
                await validateUpstreamUrl(baseURL);
                const apiKey = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : undefined;
                const headers = buildOpenAICompatibleHeaders(config, secrets);
                return providerFactoryFor(instance.id, baseURL, apiKey, headers)(modelId);
            },
        },
        providerType,
        provider: providerPayload,
    });
}
