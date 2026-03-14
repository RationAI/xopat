export const policy = {
    ensureChatProviderRegistered: {
        auth: { public: false, requireSession: false },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
} as const;

let registered = false;

export async function ensureChatProviderRegistered(ctx: any, input: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) {
        throw new Error("XOPAT_SERVER helpers are not available.");
    }

    const secure = XS.getSecurePluginConfig(ctx, ctx?.itemId);
    const defaults = secure?.providerDefaults || {};

    const registerProviderTypeServer = await XS.importServerExport(ctx, "module:vercel-ai-chat-sdk/server/chat.server.ts", "registerProviderTypeServer");
    const buildOpenAICompatibleProviderType = await XS.importServerExport(ctx, "module:vercel-ai-chat-sdk/server/providerTypes.server.ts", "buildOpenAICompatibleProviderType");

    const typeId = defaults.id || input.typeId || "cerit-openai";

    registerProviderTypeServer(buildOpenAICompatibleProviderType({
        id: typeId,
        label: defaults.label || input.label || "CERIT",
        description: defaults.description || input.description || "CERIT OpenAI-compatible endpoint",
        contextId: defaults.contextId || input.contextId || "jwt",
        authType: defaults.authType || input.authType || "jwt",
        requiresLogin: defaults.requiresLogin ?? input.requiresLogin ?? true,
        fixedConfig: {
            baseUrl: defaults.baseUrl || input.baseUrl || "",
            modelsPath: defaults.modelsPath || input.modelsPath || "/models",
            defaultModelId: defaults.defaultModelId || input.defaultModelId || "coder",
        },
        fixedSecrets: {
            apiKey: defaults.apiKey || "",
        },
    }));

    const changed = !registered;
    registered = true;
    return { ok: true, registered: changed, providerTypeId: typeId };
}
