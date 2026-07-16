export type RpcMethodCaller = (input?: any, options?: { contextId?: string; client?: any; signal?: AbortSignal }) => Promise<any>;
export type RpcScope = Record<string, RpcMethodCaller>;

export interface ChatServiceOptions {
    getAllowedScriptApi?: (() => AllowedScriptApiManifest | undefined) | undefined;
    /** Composes the live viewer-state snapshot injected into every turn's system prompt. */
    getLiveViewerContext?: (() => LiveViewerContext | undefined) | undefined;
    /**
     * Awaited before each send. Lets the host delay the first turn until the
     * scripting-capability baseline has settled (all boot-time plugin namespaces
     * registered), so the manifest and viewer context are complete.
     */
    awaitReadyForSend?: (() => Promise<void>) | undefined;
    serverFactory?: (() => RpcScope) | undefined;
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string | null;
    providers?: ChatProviderClientRegistration[];
    rpcTimeoutMs?: number;
    sessionOwnerKey?: string | null;
    legacySessionSource?: string | null;
}

function ensureDate(value?: Date | string): Date {
    return value instanceof Date ? value : value ? new Date(value) : new Date();
}

let enabled: boolean | undefined = undefined;
function isChatDebugModeEnabled(): boolean {
    if (enabled === undefined) {
        enabled = APPLICATION_CONTEXT.getOption("debugMode", true, true);
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
    _awaitReadyForSend: (() => Promise<void>) | undefined;
    _serverFactory: (() => RpcScope) | undefined;
    _activeSessionId: string | null;
    _sessionState: Map<string, {
        syncedCount: number;
        providerId: string;
        providerContextId?: string | null;
        viewerContextId?: string | null;
    }>;
    _modelCatalog: Map<string, ChatProviderModelInfo[]>;
    _activeTurnAbortController: AbortController | null;
    _rpcTimeoutMs: number;
    _rpcHttpClient: any | null;
    _authedRpcHttpClients: Map<string, any>;
    _sessionOwnerKey: string | null;
    _legacySessionSource: string | null;
    _pendingCapabilityNotices: string[];

    constructor(opts: ChatServiceOptions = {}) {
        this._providers = new Map();
        this._providerTypes = new Map();
        this._personalities = new Map();
        this._currentPersonalityId = opts.defaultPersonalityId || null;
        this._getAllowedScriptApi = typeof opts.getAllowedScriptApi === 'function' ? opts.getAllowedScriptApi : undefined;
        this._getLiveViewerContext = typeof opts.getLiveViewerContext === 'function' ? opts.getLiveViewerContext : undefined;
        this._awaitReadyForSend = typeof opts.awaitReadyForSend === 'function' ? opts.awaitReadyForSend : undefined;
        this._serverFactory = opts.serverFactory;
        this._activeSessionId = null;
        this._sessionState = new Map();
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
            });
        } catch (_error) {
            this._rpcHttpClient = current;
        }

        return this._rpcHttpClient;
    }

    /**
     * A per-context RPC HttpClient that attaches the context's JWT
     * (`Authorization: Bearer`) so the server's `rpcVerifiers.<contextId>` gate
     * can validate it. Cached per contextId. Returns null if HttpClient is
     * unavailable (falls back to the unauthenticated client).
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
                    auth: { contextId, types: ["jwt"], required: true, refreshOn401: true },
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
        if (client) this._authedRpcHttpClients.set(contextId, client);
        return client;
    }

    /**
     * Build RPC call options for a provider-scoped call. When the provider
     * requires login, attaches the auth context (verifier selection) + a
     * JWT-bearing HttpClient; otherwise the default unauthenticated client.
     */
    _authCallOptions(providerId?: string | null): { httpClient: any; contextId?: string } {
        const provider = providerId ? this.getProvider(providerId) : undefined;
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

    isAbortError(error: unknown): boolean {
        if (!error) return false;
        const anyError = error as any;
        return anyError?.name === 'AbortError'
            || anyError?.code === 'ABORT_ERR'
            || /abort(ed|ing)?/i.test(String(anyError?.message || error));
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

    async refreshProviderTypesFromServer(): Promise<ChatProviderTypeRecord[]> {
        const result = await this._server().listProviderTypes!();
        const types = result?.providerTypes || [];
        for (const type of types) this._providerTypes.set(type.id, type);
        return this.getProviderTypes();
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
        return provider;
    }

    async refreshProvidersFromServer(typeId?: string): Promise<ChatProviderClientRegistration[]> {
        const result = await this._server().listProviders!({ typeId: typeId || null });
        const providers = result?.providers || [];
        for (const provider of providers) this._providers.set(provider.id, provider);
        return this.getProviders();
    }

    getProviders(): ChatProviderClientRegistration[] {
        return Array.from(this._providers.values());
    }

    getProvider(providerId: string): ChatProviderClientRegistration | undefined {
        return this._providers.get(providerId);
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
        return this._server().setProviderUserSecrets!({ providerId, secrets }, this._authCallOptions(providerId));
    }

    async clearProviderUserSecrets(providerId: string): Promise<ProviderUserSecretsStatus> {
        return this._server().clearProviderUserSecrets!({ providerId }, this._authCallOptions(providerId));
    }

    async listModels(providerId: string, draft?: { providerTypeId?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown>; contextId?: string | null }): Promise<ChatProviderModelInfo[]> {
        const result = providerId
            ? await this._server().listModels!({ providerId }, this._authCallOptions(providerId))
            : await this._server().listModels!({
                providerTypeId: draft?.providerTypeId || null,
                draftConfig: draft?.config || {},
                draftSecrets: draft?.secrets || {},
                contextId: draft?.contextId || null,
            });
        const models = result?.models || [];
        if (providerId) this._updateModelCache(providerId, models);
        return models;
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

    isAuthenticated(providerId: string): boolean {
        const provider = this.getProvider(providerId);
        if (!provider) return false;
        if (provider.requiresLogin === false) return true;
        const ctx = this._providerContextId(provider);
        const auth = this._auth();
        if (!ctx || !auth) return false;
        return auth.isAuthenticated(ctx);
    }

    async login(providerId: string): Promise<void> {
        const provider = this.getProvider(providerId);
        if (!provider) throw new Error(`Unknown provider '${providerId}'.`);
        if (provider.requiresLogin === false) return;

        const ctx = this._providerContextId(provider);
        if (!ctx) throw new Error(`Provider '${providerId}' requires login but declares no auth context.`);
        const auth = this._auth();
        if (!auth) throw new Error('Auth broker (APPLICATION_CONTEXT.auth) is unavailable.');
        if (!auth.hasContext(ctx)) {
            throw new Error(`Auth context '${ctx}' is not configured — the provider plugin must call APPLICATION_CONTEXT.auth.configureContext(...).`);
        }
        await auth.login(ctx);
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

    async listSessions(providerId?: string): Promise<ChatSession[]> {
        const result = await this._server().listSessions!({ providerId: providerId || null }, this._authCallOptions(providerId));
        return (result?.sessions || []).filter((session: ChatSession) => this._ownsSession(session));
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
        return this._server().renameSession!({ sessionId, title }, this._authCallOptionsForSession(sessionId));
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this._server().deleteSession!({ sessionId }, this._authCallOptionsForSession(sessionId));
        this._sessionState.delete(sessionId);
        if (this._activeSessionId === sessionId) this._activeSessionId = null;
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
    }): Promise<ChatMessage> {
        let sessionId = options?.sessionId || this._activeSessionId;
        if (!sessionId) {
            const providerId = options?.providerId || Array.from(this._providers.keys())[0];
            if (!providerId) throw new Error('No provider is selected.');
            const models = await this.listModels(providerId);
            const modelId = models[0]?.id;
            if (!modelId) throw new Error(`Provider '${providerId}' did not return any models.`);
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
        try {
            // Recomposed on every turn so the model always sees the current viewer
            // state — never a snapshot from an earlier step.
            let liveViewerContext: LiveViewerContext | undefined;
            try {
                liveViewerContext = this._getLiveViewerContext?.();
            } catch (error) {
                chatDebugLog('LIVE_VIEWER_CONTEXT_FAILED', { error: String(error) });
            }

            const requestPayload = {
                sessionId,
                allowedScriptApi: hasAllowedScriptApi ? options?.allowedScriptApi : this.getAllowedScriptApi(),
                personalityId: hasPersonalityId ? options?.personalityId ?? null : this._currentPersonalityId,
                personalityPrompt: hasPersonalityPrompt ? options?.personalityPrompt ?? null : (personality?.systemPrompt || null),
                executionMode: options?.executionMode,
                liveViewerContext,
            };
            chatDebugLog('SEND_TURN_REQUEST', {
                sessionId,
                providerId: options?.providerId || null,
                payload: {
                    hasAllowedScriptApi: !!requestPayload.allowedScriptApi,
                    personalityId: requestPayload.personalityId,
                    hasPersonalityPrompt: !!requestPayload.personalityPrompt,
                    executionMode: requestPayload.executionMode ?? null,
                    hasLiveViewerContext: !!requestPayload.liveViewerContext,
                    viewerCount: Array.isArray(requestPayload.liveViewerContext?.viewers)
                        ? requestPayload.liveViewerContext.viewers.length
                        : 0,
                },
            }, "log");
            result = await this._server().sendTurn!(requestPayload, {
                ...this._authCallOptions(options?.providerId ?? this._sessionState.get(sessionId)?.providerId),
                signal: controller.signal,
            });
        } finally {
            this._clearActiveTurnAbortController(controller);
        }

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
        this._sessionState.set(sessionId, {
            ...state,
            providerId: result?.session?.providerId || state.providerId || '',
            providerContextId: result?.session?.contextId || state.providerContextId || null,
            viewerContextId: (typeof result?.session?.metadata?.viewerContextId === 'string'
                ? result.session.metadata.viewerContextId
                : state.viewerContextId) || null,
            syncedCount: state.syncedCount + 1,
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

    async sendMessage(providerId: string, messages: ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage> {
        // Boot-time sends wait for the host's capability baseline (plugin scripting
        // namespaces) so the manifest and viewer context below are complete.
        if (this._awaitReadyForSend) await this._awaitReadyForSend();

        let sessionId = this._activeSessionId;
        if (!sessionId) {
            const models = await this.listModels(providerId);
            const modelId = models[0]?.id;
            if (!modelId) throw new Error(`Provider '${providerId}' did not return any models.`);
            const session = await this.createSession({
                providerId,
                modelId,
                personalityId: this._currentPersonalityId,
            });
            sessionId = session.id;
        }

        const state = this._sessionState.get(sessionId) || { syncedCount: 0, providerId };
        let delta = messages.slice(state.syncedCount);

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
        if (delta.length) {
            await this.appendMessages(sessionId, delta);
        }

        const reply = await this.sendTurn({ sessionId, providerId, allowedScriptApi: this.getAllowedScriptApi(), signal: options?.signal });
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

        return session;
    }

    async loadSession(sessionId: string): Promise<ChatSessionHydration> {
        const hydration = await this._server().getSession!({ sessionId, hydrateMessages: true });

        this._activeSessionId = hydration.session.id;
        this._sessionState.set(hydration.session.id, {
            syncedCount: Array.isArray(hydration.messages) ? hydration.messages.length : 0,
            providerId: hydration.session.providerId,
            providerContextId: this._normalizeContextId(hydration.session.contextId)
                || this.getProviderRuntimeContextId(hydration.session.providerId),
            viewerContextId: this._normalizeContextId(hydration.session.metadata?.viewerContextId),
        });

        return {
            ...hydration,
            messages: (hydration.messages || []).map((m: ChatMessage) => ({
                ...m,
                createdAt: ensureDate(m.createdAt),
            })),
        };
    }

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
        const normalized = messages.map((m) => ({
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
