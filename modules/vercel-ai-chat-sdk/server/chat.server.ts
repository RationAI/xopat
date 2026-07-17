import { generateText } from 'ai';
import { ChatServerRegistry, resolveUserScope, assertProviderAccess } from './chatRegistry.server';
import { createTimeoutLinkedSignal, isAbortError } from './abort-utils';
import { hasToolEnvelopeTokens, recoverToolEnvelopeToScriptFence } from '../shared/tool-envelope';

const FORCE_LLM_DEBUG = /^(1|true|yes|on)$/i.test(String((globalThis as any)?.process?.env?.XOPAT_CHAT_DEBUG || ''));

// Namespaces documented in full in the system prompt. Everything else is listed
// compactly and expanded on demand via `application.describeScriptingApi(...)`.
const CORE_SCRIPT_NAMESPACES = new Set(['application', 'viewer', 'visualization']);

function truncateDebugText(value: string, maxChars = 8_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function serializeDebugValue(value: any, depth = 0): any {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return truncateDebugText(value);
    if (depth >= 8) return '[Max debug depth reached]';
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => serializeDebugValue(item, depth + 1));
    if (typeof value === 'object') {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, 50)) {
            output[key] = serializeDebugValue(item, depth + 1);
        }
        return output;
    }
    return String(value);
}

/**
 * Verbose LLM logging is an OPERATOR switch (XOPAT_CHAT_DEBUG), never a request one.
 *
 * It previously also honoured `input.debugMode` and `session.metadata.debugMode`.
 * Both are attacker-supplied — the RPC input directly, and session metadata
 * because createSession spreads `input.metadata` — so any caller could turn on
 * console logging of full conversation content (potentially PHI) into the server
 * logs. Per §7, a logging/telemetry decision must not be readable from the
 * session bundle. If per-session debug is wanted back, source it from operator
 * config, not from the request.
 */
function isChatDebugEnabled(): boolean {
    return FORCE_LLM_DEBUG;
}

function llmLog(debugEnabled: boolean, label: string, data: any) {
    if (!debugEnabled) return;

    try {
        console.log(`[LLM DEBUG] ${label}`, JSON.stringify(serializeDebugValue(data), null, 2));
    } catch {
        console.log(`[LLM DEBUG] ${label}`, data);
    }
}

function readPositiveEnvInt(name: string, fallback: number): number {
    const raw = Number((globalThis as any)?.process?.env?.[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

const CHAT_SEND_TURN_TIMEOUT_MS = Math.max(
    60_000,
    readPositiveEnvInt(
        'XOPAT_CHAT_TURN_TIMEOUT_MS',
        readPositiveEnvInt('XOPAT_CHAT_SENDTURN_TIMEOUT_MS', 600_000)
    )
);
/**
 * Deadline for the whole turn, deliberately inside the RPC policy timeout above.
 * The RPC layer's abort is cooperative — it answers 504 but cannot stop an
 * in-flight upstream request — so the turn must carry its own deadline and lose
 * the race on purpose: the caller then sees the real upstream error instead of
 * an opaque RPC_TIMEOUT, and the socket is actually torn down.
 */
const CHAT_SEND_TURN_BUDGET_MS = Math.max(30_000, Math.floor(CHAT_SEND_TURN_TIMEOUT_MS * 0.9));
/**
 * Per-attempt ceiling, deliberately GENEROUS: a self-hosted or reasoning model can
 * legitimately think for minutes, and non-streaming completions send no headers
 * until the whole answer is ready — so time-to-first-byte cannot distinguish
 * "slow" from "dead" here, and a tight limit would kill healthy long turns.
 *
 * This is a backstop for a silently stalled connection, not the mechanism for
 * reporting real failures: a clear error (refused connection, bad key, unknown
 * model, oversized context) is not retryable and propagates immediately, long
 * before this elapses.
 */
const CHAT_ATTEMPT_TIMEOUT_MS = Math.max(
    15_000,
    readPositiveEnvInt('XOPAT_CHAT_ATTEMPT_TIMEOUT_MS', 300_000)
);
/**
 * One retry, not the SDK's default 2. Retries only ever fire for errors the SDK
 * deems retryable (i.e. transport stalls), and each one costs a full attempt
 * ceiling — three of them is how a single dead endpoint outlived the RPC timeout.
 */
const CHAT_MAX_RETRIES = readPositiveEnvInt('XOPAT_CHAT_MAX_RETRIES', 1);
/** Shared ceiling for all three capability probes; inside `ensureModelCapabilities`' 30s policy. */
const CHAT_PROBE_BUDGET_MS = Math.max(5_000, readPositiveEnvInt('XOPAT_CHAT_PROBE_TIMEOUT_MS', 25_000));
const CHAT_MAX_INLINE_ATTACHMENT_BYTES = Math.max(
    16 * 1024,
    readPositiveEnvInt('XOPAT_CHAT_MAX_INLINE_ATTACHMENT_BYTES', 512 * 1024)
);
/**
 * Output budget for one assistant turn.
 *
 * This agent writes SCRIPTS, not chat replies: a single turn may legitimately emit a
 * whole questionnaire schema or a multi-stop tour, which runs to thousands of tokens.
 * On reasoning models the budget is shared with reasoning tokens, so a small cap is
 * spent thinking and the code gets truncated mid-statement — a measured turn burned
 * 3417 reasoning + 679 text against a 4096 cap and emitted an unterminated script.
 * Truncated code does not fail loudly; it simply never matches the fence regex and is
 * silently not executed, which reads to the user as "nothing happened".
 */
const CHAT_MAX_OUTPUT_TOKENS = Math.max(
    256,
    readPositiveEnvInt('XOPAT_CHAT_MAX_OUTPUT_TOKENS', 16384)
);

export const policy = {
    ensureModelCapabilities: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 30_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    registerProviderType: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    listProviderTypes: {
        auth: { public: true, requireSession: false },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    createProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    listProviders: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    getProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    updateProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    deleteProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    getProviderUserSecretsStatus: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 16 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    setProviderUserSecrets: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    clearProviderUserSecrets: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 16 * 1024, maxConcurrency: 20, queueLimit: 50 },
    },
    listModels: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    createSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    listSessions: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    getSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 4_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
    },
    renameSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    deleteSession: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    uploadAttachment: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 10_000, maxBodyBytes: 12 * 1024 * 1024, maxConcurrency: 5, queueLimit: 20 },
    },
    appendMessages: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 512 * 1024, maxConcurrency: 10, queueLimit: 50 },
    },
    sendTurn: {
        auth: { public: false, requireSession: true },
        runtime: {
            timeoutMs: CHAT_SEND_TURN_TIMEOUT_MS,
            // Turn payload + the inline messagesDelta that used to travel as a
            // separate appendMessages RPC (which allowed 512k on its own).
            maxBodyBytes: 1024 * 1024,
            maxConcurrency: 5,
            queueLimit: 25,
            circuitBreaker: { key: 'chat-upstream', failureThreshold: 5, resetAfterMs: 30_000 },
        },
    },
} as const;

function getRegistry() {
    return ChatServerRegistry.instance();
}

// Tolerant variant for read/inference paths: no scope simply means "no user
// secrets overlay" instead of a hard failure.
function safeUserScope(ctx: any): string | null {
    try {
        return resolveUserScope(ctx);
    } catch {
        return null;
    }
}

async function requireSessionAccess(ctx: any, sessionId: string): Promise<ChatSessionHydration> {
    const hydrated = await getRegistry().hydrateSession(sessionId);
    const owner = hydrated.session.metadata?.userId ?? null;
    const requester = ctx?.user?.id ?? null;

    // Exact-match ACL: anon→anon and identity→same-identity are the only
    // permitted combinations. The previous code allowed (owner=null,
    // requester=any) which made anon-owned sessions visible to every
    // signed-in user as well.
    if (owner !== requester) {
        if (owner && !requester) {
            throw new Error('Chat session requires an authenticated user.');
        }
        if (!owner && requester) {
            throw new Error('Chat session is anonymous; signed-in users cannot access it.');
        }
        throw new Error('Chat session does not belong to current user.');
    }

    return hydrated;
}

function ensureSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

function summarizePart(part: any) {
    if (!part) return null;
    return {
        type: part.type,
        mimeType: part.mimeType,
        hasDataUrl: !!part.dataUrl,
        hasUrl: !!part.url,
        name: part.name || null,
        dataUrlLen: typeof part.dataUrl === 'string' ? part.dataUrl.length : 0,
    };
}

function summarizeModelPart(part: any) {
    return {
        type: part?.type,
        mediaType: part?.mediaType,
        hasImage: typeof part?.image === 'string' ? true : false,
        imageLen: typeof part?.image === 'string' ? part.image.length : 0,
        hasData: typeof part?.data === 'string' ? true : false,
        dataLen: typeof part?.data === 'string' ? part.data.length : 0,
        filename: part?.filename || null,
        textLen: typeof part?.text === 'string' ? part.text.length : 0,
    };
}

function summarizeModelMessage(msg: any) {
    if (typeof msg?.content === 'string') {
        return { role: msg?.role, contentType: 'string', chars: msg.content.length };
    }
    if (Array.isArray(msg?.content)) {
        return {
            role: msg?.role,
            contentType: 'array',
            parts: msg.content.map(summarizeModelPart),
        };
    }
    return { role: msg?.role, contentType: typeof msg?.content };
}

function isContextWindowError(error: any): boolean {
    const message = String(error?.message || error || '');
    return /context length|context window|ContextWindowExceeded|Requested token count exceeds/i.test(message);
}

function isInvalidImageInputError(error: any): boolean {
    const message = String(error?.message || error || '');
    return /loading IMAGE data|Truncated File Read|ImageData\(url='data:image|invalid image|corrupt image/i.test(message);
}

/**
 * Appended to a reply the provider cut off at the output limit. Addressed to the model
 * as much as the user: next turn this text is in the history, so it must state plainly
 * that the code above never ran and must not be treated as done.
 */
function buildOutputTruncatedGuidance(): string {
    return [
        '',
        '---',
        '**This reply was cut off at the output limit — it is incomplete.**',
        'Any script above is unfinished and was NOT executed. Do not assume it ran.',
        '',
        'Continue by doing LESS per turn:',
        '- emit one script per turn, covering a single step',
        '- build large structures (questionnaires, tours) across several turns',
        '- keep prose to a sentence; spend the budget on the code',
    ].join('\n');
}

function buildContextWindowGuidance(error: any, attemptedMessageCount: number): string {
    const message = String(error?.message || error || '').trim();
    return [
        'The chat request exceeded the model context limit.',
        `The runtime attempted to send ${attemptedMessageCount} message(s), but the provider rejected the prompt as too large.`,
        'Typical causes:',
        '- long accumulated session history',
        '- large returned objects or logs',
        '- screenshot or file data embedded into message text',
        '',
        'Recommended action:',
        '- start a fresh session',
        '- avoid returning raw data URLs or large blobs as plain text',
        '- keep logs and workspace file reads targeted',
        '- ask the harness to continue from a concise summary of findings',
        '',
        `Provider error: ${message}`,
    ].join('\n');
}

function buildInvalidImageInputGuidance(error: any): string {
    const message = String(error?.message || error || '').trim();
    return [
        'The model could not read one of the attached images for this turn.',
        'This usually happens when an invalid or truncated image data URL was added to the chat history.',
        '',
        'Recommended action:',
        '- start a fresh session or retry after removing the broken image-producing turn',
        '- avoid returning image prefixes such as `screenshot.substring(...)` as structured data',
        '- return the full screenshot value or a non-image textual summary instead',
        '- if you need multimodal analysis, attach the full image or screenshot as an image attachment',
        '',
        `Provider error: ${message}`,
    ].join('\n');
}

function builtinPersonalities(): ChatPersonality[] {
    return [
        {
            id: 'default',
            label: 'Default',
            systemPrompt: `
You are an assistant integrated into xOpat pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.
Your users include pathologists, clinicians, students and researchers including IT specialists.

Integration notes:
- You only know what the user explicitly writes in chat, what the "Current viewer state" block reports, and what granted scripting capabilities return.
- You may receive access to a scripting API. Only use explicitly allowed namespaces.
- You MUST NOT guess on facts. If information is missing, ask clarifying questions.
- Do not assume any previous script succeeded unless its result is present in the conversation.
- Do not use scripting for greetings, thanks, simple acknowledgements, or facts already answered by the "Current viewer state" block.
- If the user asks who created something, and the available API does not identify the current user or owner, say so clearly instead of inferring.

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).
If scripting is available and useful, prefer doing the work silently rather than talking about the script itself.
Match the selected personality. For non-technical users, avoid technical language and implementation details unless explicitly requested.
            `.trim(),
        },
        {
            id: 'concise',
            label: 'Concise',
            systemPrompt: `
You are an assistant integrated into xOpat pathology slide viewer's Chat tab.
Be brief, direct, and accurate.

Rules:
- Prefer short answers first.
- Ask only the minimum clarifying question required when information is missing.
- Do not guess or infer missing facts.
- Do not assume previous script execution succeeded unless its result is present in the conversation.
- Do not use scripting for greetings, thanks, or simple acknowledgements.
- If scripting is available and clearly useful, use it silently.
- Do not mention scripts, code blocks, namespaces, or execution unless the user explicitly asks for technical details.
- If the available API cannot prove a fact such as authorship or ownership, say that clearly.

Keep language plain and outcome-focused.
            `.trim(),
        },
        {
            id: 'technical',
            label: 'Technical',
            systemPrompt: `
You are an assistant integrated into xOpat pathology slide viewer's Chat tab.
Behave as a precise, technically strong assistant for advanced users.

Rules:
- Be accurate and explicit about limitations.
- Do not guess. If data is missing, say exactly what is missing.
- Do not assume previous script execution succeeded unless its result is present in the conversation.
- Do not use scripting for greetings, thanks, or simple acknowledgements.
- If scripting is available and useful, prefer using it silently.
- When the user asks for technical details, you may explain implementation details clearly and concretely.
- Never invent namespaces, methods, fields, or viewer capabilities.
- If the available API cannot establish authorship, ownership, or provenance, say so directly.

Prefer precise terminology for technical users, but stay readable.
            `.trim(),
        },
    ];
}

function defaultPersonality(): ChatPersonality {
    return builtinPersonalities()[0]!;
}

function ensureBuiltinPersonalities() {
    const registry = getRegistry();

    for (const personality of builtinPersonalities()) {
        if (!registry.getPersonality(personality.id)) {
            registry.registerPersonality(personality);
        }
    }
}

function buildAttachmentIndex(attachments: ChatAttachmentRecord[] = []): Map<string, ChatAttachmentRecord> {
    return new Map(attachments.map((att) => [att.id, att]));
}

function resolvePartPayload(
    part: any,
    attachmentIndex?: Map<string, ChatAttachmentRecord>
): { source: string; mimeType?: string; name?: string } {
    const attachment = part?.attachmentId ? attachmentIndex?.get(part.attachmentId) : undefined;
    return {
        source: String(part?.dataUrl || part?.url || attachment?.dataUrl || '').trim(),
        mimeType: part?.mimeType || attachment?.mimeType || undefined,
        name: part?.name || attachment?.name || undefined,
    };
}


function coarsenIsoToMinute(value: string | undefined | null): string {
    const raw = String(value || '');
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    parsed.setUTCSeconds(0, 0);
    return parsed.toISOString();
}

/**
 * Decoded-bytes LRU for message media payloads. History replay re-runs
 * `toModelMessage` over the same attachments on every turn (and on every rung of
 * the context-window retry ladder); without this each pass pays a fresh
 * base64 decode per image/file. Keyed by the dataUrl string itself — the key is
 * a reference to a string already retained by the store, so the cache only adds
 * the decoded bytes, bounded by the byte cap below.
 */
const CHAT_DECODED_MEDIA_CACHE_BYTES = Math.max(
    4 * 1024 * 1024,
    readPositiveEnvInt('XOPAT_CHAT_DECODED_MEDIA_CACHE_BYTES', 64 * 1024 * 1024)
);
const decodedMediaCache = new Map<string, { bytes: Uint8Array; mediaType?: string }>();
let decodedMediaCacheBytes = 0;

function dataUrlToBytesCached(value: string | undefined | null): { bytes: Uint8Array | null; mediaType?: string } {
    const raw = String(value || '').trim();
    if (!raw) return { bytes: null };

    const cached = decodedMediaCache.get(raw);
    if (cached) {
        // Refresh recency (Map preserves insertion order).
        decodedMediaCache.delete(raw);
        decodedMediaCache.set(raw, cached);
        return cached;
    }

    const decoded = dataUrlToBytes(raw);
    if (!decoded.bytes) return decoded;

    if (decoded.bytes.byteLength <= CHAT_DECODED_MEDIA_CACHE_BYTES) {
        decodedMediaCache.set(raw, { bytes: decoded.bytes, mediaType: decoded.mediaType });
        decodedMediaCacheBytes += decoded.bytes.byteLength;
        while (decodedMediaCacheBytes > CHAT_DECODED_MEDIA_CACHE_BYTES && decodedMediaCache.size) {
            const oldestKey = decodedMediaCache.keys().next().value as string;
            const evicted = decodedMediaCache.get(oldestKey)!;
            decodedMediaCache.delete(oldestKey);
            decodedMediaCacheBytes -= evicted.bytes.byteLength;
        }
    }
    return decoded;
}

function dataUrlToBytes(value: string | undefined | null): { bytes: Uint8Array | null; mediaType?: string } {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (!match) return { bytes: null };

    const mediaType = match[1] || undefined;
    const base64 = match[2] || '';
    const BufferCtor = (globalThis as any)?.Buffer;
    if (!BufferCtor?.from) return { bytes: null, mediaType };
    const buf = BufferCtor.from(base64, 'base64');
    return { bytes: new Uint8Array(buf), mediaType };
}

function attachmentExceedsInlineLimit(bytes: Uint8Array | null | undefined): boolean {
    return !!bytes && bytes.byteLength > CHAT_MAX_INLINE_ATTACHMENT_BYTES;
}

function ensureBuiltinAdapters() {
    // No built-in provider adapters are registered by core.
    // Provider plugins are responsible for registering their own adapter implementations.
}

function scriptSystemContent(
    allowedScriptApi?: AllowedScriptApiManifest,
    options: { executionMode?: string | null } = {}
): string {
    if (options.executionMode === 'host') {
        return `Dev host execution is available.

Host automation rules:
- Prefer exactly one fenced code block tagged xopat-host-script whenever execution is needed.
- The xopat-host-script body runs as unrestricted async JavaScript in the page context.
- You may access normal page globals directly, including window, document, globalThis, APPLICATION_CONTEXT, VIEWER_MANAGER, VIEWER, USER_INTERFACE, UTILITIES, xserver, singletonModule, and chatModule.
- Host helper functions are injected both as direct globals and under the host object: getServerStatus(), getServerLogs(), readWorkspaceFiles(), getDevSessionBootstrap(), captureViewerScreenshotDataUrl().
- Always explicitly return the final value from xopat-host-script.
- Do not emit xopat-script unless the harness explicitly switches to viewer-script mode.
- Do not claim host helpers are unavailable unless a runtime error explicitly says so.`;
    }

    if (!allowedScriptApi?.namespaces?.length) {
        return [
            'Scripting API access is currently disabled.',
            'Do not produce executable viewer scripts.',
            'Do not call scripting namespaces.',
            'If the user asks for automation, explain that scripting access is not currently granted.',
        ].join('\n');
    }

    // Core namespaces are always documented in full detail; plugin/extension
    // namespaces are only listed compactly (name + method names). The model pulls
    // their full signatures on demand via `application.describeScriptingApi('<ns>')`.
    const renderFullNamespace = (ns: AllowedScriptApiManifest["namespaces"][number]) => {
        const methods = ns.methods.map((method) => {
            const args = (method.params || []).map((p) => `${p.name}: ${p.type}`).join(', ');
            const signature = method.tsSignature || `${method.name}(${args}) => ${method.returns || 'void'}`;
            const description = method.description ? ` - ${method.description}` : '';
            const declaration = method.tsDeclaration ? `
    TS: ${method.tsDeclaration}` : '';
            return `  - ${signature}${description}${declaration}`;
        }).join('\n');
        const namespaceDescription = (ns as any).description ? ` - ${(ns as any).description}` : '';
        const namespaceDeclaration = ns.tsDeclaration ? `
  Namespace TS:
  ${ns.tsDeclaration}` : '';
        return `- namespace ${ns.namespace}${namespaceDescription}${namespaceDeclaration}
${methods}`;
    };

    const renderCompactNamespace = (ns: AllowedScriptApiManifest["namespaces"][number]) => {
        const methodNames = ns.methods.map((m) => m.name).join(', ');
        const namespaceDescription = (ns as any).description ? ` - ${(ns as any).description}` : '';
        return `- namespace ${ns.namespace}${namespaceDescription}
  methods: ${methodNames || '(none)'}`;
    };

    const coreNamespaces = allowedScriptApi.namespaces.filter((ns) => CORE_SCRIPT_NAMESPACES.has(ns.namespace));
    const pluginNamespaces = allowedScriptApi.namespaces.filter((ns) => !CORE_SCRIPT_NAMESPACES.has(ns.namespace));

    const coreText = coreNamespaces.map(renderFullNamespace).join('\n\n');
    const pluginText = pluginNamespaces.length
        ? `\n\nAdditional namespaces (compact catalogue — call \`application.describeScriptingApi('<namespace>')\` to retrieve full signatures before using any of their methods):
${pluginNamespaces.map(renderCompactNamespace).join('\n\n')}`
        : '';
    const namespacesText = `${coreText}${pluginText}`;

    const visualizationGuidance = visualizationNamespaceGuidance(allowedScriptApi);
    const pathologyGuidance = pathologyNamespaceGuidance(allowedScriptApi);

    return `Viewer scripting is available.

### Runtime contract (read first; the runtime enforces this)
- Your script body runs at top level inside an async wrapper. Use \`await\` directly; do not wrap in your own \`async () => { ... }\` IIFE.
- Every namespace method call is proxied to the host and ALWAYS returns a Promise, even when its declared signature looks synchronous (e.g. \`getContextCount(): number\`). Always \`await\` every namespace call:
  ✗  \`const info = application.getGlobalInfo(); for (const c of info) ...\`   // info is a Promise — "not iterable"
  ✓  \`const info = await application.getGlobalInfo();\`
- The runtime only captures the value passed to a top-level \`return\`. Anything else is dropped — including a trailing expression, a Promise that resolves to a value, or the return of an inner function.
  ✗  \`(async () => { return await visualization.getVisualizations(); })()\`     // discards the value
  ✗  \`const x = await visualization.getVisualizations(); x;\`                    // last-expression value is NOT captured
  ✓  \`return await visualization.getVisualizations();\`                          // top-level return — the only thing the runtime sees

Do not use scripting for greetings, thanks, or simple acknowledgements that do not require viewer inspection or action.
Scripting has priority whenever the allowed API can perform the task, inspect state, fetch viewer data, or automate a multi-step action.
When scripting can help, you MUST use it instead of describing manual steps.
Do not assume any previous script succeeded unless its result is explicitly present in the conversation.
If the user asks who created, authored, or owns annotations, comments, or other viewer items, only answer if the available information identifies the current user. Otherwise state the limitation briefly instead of inferring.

Output rules:
- Return exactly one fenced code block with language tag xopat-script: \`\`\`xopat-script ... \`\`\`.
- Do NOT return XML, pseudo-XML, JSON call envelopes, function-call objects, or tags such as <call>, <message>, <start|assistant|>, commentary, or tool-call formats.
- Do NOT say "run this script", "execute this", "here is a script", "use the API", or similar technical wording unless the user explicitly asks for technical details.
- Prefer returning plain JSON-serializable values: string, number, boolean, object, array, or null.
- For user-facing findings, prefer returning a plain object or array with the exact fields you want to inspect next.
- If you produce an image or file, return it together with a short textual summary when possible, for example \`return ["Viewport screenshot captured.", screenshotDataUrl, metadata];\`.
- Do not rely on console output or side effects for feedback. Only the returned value is guaranteed to be passed back.
- If a requested action does not map cleanly to an allowed method, do not invent a method. Ask a brief clarification question or use the closest valid method sequence.
- Assume the application executes xopat-script automatically.
- When the allowed scripting API exposes discovery or documentation methods for the task, inspect those first before mutating state. Prefer exploring available options over guessing field names, layer shapes, or method usage.
- Only the core namespaces below are documented in full. Additional namespaces are listed compactly (name + method names only). Before calling any method of an additional namespace, discover its full signatures first: call that namespace's own \`<namespace>.describeScriptingApi()\` (every namespace exposes this), or \`application.describeScriptingApi('<namespace>')\`. Then use the returned signatures. The set of available namespaces can change while the app runs — if a method is missing or a new capability is announced, re-check via \`describeScriptingApi()\`.
- Discover before you deny. If an allowed namespace lists a method that plausibly does what the user asked (e.g. the user asks to analyze a region and the \`pathology\` namespace exposes an analysis method), you MUST inspect it via \`describeScriptingApi()\` and attempt it — do NOT reply that it "won't work", "has no model", or "isn't configured" without having actually tried. Reported failures come from the runtime's host feedback, not from your assumptions about backend/model configuration. If the user names a model or feature that isn't listed verbatim, treat it as a possibly-misheard alias for the closest available capability rather than declaring it absent.
- Discovery is bounded: at most ONE \`describeScriptingApi()\` call plus ONE real attempt per capability. If the attempt fails, report the runtime's failure text to the user VERBATIM (briefly worded for non-technical users) and stop — never invent an explanation for the failure, never retry the identical call, and never speculate about backend configuration.
- Pathology analysis: do not deliver a definitive clinical diagnosis yourself from visual inspection. When an analysis capability such as \`pathology.analyzeRegion\` is available, use it and present its output as model-assisted findings to support the pathologist's own read, not as a diagnosis.
- For non-technical users, speak naturally about the result or next step, not about the implementation mechanism.
- Do not mention workers, async, namespaces, or code execution unless the user explicitly asks for technical details.
- Never invent namespaces or methods.
- The script must be using plain JavaScript + the allowed scripting API only. Do NOT use TypeScript syntax.
- Do not wrap explanations inside the code block.
- If you need to both explain and execute, put the explanation outside the code block and keep the executable block as the only fenced block.
- After successful tool execution, read the returned host feedback carefully. Host feedback and script-result parts are authoritative observations from the runtime.
- After successful tool execution, if the result contains numbers, measurements, coordinates, zoom values, ratios, or metadata, quote them directly and explain them briefly.

Recommended patterns:
- To inspect viewer contexts: \`const contexts = await application.getGlobalInfo(); return contexts.map(c => ({ contextId: c.contextId, imageName: c.imageName }));\`
- To read metadata from the active viewer: \`const metadata = await viewer.getMetadata(); return metadata;\`
- To select a context before viewer calls: \`await application.setActiveViewer(contextId); const metadata = await viewer.getMetadata(); return { contextId, metadata };\`
- To capture a screenshot with metadata: \`const screenshot = await viewer.getViewportScreenshot(); const metadata = await viewer.getMetadata(); return ["Viewport screenshot captured.", screenshot, metadata];\`
- To report annotations: \`const annotations = await annotationsRead.getAnnotations(); return annotations.map(a => ({ id: a.id, presetID: a.presetID, label: a.label }));\`

If scripting is not needed, answer normally in plain user-facing language.
${visualizationGuidance}${pathologyGuidance}
Allowed scripting API:
${namespacesText}`;
}

/**
 * When the `visualization` namespace is part of the allowed API, inject a
 * compact, prompt-budget-friendly guidance block: the canonical shader-type
 * vocabulary (so the LLM does not invent names like `color-mapping`), one
 * worked example for `colormap` (the most-attempted shader in past
 * sessions), and the dry-run mandate that pairs with
 * `validateProposedVisualization`.
 *
 * The shader list mirrors `schema.$defs.shaderLayers` keys at the time of
 * writing. If the renderer adds new types, the LLM can discover them via
 * `visualization.getSchema()` — this list narrows the guess space, it
 * doesn't gate it.
 */
function visualizationNamespaceGuidance(allowedScriptApi?: AllowedScriptApiManifest): string {
    if (!allowedScriptApi?.namespaces?.length) return '';
    if (!allowedScriptApi.namespaces.some((ns) => ns.namespace === 'visualization')) return '';

    // todo maybe too specific?
    return `
### Visualization namespace — required workflow
- Canonical shader \`type\` values and other syntax details are discoverable by the API - conform to the scheme exactly.
- Shader layer fields: \`id\`, \`type\`, a per-type \`params\` object, and ONE OF \`dataReferences: number[]\` (preferred — persisted form, indexes into \`config.data\`; the host resolves them at render time and can bind sources that are not yet loaded into the viewer world) or \`tiledImages: number[]\` (renderer form, concrete OSD world indices; only use after inspecting \`viewer.world\`). Prefer \`dataReferences\` so the visualization survives across sessions and works for not-yet-loaded data. Do NOT invent names like \`blendMode\`, \`color-mapping\`, \`colorMapping\`, \`source\`, etc. — they are not in the schema.
- For the canonical minimal layer for any type, read \`visualization.getSchema().$defs.shaderLayers.<type>.examples[0]\`. For cross-field invariants (e.g. colormap palette size vs threshold breaks), read \`.x-controlCouplings\` on that schema entry.
- BEFORE \`addVisualization\` / \`updateVisualizationAt\` / \`replaceVisualizations\`, you MUST call \`visualization.validateProposedVisualization(viz)\`. If \`result.ok === false\`, read \`result.schemaErrors\` and \`result.couplingViolations\`, fix the input, and re-validate. Only call the mutating method when \`ok === true\`.
- Inside a layer's \`params\`, each control envelope is discriminated by its own \`type\` field (the SAME field name as the shader layer's \`type\`, just one nesting level deeper — context disambiguates). Do NOT use \`uiType\`.
- For the colormap envelope: \`default\` is the SELECTED palette name and \`mode\` constrains which palettes are valid. Pick \`mode\` to match the palette family — \`singlehue\` for single-colour ramps (Blues, Greens, Greys, Purples, Reds); \`sequential\` for perceptual ramps (Viridis, Plasma, Magma, Inferno, Turbo, Hot, YlGnBu, etc.); \`diverging\` for two-ended ramps (RdBu, BrBG, PiYG, Spectral, etc.); \`qualitative\` for categorical sets (Set1, Set2, Paired, Dark2, Accent, etc.). A \`default\` not in the chosen \`mode\`'s group is silently substituted with that mode's default and the user sees the wrong colour. Read \`visualization.getSchema()\` if unsure which group a palette belongs to.
- If the user declines the visualization review without sending feedback (the script error contains "declined the proposal without giving feedback"), do NOT silently retry with a different shader or palette. Ask the user one short clarifying question — what they wanted different — and only re-propose after they answer.
- Worked example (colormap rendering channel-0 intensity in Blues with two breaks → three steps):
  \`\`\`
  const viz = {
    name: "Blue intensity overlay",
    shaders: { L1: {
      id: "L1", type: "colormap", dataReferences: [0],
      params: {
        color:     { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
        threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
        connect: true,
      },
    } },
  };
  const check = await visualization.validateProposedVisualization(viz);
  if (!check.ok) return { error: "validation failed", details: check };
  return await visualization.addVisualization(viz, { makeActive: true });
  \`\`\`
`;
}

//TODO: We might want to have this as part of the respective module, not here.. on the other side this is
//   a crucial part of the interaction with LLM, so for now keeping it here
/**
 * When the `pathology` namespace is allowed, inject the orient-first playbook so
 * the agent behaves like a pathologist opening a case: get a whole-slide overview,
 * find the actual tissue, then drill in — instead of navigating blind and framing
 * empty glass. `exploreSlide` returns the ranked tissue regions the agent must
 * navigate to; this block encodes the workflow and the coverage-semantics gotcha.
 */
function pathologyNamespaceGuidance(allowedScriptApi?: AllowedScriptApiManifest): string {
    if (!allowedScriptApi?.namespaces?.length) return '';
    if (!allowedScriptApi.namespaces.some((ns) => ns.namespace === 'pathology')) return '';

    return `
### Pathology namespace — orient before you navigate
- For ANY question about what is on a slide, or before navigating to "the tissue"/"a region"/"a tumour", FIRST call \`pathology.exploreSlide()\`. It fits the whole slide, detects tissue, and returns \`regions\` (tissue islands ranked largest-first, each with a \`bounds\` box), whole-slide \`slideCoverage\`, and slide metadata (dimensions, µm/px, native magnification).
- Navigate ONLY to detected tissue: \`await viewer.frameImageRegion(regions[i].bounds)\`. NEVER zoom to guessed or arbitrary coordinates — that lands on empty glass.
- If \`isComplete\` is false, the overview ran on partially-loaded tiles: the numbers are provisional and likely understated — say so and offer to re-run; do NOT conclude the slide is blank.
- If \`isComplete\` is true and \`slideCoverage\` is ~0 or \`regions\` is empty, tell the user the slide looks blank / has no detectable tissue. Do NOT keep hunting for something to show.
- Coverage semantics — every result names its own scope (\`coverageScope\`): \`exploreSlide.slideCoverage\` is WHOLE-SLIDE; \`annotateTissue.viewCoverage\` is CURRENT-VIEW; \`tissueCoverage.annotationTissueFraction\` is the ANNOTATION's tissue share and \`fractionOfViewTissue\` is the annotation's share of the visible tissue. Quote the number together with its scope.
- The overview is low-resolution, so \`regions[i].bounds\` are approximate (\`isApproximate: true\`). To outline a region precisely, frame it first, then call \`annotateTissue()\` at that zoom.
- To go through tissue region by region ("review the slide", "check each area"), call \`pathology.reviewRegions({ max, feature })\` — it frames each region and runs the job (default \`analyze\`), returning one result per region. Prefer it over hand-rolling a navigation loop.
- For a BROAD question that needs a map of the whole slide ("where are the regions with X?", "find areas that look like Y", "give me an expert walkthrough"), do NOT hand-loop. First call \`pathology.getOverview()\`; if it returns a tree, answer from it (each node has \`findings\`, \`interest\`, and a \`bounds\` to navigate to with \`viewer.frameImageRegion(node.bounds)\`). If it is null, or its \`query\`/\`builtAtIso\` no longer fits, or \`budget.truncated\` is true, call \`pathology.buildOverview({ query: "X" })\` ONCE — it orients, describes and scores the tissue islands, and drills into the interesting ones on a budget, caching the result. When \`budget.truncated\` is true, tell the user the overview is partial and offer to extend it.
- Rank your answer and build region links from the result's \`ranked\` array (focal regions, highest-interest first) — each \`ranked[i].bounds\` is a tight, on-slide window; map it straight into a region link (bounds {x,y,width,height} → x,y,w,h). Do NOT link the coarse depth-0 \`root\` boxes: they are whole tissue islands and framing them just shows the slide. Never fabricate or "recentre" coordinates — use the bounds as given.
- \`segmentAtPoint\` results carry a \`status\`: "empty" is a genuine negative (nothing segmentable there); "rejected-oversegmented" means the run FAILED validation — report it as a failed attempt, never as a finding about the tissue.
- Present any \`analyzeRegion\`/\`reviewRegions\`/\`hint\` output as model-assisted findings that support the pathologist's own read — never as a definitive diagnosis.
`;
}

const LIVE_VIEWER_CONTEXT_MAX_VIEWERS = 32;
const LIVE_VIEWER_CONTEXT_MAX_NAMESPACES = 32;
const LIVE_VIEWER_CONTEXT_MAX_DRIVERS = 16;
const LIVE_VIEWER_CONTEXT_MAX_FEATURES = 32;
const LIVE_VIEWER_CONTEXT_MAX_STRING = 160;
const LIVE_VIEWER_CONTEXT_MAX_ISO = 64;
const LIVE_VIEWER_CONTEXT_MAX_ZSTACK_LABELS = 64;

function isPlainObject(value: any): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowedKeys: string[], label: string): void {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`Invalid liveViewerContext: unexpected ${label}.${key}`);
    }
}

function requireBoundedString(value: unknown, maxLen: number, label: string): string {
    if (typeof value !== 'string') throw new Error(`Invalid liveViewerContext: ${label} must be a string`);
    if (!value || value.length > maxLen) throw new Error(`Invalid liveViewerContext: ${label} length out of bounds`);
    return value;
}

function requireNullableBoundedString(value: unknown, maxLen: number, label: string): string | null {
    if (value == null) return null;
    return requireBoundedString(value, maxLen, label);
}

function requireBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`Invalid liveViewerContext: ${label} must be boolean`);
    return value;
}

function requireFiniteOptionalNumber(value: unknown, label: string): number | null | undefined {
    if (value == null) return value as null | undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Invalid liveViewerContext: ${label} must be a finite number`);
    }
    return value;
}

function validateLiveViewerContextZStack(value: unknown, label: string): LiveViewerContextZStack | null {
    if (value == null) return null;
    if (!isPlainObject(value)) throw new Error(`Invalid liveViewerContext: ${label} must be an object or null`);
    assertExactKeys(value, ['count', 'index', 'spacingUm', 'labels'], label);
    if (typeof value.count !== 'number' || !Number.isFinite(value.count)) {
        throw new Error(`Invalid liveViewerContext: ${label}.count must be a finite number`);
    }
    if (typeof value.index !== 'number' || !Number.isFinite(value.index)) {
        throw new Error(`Invalid liveViewerContext: ${label}.index must be a finite number`);
    }
    return {
        count: value.count,
        index: value.index,
        spacingUm: requireFiniteOptionalNumber(value.spacingUm, `${label}.spacingUm`) ?? null,
        labels: value.labels == null
            ? null
            : requireBoundedArray(
                value.labels,
                LIVE_VIEWER_CONTEXT_MAX_ZSTACK_LABELS,
                `${label}.labels`,
                (item, index) => requireBoundedString(item, LIVE_VIEWER_CONTEXT_MAX_STRING, `${label}.labels[${index}]`)
            ),
    };
}

function validateLiveViewerContextOverview(value: unknown, label: string): LiveViewerContextOverview | null {
    if (value == null) return null;
    if (!isPlainObject(value)) throw new Error(`Invalid liveViewerContext: ${label} must be an object or null`);
    assertExactKeys(
        value,
        ['regionsDescribed', 'depth', 'slideCoverage', 'isComplete', 'truncated', 'builtAtIso', 'query', 'gist',
            'contextKnown', 'warningCount'],
        label
    );
    const requireFiniteNumber = (v: unknown, l: string): number => {
        if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid liveViewerContext: ${l} must be a finite number`);
        return v;
    };
    return {
        regionsDescribed: requireFiniteNumber(value.regionsDescribed, `${label}.regionsDescribed`),
        depth: requireFiniteNumber(value.depth, `${label}.depth`),
        slideCoverage: requireFiniteNumber(value.slideCoverage, `${label}.slideCoverage`),
        isComplete: requireBoolean(value.isComplete, `${label}.isComplete`),
        truncated: requireBoolean(value.truncated, `${label}.truncated`),
        builtAtIso: requireBoundedString(value.builtAtIso, LIVE_VIEWER_CONTEXT_MAX_ISO, `${label}.builtAtIso`),
        query: requireNullableBoundedString(value.query, LIVE_VIEWER_CONTEXT_MAX_STRING, `${label}.query`),
        gist: requireNullableBoundedString(value.gist, LIVE_VIEWER_CONTEXT_MAX_STRING, `${label}.gist`),
        contextKnown: requireBoolean(value.contextKnown, `${label}.contextKnown`),
        warningCount: requireFiniteNumber(value.warningCount ?? 0, `${label}.warningCount`),
    };
}

function requireBoundedArray<T>(
    value: unknown,
    maxItems: number,
    label: string,
    mapItem: (item: unknown, index: number) => T
): T[] {
    if (!Array.isArray(value)) throw new Error(`Invalid liveViewerContext: ${label} must be an array`);
    if (value.length > maxItems) throw new Error(`Invalid liveViewerContext: ${label} exceeds item limit`);
    return value.map(mapItem);
}

function validateLiveViewerContextSnapshot(input?: LiveViewerContext): LiveViewerContext | undefined {
    if (input == null) return undefined;
    if (!isPlainObject(input)) throw new Error('Invalid liveViewerContext: expected an object');
    assertExactKeys(
        input,
        ['composedAt', 'activeViewerId', 'viewerCount', 'viewers', 'loadedNamespaces', 'pathologyDrivers'],
        'root'
    );

    const viewers = requireBoundedArray(input.viewers, LIVE_VIEWER_CONTEXT_MAX_VIEWERS, 'viewers', (item, index) => {
        if (!isPlainObject(item)) throw new Error(`Invalid liveViewerContext: viewers[${index}] must be an object`);
        assertExactKeys(item, ['contextId', 'imageName', 'isActive', 'background', 'zoom', 'magnification', 'zStack', 'pathologyOverview'], `viewers[${index}]`);
        return {
            contextId: requireBoundedString(item.contextId, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].contextId`),
            imageName: requireBoundedString(item.imageName, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].imageName`),
            isActive: requireBoolean(item.isActive, `viewers[${index}].isActive`),
            background: requireNullableBoundedString(item.background, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].background`),
            zoom: requireFiniteOptionalNumber(item.zoom, `viewers[${index}].zoom`),
            magnification: requireFiniteOptionalNumber(item.magnification, `viewers[${index}].magnification`),
            zStack: validateLiveViewerContextZStack(item.zStack, `viewers[${index}].zStack`),
            pathologyOverview: validateLiveViewerContextOverview(item.pathologyOverview, `viewers[${index}].pathologyOverview`),
        };
    });

    const loadedNamespaces = requireBoundedArray(
        input.loadedNamespaces,
        LIVE_VIEWER_CONTEXT_MAX_NAMESPACES,
        'loadedNamespaces',
        (item, index) => {
            if (!isPlainObject(item)) throw new Error(`Invalid liveViewerContext: loadedNamespaces[${index}] must be an object`);
            assertExactKeys(item, ['name', 'granted'], `loadedNamespaces[${index}]`);
            return {
                name: requireBoundedString(item.name, LIVE_VIEWER_CONTEXT_MAX_STRING, `loadedNamespaces[${index}].name`),
                granted: requireBoolean(item.granted, `loadedNamespaces[${index}].granted`),
            };
        }
    );

    const pathologyDrivers = input.pathologyDrivers == null
        ? undefined
        : requireBoundedArray(input.pathologyDrivers, LIVE_VIEWER_CONTEXT_MAX_DRIVERS, 'pathologyDrivers', (item, index) => {
            if (!isPlainObject(item)) throw new Error(`Invalid liveViewerContext: pathologyDrivers[${index}] must be an object`);
            assertExactKeys(item, ['id', 'label', 'local', 'features'], `pathologyDrivers[${index}]`);
            return {
                id: requireBoundedString(item.id, LIVE_VIEWER_CONTEXT_MAX_STRING, `pathologyDrivers[${index}].id`),
                label: requireBoundedString(item.label, LIVE_VIEWER_CONTEXT_MAX_STRING, `pathologyDrivers[${index}].label`),
                local: requireBoolean(item.local, `pathologyDrivers[${index}].local`),
                features: requireBoundedArray(
                    item.features,
                    LIVE_VIEWER_CONTEXT_MAX_FEATURES,
                    `pathologyDrivers[${index}].features`,
                    (feature, featureIndex) =>
                        requireBoundedString(
                            feature,
                            LIVE_VIEWER_CONTEXT_MAX_STRING,
                            `pathologyDrivers[${index}].features[${featureIndex}]`
                        )
                ),
            };
        });

    const activeViewerId = requireNullableBoundedString(input.activeViewerId, LIVE_VIEWER_CONTEXT_MAX_STRING, 'activeViewerId');
    if (typeof input.viewerCount !== 'number' || !Number.isFinite(input.viewerCount)) {
        throw new Error('Invalid liveViewerContext: viewerCount must be a finite number');
    }

    return {
        composedAt: requireBoundedString(input.composedAt, LIVE_VIEWER_CONTEXT_MAX_ISO, 'composedAt'),
        activeViewerId,
        viewerCount: viewers.length,
        viewers,
        loadedNamespaces,
        pathologyDrivers,
    };
}

/**
 * Render the client-composed live viewer-state snapshot into a system-prompt
 * segment. The block is authoritative and recomputed every turn: it lets the
 * model answer basic viewer-state questions (open slides, active viewer, zoom,
 * capabilities) directly instead of burning a script step on discovery, and it
 * defeats stale-viewer assumptions when the user switches viewports mid-session.
 */
function liveViewerContextSystemContent(ctx?: LiveViewerContext): string {
    if (!ctx || !Array.isArray(ctx.viewers)) return '';

    // Minute precision, deliberately: identical viewer state must render a
    // byte-identical block, or the timestamp alone defeats prompt caching across
    // the steps of one assistant loop. The model gains nothing below a minute.
    const composedAt = coarsenIsoToMinute(ctx.composedAt);
    const MAX_LISTED_VIEWERS = 8;
    const listed = ctx.viewers.slice(0, MAX_LISTED_VIEWERS);
    const omitted = ctx.viewers.length - listed.length;
    const viewerStateSummary = {
        composedAt,
        activeViewerId: ctx.activeViewerId,
        viewerCount: ctx.viewers.length,
        viewers: listed.map((viewer) => ({
            contextId: viewer.contextId,
            imageName: viewer.imageName,
            isActive: viewer.isActive,
            background: viewer.background ?? null,
            zoom: viewer.zoom ?? null,
            magnification: viewer.magnification ?? null,
            zStack: viewer.zStack ?? null,
            pathologyOverview: viewer.pathologyOverview ?? null,
        })),
        loadedNamespaces: ctx.loadedNamespaces.map((namespace) => ({
            name: namespace.name,
            granted: namespace.granted,
        })),
        pathologyDrivers: (ctx.pathologyDrivers || []).map((driver) => ({
            id: driver.id,
            label: driver.label,
            local: driver.local,
            features: driver.features,
        })),
    };
    const omissionLine = omitted > 0
        ? `Only the first ${listed.length} viewer(s) are listed here; ${omitted} additional viewer(s) are omitted from this block. Call application.getGlobalInfo() if you explicitly need the full list.`
        : '';

    const activeViewerLine = ctx.activeViewerId
        ? `Active viewer: ${ctx.activeViewerId}.`
        : 'Active viewer: none/ambiguous — ask the user or call application.setActiveViewer(contextId) before viewer.* calls.';

    return `### Current viewer state (authoritative — recomputed this turn; do NOT re-query it)
This block is the live, ground-truth viewer state as of ${composedAt}.
Answer questions about open slides, the active slide/viewer, zoom, background, and available capabilities DIRECTLY from this block — do NOT run a script (e.g. application.getGlobalInfo) just to learn these facts; they are already here.
Script only when the user asks for something not covered below, or to act on the slide.
If a past turn mentions a different slide or viewer than this block, THIS block wins — the user has changed the workspace since.
${activeViewerLine}
Each viewer's "zStack" is its focal-plane state: null means a single-plane slide; otherwise {count, index, spacingUm, labels} describes the available focal planes and the one currently shown. To change planes use viewer.setZDepth(index) or viewer.stepZDepth(delta) — do not re-query viewer.getZStack() for facts already in this block.
Each viewer's "pathologyOverview" (when non-null) means a hierarchical expert overview of that slide is ALREADY CACHED (regionsDescribed described regions, built for "query"). For a broad "where are the regions with X?" / "walk me through the slide" question, call pathology.getOverview() to read that cached tree and answer + navigate from it — it is free. Do NOT rebuild with pathology.buildOverview unless the user asks for a fresh scan, or the cached tree genuinely cannot answer them (absent, its "query" no longer fits, or "truncated" is true).
A null "pathologyOverview" means no scan has been run — the normal state, and NOT a reason to start one. Scanning a slide (pathology.buildOverview / reviewRegions) drives the viewport around and costs many slow vision calls — MINUTES the user waits through. Start one ONLY when the user's own message clearly asks to explore/scan/survey the slide or to find and rank regions. Never scan to look busy, to double-check yourself, to gather background for a different question, or because it might be useful. For a question about what is currently on screen use pathology.analyzeRegion (one call). If you believe a scan would help but the user did not ask for one, say so in a single sentence and let them answer.
An overview's "contextKnown": false means it was built WITHOUT knowing the slide's stain or specimen site, so its findings are structure-only and its scores are weak evidence — do not present them as a confident read. Note that pathology.buildOverview asks BEFORE it walks: when it cannot establish the slide's stain/site it returns {status: "context-required", missing: [...]} without analysing anything, so ask the user for exactly those fields in ONE bundled question and call it again with context set (or context: "unknown" if they cannot say). Do not narrate this refusal as an error or a failure — it is the tool waiting for one answer from the user. A non-zero "warningCount" means the overview carries caveats — read them from the result's "warnings" and pass them on. Never state or imply a staining/marker result the slide's stain cannot produce, and never name an organ the user or the slide has not established.
Any scripting namespace tagged "granted": false is NOT usable until the user enables it in chat settings. Pathology drivers listed below are configured and ready — do not re-check their availability.

Structured viewer state:
\`\`\`json
${JSON.stringify(viewerStateSummary, null, 2)}
\`\`\`
${omissionLine}`;
}

/**
 * Directive teaching the model the in-chat region-link contract: whenever it talks
 * about a specific place on a slide it must embed a clickable `#xopat-region?...`
 * markdown link instead of a plain-text description. The client (ChatMessageList)
 * turns these into navigation affordances that frame the region in the right viewer;
 * coordinates round-trip in level-0 image pixels — the same space as annotation
 * coordinates, pathology `bounds`, and `viewer.frameImageRegion(...)`.
 */
function regionLinkSystemContent(): string {
    return `### Region links — how you point the user at a place on a slide
Whenever you refer to a specific location or region on a slide — a detected tissue region, an annotation, a measurement site, a segmentation result, a finding, or any coordinates you inspected — do NOT describe the location only in words. Embed a clickable region link the user can follow to navigate there:
  [short label](#xopat-region?viewer=<contextId>&x=<x>&y=<y>&w=<w>&h=<h>&z=<planeIndex>)
Rules:
- x, y, w, h are integers in level-0 image pixels of that viewer's slide — the same coordinate space as annotation coordinates, pathology region \`bounds\` ({x, y, width, height} maps to x, y, w, h), and \`viewer.frameImageRegion(...)\`. x,y is the region's top-left corner; w,h its size. For a single point of interest use w=0&h=0.
- viewer is the contextId exactly as given in the "Current viewer state" block or by application.getGlobalInfo(). Omit the viewer parameter only when a single viewer is open.
- z is the 0-based focal-plane index and applies ONLY to z-stack slides (the viewer's "zStack" in the viewer state is non-null). Include it whenever the finding is tied to a specific focal plane (e.g. the plane you inspected it on); the link then switches the plane before framing. Omit z for single-plane slides and when the current plane is the right one.
- The label is short human-readable text (e.g. "region 2", "the largest tissue fragment", "this annotation"); never show the raw URL, and only mention numeric coordinates when the user asks for them.
- The application renders this link as a click-to-navigate control — emitting it IS how you take the user to a region, so never claim you cannot navigate them there.
- Only link coordinates you actually obtained from script results, annotations, or the viewer state. Never invent coordinates; without real ones, describe the finding and offer to locate it first.`;
}

function sessionPreamble(
    providerId: string,
    allowedScriptApi?: AllowedScriptApiManifest,
    options: { executionMode?: string | null } = {}
): string {
    const scriptNamespaces = allowedScriptApi?.namespaces?.map((n) => n.namespace).join(', ') || 'none';
    const executionLines = options.executionMode === 'host'
        ? [
            'Current execution mode:',
            '- Host JavaScript execution is enabled for this dev session.',
            '- Viewer scripting namespaces are not the primary execution path.',
        ].join('\n')
        : `Current session:
- Provider: ${providerId}
- Allowed scripting namespaces: ${scriptNamespaces}`;
    return `You are an assistant integrated into a pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.
Your users include pathologists, clinicians, students and researchers including IT specialists.

Integration notes:
- You only know what the user explicitly writes in chat, what the "Current viewer state" block reports, and what granted scripting capabilities return.
- When a "Current viewer state" block is present, answer simple factual questions about the viewer (how many/which slides are open, which is active, current zoom, which capabilities exist) DIRECTLY from it, with NO script step. The block is refreshed every turn and overrides anything older in the conversation.
- You may receive access to a scripting API. Only use explicitly allowed namespaces.
- You MUST NOT guess on facts. If information is missing, ask clarifying questions — ask at most ONE, bundling everything you need into it; do not drip-feed questions across turns.
- Do not use scripting for greetings, thanks, simple acknowledgements, or facts already answered by the "Current viewer state" block.
- Do not assume any previous script succeeded unless its result is explicitly present in the conversation.
- If the user asks who created, authored, or owns annotations, comments, or other viewer items, only answer if the available information identifies the current user. Otherwise state the limitation briefly instead of inferring.
- Messages may be dictated via speech-to-text and can contain recognition errors, wrong-language fragments, or background-noise artifacts. A very short, out-of-context, or oddly-worded fragment is likely a misrecognition, not a real request — do not earnestly build a full answer around it; ask one brief clarifying question. Keep replying in the user's established working language; do not switch languages to match a single stray fragment.
- Never state that a namespace, method, model, or capability is unavailable, missing, or "not configured" based on assumption. If any allowed namespace plausibly covers the request, inspect it (see the scripting discovery rules) before answering. A capability, tool, or model name the user gives that is not an exact match may be an approximate or misheard name — map it to the closest real capability and try it, rather than denying it outright.

${executionLines}

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).
If scripting is available and useful, prefer doing the work silently rather than talking about the script itself.
Match the selected personality. For non-technical users, avoid technical language and implementation details unless explicitly requested.`;
}

function summarizeForTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((m) => m.role === 'user');
    const text = coerceMessageText(firstUser || null).trim();
    if (!text) return 'New chat';
    return text.slice(0, 80);
}

/**
 * The auto-title derives from the FIRST user message only (see summarizeForTitle),
 * so once a real title exists it can never change — recomputing it per turn was a
 * full listMessages copy+scan for a guaranteed no-op. Returns undefined when no
 * title update is needed.
 */
async function resolveAutoTitle(
    sessionStore: { listMessages(sessionId: string): Promise<ChatMessage[]> },
    session: ChatSession
): Promise<string | undefined> {
    if (session.metadata?.manualTitle) return undefined;
    const current = String(session.title || '').trim();
    if (current && current !== 'New chat') return undefined;
    const title = summarizeForTitle(await sessionStore.listMessages(session.id));
    return title !== current ? title : undefined;
}

function coerceMessageText(message: ChatMessage | null | undefined): string {
    if (!message) return '';
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    const parts = message.parts || [];
    return parts.map((part) => {
        switch (part.type) {
            case 'text': return part.text;
            case 'host-feedback': return part.text;
            case 'capability-notice': return part.text;
            case 'script-result': return part.text;
            case 'image': return `[Image: ${part.name || part.mimeType}]`;
            case 'file': return `[File: ${part.name}]`;
            default: return '';
        }
    }).filter(Boolean).join('\n');
}

function normalizeIncomingMessage(message: ChatMessage): ChatMessage {
    if (message.parts?.length) {
        return {
            ...message,
            content: message.content || coerceMessageText(message),
            createdAt: message.createdAt || new Date().toISOString(),
        };
    }
    if (typeof message.content === 'string') {
        return {
            ...message,
            parts: [{ type: 'text', text: message.content }],
            createdAt: message.createdAt || new Date().toISOString(),
        };
    }
    return {
        ...message,
        parts: [],
        content: '',
        createdAt: message.createdAt || new Date().toISOString(),
    };
}

function stripDataUrlPrefix(value: string | undefined | null): { mediaType?: string; data: string } {
    const raw = String(value || '').trim();
    const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i);
    if (match) {
        return { mediaType: match[1] || undefined, data: match[2] || '' };
    }
    return { data: raw };
}

function stripAssistantReasoning(text: string): string {
    return String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripHarmonyTokens(text: string): string {
    // Residue of native channel/tool-call markers. Anything carrying a recoverable script has
    // already been rewritten into an xopat-script fence by `sanitizeAssistantOutput` — what
    // reaches here is reasoning channels and envelopes with no usable payload. Strip so they
    // don't leak into stored history or the next model input.
    return String(text || '')
        .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi, '')
        .replace(/functions\.xopat-(?:host-)?script\s*:\s*\d+\s*<\|tool_call_argument_begin\|>[\s\S]*?(?:<\|tool_call_end\|>|$)/gi, '')
        .replace(/<\|tool_call_argument_begin\|>\s*{[\s\S]*?}\s*(?:<\|tool_call_end\|>|$)/gi, '')
        .replace(/<\|start\|>[a-z_]+(?:<\|channel\|>[^<]*)?(?:<\|message\|>[\s\S]*?)?(?:<\|call\|>|<\|end\|>|$)/gi, '')
        .replace(/<\|(?:start|end|message|channel|call|tool_call_(?:argument_)?(?:begin|end)|tool_calls_section_(?:begin|end))\|>/gi, '')
        .trim();
}

/**
 * Recover first, strip second — order is load-bearing.
 *
 * A model that encodes its call as native tool-call tokens has still produced a valid script;
 * only the surface is wrong. Stripping first deleted the `{"code": ...}` payload along with the
 * envelope, leaving just the model's prose — the client then found no script, treated the reply
 * as a final answer, and the run ended mid-task with no error.
 */
function sanitizeAssistantOutput(text: string): { text: string; recovered: boolean } {
    const { text: recoveredText, recovered } = recoverToolEnvelopeToScriptFence(String(text || ''));
    return { text: stripAssistantReasoning(stripHarmonyTokens(recoveredText)), recovered };
}

function isHarmonyStyleModel(modelId: string | null | undefined, providerTypeId?: string | null): boolean {
    const haystack = `${String(modelId || '')} ${String(providerTypeId || '')}`.toLowerCase();
    return /\bgpt[-_ ]?oss\b/.test(haystack)
        || /\bharmony\b/.test(haystack)
        || /\bopenchat[-_ ]?harmony\b/.test(haystack);
}

function sanitizeMessageForModel(message: ChatMessage): ChatMessage {
    const metadata = (message as any)?.metadata || {};
    const contentText = typeof message.content === 'string'
        ? message.content
        : coerceMessageText(message);

    if (message.role === 'assistant') {
        // Recovery applies to replayed history too: the fence is the canonical stored form, so
        // the model sees its own past call in the shape this runtime accepts rather than a
        // mutilated copy of it.
        const { text: cleaned } = sanitizeAssistantOutput(contentText);
        if (cleaned !== contentText) {
            return {
                ...message,
                content: cleaned,
                parts: [{ type: 'text', text: cleaned }],
                metadata: {
                    ...metadata,
                    sanitizedForModel: true,
                    sanitizedReason: 'assistant-reasoning-or-harmony-strip',
                } as any,
            };
        }
    }

    return message;
}

function toModelMessage(
    message: ChatMessage,
    attachmentIndex?: Map<string, ChatAttachmentRecord>,
    capabilities?: ModelCapabilities | null
) {
    const parts = message.parts || (message.content ? [{ type: 'text', text: message.content }] : []);
    const hasMediaParts = parts.some((part: any) => part?.type === 'image' || part?.type === 'file');
    const role = message.role === 'tool'
        ? 'user'
        : (message.role === 'assistant' && hasMediaParts ? 'user' : message.role);

    if (role === 'system') {
        return {
            role: 'system',
            content: typeof message.content === 'string' && message.content.trim()
                ? message.content
                : coerceMessageText(message),
        } as any;
    }

    const content = parts.map((part) => {
        switch (part.type) {
            case 'text':
                return { type: 'text', text: part.text } as const;
            case 'host-feedback':
                return { type: 'text', text: `[host-feedback] ${part.text}` } as const;
            case 'capability-notice':
                return { type: 'text', text: `[system notice] ${part.text}` } as const;
            case 'script-result': {
                const tag = (part as any).ok === false ? 'script-error' : 'script-result';
                return { type: 'text', text: `[${tag}] ${part.text}` } as const;
            }

            case 'image': {
                if (!mediaAllowedForModel('image', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[Image omitted for non-multimodal model: ${part.name}]` : '[Image omitted for non-multimodal model]',
                    } as const;
                }

                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytesCached(resolved.source);

                if (inline.bytes) {
                    if (attachmentExceedsInlineLimit(inline.bytes)) {
                        return {
                            type: 'text',
                            text: resolved.name
                                ? `[Image omitted because it exceeds the inline prompt budget: ${resolved.name}]`
                                : '[Image omitted because it exceeds the inline prompt budget]',
                        } as const;
                    }
                    return {
                        type: 'image',
                        image: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'image/*',
                    } as const;
                }

                if (/^https?:\/\//i.test(resolved.source)) {
                    return {
                        type: 'image',
                        image: resolved.source,
                        mediaType: resolved.mimeType || 'image/*',
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[Image unavailable: ${resolved.name}]` : '[Image unavailable]',
                } as const;
            }

            case 'file': {
                if (!mediaAllowedForModel('file', capabilities)) {
                    return {
                        type: 'text',
                        text: part.name ? `[File omitted for unsupported model: ${part.name}]` : '[File omitted for unsupported model]',
                    } as const;
                }
                const resolved = resolvePartPayload(part, attachmentIndex);
                const inline = dataUrlToBytesCached(resolved.source);

                if (inline.bytes) {
                    if (attachmentExceedsInlineLimit(inline.bytes)) {
                        return {
                            type: 'text',
                            text: resolved.name
                                ? `[File omitted because it exceeds the inline prompt budget: ${resolved.name}]`
                                : '[File omitted because it exceeds the inline prompt budget]',
                        } as const;
                    }
                    return {
                        type: 'file',
                        data: inline.bytes,
                        mediaType: resolved.mimeType || inline.mediaType || 'application/octet-stream',
                        filename: resolved.name,
                    } as const;
                }

                if (/^https?:\/\//i.test(resolved.source)) {
                    return {
                        type: 'file',
                        data: resolved.source,
                        mediaType: resolved.mimeType || 'application/octet-stream',
                        filename: resolved.name,
                    } as const;
                }

                return {
                    type: 'text',
                    text: resolved.name ? `[File unavailable: ${resolved.name}]` : '[File unavailable]',
                } as const;
            }

            default:
                return { type: 'text', text: '' } as const;
        }
    });
    if (content.length === 1 && content[0]!.type === 'text') {
        return { role, content: content[0]!.text } as any;
    }

    return { role, content } as any;
}

function mediaAllowedForModel(
    partType: 'image' | 'file',
    capabilities?: ModelCapabilities | null
): boolean {
    if (!capabilities) return true;
    if (partType === 'image') return capabilities.images === 'supported';
    return capabilities.files === 'supported';
}

function capabilityFromBool(value: any): CapabilityState {
    return value === true ? 'supported' : value === false ? 'unsupported' : 'unknown';
}

function inferCapabilitiesFromModelItem(item: any): ModelCapabilities {
    const modalities = Array.isArray(item?.modalities)
        ? item.modalities.map((v: any) => String(v).toLowerCase())
        : [];

    const inputModalities = Array.isArray(item?.input_modalities)
        ? item.input_modalities.map((v: any) => String(v).toLowerCase())
        : [];

    const caps = item?.capabilities && typeof item.capabilities === 'object' ? item.capabilities : {};

    const imageHint =
        item?.supportsImages ??
        item?.supports_images ??
        item?.vision ??
        item?.supportsVision ??
        caps?.images ??
        caps?.vision ??
        (modalities.includes('image') || inputModalities.includes('image') ? true : undefined);

    const fileHint =
        item?.supportsFiles ??
        item?.supports_files ??
        caps?.files ??
        caps?.documents ??
        (modalities.includes('file') || modalities.includes('document') || inputModalities.includes('file') || inputModalities.includes('document') ? true : undefined);

    const hasAnyProviderSignal =
        imageHint !== undefined ||
        fileHint !== undefined ||
        item?.multimodal !== undefined ||
        modalities.length > 0 ||
        inputModalities.length > 0;

    return {
        text: 'supported',
        images: capabilityFromBool(imageHint),
        files: capabilityFromBool(fileHint),
        source: hasAnyProviderSignal ? 'provider-metadata' : 'default',
        checkedAt: new Date().toISOString(),
    };
}

function tinyProbePng(): Uint8Array {
    return new Uint8Array([
        137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,
        0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,
        0,0,0,12,73,68,65,84,8,153,99,248,15,4,0,9,251,3,253,
        160,90,167,130,0,0,0,0,73,69,78,68,174,66,96,130
    ]);
}

function tinyProbeTextFile(): Uint8Array {
    return new TextEncoder().encode('probe file');
}

async function probeModelCapabilities(ctx: any, providerId: string, modelId: string): Promise<ModelCapabilities> {
    const registry = getRegistry();
    const runtime = await registry.getProviderRuntime(providerId, { ctx, userScope: safeUserScope(ctx) });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId,
        contextId: runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });

    const result: ModelCapabilities = {
        text: 'unknown',
        images: 'unknown',
        files: 'unknown',
        source: 'probe',
        checkedAt: new Date().toISOString(),
    };

    // One deadline shared by all three probes, inside this RPC's own policy
    // timeout. Probing is a convenience check — an unreachable upstream must cost
    // seconds and answer "unsupported", not hold the connection for minutes.
    const probeBudget = createTimeoutLinkedSignal(ctx?.signal, CHAT_PROBE_BUDGET_MS);

    // The three probes are independent one-shot calls sharing one deadline — run
    // them concurrently so a cold session pays one probe round-trip, not three.
    const probeText = async (): Promise<CapabilityState> => {
        const textProbe = await generateText({
            model,
            messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
            maxOutputTokens: 8,
            abortSignal: probeBudget,
            maxRetries: 0,
        } as any);
        const out = String(textProbe?.text || '').trim().toUpperCase();
        return out.includes('OK') ? 'supported' : 'unsupported';
    };

    const probeImage = async (): Promise<CapabilityState> => {
        const imageProbe = await generateText({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', image: tinyProbePng(), mediaType: 'image/png' },
                    { type: 'text', text: 'If you can process image input, reply with exactly: IMAGE_OK. Otherwise reply with exactly: IMAGE_UNSUPPORTED.' },
                ],
            }],
            maxOutputTokens: 12,
            abortSignal: probeBudget,
            maxRetries: 0,
        } as any);
        const out = String(imageProbe?.text || '').trim().toUpperCase();
        return out.includes('IMAGE_OK') && !out.includes('IMAGE_UNSUPPORTED')
            ? 'supported'
            : 'unsupported';
    };

    const probeFile = async (): Promise<CapabilityState> => {
        const fileProbe = await generateText({
            model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'file', data: tinyProbeTextFile(), mediaType: 'text/plain', filename: 'probe.txt' },
                    { type: 'text', text: 'If you can process file input, reply with exactly: FILE_OK. Otherwise reply with exactly: FILE_UNSUPPORTED.' },
                ],
            }],
            maxOutputTokens: 12,
            abortSignal: probeBudget,
            maxRetries: 0,
        } as any);
        const out = String(fileProbe?.text || '').trim().toUpperCase();
        return out.includes('FILE_OK') && !out.includes('FILE_UNSUPPORTED')
            ? 'supported'
            : 'unsupported';
    };

    const [textOutcome, imageOutcome, fileOutcome] = await Promise.allSettled([
        probeText(), probeImage(), probeFile(),
    ]);
    result.text = textOutcome.status === 'fulfilled' ? textOutcome.value : 'unsupported';
    result.images = imageOutcome.status === 'fulfilled' ? imageOutcome.value : 'unsupported';
    result.files = fileOutcome.status === 'fulfilled' ? fileOutcome.value : 'unsupported';

    // Probed with this caller's key — cache the verdict under their scope.
    return registry.setModelCapabilities(providerId, modelId, result, safeUserScope(ctx));
}

function modelCapabilitySystemContent(capabilities?: ModelCapabilities | null): string {
    const lines = [
        `Model image support: ${capabilities?.images || 'unknown'}.`,
        `Model file support: ${capabilities?.files || 'unknown'}.`,
    ];

    if (capabilities?.images !== 'supported') {
        lines.push(
            'Do not rely on screenshots or image-returning API methods for reasoning.',
            'Prefer metadata, coordinates, measurements, labels, and plain-text summaries.'
        );
    }

    if (capabilities?.files !== 'supported') {
        lines.push(
            'Do not rely on file-returning API methods for reasoning.',
            'Prefer plain-text outputs when possible.'
        );
    }

    return lines.join('\n');
}

function sanitizeClientProviderTypeInput(input: CreateProviderTypeInput | UpdateProviderTypeInput): CreateProviderTypeInput | UpdateProviderTypeInput {
    const cloned: any = { ...input };
    delete cloned.fixedSecrets;
    return cloned;
}

export async function ensureModelCapabilities(
    ctx: any,
    input: { providerId: string; modelId: string; contextId?: string | null }
): Promise<{ providerId: string; modelId: string; capabilities: ModelCapabilities }> {
    ensureBuiltinAdapters();

    const registry = getRegistry();
    // Gate before the cache read, not just before the probe: the cached verdict
    // is itself derived from the provider and must not leak to a non-owner.
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderAccess(ctx, provider.metadata?.ownerUserId ?? null);

    const scope = safeUserScope(ctx);
    const cached = registry.getModelCapabilities(input.providerId, input.modelId, scope);
    if (
        cached &&
        (cached.images !== 'unknown' || cached.files !== 'unknown') &&
        cached.source !== 'probe'
    ) {
        return { providerId: input.providerId, modelId: input.modelId, capabilities: cached };
    }

    if (cached?.source === 'probe') {
        registry.clearModelCapabilities(input.providerId, input.modelId, scope);
    }

    const models = await registry.listModels(input.providerId, { ctx, contextId: input.contextId || null, userScope: scope });
    const discovered = models.find((m) => m.id === input.modelId)?.capabilities || null;

    if (discovered && (discovered.images !== 'unknown' || discovered.files !== 'unknown')) {
        const stored = registry.setModelCapabilities(input.providerId, input.modelId, discovered, scope);
        return { providerId: input.providerId, modelId: input.modelId, capabilities: stored };
    }

    const probed = await probeModelCapabilities(ctx, input.providerId, input.modelId);
    return { providerId: input.providerId, modelId: input.modelId, capabilities: probed };
}

export function registerPersonality(personality: ChatPersonality): void {
    ensureBuiltinAdapters();
    getRegistry().registerPersonality(personality);
}

export function registerProviderTypeServer(input: CreateProviderTypeInput | UpdateProviderTypeInput): ChatProviderTypeRecord {
    ensureBuiltinAdapters();
    const payload = {
        ...input,
        configSchema: Array.isArray(input.configSchema) ? input.configSchema : [],
        source: input.source || 'plugin',
    };
    return getRegistry().upsertProviderType(payload as CreateProviderTypeInput);
}

export async function registerProviderType(_ctx: any, input: CreateProviderTypeInput | UpdateProviderTypeInput): Promise<ChatProviderTypeClientRecord> {
    const registered = registerProviderTypeServer(sanitizeClientProviderTypeInput(input));
    const listed = getRegistry().listProviderTypes().find((item) => item.id === registered.id);
    if (!listed) throw new Error(`Failed to register provider type '${registered.id}'.`);
    return listed;
}

export async function listProviderTypes(): Promise<ProviderTypeListResult> {
    ensureBuiltinAdapters();
    // Internal-only provider types (metadata.hidden === true) are registered so
    // runVisionInference / other server code can resolve them, but must NOT be
    // offered in the "add provider" UI. Filtering happens here at the
    // client-facing RPC boundary only — the registry's own listProviderTypes()
    // stays unfiltered so internal resolution/dedup still sees them.
    const providerTypes = getRegistry().listProviderTypes().filter((t: any) => t?.metadata?.hidden !== true);
    return { providerTypes };
}

export async function createProvider(ctx: any, input: CreateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    return getRegistry().createProviderInstance(input, ctx?.user?.id ?? null);
}

export async function ensureManagedProvider(ctx: any, input: {
    pluginId: string;
    providerType: CreateProviderTypeInput | UpdateProviderTypeInput;
    provider: Omit<CreateProviderInstanceInput, 'typeId'> & { typeId?: string | null };
    managedKey?: string | null;
}): Promise<{
    ok: true;
    providerTypeId: string;
    providerId: string | null;
    providerCreated: boolean;
    providerUpdated: boolean;
}> {
    ensureBuiltinAdapters();

    const pluginId = String(input?.pluginId || '').trim();
    if (!pluginId) throw new Error('ensureManagedProvider: missing pluginId.');

    const providerType = registerProviderTypeServer(input.providerType);
    const typeId = String(input.provider?.typeId || providerType.id || '').trim();
    if (!typeId) throw new Error('ensureManagedProvider: missing provider type id.');

    const managedKey = String(input?.managedKey || `${pluginId}:${typeId}:default`).trim();
    const providerPayload = {
        ...input.provider,
        typeId,
        metadata: {
            managedByPlugin: pluginId,
            managedKey,
            autoCreated: true,
            role: 'default-provider',
            ...(input.provider?.metadata || {}),
        },
    };

    const listed = await listProviders(ctx, { typeId });
    const providers = Array.isArray(listed?.providers) ? listed.providers : [];
    const existing = providers.find((provider: any) => {
        const meta = provider?.metadata || {};
        return (
            provider?.typeId === typeId &&
            (
                meta.managedKey === managedKey ||
                (meta.managedByPlugin === pluginId && meta.autoCreated === true)
            )
        );
    });

    let provider: any;
    let providerCreated = false;
    let providerUpdated = false;

    if (!existing) {
        provider = await createProvider(ctx, providerPayload as CreateProviderInstanceInput);
        providerCreated = true;
    } else {
        provider = await updateProvider(ctx, {
            id: existing.id,
            ...(providerPayload as Omit<UpdateProviderInstanceInput, 'id'>),
        });
        providerUpdated = true;
    }

    return {
        ok: true,
        providerTypeId: typeId,
        providerId: provider?.id || existing?.id || null,
        providerCreated,
        providerUpdated,
    };
}

export async function listProviders(ctx: any, input?: { typeId?: string | null }): Promise<ProviderListResult> {
    ensureBuiltinAdapters();
    const all = await getRegistry().listProviderInstances({ userId: ctx?.user?.id ?? null, typeId: input?.typeId || null });
    // Hide internal-only providers (metadata.hidden === true) from the chat
    // provider picker. They remain resolvable by id via getProviderRuntime (so
    // runVisionInference and the pathology analyze driver keep working) and
    // still visible to the registry's managed-provider dedup — only this
    // client-facing list excludes them.
    const providers = all.filter((p: any) => p?.metadata?.hidden !== true);
    return { providers };
}

// assertProviderAccess now lives in chatRegistry.server beside resolveUserScope and
// is enforced inside getProviderRuntime itself. The explicit calls below are kept:
// they reject an unauthorised caller before any work happens, and they cover the
// metadata-only RPCs that never resolve a runtime.

export async function getProvider(ctx: any, input: { providerId: string }): Promise<any> {
    ensureBuiltinAdapters();
    const provider = await getRegistry().getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderAccess(ctx, provider.metadata?.ownerUserId ?? null);
    return provider;
}

export async function updateProvider(ctx: any, input: UpdateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.id);
    if (!current) throw new Error(`Unknown provider '${input.id}'.`);
    assertProviderAccess(ctx, current.metadata?.ownerUserId ?? null);
    return getRegistry().updateProviderInstance(input.id, input);
}

export async function deleteProvider(ctx: any, input: { providerId: string }): Promise<{ ok: true }> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.providerId);
    if (!current) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderAccess(ctx, current.metadata?.ownerUserId ?? null);
    await getRegistry().deleteProviderInstance(input.providerId);
    return { ok: true };
}

const USER_SECRET_MAX_VALUE_LENGTH = 4096;

async function buildUserSecretsStatus(ctx: any, providerId: string): Promise<ProviderUserSecretsStatus> {
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(providerId);
    if (!provider) throw new Error(`Unknown provider '${providerId}'.`);
    assertProviderAccess(ctx, provider.metadata?.ownerUserId ?? null);

    const type = registry.getProviderType(provider.typeId);
    const secretSchemaKeys = (type?.configSchema || [])
        .filter((field) => field.secret === true)
        .map((field) => String(field.key));
    const scope = resolveUserScope(ctx);
    const userSecretKeys = Object.keys(await registry.getUserSecrets(scope, providerId)).sort();
    const hasAdminSecrets = provider.hasSecretDefaults === true || provider.hasSecretOverrides === true;

    return {
        providerId,
        hasUserSecrets: userSecretKeys.length > 0,
        userSecretKeys,
        hasAdminSecrets,
        secretSchemaKeys,
        needsKey: secretSchemaKeys.length > 0 && !hasAdminSecrets && userSecretKeys.length === 0,
    };
}

export async function getProviderUserSecretsStatus(ctx: any, input: { providerId: string }): Promise<ProviderUserSecretsStatus> {
    ensureBuiltinAdapters();
    return buildUserSecretsStatus(ctx, input.providerId);
}

export async function setProviderUserSecrets(ctx: any, input: { providerId: string; secrets: Record<string, unknown> }): Promise<ProviderUserSecretsStatus> {
    ensureBuiltinAdapters();
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderAccess(ctx, provider.metadata?.ownerUserId ?? null);

    const type = registry.getProviderType(provider.typeId);
    const allowedKeys = new Set(
        (type?.configSchema || []).filter((field) => field.secret === true).map((field) => String(field.key))
    );
    const patch = input?.secrets;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('setProviderUserSecrets requires a secrets object.');
    }
    // Degrade closed: only schema-declared secret fields, string/null values,
    // bounded length. '' / null delete the stored key (normalizeSecretsPatch).
    for (const [key, value] of Object.entries(patch)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`Secret field '${key}' is not declared by provider type '${provider.typeId}'.`);
        }
        if (value !== null && typeof value !== 'string') {
            throw new Error(`Secret field '${key}' must be a string or null.`);
        }
        if (typeof value === 'string' && value.length > USER_SECRET_MAX_VALUE_LENGTH) {
            throw new Error(`Secret field '${key}' exceeds the maximum length of ${USER_SECRET_MAX_VALUE_LENGTH} characters.`);
        }
    }

    const scope = resolveUserScope(ctx);
    await registry.patchUserSecrets(scope, input.providerId, patch as Record<string, unknown>);
    // Capabilities probed with the previous key may be wrong now — but only for
    // THIS caller, so scope the invalidation rather than wiping every user's.
    registry.clearModelCapabilities(input.providerId, undefined, scope);
    return buildUserSecretsStatus(ctx, input.providerId);
}

export async function clearProviderUserSecrets(ctx: any, input: { providerId: string }): Promise<ProviderUserSecretsStatus> {
    ensureBuiltinAdapters();
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderAccess(ctx, provider.metadata?.ownerUserId ?? null);

    const scope = resolveUserScope(ctx);
    await registry.clearUserSecrets(scope, input.providerId);
    registry.clearModelCapabilities(input.providerId, undefined, scope);
    return buildUserSecretsStatus(ctx, input.providerId);
}

export async function listModels(ctx: any, input: {
    providerId?: string | null;
    providerTypeId?: string | null;
    draftConfig?: Record<string, unknown>;
    draftSecrets?: Record<string, unknown>;
    contextId?: string | null;
}): Promise<ProviderModelListResult> {
    ensureBuiltinAdapters();
    if (input.providerId) {
        const models = await getRegistry().listModels(input.providerId, { ctx, contextId: input.contextId || null, userScope: safeUserScope(ctx) });
        return { providerId: input.providerId, models };
    }
    if (input.providerTypeId) {
        const models = await getRegistry().previewListModels(input.providerTypeId, {
            ctx,
            contextId: input.contextId || null,
            draftConfig: input.draftConfig || {},
            draftSecrets: input.draftSecrets || {},
        });
        return { providerTypeId: input.providerTypeId, models };
    }
    throw new Error('listModels requires either providerId or providerTypeId.');
}

export async function createSession(ctx: any, input: CreateSessionInput): Promise<ChatSession> {
    ensureBuiltinAdapters();
    ensureBuiltinPersonalities();
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);

    if (input.personalityId && input.personalityPrompt && !registry.getPersonality(input.personalityId)) {
        registry.registerPersonality({ id: input.personalityId, label: input.personalityId, systemPrompt: input.personalityPrompt });
    }

    return registry.getSessionStore().createSession({
        id: registry.newId('sess'),
        title: input.title || 'New chat',
        providerId: input.providerId,
        providerTypeId: provider.typeId,
        modelId: input.modelId || provider.defaultModelId || '',
        personalityId: input.personalityId || 'default',
        contextId: input.contextId || provider.contextId || null,
        metadata: { ...input.metadata, userId: ctx?.user?.id ?? null },
    });
}

export async function listSessions(ctx: any, input?: { providerId?: string | null }): Promise<SessionListResult> {
    const sessions = await getRegistry().getSessionStore().listSessions({ providerId: input?.providerId || undefined, userId: ctx?.user?.id ?? null });
    return { sessions };
}

export async function getSession(ctx: any, input: { sessionId: string; hydrateMessages?: boolean }): Promise<{ session: ChatSession; messages?: ChatMessage[]; attachments?: ChatAttachmentRecord[] }> {
    const hydrated = await requireSessionAccess(ctx, input.sessionId);
    return input.hydrateMessages === false ? { session: hydrated.session } : hydrated;
}

export async function renameSession(ctx: any, input: { sessionId: string; title: string }): Promise<ChatSession> {
    const hydrated = await requireSessionAccess(ctx, input.sessionId);
    return getRegistry().getSessionStore().updateSession(input.sessionId, {
        title: input.title,
        metadata: {
            ...(hydrated.session.metadata || {}),
            manualTitle: true,
        },
    });
}

export async function deleteSession(ctx: any, input: { sessionId: string }): Promise<{ ok: true }> {
    await requireSessionAccess(ctx, input.sessionId);
    await getRegistry().getSessionStore().deleteSession(input.sessionId);
    return { ok: true };
}

export async function uploadAttachment(ctx: any, input: {
    sessionId: string;
    kind?: 'image' | 'file' | 'screenshot';
    name?: string;
    mimeType: string;
    dataBase64: string;
    metadata?: Record<string, unknown>;
}): Promise<ChatAttachmentRecord> {
    await requireSessionAccess(ctx, input.sessionId);

    const record: ChatAttachmentRecord = {
        id: getRegistry().newId('att'),
        sessionId: input.sessionId,
        kind: input.kind || (input.mimeType.startsWith('image/') ? 'image' : 'file'),
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.dataBase64.length,
        dataUrl: input.dataBase64,
        createdAt: new Date().toISOString(),
        metadata: input.metadata,
    };
    return getRegistry().getSessionStore().uploadAttachment(record);
}

export async function appendMessages(ctx: any, input: { sessionId: string; messages: ChatMessage[] }): Promise<{ messages: ChatMessage[] }> {
    const hydrated = await requireSessionAccess(ctx, input.sessionId);
    const debugEnabled = isChatDebugEnabled();
    const messages = input.messages.map(normalizeIncomingMessage);
    llmLog(debugEnabled, "APPEND_MESSAGES_INPUT", {
        sessionId: input.sessionId,
        existingMessageCount: hydrated.messages?.length || 0,
        appendedMessages: messages,
    });
    const appended = await getRegistry().getSessionStore().appendMessages(input.sessionId, messages);
    const autoTitle = await resolveAutoTitle(getRegistry().getSessionStore(), hydrated.session);

    if (autoTitle !== undefined) {
        await getRegistry().getSessionStore().updateSession(input.sessionId, {
            title: autoTitle,
            metadata: hydrated.session.metadata,
        });
    }

    llmLog(debugEnabled, "APPEND_MESSAGES_OUTPUT", {
        sessionId: input.sessionId,
        storedMessages: appended,
    });
    return { messages: appended };
}

function mergeAdjacentUserMultimodalTurns(messages: ChatMessage[]): ChatMessage[] {
    const merged: ChatMessage[] = [];

    for (const msg of messages) {
        const prev = merged[merged.length - 1];

        const msgParts = msg.parts || [];
        const prevParts = prev?.parts || [];

        const msgHasMedia = msg.role === 'user' && msgParts.some((p: any) => p.type === 'image' || p.type === 'file');
        const msgHasText = msg.role === 'user' && msgParts.some((p: any) => p.type === 'text' && String(p.text || '').trim());

        const prevHasMediaOnly =
            prev?.role === 'user' &&
            prevParts.length > 0 &&
            prevParts.some((p: any) => p.type === 'image' || p.type === 'file') &&
            !prevParts.some((p: any) => p.type === 'text' && String(p.text || '').trim());

        if (prev && prevHasMediaOnly && msg.role === 'user' && msgHasText && !msgHasMedia) {
            const combinedParts = [...prevParts, ...msgParts];

            merged[merged.length - 1] = {
                ...msg,
                id: msg.id || prev.id,
                sessionId: msg.sessionId || prev.sessionId,
                parts: combinedParts,
                content: coerceMessageText({ ...msg, parts: combinedParts } as ChatMessage),
                createdAt: msg.createdAt || prev.createdAt,
            };
            continue;
        }

        merged.push(msg);
    }

    return merged;
}

export async function sendTurn(ctx: any, input: SendTurnInput): Promise<ChatTurnResult> {
    ensureBuiltinAdapters();
    ensureBuiltinPersonalities();

    const turnBudget = createTimeoutLinkedSignal(ctx?.signal, CHAT_SEND_TURN_BUDGET_MS);

    const registry = getRegistry();
    const sessionStore = registry.getSessionStore();
    const hydrated = await requireSessionAccess(ctx, input.sessionId);
    const session = hydrated.session;
    const debugEnabled = isChatDebugEnabled();
    const runtime = await registry.getProviderRuntime(session.providerId, { ctx, userScope: safeUserScope(ctx) });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);
    const executionMode = String(input.executionMode || session.metadata?.testMode || '').trim() || null;
    const liveViewerContext = validateLiveViewerContextSnapshot(input.liveViewerContext);

    // Inline message delta: what used to be a separate appendMessages RPC now rides
    // the turn request — one round-trip, one hydration, one auth check per
    // assistant-loop step. Store-side id-dedup makes a retried turn idempotent even
    // when the earlier attempt persisted the delta and then died.
    let persistedDeltaCount = 0;
    if (Array.isArray(input.messagesDelta) && input.messagesDelta.length) {
        const delta = input.messagesDelta.map(normalizeIncomingMessage);
        llmLog(debugEnabled, "SEND_TURN_DELTA", {
            sessionId: session.id,
            existingMessageCount: hydrated.messages.length,
            appendedMessages: delta,
        });
        const appended = await sessionStore.appendMessages(session.id, delta);
        hydrated.messages.push(...appended);
        persistedDeltaCount = input.messagesDelta.length;
        const deltaAutoTitle = await resolveAutoTitle(sessionStore, session);
        if (deltaAutoTitle !== undefined) {
            session.title = deltaAutoTitle;
            await sessionStore.updateSession(session.id, { title: deltaAutoTitle, metadata: session.metadata });
        }
    }

    const personality = (input.personalityId ? registry.getPersonality(input.personalityId) : registry.getPersonality(session.personalityId)) || defaultPersonality();
    const maxRecentMessages = Math.max(1, Math.min(50, Number(input.maxRecentMessages || 14)));
    const recentMessages = mergeAdjacentUserMultimodalTurns(
        hydrated.messages.slice(-maxRecentMessages)
    ).map((message) => sanitizeMessageForModel(message));

    const attachmentIndex = buildAttachmentIndex(hydrated.attachments || []);

    const modelCaps = await ensureModelCapabilities(ctx, {
        providerId: session.providerId,
        modelId: session.modelId,
        contextId: session.contextId || null,
    });
    // Two ways in: the model id looks like a known Harmony deployment (free head start on turn
    // one), or this session has already been caught emitting envelopes (covers every other
    // model, no vendor list to maintain).
    const emitsToolEnvelopes = session.metadata?.emitsToolEnvelopes === true
        || isHarmonyStyleModel(session.modelId, runtime.type.id);
    const harmonyAddendum = emitsToolEnvelopes
        ? "Channel/tool-call tokens such as <|start|>, <|channel|>, <|message|>, <|call|>, <|tool_call_argument_begin|>, and <|tool_call_end|> are NOT recognised by this runtime. Do not emit them — native tool-call syntax is not available here, and this runtime declares no tools. The only accepted tool-call surface is the ```xopat-script ... ``` fenced block contract documented above."
        : null;

    // Stable-prefix ordering: everything that survives unchanged across turns comes
    // first (preamble, API schema, personality, region-link contract), the volatile
    // live-viewer snapshot comes LAST — provider prompt caches match on prefixes, so
    // a zoom change must only invalidate the tail, not the multi-KB schema above it.
    const mergedSystemContent = [
        sessionPreamble(runtime.instance.label, input.allowedScriptApi, { executionMode }),
        scriptSystemContent(input.allowedScriptApi, { executionMode }),
        `Active personality: ${personality.label}

${input.personalityPrompt || personality.systemPrompt}`,
        regionLinkSystemContent(),
        harmonyAddendum,
        liveViewerContextSystemContent(liveViewerContext),
    ]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join("\n---\n");

    const systemMessages = mergedSystemContent
        ? [toModelMessage({
            role: 'system',
            content: mergedSystemContent,
            parts: [{ type: 'text', text: mergedSystemContent }],
            createdAt: new Date().toISOString(),
        } as ChatMessage, attachmentIndex)]
        : [];

    const buildConversation = (count: number) => recentMessages
        .slice(-Math.max(1, count))
        .map((m) => toModelMessage(m, attachmentIndex, modelCaps.capabilities));
    let conversation = buildConversation(recentMessages.length);

    const model = await adapter.resolveModel({
        ctx,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId: session.modelId,
        contextId: session.contextId || runtime.instance.contextId || null,
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
    });

    if (debugEnabled) console.debug('[chat-debug/sendTurn]', serializeDebugValue({
        sessionId: session.id,
        providerId: session.providerId,
        modelId: session.modelId,
        recentMessages: recentMessages.map((m) => ({
            role: m.role,
            contentChars: typeof m.content === 'string' ? m.content.length : 0,
            parts: (m.parts || []).map(summarizePart),
        })),
        attachments: (hydrated.attachments || []).map((att) => ({
            id: att.id,
            kind: att.kind,
            mimeType: att.mimeType,
            name: att.name || null,
            dataUrlLen: typeof att.dataUrl === 'string' ? att.dataUrl.length : 0,
        })),
        conversation: conversation.map(summarizeModelMessage),
    }));

    llmLog(debugEnabled, "MODEL_INPUT", {
        messageCount: [...systemMessages, ...conversation].length,
        messages: [...systemMessages, ...conversation].map((m: any) => ({
            role: m.role,
            content: Array.isArray(m.content)
                ? m.content.map((p: any) => {
                    if (p.type === 'image') {
                        return {
                            type: 'image',
                            hasData: !!p.image,
                            isUint8Array: p.image instanceof Uint8Array,
                            byteLength: p.image instanceof Uint8Array
                                ? p.image.byteLength
                                : (typeof p.image === 'string' ? p.image.length : 0),
                            preview: typeof p.image === 'string'
                                ? p.image.slice(0, 80)
                                : (p.image instanceof Uint8Array
                                    ? Array.from(p.image.slice(0, 12))
                                    : null),
                            mediaType: p.mediaType,
                        };
                    }
                    if (p.type === 'file') {
                        return {
                            type: 'file',
                            hasData: !!p.data,
                            isUint8Array: p.data instanceof Uint8Array,
                            byteLength: p.data instanceof Uint8Array
                                ? p.data.byteLength
                                : (typeof p.data === 'string' ? p.data.length : 0),
                            filename: p.filename,
                            mediaType: p.mediaType,
                        };
                    }
                    return p;
                })
                : m.content
        }))
    });

    let result: any = null;
    let lastContextError: any = null;
    let usedConversationSize: number | null = null;
    // Geometric descent, not a fine-grained ladder: each rung is a full upstream
    // call, so worst case must stay at 4 attempts. A conversation that overflows
    // at 8-but-fits-6 messages loses marginal recall by dropping to 4 — acceptable
    // in an already-overflowing session.
    const retryCounts = Array.from(new Set([
        recentMessages.length,
        Math.min(recentMessages.length, 8),
        Math.min(recentMessages.length, 4),
        1,
    ].filter((value) => value > 0))).sort((a, b) => b - a);

    for (const count of retryCounts) {
        if (turnBudget.aborted) break;
        conversation = buildConversation(count);
        try {
            result = await generateText({
                model,
                messages: [...systemMessages, ...conversation],
                maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
                abortSignal: createTimeoutLinkedSignal(turnBudget, CHAT_ATTEMPT_TIMEOUT_MS),
                maxRetries: CHAT_MAX_RETRIES,
            });
            llmLog(debugEnabled, "MODEL_OUTPUT", {
                text: typeof result?.text === 'string' ? result.text : null,
                usage: (result as any)?.usage || (result as any)?.totalUsage || null,
                retryConversationSize: count,
            });
            usedConversationSize = count;
            lastContextError = null;
            break;
        } catch (error) {
            llmLog(debugEnabled, "MODEL_ERROR", {
                retryConversationSize: count,
                error,
            });
            // A timeout or a cancelled turn is not a context-length problem, and a
            // smaller conversation will not fix an upstream that never answered.
            // Retrying here is what turned one dead endpoint into the full turn
            // timeout: report it now.
            if (isAbortError(error) || turnBudget.aborted) throw error;
            if (isInvalidImageInputError(error)) {
                const text = buildInvalidImageInputGuidance(error);
                const message: ChatMessage = {
                    id: registry.newId('msg'),
                    sessionId: session.id,
                    role: 'assistant',
                    content: text,
                    parts: [{ type: 'text', text }],
                    createdAt: new Date().toISOString(),
                    metadata: {
                        uiVariant: 'error',
                        reason: 'invalid-image-input',
                    } as any,
                };

                await sessionStore.appendMessages(session.id, [message]);
                const autoTitle = await resolveAutoTitle(sessionStore, session);
                const updatedSession = autoTitle !== undefined
                    ? await sessionStore.updateSession(session.id, { title: autoTitle })
                    : (await sessionStore.getSession(session.id)) || session;

                return {
                    message,
                    session: updatedSession,
                    capabilities: modelCaps.capabilities,
                    persistedDeltaCount: persistedDeltaCount || undefined,
                };
            }

            if (!isContextWindowError(error)) throw error;
            lastContextError = error;
        }
    }

    if (!result && lastContextError) {
        const text = buildContextWindowGuidance(lastContextError, recentMessages.length);
        const message: ChatMessage = {
            id: registry.newId('msg'),
            sessionId: session.id,
            role: 'assistant',
            content: text,
            parts: [{ type: 'text', text }],
            createdAt: new Date().toISOString(),
            metadata: {
                uiVariant: 'error',
                reason: 'context-window-exceeded',
            } as any,
        };

        await sessionStore.appendMessages(session.id, [message]);
        const autoTitle = await resolveAutoTitle(sessionStore, session);
        const updatedSession = autoTitle !== undefined
            ? await sessionStore.updateSession(session.id, { title: autoTitle })
            : (await sessionStore.getSession(session.id)) || session;

        return {
            message,
            session: updatedSession,
            capabilities: modelCaps.capabilities,
            persistedDeltaCount: persistedDeltaCount || undefined,
        };
    }

    if (!result) {
        // Budget spent (or the turn was cancelled) before any attempt produced a
        // result — never fall through to reading `result.text` off null.
        throw (turnBudget.reason instanceof Error
            ? turnBudget.reason
            : new Error(`Chat turn aborted after ${CHAT_SEND_TURN_BUDGET_MS}ms without a model response.`));
    }

    const rawText = typeof result.text === 'string' ? result.text : '';
    // The model ran out of output budget mid-sentence. Say so, loudly, in the message
    // itself: a truncated reply is usually a truncated SCRIPT, which then fails to match
    // the closing-fence regex and is silently never executed. Left unannounced, the model
    // sees its own half-written code in the history and assumes it ran.
    const outputTruncated = (result as any)?.finishReason === 'length';
    const { text, recovered: toolEnvelopeRecovered } = sanitizeAssistantOutput(
        outputTruncated ? `${rawText}\n\n${buildOutputTruncatedGuidance()}` : rawText
    );
    // The model spoke, and sanitisation left nothing. Never let this reach the client as an
    // ordinary (blank) final answer — that is exactly how a broken turn passes for a finished one.
    const sanitizedToEmpty = !!rawText.trim() && !text.trim();
    const emittedToolEnvelope = toolEnvelopeRecovered || hasToolEnvelopeTokens(rawText);
    // Context-window retries silently shrink the conversation; surface the final
    // size so the client can tell the user (and the model, next turn) that older
    // messages were dropped instead of letting the agent assume full continuity.
    const historyTruncatedTo = usedConversationSize !== null && usedConversationSize < recentMessages.length
        ? usedConversationSize
        : undefined;
    const metadata: Record<string, unknown> = {};
    if (historyTruncatedTo !== undefined) metadata.historyTruncatedTo = historyTruncatedTo;
    if (outputTruncated) metadata.outputTruncated = true;
    if (toolEnvelopeRecovered) metadata.toolEnvelopeRecovered = true;
    if (sanitizedToEmpty) metadata.sanitizedToEmpty = true;
    const message: ChatMessage = {
        id: registry.newId('msg'),
        sessionId: session.id,
        role: 'assistant',
        content: text,
        parts: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
        metadata: Object.keys(metadata).length ? metadata as any : undefined,
    };

    await sessionStore.appendMessages(session.id, [message]);
    const autoTitle = await resolveAutoTitle(sessionStore, session);
    // Sticky, and derived from what the model actually emitted rather than from its name: once a
    // session has seen a native tool-call envelope, every later turn carries the corrective
    // system line. Model-id allowlists only ever cover the vendors someone thought to list.
    const sessionPatch: Partial<ChatSession> = {};
    if (autoTitle !== undefined) sessionPatch.title = autoTitle;
    if (emittedToolEnvelope && session.metadata?.emitsToolEnvelopes !== true) {
        sessionPatch.metadata = { ...(session.metadata || {}), emitsToolEnvelopes: true };
    }
    const updatedSession = Object.keys(sessionPatch).length
        ? await sessionStore.updateSession(session.id, sessionPatch)
        : (await sessionStore.getSession(session.id)) || session;

    const usage = (result as any).usage || (result as any).totalUsage;
    llmLog(debugEnabled, "TURN_RESULT", {
        sessionId: session.id,
        message,
        usage: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
            }
            : undefined,
    });
    return {
        message,
        session: updatedSession,
        usage: usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
            }
            : undefined,
        capabilities: modelCaps.capabilities,
        persistedDeltaCount: persistedDeltaCount || undefined,
    };
}
