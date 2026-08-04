import type { LanguageModel } from 'ai';
import type { TranscriptionModelV3 } from '@ai-sdk/provider';

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

/**
 * Result of resolving a transcription-capable model from an adapter.
 * Returning a bare {@link TranscriptionModelV3} is equivalent to
 * `{ model }` with the default providerOptions namespace.
 *
 * Typed against the provider-spec v3 interface; spec v4 models (from provider
 * packages on the newer `@ai-sdk/provider` major) are accepted at runtime —
 * the two are structurally identical, only the discriminant differs.
 */
export interface ResolvedTranscriptionModel {
    model: TranscriptionModelV3;
    /**
     * providerOptions namespace for whisper-style hints ({language, prompt}).
     * Defaults to `model.provider` — override when the SDK package reads its
     * options under a different key (e.g. `@ai-sdk/openai` transcription models
     * report provider 'openai.transcription' but read options under 'openai').
     */
    providerOptionsName?: string;
}

export interface ChatProviderAdapter {
    id: string;
    listModels?: (args: ChatProviderAdapterRuntimeArgs & { draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }) => Promise<ChatProviderModelInfo[]> | ChatProviderModelInfo[];
    resolveModel: (args: ChatProviderAdapterRuntimeArgs) => Promise<LanguageModel> | LanguageModel;
    /**
     * OPTIONAL transcription capability. Resolved through the same
     * getProviderRuntime chokepoint as resolveModel, so config/secrets arrive
     * already access- and context-gated. Absence means the provider cannot
     * transcribe — there is deliberately no fallback transport in core.
     */
    resolveTranscriptionModel?: (args: ChatProviderAdapterRuntimeArgs) =>
        Promise<TranscriptionModelV3 | ResolvedTranscriptionModel> | TranscriptionModelV3 | ResolvedTranscriptionModel;
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
    /**
     * Drop EVERY secret held under one scope.
     *
     * A persistent store MUST implement this. It is how an anonymous `sess:`
     * scope is emptied when the browser session changes hands (a shared
     * workstation where one user signs in after another) — without it, the next
     * principal on that browser inherits the previous one's API key.
     */
    deleteScope?(scope: string): Promise<void>;
}

/**
 * The caller's principal — `user:<id>` when authenticated, `sess:<id>` for an
 * anonymous-but-tracked browser. Used for BYOK scoping AND for ownership.
 *
 * Core owns the derivation (`XOPAT_SERVER.resolvePrincipal`), which is what makes
 * `user:` actually reachable: verifiers hand core a raw claim payload and core
 * maps `sub`/`oid`/`email` onto a stable `id`. Before that existed, every caller
 * silently collapsed to `sess:`, so a BYOK key belonged to a browser cookie
 * rather than to a person.
 *
 * THROWS when neither exists — a request with no principal is unauthorized and
 * must never fall through to a shared bucket.
 */
export function resolveUserScope(ctx: any): string {
    const XS = (globalThis as any).XOPAT_SERVER;
    if (typeof XS?.resolvePrincipal === 'function') return XS.resolvePrincipal(ctx);
    // Legacy core (no principal support): same semantics, derived locally.
    if (typeof ctx?.principal === 'string' && ctx.principal) return ctx.principal;
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

/** True for a principal tied to a browser session rather than to a person. */
export function isAnonymousScope(scope: string | null | undefined): boolean {
    return typeof scope === 'string' && scope.startsWith('sess:');
}

/**
 * Ownership gate for a provider instance.
 *
 * A user-created provider is owned by the PRINCIPAL that created it, and only
 * that principal may touch it. Operator-configured instances carry no owner and
 * stay shared with everyone (that is what makes a service-provided key work).
 *
 * This lives beside resolveUserScope — and is invoked from getProviderRuntime
 * rather than from each RPC — because call-site enforcement demonstrably does
 * not hold: transcription, vision inference and capability probing each named a
 * client-supplied providerId and reached the secrets without a check.
 */
export const CHAT_ERR_ACCESS_DENIED = 'CHAT_PROVIDER_ACCESS_DENIED';
export const CHAT_ERR_CONTEXT_DENIED = 'CHAT_PROVIDER_CONTEXT_DENIED';

/** A provider was refused on ownership or on its auth context. Carries a `code`. */
export class ChatProviderAccessError extends Error {
    code: string;
    /** The underlying core `RPC_AUTH_CONTEXT_*` code, when the refusal came from one. */
    contextCode?: string;
    override cause?: any;
    constructor(message: string, code: string, cause?: any) {
        super(message);
        this.name = 'ChatProviderAccessError';
        this.code = code;
        this.cause = cause;
        if (cause?.code) this.contextCode = String(cause.code);
    }
}

/**
 * The sanctioned way to recognise the above — **never `instanceof`**.
 *
 * The server-module loader bundles each `*.server.ts` entry independently
 * (`inference.server.mjs` inlines its own copy of this file), so the class object
 * differs per bundle and `instanceof` is silently `false` across them. That is the
 * same reason the registry state hangs off `globalThis`.
 */
export function isProviderAccessError(e: any): boolean {
    return e?.code === CHAT_ERR_ACCESS_DENIED || e?.code === CHAT_ERR_CONTEXT_DENIED;
}

/**
 * Where a provider record came from. Server-assigned, never settable from RPC
 * input — sharing is now a positive assertion rather than the absence of an owner.
 *
 *  - `"operator"`: created through the server-internal registration path. Readable
 *    by everyone (that is what makes a service-provided key work), writable by no
 *    RPC, ever.
 *  - `"user"`: created by a caller. Readable and writable only by that principal.
 *
 * Legacy records predate the field, so derive it: an owned record is a user
 * record, an unowned one is the operator's.
 */
export function providerOrigin(rec: any): 'operator' | 'user' {
    if (rec?.origin === 'operator' || rec?.origin === 'user') return rec.origin;
    return ownerPrincipalOf(rec) ? 'user' : 'operator';
}

/** The record's owner principal, normalized. Free-form metadata — never trusted raw. */
function ownerPrincipalOf(rec: any): string | null {
    const owner = rec?.metadata?.ownerPrincipal;
    return typeof owner === 'string' && owner ? owner : null;
}

/**
 * READ gate. Operator records are shared on purpose; a user record is private.
 *
 * Note there is deliberately no early `return` for "unowned" here, and none in
 * `assertProviderWrite` either. The predecessor of these two functions,
 * `assertProviderAccess`, opened with `if (!ownerPrincipal) return;` — a
 * default-allow branch inside a function whose name promised denial, silently
 * inherited by every call site. Because operator records are unowned by design,
 * that one line meant "shared for reading" also granted "writable by anyone".
 */
export function assertProviderRead(ctx: any, rec: any): void {
    if (providerOrigin(rec) === 'operator') return;
    const owner = ownerPrincipalOf(rec);
    const requester = safeScope(ctx);
    if (!requester) {
        throw new ChatProviderAccessError('Provider requires an identified caller.', CHAT_ERR_ACCESS_DENIED);
    }
    if (owner !== requester) {
        throw new ChatProviderAccessError('Provider does not belong to current user.', CHAT_ERR_ACCESS_DENIED);
    }
}

/** WRITE gate. Only a user record, only its own principal. Operator records are immutable via RPC. */
export function assertProviderWrite(ctx: any, rec: any): void {
    if (providerOrigin(rec) === 'operator') {
        throw new ChatProviderAccessError(
            'Provider is operator-managed and cannot be modified through the API.', CHAT_ERR_ACCESS_DENIED);
    }
    const owner = ownerPrincipalOf(rec);
    const requester = safeScope(ctx);
    if (!requester) {
        throw new ChatProviderAccessError('Provider requires an identified caller.', CHAT_ERR_ACCESS_DENIED);
    }
    if (owner !== requester) {
        throw new ChatProviderAccessError('Provider does not belong to current user.', CHAT_ERR_ACCESS_DENIED);
    }
}

/**
 * @deprecated Use {@link assertProviderRead} / {@link assertProviderWrite}. Kept
 * as a read-gate alias so an out-of-tree caller does not silently lose its check.
 */
export function assertProviderAccess(ctx: any, owner: unknown): void {
    assertProviderRead(ctx, { metadata: { ownerPrincipal: owner } });
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

let _degradedContextGateWarned = false;
let _mainContextFallbackWarned = false;

/**
 * The viewer's main auth context. Core accepts `"core"`, `"default"` and `""` as
 * spellings of it (see server/node/auth.js `MAIN_RPC_CONTEXT_ALIASES`); these two
 * local helpers mirror that only for the degraded no-core-support path below.
 */
const MAIN_CONTEXT_ID = 'core';
const MAIN_CONTEXT_ALIASES = ['core', '', 'default'];

function normalizeMainContext(contextId: string | null | undefined): string {
    return !contextId || MAIN_CONTEXT_ALIASES.includes(contextId) ? MAIN_CONTEXT_ID : contextId;
}

function lookupLocalVerifierEntry(verifiers: Record<string, any>, contextId: string): any {
    const candidates = !contextId || MAIN_CONTEXT_ALIASES.includes(contextId)
        ? [contextId, ...MAIN_CONTEXT_ALIASES.filter((a) => a !== contextId)]
        : [contextId];
    for (const key of candidates) {
        // hasOwn-only: a claimed "__proto__" must not walk the prototype.
        if (Object.prototype.hasOwnProperty.call(verifiers, key)) return verifiers[key];
    }
    return null;
}

function warnMainContextFallback(): void {
    if (_mainContextFallbackWarned) return;
    _mainContextFallbackWarned = true;
    console.warn(
        `[chat] a provider requires login but declares no auth context; verifying the main ` +
        `('${MAIN_CONTEXT_ID}') context. To gate it more narrowly, set providerDefaults.contexts ` +
        `or providerDefaults.contextId in the plugin's secure config.`
    );
}

/**
 * Contextual-availability gate for a provider instance.
 *
 * **The required context comes from the RESOURCE, never from the request.** A
 * provider declares where it authenticates via `metadata.contexts` (secure-config
 * allow-list), its bound `contextId`, and `requiresLogin`; we then ask core to
 * verify *that* context on this request. `ctx.contextId` is client-supplied and is
 * deliberately never consulted — it is what a caller would forge (or simply omit)
 * to pick a weaker verifier set for its own call.
 *
 * Unrestricted + no-login providers return `null` and verify nothing. That is the
 * out-of-the-box path: a keyless or BYOK-only provider stays reachable on a
 * deployment with no auth configured at all.
 *
 * Lives in getProviderRuntime for the same reason as assertProviderAccess: it is
 * the single credential-dispensing chokepoint, so call-site enforcement cannot
 * be forgotten.
 *
 * @returns the verified context id, or `null` when the provider requires none.
 */
export async function requireProviderContext(ctx: any, instance: any, type: any): Promise<string | null> {
    const allowed = normalizeContexts(instance?.metadata?.contexts ?? type?.metadata?.contexts);
    const bound = instance?.contextId ?? type?.contextId ?? null;
    const requiresLogin = (instance?.requiresLogin ?? type?.requiresLogin) === true;

    if (!allowed.length && !requiresLogin) return null;   // unrestricted, no login

    const boundId = typeof bound === 'string' && bound.trim() ? bound.trim() : null;
    // `requiresLogin` with no named context means the viewer's MAIN identity —
    // that is what `authContext: null` means everywhere else in xOpat, and what
    // both chat hosts already default their routing context to. Refusing outright
    // was a dead end, not a control: verifying 'core' still fails closed when the
    // main context is unconfigured, disabled, verifier-less or identity-less.
    const candidates = allowed.length ? allowed : [boundId ?? MAIN_CONTEXT_ID];
    if (!allowed.length && !boundId) warnMainContextFallback();

    const XS = (globalThis as any).XOPAT_SERVER;
    if (typeof XS?.requireRpcAuthContext !== 'function') {
        // Older core without on-demand context verification. Fall back to the
        // previous heuristic (trust ctx.contextId, but only when verifier-backed)
        // so the module still loads — and say so once, because it is weaker.
        if (!_degradedContextGateWarned) {
            _degradedContextGateWarned = true;
            console.warn('[chat] core lacks XOPAT_SERVER.requireRpcAuthContext; ' +
                'provider context gating runs in degraded (request-derived) mode.');
        }
        const claimed = typeof ctx?.contextId === 'string' && ctx.contextId ? ctx.contextId : MAIN_CONTEXT_ID;
        const current = normalizeMainContext(claimed);
        if (!candidates.some((c) => normalizeMainContext(c) === current)) {
            throw new ChatProviderAccessError('Provider is not available in the current context.', CHAT_ERR_CONTEXT_DENIED);
        }
        const verifiers = (ctx?.secure?.rpcVerifiers || ctx?.secure?.rpcAuth || {}) as Record<string, any>;
        const entry = lookupLocalVerifierEntry(verifiers, claimed);
        const hasVerifiers = !!(entry && entry.verifiers
            && (Array.isArray(entry.verifiers) ? entry.verifiers.length : Object.keys(entry.verifiers).length) > 0);
        if (!hasVerifiers) {
            throw new ChatProviderAccessError(
                `Provider context '${current}' is not verifier-backed; refusing to resolve.`, CHAT_ERR_CONTEXT_DENIED);
        }
        return current;
    }

    let firstError: any = null;
    for (const candidate of candidates) {
        try {
            const verified = await XS.requireRpcAuthContext(ctx, candidate);
            return verified.contextId;
        } catch (e) {
            firstError = firstError || e;
        }
    }
    throw new ChatProviderAccessError(
        firstError?.message || 'Provider is not available in the current context.',
        CHAT_ERR_CONTEXT_DENIED,
        firstError
    );
}

export interface ChatSessionStore {
    createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession>;
    updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession>;
    getSession(sessionId: string): Promise<ChatSession | null>;
    /**
     * `ownerPrincipal` is the CALLER's principal, resolved server-side. Never
     * accept an identity from request input here — that was the original
     * cross-user disclosure. Omit the key only for server-internal listings.
     */
    listSessions(args?: { providerId?: string; ownerPrincipal?: string | null }): Promise<ChatSession[]>;
    deleteSession(sessionId: string): Promise<void>;
    appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]>;
    listMessages(sessionId: string): Promise<ChatMessage[]>;
    uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord>;
    listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]>;
}

// Chat session ids are ACL subjects, so they must not be guessable —
// crypto-random, not Math.random.
function uid(prefix: string) {
    const rand = typeof (globalThis as any).crypto?.randomUUID === 'function'
        ? (globalThis as any).crypto.randomUUID().replace(/-/g, '')
        : require('node:crypto').randomBytes(16).toString('hex');
    return `${prefix}_${Date.now().toString(36)}_${rand}`;
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

    async listSessions(args?: { providerId?: string; ownerPrincipal?: string | null }): Promise<ChatSession[]> {
        let items = Array.from(this.sessions.values());
        if (args?.providerId) items = items.filter((s) => s.providerId === args.providerId);
        // ACL: match the owner PRINCIPAL exactly. Callers pass their own principal,
        // derived server-side — never a caller-supplied identity, and never null:
        // `null` is not an owner, it is "unowned", and unowned records belong to
        // nobody and are listed to nobody. Omitting the key entirely is the only
        // opt-out and is reserved for server-internal callers.
        if (args && "ownerPrincipal" in args) {
            const wanted = args.ownerPrincipal ?? null;
            items = wanted === null
                ? []
                : items.filter((s) => ((s.metadata?.ownerPrincipal ?? null) as string | null) === wanted);
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
    /** Server-assigned trust tier — see {@link providerOrigin}. Never from RPC input. */
    origin?: 'operator' | 'user';
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

    async deleteScope(scope: string): Promise<void> {
        const prefix = `${scope}::`;
        for (const k of [...this.secrets.keys()]) {
            if (k.startsWith(prefix)) this.secrets.delete(k);
        }
    }
}

/**
 * Everything the registry must keep across a module hot-reload.
 *
 * This is deliberately PLAIN STATE with no methods. Module `*.server.ts` files
 * are re-imported whenever their mtime changes while the Node process keeps
 * running, so every reload mints a brand-new `ChatServerRegistry` class. Parking
 * an *instance* on `globalThis` (as this used to) therefore froze the class from
 * whichever reload happened to run first, and the next reload's code calling a
 * newly-added method on it died with `… is not a function` — taking down every
 * chat RPC, because `getRegistry()` is the first line of nearly all of them.
 *
 * Persisting state instead of behaviour removes the whole bug class: the class is
 * always the freshly-loaded one, the data outlives it.
 */
interface ChatRegistryState {
    providerTypes: Map<string, ChatProviderTypeRecord>;
    providerAdapters: Map<string, ChatProviderAdapter>;
    providerInstances: Map<string, ProviderInstanceStored>;
    providerSecrets: Map<string, Record<string, unknown>>;
    personalities: Map<string, ChatPersonality>;
    sessionStore: ChatSessionStore;
    userSecretsStore: ChatUserSecretsStore;
    sessionPrincipal: Map<string, string>;
    modelListCache: Map<string, { at: number; models: ChatProviderModelInfo[] }>;
    modelListInFlight: Map<string, Promise<ChatProviderModelInfo[]>>;
    modelCapabilities: Map<string, ModelCapabilities>;
    evictionBound: boolean;
    unownedPurgeDone: boolean;
}

const REGISTRY_STATE_KEY = '__XOPAT_CHAT_SERVER_STATE__';
/** Pre-state-bag global. Harvested once, then removed. */
const LEGACY_REGISTRY_KEY = '__XOPAT_CHAT_SERVER_REGISTRY__';

function createRegistryState(): ChatRegistryState {
    return {
        providerTypes: new Map(),
        providerAdapters: new Map(),
        providerInstances: new Map(),
        providerSecrets: new Map(),
        personalities: new Map(),
        sessionStore: new InMemoryChatSessionStore(),
        userSecretsStore: new InMemoryUserSecretsStore(),
        sessionPrincipal: new Map(),
        modelListCache: new Map(),
        modelListInFlight: new Map(),
        modelCapabilities: new Map(),
        evictionBound: false,
        unownedPurgeDone: false,
    };
}

/**
 * Carry state over from a pre-state-bag registry instance left on `globalThis` by
 * an older build. Best-effort and never fatal: a shape we don't recognise is
 * simply dropped, because a cold registry is recoverable (plugins re-register
 * their managed providers at boot) while a throw here is not.
 */
function adoptLegacyRegistry(state: ChatRegistryState): void {
    const g = globalThis as any;
    const legacy = g[LEGACY_REGISTRY_KEY];
    if (!legacy) return;
    delete g[LEGACY_REGISTRY_KEY];
    let adopted = 0;
    for (const key of [
        'providerTypes', 'providerAdapters', 'providerInstances', 'providerSecrets',
        'personalities', 'sessionPrincipal', 'modelCapabilities',
    ] as const) {
        const value = legacy[key];
        if (value instanceof Map && value.size) { (state as any)[key] = value; adopted += value.size; }
    }
    for (const key of ['sessionStore', 'userSecretsStore'] as const) {
        const value = legacy[key];
        if (value && typeof value === 'object') (state as any)[key] = value;
    }
    console.warn(`[chat] adopted ${adopted} entries from a pre-reload chat registry instance; ` +
        `state now survives hot reloads independently of the class.`);
}

class ChatServerRegistry {
    private static _instance: ChatServerRegistry | undefined;

    /** The reload-surviving data. Identity of this object is what binds an instance to its state. */
    readonly state: ChatRegistryState;

    private constructor(state: ChatRegistryState) {
        this.state = state;
    }

    // Field accessors over the state bag. Call sites are unchanged; only the
    // storage location moved.
    private get providerTypes() { return this.state.providerTypes; }
    private get providerAdapters() { return this.state.providerAdapters; }
    private get providerInstances() { return this.state.providerInstances; }
    private get providerSecrets() { return this.state.providerSecrets; }
    private get personalities() { return this.state.personalities; }
    private get sessionStore() { return this.state.sessionStore; }
    private set sessionStore(value: ChatSessionStore) { this.state.sessionStore = value; }
    private get userSecretsStore() { return this.state.userSecretsStore; }
    private set userSecretsStore(value: ChatUserSecretsStore) { this.state.userSecretsStore = value; }

    static instance(): ChatServerRegistry {
        const g = globalThis as any;
        let state: ChatRegistryState = g[REGISTRY_STATE_KEY];
        if (!state) {
            state = g[REGISTRY_STATE_KEY] = createRegistryState();
            adoptLegacyRegistry(state);
        }

        // `_instance` is a static on the CURRENT class, so a hot reload resets it
        // to undefined and we rebuild around the surviving state. We only ever
        // call methods on an instance this class constructed.
        if (!this._instance || this._instance.state !== state) {
            this._instance = new ChatServerRegistry(state);
        }
        this._instance.bindSessionEviction();
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
        const origin = providerOrigin(stored);
        const secretKeys = Array.from(new Set([
            ...(origin === 'operator' ? Object.keys(fixedSecrets) : []),
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
            origin,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            hasSecretOverrides: Object.keys(overrideSecrets).length > 0,
            // Must mirror getProviderRuntime: the type's key reaches only the
            // operator's instance, so a user instance reports no admin key and the
            // keys panel renders `needsKey` instead of a misleading "key available".
            hasSecretDefaults: origin === 'operator' && Object.keys(fixedSecrets).length > 0,
            secretKeys,
        };
    }

    /**
     * @param ownerPrincipal the creating caller's principal, or `null` for an
     *   operator/service-provided instance (unowned ⇒ shared with everyone).
     */
    async createProviderInstance(input: CreateProviderInstanceInput, ownerPrincipal?: string | null): Promise<ChatProviderInstanceRecord> {
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
            // Server-assigned, spread AFTER caller metadata so input cannot forge it.
            origin: ownerPrincipal ? 'user' : 'operator',
            metadata: { ...(input.metadata || {}), ownerPrincipal: ownerPrincipal ?? null },
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

    async listProviderInstances(args?: { ownerPrincipal?: string | null; typeId?: string | null }): Promise<ChatProviderClientRegistration[]> {
        let items = Array.from(this.providerInstances.values());
        if (args?.typeId) items = items.filter((p) => p.typeId === args.typeId);
        // ACL: the caller's own instances PLUS the unowned ones. Unlike a chat
        // session, an unowned provider is not an orphan — it is the operator's
        // service-provided instance, deliberately shared with every user (the
        // admin key case). `undefined` means no filter (server-internal callers).
        if (args && "ownerPrincipal" in args) {
            const wanted = args.ownerPrincipal ?? null;
            items = items.filter((p) => {
                const owner = (p.metadata?.ownerPrincipal ?? null) as string | null;
                return owner === null || owner === wanted;
            });
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

    /**
     * Last principal seen on each browser session. Bounded: it holds one short
     * string per live session and entries are replaced, not accumulated, per
     * session id.
     */
    private get sessionPrincipal() { return this.state.sessionPrincipal; }
    private static readonly SESSION_PRINCIPAL_MAX = 5000;

    /**
     * Anonymous BYOK is scoped to the browser session, but a browser session
     * outlives a login: on a shared workstation, user B signing in after user A
     * would otherwise inherit A's stored API key (and vice versa on sign-out).
     *
     * So whenever the principal behind a session id changes, wipe everything held
     * under that session's anonymous scope and the caches derived from it.
     */
    async reconcileSessionPrincipal(ctx: any): Promise<void> {
        const sessionId = ctx?.session?.id;
        if (!sessionId) return;
        const principal = safeScope(ctx);
        if (!principal) return;

        const key = String(sessionId);
        const previous = this.sessionPrincipal.get(key);
        if (previous === principal) return;

        this.sessionPrincipal.set(key, principal);
        if (this.sessionPrincipal.size > ChatServerRegistry.SESSION_PRINCIPAL_MAX) {
            const oldest = this.sessionPrincipal.keys().next();
            if (!oldest.done) this.sessionPrincipal.delete(oldest.value);
        }
        if (previous === undefined) return;   // first sighting, nothing to revoke

        const anonScope = `sess:${key}`;
        try {
            await this.userSecretsStore.deleteScope?.(anonScope);
        } catch (e) {
            console.warn('[chat] failed to purge anonymous secrets on principal change', e);
        }
        if (typeof this.userSecretsStore.deleteScope !== 'function') {
            console.warn('[chat] the configured user-secrets store does not implement deleteScope(); ' +
                'anonymous BYOK keys survive a principal change on the same browser session.');
        }
        this.invalidateModelListCache();
        this.clearModelCapabilitiesForScope(anonScope);
    }

    /**
     * Subscribe to core's browser-session eviction so anonymous state dies with
     * the session that owned it. Idempotent per state bag; a no-op on a core
     * without the hook (retried on the next instance() call).
     *
     * The listener closes over the STATE, never over `this` — a hot reload
     * replaces the instance but core keeps the callback forever, so an
     * instance-bound closure would go on mutating a discarded object.
     */
    bindSessionEviction(): void {
        const state = this.state;
        if (state.evictionBound) return;
        const XS = (globalThis as any).XOPAT_SERVER;
        if (typeof XS?.onSessionEvicted !== 'function') return;
        state.evictionBound = true;
        XS.onSessionEvicted((sessionId: string) => {
            const scope = `sess:${sessionId}`;
            state.sessionPrincipal.delete(String(sessionId));
            void Promise.resolve(state.userSecretsStore.deleteScope?.(scope))
                .catch((e) => console.warn('[chat] failed to purge secrets of evicted session', e));
            const suffix = `::${scope}`;
            for (const key of [...state.modelCapabilities.keys()]) {
                if (key.endsWith(suffix)) state.modelCapabilities.delete(key);
            }
        });
    }

    /** Drop every cached capability verdict probed under one scope. */
    clearModelCapabilitiesForScope(scope: string): void {
        const suffix = `::${scope}`;
        for (const key of [...this.modelCapabilities.keys()]) {
            if (key.endsWith(suffix)) this.modelCapabilities.delete(key);
        }
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
        assertProviderRead(opts?.ctx, stored);
        const type = this.getProviderType(stored.typeId);
        if (!type) throw new Error(`Unknown provider type '${stored.typeId}'.`);
        // Contextual-availability gate: a login-gated or context-restricted
        // provider verifies the context IT declares, on this request. No-op (and
        // no auth needed anywhere) when the provider is unrestricted.
        const verifiedContext = await requireProviderContext(opts?.ctx, stored, type);
        const instance = this.buildInstanceRecord(stored);

        // A browser session that changed hands must not inherit the previous
        // occupant's BYOK key (shared workstation / kiosk).
        await this.reconcileSessionPrincipal(opts?.ctx);

        // BYOK on a LOGIN-GATED provider is per-person, never per-browser: a
        // `sess:` scope identifies a cookie, and a cookie outlives a login. Only
        // an unrestricted provider may carry an anonymous BYOK overlay, where the
        // key is per-browser by construction and belongs to nobody else.
        const scope = opts?.userScope ?? null;
        const scopeUsable = scope && !(verifiedContext && isAnonymousScope(scope));
        const userSecrets = scopeUsable ? await this.getUserSecrets(scope!, providerId) : {};
        // The operator's `fixedSecrets` go ONLY to the operator's own instance.
        // The key and the constraints that make it safe to spend — fixed endpoint,
        // fixed gate, fixed model set — are one package; a user-created instance
        // re-opens every one of them, so inheriting the key alone would mean
        // inheriting the asset without any of the controls. (That inheritance was
        // the entire payload of the "create your own instance of the operator's
        // type" exfiltration.) A user instance is unusable until BYOK — correct.
        const operatorSecrets = providerOrigin(stored) === 'operator' ? (type.fixedSecrets || {}) : {};
        return {
            type,
            instance,
            config: { ...(type.fixedConfig || {}), ...(stored.configOverrides || {}) },
            // User-provided secrets win: their key, their quota.
            secrets: { ...operatorSecrets, ...(this.providerSecrets.get(providerId) || {}), ...userSecrets },
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
    private get modelListCache() { return this.state.modelListCache; }
    private get modelListInFlight() { return this.state.modelListInFlight; }
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

    /**
     * Reduce a caller-supplied draft config to what the type actually declares.
     *
     * INTERSECTION, not a denylist. The type's `configSchema` already describes
     * its entire legitimate config surface, so anything outside it is by
     * definition not a knob the adapter author intended a caller to set —
     * medgemma's `validateUpstream` (a security switch, absent from the schema,
     * yet settable) is the proof of what open-world config costs. Secret fields
     * are dropped too: they arrive via `draftSecrets`, never via config.
     */
    private sanitizeDraftConfig(type: ChatProviderTypeRecord, draft: Record<string, unknown>): Record<string, unknown> {
        const allowed = new Map<string, any>();
        for (const field of (type.configSchema || []) as any[]) {
            if (field?.key && field.secret !== true) allowed.set(String(field.key), field);
        }
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(draft || {})) {
            if (!allowed.has(key) || value === undefined) continue;
            out[key] = value;
        }
        return out;
    }

    /**
     * Does this draft steer where the request goes, or what it carries?
     *
     * Deliberately broader than "is the field declared `input: url`". That test —
     * the previous rule — matched only `baseUrl`, while `modelsPath` is declared
     * `input: "text"` and `resolveEndpointUrl` returns an absolute endpoint
     * verbatim, so `{modelsPath: "https://attacker/x"}` redirected a
     * credential-bearing request while the rule reported "no redirect". A denylist
     * over an open-world object had already failed twice; this asks the question
     * that actually matters.
     */
    private draftSteersRequest(type: ChatProviderTypeRecord, draft: Record<string, unknown>): boolean {
        const urlFields = new Set(
            ((type.configSchema || []) as any[])
                .filter((f) => f?.input === 'url')
                .map((f) => String(f.key))
        );
        for (const [key, value] of Object.entries(draft)) {
            if (urlFields.has(key)) return true;
            // Any absolute URL anywhere can become the destination.
            if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return true;
            // Header injection into a request that carries the operator's key.
            if (/header/i.test(key)) return true;
        }
        return false;
    }

    /**
     * Probe an UNSAVED provider draft's model list — the "does this endpoint
     * work?" button in the provider editor.
     *
     * Everything here is caller-supplied, so it is gated exactly like a real
     * provider: identified caller, and the type's declared auth context verified.
     * Crucially, a draft that redirects the upstream URL gets NO operator
     * credentials — otherwise `{ baseUrl: "https://attacker.example/v1" }` would
     * make the server hand the deployment's API key to an arbitrary host.
     */
    async previewListModels(typeId: string, args: { ctx: any; contextId?: string | null; draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }): Promise<ChatProviderModelInfo[]> {
        const type = this.getProviderType(typeId);
        if (!type) throw new Error(`Unknown provider type '${typeId}'.`);
        const adapter = this.getAdapter(type.adapter);
        if (!adapter) throw new Error(`Unknown provider adapter '${type.adapter}'.`);
        if (!adapter.listModels) return [];

        // Same gates as getProviderRuntime — this path reaches credentials too.
        resolveUserScope(args.ctx);
        const verifiedContext = await requireProviderContext(args.ctx, { contextId: args.contextId ?? null }, type);

        const draftConfig = this.sanitizeDraftConfig(type, args.draftConfig || {});
        const draftSecrets = args.draftSecrets || {};
        const secrets = this.draftSteersRequest(type, draftConfig)
            ? { ...draftSecrets }                                   // caller's own key only
            : { ...(type.fixedSecrets || {}), ...draftSecrets };
        // An anonymous scope may not borrow a login-gated type's operator key either.
        const scope = safeScope(args.ctx);
        const cacheScope = verifiedContext && isAnonymousScope(scope) ? null : scope;


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
            hasSecretOverrides: Object.keys(draftSecrets).length > 0,
            hasSecretDefaults: Object.keys(secrets).length > Object.keys(draftSecrets).length,
            secretKeys: Object.keys(secrets).sort(),
        };

        const models = await adapter.listModels({
            ...args,
            providerId: instance.id,
            providerTypeId: type.id,
            modelId: instance.defaultModelId || '',
            type,
            instance,
            config: { ...(type.fixedConfig || {}), ...draftConfig },
            secrets,
            draftConfig: args.draftConfig,
            draftSecrets: args.draftSecrets,
        });

        // The draft id is synthetic and shared by every caller, while the probe
        // ran against THIS caller's draftSecrets — so the verdict must be cached
        // under their scope, never in the shared partition.
        return (models || []).map((model) =>
            this.mergeModelCapabilities(instance.id, model, model.capabilities || null, cacheScope)
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
        void this.purgeUnownedSessions();
    }

    private get unownedPurgeDone() { return this.state.unownedPurgeDone; }
    private set unownedPurgeDone(value: boolean) { this.state.unownedPurgeDone = value; }

    /**
     * One-shot upgrade migration.
     *
     * Sessions created before ownership moved to principals carry
     * `metadata.userId` (almost always `null`) and no `ownerPrincipal`. Under the
     * new ACL they are unreachable — nobody can open them, and nobody can delete
     * them through the UI. In a clinical deployment they may hold patient data,
     * so an orphaned-but-retained record is worse than a removed one: purge them
     * and say so. Set XOPAT_CHAT_KEEP_LEGACY_SESSIONS=1 to export them first.
     */
    async purgeUnownedSessions(): Promise<number> {
        if (this.unownedPurgeDone) return 0;
        this.unownedPurgeDone = true;
        if (String(process.env.XOPAT_CHAT_KEEP_LEGACY_SESSIONS || '') === '1') {
            console.warn('[chat-migration] XOPAT_CHAT_KEEP_LEGACY_SESSIONS=1 — keeping pre-principal ' +
                'chat sessions. They have no owner and are unreachable through the API.');
            return 0;
        }
        let purged = 0;
        try {
            // No ACL argument: this is the server-internal sweep.
            const all = await this.sessionStore.listSessions();
            for (const session of all) {
                if (session.metadata?.ownerPrincipal) continue;
                await this.sessionStore.deleteSession(session.id);
                purged++;
            }
        } catch (e) {
            console.warn('[chat-migration] could not purge unowned chat sessions', e);
            return 0;
        }
        if (purged) {
            console.warn(`[chat-migration] purged ${purged} chat session(s) with no ownerPrincipal ` +
                `(pre-principal records are unowned and unreachable).`);
        }
        return purged;
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

    private get modelCapabilities() { return this.state.modelCapabilities; }

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
