import { createAnthropic } from '@ai-sdk/anthropic';

export const policy = {
    ensureChatProviderRegistered: {
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
    /** False only when the deployment declared the endpoint keyless (`providerDefaults.apiKey: false`). */
    apiKeyRequired?: boolean;
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
            // `required` is what stops model discovery from calling the upstream
            // with no credential and collecting a 401 on every boot. The
            // deployment declares a keyless endpoint with `providerDefaults.apiKey: false`.
            { key: "apiKey", label: "API key", input: "password", secret: true, required: input.apiKeyRequired !== false, description: "Stored server-side only. Leave blank to keep plugin default token." },
            { key: "anthropicVersion", label: "Anthropic version", input: "text", defaultValue: "2023-06-01", description: "Sent as the anthropic-version header." },
            { key: "modelsPath", label: "Models path", input: "text", defaultValue: "/models", description: "Relative or absolute path for Anthropic model discovery." },
            { key: "headersJson", label: "Extra headers JSON", input: "textarea", description: "Optional JSON object with additional non-secret headers." },
        ],
    };
}

/**
 * The ONLY non-secure input this registration accepts: the plugin's own
 * DEPLOYMENT metadata (include.json merged with ENV plugins.<id>), read
 * server-side from ctx.core.PLUGINS.
 *
 * The RPC input is ignored entirely. It used to carry {contextId, authType,
 * requiresLogin} plus config/secrets/metadata straight into the operator's
 * managed provider record — i.e. the CLIENT told the server what its own auth
 * requirements were, and could repoint the operator's endpoint while the
 * operator's fixedSecrets still flowed. There is no safe version of that
 * (AGENTS.md §7: RPC input is strictly less trusted than getOption), and
 * ignoring it is simpler than validating it.
 */
function deploymentAuthInput(ctx: any, pluginId: string): any {
    const meta = (ctx?.core?.PLUGINS || {})[pluginId] || {};
    const authType = typeof meta.authMode === "string" && meta.authMode ? meta.authMode : "none";
    return {
        authType,
        requiresLogin: authType !== "none",
        contextId: typeof meta.authContext === "string" && meta.authContext ? meta.authContext : undefined,
    };
}

export async function ensureChatProviderRegistered(ctx: any, _clientInput: any = {}) {
    const XS = globalThis.XOPAT_SERVER;
    if (!XS) {
        throw new Error("XOPAT_SERVER helpers are not available.");
    }

    const pluginId = ctx?.itemId || "chat-anthropic";
    // RPC input is ignored — see deploymentAuthInput above.
    const input = deploymentAuthInput(ctx, pluginId);
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
    // `authType` is the CLIENT SECRET TYPE (what HttpClient attaches), not an auth
    // method and not a context id. Default "none": auth is an opt-in addon, so a
    // deployment that configures nothing still gets a working provider.
    const authType = pick(defaults.authType, input.authType, "none")!;
    // A non-login auth mode is authoritative: never fall through to the
    // login-required default. Otherwise a provider without an explicit secure
    // `requiresLogin: false` (e.g. authMode "none") would wrongly demand login.
    const requiresLogin = authType === "none"
        ? false
        : pick(defaults.requiresLogin, input.requiresLogin, true)!;
    // Contextual-availability allow-list — SECURE CONFIG ONLY (never `input`, which
    // is session/URL-derived and untrusted). Empty ⇒ unrestricted.
    const contexts = normalizeContexts(defaults.contexts);
    // A no-login provider must never carry an auth context id — otherwise the
    // client would route listModels/chat RPCs through the authed (refreshOn401)
    // path and 401-loop against a context it never logs into. When an availability
    // allow-list is set, default the routing context to its first entry so authed
    // calls run *inside* the allow-list (the runtime gate checks the routing
    // context against `contexts`); otherwise fall back to the viewer's main
    // context, "core". ("jwt" used to be the fallback here — that is a SECRET
    // TYPE, not a context id, so it 401-looped against a context nobody configures.)
    const contextId = requiresLogin
        ? pick(defaults.contextId, input.contextId, contexts[0] || "core")!
        : null;
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "https://api.anthropic.com/v1")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "")!;
    const modelsPath = pick(defaults.modelsPath, input.modelsPath, "/models")!;
    const anthropicVersion = pick(defaults.anthropicVersion, input.anthropicVersion, "2023-06-01")!;
    // `providerDefaults.apiKey` carries three states: a string is the operator key,
    // absent/"" means "a key is required but none is configured" (discovery stays
    // off until someone supplies one — BYOK included), and `false` is the operator
    // declaring the endpoint keyless, which re-enables credential-free discovery.
    // `pick` skips only undefined/null, so `false` survives.
    const rawApiKey = pick(defaults.apiKey, input.apiKey, "");
    const apiKeyRequired = rawApiKey !== false;
    const apiKey = typeof rawApiKey === "string" ? rawApiKey : "";
    // Internal-only flag: keeps the provider out of the chat/type pickers while
    // it stays resolvable by id. A deployer `hidden:true` wins via pick
    // precedence and cannot be un-hidden by input.
    const hidden = pick(defaults.hidden, false) === true;
    const providerMetadata: Record<string, unknown> = {
        ...(hidden ? { hidden: true } : {}),
        ...(contexts.length ? { contexts } : {}),
    };

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
        apiKeyRequired,
        metadata: Object.keys(providerMetadata).length ? providerMetadata : undefined,
    });
    const providerPayload = {
        typeId,
        label,
        description,
        defaultModelId,
        contextId,
        authType,
        requiresLogin,
        // Empty by construction: the managed instance carries NO caller-supplied
        // config or secrets. Its endpoint and key live on the provider TYPE
        // (fixedConfig/fixedSecrets) from secure config.
        config: {},
        secrets: {},
        // Deployer flags (hidden/contexts) spread last so an untrusted `input`
        // cannot override them.
        metadata: { ...providerMetadata },
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
                    // Free-text operator/BYOK field: malformed JSON degrades to "no
                    // extra headers" instead of throwing a SyntaxError out of the
                    // RPC as a 500.
                    let extra: unknown = null;
                    try {
                        extra = JSON.parse(headersJson);
                    } catch (e: any) {
                        XS.log("plugin.chat-anthropic")
                            .warn(`Ignoring malformed 'headersJson' provider config: ${e?.message || e}`);
                    }
                    if (extra && typeof extra === "object") {
                        for (const [key, value] of Object.entries(extra)) {
                            if (value != null) headers[key] = String(value);
                        }
                    }
                }
                const url = resolveEndpointUrl(resolvedBaseUrl, resolvedModelsPath);
                // Vet before the request, exactly as resolveModel does: this URL
                // may come from an unsaved provider draft, i.e. from the caller,
                // and the request can carry a credential.
                await validateUpstreamUrl(url);
                const res = await safeFetch(url, {
                    method: "GET",
                    headers,
                    signal: ctx?.signal,
                });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    (ctx?.log || XS.log("plugin.chat-anthropic:models"))
                        .warn({ status: res.status, url }, "model discovery rejected by upstream");
                    // Classified so the panel can say WHY. The status line is
                    // host-free, hence safe as the production-visible message;
                    // the body snippet stays in `message` (dev + log only).
                    throw new XS.UpstreamRequestError(
                        `Anthropic model discovery failed: ${res.status} ${res.statusText}`
                        + (body ? ` — ${body.slice(0, 300)}` : ""),
                        { code: "UPSTREAM_STATUS", publicMessage: `model discovery failed (HTTP ${res.status})` }
                    );
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
                            source: "provider-metadata",
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
                    // Free-text operator/BYOK field: malformed JSON degrades to "no
                    // extra headers" instead of throwing a SyntaxError out of the
                    // RPC as a 500.
                    let extra: unknown = null;
                    try {
                        extra = JSON.parse(headersJson);
                    } catch (e: any) {
                        XS.log("plugin.chat-anthropic")
                            .warn(`Ignoring malformed 'headersJson' provider config: ${e?.message || e}`);
                    }
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
