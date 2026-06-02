import { createAnthropic } from '@ai-sdk/anthropic';

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

function buildAnthropicProviderType(input: {
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
        description: input.description || "Anthropic Claude API endpoint",
        adapter: "anthropic",
        supportsUploads: true,
        supportsFiles: false,
        supportsImages: true,
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
            { key: "baseUrl", label: "Base URL", input: "url", defaultValue: "https://api.anthropic.com/v1", description: "Anthropic API base URL. Leave default for direct Claude API access." },
            { key: "apiKey", label: "API key", input: "password", secret: true, description: "Stored server-side only. Leave blank to keep plugin default token." },
            { key: "anthropicVersion", label: "Anthropic version", input: "text", defaultValue: "2023-06-01", description: "Sent as the anthropic-version header." },
            { key: "modelsPath", label: "Models path", input: "text", defaultValue: "/models", description: "Relative or absolute path for Anthropic model discovery." },
            { key: "headersJson", label: "Extra headers JSON", input: "textarea", description: "Optional JSON object with additional non-secret headers." },
        ],
    };
}

export async function ensureChatProviderRegistered(ctx: any, input: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) {
        throw new Error("XOPAT_SERVER helpers are not available.");
    }

    const pluginId = ctx?.itemId || "chat-anthropic";
    const secure = XS.getSecurePluginConfig(ctx, pluginId);
    const defaults = secure?.providerDefaults || {};

    const ensureManagedPluginProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts",
        "ensureManagedPluginProvider"
    );
    const { safeFetch, validateUpstreamUrl } = XS;

    const typeId = pick(defaults.id, input.typeId, "anthropic-claude")!;
    const label = pick(defaults.label, input.label, "Anthropic")!;
    const description = pick(
        defaults.description,
        input.description,
        "Anthropic Claude API endpoint"
    )!;
    const contextId = pick(defaults.contextId, input.contextId, "jwt")!;
    const authType = pick(defaults.authType, input.authType, "jwt")!;
    const requiresLogin = pick(defaults.requiresLogin, input.requiresLogin, true)!;
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "https://api.anthropic.com/v1")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "")!;
    const modelsPath = pick(defaults.modelsPath, input.modelsPath, "/models")!;
    const anthropicVersion = pick(defaults.anthropicVersion, input.anthropicVersion, "2023-06-01")!;
    const apiKey = pick(defaults.apiKey, input.apiKey, "")!;

    const providerType = buildAnthropicProviderType({
        id: typeId,
        label,
        description,
        contextId,
        authType,
        requiresLogin,
        fixedConfig: {
            baseUrl,
            anthropicVersion,
            modelsPath,
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
            id: "anthropic",
            async listModels({ ctx, config, secrets, type }: any) {
                const resolvedBaseUrl = String(config.baseUrl || "https://api.anthropic.com/v1").trim();
                const resolvedModelsPath = String(config.modelsPath || "/models").trim() || "/models";
                const resolvedVersion = typeof config.anthropicVersion === "string" && config.anthropicVersion
                    ? String(config.anthropicVersion)
                    : "2023-06-01";
                const apiKeyValue = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : "";
                const headers: Record<string, string> = {
                    "anthropic-version": resolvedVersion,
                };
                if (apiKeyValue) {
                    headers["x-api-key"] = apiKeyValue;
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
                const url = resolveEndpointUrl(resolvedBaseUrl, resolvedModelsPath);
                const res = await safeFetch(url, {
                    method: "GET",
                    headers,
                    signal: ctx?.signal,
                });
                if (!res.ok) {
                    throw new Error(`Anthropic model discovery failed: ${res.status} ${res.statusText}`);
                }
                const json = await res.json();
                const data = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
                return data
                    .map((item: any) => ({
                        id: String(item?.id || "").trim(),
                        label: String(item?.display_name || item?.name || item?.id || "").trim(),
                        description: typeof item?.description === "string" ? item.description : undefined,
                        multimodal: true,
                        supportsFiles: false,
                        supportsImages: true,
                        supportsToolCalls: type.supportsToolCalls,
                        capabilities: {
                            text: "supported",
                            images: "supported",
                            files: "unsupported",
                            source: "provider",
                        },
                    }))
                    .filter((item: any) => item.id);
            },
            async resolveModel({ instance, modelId, config, secrets }: any) {
                const resolvedBaseUrl = String(config.baseUrl || "https://api.anthropic.com/v1").trim();
                if (!resolvedBaseUrl) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
                // Vet the baseUrl before handing it to the SDK; the SDK does
                // its own fetching afterwards, so this is the only chance to
                // block the obvious SSRF (private IP / localhost / metadata
                // endpoint). The SDK's internal redirects remain trusted.
                await validateUpstreamUrl(resolvedBaseUrl);
                const resolvedVersion = typeof config.anthropicVersion === "string" && config.anthropicVersion
                    ? String(config.anthropicVersion)
                    : "2023-06-01";
                const apiKeyValue = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : undefined;
                const headers: Record<string, string> = {
                    "anthropic-version": resolvedVersion,
                };
                const headersJson = typeof config.headersJson === "string" ? config.headersJson.trim() : "";
                if (headersJson) {
                    const extra = JSON.parse(headersJson);
                    if (extra && typeof extra === "object") {
                        for (const [key, value] of Object.entries(extra)) {
                            if (value != null) headers[key] = String(value);
                        }
                    }
                }
                return createAnthropic({
                    apiKey: apiKeyValue,
                    baseURL: resolvedBaseUrl,
                    headers,
                })(modelId);
            },
        },
        providerType,
        provider: providerPayload,
    });
}
