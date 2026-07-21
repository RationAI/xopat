import type { LanguageModel } from 'ai';

export interface ServerProviderRuntimeContext {
    ctx: any;
    providerId: string;
    providerTypeId: string;
    modelId: string;
    contextId?: string | null;
}

export interface ChatProviderAdapterRuntimeArgs extends ServerProviderRuntimeContext {
    type: ChatProviderTypeRecord;
    instance: ChatProviderInstanceRecord;
    config: Record<string, unknown>;
    secrets: Record<string, unknown>;
}

export interface ChatProviderAdapter {
    id: string;
    listModels?: (args: ChatProviderAdapterRuntimeArgs & { draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }) => Promise<ChatProviderModelInfo[]> | ChatProviderModelInfo[];
    resolveModel: (args: ChatProviderAdapterRuntimeArgs) => Promise<LanguageModel> | LanguageModel;
}

/**
 * Pluggable per-user secret storage (BYOK API keys). Secrets are keyed by a
 * caller scope (see resolveUserScope) and a stable provider key
 * (metadata.managedKey when present, so persistent stores survive the
 * boot-random provider instance ids). The default store is process memory;
 * deployments plug a durable backend via
 * ChatServerRegistry.instance().setUserSecretsStore(...).
 */
export interface ChatUserSecretsStore {
    get(scope: string, providerKey: string): Promise<Record<string, unknown> | null>;
    set(scope: string, providerKey: string, secrets: Record<string, unknown>): Promise<void>;
    delete(scope: string, providerKey: string): Promise<void>;
}

/**
 * Storage scope for per-user secrets. Authenticated callers get a stable
 * identity scope; anonymous callers fall back to the server session so two
 * anonymous browsers can never see each other's keys. Callers must come
 * through requireSession policies, so ctx.session always exists.
 */
export function resolveUserScope(ctx: any): string {
    const userId = ctx?.user?.id;
    if (userId) return `user:${String(userId)}`;
    const sessionId = ctx?.session?.id;
    if (sessionId) return `sess:${String(sessionId)}`;
    throw new Error('Cannot resolve user scope: no authenticated user and no server session.');
}

/**
 * Tolerant scope resolution for cache partitioning: callers without any identity
 * simply get the shared `null` partition rather than an error.
 */
function safeScope(ctx: any): string | null {
    try {
        return resolveUserScope(ctx);
    } catch {
        return null;
    }
}

/**
 * Ownership gate for a provider instance.
 *
 * Anon (no requester id) is allowed to touch only anon-owned providers.
 * Signed-in users may touch only providers they own. Operator-configured
 * instances carry no owner and stay shared with everyone.
 *
 * This lives beside resolveUserScope — and is invoked from getProviderRuntime
 * rather than from each RPC — because call-site enforcement demonstrably does
 * not hold: transcription, vision inference and capability probing each named a
 * client-supplied providerId and reached the secrets without a check.
 */
export function assertProviderAccess(ctx: any, owner: unknown): void {
    // `owner` arrives from free-form instance metadata (Record<string, unknown>),
    // so normalize rather than trust: anything that is not a non-empty string is
    // "unowned". A non-string owner must never compare equal to a requester id.
    const ownerId = typeof owner === 'string' && owner ? owner : null;
    const requester = ctx?.user?.id ?? null;
    if (ownerId && !requester) throw new Error('Provider requires an authenticated user.');
    if (ownerId && ownerId !== String(requester)) throw new Error('Provider does not belong to current user.');
}

/**
 * Coerce a free-form `contexts` metadata value into a clean, de-duped list of
 * context ids. Accepts `string`, `string[]`, or nullish; anything else yields
 * `[]`. Used for the opt-in contextual-availability allow-list on provider
 * types/instances. An empty result means "unrestricted".
 */
export function normalizeContexts(value: unknown): string[] {
    const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
    const out: string[] = [];
    for (const entry of raw) {
        const id = typeof entry === 'string' ? entry.trim() : '';
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}

/**
 * Contextual-availability gate for a provider instance.
 *
 * A provider may declare `metadata.contexts: string[]` (secure-config only) to
 * restrict its resolution to a named allow-list of auth/deployment contexts.
 * Absent/empty ⇒ unrestricted (legacy behavior). When present, the request's
 * verified context (`ctx.contextId`) must be in the list.
 *
 * Trust: `ctx.contextId` is the client-supplied context the RPC runtime ran the
 * `rpcVerifiers.<contextId>` gate against — but the runtime only *runs* that gate
 * when a verifier is actually configured for the context; otherwise a
 * requireSession RPC is accepted on the session alone and `ctx.contextId` is a
 * bare, forgeable claim. So we additionally require the context to be
 * verifier-backed (readable from `ctx.secure`, which is `server.secure`) and
 * degrade closed when it is not. This keeps the gate reliable without a
 * core-server change.
 *
 * Lives in getProviderRuntime for the same reason as assertProviderAccess: it is
 * the single credential-dispensing chokepoint, so call-site enforcement cannot
 * be forgotten.
 */
export function assertProviderContext(ctx: any, instance: any, type: any): void {
    const allowed = normalizeContexts(instance?.metadata?.contexts ?? type?.metadata?.contexts);
    if (!allowed.length) return; // unrestricted → legacy behavior
    const current = typeof ctx?.contextId === 'string' && ctx.contextId ? ctx.contextId : null;
    if (!current || !allowed.includes(current)) {
        throw new Error('Provider is not available in the current context.');
    }
    // Own-property lookup only: a claimed contextId like "__proto__" must not
    // walk to Object.prototype and appear "configured".
    const verifiers = (ctx?.secure?.rpcVerifiers || ctx?.secure?.rpcAuth || {}) as Record<string, any>;
    const entry = Object.prototype.hasOwnProperty.call(verifiers, current) ? verifiers[current] : null;
    const hasVerifiers = !!(entry && entry.verifiers && typeof entry.verifiers === 'object'
        && Object.keys(entry.verifiers).length > 0);
    if (!hasVerifiers) {
        throw new Error(`Provider context '${current}' is not verifier-backed; refusing to resolve.`);
    }
}

export interface ChatSessionStore {
    createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession>;
    updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession>;
    getSession(sessionId: string): Promise<ChatSession | null>;
    listSessions(args?: { providerId?: string; userId?: string | null }): Promise<ChatSession[]>;
    deleteSession(sessionId: string): Promise<void>;
    appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]>;
    listMessages(sessionId: string): Promise<ChatMessage[]>;
    uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord>;
    listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]>;
}

function uid(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeField(field: ChatProviderConfigField): ChatProviderConfigField {
    return {
        ...field,
        options: Array.isArray(field.options) ? field.options.map((opt) => ({ ...opt })) : undefined,
    };
}

function clone(value: Record<string, unknown> | undefined | null): Record<string, unknown> {
    return value ? { ...value } : {};
}

function normalizeSecretsPatch(current: Record<string, unknown>, patch?: Record<string, unknown>): Record<string, unknown> {
    if (!patch) return { ...current };
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (value === null || value === '') {
            delete next[key];
            continue;
        }
        next[key] = value;
    }
    return next;
}

class InMemoryChatSessionStore implements ChatSessionStore {
    sessions = new Map<string, ChatSession>();
    messages = new Map<string, ChatMessage[]>();
    attachments = new Map<string, ChatAttachmentRecord[]>();

    async createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession> {
        const now = new Date().toISOString();
        const session: ChatSession = {
            ...input,
            createdAt: now,
            updatedAt: now,
            summary: input.summary || '',
        };
        this.sessions.set(session.id, session);
        this.messages.set(session.id, []);
        this.attachments.set(session.id, []);
        return session;
    }

    async updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession> {
        const current = this.sessions.get(sessionId);
        if (!current) throw new Error(`Unknown session '${sessionId}'.`);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        this.sessions.set(sessionId, next);
        return next;
    }

    async getSession(sessionId: string): Promise<ChatSession | null> {
        return this.sessions.get(sessionId) || null;
    }

    async listSessions(args?: { providerId?: string; userId?: string | null }): Promise<ChatSession[]> {
        let items = Array.from(this.sessions.values());
        if (args?.providerId) items = items.filter((s) => s.providerId === args.providerId);
        // ACL: when the caller supplies `userId` (including explicit null), we
        // match the owner *exactly*. The old `owner === null || owner === id`
        // shortcut leaked anon-owned sessions to every signed-in user and the
        // omitted-filter branch leaked every session to anon callers — that
        // was the original cross-user disclosure bug. `undefined` still means
        // "no ACL filter" so server-internal callers can opt out explicitly.
        if (args && "userId" in args) {
            const wanted = args.userId ?? null;
            items = items.filter((s) => ((s.metadata?.userId ?? null) as string | null) === wanted);
        }
        return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }

    async deleteSession(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
        this.messages.delete(sessionId);
        this.attachments.delete(sessionId);
    }

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`Unknown session '${sessionId}'.`);
        const existing = this.messages.get(sessionId) || [];
        // Idempotent by id: a retried request whose earlier attempt already
        // persisted these messages (e.g. a sendTurn delta that failed after the
        // append) must not double-append. Only newly stored messages are returned.
        const existingIds = new Set(existing.map((m) => m.id).filter(Boolean));
        const normalized: ChatMessage[] = [];
        for (const m of messages) {
            const id = m.id || uid('msg');
            if (existingIds.has(id)) continue;
            existingIds.add(id);
            normalized.push({
                ...m,
                id,
                sessionId,
                createdAt: typeof m.createdAt === 'string' || m.createdAt instanceof Date ? m.createdAt : new Date().toISOString(),
            });
        }
        existing.push(...normalized);
        this.messages.set(sessionId, existing);
        this.sessions.set(sessionId, { ...session, updatedAt: new Date().toISOString() });
        return normalized;
    }

    async listMessages(sessionId: string): Promise<ChatMessage[]> {
        return [...(this.messages.get(sessionId) || [])];
    }

    async uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord> {
        const session = this.sessions.get(record.sessionId);
        if (!session) throw new Error(`Unknown session '${record.sessionId}'.`);
        const existing = this.attachments.get(record.sessionId) || [];
        existing.push(record);
        this.attachments.set(record.sessionId, existing);
        this.sessions.set(record.sessionId, { ...session, updatedAt: new Date().toISOString() });
        return record;
    }

    async listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]> {
        return [...(this.attachments.get(sessionId) || [])];
    }
}

interface ProviderInstanceStored extends Omit<ChatProviderInstanceRecord, 'config' | 'hasSecretOverrides' | 'hasSecretDefaults' | 'secretKeys'> {
    configOverrides: Record<string, unknown>;
}

/**
 * Default (process-memory) BYOK secret store — bounded on purpose.
 *
 * These entries hold PLAINTEXT API keys, and anonymous callers key by
 * `sess:<id>`, so an unbounded map means every anonymous session that ever set
 * a key retains its secret for the life of the process. Entries therefore expire
 * and the map is capped; a durable/managed backend can be plugged in via
 * setUserSecretsStore and is unaffected by these limits.
 */
class InMemoryUserSecretsStore implements ChatUserSecretsStore {
    private secrets = new Map<string, { value: Record<string, unknown>; at: number }>();

    private static readonly TTL_MS = 12 * 60 * 60 * 1000;
    private static readonly MAX_ENTRIES = 500;

    private key(scope: string, providerKey: string): string {
        return `${scope}::${providerKey}`;
    }

    /** Drop expired entries, then evict oldest-touched until back under the cap. */
    private sweep(): void {
        const now = Date.now();
        for (const [k, v] of this.secrets) {
            if (now - v.at > InMemoryUserSecretsStore.TTL_MS) this.secrets.delete(k);
        }
        // Map iterates in insertion order and get()/set() re-insert on touch,
        // so the front of the map is the least-recently-used entry.
        while (this.secrets.size > InMemoryUserSecretsStore.MAX_ENTRIES) {
            const oldest = this.secrets.keys().next();
            if (oldest.done) break;
            this.secrets.delete(oldest.value);
        }
    }

    async get(scope: string, providerKey: string): Promise<Record<string, unknown> | null> {
        const k = this.key(scope, providerKey);
        const entry = this.secrets.get(k);
        if (!entry) return null;
        if (Date.now() - entry.at > InMemoryUserSecretsStore.TTL_MS) {
            this.secrets.delete(k);
            return null;
        }
        // Touch: re-insert at the back so this key is not the next evicted.
        this.secrets.delete(k);
        this.secrets.set(k, { value: entry.value, at: Date.now() });
        return { ...entry.value };
    }

    async set(scope: string, providerKey: string, secrets: Record<string, unknown>): Promise<void> {
        const k = this.key(scope, providerKey);
        this.secrets.delete(k);
        this.secrets.set(k, { value: { ...secrets }, at: Date.now() });
        this.sweep();
    }

    async delete(scope: string, providerKey: string): Promise<void> {
        this.secrets.delete(this.key(scope, providerKey));
    }
}

class ChatServerRegistry {
    private static _instance: ChatServerRegistry | undefined;
    private providerTypes = new Map<string, ChatProviderTypeRecord>();
    private providerAdapters = new Map<string, ChatProviderAdapter>();
    private providerInstances = new Map<string, ProviderInstanceStored>();
    private providerSecrets = new Map<string, Record<string, unknown>>();
    private personalities = new Map<string, ChatPersonality>();
    private sessionStore: ChatSessionStore = new InMemoryChatSessionStore();
    private userSecretsStore: ChatUserSecretsStore = new InMemoryUserSecretsStore();

    static instance(): ChatServerRegistry {
        const globalKey = '__XOPAT_CHAT_SERVER_REGISTRY__';
        const globalStore = globalThis as any;

        if (globalStore[globalKey]) {
            this._instance = globalStore[globalKey];
            return this._instance;
        }

        if (!this._instance) this._instance = new ChatServerRegistry();
        globalStore[globalKey] = this._instance;
        return this._instance;
    }

    registerAdapter(adapter: ChatProviderAdapter): void {
        if (!adapter?.id) throw new Error('Provider adapter registration is missing id.');
        if (typeof adapter.resolveModel !== 'function') {
            throw new Error(`Provider adapter '${adapter.id}' must implement resolveModel().`);
        }
        this.providerAdapters.set(adapter.id, adapter);
    }

    getAdapter(adapterId: string): ChatProviderAdapter | undefined {
        return this.providerAdapters.get(adapterId);
    }

    upsertProviderType(input: CreateProviderTypeInput | UpdateProviderTypeInput): ChatProviderTypeRecord {
        if (!input?.id) throw new Error('Provider type registration is missing id.');
        if (!input.adapter) throw new Error(`Provider type '${input.id}' is missing adapter.`);
        if (!this.providerAdapters.has(input.adapter)) {
            throw new Error(`Unknown provider adapter '${input.adapter}' for type '${input.id}'.`);
        }

        const current = this.providerTypes.get(input.id);
        const now = new Date().toISOString();
        const next: ChatProviderTypeRecord = {
            id: input.id,
            label: input.label ?? current?.label ?? input.id,
            description: input.description ?? current?.description,
            icon: input.icon ?? current?.icon,
            adapter: input.adapter,
            supportsUploads: input.supportsUploads ?? current?.supportsUploads,
            supportsFiles: input.supportsFiles ?? current?.supportsFiles,
            supportsImages: input.supportsImages ?? current?.supportsImages,
            supportsToolCalls: input.supportsToolCalls ?? current?.supportsToolCalls,
            defaultModelId: input.defaultModelId ?? current?.defaultModelId,
            requiresLogin: input.requiresLogin ?? current?.requiresLogin,
            contextId: input.contextId ?? current?.contextId ?? null,
            authType: input.authType ?? current?.authType ?? null,
            configSchema: Array.isArray(input.configSchema)
                ? input.configSchema.map(normalizeField)
                : current?.configSchema || [],
            fixedConfig: { ...(current?.fixedConfig || {}), ...(input.fixedConfig || {}) },
            // Normalize so empty/null values never register as "a secret exists"
            // (hasSecretDefaults would otherwise lie for e.g. fixedSecrets.apiKey: "").
            // Empty string still deletes, letting operators clear a baked key.
            fixedSecrets: normalizeSecretsPatch(current?.fixedSecrets || {}, input.fixedSecrets),
            metadata: { ...(current?.metadata || {}), ...(input.metadata || {}) },
            source: input.source ?? current?.source ?? 'plugin',
            createdAt: current?.createdAt || now,
            updatedAt: now,
        };

        this.providerTypes.set(next.id, next);
        return next;
    }

    getProviderType(typeId: string): ChatProviderTypeRecord | undefined {
        return this.providerTypes.get(typeId);
    }

    private sanitizeProviderType(record: ChatProviderTypeRecord): ChatProviderTypeClientRecord {
        const schema = (record.configSchema || []).map((field) => ({
            ...field,
            defaultValue: field.secret ? undefined : (field.defaultValue !== undefined ? field.defaultValue : record.fixedConfig?.[field.key]),
        }));

        const { fixedSecrets: _hidden, ...rest } = record;
        return {
            ...rest,
            configSchema: schema,
            fixedConfig: clone(record.fixedConfig),
        };
    }

    listProviderTypes(): ChatProviderTypeClientRecord[] {
        return Array.from(this.providerTypes.values())
            .map((record) => this.sanitizeProviderType(record))
            .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
    }

    private buildInstanceRecord(stored: ProviderInstanceStored): ChatProviderInstanceRecord {
        const type = this.getProviderType(stored.typeId);
        const fixedConfig = clone(type?.fixedConfig);
        const fixedSecrets = clone(type?.fixedSecrets);
        const overrideSecrets = clone(this.providerSecrets.get(stored.id));
        const secretKeys = Array.from(new Set([
            ...Object.keys(fixedSecrets),
            ...Object.keys(overrideSecrets),
        ])).sort();

        return {
            id: stored.id,
            typeId: stored.typeId,
            label: stored.label,
            description: stored.description,
            icon: stored.icon,
            defaultModelId: stored.defaultModelId ?? type?.defaultModelId ?? null,
            requiresLogin: stored.requiresLogin ?? type?.requiresLogin,
            contextId: stored.contextId ?? type?.contextId ?? null,
            authType: stored.authType ?? type?.authType ?? null,
            supportsUploads: stored.supportsUploads ?? type?.supportsUploads,
            supportsFiles: stored.supportsFiles ?? type?.supportsFiles,
            supportsImages: stored.supportsImages ?? type?.supportsImages,
            supportsToolCalls: stored.supportsToolCalls ?? type?.supportsToolCalls,
            config: { ...fixedConfig, ...(stored.configOverrides || {}) },
            metadata: stored.metadata,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            hasSecretOverrides: Object.keys(overrideSecrets).length > 0,
            hasSecretDefaults: Object.keys(fixedSecrets).length > 0,
            secretKeys,
        };
    }

    async createProviderInstance(input: CreateProviderInstanceInput, ownerUserId?: string | null): Promise<ChatProviderInstanceRecord> {
        const type = this.getProviderType(input.typeId);
        if (!type) throw new Error(`Unknown provider type '${input.typeId}'.`);

        const id = uid('prov');
        const now = new Date().toISOString();
        const stored: ProviderInstanceStored = {
            id,
            typeId: input.typeId,
            label: input.label,
            description: input.description,
            icon: input.icon ?? type.icon,
            defaultModelId: input.defaultModelId ?? type.defaultModelId ?? null,
            requiresLogin: input.requiresLogin ?? type.requiresLogin,
            contextId: input.contextId ?? type.contextId ?? null,
            authType: input.authType ?? type.authType ?? null,
            supportsUploads: type.supportsUploads,
            supportsFiles: type.supportsFiles,
            supportsImages: type.supportsImages,
            supportsToolCalls: type.supportsToolCalls,
            configOverrides: clone(input.config),
            metadata: { ...(input.metadata || {}), ownerUserId: ownerUserId ?? null },
            createdAt: now,
            updatedAt: now,
        };
        this.providerInstances.set(id, stored);
        this.providerSecrets.set(id, normalizeSecretsPatch({}, input.secrets));
        return this.buildInstanceRecord(stored);
    }

    async updateProviderInstance(providerId: string, patch: UpdateProviderInstanceInput): Promise<ChatProviderInstanceRecord> {
        const current = this.providerInstances.get(providerId);
        if (!current) throw new Error(`Unknown provider '${providerId}'.`);
        const now = new Date().toISOString();
        const next: ProviderInstanceStored = {
            ...current,
            label: patch.label ?? current.label,
            description: patch.description ?? current.description,
            icon: patch.icon ?? current.icon,
            defaultModelId: patch.defaultModelId ?? current.defaultModelId,
            requiresLogin: patch.requiresLogin ?? current.requiresLogin,
            contextId: patch.contextId ?? current.contextId,
            authType: patch.authType ?? current.authType,
            configOverrides: patch.config ? { ...current.configOverrides, ...patch.config } : current.configOverrides,
            metadata: patch.metadata ? { ...(current.metadata || {}), ...patch.metadata } : current.metadata,
            updatedAt: now,
        };
        this.providerInstances.set(providerId, next);
        if (patch.secrets) {
            const mergedSecrets = normalizeSecretsPatch(this.providerSecrets.get(providerId) || {}, patch.secrets);
            this.providerSecrets.set(providerId, mergedSecrets);
        }
        this.invalidateModelListCache(providerId);
        return this.buildInstanceRecord(next);
    }

    async getProviderInstance(providerId: string): Promise<ChatProviderInstanceRecord | null> {
        const current = this.providerInstances.get(providerId);
        return current ? this.buildInstanceRecord(current) : null;
    }

    async listProviderInstances(args?: { userId?: string | null; typeId?: string | null }): Promise<ChatProviderClientRegistration[]> {
        let items = Array.from(this.providerInstances.values());
        if (args?.typeId) items = items.filter((p) => p.typeId === args.typeId);
        // ACL: same shape as listSessions — explicit `userId` (incl. null)
        // means exact-match on the stored owner. `undefined` means no filter.
        if (args && "userId" in args) {
            const wanted = args.userId ?? null;
            items = items.filter((p) => ((p.metadata?.ownerUserId ?? null) as string | null) === wanted);
        }
        return items
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .map((item) => this.buildInstanceRecord(item));
    }

    async deleteProviderInstance(providerId: string): Promise<void> {
        this.providerInstances.delete(providerId);
        this.providerSecrets.delete(providerId);
        this.invalidateModelListCache(providerId);
    }

    getUserSecretsStore(): ChatUserSecretsStore {
        return this.userSecretsStore;
    }

    setUserSecretsStore(store: ChatUserSecretsStore): void {
        this.userSecretsStore = store;
    }

    /**
     * Stable identity of a provider for user-secret storage. Managed instances
     * get a fresh random id every boot, but their metadata.managedKey
     * (`pluginId:typeId:default`) is deterministic — persistent stores must
     * key by it or orphan every stored key on restart.
     */
    private userSecretsKey(providerId: string): string {
        const stored = this.providerInstances.get(providerId);
        const managedKey = stored?.metadata?.managedKey;
        return managedKey ? String(managedKey) : providerId;
    }

    async getUserSecrets(scope: string, providerId: string): Promise<Record<string, unknown>> {
        const value = await this.userSecretsStore.get(scope, this.userSecretsKey(providerId));
        return value ? { ...value } : {};
    }

    async patchUserSecrets(scope: string, providerId: string, patch: Record<string, unknown>): Promise<string[]> {
        const providerKey = this.userSecretsKey(providerId);
        const current = (await this.userSecretsStore.get(scope, providerKey)) || {};
        const next = normalizeSecretsPatch(current, patch);
        if (Object.keys(next).length === 0) {
            await this.userSecretsStore.delete(scope, providerKey);
            this.invalidateModelListCache(providerId);
            return [];
        }
        await this.userSecretsStore.set(scope, providerKey, next);
        this.invalidateModelListCache(providerId);
        return Object.keys(next).sort();
    }

    async clearUserSecrets(scope: string, providerId: string): Promise<void> {
        await this.userSecretsStore.delete(scope, this.userSecretsKey(providerId));
        this.invalidateModelListCache(providerId);
    }

    /**
     * Resolve a provider's type, config and SECRETS.
     *
     * `ctx` is mandatory: this is the accessor that dispenses credentials, so the
     * ownership gate belongs here rather than in each caller. Passing the caller
     * context is what makes the check unforgettable — a new call site cannot
     * compile without supplying one.
     */
    async getProviderRuntime(providerId: string, opts: { ctx: any; userScope?: string | null }): Promise<{ type: ChatProviderTypeRecord; instance: ChatProviderInstanceRecord; config: Record<string, unknown>; secrets: Record<string, unknown> }> {
        const stored = this.providerInstances.get(providerId);
        if (!stored) throw new Error(`Unknown provider '${providerId}'.`);
        assertProviderAccess(opts?.ctx, stored.metadata?.ownerUserId ?? null);
        const type = this.getProviderType(stored.typeId);
        if (!type) throw new Error(`Unknown provider type '${stored.typeId}'.`);
        // Contextual-availability gate: restricted providers resolve only in
        // their verifier-backed allow-list contexts. No-op when unrestricted.
        assertProviderContext(opts?.ctx, stored, type);
        const instance = this.buildInstanceRecord(stored);
        const userSecrets = opts?.userScope ? await this.getUserSecrets(opts.userScope, providerId) : {};
        return {
            type,
            instance,
            config: { ...(type.fixedConfig || {}), ...(stored.configOverrides || {}) },
            // User-provided secrets win: their key, their quota.
            secrets: { ...(type.fixedSecrets || {}), ...(this.providerSecrets.get(providerId) || {}), ...userSecrets },
        };
    }

    /**
     * Upstream model-discovery cache. Chat-interface init fans several
     * listModels calls at the same provider within seconds; each was a real
     * upstream /models round-trip. Raw adapter results are cached per
     * (providerId, userScope) for a short TTL and concurrent callers share the
     * in-flight fetch. Capability merging stays OUTSIDE the cache — probe
     * verdicts may change between calls. Invalidated on any provider or
     * user-secret mutation.
     */
    private modelListCache = new Map<string, { at: number; models: ChatProviderModelInfo[] }>();
    private modelListInFlight = new Map<string, Promise<ChatProviderModelInfo[]>>();
    private static MODEL_LIST_TTL_MS = 60_000;

    invalidateModelListCache(providerId?: string): void {
        if (!providerId) {
            this.modelListCache.clear();
            this.modelListInFlight.clear();
            return;
        }
        for (const key of [...this.modelListCache.keys()]) {
            if (key.startsWith(`${providerId} `)) this.modelListCache.delete(key);
        }
        for (const key of [...this.modelListInFlight.keys()]) {
            if (key.startsWith(`${providerId} `)) this.modelListInFlight.delete(key);
        }
    }

    async listModels(providerId: string, args: { ctx: any; contextId?: string | null; userScope?: string | null }): Promise<ChatProviderModelInfo[]> {
        const runtime = await this.getProviderRuntime(providerId, { ctx: args.ctx, userScope: args.userScope ?? null });
        const adapter = this.getAdapter(runtime.type.adapter);
        if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

        if (adapter.listModels) {
            const cacheKey = `${providerId} ${args.userScope ?? ''}`;
            let rawModels: ChatProviderModelInfo[] | undefined;

            const cached = this.modelListCache.get(cacheKey);
            if (cached && (Date.now() - cached.at) < ChatServerRegistry.MODEL_LIST_TTL_MS) {
                rawModels = cached.models;
            } else {
                let pending = this.modelListInFlight.get(cacheKey);
                if (!pending) {
                    pending = Promise.resolve(adapter.listModels({
                        ...args,
                        providerId: runtime.instance.id,
                        providerTypeId: runtime.type.id,
                        modelId: runtime.instance.defaultModelId || runtime.type.defaultModelId || '',
                        type: runtime.type,
                        instance: runtime.instance,
                        config: runtime.config,
                        secrets: runtime.secrets,
                    })).then((models) => {
                        const list = models || [];
                        this.modelListCache.set(cacheKey, { at: Date.now(), models: list });
                        return list;
                    }).finally(() => {
                        this.modelListInFlight.delete(cacheKey);
                    });
                    this.modelListInFlight.set(cacheKey, pending);
                }
                rawModels = await pending;
            }

            return (rawModels || []).map((model) =>
                this.mergeModelCapabilities(providerId, model, model.capabilities || null, args.userScope ?? null)
            );
        }

        if (runtime.instance.defaultModelId || runtime.type.defaultModelId) {
            const id = runtime.instance.defaultModelId || runtime.type.defaultModelId!;
            return [
                this.mergeModelCapabilities(providerId, {
                    id,
                    label: id,
                }, null, args.userScope ?? null)
            ];
        }

        return [];
    }

    async previewListModels(typeId: string, args: { ctx: any; contextId?: string | null; draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }): Promise<ChatProviderModelInfo[]> {
        const type = this.getProviderType(typeId);
        if (!type) throw new Error(`Unknown provider type '${typeId}'.`);
        const adapter = this.getAdapter(type.adapter);
        if (!adapter) throw new Error(`Unknown provider adapter '${type.adapter}'.`);
        if (!adapter.listModels) return [];


        const instance: ChatProviderInstanceRecord = {
            id: `draft_${type.id}`,
            typeId: type.id,
            label: type.label,
            description: type.description,
            icon: type.icon,
            defaultModelId: type.defaultModelId ?? null,
            requiresLogin: type.requiresLogin,
            contextId: args.contextId ?? type.contextId ?? null,
            authType: type.authType ?? null,
            supportsUploads: type.supportsUploads,
            supportsFiles: type.supportsFiles,
            supportsImages: type.supportsImages,
            supportsToolCalls: type.supportsToolCalls,
            config: { ...(type.fixedConfig || {}), ...(args.draftConfig || {}) },
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            hasSecretOverrides: !!args.draftSecrets && Object.keys(args.draftSecrets).length > 0,
            hasSecretDefaults: !!type.fixedSecrets && Object.keys(type.fixedSecrets).length > 0,
            secretKeys: Array.from(new Set([
                ...Object.keys(type.fixedSecrets || {}),
                ...Object.keys(args.draftSecrets || {}),
            ])).sort(),
        };

        const models = await adapter.listModels({
            ...args,
            providerId: instance.id,
            providerTypeId: type.id,
            modelId: instance.defaultModelId || '',
            type,
            instance,
            config: { ...(type.fixedConfig || {}), ...(args.draftConfig || {}) },
            secrets: { ...(type.fixedSecrets || {}), ...(args.draftSecrets || {}) },
            draftConfig: args.draftConfig,
            draftSecrets: args.draftSecrets,
        });

        // The draft id is synthetic and shared by every caller, while the probe
        // ran against THIS caller's draftSecrets — so the verdict must be cached
        // under their scope, never in the shared partition.
        return (models || []).map((model) =>
            this.mergeModelCapabilities(instance.id, model, model.capabilities || null, safeScope(args.ctx))
        );
    }

    registerPersonality(personality: ChatPersonality): void {
        if (!personality?.id) throw new Error('Personality registration is missing id.');
        this.personalities.set(personality.id, personality);
    }

    getPersonality(personalityId?: string | null): ChatPersonality | undefined {
        return personalityId ? this.personalities.get(personalityId) : undefined;
    }

    listPersonalities(): ChatPersonality[] {
        return Array.from(this.personalities.values());
    }

    getSessionStore(): ChatSessionStore {
        return this.sessionStore;
    }

    setSessionStore(store: ChatSessionStore): void {
        this.sessionStore = store;
    }

    /**
     * Drop cached capabilities. Narrows by whichever parts are supplied:
     * a `scope` clears only that caller's entries, so one user rotating their
     * BYOK key cannot wipe everyone else's cache.
     */
    clearModelCapabilities(providerId: string, modelId?: string, scope?: string | null): void {
        const prefix = modelId ? `${providerId}::${modelId}::` : `${providerId}::`;
        const suffix = scope ? `::${scope}` : null;
        for (const key of this.modelCapabilities.keys()) {
            if (!key.startsWith(prefix)) continue;
            if (suffix && !key.endsWith(suffix)) continue;
            this.modelCapabilities.delete(key);
        }
    }

    async hydrateSession(sessionId: string): Promise<ChatSessionHydration> {
        const session = await this.sessionStore.getSession(sessionId);
        if (!session) throw new Error(`Unknown session '${sessionId}'.`);
        const [messages, attachments] = await Promise.all([
            this.sessionStore.listMessages(sessionId),
            this.sessionStore.listAttachments(sessionId),
        ]);
        return { session, messages, attachments };
    }

    private modelCapabilities = new Map<string, ModelCapabilities>();

    /**
     * Capabilities are probed with the CALLER's BYOK key, so the verdict is
     * per-caller and the cache key must be too — otherwise one user's probe
     * result is served to everyone else.
     */
    private modelCapabilityKey(providerId: string, modelId: string, scope: string | null): string {
        return `${providerId}::${modelId}::${scope ?? '-'}`;
    }

    getModelCapabilities(providerId: string, modelId: string, scope?: string | null): ModelCapabilities | null {
        return this.modelCapabilities.get(this.modelCapabilityKey(providerId, modelId, scope ?? null)) || null;
    }

    setModelCapabilities(providerId: string, modelId: string, capabilities: ModelCapabilities, scope?: string | null): ModelCapabilities {
        const next: ModelCapabilities = {
            text: capabilities.text || 'unknown',
            images: capabilities.images || 'unknown',
            files: capabilities.files || 'unknown',
            source: capabilities.source || 'default',
            checkedAt: capabilities.checkedAt || new Date().toISOString(),
        };
        this.modelCapabilities.set(this.modelCapabilityKey(providerId, modelId, scope ?? null), next);
        return next;
    }

    mergeModelCapabilities(
        providerId: string,
        model: ChatProviderModelInfo,
        discovered?: ModelCapabilities | null,
        scope?: string | null
    ): ChatProviderModelInfo {
        const cached = this.getModelCapabilities(providerId, model.id, scope ?? null);
        const capabilities = cached || discovered || {
            text: 'unknown',
            images: 'unknown',
            files: 'unknown',
            source: 'default',
            checkedAt: undefined,
        };

        return {
            ...model,
            capabilities,
            multimodal: capabilities.images === 'supported' || capabilities.files === 'supported',
            supportsImages: capabilities.images === 'supported',
            supportsFiles: capabilities.files === 'supported',
        };
    }

    newId(prefix: string): string {
        return uid(prefix);
    }
}

export { ChatServerRegistry, InMemoryChatSessionStore, InMemoryUserSecretsStore };
