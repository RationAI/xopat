import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createHash } from "node:crypto";

/**
 * Provider-factory cache: `createOpenAICompatible` was rebuilt on every single
 * turn (and probe). Keyed by the full connection identity — any config/secret
 * change changes the key, so invalidation is implicit; a module hot-reload
 * clears the map wholesale. Secrets enter the key only as a digest.
 */
const PROVIDER_FACTORY_CACHE_MAX = 32;

/**
 * Core bounded cache (`server/STORAGE.md`). SDK factory objects are neither
 * serializable nor worth persisting, so this is the `cache` surface. On a core
 * without it, a plain Map keeps the previous behavior minus the bound.
 */
const providerFactoryCache: Map<string, (modelId: string) => any> =
    (globalThis as any).XOPAT_SERVER?.cache?.create?.({
        name: "chat-openai-compatible:factories",
        maxEntries: PROVIDER_FACTORY_CACHE_MAX,
    }) ?? new Map();

function providerFactoryFor(
    instanceId: string,
    baseURL: string,
    apiKey: string | undefined,
    headers: Record<string, string>,
    includeUsage: boolean
): (modelId: string) => any {
    // `includeUsage` belongs in the digest like every other connection-shaping input:
    // it is baked into the factory, so a cache keyed without it would keep serving the
    // old setting and make toggling the switch look like it does nothing until a restart.
    const digest = createHash("sha256")
        .update(JSON.stringify([instanceId, baseURL, apiKey || "", headers, includeUsage]))
        .digest("hex");
    let factory = providerFactoryCache.get(digest);
    if (!factory) {
        factory = createOpenAICompatible({ name: instanceId, baseURL, apiKey, headers, includeUsage }) as any;
        providerFactoryCache.set(digest, factory!);
    }
    return factory!;
}

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

/**
 * Union the transcription origin-allowlist across every casing variant the config
 * may use, returning de-duped `URL.origin` strings.
 *
 * A first-non-null `??` pick (`config.originAllowlist ?? config.allowedOrigins ??
 * …`) is WRONG: an empty `originAllowlist: []` is non-null, so it would win over a
 * populated `allowedOrigins` and silently DISABLE the allowlist (audio then egress
 * to any https origin). Union instead — an empty variant contributes nothing.
 *
 * Kept inline (not imported from the transcription module) on purpose: a
 * cross-module `importServerExport` for a newly-added export throws if that
 * module's compiled server-dist is stale, which would abort provider registration
 * and strand a transcription-less adapter. The shim's own `normalizeOriginAllowlist`
 * re-normalizes whatever it receives, so behavior matches the shared helper.
 */
const ORIGIN_ALLOWLIST_KEYS = ["originAllowlist", "allowedOrigins", "allowedOriginList", "originAllowList"] as const;
function unionOriginAllowlist(config: Record<string, unknown> | null | undefined): string[] {
    const out = new Set<string>();
    for (const key of ORIGIN_ALLOWLIST_KEYS) {
        const value = (config as any)?.[key];
        if (value == null) continue;
        const items = Array.isArray(value) ? value : String(value).split(",");
        for (const item of items) {
            const trimmed = String(item || "").trim();
            if (!trimmed) continue;
            try {
                out.add(new URL(trimmed).origin);
            } catch {
                // Skip an unparseable entry rather than aborting the whole allowlist;
                // the shim re-validates the final list and would reject a bad origin.
            }
        }
    }
    return Array.from(out);
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
        // Free-text operator/BYOK field: malformed JSON degrades to "no extra
        // headers" instead of throwing a SyntaxError out of the RPC as a 500.
        let extra: unknown = null;
        try {
            extra = JSON.parse(headersJson);
        } catch (e: any) {
            (globalThis as any).XOPAT_SERVER?.log?.("plugin.chat-openai-compatible")
                ?.warn(`Ignoring malformed 'headersJson' provider config: ${e?.message || e}`);
        }
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
        source: "provider-metadata",
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
    /** False only when the deployment declared the endpoint keyless (`providerDefaults.apiKey: false`). */
    apiKeyRequired?: boolean;
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
            // `required` is what stops model discovery from calling the upstream
            // with no credential and collecting a 401 on every boot. A self-hosted
            // keyless endpoint (ollama / vLLM) declares `providerDefaults.apiKey: false`.
            { key: "apiKey", label: "API key", input: "password", secret: true, required: input.apiKeyRequired !== false, description: "Stored server-side only. Leave blank to keep plugin default token." },
            { key: "apiKeyHeader", label: "API key header", input: "text", defaultValue: "Authorization" },
            // Transcription runs on a DIFFERENT model family than chat, so it needs its own
            // default: `defaultModelId` is a chat model and `/audio/transcriptions` rejects it.
            // Read by the broker (runTranscription) for every adapter, not just this one.
            { key: "defaultTranscriptionModelId", label: "Transcription model", input: "text", placeholder: "whisper-large-v3-turbo", description: "Model used when a transcription request names none. Falls back to whisper-1." },
            { key: "headersJson", label: "Extra headers JSON", input: "textarea" },
            // Off by default on purpose. Enabling it adds `stream_options.include_usage`
            // to every streaming request; that is standard OpenAI, but "OpenAI-compatible"
            // spans a lot of backends and a stricter one can reject the unknown field —
            // which would break chat itself, not merely the usage readout. A diagnostic
            // must not be able to take the feature down, so the operator opts in.
            {
                key: "includeUsage",
                label: "Report token usage",
                input: "checkbox",
                defaultValue: false,
                description: "Ask the endpoint to include token counts in streaming responses "
                    + "(stream_options.include_usage), so the Token usage panel can show them. "
                    + "If turns start failing after enabling this, the backend rejects the field — turn it back off.",
            },
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

    const pluginId = ctx?.itemId || "chat-openai-compatible";
    // RPC input is ignored — see deploymentAuthInput above.
    const input = deploymentAuthInput(ctx, pluginId);
    const secure = XS.getSecurePluginConfig(ctx, pluginId);
    const defaults = secure?.providerDefaults || {};

    const ensureManagedPluginProvider = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/providerRegistration.server.ts",
        "ensureManagedPluginProvider"
    );
    const createOpenAICompatibleTranscriptionModel = await XS.importServerExport(
        ctx,
        "module:vercel-ai-chat-sdk/server/openaiCompatibleTranscription.server.ts",
        "createOpenAICompatibleTranscriptionModel"
    );
    const { safeFetch, validateUpstreamUrl } = XS;

    const typeId = pick(defaults.id, input.typeId, "openai-compatible")!;
    const label = pick(defaults.label, input.label, "OpenAI-compatible")!;
    const description = pick(
        defaults.description,
        input.description,
        "OpenAI-compatible endpoint"
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
    const baseUrl = pick(defaults.baseUrl, input.baseUrl, "")!;
    const modelsPath = pick(defaults.modelsPath, input.modelsPath, "/models")!;
    const defaultModelId = pick(defaults.defaultModelId, input.defaultModelId, "")!;
    // Empty by default, NOT "whisper-1": an OpenAI-compatible endpoint may be Groq, a local
    // whisper.cpp server or vLLM, each with its own id. Empty lets the broker's own
    // whisper-1 last resort apply instead of asserting a model this endpoint may not have.
    const defaultTranscriptionModelId = pick(defaults.defaultTranscriptionModelId, "")!;
    // Deployment-controlled, and read ONLY from secure config — never from `input`, which
    // is caller-supplied (see the note above deploymentAuthInput). Default false: see the
    // configSchema entry for why this is opt-in rather than opt-out.
    const includeUsage = defaults.includeUsage === true;
    // `providerDefaults.apiKey` carries three states: a string is the operator key,
    // absent/"" means "a key is required but none is configured" (discovery stays
    // off until someone supplies one — BYOK included), and `false` is the operator
    // declaring the endpoint keyless (self-hosted ollama / vLLM), which re-enables
    // credential-free discovery. `pick` skips only undefined/null, so `false` survives.
    const rawApiKey = pick(defaults.apiKey, input.apiKey, "");
    const apiKeyRequired = rawApiKey !== false;
    const apiKey = typeof rawApiKey === "string" ? rawApiKey : "";
    // Internal-only flag: keeps the provider out of the chat/type pickers while
    // it stays resolvable by id (e.g. reused for pathology inference). A deployer
    // `hidden:true` wins via pick precedence and cannot be un-hidden by input.
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
            defaultTranscriptionModelId,
            includeUsage,
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
            id: "openai-compatible",
            async listModels({ ctx, config, secrets, type }: any) {
                const baseURL = String(config.baseUrl || config.baseURL || "").trim();
                if (!baseURL) return [];
                const modelsPath = String(config.modelsPath || "/models");
                const url = resolveEndpointUrl(baseURL, modelsPath);
                // Vet before the request, exactly as resolveModel does: this URL
                // may come from an unsaved provider draft, i.e. from the caller,
                // and the request can carry a credential.
                await validateUpstreamUrl(url);
                const headers = buildOpenAICompatibleHeaders(config, secrets);
                const res = await safeFetch(url, { method: "GET", headers, signal: ctx?.signal });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    (ctx?.log || XS.log("plugin.chat-openai-compatible:models"))
                        .warn({ status: res.status, url }, "model discovery rejected by upstream");
                    // Classified so the panel can say WHY. The status line is
                    // host-free, hence safe as the production-visible message;
                    // the body snippet stays in `message` (dev + log only).
                    throw new XS.UpstreamRequestError(
                        `Model discovery failed: ${res.status} ${res.statusText}`
                        + (body ? ` — ${body.slice(0, 300)}` : ""),
                        { code: "UPSTREAM_STATUS", publicMessage: `model discovery failed (HTTP ${res.status})` }
                    );
                }
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
                // Opt-in (see the configSchema entry): only an operator who has confirmed
                // their backend accepts `stream_options` turns this on. Anything other than
                // an explicit true stays false, so a stray string can never enable it.
                const includeUsage = config.includeUsage === true || config.includeUsage === "true";
                return providerFactoryFor(instance.id, baseURL, apiKey, headers, includeUsage)(modelId);
            },
            // OPTIONAL transcription capability: `@ai-sdk/openai-compatible`
            // ships no transcription model, so the module's reusable shim
            // implements the TranscriptionModelV4 spec over the endpoint's
            // `/audio/transcriptions` route (egress via the core SSRF guard).
            async resolveTranscriptionModel({ instance, modelId, config, secrets, transcribeTimeoutMs }: any) {
                const baseURL = String(config.baseUrl || config.baseURL || "").trim();
                if (!baseURL) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
                // Pre-vet the endpoint before returning a model — same backstop resolveModel
                // applies (see AGENTS.md §4). This rejects private/metadata IPs at resolve time,
                // ahead of the shim's connect-time safeRequest guard.
                await validateUpstreamUrl(baseURL);
                return {
                    model: createOpenAICompatibleTranscriptionModel({
                        provider: instance.id,
                        modelId,
                        baseUrl: baseURL,
                        headers: buildOpenAICompatibleHeaders(config, secrets),
                        // Union of all casing variants — never a first-non-null pick,
                        // which an empty earlier key would hijack (see helper doc).
                        originAllowlist: unionOriginAllowlist(config),
                        // Honor the core's operator-configured STT request budget so the shim's
                        // safeRequest timeout matches the linked abort signal (see runTranscription).
                        timeoutMs: transcribeTimeoutMs,
                    }),
                    providerOptionsName: instance.id,
                };
            },
        },
        providerType,
        provider: providerPayload,
    });
}
