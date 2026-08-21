import type { LanguageModel } from 'ai';
import { getChatTuning, chatLog } from './tuning';
import {
    matchProviderRef,
    refShadowedByUserInstance,
    describeProviderRefFailure,
    type ProviderRefMatch,
} from '../shared/providerRef';
import type { TranscriptionModelV4 } from '@ai-sdk/provider';

// ── core server storage ──────────────────────────────────────────────────────
// Structurally typed against `XOPAT_SERVER.storage` / `.cache` (server/STORAGE.md)
// rather than imported: module server files may not import from core, and the
// global is installed by the host at boot.

interface XoKVHandle {
    get<T = any>(key: string, defaultValue?: T | null): Promise<T | null>;
    set(key: string, value: any, meta?: { ttlMs?: number }): Promise<void>;
    delete(key: string): Promise<boolean>;
    has(key: string): Promise<boolean>;
    keys(opts?: { prefix?: string; limit?: number }): Promise<string[]>;
    scan(opts?: { prefix?: string }): AsyncIterable<[string, any]>;
    clear(): Promise<void>;
    scoped(principal: string): XoKVHandle;
}

interface XoLogHandle {
    append(key: string, entries: any[]): Promise<number>;
    tail(key: string, n: number): Promise<any[]>;
    range(key: string, from?: number, to?: number): Promise<any[]>;
    length(key: string): Promise<number>;
    trim(key: string, keepTail: number): Promise<number>;
    delete(key: string): Promise<boolean>;
}

interface XoBlobHandle {
    put(key: string, source: any, meta?: { contentType?: string; ttlMs?: number }): Promise<{ bytes: number }>;
    get(key: string): Promise<any | null>;
    stat(key: string): Promise<{ bytes: number } | null>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    scoped(scope: string): XoBlobHandle;
}

interface XoStorage {
    kv(ownerUid: string, ns: string, options?: Record<string, any>): XoKVHandle;
    log(ownerUid: string, ns: string, options?: Record<string, any>): XoLogHandle;
    blob(ownerUid: string, ns: string, options?: Record<string, any>): XoBlobHandle;
}

/**
 * Structural view of a core bounded cache. Deliberately Map-shaped so the maps
 * it replaces did not have to change at every call site — the difference is that
 * this one has a bound and a sweeper.
 */
interface XoBoundedCache<V = any> {
    get(key: string): V | undefined;
    peek(key: string): V | undefined;
    has(key: string): boolean;
    set(key: string, value: V, options?: { ttlMs?: number; bytes?: number }): void;
    delete(key: string): boolean;
    clear(): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<V>;
    entries(): IterableIterator<[string, V]>;
    readonly size: number;
}

const OWNER_UID = 'module.vercel-ai-chat-sdk';

function xopatServer(): any {
    return (globalThis as any).XOPAT_SERVER;
}

function serverStorage(): XoStorage | null {
    return (xopatServer()?.storage as XoStorage) || null;
}

/**
 * Bounded in-process cache, or a plain Map when running against a core too old
 * to provide one. The fallback is deliberately unbounded-but-loud: an older host
 * behaves exactly as it did before this change rather than silently losing data.
 */
function boundedCache<V = any>(name: string, options: { maxEntries?: number; ttlMs?: number; maxBytes?: number; sizeOf?: (v: V) => number } = {}): XoBoundedCache<V> {
    const create = xopatServer()?.cache?.create;
    if (typeof create === 'function') return create({ name, ...options });
    chatLog().warn(`XOPAT_SERVER.cache unavailable — '${name}' falls back to an unbounded Map.`);
    const map = new Map<string, V>();
    return {
        get: (k) => map.get(k),
        peek: (k) => map.get(k),
        has: (k) => map.has(k),
        set: (k, v) => { map.set(k, v); },
        delete: (k) => map.delete(k),
        clear: () => map.clear(),
        keys: () => map.keys(),
        values: () => map.values(),
        entries: () => map.entries(),
        get size() { return map.size; },
    };
}

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
 * Returning a bare {@link TranscriptionModelV4} is equivalent to
 * `{ model }` with the default providerOptions namespace.
 *
 * Typed against the provider-spec v3 interface; spec v4 models (from provider
 * packages on the newer `@ai-sdk/provider` major) are accepted at runtime —
 * the two are structurally identical, only the discriminant differs.
 */
export interface ResolvedTranscriptionModel {
    model: TranscriptionModelV4;
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
    resolveTranscriptionModel?: (args: ChatProviderAdapterRuntimeArgs & { transcribeTimeoutMs?: number }) =>
        Promise<TranscriptionModelV4 | ResolvedTranscriptionModel> | TranscriptionModelV4 | ResolvedTranscriptionModel;
}

/**
 * Language-model spec versions core `ai` can consume. AI SDK 7 resolves v2 and v3
 * models by wrapping them into the v4 interface, so an adapter one provider-major
 * behind still works; anything outside the set is a release-line mismatch.
 */
const SUPPORTED_LANGUAGE_MODEL_SPECS = ['v2', 'v3', 'v4'];

/**
 * Fail an adapter that hands back a model from a `@ai-sdk/*` package built against a
 * DIFFERENT AI SDK release line than the core `ai` this module depends on. Without it
 * the mismatch surfaces mid-turn as the SDK's own opaque
 * "Unsupported model version <spec> for provider ... AI SDK 5 only supports ..." — which
 * names neither the plugin at fault nor the fix, and whose "AI SDK 5" wording is stale
 * text inside the error class regardless of the installed major.
 *
 * The provider packages live in each plugin's own `package.json` under npm workspaces,
 * so a lone `npm i @ai-sdk/<x>@latest` in one plugin is exactly how the lines drift
 * apart (this is what broke `chat-anthropic` + `chat-openai` on `@ai-sdk/*@4` while core
 * was still `ai@6`). See modules/vercel-ai-chat-sdk/README.md → "AI SDK version line".
 */
export function assertLanguageModelCompatible(model: any, adapterId: string, providerId: string): void {
    const spec = model?.specificationVersion;
    if (typeof spec === 'string' && SUPPORTED_LANGUAGE_MODEL_SPECS.includes(spec)) return;
    throw new Error(
        `Provider '${providerId}' (adapter '${adapterId}') resolved a language model with ` +
        `specification version '${String(spec)}', which core 'ai' cannot consume ` +
        `(supported: ${SUPPORTED_LANGUAGE_MODEL_SPECS.join(', ')}). The '@ai-sdk/*' package behind ` +
        `this adapter comes from a different AI SDK release line than the 'ai' package in ` +
        `modules/vercel-ai-chat-sdk. Align both on one line — 'npm view @ai-sdk/<pkg> dist-tags' ` +
        `lists the matching major per core version (ai-v6 / ai-v7).`
    );
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
/**
 * A provider *reference* named nothing resolvable — a configuration mistake, not a refusal.
 * Distinct from the two codes above on purpose: those mean "exists, you may not have it" and
 * are retryable after a login, this one is permanent until the config changes.
 */
export const CHAT_ERR_UNKNOWN_PROVIDER = 'CHAT_PROVIDER_UNKNOWN';

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
    chatLog().warn(
        `a provider requires login but declares no auth context; verifying the main ` +
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
            chatLog().warn('core lacks XOPAT_SERVER.requireRpcAuthContext; ' +
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

    // ── optional capabilities ────────────────────────────────────────────────
    // Every method below is OPTIONAL and feature-detected at the call site, so a
    // deployment that plugged its own store in through `setSessionStore` keeps
    // working unchanged — it simply takes the slower/older path.

    /**
     * The last `limit` messages. The default store answers this without
     * materializing the full history, which is the whole point: a turn needs a
     * ~14-message window, and copying an entire transcript to slice its tail was
     * the per-turn allocation that made long sessions expensive.
     */
    listRecentMessages?(sessionId: string, limit: number): Promise<ChatMessage[]>;

    /**
     * The attachment's payload (a data URL), fetched on demand.
     *
     * Stored attachment RECORDS no longer carry `dataUrl` — a 12 MB base64 blob
     * per upload, resident for the process lifetime, was the single largest
     * contributor to server RAM. The bytes live in blob storage and are pulled
     * back only for the turn that actually needs them. Returns null when the
     * payload is gone; callers already degrade to `[Image unavailable]`.
     */
    getAttachmentPayload?(sessionId: string, attachmentId: string): Promise<string | null>;

    /** Release timers/handles. Called when a store is swapped out. */
    dispose?(): void;
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

/**
 * Schema-declared secrets the runtime has no value for. Empty ⇒ free to call upstream.
 *
 * A provider type declares a credential as `{ secret: true, required: true }` in its
 * `configSchema`; the deployment opts out of the requirement (local ollama / vLLM and
 * anything else that authenticates by network position) by registering the field with
 * `required: false`. Discovery consults this INSTEAD of sending an unauthenticated
 * request and letting the upstream answer 401 — a deployment that simply has not
 * configured a key is not an incident, and the 401 storm it produced at every boot
 * drowned the real failures.
 *
 * Empty string counts as absent: `normalizeSecretsPatch` already strips empty values,
 * and `fixedSecrets: { apiKey: "" }` is exactly how an unconfigured operator key looks.
 */
/**
 * Model-discovery outcome. An object rather than a bare array so "empty because
 * nobody configured a key" cannot be dropped on the way to the caller — that
 * distinction is the whole point of the credential gate.
 */
export type ModelListing = {
    models: ChatProviderModelInfo[];
    /** True ⇒ no upstream call was attempted; a required credential is missing. */
    needsKey?: boolean;
    missingSecretKeys?: string[];
};

function missingRequiredSecrets(type: ChatProviderTypeRecord, secrets: Record<string, unknown>): string[] {
    const missing: string[] = [];
    for (const field of ((type.configSchema || []) as ChatProviderConfigField[])) {
        if (field?.secret !== true || field?.required !== true) continue;
        const key = String(field.key);
        const value = secrets?.[key];
        if (typeof value !== 'string' || !value.trim()) missing.push(key);
    }
    return missing;
}

/**
 * Merge helper for fields whose `null` is MEANINGFUL, i.e. the auth triplet
 * (`requiresLogin` / `contextId` / `authType`).
 *
 * `??` cannot express them: it treats `null` as "no opinion" and falls back, so
 * a re-registration that turns login OFF (`contextId: null`) could never clear a
 * previously stored context id — the record kept demanding login for a context
 * nobody configures any more. Only `undefined` (field omitted) inherits.
 */
function take<T>(...candidates: (T | undefined)[]): T | undefined {
    for (const candidate of candidates) {
        if (candidate !== undefined) return candidate;
    }
    return undefined;
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

/**
 * Minimal in-process stand-in for `XOPAT_SERVER.storage`, used only when the
 * host core predates the storage broker.
 *
 * It exists so there is exactly ONE store implementation to reason about: the
 * store below is written against the broker interface and the shim makes that
 * interface always available. Bounds still apply — the shim is built from the
 * same bounded-cache helper — it simply cannot persist or share across workers.
 */
function memoryStorageShim(): XoStorage {
    const kvCaches = new Map<string, XoBoundedCache>();
    const cacheFor = (id: string, options: any) => {
        let c = kvCaches.get(id);
        if (!c) { c = boundedCache(`chat-shim:${id}`, options); kvCaches.set(id, c); }
        return c;
    };
    const scopedKey = (scope: string | null, key: string) => (scope ? `${scope} ${key}` : key);

    const makeKv = (id: string, options: any, scope: string | null): XoKVHandle => ({
        async get(key, defaultValue = null) {
            const v = cacheFor(id, options).get(scopedKey(scope, key));
            return v === undefined ? (defaultValue as any) : v;
        },
        async set(key, value) { cacheFor(id, options).set(scopedKey(scope, key), value); },
        async delete(key) { return cacheFor(id, options).delete(scopedKey(scope, key)); },
        async has(key) { return cacheFor(id, options).has(scopedKey(scope, key)); },
        async keys() {
            const prefix = scope ? `${scope} ` : '';
            return [...cacheFor(id, options).keys()]
                .filter(k => !prefix || k.startsWith(prefix))
                .map(k => (prefix ? k.slice(prefix.length) : k));
        },
        async *scan() {
            const prefix = scope ? `${scope} ` : '';
            for (const [k, v] of cacheFor(id, options).entries()) {
                if (prefix && !k.startsWith(prefix)) continue;
                yield [prefix ? k.slice(prefix.length) : k, v] as [string, any];
            }
        },
        async clear() {
            const cache = cacheFor(id, options);
            if (!scope) { cache.clear(); return; }
            const prefix = `${scope} `;
            for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
        },
        scoped(principal) { return makeKv(id, options, String(principal)); },
    });

    const makeLog = (id: string, options: any): XoLogHandle => {
        const cache = () => cacheFor(id, options);
        const read = (key: string): any[] => (cache().get(key) as any[]) || [];
        return {
            async append(key, entries) {
                const next = read(key).concat(entries);
                const cap = options?.maxEntries;
                const trimmed = cap && next.length > cap ? next.slice(next.length - cap) : next;
                cache().set(key, trimmed);
                return trimmed.length;
            },
            async tail(key, n) { const all = read(key); return all.slice(Math.max(0, all.length - n)); },
            async range(key, from = 0, to) { return read(key).slice(from, to); },
            async length(key) { return read(key).length; },
            async trim(key, keepTail) {
                const all = read(key);
                const next = all.slice(Math.max(0, all.length - keepTail));
                cache().set(key, next);
                return next.length;
            },
            async delete(key) { return cache().delete(key); },
        };
    };

    const makeBlob = (id: string, options: any, scope: string | null): XoBlobHandle => ({
        async put(key, source) {
            const buf = Buffer.isBuffer(source) ? source : Buffer.from(String(source), 'utf8');
            cacheFor(id, options).set(scopedKey(scope, key), buf);
            return { bytes: buf.byteLength };
        },
        async get(key) { return cacheFor(id, options).get(scopedKey(scope, key)) ?? null; },
        async stat(key) {
            const v: any = cacheFor(id, options).peek(scopedKey(scope, key));
            return v ? { bytes: v.byteLength || 0 } : null;
        },
        async delete(key) { return cacheFor(id, options).delete(scopedKey(scope, key)); },
        async clear() {
            const cache = cacheFor(id, options);
            if (!scope) { cache.clear(); return; }
            const prefix = `${scope} `;
            for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
        },
        scoped(s) { return makeBlob(id, options, String(s)); },
    });

    return {
        kv: (_owner, ns, options) => makeKv(ns, options, null),
        log: (_owner, ns, options) => makeLog(ns, options),
        blob: (_owner, ns, options) => makeBlob(ns, options, null),
    };
}

function storageOrShim(): XoStorage {
    const storage = serverStorage();
    if (storage) return storage;
    chatLog().warn('XOPAT_SERVER.storage unavailable — chat state stays in this process only.');
    return memoryStorageShim();
}

/**
 * Retention. Sourced from the module's server config
 * (`…modules["vercel-ai-chat-sdk"].tuning`), NOT from env vars — see
 * `server/tuning.ts` and server/STORAGE.md. Read through a getter because the
 * stores below are built lazily, outside any request.
 */
const CHAT_RETENTION = {
    get sessionTtlMs() { return getChatTuning().sessionTtlMs; },
    get maxSessions() { return getChatTuning().maxSessions; },
    get maxMessagesPerSession() { return getChatTuning().maxMessagesPerSession; },
    get maxAttachmentsPerSession() { return getChatTuning().maxAttachmentsPerSession; },
};

/**
 * The default session store, backed by the core storage broker.
 *
 * Three namespaces, because the three kinds of data have three different growth
 * shapes and forcing them into one map is what made this unbounded:
 *
 *   kv:sessions      one small record per session; TTL + LRU cap apply here, and
 *                    evicting one cascades to everything below it
 *   log:messages     append-only, tail-read, FIFO-trimmed at a message cap
 *   blob:attachments the actual bytes, scoped per session so deleting a session
 *                    is one recursive remove; NEVER held in memory
 *
 * Bound to `memory` (the default for this store) the observable behavior matches
 * the old in-process maps. Bound to `tiered`/`file` the same code additionally
 * survives a restart and is shared across cluster workers.
 */
class StorageChatSessionStore implements ChatSessionStore {
    private sessions: XoKVHandle;
    private messages: XoLogHandle;
    /** Attachment RECORDS (metadata only — no payload). */
    private attachmentIndex: XoLogHandle;
    /** Attachment PAYLOADS, scoped per session. */
    private payloads: XoBlobHandle;

    constructor(storage: XoStorage) {
        this.sessions = storage.kv(OWNER_UID, 'sessions', {
            ttlMs: CHAT_RETENTION.sessionTtlMs,
            maxEntries: CHAT_RETENTION.maxSessions,
            defaultBindings: ['memory'],
            // Dropping a session must not orphan its transcript and its
            // attachment bytes — those are far larger than the record that
            // triggered the eviction.
            onEvict: (sessionId: string) => this.purgeSessionData(sessionId),
        });
        this.messages = storage.log(OWNER_UID, 'messages', {
            ttlMs: CHAT_RETENTION.sessionTtlMs,
            maxEntries: CHAT_RETENTION.maxMessagesPerSession,
            defaultBindings: ['memory'],
        });
        this.attachmentIndex = storage.log(OWNER_UID, 'attachment-index', {
            ttlMs: CHAT_RETENTION.sessionTtlMs,
            maxEntries: CHAT_RETENTION.maxAttachmentsPerSession,
            defaultBindings: ['memory'],
        });
        this.payloads = storage.blob(OWNER_UID, 'attachments', {
            ttlMs: CHAT_RETENTION.sessionTtlMs,
            defaultBindings: ['memory'],
        });
    }

    private async purgeSessionData(sessionId: string): Promise<void> {
        try {
            await Promise.all([
                this.messages.delete(sessionId),
                this.attachmentIndex.delete(sessionId),
                this.payloads.scoped(sessionId).clear(),
            ]);
        } catch (e: any) {
            // Never surface the values, and never let a cleanup failure escape
            // into an unrelated request.
            chatLog().warn(`failed to purge data for session '${sessionId}': ${e?.message || e}`);
        }
    }

    private async requireSession(sessionId: string): Promise<ChatSession> {
        const session = await this.sessions.get<ChatSession>(sessionId);
        if (!session) throw new Error(`Unknown session '${sessionId}'.`);
        return session;
    }

    private async markUpdated(session: ChatSession): Promise<void> {
        await this.sessions.set(session.id, { ...session, updatedAt: new Date().toISOString() });
    }

    async createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession> {
        const now = new Date().toISOString();
        const session: ChatSession = {
            ...input,
            createdAt: now,
            updatedAt: now,
            summary: input.summary || '',
        };
        await this.sessions.set(session.id, session);
        return session;
    }

    async updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession> {
        const current = await this.requireSession(sessionId);
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        await this.sessions.set(sessionId, next);
        return next;
    }

    async getSession(sessionId: string): Promise<ChatSession | null> {
        return this.sessions.get<ChatSession>(sessionId);
    }

    async listSessions(args?: { providerId?: string; ownerPrincipal?: string | null }): Promise<ChatSession[]> {
        // ACL: match the owner PRINCIPAL exactly. Callers pass their own principal,
        // derived server-side — never a caller-supplied identity, and never null:
        // `null` is not an owner, it is "unowned", and unowned records belong to
        // nobody and are listed to nobody. Omitting the key entirely is the only
        // opt-out and is reserved for server-internal callers.
        const filterOwner = !!(args && "ownerPrincipal" in args);
        const wanted = args?.ownerPrincipal ?? null;
        if (filterOwner && wanted === null) return [];

        const items: ChatSession[] = [];
        for await (const [, session] of this.sessions.scan()) {
            if (!session) continue;
            if (args?.providerId && session.providerId !== args.providerId) continue;
            if (filterOwner && ((session.metadata?.ownerPrincipal ?? null) as string | null) !== wanted) continue;
            items.push(session);
        }
        return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessions.delete(sessionId);
        await this.purgeSessionData(sessionId);
    }

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
        const session = await this.requireSession(sessionId);
        // Idempotent by id: a retried request whose earlier attempt already
        // persisted these messages (e.g. a sendTurn delta that failed after the
        // append) must not double-append. Only newly stored messages are returned.
        //
        // The dedup window is the retained tail rather than the whole history —
        // a retry always targets recent messages, and scanning an entire
        // transcript to prove it is the cost this store exists to avoid.
        const recent = await this.messages.tail(sessionId, Math.min(64, CHAT_RETENTION.maxMessagesPerSession));
        const existingIds = new Set(recent.map((m: ChatMessage) => m.id).filter(Boolean));
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
        if (normalized.length) await this.messages.append(sessionId, normalized);
        await this.markUpdated(session);
        return normalized;
    }

    async listMessages(sessionId: string): Promise<ChatMessage[]> {
        return this.messages.range(sessionId);
    }

    async listRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
        return this.messages.tail(sessionId, Math.max(1, limit));
    }

    async uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord> {
        const session = await this.requireSession(record.sessionId);
        const { dataUrl, ...stored } = record;

        if (dataUrl) {
            await this.payloads
                .scoped(record.sessionId)
                .put(record.id, Buffer.from(String(dataUrl), 'utf8'), { contentType: record.mimeType });
        }
        // The stored record deliberately drops `dataUrl`. The caller still gets
        // it back below, because the client consumes the payload from the upload
        // response immediately — it is only the RETAINED copy that shrinks.
        await this.attachmentIndex.append(record.sessionId, [stored]);
        await this.markUpdated(session);
        return record;
    }

    async listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]> {
        return this.attachmentIndex.range(sessionId);
    }

    async getAttachmentPayload(sessionId: string, attachmentId: string): Promise<string | null> {
        try {
            const bytes = await this.payloads.scoped(sessionId).get(attachmentId);
            return bytes ? Buffer.from(bytes).toString('utf8') : null;
        } catch {
            return null;
        }
    }
}

interface ProviderInstanceStored extends Omit<ChatProviderInstanceRecord, 'config' | 'hasSecretOverrides' | 'hasSecretDefaults' | 'secretKeys'> {
    configOverrides: Record<string, unknown>;
    /** Server-assigned trust tier — see {@link providerOrigin}. Never from RPC input. */
    origin?: 'operator' | 'user';
}

/**
 * Default BYOK secret store — bounded and, by declaration, non-persistable.
 *
 * These entries hold PLAINTEXT API keys, and anonymous callers key by
 * `sess:<id>`, so an unbounded store means every anonymous session that ever set
 * a key retains its secret for the life of the process.
 *
 * `sensitivity: 'secret'` is the important part: the storage broker REFUSES to
 * bind this namespace to a persistent driver unless the operator has explicitly
 * accepted secrets at rest (`allowPersistentSecrets`). A well-meant "let's put
 * chat state on disk" config change therefore cannot silently start writing API
 * keys to the cache directory. A durable/managed backend is still pluggable via
 * `setUserSecretsStore`, which bypasses this store entirely.
 *
 * Per-scope isolation comes from `scoped(...)`, which is also what makes
 * `deleteScope` — the purge that runs when a browser session changes hands —
 * exact rather than a prefix scan.
 */
class StorageUserSecretsStore implements ChatUserSecretsStore {
    private static readonly TTL_MS = 12 * 60 * 60 * 1000;
    private static readonly MAX_ENTRIES = 500;

    private store: XoKVHandle;

    constructor(storage: XoStorage) {
        this.store = storage.kv(OWNER_UID, 'secrets', {
            ttlMs: StorageUserSecretsStore.TTL_MS,
            maxEntries: StorageUserSecretsStore.MAX_ENTRIES,
            sensitivity: 'secret',
            defaultBindings: ['memory'],
        });
    }

    async get(scope: string, providerKey: string): Promise<Record<string, unknown> | null> {
        const value = await this.store.scoped(scope).get<Record<string, unknown>>(providerKey);
        return value ? { ...value } : null;
    }

    async set(scope: string, providerKey: string, secrets: Record<string, unknown>): Promise<void> {
        await this.store.scoped(scope).set(providerKey, { ...secrets });
    }

    async delete(scope: string, providerKey: string): Promise<void> {
        await this.store.scoped(scope).delete(providerKey);
    }

    async deleteScope(scope: string): Promise<void> {
        await this.store.scoped(scope).clear();
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
    personalities: XoBoundedCache<ChatPersonality>;
    sessionStore: ChatSessionStore;
    userSecretsStore: ChatUserSecretsStore;
    sessionPrincipal: XoBoundedCache<string>;
    modelListCache: XoBoundedCache<{ at: number; models: ChatProviderModelInfo[] }>;
    /** Promises — not serializable, and cleared in `finally`. Stays a plain Map. */
    modelListInFlight: Map<string, Promise<ChatProviderModelInfo[]>>;
    modelCapabilities: XoBoundedCache<ModelCapabilities>;
    evictionBound: boolean;
    unownedPurgeDone: boolean;
}

const REGISTRY_STATE_KEY = '__XOPAT_CHAT_SERVER_STATE__';
/** Pre-state-bag global. Harvested once, then removed. */
const LEGACY_REGISTRY_KEY = '__XOPAT_CHAT_SERVER_REGISTRY__';

function createRegistryState(): ChatRegistryState {
    const storage = storageOrShim();
    return {
        providerTypes: new Map(),
        providerAdapters: new Map(),
        providerInstances: new Map(),
        providerSecrets: new Map(),
        // Client-supplied personalities used to land in an unbounded global map
        // keyed by a caller-chosen id — growth on demand, and one caller could
        // read another's custom prompt by guessing the id. Per-session custom
        // prompts now live on the session; this map holds only the built-in and
        // plugin-registered set, and is capped as a backstop.
        personalities: boundedCache<ChatPersonality>('chat:personalities', { maxEntries: 200 }) as any,
        sessionStore: new StorageChatSessionStore(storage),
        userSecretsStore: new StorageUserSecretsStore(storage),
        sessionPrincipal: boundedCache<string>('chat:session-principal', { maxEntries: 5000 }) as any,
        // Derived, cheap to rebuild, and partitioned per principal (anonymous
        // callers included) — in-process caches, not storage. What they needed
        // was an actual sweeper: the TTL used to be checked only on read, so
        // stale entries for departed anonymous sessions were never reclaimed.
        modelListCache: boundedCache('chat:model-list', { maxEntries: 500, ttlMs: 60_000 }) as any,
        modelListInFlight: new Map(),
        modelCapabilities: boundedCache('chat:model-capabilities', {
            maxEntries: 1000, ttlMs: 7 * 24 * 60 * 60 * 1000,
        }) as any,
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
    // Plain maps: adopt the container wholesale.
    for (const key of [
        'providerTypes', 'providerAdapters', 'providerInstances', 'providerSecrets',
    ] as const) {
        const value = legacy[key];
        if (value instanceof Map && value.size) { (state as any)[key] = value; adopted += value.size; }
    }
    // Bounded caches: copy the ENTRIES in rather than adopting the old Map.
    // Taking the container would silently reinstate the unbounded map this
    // change exists to remove.
    for (const key of ['personalities', 'sessionPrincipal', 'modelCapabilities'] as const) {
        const value = legacy[key];
        if (!(value instanceof Map) || !value.size) continue;
        const target = (state as any)[key] as XoBoundedCache;
        for (const [k, v] of value) target.set(String(k), v);
        adopted += value.size;
    }
    for (const key of ['sessionStore', 'userSecretsStore'] as const) {
        const value = legacy[key];
        if (value && typeof value === 'object') (state as any)[key] = value;
    }
    chatLog().warn(`adopted ${adopted} entries from a pre-reload chat registry instance; ` +
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
            requiresLogin: take(input.requiresLogin, current?.requiresLogin),
            contextId: take(input.contextId, current?.contextId) ?? null,
            authType: take(input.authType, current?.authType) ?? null,
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
            requiresLogin: take(stored.requiresLogin, type?.requiresLogin),
            contextId: take(stored.contextId, type?.contextId) ?? null,
            authType: take(stored.authType, type?.authType) ?? null,
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
            requiresLogin: take(input.requiresLogin, type.requiresLogin),
            contextId: take(input.contextId, type.contextId) ?? null,
            authType: take(input.authType, type.authType) ?? null,
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
            requiresLogin: take(patch.requiresLogin, current.requiresLogin),
            contextId: take(patch.contextId, current.contextId) ?? null,
            authType: take(patch.authType, current.authType) ?? null,
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
            chatLog().warn('failed to purge anonymous secrets on principal change', e);
        }
        if (typeof this.userSecretsStore.deleteScope !== 'function') {
            chatLog().warn('the configured user-secrets store does not implement deleteScope(); ' +
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
                .catch((e) => chatLog().warn('failed to purge secrets of evicted session', e));
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

    /** Refs already warned about, so an ambiguous config logs once rather than per inference. */
    private warnedRefs = new Set<string>();

    /**
     * Resolve a provider REFERENCE (instance id / managedKey / plugin id / type id) to a single
     * instance id. See `shared/providerRef.ts` for the precedence and the trust rule.
     *
     * Deliberately UNGATED and ctx-free: it dispenses nothing. Learning that an id exists grants
     * no access — every credential path still goes through `getProviderRuntime`, which is where
     * `assertProviderRead` and `requireProviderContext` live. Keeping the lookup ctx-free is also
     * what makes it deterministic: the candidate set cannot vary with who is asking.
     *
     * Reads `providerInstances` directly rather than going through `listProviderInstances`, which
     * applies an owner filter, and NEVER through the `listProviders` RPC, which strips hidden
     * records — referencing a hidden provider is the documented use case.
     */
    resolveProviderRef(ref: string | null | undefined): ProviderRefMatch | null {
        const records = Array.from(this.providerInstances.values());
        const match = matchProviderRef(records, ref);
        const key = String(ref ?? '');

        if (match?.ambiguous.length && !this.warnedRefs.has(key)) {
            this.warnedRefs.add(key);
            chatLog().warn(
                `provider reference '${key}' matched ${match.ambiguous.length + 1} providers on ` +
                `tier '${match.tier}'; using '${match.id}' and ignoring ${match.ambiguous.join(', ')}. ` +
                `Reference the full managed key to disambiguate.`);
        }
        if (!match && !this.warnedRefs.has(key) && refShadowedByUserInstance(records, ref)) {
            this.warnedRefs.add(key);
            chatLog().warn(
                `provider reference '${key}' matches only a USER-created provider and was refused. ` +
                `References resolve to operator-registered providers only — a user instance cannot ` +
                `claim a deployment-wide reference. Register it through a provider plugin instead.`);
        }
        return match;
    }

    /**
     * Reference-tolerant wrapper over {@link getProviderRuntime}, for entry points whose provider
     * id comes from deployment config (vision inference, transcription).
     *
     * `getProviderRuntime` itself stays exact-id: it is the credential-dispensing accessor, and
     * its reviewability rests on the id being gated BEING the id the caller named. It is also
     * called with a persisted `session.providerId`, where silently re-pointing a resumed session
     * at some other provider would be a correctness and consent problem, not a convenience.
     *
     * Resolution happens fully BEFORE the gate, so there is exactly one gated call and no
     * fall-through path. The predecessor of this method (`resolveProviderRuntime` in
     * inference.server.ts) instead *speculatively invoked* the gate and searched for an alias on
     * failure, which required a careful `isProviderAccessError` rethrow to stop an ownership or
     * auth-context denial from being retried as an alias lookup — a denial would otherwise have
     * resolved to a DIFFERENT provider, and a "not logged in yet" error would have surfaced as a
     * permanent "no provider matches". That guard is not merely satisfied here, it is unnecessary:
     * the shape that needed it no longer exists.
     */
    async resolveProviderRuntime(ref: string, opts: { ctx: any; userScope?: string | null }): Promise<{ type: ChatProviderTypeRecord; instance: ChatProviderInstanceRecord; config: Record<string, unknown>; secrets: Record<string, unknown> }> {
        const match = this.resolveProviderRef(ref);
        if (!match) {
            const error: any = new Error(describeProviderRefFailure(ref));
            error.code = CHAT_ERR_UNKNOWN_PROVIDER;
            throw error;
        }
        return await this.getProviderRuntime(match.id, opts);
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

    async listModels(providerId: string, args: { ctx: any; contextId?: string | null; userScope?: string | null }): Promise<ModelListing> {
        const runtime = await this.getProviderRuntime(providerId, { ctx: args.ctx, userScope: args.userScope ?? null });
        const adapter = this.getAdapter(runtime.type.adapter);
        if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

        // No credential, no request. `getProviderRuntime` has already merged the
        // operator key, instance overrides and this caller's BYOK key, so this is
        // the one place that can tell "nobody configured a key" from "the key is
        // wrong" — and the former must not travel to the upstream at all.
        const missingSecretKeys = missingRequiredSecrets(runtime.type, runtime.secrets);
        if (missingSecretKeys.length) {
            chatLog('models').debug({
                providerId,
                adapter: runtime.type.adapter,
                missingSecretKeys,
            }, 'model discovery skipped: required credential not configured');
            return { models: [], needsKey: true, missingSecretKeys };
        }

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
                    }, (error: any) => {
                        // Log where the provider identity is still known — the
                        // rejection travels on to the client, but by then it is
                        // just a message. Failures are deliberately NOT cached:
                        // the next call must be free to hit a recovered upstream.
                        chatLog('models').warn({
                            providerId,
                            adapter: runtime.type.adapter,
                            code: error?.code || null,
                        }, 'model discovery failed');
                        throw error;
                    }).finally(() => {
                        this.modelListInFlight.delete(cacheKey);
                    });
                    this.modelListInFlight.set(cacheKey, pending);
                }
                rawModels = await pending;
            }

            return {
                models: (rawModels || []).map((model) =>
                    this.mergeModelCapabilities(providerId, model, model.capabilities || null, args.userScope ?? null)
                ),
            };
        }

        if (runtime.instance.defaultModelId || runtime.type.defaultModelId) {
            const id = runtime.instance.defaultModelId || runtime.type.defaultModelId!;
            return {
                models: [
                    this.mergeModelCapabilities(providerId, {
                        id,
                        label: id,
                    }, null, args.userScope ?? null)
                ],
            };
        }

        return { models: [] };
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
    async previewListModels(typeId: string, args: { ctx: any; contextId?: string | null; draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }): Promise<ModelListing> {
        const type = this.getProviderType(typeId);
        if (!type) throw new Error(`Unknown provider type '${typeId}'.`);
        const adapter = this.getAdapter(type.adapter);
        if (!adapter) throw new Error(`Unknown provider adapter '${type.adapter}'.`);
        if (!adapter.listModels) return { models: [] };

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

        // Same rule as the saved-provider path: an editor draft with no key typed
        // in (and no operator key it is allowed to inherit) probes nothing.
        const missingSecretKeys = missingRequiredSecrets(type, secrets);
        if (missingSecretKeys.length) {
            return { models: [], needsKey: true, missingSecretKeys };
        }


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
        return {
            models: (models || []).map((model) =>
                this.mergeModelCapabilities(instance.id, model, model.capabilities || null, cacheScope)
            ),
        };
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
        const previous = this.sessionStore;
        this.sessionStore = store;
        // The outgoing store may hold timers or open handles. Optional and
        // failure-tolerant: an older third-party store has no dispose(), and a
        // throwing one must not prevent the swap that already happened.
        if (previous !== store && typeof previous?.dispose === 'function') {
            try { previous.dispose(); } catch (e) { chatLog().warn('previous session store dispose() failed', e); }
        }
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
     * and say so. Set `tuning.keepLegacySessions: true` in the module server config to export them first.
     */
    async purgeUnownedSessions(): Promise<number> {
        if (this.unownedPurgeDone) return 0;
        this.unownedPurgeDone = true;
        if (getChatTuning().keepLegacySessions) {
            chatLog('migration').warn('tuning.keepLegacySessions — keeping pre-principal ' +
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
            chatLog('migration').warn('could not purge unowned chat sessions', e);
            return 0;
        }
        if (purged) {
            chatLog('migration').warn(`purged ${purged} chat session(s) with no ownerPrincipal ` +
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

    /**
     * @param options.recentMessageLimit load only the last N messages.
     *
     * A turn needs a ~14-message window, but every `sendTurn` used to copy the
     * entire transcript out of the store just to slice its tail — cost growing
     * with session age, on the hottest path there is. Stores that can answer a
     * tail query directly do so; the rest fall back to the full load and the
     * caller's own slice, so this is transparent to a third-party store.
     */
    async hydrateSession(
        sessionId: string,
        options: { recentMessageLimit?: number } = {},
    ): Promise<ChatSessionHydration> {
        const session = await this.sessionStore.getSession(sessionId);
        if (!session) throw new Error(`Unknown session '${sessionId}'.`);
        const store: any = this.sessionStore;
        const limit = Number(options.recentMessageLimit) > 0 ? Math.floor(Number(options.recentMessageLimit)) : 0;
        const [messages, attachments] = await Promise.all([
            limit && typeof store.listRecentMessages === 'function'
                ? store.listRecentMessages(sessionId, limit)
                : this.sessionStore.listMessages(sessionId),
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

export { ChatServerRegistry, StorageChatSessionStore, StorageUserSecretsStore };
