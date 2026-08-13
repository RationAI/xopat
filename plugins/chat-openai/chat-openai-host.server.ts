import { createOpenAI } from '@ai-sdk/openai';

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

function buildExtraHeaders(config: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {};
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

/**
 * Cached `createOpenAI` factory, keyed by the full connection identity (any
 * config/secret change changes the key, so invalidation is implicit; a module
 * hot-reload clears the map wholesale). Secrets enter the key only as-is inside
 * the JSON — the map lives server-side only, mirroring chat-openai-compatible.
 */
const OPENAI_FACTORY_CACHE_MAX = 16;

/**
 * Core bounded cache (`server/STORAGE.md`). SDK factory objects are neither
 * serializable nor worth persisting, so this is the `cache` surface. On a core
 * without it, a plain Map keeps the previous behavior minus the bound.
 */
const openaiFactoryCache: Map<string, ReturnType<typeof createOpenAI>> =
    (globalThis as any).XOPAT_SERVER?.cache?.create?.({
        name: "chat-openai:factories",
        maxEntries: OPENAI_FACTORY_CACHE_MAX,
    }) ?? new Map();

function openaiFactoryFor(baseURL: string, apiKey: string | undefined, headers: Record<string, string>, fetchImpl: any): ReturnType<typeof createOpenAI> {
    const key = JSON.stringify([baseURL, apiKey || "", headers]);
    let factory = openaiFactoryCache.get(key);
    if (!factory) {
        // Route the SDK's own transport through the core SSRF guard: safeFetch
        // vets the destination (private/metadata IP rejection, no-redirect)
        // on every request the SDK makes.
        factory = createOpenAI({ baseURL, apiKey, headers, fetch: fetchImpl });
        openaiFactoryCache.set(key, factory);
    }
    return factory;
}

function buildOpenAIProviderType(input: {
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
        description: input.description || "OpenAI API endpoint",
        adapter: "openai",
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
            { key: "baseUrl", label: "Base URL", input: "url", defaultValue: "https://api.openai.com/v1", description: "OpenAI API base URL. Leave default for direct OpenAI access." },
            // `required` is what stops model discovery from calling the upstream
            // with no credential and collecting a 401 on every boot. The
            // deployment declares a keyless endpoint with `providerDefaults.apiKey: false`.
            { key: "apiKey", label: "API key", input: "password", secret: true, required: input.apiKeyRequired !== false, description: "Stored server-side only. Leave blank to keep plugin default token." },
            { key: "modelsPath", label: "Models path", input: "text", defaultValue: "/models" },
            { key: "defaultTranscriptionModelId", label: "Transcription model", input: "text", defaultValue: "whisper-1", description: "Model used when a transcription request names none." },
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

    const pluginId = ctx?.itemId || "chat-openai";
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

    const typeId = pick(defaults.id, input.typeId, "openai")!;
    const label = pick(defaults.label, input.label, "OpenAI")!;
    const description = pick(
        defaults.description,
        input.description,
        "OpenAI API endpoint"
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
    // context against `contexts`); otherwise fall back to "jwt".
    const contextId = requiresLogin
        ? pick(defaults.contextId, input.contextId, contexts[0] || "core")!
        : null;
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "https://api.openai.com/v1")!;
    const modelsPath = pick(defaults.modelsPath, input.modelsPath, "/models")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "")!;
    const defaultTranscriptionModelId = pick(defaults.defaultTranscriptionModelId, input.defaultTranscriptionModelId, "whisper-1")!;
    // `providerDefaults.apiKey` carries three states: a string is the operator key,
    // absent/"" means "a key is required but none is configured" (discovery stays
    // off until someone supplies one — BYOK included), and `false` is the operator
    // declaring the endpoint keyless (local ollama / vLLM), which re-enables
    // credential-free discovery. `pick` skips only undefined/null, so `false` survives.
    const rawApiKey = pick(defaults.apiKey, input.apiKey, "");
    const apiKeyRequired = rawApiKey !== false;
    const apiKey = typeof rawApiKey === "string" ? rawApiKey : "";
    // Internal-only flag: keeps the provider out of the chat/type pickers while
    // it stays resolvable by id (e.g. as a dedicated transcription provider). A
    // deployer `hidden:true` wins via pick precedence and cannot be un-hidden
    // by input.
    const hidden = pick(defaults.hidden, false) === true;
    // Nominates this provider for transcription when speech-to-text names none
    // (`vercel` driver in auto mode). It only wins the tie-break — the real gates
    // stay adapter capability and getProviderRuntime. Deployer-only, like `hidden`.
    const transcriptionDefault = pick(defaults.transcriptionDefault, false) === true;
    const providerMetadata: Record<string, unknown> = {
        ...(hidden ? { hidden: true } : {}),
        ...(transcriptionDefault ? { role: "transcription-default" } : {}),
        ...(contexts.length ? { contexts } : {}),
    };

    const providerType = buildOpenAIProviderType({
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
            defaultTranscriptionModelId,
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

    async function vettedFactory(instanceLabel: string, config: any, secrets: any) {
        const resolvedBaseUrl = String(config.baseUrl || config.baseURL || "https://api.openai.com/v1").trim();
        if (!resolvedBaseUrl) throw new Error(`Provider '${instanceLabel}' is missing baseUrl.`);
        // Vet the baseURL before handing it to the SDK; the SDK does its own
        // fetching afterwards (through safeFetch below), so this blocks the
        // obvious SSRF (private IP / localhost / metadata endpoint) up front.
        await validateUpstreamUrl(resolvedBaseUrl);
        const apiKeyValue = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : undefined;
        return openaiFactoryFor(resolvedBaseUrl, apiKeyValue, buildExtraHeaders(config), safeFetch);
    }

    return ensureManagedPluginProvider(ctx, {
        pluginId,
        adapter: {
            id: "openai",
            async listModels({ ctx, config, secrets, type, providerId, userScope }: any) {
                const resolvedBaseUrl = String(config.baseUrl || "https://api.openai.com/v1").trim();
                const resolvedModelsPath = String(config.modelsPath || "/models").trim() || "/models";
                const apiKeyValue = typeof secrets.apiKey === "string" && secrets.apiKey ? String(secrets.apiKey) : "";
                const headers: Record<string, string> = buildExtraHeaders(config);
                if (apiKeyValue) headers["Authorization"] = `Bearer ${apiKeyValue}`;
                const url = resolveEndpointUrl(resolvedBaseUrl, resolvedModelsPath);
                // Vet before the request, exactly as resolveModel does: this URL
                // may come from an unsaved provider draft, i.e. from the caller,
                // and the request can carry a credential.
                await validateUpstreamUrl(url);
                const res = await safeFetch(url, { method: "GET", headers, signal: ctx?.signal });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    const log = ctx?.log || XS.log("plugin.chat-openai:models");
                    // Shape/provenance at warn (an operator needs this to tell a
                    // bad key from a dead endpoint); the response body is upstream
                    // payload, so it goes through the sensitive gate.
                    log.warn({
                        status: res.status, url, providerId,
                        userScope: userScope ? String(userScope).split(":")[0] + ":…" : null,
                        hasKey: !!apiKeyValue,
                        isOperatorKey: !!apiKeyValue && apiKeyValue === apiKey,
                    }, "model discovery rejected by upstream");
                    log.sensitive({ body: body.slice(0, 2000) }, "MODEL_DISCOVERY_BODY");
                    // Classified so the panel can say WHY. The status line is
                    // host-free, hence safe as the production-visible message;
                    // the body snippet stays in `message` (dev + log only).
                    throw new XS.UpstreamRequestError(
                        `OpenAI model discovery failed: ${res.status} ${res.statusText}`
                        + (body ? ` — ${body.slice(0, 300)}` : ""),
                        { code: "UPSTREAM_STATUS", publicMessage: `model discovery failed (HTTP ${res.status})` }
                    );
                }
                const json = await res.json();
                const data = Array.isArray(json?.data) ? json.data : [];
                return data
                    .map((item: any) => ({
                        id: String(item?.id || "").trim(),
                        label: String(item?.id || "").trim(),
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
                const factory = await vettedFactory(instance.label, config, secrets);
                return factory(modelId);
            },
            // Native AI SDK transcription: `openai.transcription('whisper-1')`
            // implements the versioned transcription-model spec directly. The
            // SDK reads whisper hints ({language, prompt, ...}) from
            // providerOptions under the 'openai' namespace.
            async resolveTranscriptionModel({ instance, modelId, config, secrets }: any) {
                const factory = await vettedFactory(instance.label, config, secrets);
                const transcriptionModelId = modelId
                    || String(config.defaultTranscriptionModelId || "").trim()
                    || "whisper-1";
                return {
                    model: factory.transcription(transcriptionModelId),
                    providerOptionsName: "openai",
                };
            },
        },
        providerType,
        provider: providerPayload,
    });
}
