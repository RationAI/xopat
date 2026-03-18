export type RpcMethodCaller = (input?: any, options?: { contextId?: string; client?: any }) => Promise<any>;
export type RpcScope = Record<string, RpcMethodCaller>;

export interface ChatServiceOptions {
    getAllowedScriptApi?: (() => AllowedScriptApiManifest | undefined) | undefined;
    serverFactory?: (() => RpcScope) | undefined;
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string | null;
    providers?: ChatProviderClientRegistration[];
}

function ensureDate(value?: Date | string): Date {
    return value instanceof Date ? value : value ? new Date(value) : new Date();
}

export class ChatService {
    _providers: Map<string, ChatProviderClientRegistration>;
    _providerTypes: Map<string, ChatProviderTypeRecord>;
    _authed: Set<string>;
    _personalities: Map<string, ChatPersonality>;
    _currentPersonalityId: string | null;
    _getAllowedScriptApi: (() => AllowedScriptApiManifest | undefined) | undefined;
    _serverFactory: (() => RpcScope) | undefined;
    _activeSessionId: string | null;
    _sessionState: Map<string, { syncedCount: number; providerId: string }>;
    _modelCatalog: Map<string, ChatProviderModelInfo[]>;

    constructor(opts: ChatServiceOptions = {}) {
        this._providers = new Map();
        this._providerTypes = new Map();
        this._authed = new Set();
        this._personalities = new Map();
        this._currentPersonalityId = opts.defaultPersonalityId || null;
        this._getAllowedScriptApi = typeof opts.getAllowedScriptApi === 'function' ? opts.getAllowedScriptApi : undefined;
        this._serverFactory = opts.serverFactory;
        this._activeSessionId = null;
        this._sessionState = new Map();
        this._modelCatalog = new Map();

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

    async listModels(providerId: string, draft?: { providerTypeId?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown>; contextId?: string | null }): Promise<ChatProviderModelInfo[]> {
        const result = providerId
            ? await this._server().listModels!({ providerId })
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

    isAuthenticated(providerId: string): boolean {
        const provider = this.getProvider(providerId);
        if (!provider) return false;
        if (provider.requiresLogin === false) return true;
        return this._authed.has(providerId);
    }

    async login(providerId: string): Promise<void> {
        const provider = this.getProvider(providerId);
        if (!provider) throw new Error(`Unknown provider '${providerId}'.`);
        this._authed.add(providerId);
    }

    getActiveSessionId(): string | null {
        return this._activeSessionId;
    }

    setActiveSessionId(sessionId: string | null): void {
        this._activeSessionId = sessionId;
    }

    async createSession(input: CreateSessionInput): Promise<ChatSession> {
        const personality = input.personalityId ? this._personalities.get(input.personalityId) : this.getCurrentPersonality();
        const session = await this._server().createSession!({
            ...input,
            personalityId: input.personalityId ?? this._currentPersonalityId,
            personalityPrompt: input.personalityPrompt ?? personality?.systemPrompt ?? null,
        });
        if (session.providerId && session.modelId) {
            try {
                await this.ensureModelCapabilities(session.providerId, session.modelId);
            } catch (error) {
                console.warn('Failed to ensure model capabilities:', error);
            }
        }
        this._activeSessionId = session.id;
        this._sessionState.set(session.id, { syncedCount: 0, providerId: session.providerId });
        return session;
    }

    async listSessions(providerId?: string): Promise<ChatSession[]> {
        const result = await this._server().listSessions!({ providerId: providerId || null });
        return result?.sessions || [];
    }

    async loadSession(sessionId: string): Promise<ChatSessionHydration> {
        const hydration = await this._server().getSession!({ sessionId, hydrateMessages: true });
        console.log('hydration', hydration);
        this._activeSessionId = hydration.session.id;
        this._sessionState.set(hydration.session.id, {
            syncedCount: Array.isArray(hydration.messages) ? hydration.messages.length : 0,
            providerId: hydration.session.providerId,
        });
        return {
            ...hydration,
            messages: (hydration.messages || []).map((m: ChatMessage) => ({ ...m, createdAt: ensureDate(m.createdAt) })),
        };
    }

    async renameSession(sessionId: string, title: string): Promise<ChatSession> {
        return this._server().renameSession!({ sessionId, title });
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this._server().deleteSession!({ sessionId });
        this._sessionState.delete(sessionId);
        if (this._activeSessionId === sessionId) this._activeSessionId = null;
    }

    async uploadAttachment(options: {
        sessionId?: string | null;
        file: File | Blob;
        name?: string;
        kind?: 'image' | 'file' | 'screenshot';
        metadata?: Record<string, unknown>;
    }): Promise<ChatAttachmentRecord> {
        const sessionId = options.sessionId || this._activeSessionId;
        if (!sessionId) throw new Error('uploadAttachment requires an active session.');

        const file = options.file;
        const dataUrl = await this._blobToDataUrl(file);
        const mimeType = (file as File).type || 'application/octet-stream';

        return this._server().uploadAttachment!({
            sessionId,
            kind: options.kind || (mimeType.startsWith('image/') ? 'image' : 'file'),
            name: options.name || (file as File).name || 'attachment',
            mimeType,
            dataBase64: dataUrl,
            metadata: options.metadata,
        });
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

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
        const normalized = messages.map((m) => ({
            ...m,
            createdAt: ensureDate(m.createdAt),
            parts: m.parts || (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []),
            content: typeof m.content === 'string' ? m.content : undefined,
        }));
        const result = await this._server().appendMessages!({ sessionId, messages: normalized });
        const state = this._sessionState.get(sessionId);
        const nextCount = (state?.syncedCount || 0) + normalized.length;
        this._sessionState.set(sessionId, { syncedCount: nextCount, providerId: state?.providerId || '' });
        return (result?.messages || []).map((m: ChatMessage) => ({ ...m, createdAt: ensureDate(m.createdAt) }));
    }

    async sendTurn(options?: {
        sessionId?: string | null;
        providerId?: string | null;
        allowedScriptApi?: AllowedScriptApiManifest;
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

        const personality = this.getCurrentPersonality();
        const result = await this._server().sendTurn!({
            sessionId,
            allowedScriptApi: options?.allowedScriptApi || this.getAllowedScriptApi(),
            personalityId: this._currentPersonalityId,
            personalityPrompt: personality?.systemPrompt || null,
        });

        if (result?.capabilities && sessionId) {
            const sessionProviderId = result?.session?.providerId || options?.providerId || null;
            const sessionModelId = result?.session?.modelId || null;
            if (sessionProviderId && sessionModelId) {
                this._updateSingleModelCapabilities(sessionProviderId, sessionModelId, result.capabilities);
            }
        }

        const state = this._sessionState.get(sessionId) || { syncedCount: 0, providerId: result?.session?.providerId || '' };
        this._sessionState.set(sessionId, { ...state, syncedCount: state.syncedCount + 1 });

        const message = result?.message || result;
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
        const next = models.map((m) =>
            m.id === modelId
                ? {
                    ...m,
                    capabilities,
                    supportsImages: capabilities.images === 'supported',
                    supportsFiles: capabilities.files === 'supported',
                    multimodal: capabilities.images === 'supported' || capabilities.files === 'supported',
                }
                : m
        );
        this._modelCatalog.set(providerId, next);
    }

    async ensureModelCapabilities(providerId: string, modelId: string): Promise<ModelCapabilities> {
        const result = await this._server().ensureModelCapabilities!({ providerId, modelId });
        const capabilities = result?.capabilities || {
            text: 'unknown',
            images: 'unknown',
            files: 'unknown',
            source: 'default',
        };
        this._updateSingleModelCapabilities(providerId, modelId, capabilities);
        return capabilities;
    }

    async sendMessage(providerId: string, messages: ChatMessage[]): Promise<ChatMessage> {
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
        const delta = messages.slice(state.syncedCount);
        if (delta.length) {
            await this.appendMessages(sessionId, delta);
        }

        const reply = await this.sendTurn({ sessionId, providerId, allowedScriptApi: this.getAllowedScriptApi() });
        return reply;
    }

    async _blobToDataUrl(blob: Blob): Promise<string> {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
            reader.onload = () => resolve(String(reader.result || ''));
            reader.readAsDataURL(blob);
        });
    }
}
