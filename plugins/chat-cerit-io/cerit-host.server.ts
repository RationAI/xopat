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

    const registerProviderTypeServer = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/chat.server.ts",
        "registerProviderTypeServer"
    );
    const createProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/chat.server.ts",
        "createProvider"
    );
    const updateProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/chat.server.ts",
        "updateProvider"
    );
    const listProviders = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/chat.server.ts",
        "listProviders"
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
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "coder")!;
    const apiKey = pick(defaults.apiKey, input.apiKey, "")!;

    registerProviderTypeServer(
        buildOpenAICompatibleProviderType({
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
        })
    );

    const managedKey = `${pluginId}:${typeId}:default`;

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
            managedByPlugin: pluginId,
            managedKey,
            autoCreated: true,
            role: "default-provider",
            ...(input.metadata || {}),
        },
    };

    const listed = await listProviders(ctx, { typeId });
    const providers = Array.isArray(listed?.providers) ? listed.providers : [];

    const existing = providers.find((provider: any) => {
        const meta = provider?.metadata || {};
        return (
            provider?.typeId === typeId &&
            (
                meta.managedKey === managedKey ||
                (meta.managedByPlugin === pluginId && meta.autoCreated === true)
            )
        );
    });

    let provider: any;
    let providerCreated = false;
    let providerUpdated = false;

    if (!existing) {
        provider = await createProvider(ctx, providerPayload);
        providerCreated = true;
    } else {
        provider = await updateProvider(ctx, {
            id: existing.id,
            ...providerPayload,
        });
        providerUpdated = true;
    }

    return {
        ok: true,
        providerTypeId: typeId,
        providerId: provider?.id || existing?.id || null,
        providerCreated,
        providerUpdated,
    };
}