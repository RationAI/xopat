/**
 * Chat server tuning — one place, sourced from the SERVER CONFIG, not the process
 * environment.
 *
 * Every knob here used to be its own `XOPAT_CHAT_*` env var. That made a
 * deployment un-self-describing (nothing in `env.json` said the chat turn budget
 * had been raised), un-templatable, and invisible to `requiredConfig`. Values now
 * come from the module's server config:
 *
 *   core.server.secure.modules["vercel-ai-chat-sdk"].tuning   (deployer)
 *   modules/vercel-ai-chat-sdk/server.json -> "tuning"        (author, empty by default)
 *
 * Precedence: CHAT_TUNING_DEFAULTS  <  deprecated env var  <  config.
 *
 * That order is what makes the migration non-breaking: a deployment still setting
 * `XOPAT_CHAT_MAX_RETRIES` keeps its value (with a one-time deprecation warning),
 * and only an explicit config entry — a decision someone made — overrides it. It
 * is also why `server.json` ships an EMPTY tuning block instead of restating the
 * defaults: a default written there would read as a decision and silently win.
 *
 * See modules/vercel-ai-chat-sdk/README.md.
 */

export interface ChatTuning {
    /** Whole-turn deadline, deliberately inside the RPC policy timeout. */
    turnBudgetMs: number;
    /** Per-attempt ceiling for a single upstream call. */
    attemptTimeoutMs: number;
    /** SDK retries for transport-level stalls (a clear error never retries). */
    maxRetries: number;
    /** Shared ceiling for the three capability probes. */
    probeBudgetMs: number;
    /** Attachment bytes that may be inlined into a model message. */
    maxInlineAttachmentBytes: number;
    /** Output budget for one assistant turn (shared with reasoning tokens). */
    maxOutputTokens: number;
    /** Byte budget of the decoded-media cache. */
    decodedMediaCacheBytes: number;
    /**
     * Reasoning effort asked of the model (AI SDK 7's portable setting).
     * `provider-default` sends nothing, which for a thinking model means extended
     * thinking — correct answers, but minutes of silence on questions that did not
     * need it. Overridable per provider through instance/type metadata.
     */
    reasoning: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    /** Token streaming. `false` runs sendTurnStream buffered inside the envelope. */
    streaming: boolean;
    /** Session retention. */
    sessionTtlMs: number;
    maxSessions: number;
    maxMessagesPerSession: number;
    maxAttachmentsPerSession: number;
    /** Keep pre-principal (unowned) sessions on migration instead of dropping them. */
    keepLegacySessions: boolean;
}

const MODULE_ID = 'vercel-ai-chat-sdk';

export const CHAT_TUNING_DEFAULTS: ChatTuning = {
    turnBudgetMs: 540_000,
    attemptTimeoutMs: 300_000,
    maxRetries: 1,
    probeBudgetMs: 25_000,
    maxInlineAttachmentBytes: 512 * 1024,
    maxOutputTokens: 16384,
    decodedMediaCacheBytes: 64 * 1024 * 1024,
    reasoning: 'provider-default',
    streaming: true,
    sessionTtlMs: 72 * 60 * 60 * 1000,
    maxSessions: 2000,
    maxMessagesPerSession: 500,
    maxAttachmentsPerSession: 200,
    keepLegacySessions: false,
};

/** Lower bounds — a config typo must not produce a 0ms budget. */
const FLOORS: Partial<Record<keyof ChatTuning, number>> = {
    turnBudgetMs: 30_000,
    attemptTimeoutMs: 15_000,
    maxRetries: 0,
    probeBudgetMs: 5_000,
    maxInlineAttachmentBytes: 16 * 1024,
    maxOutputTokens: 256,
    decodedMediaCacheBytes: 4 * 1024 * 1024,
    sessionTtlMs: 60_000,
    maxSessions: 1,
    maxMessagesPerSession: 1,
    maxAttachmentsPerSession: 0,
};

/** Deprecated env var -> tuning key. Removed once deployments have migrated. */
const LEGACY_ENV: Record<string, keyof ChatTuning> = {
    XOPAT_CHAT_TURN_TIMEOUT_MS: 'turnBudgetMs',
    XOPAT_CHAT_SENDTURN_TIMEOUT_MS: 'turnBudgetMs',
    XOPAT_CHAT_ATTEMPT_TIMEOUT_MS: 'attemptTimeoutMs',
    XOPAT_CHAT_MAX_RETRIES: 'maxRetries',
    XOPAT_CHAT_PROBE_TIMEOUT_MS: 'probeBudgetMs',
    XOPAT_CHAT_MAX_INLINE_ATTACHMENT_BYTES: 'maxInlineAttachmentBytes',
    XOPAT_CHAT_MAX_OUTPUT_TOKENS: 'maxOutputTokens',
    XOPAT_CHAT_DECODED_MEDIA_CACHE_BYTES: 'decodedMediaCacheBytes',
    XOPAT_CHAT_SESSION_TTL_MS: 'sessionTtlMs',
    XOPAT_CHAT_MAX_SESSIONS: 'maxSessions',
    XOPAT_CHAT_MAX_MESSAGES_PER_SESSION: 'maxMessagesPerSession',
    XOPAT_CHAT_MAX_ATTACHMENTS_PER_SESSION: 'maxAttachmentsPerSession',
    XOPAT_CHAT_STREAMING: 'streaming',
    XOPAT_CHAT_KEEP_LEGACY_SESSIONS: 'keepLegacySessions',
};

const warnedEnv = new Set<string>();

function xs(): any {
    return (globalThis as any).XOPAT_SERVER;
}

/** The module's own logger; falls back to console when core is older. */
export function chatLog(sub?: string): any {
    const api = xs();
    const channel = sub ? `module.${MODULE_ID}:${sub}` : `module.${MODULE_ID}`;
    if (api?.log) return api.log(channel);
    const prefix = `[${channel}]`;
    return {
        trace: () => {}, // no broker ⇒ no place for trace-level records
        debug: (...a: any[]) => console.debug(prefix, ...a),
        info: (...a: any[]) => console.log(prefix, ...a),
        warn: (...a: any[]) => console.warn(prefix, ...a),
        error: (...a: any[]) => console.error(prefix, ...a),
        sensitive: () => {},
        isEnabled: () => false,
        child: () => chatLog(sub),
        time: () => () => undefined,
    };
}

function readBool(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return fallback;
}

const REASONING_EFFORTS: ChatTuning['reasoning'][] =
    ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'];

/** A misspelled effort must fall back, not reach the SDK as an invalid literal. */
function readReasoning(value: unknown, fallback: ChatTuning['reasoning']): ChatTuning['reasoning'] {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const match = REASONING_EFFORTS.find((effort) => effort === text);
    if (text && !match) {
        chatLog().warn(`Ignoring unknown tuning.reasoning '${value}'; expected one of ${REASONING_EFFORTS.join(', ')}.`);
    }
    return match || fallback;
}

function readNumber(value: unknown, fallback: number, floor?: number): number {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0) return fallback;
    const rounded = Math.floor(raw);
    return floor === undefined ? rounded : Math.max(floor, rounded);
}

function legacyEnvOverrides(): Partial<Record<keyof ChatTuning, unknown>> {
    const env = (globalThis as any)?.process?.env || {};
    const out: Partial<Record<keyof ChatTuning, unknown>> = {};
    for (const [name, key] of Object.entries(LEGACY_ENV)) {
        const raw = env[name];
        if (raw === undefined || raw === null || raw === '') continue;
        // `XOPAT_CHAT_STREAMING=on` is the documented "leave it alone" value; only
        // an explicit off is an override worth warning about.
        if (name === 'XOPAT_CHAT_STREAMING') {
            out.streaming = String(raw).toLowerCase() !== 'off';
        } else if (name === 'XOPAT_CHAT_KEEP_LEGACY_SESSIONS') {
            out.keepLegacySessions = String(raw) === '1';
        } else {
            out[key] = raw;
        }
        if (!warnedEnv.has(name)) {
            warnedEnv.add(name);
            chatLog().warn(
                `${name} is DEPRECATED and will be removed. Move it to ` +
                `core.server.secure.modules["${MODULE_ID}"].tuning.${key} — see modules/${MODULE_ID}/README.md.`
            );
        }
    }
    return out;
}

let cached: { signature: string; value: ChatTuning } | null = null;

/**
 * The effective tuning.
 *
 * Pass a request `ctx` when you have one (live per-request config); without it the
 * published config snapshot is used, which is what makes this usable from lazily
 * constructed state (stores, caches) that has no request in scope.
 */
export function getChatTuning(ctx?: any): ChatTuning {
    const api = xs();
    let configured: any = {};
    try {
        configured = (ctx && api?.getSecureModuleConfig
            ? api.getSecureModuleConfig(ctx, MODULE_ID)
            : api?.getStaticModuleConfig?.(MODULE_ID)) || {};
    } catch {
        configured = {};
    }
    const tuning = (configured.tuning && typeof configured.tuning === 'object') ? configured.tuning : {};
    const legacy = legacyEnvOverrides();
    // Config wins over the deprecated env vars — an operator who migrated a value
    // must not be silently overridden by a leftover variable in a compose file.
    const merged: Record<string, unknown> = { ...legacy, ...tuning };

    const signature = JSON.stringify(merged);
    if (cached && cached.signature === signature) return cached.value;

    const d = CHAT_TUNING_DEFAULTS;
    const value: ChatTuning = {
        turnBudgetMs: readNumber(merged.turnBudgetMs, d.turnBudgetMs, FLOORS.turnBudgetMs),
        attemptTimeoutMs: readNumber(merged.attemptTimeoutMs, d.attemptTimeoutMs, FLOORS.attemptTimeoutMs),
        maxRetries: readNumber(merged.maxRetries, d.maxRetries, FLOORS.maxRetries),
        probeBudgetMs: readNumber(merged.probeBudgetMs, d.probeBudgetMs, FLOORS.probeBudgetMs),
        maxInlineAttachmentBytes: readNumber(merged.maxInlineAttachmentBytes, d.maxInlineAttachmentBytes, FLOORS.maxInlineAttachmentBytes),
        maxOutputTokens: readNumber(merged.maxOutputTokens, d.maxOutputTokens, FLOORS.maxOutputTokens),
        decodedMediaCacheBytes: readNumber(merged.decodedMediaCacheBytes, d.decodedMediaCacheBytes, FLOORS.decodedMediaCacheBytes),
        reasoning: readReasoning(merged.reasoning, d.reasoning),
        streaming: readBool(merged.streaming, d.streaming),
        sessionTtlMs: readNumber(merged.sessionTtlMs, d.sessionTtlMs, FLOORS.sessionTtlMs),
        maxSessions: readNumber(merged.maxSessions, d.maxSessions, FLOORS.maxSessions),
        maxMessagesPerSession: readNumber(merged.maxMessagesPerSession, d.maxMessagesPerSession, FLOORS.maxMessagesPerSession),
        maxAttachmentsPerSession: readNumber(merged.maxAttachmentsPerSession, d.maxAttachmentsPerSession, FLOORS.maxAttachmentsPerSession),
        keepLegacySessions: readBool(merged.keepLegacySessions, d.keepLegacySessions),
    };
    cached = { signature, value };
    return value;
}
