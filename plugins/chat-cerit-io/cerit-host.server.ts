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

export async function ensureChatProviderRegistered(ctx: any, input: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) {
        throw new Error("XOPAT_SERVER helpers are not available.");
    }

    const pluginId = ctx?.itemId || "chat-cerit-io";
    const secure = XS.getSecurePluginConfig(ctx, pluginId);
    const defaults = secure?.providerDefaults || {};

    const ensureManagedPluginProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts",
        "ensureManagedPluginProvider"
    );
    const buildOpenAICompatibleProviderType = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerTypes.server.ts",
        "buildOpenAICompatibleProviderType"
    );

    const typeId = pick(defaults.id, input.typeId, "cerit-openai")!;
    const label = pick(defaults.label, input.label, "CERIT")!;
    const description = pick(
        defaults.description,
        input.description,
        "CERIT OpenAI-compatible endpoint"
    )!;
    const contextId = pick(defaults.contextId, input.contextId, "jwt")!;
    const authType = pick(defaults.authType, input.authType, "jwt")!;
    const requiresLogin = pick(defaults.requiresLogin, input.requiresLogin, true)!;
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
        providerType,
        provider: providerPayload,
    });
}
