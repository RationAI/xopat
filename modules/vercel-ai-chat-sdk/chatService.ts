import { matchProviderRef } from './shared/providerRef';
import { stripDuplicatedPartPayloads, stripDuplicatedMessagePayloads } from './shared/attachment-parts';
import { hashScriptApiManifest, MANIFEST_MISS_CODE } from './shared/manifest-handle';
import {
    createSessionUsage,
    recordUsage,
    beginGroup,
    snapshot as snapshotUsage,
    type SessionUsage,
} from './shared/usage-stats';

export type RpcMethodCaller = (input?: any, options?: { contextId?: string; client?: any; signal?: AbortSignal }) => Promise<any>;
export type RpcStreamHandle = {
    events: AsyncGenerator<any, void, unknown>;
    result: Promise<any>;
    abort(reason?: any): void;
};
export type RpcScope = Record<string, RpcMethodCaller> & {
    /** Streaming sub-scope (methods declared `runtime.streaming: true`); an object on stream-capable runtimes. */
    $stream?: Record<string, (input?: any, options?: any) => RpcStreamHandle>;
};

export interface ChatServiceOptions {
    getAllowedScriptApi?: (() => AllowedScriptApiManifest | undefined) | undefined;
    /** Composes the live viewer-state snapshot injected into every turn's system prompt. */
    getLiveViewerContext?: (() => LiveViewerContext | undefined) | undefined;
    /** Session-expanded namespaces (full signatures rendered in a stable system block). */
    getExpandedNamespaces?: (() => string[]) | undefined;
    /** Deployment knob: namespaces to render in FULL unconditionally (static meta `fullPromptNamespaces`). */
    fullPromptNamespaces?: string[];
    /** Observes each outgoing (non-internal) user message's text, e.g. for intent-hinted namespace expansion. */
    onUserTurnText?: ((text: string) => void) | undefined;
    /** Fires after a session is hydrated via loadSession — lets the host restore session-scoped state from metadata. */
    onSessionHydrated?: ((session: ChatSession) => void) | undefined;
    /**
     * Awaited before each send. Lets the host delay the first turn until the
     * scripting-capability baseline has settled (all boot-time plugin namespaces
     * registered), so the manifest and viewer context are complete.
     */
    awaitReadyForSend?: (() => Promise<void>) | undefined;
    /**
     * The provider currently selected in the host UI, for calls that name none of
     * their own. Used only to pick the auth context — never to scope the request.
     */
    getActiveProviderId?: (() => string | null) | undefined;
    serverFactory?: (() => RpcScope) | undefined;
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string | null;
    providers?: ChatProviderClientRegistration[];
    rpcTimeoutMs?: number;
    sessionOwnerKey?: string | null;
    legacySessionSource?: string | null;
    /** Operator/deployment streaming switch (feed from static meta, never from session config). Default true. */
    streamingEnabled?: boolean;
}

function ensureDate(value?: Date | string): Date {
    return value instanceof Date ? value : value ? new Date(value) : new Date();
}

let enabled: boolean | undefined = undefined;
function isChatDebugModeEnabled(): boolean {
    if (enabled === undefined) {
        enabled = APPLICATION_CONTEXT.getOption("debugMode");
    }
    return !!enabled;
}

function truncateChatDebugText(value: string, maxChars = 4_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function serializeChatDebugValue(value: any, depth = 0): any {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return truncateChatDebugText(value);
    if (depth >= 6) return '[Max debug depth reached]';

    if (Array.isArray(value)) {
        return value.slice(0, 25).map((item) => serializeChatDebugValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, 25)) {
            output[key] = serializeChatDebugValue(item, depth + 1);
        }
        return output;
    }

    return String(value);
}

function summarizeChatDebugMessage(message: any): any {
    return serializeChatDebugValue({
        id: message?.id || null,
        role: message?.role || null,
        content: typeof message?.content === 'string' ? message.content : undefined,
        parts: Array.isArray(message?.parts) ? message.parts : [],
        metadata: message?.metadata,
        createdAt: message?.createdAt,
    });
}

/**
 * Serialized size of each top-level payload field, largest first, plus the total.
 *
 * The turn body is assembled from a handful of independently-growing pieces, and
 * when it crosses the server's `maxBodyBytes` the failure names none of them.
 * One line of measurement here is the difference between "the chat broke" and
 * "the manifest is 900 KB".
 */
function measurePayloadBytes(payload: Record<string, unknown>): Record<string, number> {
    const sizes: Array<[string, number]> = [];
    let total = 0;
    for (const key of Object.keys(payload)) {
        const value = payload[key];
        if (value === undefined) continue;
        let bytes = 0;
        try {
            bytes = JSON.stringify(value)?.length || 0;
        } catch (_) { /* circular or unserializable — reported as 0, never fatal */ }
        total += bytes;
        sizes.push([key, bytes]);
    }
    sizes.sort((a, b) => b[1] - a[1]);
    const out: Record<string, number> = { total };
    for (const [key, bytes] of sizes) out[key] = bytes;
    return out;
}

function chatDebugLog(label: string, data?: unknown, level="debug"): void {
    if (!isChatDebugModeEnabled()) return;

    if (typeof data === 'undefined') {
        // @ts-ignore
        console[level](`[CHAT DEBUG] ${label}`);
        return;
    }
    // @ts-ignore
    console[level](`[CHAT DEBUG] ${label}`, serializeChatDebugValue(data));
}

export class ChatService {
    _providers: Map<string, ChatProviderClientRegistration>;
    _providerTypes: Map<string, ChatProviderTypeRecord>;
    _personalities: Map<string, ChatPersonality>;
    _currentPersonalityId: string | null;
    _getAllowedScriptApi: (() => AllowedScriptApiManifest | undefined) | undefined;
    _getLiveViewerContext: (() => LiveViewerContext | undefined) | undefined;
    _getExpandedNamespaces: (() => string[]) | undefined;
    _fullPromptNamespaces: string[] | undefined;
    _onUserTurnText: ((text: string) => void) | undefined;
    _onSessionHydrated: ((session: ChatSession) => void) | undefined;
    _awaitReadyForSend: (() => Promise<void>) | undefined;
    _getActiveProviderId: (() => string | null) | undefined;
    _serverFactory: (() => RpcScope) | undefined;
    _activeSessionId: string | null;
    _sessionState: Map<string, {
        syncedCount: number;
        providerId: string;
        providerContextId?: string | null;
        viewerContextId?: string | null;
        /** Manifest hash the server acknowledged for this session; while set, only the hash is sent. */
        manifestHash?: string | null;
    }>;
    /**
     * Token accounting per session, summed as turns complete.
     *
     * Kept apart from `_sessionState` (which is sync/manifest bookkeeping) because it has
     * a different lifecycle and no bearing on protocol correctness — losing it costs a
     * readout, never a turn. In-memory and per-tab by design: this is "what has this tab
     * spent", not a billing record.
     */
    _sessionUsage: Map<string, SessionUsage>;
    _modelCatalog: Map<string, ChatProviderModelInfo[]>;
    _activeTurnAbortController: AbortController | null;
    _rpcTimeoutMs: number;
    _rpcHttpClient: any | null;
    _authedRpcHttpClients: Map<string, any>;
    _sessionOwnerKey: string | null;
    _legacySessionSource: string | null;
    _pendingCapabilityNotices: string[];
    /** Deployment/operator streaming switch (static meta — NOT session config). */
    _streamingEnabled: boolean;
    /** Set after an old-server/old-bundle probe failed once — stop re-probing every step. */
    _streamingBrokenForSession: boolean;

    constructor(opts: ChatServiceOptions = {}) {
        this._providers = new Map();
        this._providerTypes = new Map();
        this._personalities = new Map();
        this._currentPersonalityId = opts.defaultPersonalityId || null;
        this._getAllowedScriptApi = typeof opts.getAllowedScriptApi === 'function' ? opts.getAllowedScriptApi : undefined;
        this._getLiveViewerContext = typeof opts.getLiveViewerContext === 'function' ? opts.getLiveViewerContext : undefined;
        this._getExpandedNamespaces = typeof opts.getExpandedNamespaces === 'function' ? opts.getExpandedNamespaces : undefined;
        this._fullPromptNamespaces = Array.isArray(opts.fullPromptNamespaces) && opts.fullPromptNamespaces.length
            ? opts.fullPromptNamespaces.filter((n) => typeof n === 'string' && n)
            : undefined;
        this._onUserTurnText = typeof opts.onUserTurnText === 'function' ? opts.onUserTurnText : undefined;
        this._onSessionHydrated = typeof opts.onSessionHydrated === 'function' ? opts.onSessionHydrated : undefined;
        this._awaitReadyForSend = typeof opts.awaitReadyForSend === 'function' ? opts.awaitReadyForSend : undefined;
        this._getActiveProviderId = typeof opts.getActiveProviderId === 'function' ? opts.getActiveProviderId : undefined;
        this._serverFactory = opts.serverFactory;
        this._activeSessionId = null;
        this._sessionState = new Map();
        this._sessionUsage = new Map();
        this._modelCatalog = new Map();
        this._activeTurnAbortController = null;
        this._rpcTimeoutMs = Math.max(30_000, Number(opts.rpcTimeoutMs) || 600_000);
        this._rpcHttpClient = null;
        this._sessionOwnerKey = typeof opts.sessionOwnerKey === 'string' && opts.sessionOwnerKey.trim()
            ? opts.sessionOwnerKey.trim()
            : null;
        this._legacySessionSource = typeof opts.legacySessionSource === 'string' && opts.legacySessionSource.trim()
            ? opts.legacySessionSource.trim()
            : null;
        this._pendingCapabilityNotices = [];
        this._authedRpcHttpClients = new Map();
        this._streamingEnabled = opts.streamingEnabled !== false;
        this._streamingBrokenForSession = false;

        (opts.providers || []).forEach((provider) => this._providers.set(provider.id, { ...provider }));
        (opts.personalities || []).forEach((personality) => this.registerPersonality(personality));

        if (!this._currentPersonalityId && this._personalities.size) {
            this._currentPersonalityId = Array.from(this._personalities.keys())[0] || null;
        }
    }

    setServerFactory(factory?: (() => RpcScope) | undefined): void {
        this._serverFactory = factory;
    }

    _server(): RpcScope {
        const scope = this._serverFactory?.() || (window as any)?.xserver?.module?.["vercel-ai-chat-sdk"];
        if (!scope) throw new Error('ChatService: server RPC scope for module "chat" is not available.');
        return scope;
    }

    _getDebugModeFlag(): boolean {
        return isChatDebugModeEnabled();
    }

    _getRpcHttpClient(): any {
        if (this._rpcHttpClient) return this._rpcHttpClient;

        const app = (window as any)?.APPLICATION_CONTEXT;
        const current = app?.httpClient;
        const HttpClientCtor = (window as any)?.HttpClient;
        if (!HttpClientCtor || !current) return current || null;

        try {
            this._rpcHttpClient = new HttpClientCtor({
                baseURL: current.baseURL || app?.url,
                timeoutMs: this._rpcTimeoutMs,
                maxRetries: current.maxRetries || 3,
                // The "unscoped" client is not the "unauthenticated" client. Most chat
                // RPCs are `public: false, requireSession: true`, and a call that sends
                // no contextId is verified by the server against the viewer's MAIN
                // context — so this must carry that context's secret, and must wait for
                // it. Without the block below there is no `awaitContext`, so a call made
                // before `core` settles is sent bare and comes back
                // 401 RPC_AUTH_FAILED (which is what a boot-time listSessions did).
                //
                // No explicit contextId: undefined is normalised to the main context by
                // both the secret lookup and whenContextSettled. `required` turns on
                // awaitContext — bounded (8s), memoized, never interactive, and instant
                // for a deployment that declares no such context.
                auth: { required: true, refreshOn401: true },
            });
        } catch (_error) {
            this._rpcHttpClient = current;
        }

        return this._rpcHttpClient;
    }

    /**
     * A per-context RPC HttpClient that attaches the context's secret(s) so the
     * server's `rpcVerifiers.<contextId>` gate can validate the call. Cached per
     * contextId. Returns null if HttpClient is unavailable (falls back to the
     * unauthenticated client).
     *
     * The secret TYPES come from the context, not from here — the auth module that
     * owns the context declares them (see XOpatAuth.getSecretTypes), so this works
     * unchanged for OIDC, SAML, or any future mechanism.
     */
    _getAuthedRpcHttpClient(contextId: string): any {
        if (this._authedRpcHttpClients.has(contextId)) return this._authedRpcHttpClients.get(contextId);

        const app = (window as any)?.APPLICATION_CONTEXT;
        const current = app?.httpClient;
        const HttpClientCtor = (window as any)?.HttpClient;
        let client: any = null;
        if (HttpClientCtor && current) {
            try {
                client = new HttpClientCtor({
                    baseURL: current.baseURL || app?.url,
                    timeoutMs: this._rpcTimeoutMs,
                    maxRetries: current.maxRetries || 3,
                    // `types` omitted on purpose — HttpClient resolves it per request
                    // from XOpatAuth.getSecretTypes (see the memoization note below).
                    auth: {
                        contextId,
                        required: true,
                        refreshOn401: true,
                    },
                });
            } catch (_error) {
                client = null;
            }
        }
        // Only memoize a successfully-built client. If HttpClient was momentarily
        // unavailable (client === null, e.g. an early call before boot finishes),
        // do NOT cache the failure — otherwise `has(contextId)` stays true for a
        // null value and every later call is stranded on the unauthenticated
        // client, 401-looping against rpcVerifiers.<contextId> with no recovery.
        //
        // Same reasoning applies to the secret types: caching a client built
        // before the context was configured would freeze the ["jwt"] default, so
        // only memoize once an auth module actually owns the context.
        if (client && app?.auth?.hasContext?.(contextId)) {
            this._authedRpcHttpClients.set(contextId, client);
        }
        return client;
    }

    /**
     * Build RPC call options for a provider-scoped call. When the provider
     * requires login, attaches the auth context (verifier selection) + a
     * JWT-bearing HttpClient; otherwise the main-context client.
     *
     * A caller that names NO provider still gets the active one's context. Such a
     * call is unscoped in what it asks for (e.g. `listSessions()` across providers),
     * not in who is asking — deriving the credential from "no provider" left it on
     * the unscoped client and the server rejected it.
     */
    _authCallOptions(providerId?: string | null): { httpClient: any; contextId?: string } {
        const id = providerId || this._getActiveProviderId?.() || null;
        const provider = id ? this.getProvider(id) : undefined;
        const ctx = provider && provider.requiresLogin !== false ? this._providerContextId(provider) : null;
        if (ctx) {
            const client = this._getAuthedRpcHttpClient(ctx);
            if (client) return { httpClient: client, contextId: ctx };
        }
        return { httpClient: this._getRpcHttpClient() };
    }

    /** Like {@link _authCallOptions} but resolves the provider from a session. */
    _authCallOptionsForSession(sessionId?: string | null): { httpClient: any; contextId?: string } {
        const providerId = sessionId ? this._sessionState.get(sessionId)?.providerId : undefined;
        return this._authCallOptions(providerId);
    }

    _clearActiveTurnAbortController(controller?: AbortController | null): void {
        if (!controller || this._activeTurnAbortController !== controller) return;
        this._activeTurnAbortController = null;
    }

    cancelActiveTurn(reason = 'Chat request aborted by user.'): void {
        if (!this._activeTurnAbortController) return;
        this._activeTurnAbortController.abort(reason);
        this._activeTurnAbortController = null;
    }

    /**
     * Whether `error` is an abort rather than a real failure.
     *
     * Shape only — never the message text. An upstream that reports "the operation was
     * aborted" is a genuine failure the user must see, and matching /abort/ on the
     * message silently downgraded those to "stopped", hiding them entirely. Note this
     * cannot be complete: `AbortController.abort(reason)` rejects with `reason` verbatim,
     * so an abort carrying a custom Error is indistinguishable by shape — callers that
     * own the signal must check `signal.aborted` for the authoritative answer.
     */
    isAbortError(error: unknown): boolean {
        if (!error) return false;
        const anyError = error as any;
        return anyError?.name === 'AbortError'
            || anyError?.name === 'TimeoutError'
            || anyError?.code === 'ABORT_ERR';
    }

    _createActiveTurnAbortController(externalSignal?: AbortSignal): AbortController {
        this.cancelActiveTurn('Superseded by a newer chat turn.');
        const controller = new AbortController();

        if (externalSignal) {
            if (externalSignal.aborted) {
                controller.abort((externalSignal as any).reason || 'Aborted.');
            } else {
                const relayAbort = () => controller.abort((externalSignal as any).reason || 'Aborted.');
                externalSignal.addEventListener('abort', relayAbort, { once: true });
                controller.signal.addEventListener('abort', () => {
                    externalSignal.removeEventListener('abort', relayAbort);
                }, { once: true });
            }
        }

        this._activeTurnAbortController = controller;
        return controller;
    }

    async registerProviderType(input: CreateProviderTypeInput | UpdateProviderTypeInput): Promise<ChatProviderTypeRecord> {
        const record = await this._server().registerProviderType!(input);
        this._providerTypes.set(record.id, record);
        return record;
    }

    _providerTypesRefreshInFlight: Promise<ChatProviderTypeRecord[]> | null = null;
    _providerTypesRefreshQueued: Promise<ChatProviderTypeRecord[]> | null = null;

    /**
     * Concurrent init callers (bootstrap + every provider plugin) share one RPC.
     * A caller arriving while a refresh is in flight may have JUST registered a
     * type that snapshot predates — such callers share exactly ONE queued
     * follow-up refresh instead (max 2 RPCs per burst, always-fresh result).
     */
    async refreshProviderTypesFromServer(): Promise<ChatProviderTypeRecord[]> {
        const inFlight = this._providerTypesRefreshInFlight;
        if (inFlight) {
            if (!this._providerTypesRefreshQueued) {
                this._providerTypesRefreshQueued = inFlight.catch(() => {}).then(() => {
                    this._providerTypesRefreshQueued = null;
                    return this.refreshProviderTypesFromServer();
                });
            }
            return await this._providerTypesRefreshQueued;
        }
        this._providerTypesRefreshInFlight = (async () => {
            const result = await this._server().listProviderTypes!();
            const types = result?.providerTypes || [];
            for (const type of types) this._providerTypes.set(type.id, type);
            return this.getProviderTypes();
        })().finally(() => { this._providerTypesRefreshInFlight = null; });
        return await this._providerTypesRefreshInFlight;
    }

    getProviderTypes(): ChatProviderTypeRecord[] {
        return Array.from(this._providerTypes.values());
    }

    getProviderType(typeId: string): ChatProviderTypeRecord | undefined {
        return this._providerTypes.get(typeId);
    }

    async createProvider(input: CreateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this._server().createProvider!(input);
        this._providers.set(provider.id, provider);
        return provider;
    }

    async updateProvider(input: UpdateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this._server().updateProvider!(input);
        this._providers.set(provider.id, provider);
        // Config/secret change can change the model catalogue — drop the reuse window.
        this._listModelsFreshAt.delete(provider.id);
        this._listModelsNeedsKey.delete(provider.id);
        return provider;
    }

    _providersRefreshInFlight: Map<string, Promise<ChatProviderClientRegistration[]>> = new Map();
    _providersRefreshQueued: Map<string, Promise<ChatProviderClientRegistration[]>> = new Map();

    /** Same coalescing + single queued follow-up semantics as refreshProviderTypesFromServer. */
    async refreshProvidersFromServer(typeId?: string): Promise<ChatProviderClientRegistration[]> {
        const key = typeId || '';
        const inFlight = this._providersRefreshInFlight.get(key);
        if (inFlight) {
            let queued = this._providersRefreshQueued.get(key);
            if (!queued) {
                queued = inFlight.catch(() => {}).then(() => {
                    this._providersRefreshQueued.delete(key);
                    return this.refreshProvidersFromServer(typeId);
                });
                this._providersRefreshQueued.set(key, queued);
            }
            return await queued;
        }
        const pending = (async () => {
            const result = await this._server().listProviders!({ typeId: typeId || null });
            const providers = result?.providers || [];
            for (const provider of providers) this._providers.set(provider.id, provider);
            return this.getProviders();
        })().finally(() => this._providersRefreshInFlight.delete(key));
        this._providersRefreshInFlight.set(key, pending);
        return await pending;
    }

    getProviders(): ChatProviderClientRegistration[] {
        return Array.from(this._providers.values());
    }

    /**
     * Exact instance-id lookup. Deliberately NOT reference-tolerant: callers use this as an
     * existence/staleness predicate (`ChatPanel.refreshProviders` drops `_providerId` when it
     * returns undefined) and to derive the auth context an RPC travels under. A reference-shaped
     * value surviving those checks would keep a stale selection alive and could silently change
     * which auth context a call is made in. Use {@link getProviderByRef} where a reference is
     * expected.
     */
    getProvider(providerId: string): ChatProviderClientRegistration | undefined {
        return this._providers.get(providerId);
    }

    /** Reference-tolerant lookup over the locally known providers (see `shared/providerRef.ts`). */
    getProviderByRef(ref: string): ChatProviderClientRegistration | undefined {
        const exact = this._providers.get(ref);
        if (exact) return exact;
        const match = matchProviderRef(this.getProviders(), ref);
        return match ? this._providers.get(match.id) : undefined;
    }

    /**
     * Ask the server to resolve a provider reference. Reaches providers the client cannot list —
     * a hidden provider is stripped from `listProviders` but stays referenceable by design.
     */
    async resolveProviderRef(ref: string): Promise<{ providerId: string | null; typeId?: string | null; tier?: string; hidden?: boolean }> {
        return await this._server().resolveProviderRef!({ ref });
    }

    async deleteProvider(providerId: string): Promise<void> {
        await this._server().deleteProvider!({ providerId });
        this._providers.delete(providerId);
    }

    /**
     * BYOK per-user secret RPCs. All three intentionally use
     * {@link _authCallOptions} for the target provider — the server derives the
     * storage scope from the call's identity (JWT user vs anonymous server
     * session), so these must travel the same auth path as listModels/sendTurn
     * or the scope would diverge from the one used at inference time.
     * Secret values are write-only: responses carry status flags only, and no
     * secret is ever kept in client state or any browser storage.
     */
    async getProviderUserSecretsStatus(providerId: string): Promise<ProviderUserSecretsStatus> {
        return this._server().getProviderUserSecretsStatus!({ providerId }, this._authCallOptions(providerId));
    }

    async setProviderUserSecrets(providerId: string, secrets: Record<string, string | null>): Promise<ProviderUserSecretsStatus> {
        const status = await this._server().setProviderUserSecrets!({ providerId, secrets }, this._authCallOptions(providerId));
        this._listModelsFreshAt.delete(providerId);
        this._listModelsNeedsKey.delete(providerId);
        return status;
    }

    async clearProviderUserSecrets(providerId: string): Promise<ProviderUserSecretsStatus> {
        const status = await this._server().clearProviderUserSecrets!({ providerId }, this._authCallOptions(providerId));
        this._listModelsFreshAt.delete(providerId);
        this._listModelsNeedsKey.delete(providerId);
        return status;
    }

    /** In-flight coalescing + short reuse window for per-provider listModels (init fans many identical calls). */
    _listModelsInFlight: Map<string, Promise<ChatProviderModelInfo[]>> = new Map();
    _listModelsFreshAt: Map<string, number> = new Map();
    /**
     * Why the last catalogue came back empty: the server refused to call upstream
     * because no key (operator or BYOK) is configured. Kept beside the models
     * rather than folded into them so callers can tell "provider needs a key" from
     * "provider genuinely offers nothing". Invalidated wherever `_listModelsFreshAt` is.
     */
    _listModelsNeedsKey: Map<string, boolean> = new Map();
    static LIST_MODELS_REUSE_MS = 300_000; // models rarely change within a session; explicit invalidation covers key/provider edits

    async listModels(providerId: string, draft?: { providerTypeId?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown>; contextId?: string | null }): Promise<ChatProviderModelInfo[]> {
        if (!providerId) {
            // Draft/preview calls are settings-UI interactions — never coalesced.
            const draftResult = await this._server().listModels!({
                providerTypeId: draft?.providerTypeId || null,
                draftConfig: draft?.config || {},
                draftSecrets: draft?.secrets || {},
                contextId: draft?.contextId || null,
            });
            // Draft results are never cached (settings-UI interaction), so the
            // needs-key verdict is recorded under the empty provider id and read
            // back by the editor right after the call.
            this._listModelsNeedsKey.set('', draftResult?.needsKey === true);
            return draftResult?.models || [];
        }

        // Gate on the freshness timestamp, NOT cached.length: a provider that
        // legitimately returns zero models still records freshAt, so an empty
        // catalogue is a valid cached result within the reuse window rather than a
        // reason to re-hit a slow/empty upstream on every call.
        const freshAt = this._listModelsFreshAt.get(providerId) || 0;
        const cached = this.getCachedModels(providerId);
        if (freshAt && (Date.now() - freshAt) < ChatService.LIST_MODELS_REUSE_MS) {
            return cached;
        }

        let pending = this._listModelsInFlight.get(providerId);
        if (!pending) {
            pending = (async () => {
                const result = await this._server().listModels!({ providerId }, this._authCallOptions(providerId));
                const models = result?.models || [];
                this._updateModelCache(providerId, models);
                this._listModelsFreshAt.set(providerId, Date.now());
                this._listModelsNeedsKey.set(providerId, result?.needsKey === true);
                return models;
            })().finally(() => this._listModelsInFlight.delete(providerId));
            this._listModelsInFlight.set(providerId, pending);
        }
        return await pending;
    }

    /** Settings-UI refresh: bypass the reuse window (in-flight calls still shared). */
    async forceRefreshModels(providerId: string): Promise<ChatProviderModelInfo[]> {
        this._listModelsFreshAt.delete(providerId);
        this._listModelsNeedsKey.delete(providerId);
        return this.listModels(providerId);
    }

    /**
     * Did the last catalogue for this provider come back empty because no API key
     * is configured anywhere? `false` also means "unknown" — callers use it to
     * pick a better empty-state message, never as an authorization signal.
     */
    getModelsNeedKey(providerId: string): boolean {
        return this._listModelsNeedsKey.get(providerId) === true;
    }

    /** Empty catalogue on a path that needed a model — name the cause the server reported. */
    _noModelsError(providerId: string): Error {
        return new Error(this.getModelsNeedKey(providerId)
            ? `Provider '${providerId}' has no API key configured.`
            : `Provider '${providerId}' did not return any models.`);
    }

    registerPersonality(personality: ChatPersonality): void {
        if (!personality?.id) throw new Error('ChatService.registerPersonality: missing personality id');
        this._personalities.set(personality.id, { ...personality });
        if (!this._currentPersonalityId) this._currentPersonalityId = personality.id;
    }

    getPersonalities(): ChatPersonality[] {
        return Array.from(this._personalities.values());
    }

    getPersonality(personalityId: string): ChatPersonality | undefined {
        return this._personalities.get(personalityId);
    }

    getCurrentPersonalityId(): string | null {
        return this._currentPersonalityId;
    }

    getCurrentPersonality(): ChatPersonality | undefined {
        return this._currentPersonalityId ? this._personalities.get(this._currentPersonalityId) : undefined;
    }

    setPersonality(personalityId: string | null): void {
        if (!personalityId) {
            this._currentPersonalityId = null;
            return;
        }
        if (!this._personalities.has(personalityId)) {
            throw new Error(`ChatService.setPersonality: unknown personality '${personalityId}'`);
        }
        this._currentPersonalityId = personalityId;
    }

    setAllowedScriptApiProvider(getter?: (() => AllowedScriptApiManifest | undefined) | undefined): void {
        this._getAllowedScriptApi = getter;
    }

    getAllowedScriptApi(): AllowedScriptApiManifest | undefined {
        return this._getAllowedScriptApi?.();
    }

    /** Core auth broker (APPLICATION_CONTEXT.auth) — undefined before boot. */
    _auth(): any {
        return (window as any)?.APPLICATION_CONTEXT?.auth || null;
    }

    /** The auth context a provider authenticates under (server-declared). */
    _providerContextId(provider: ChatProviderClientRegistration | undefined): string | null {
        const ctx = (provider as any)?.contextId;
        return typeof ctx === 'string' && ctx ? ctx : null;
    }

    /**
     * The single source of truth for "can this provider be logged into, and is
     * it logged in?". Consumers must branch on this instead of re-deriving
     * `requiresLogin !== false`, so an unconfigured context degrades CLOSED
     * (chat stays blocked, but no Login button that can only ever throw).
     *
     * `configured` is false when the provider demands login yet no auth module
     * claims its context — a deployment error, not a user-fixable state.
     */
    getLoginState(providerId: string): {
        requiresLogin: boolean;
        contextId: string | null;
        configured: boolean;
        authenticated: boolean;
    } {
        const provider = this.getProvider(providerId);
        const requiresLogin = !!provider && provider.requiresLogin !== false;
        const contextId = this._providerContextId(provider);
        if (!provider || !requiresLogin) {
            // No provider ⇒ nothing to log into; no login required ⇒ always "authenticated".
            return { requiresLogin, contextId, configured: true, authenticated: !!provider };
        }
        const auth = this._auth();
        const configured = !!contextId && !!auth && auth.hasContext?.(contextId) === true;
        return {
            requiresLogin,
            contextId,
            configured,
            authenticated: configured && auth.isAuthenticated(contextId) === true,
        };
    }

    isAuthenticated(providerId: string): boolean {
        return this.getLoginState(providerId).authenticated;
    }

    async login(providerId: string): Promise<void> {
        const provider = this.getProvider(providerId);
        if (!provider) throw new Error(`Unknown provider '${providerId}'.`);
        const state = this.getLoginState(providerId);
        if (!state.requiresLogin) return;

        if (!state.contextId) throw new Error(`Provider '${providerId}' requires login but declares no auth context.`);
        if (!this._auth()) throw new Error('Auth broker (APPLICATION_CONTEXT.auth) is unavailable.');
        if (!state.configured) {
            // Features never configure contexts themselves (src/AUTH.md): they
            // declare the requirement and an auth MODULE owns the mechanism.
            throw new Error(`Auth context '${state.contextId}' is not configured — no auth module claims it. Load one that declares this context (e.g. modules.oidc-client-ts / oidc-server-ts / saml-auth with permaLoad), or set the provider plugin's authMode to "none".`);
        }
        await this._auth().login(state.contextId);
    }

    /** Subscribe to auth-state changes for any provider context. Returns unsubscribe. */
    onProviderAuthChange(cb: () => void): () => void {
        const auth = this._auth();
        if (!auth || typeof auth.onChange !== 'function') return () => {};
        return auth.onChange(() => cb());
    }

    getActiveSessionId(): string | null {
        return this._activeSessionId;
    }

    setActiveSessionId(sessionId: string | null): void {
        this._activeSessionId = sessionId;
    }

    /** In-flight coalescing + short reuse window for listSessions (the post-turn refresh re-listed every turn). */
    _sessionsCache: Map<string, ChatSession[]> = new Map();
    _sessionsFreshAt: Map<string, number> = new Map();
    _sessionsInFlight: Map<string, Promise<ChatSession[]>> = new Map();
    static LIST_SESSIONS_REUSE_MS = 10_000;

    async listSessions(providerId?: string, opts?: { fresh?: boolean }): Promise<ChatSession[]> {
        const key = providerId || '*';

        if (!opts?.fresh) {
            const freshAt = this._sessionsFreshAt.get(key) || 0;
            if (freshAt && (Date.now() - freshAt) < ChatService.LIST_SESSIONS_REUSE_MS && this._sessionsCache.has(key)) {
                return this._sessionsCache.get(key)!;
            }
        }

        let pending = this._sessionsInFlight.get(key);
        if (!pending) {
            pending = (async () => {
                const result = await this._server().listSessions!({ providerId: providerId || null }, this._authCallOptions(providerId));
                const sessions = (result?.sessions || []).filter((session: ChatSession) => this._ownsSession(session));
                this._sessionsCache.set(key, sessions);
                this._sessionsFreshAt.set(key, Date.now());
                return sessions;
            })().finally(() => this._sessionsInFlight.delete(key));
            this._sessionsInFlight.set(key, pending);
        }
        return await pending;
    }

    /** Drop the listSessions reuse window so the next call re-hits the server (after a create/rename/delete). */
    _invalidateSessionsCache(): void {
        this._sessionsFreshAt.clear();
    }

    /**
     * Fold a session returned by a mutating call (a completed turn, a create) INTO the
     * listSessions cache so the next `listSessions` serves the fresh title + recency
     * without a round-trip. Replaces the entry by id (or inserts) and moves it to the
     * front, then re-stamps the key fresh. Only touches keys that already hold a list, so
     * it never fabricates a cache for a provider that was never listed.
     */
    _upsertSessionInCache(session: ChatSession | null | undefined): void {
        if (!this._ownsSession(session)) return;
        const s = session as ChatSession;
        const keys = ['*', s.providerId].filter((k) => this._sessionsCache.has(k));
        for (const key of keys) {
            const list = this._sessionsCache.get(key)!;
            const next = [s, ...list.filter((existing) => existing.id !== s.id)];
            this._sessionsCache.set(key, next);
            this._sessionsFreshAt.set(key, Date.now());
        }
    }

    /** Per-session `getSession` hydration cache: reuse a fresh transcript instead of re-hydrating on every re-entry. */
    _sessionHydrationCache: Map<string, { hydration: any; at: number }> = new Map();
    _sessionHydrationInFlight: Map<string, Promise<any>> = new Map();
    static LOAD_SESSION_REUSE_MS = 15_000;

    /** Drop a session's cached hydration so the next load re-hits the server (its transcript changed). */
    _invalidateSessionHydration(sessionId?: string | null): void {
        if (sessionId) this._sessionHydrationCache.delete(sessionId);
        else this._sessionHydrationCache.clear();
    }

    _ownsSession(session: ChatSession | null | undefined): boolean {
        if (!session) return false;

        const metadata: Record<string, unknown> = session.metadata || {};
        const ownerKey = this._normalizeContextId(metadata.sessionOwnerKey);
        const source = this._normalizeContextId(metadata.source);

        if (ownerKey) {
            return ownerKey === this._sessionOwnerKey;
        }

        if (this._legacySessionSource && source) {
            return source === this._legacySessionSource;
        }

        if (this._sessionOwnerKey === 'vercel-ai-chat-sdk') {
            return source !== 'chat-based-tester';
        }

        return true;
    }

    async renameSession(sessionId: string, title: string): Promise<ChatSession> {
        const session = await this._server().renameSession!({ sessionId, title }, this._authCallOptionsForSession(sessionId));
        this._invalidateSessionsCache();
        this._invalidateSessionHydration(sessionId);
        return session;
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this._server().deleteSession!({ sessionId }, this._authCallOptionsForSession(sessionId));
        this._sessionState.delete(sessionId);
        this._sessionUsage.delete(sessionId);
        if (this._activeSessionId === sessionId) this._activeSessionId = null;
        this._invalidateSessionsCache();
        this._invalidateSessionHydration(sessionId);
    }

    async uploadAttachment(options: {
        sessionId?: string | null;
        file?: File | Blob;
        name?: string;
        kind?: 'image' | 'file' | 'screenshot';
        mimeType?: string;
        dataBase64?: string;
        metadata?: Record<string, unknown>;
    }): Promise<ChatAttachmentRecord> {
        const sessionId = options.sessionId || this._activeSessionId;
        if (!sessionId) throw new Error('uploadAttachment requires an active session.');

        const hasFile = !!options.file;
        const hasInlineData = typeof options.dataBase64 === 'string' && options.dataBase64.trim().length > 0;

        if (!hasFile && !hasInlineData) {
            throw new Error('uploadAttachment requires either file or dataBase64.');
        }

        if (hasFile && hasInlineData) {
            throw new Error('uploadAttachment accepts either file or dataBase64, not both.');
        }

        if (options.file) {
            const file = options.file;
            const dataUrl = await this._blobToDataUrl(file);
            const mimeType = options.mimeType || (file as File).type || 'application/octet-stream';

            return this._server().uploadAttachment!({
                sessionId,
                kind: options.kind || (mimeType.startsWith('image/') ? 'image' : 'file'),
                name: options.name || (file as File).name || 'attachment',
                mimeType,
                dataBase64: dataUrl,
                metadata: options.metadata,
            }, this._authCallOptionsForSession(sessionId));
        }

        const mimeType = options.mimeType || 'application/octet-stream';

        return this._server().uploadAttachment!({
            sessionId,
            kind: options.kind || (mimeType.startsWith('image/') ? 'image' : 'file'),
            name: options.name || 'attachment',
            mimeType,
            dataBase64: String(options.dataBase64),
            metadata: options.metadata,
        }, this._authCallOptionsForSession(sessionId));
    }

    async attachUploadedFileAsMessage(options: {
        sessionId?: string | null;
        attachment: ChatAttachmentRecord;
        role?: 'user' | 'assistant';
    }): Promise<void> {
        const sessionId = options.sessionId || this._activeSessionId;
        if (!sessionId) throw new Error('attachUploadedFileAsMessage requires an active session.');

        const part: ChatMessagePart = options.attachment.kind === 'image' || options.attachment.kind === 'screenshot'
            ? {
                type: 'image',
                attachmentId: options.attachment.id,
                mimeType: options.attachment.mimeType,
                name: options.attachment.name,
                dataUrl: options.attachment.dataUrl,
                metadata: options.attachment.metadata,
            }
            : {
                type: 'file',
                attachmentId: options.attachment.id,
                mimeType: options.attachment.mimeType,
                name: options.attachment.name || options.attachment.id,
                dataUrl: options.attachment.dataUrl,
                metadata: options.attachment.metadata,
            };

        await this.appendMessages(sessionId, [{
            role: options.role || 'user',
            parts: [part],
            createdAt: new Date(),
        }]);
    }

    async sendTurn(options?: {
        sessionId?: string | null;
        providerId?: string | null;
        allowedScriptApi?: AllowedScriptApiManifest;
        personalityId?: string | null;
        personalityPrompt?: string | null;
        executionMode?: 'host' | 'viewer-script' | 'plain';
        signal?: AbortSignal;
        /** Not-yet-synced messages folded into this turn request; every entry must carry an id. */
        messagesDelta?: ChatMessage[];
        /**
         * One-shot script-surface override for THIS turn. `'fence'` suppresses the native script
         * tool so the model must answer with a plain fenced block — a host escalation after a
         * corrupted or repeated script, never a cached capability verdict.
         */
        scriptTransport?: 'auto' | 'fence';
        /**
         * Observed damage to the model's own output (a census phrase such as ``every `]` is
         * missing``), reported once when the client latches. The server persists it on the session
         * so the advice survives a reload. Prompt-shaping only.
         */
        transportDamage?: string;
        /** Streamed-reply observer: called with the accumulated raw text after each delta. */
        onDelta?: (accumulated: string, delta: string) => void;
        /**
         * Contentless liveness observer (`state: 'thinking'`): a reasoning model can
         * generate for minutes before its first token, and dropping these left the
         * panel with nothing to show for the whole window.
         */
        onStatus?: (state: string) => void;
    }): Promise<ChatMessage> {
        let sessionId = options?.sessionId || this._activeSessionId;
        if (!sessionId) {
            const providerId = options?.providerId || Array.from(this._providers.keys())[0];
            if (!providerId) throw new Error('No provider is selected.');
            const models = await this.listModels(providerId);
            const modelId = models[0]?.id;
            if (!modelId) throw this._noModelsError(providerId);
            const session = await this.createSession({
                providerId,
                modelId,
                personalityId: this._currentPersonalityId,
            });
            sessionId = session.id;
        }

        const hasAllowedScriptApi = !!options && Object.prototype.hasOwnProperty.call(options, 'allowedScriptApi');
        const hasPersonalityId = !!options && Object.prototype.hasOwnProperty.call(options, 'personalityId');
        const hasPersonalityPrompt = !!options && Object.prototype.hasOwnProperty.call(options, 'personalityPrompt');
        const personality = hasPersonalityId
            ? (options?.personalityId ? this.getPersonality(options.personalityId) : undefined)
            : this.getCurrentPersonality();
        const controller = this._createActiveTurnAbortController(options?.signal);

        let result: any;
        // Acknowledged only once the turn succeeds — a failed turn proves nothing
        // about what the server kept.
        let turnManifestHash: string | null = null;
        try {
            // Recomposed on every turn so the model always sees the current viewer
            // state — never a snapshot from an earlier step.
            let liveViewerContext: LiveViewerContext | undefined;
            try {
                liveViewerContext = this._getLiveViewerContext?.();
            } catch (error) {
                chatDebugLog('LIVE_VIEWER_CONTEXT_FAILED', { error: String(error) });
            }

            // Sorted + monotonic within a session: the rendered system block only
            // changes when a namespace is newly expanded, keeping the prompt prefix
            // cache-friendly across the steps of one assistant loop.
            let expandedNamespaces: string[] | undefined;
            try {
                const expanded = this._getExpandedNamespaces?.();
                expandedNamespaces = Array.isArray(expanded) && expanded.length ? expanded : undefined;
            } catch (error) {
                chatDebugLog('EXPANDED_NAMESPACES_FAILED', { error: String(error) });
            }

            // The manifest is identical for every turn of a session and is the
            // bulk of the request. Address it by content hash and send the bytes
            // only when the server cannot already hold them; a miss is recovered
            // below. See shared/manifest-handle.ts.
            const allowedScriptApi = hasAllowedScriptApi ? options?.allowedScriptApi : this.getAllowedScriptApi();
            const allowedScriptApiHash = turnManifestHash = hashScriptApiManifest(allowedScriptApi);
            const serverHoldsManifest = !!allowedScriptApiHash
                && this._sessionState.get(sessionId)?.manifestHash === allowedScriptApiHash;

            const requestPayload: any = {
                sessionId,
                allowedScriptApi: serverHoldsManifest ? undefined : allowedScriptApi,
                allowedScriptApiHash: allowedScriptApiHash || undefined,
                personalityId: hasPersonalityId ? options?.personalityId ?? null : this._currentPersonalityId,
                personalityPrompt: hasPersonalityPrompt ? options?.personalityPrompt ?? null : (personality?.systemPrompt || null),
                executionMode: options?.executionMode,
                liveViewerContext,
                expandedNamespaces,
                fullPromptNamespaces: this._fullPromptNamespaces,
                // Attachment bytes are already in the store under `attachmentId`;
                // shipping them again here is what used to push the turn body past
                // maxBodyBytes and wedge the session. See shared/attachment-parts.ts.
                messagesDelta: options?.messagesDelta?.length
                    ? stripDuplicatedMessagePayloads(options.messagesDelta)
                    : undefined,
                scriptTransport: options?.scriptTransport,
                transportDamage: options?.transportDamage,
                // Deterministic reply id: on a streamed cutoff both the server's
                // persisted partial and the client's synthesized copy carry it, so
                // the store's id-dedup converges them without an extra roundtrip.
                assistantMessageId: `msg_${(globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).slice(2).padEnd(10, '0')}`,
            };
            chatDebugLog('SEND_TURN_REQUEST', {
                sessionId,
                providerId: options?.providerId || null,
                payload: {
                    hasAllowedScriptApi: !!requestPayload.allowedScriptApi,
                    personalityId: requestPayload.personalityId,
                    hasPersonalityPrompt: !!requestPayload.personalityPrompt,
                    executionMode: requestPayload.executionMode ?? null,
                    scriptTransport: requestPayload.scriptTransport ?? null,
                    transportDamage: requestPayload.transportDamage ?? null,
                    hasLiveViewerContext: !!requestPayload.liveViewerContext,
                    viewerCount: Array.isArray(requestPayload.liveViewerContext?.viewers)
                        ? requestPayload.liveViewerContext.viewers.length
                        : 0,
                },
                // Per-field bytes, not just a total: a turn body that grows is
                // otherwise only visible as an eventual 413, with no clue which
                // field did it. Gated explicitly — the argument list is evaluated
                // before chatDebugLog can decide to drop it, and this serializes
                // the whole payload.
                bytes: isChatDebugModeEnabled() ? measurePayloadBytes(requestPayload) : undefined,
            }, "log");
            const callOptions = {
                ...this._authCallOptions(options?.providerId ?? this._sessionState.get(sessionId)?.providerId),
                signal: controller.signal,
            };
            const dispatch = () => this._dispatchTurn(requestPayload, callOptions, options?.onDelta, controller, options?.onStatus);
            let outcome;
            try {
                outcome = await dispatch();
            } catch (error: any) {
                if (this._isManifestMissError(error) && !requestPayload.allowedScriptApi && allowedScriptApi) {
                    // The server no longer holds the manifest this handle names —
                    // restart, eviction, or a sibling worker that never saw it.
                    // Resend inline, exactly once: the retry carries the bytes, so
                    // a second miss would be a real error, not a cold cache.
                    chatDebugLog('SEND_TURN_MANIFEST_MISS', { sessionId, hash: allowedScriptApiHash }, "log");
                    this._forgetManifestHandle(sessionId);
                    requestPayload.allowedScriptApi = allowedScriptApi;
                    try {
                        outcome = await dispatch();
                    } catch (retryError: any) {
                        throw this._mapTurnFailure(sessionId, options?.messagesDelta, retryError);
                    }
                } else {
                    throw this._mapTurnFailure(sessionId, options?.messagesDelta, error);
                }
            }
            if (outcome.kind === 'cutoff') {
                // Client-side cutoff (complete script fence / stop) with partial
                // streamed text in hand. The sync cursor is deliberately NOT
                // advanced: the synthesized message re-travels in the next turn's
                // messagesDelta under its deterministic id and the server store's
                // id-dedup converges both sides on one record.
                chatDebugLog('SEND_TURN_CUTOFF', {
                    sessionId,
                    messageId: outcome.message.id,
                    chars: String(outcome.message.content || '').length,
                }, "log");
                // No usage is recorded here, and that is not an oversight: WE aborted the
                // socket, so the server's result — which does carry the tokens it billed —
                // has nowhere to land. The tokens are real but unobservable from this side,
                // so the readout under-counts a stopped turn rather than inventing a figure.
                // (A server-side cutoff, where the response still arrives, is accounted for
                // normally further down.)
                return {
                    ...outcome.message,
                    role: outcome.message.role || 'assistant',
                    createdAt: ensureDate(outcome.message.createdAt),
                };
            }
            result = outcome.result;
        } finally {
            this._clearActiveTurnAbortController(controller);
        }

        // The turn RPC already returns the (possibly newly-titled, re-ordered) session, so
        // fold it into the listSessions cache — the panel's post-turn sync then reads it
        // locally instead of forcing a fresh listSessions every turn. The transcript grew,
        // so drop this session's cached hydration (the panel holds the authoritative list).
        if (result?.session) {
            this._upsertSessionInCache(result.session);
        }
        this._invalidateSessionHydration(sessionId);

        if (result?.capabilities && sessionId) {
            const sessionProviderId = result?.session?.providerId || options?.providerId || null;
            const sessionModelId = result?.session?.modelId || null;
            if (sessionProviderId && sessionModelId) {
                this._updateSingleModelCapabilities(sessionProviderId, sessionModelId, result.capabilities);
            }
        }

        const state = this._sessionState.get(sessionId) || {
            syncedCount: 0,
            providerId: result?.session?.providerId || '',
            providerContextId: result?.session?.contextId || null,
            viewerContextId: typeof result?.session?.metadata?.viewerContextId === 'string'
                ? result.session.metadata.viewerContextId
                : null,
        };
        // +persistedDeltaCount for the inline delta the server just stored,
        // +1 for the assistant reply it appended. On a thrown error the cursor
        // stays put and the retry re-sends the same ids; the server store dedups.
        const persistedDelta = Number(result?.persistedDeltaCount) || 0;
        this._sessionState.set(sessionId, {
            ...state,
            providerId: result?.session?.providerId || state.providerId || '',
            providerContextId: result?.session?.contextId || state.providerContextId || null,
            viewerContextId: (typeof result?.session?.metadata?.viewerContextId === 'string'
                ? result.session.metadata.viewerContextId
                : state.viewerContextId) || null,
            syncedCount: state.syncedCount + persistedDelta + 1,
            // Only when the server SAYS it kept the manifest. Inferring it from a
            // successful turn would make a deployment with no cache alternate
            // between a handle it always misses and a resend, forever.
            manifestHash: result?.manifestCached ? turnManifestHash : null,
        });

        const message = result?.message || result;

        // The server shrank the conversation to fit the context window. Tell the
        // model on its NEXT turn so it re-asks precisely instead of assuming full
        // continuity (the note piggybacks onto the next outgoing user message).
        const truncatedTo = Number(message?.metadata?.historyTruncatedTo);
        if (Number.isFinite(truncatedTo) && truncatedTo > 0) {
            this.queueCapabilityNotice(
                `Note: the conversation history sent to you was truncated to the last ${truncatedTo} message(s) ` +
                `to fit the model's context window. Details from earlier turns may be missing — if something ` +
                `established earlier matters now, ask the user to restate it rather than assuming it.`
            );
        }

        // Fold this call's tokens in before narrowing the result to a ChatMessage below —
        // `usage` is unreachable after that, which is why it used to be dropped here.
        this._recordUsage(sessionId, result?.usage);

        chatDebugLog('SEND_TURN_RESPONSE', {
            sessionId,
            providerId: result?.session?.providerId || options?.providerId || null,
            usage: result?.usage || null,
            message: summarizeChatDebugMessage(message),
        }, "log");
        return {
            ...message,
            role: message.role || 'assistant',
            createdAt: ensureDate(message.createdAt),
        };
    }

    /** Fold one upstream call's usage into the session's running totals. */
    _recordUsage(sessionId: string | null | undefined, usage: ChatTurnResult['usage']): void {
        if (!sessionId || !usage) return;
        let state = this._sessionUsage.get(sessionId);
        if (!state) {
            state = createSessionUsage();
            this._sessionUsage.set(sessionId, state);
        }
        recordUsage(state, usage, new Date().toISOString());
    }

    /**
     * Mark the start of a new user message, so per-message totals cover the whole
     * assistant loop rather than whichever step happened to run last.
     *
     * Called from the panel at the point it emits `turn-start` — the client is the only
     * side that can see this boundary, since a server turn is a single upstream call.
     */
    beginUsageGroup(sessionId: string | null | undefined): void {
        if (!sessionId) return;
        let state = this._sessionUsage.get(sessionId);
        if (!state) {
            state = createSessionUsage();
            this._sessionUsage.set(sessionId, state);
        }
        beginGroup(state);
    }

    /**
     * Token totals for a session, or null when nothing has been recorded.
     *
     * Null is meaningful and must not be rendered as zeros: it means this tab has not
     * seen a turn for that session (a fresh reload, or a session opened but never used),
     * which is a different statement from "this session cost nothing".
     */
    getUsageStats(sessionId: string | null | undefined): SessionUsage | null {
        if (!sessionId) return null;
        const state = this._sessionUsage.get(sessionId);
        return state ? snapshotUsage(state) : null;
    }

    _isManifestMissError(error: any): boolean {
        return String(error?.code || '') === MANIFEST_MISS_CODE;
    }

    /** The server holds no manifest for this session until the next inline send proves otherwise. */
    _forgetManifestHandle(sessionId: string): void {
        const state = this._sessionState.get(sessionId);
        if (state?.manifestHash) this._sessionState.set(sessionId, { ...state, manifestHash: null });
    }

    /** Turn-level failures that need more than a rethrow. Everything else passes through untouched. */
    _mapTurnFailure(sessionId: string, messagesDelta: ChatMessage[] | undefined, error: any): any {
        if (this._isBodyTooLargeError(error)) return this._skipOversizedDelta(sessionId, messagesDelta, error);
        return error;
    }

    _isBodyTooLargeError(error: any): boolean {
        return String(error?.code || '') === 'RPC_BODY_TOO_LARGE'
            || Number(error?.status ?? error?.statusCode) === 413;
    }

    /**
     * A turn body the server refuses can never be retried into success, yet the
     * sync cursor deliberately stays put on a failed turn so the delta is re-sent
     * — which turned one oversized message into a session that failed every turn
     * until the page was reloaded. Advance past it instead: those messages never
     * reach the server transcript, which is the honest outcome, and the session
     * stays usable. The caller gets a tagged error to render.
     */
    _skipOversizedDelta(sessionId: string, messagesDelta: ChatMessage[] | undefined, cause: any): Error {
        const skipped = messagesDelta?.length || 0;
        if (skipped) {
            const state = this._sessionState.get(sessionId) || { syncedCount: 0, providerId: '' };
            this._sessionState.set(sessionId, { ...state, syncedCount: state.syncedCount + skipped });
        }
        chatDebugLog('SEND_TURN_BODY_TOO_LARGE', { sessionId, skipped, error: String(cause?.message || cause) }, "error");
        const error: any = new Error(cause?.message || 'Turn payload exceeds the server limit.');
        error.code = 'RPC_BODY_TOO_LARGE';
        error.skippedMessageCount = skipped;
        error.cause = cause;
        return error;
    }

    _isStreamingUnavailableError(error: any): boolean {
        const code = String(error?.code || '');
        if (code === 'RPC_UNKNOWN_METHOD' || code === 'RPC_NOT_STREAMABLE' || code === 'RPC_STREAM_REQUIRED') return true;
        return Number(error?.status ?? error?.statusCode) === 404;
    }

    /**
     * Run one model turn over the best available transport.
     *
     * Streaming rides the generic RPC $stream scope (NDJSON over the shared,
     * auth/CSRF/proxy-transparent HttpClient); the buffered sendTurn RPC is the
     * universal fallback. Fallback fires ONLY before any delta was received —
     * a stream that failed after partial emission is a real error (re-running
     * it would silently rewind text the user already saw). Returns either the
     * terminal turn result or a `cutoff` carrying the partial text when OUR
     * abort controller (fence early-exit, stop button, superseding turn) ended
     * the stream after deltas arrived.
     */
    async _dispatchTurn(
        requestPayload: any,
        callOptions: any,
        onDelta: ((accumulated: string, delta: string) => void) | undefined,
        controller: AbortController,
        onStatus?: ((state: string) => void) | undefined
    ): Promise<{ kind: 'result'; result: any } | { kind: 'cutoff'; message: ChatMessage }> {
        const scope: any = this._server();
        // New runtimes expose $stream as an object sub-scope; on an old core
        // bundle the proxy would answer with a plain invoke function instead.
        const streamScope = typeof scope?.$stream === 'object' ? scope.$stream : null;
        const canStream = this._streamingEnabled
            && !this._streamingBrokenForSession
            && !!streamScope;

        // A model turn is open-ended; its lifetime is owned by `controller`
        // (stop button / fence / supersede), so opt the buffered RPC out of the
        // HttpClient timeout backstop rather than letting a 30s default truncate
        // a long reasoning turn.
        const bufferedOptions = { ...callOptions, timeoutMs: 0 };

        if (!canStream) {
            return { kind: 'result', result: await scope.sendTurn!(requestPayload, bufferedOptions) };
        }

        let accumulated = '';
        let sawDelta = false;
        let handle: RpcStreamHandle;
        try {
            handle = streamScope.sendTurnStream(requestPayload, callOptions);
        } catch (error: any) {
            // callServerStream throws SYNCHRONOUSLY when the server scope is
            // missing (e.g. an old core bundle). No delta could have been emitted
            // yet, so degrade to the buffered transport instead of surfacing a raw
            // streaming error — same intent as the runtime-unavailable branch below.
            this._streamingBrokenForSession = true;
            chatDebugLog('STREAMING_UNAVAILABLE_FALLBACK', { code: error?.code || null, status: error?.status || null, sync: true }, "log");
            return { kind: 'result', result: await scope.sendTurn!(requestPayload, bufferedOptions) };
        }
        const consume = (async () => {
            for await (const event of handle.events) {
                if (event && event.type === 'delta' && typeof event.text === 'string') {
                    accumulated += event.text;
                    sawDelta = true;
                    try { onDelta?.(accumulated, event.text); } catch (_) { /* observer must not kill the turn */ }
                } else if (event && event.type === 'reset') {
                    // The server abandoned an attempt and is streaming this answer
                    // again from its first token (retry ladder / tools-unsupported
                    // fallback). Accumulation is per REQUEST, so without this the
                    // abandoned partial stays glued in front of the new text — and
                    // a cutoff would persist the concatenation as the reply.
                    accumulated = '';
                    // Nothing streamed is outstanding any more: a cutoff from here on
                    // has no partial text to synthesize, and an empty synthesized
                    // reply is worse than surfacing the transport error.
                    sawDelta = false;
                    try { onDelta?.('', ''); } catch (_) { /* observer must not kill the turn */ }
                } else if (event && event.type === 'status' && typeof event.state === 'string') {
                    try { onStatus?.(event.state); } catch (_) { /* observer must not kill the turn */ }
                }
            }
        })();
        consume.catch(() => { /* failures surface via handle.result */ });

        try {
            return { kind: 'result', result: await handle.result };
        } catch (error: any) {
            if (sawDelta && controller.signal.aborted) {
                // Our own cutoff with partial text — synthesize the reply the
                // server persisted (or will absorb) under the same id.
                return {
                    kind: 'cutoff',
                    message: {
                        id: requestPayload.assistantMessageId,
                        sessionId: requestPayload.sessionId,
                        role: 'assistant',
                        content: accumulated,
                        parts: [{ type: 'text', text: accumulated }],
                        createdAt: new Date().toISOString(),
                        metadata: { clientCutoff: true } as any,
                    } as ChatMessage,
                };
            }
            if (!sawDelta && this._isStreamingUnavailableError(error)) {
                // Old server / streaming disabled server-side: fall back to the
                // buffered RPC transparently and stop probing this session.
                this._streamingBrokenForSession = true;
                chatDebugLog('STREAMING_UNAVAILABLE_FALLBACK', { code: error?.code || null, status: error?.status || null }, "log");
                return { kind: 'result', result: await scope.sendTurn!(requestPayload, bufferedOptions) };
            }
            throw error;
        }
    }

    getCachedModels(providerId: string): ChatProviderModelInfo[] {
        return [...(this._modelCatalog.get(providerId) || [])];
    }

    _updateModelCache(providerId: string, models: ChatProviderModelInfo[]): ChatProviderModelInfo[] {
        this._modelCatalog.set(providerId, Array.isArray(models) ? [...models] : []);
        return this.getCachedModels(providerId);
    }

    _updateSingleModelCapabilities(providerId: string, modelId: string, capabilities: ModelCapabilities): void {
        const models = this._modelCatalog.get(providerId) || [];
        let found = false;
        const next = models.map((m) => {
            if (m.id !== modelId) return m;
            found = true;
            return {
                ...m,
                capabilities,
                supportsImages: capabilities.images === 'supported',
                supportsFiles: capabilities.files === 'supported',
                multimodal: capabilities.images === 'supported' || capabilities.files === 'supported',
            };
        });

        if (!found) {
            next.push({
                id: modelId,
                label: modelId,
                capabilities,
                supportsImages: capabilities.images === 'supported',
                supportsFiles: capabilities.files === 'supported',
                multimodal: capabilities.images === 'supported' || capabilities.files === 'supported',
            });
        }

        this._modelCatalog.set(providerId, next);
    }

    async ensureModelCapabilities(providerId: string, modelId: string): Promise<ModelCapabilities> {
        const result = await this._server().ensureModelCapabilities!({ providerId, modelId }, this._authCallOptions(providerId));
        const capabilities = result?.capabilities || {
            text: 'unknown',
            images: 'unknown',
            files: 'unknown',
            source: 'default',
        };
        this._updateSingleModelCapabilities(providerId, modelId, capabilities);
        return capabilities;
    }

    async sendMessage(providerId: string, messages: ChatMessage[], options?: {
        signal?: AbortSignal;
        /** One-shot script-surface override for this turn — see `sendTurn`. */
        scriptTransport?: 'auto' | 'fence';
        /** Observed output damage, reported once so the server can persist it — see `sendTurn`. */
        transportDamage?: string;
        onDelta?: (accumulated: string, delta: string) => void;
        /** Contentless liveness (`'thinking'`) while the model generates — see `sendTurn`. */
        onStatus?: (state: string) => void;
    }): Promise<ChatMessage> {
        // Boot-time sends wait for the host's capability baseline (plugin scripting
        // namespaces) so the manifest and viewer context below are complete.
        if (this._awaitReadyForSend) await this._awaitReadyForSend();

        let sessionId = this._activeSessionId;
        if (!sessionId) {
            const models = await this.listModels(providerId);
            const modelId = models[0]?.id;
            if (!modelId) throw this._noModelsError(providerId);
            const session = await this.createSession({
                providerId,
                modelId,
                personalityId: this._currentPersonalityId,
            });
            sessionId = session.id;
        }

        const state = this._sessionState.get(sessionId) || { syncedCount: 0, providerId };
        let delta = messages.slice(state.syncedCount);

        // Stamp ids on the ORIGINAL message objects before any cloning below: the
        // delta rides the sendTurn request and the server store dedups by id, which
        // is what keeps a retried turn (after a mid-flight failure) from
        // double-appending. A regenerated id would defeat that.
        for (const m of delta) {
            if (!m.id) (m as any).id = `msg_${(globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2))}`;
        }

        // Intent-hint hook: the host may expand likely-needed scripting namespaces
        // from the user's own words BEFORE the first model step of this turn. Skips
        // runtime-injected messages (script failures also travel as role 'user').
        if (this._onUserTurnText) {
            for (const m of delta) {
                if (m?.role !== 'user') continue;
                const md: any = (m as any)?.metadata || {};
                if (md.internalSource || md.hiddenFromChatUi || md.scriptError) continue;
                if (Array.isArray(m.parts) && m.parts.some((p: any) => p?.type === 'script-result' || p?.type === 'host-feedback')) continue;
                const text = typeof m.content === 'string' ? m.content : '';
                if (text.trim()) {
                    try { this._onUserTurnText(text); } catch (_) { /* host hook must not break the send */ }
                }
            }
        }

        // Piggyback any pending one-time capability notices onto the outgoing user
        // message (NOT a system message — extra system turns break some model APIs).
        // We clone the message so the visible chat bubble in `messages` stays clean.
        if (this._pendingCapabilityNotices.length && delta.length) {
            const noticeText = this._drainPendingCapabilityNotices();
            if (noticeText) {
                delta = delta.slice();
                for (let i = delta.length - 1; i >= 0; i--) {
                    if (delta[i]?.role === 'user') {
                        delta[i] = this._appendNoticeToUserMessage(delta[i], noticeText);
                        break;
                    }
                }
            }
        }

        chatDebugLog('SEND_MESSAGE', {
            sessionId,
            providerId,
            totalMessages: messages.length,
            deltaMessages: delta.map(summarizeChatDebugMessage),
        }, "log");
        // The delta rides the turn request itself (one RPC per assistant-loop step
        // instead of appendMessages + sendTurn).
        const messagesDelta = delta.length
            ? delta.map((m) => ({
                ...m,
                createdAt: ensureDate(m.createdAt),
                parts: m.parts || (typeof m.content === "string" ? [{ type: "text", text: m.content }] : []),
                content: typeof m.content === "string" ? m.content : undefined,
            }))
            : undefined;

        const reply = await this.sendTurn({
            sessionId, providerId, allowedScriptApi: this.getAllowedScriptApi(),
            signal: options?.signal, messagesDelta,
            scriptTransport: options?.scriptTransport,
            transportDamage: options?.transportDamage,
            onDelta: options?.onDelta,
            onStatus: options?.onStatus,
        });
        return reply;
    }

    /**
     * Queue a one-time note to be piggybacked onto the next outgoing user message,
     * e.g. when a new scripting capability becomes available mid-session. The note
     * is delivered on the next turn and then discarded.
     */
    queueCapabilityNotice(text: string): void {
        const trimmed = String(text || '').trim();
        if (trimmed) this._pendingCapabilityNotices.push(trimmed);
    }

    _drainPendingCapabilityNotices(): string {
        if (!this._pendingCapabilityNotices.length) return '';
        const text = this._pendingCapabilityNotices.join(' ');
        this._pendingCapabilityNotices = [];
        return text;
    }

    _appendNoticeToUserMessage(message: ChatMessage, noticeText: string): ChatMessage {
        // Attach as a typed part only — `content` stays exactly what the user typed,
        // so the notice never renders as user-authored text (ChatMessageList hides
        // capability-notice parts in user-friendly mode) yet still reaches the model.
        const parts = Array.isArray(message.parts)
            ? message.parts.slice()
            : (typeof message.content === 'string' && message.content
                ? [{ type: 'text', text: message.content } as ChatMessagePart]
                : []);
        parts.push({ type: 'capability-notice', text: noticeText });
        return { ...message, parts };
    }

    async _blobToDataUrl(blob: Blob): Promise<string> {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(blob);
        });
    }

    _normalizeContextId(value: unknown): string | null {
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed || null;
    }

    getProviderRuntimeContextId(providerId?: string | null): string | null {
        if (!providerId) return null;
        return this._normalizeContextId(this.getProvider(providerId)?.contextId);
    }

    getProviderContextId(providerId?: string | null): string | null {
        return this.getProviderRuntimeContextId(providerId);
    }

    getSessionProviderRuntimeContextId(sessionId?: string | null): string | null {
        const resolvedSessionId = sessionId || this._activeSessionId;
        if (!resolvedSessionId) return null;

        const state = this._sessionState.get(resolvedSessionId);
        const fromState = this._normalizeContextId(state?.providerContextId);
        if (fromState) return fromState;

        return this.getProviderRuntimeContextId(state?.providerId || null);
    }

    getActiveProviderRuntimeContextId(): string | null {
        return this.getSessionProviderRuntimeContextId(this._activeSessionId);
    }

    getSessionProviderContextId(sessionId?: string | null): string | null {
        return this.getSessionProviderRuntimeContextId(sessionId);
    }

    getActiveProviderContextId(): string | null {
        return this.getActiveProviderRuntimeContextId();
    }

    getSessionViewerContextId(sessionId?: string | null): string | null {
        const resolvedSessionId = sessionId || this._activeSessionId;
        if (!resolvedSessionId) return null;

        const state = this._sessionState.get(resolvedSessionId);
        return this._normalizeContextId(state?.viewerContextId);
    }

    getActiveViewerContextId(): string | null {
        return null;
    }

    setSessionViewerContextId(sessionId: string, viewerContextId: string | null): void {
        const state = this._sessionState.get(sessionId);
        if (!state) return;

        this._sessionState.set(sessionId, {
            ...state,
            viewerContextId: this._normalizeContextId(viewerContextId),
        });
    }

    async createSession(input: CreateSessionInput): Promise<ChatSession> {
        const hasPersonalityId = Object.prototype.hasOwnProperty.call(input, 'personalityId');
        const hasPersonalityPrompt = Object.prototype.hasOwnProperty.call(input, 'personalityPrompt');
        const personality = hasPersonalityId
            ? (input.personalityId ? this._personalities.get(input.personalityId) : undefined)
            : this.getCurrentPersonality();
        const metadata = {
            ...(input.metadata || {}),
            sessionOwnerKey: this._normalizeContextId((input.metadata as any)?.sessionOwnerKey) || this._sessionOwnerKey,
            source: this._normalizeContextId((input.metadata as any)?.source) || this._legacySessionSource || undefined,
            debugMode: typeof (input.metadata as any)?.debugMode === 'boolean'
                ? (input.metadata as any)?.debugMode
                : this._getDebugModeFlag(),
        };
        const session = await this._server().createSession!({
            ...input,
            metadata,
            personalityId: hasPersonalityId ? input.personalityId ?? null : (this._currentPersonalityId ?? null),
            personalityPrompt: hasPersonalityPrompt ? input.personalityPrompt ?? null : (personality?.systemPrompt ?? null),
        }, this._authCallOptions(input.providerId));

        if (session.providerId && session.modelId) {
            try {
                await this.ensureModelCapabilities(session.providerId, session.modelId);
            } catch (error) {
                console.warn("Failed to ensure model capabilities:", error);
            }
        }

        this._activeSessionId = session.id;
        this._sessionState.set(session.id, {
            syncedCount: 0,
            providerId: session.providerId,
            providerContextId: this._normalizeContextId(session.contextId)
                || this.getProviderRuntimeContextId(session.providerId),
            viewerContextId: this._normalizeContextId(session.metadata?.viewerContextId),
        });
        this._invalidateSessionsCache();

        return session;
    }

    /**
     * Hydrate a session. By default this ACTIVATES the session: it becomes the active
     * session, its state is cached, and `onSessionHydrated` fires so the host can restore
     * session-scoped state. Pass `{ activate: false }` for a read-only peek (e.g. reading
     * another session's transcript) — no active-session mutation and no host callback, so
     * the live conversation's session-scoped state is left untouched.
     */
    async loadSession(sessionId: string, { activate = true }: { activate?: boolean } = {}): Promise<ChatSessionHydration> {
        // Serve the server hydration from a short reuse window (+ in-flight coalescing) so
        // re-entering an unchanged session does not re-hit `getSession`. Only the network
        // fetch is cached — the activation side-effects below run on every call, so a cache
        // hit behaves identically minus the round-trip. Invalidated when the transcript
        // changes (turn append, rename/delete); errors are never cached.
        const cached = this._sessionHydrationCache.get(sessionId);
        let hydration: any;
        if (cached && (Date.now() - cached.at) < ChatService.LOAD_SESSION_REUSE_MS) {
            hydration = cached.hydration;
        } else {
            let pending = this._sessionHydrationInFlight.get(sessionId);
            if (!pending) {
                pending = (async () => {
                    const result = await this._server().getSession!({ sessionId, hydrateMessages: true });
                    this._sessionHydrationCache.set(sessionId, { hydration: result, at: Date.now() });
                    return result;
                })().finally(() => this._sessionHydrationInFlight.delete(sessionId));
                this._sessionHydrationInFlight.set(sessionId, pending);
            }
            hydration = await pending;
        }

        if (activate) {
            this._activeSessionId = hydration.session.id;
            this._sessionState.set(hydration.session.id, {
                syncedCount: Array.isArray(hydration.messages) ? hydration.messages.length : 0,
                providerId: hydration.session.providerId,
                providerContextId: this._normalizeContextId(hydration.session.contextId)
                    || this.getProviderRuntimeContextId(hydration.session.providerId),
                viewerContextId: this._normalizeContextId(hydration.session.metadata?.viewerContextId),
            });

            // Restore host-side session-scoped state (e.g. expanded scripting namespaces)
            // from the persisted session metadata. Active session id is set above, so the
            // host callback can key its state correctly.
            try { this._onSessionHydrated?.(hydration.session); } catch (_) { /* host callback must not break load */ }
        }

        return {
            ...hydration,
            messages: (hydration.messages || []).map((m: ChatMessage) => ({
                ...m,
                createdAt: ensureDate(m.createdAt),
            })),
        };
    }

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
        // Stripped on the way out: an uploaded attachment is addressed by
        // `attachmentId`, so re-sending its base64 doubles the request for
        // nothing. See shared/attachment-parts.ts.
        const normalized = messages.map((m) => stripDuplicatedPartPayloads({
            ...m,
            createdAt: ensureDate(m.createdAt),
            parts: m.parts || (typeof m.content === "string" ? [{ type: "text", text: m.content }] : []),
            content: typeof m.content === "string" ? m.content : undefined,
        }));
        chatDebugLog('APPEND_MESSAGES_REQUEST', {
            sessionId,
            messages: normalized.map(summarizeChatDebugMessage),
        });

        const result = await this._server().appendMessages!({
            sessionId,
            messages: normalized,
        }, this._authCallOptionsForSession(sessionId));

        // Transcript changed underneath any cached hydration.
        this._invalidateSessionHydration(sessionId);

        const state = this._sessionState.get(sessionId);
        const nextCount = (state?.syncedCount || 0) + normalized.length;

        this._sessionState.set(sessionId, {
            ...(state || { providerId: "" }),
            syncedCount: nextCount,
        });
        chatDebugLog('APPEND_MESSAGES_RESPONSE', {
            sessionId,
            messages: (result?.messages || []).map(summarizeChatDebugMessage),
        });

        return (result?.messages || []).map((m: ChatMessage) => ({
            ...m,
            createdAt: ensureDate(m.createdAt),
        }));
    }
}
