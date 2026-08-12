import { generateText, streamText, tool, jsonSchema } from 'ai';
import { ChatServerRegistry, resolveUserScope, assertProviderRead, assertProviderWrite, normalizeContexts } from './chatRegistry.server';
import { createTimeoutLinkedSignal, isAbortError } from './abort-utils';
import { getChatTuning, chatLog } from './tuning';
import { hasToolEnvelopeTokens, recoverToolEnvelopeToScriptFence } from '../shared/tool-envelope';
import { ensureManagedPluginProvider } from './providerRegistration.server';

// ── Native tool-calling surface ─────────────────────────────────────────────
// The viewer script executor lives in the browser, and `streamText`/`generateText`
// run on the Node server with no viewer — so we CANNOT let the SDK auto-run tools.
// Instead we declare ONE client-side tool (no `execute`): the model emits a
// structured `run_viewer_script` tool-call, the SDK ends the step at that call,
// and we transcribe the call into the canonical ```xopat-script fenced block the
// rest of the pipeline already understands (persistence, history, client
// extraction + execution, host-feedback). This fixes the "model narrates but never
// acts" failure — a tool-capable model reliably emits a tool-call when it means to
// act — while keeping the fenced-block path intact as the fallback for models that
// ignore or do not support tools. See shared/tool-envelope.ts for the sibling
// recovery of tool-call tokens that LEAK into text.
const VIEWER_SCRIPT_TOOL_NAME = 'run_viewer_script';

function buildViewerScriptTools(): Record<string, any> {
    return {
        [VIEWER_SCRIPT_TOOL_NAME]: tool({
            description:
                'Execute JavaScript against the allowed viewer scripting API to inspect state or ' +
                'automate a viewer action. The body runs at top level inside an async wrapper (use ' +
                '`await` directly) and MUST `return` the value you want back. Prefer this tool over ' +
                'describing manual steps whenever the allowed API can do the work. Call it only when ' +
                'viewer inspection/action is actually needed — not for greetings or acknowledgements. ' +
                'If you are about to write "let me check/inspect/scan X", call this tool in that same ' +
                'message instead: a message that only announces the step ENDS the turn and nothing runs.',
            inputSchema: jsonSchema<{ code: string }>({
                type: 'object',
                additionalProperties: false,
                required: ['code'],
                properties: {
                    code: {
                        type: 'string',
                        description:
                            'Plain-JavaScript body (no TypeScript). Uses only the allowed scripting API. ' +
                            'Must end with a top-level `return`.',
                    },
                },
            }),
            // No `execute`: this is a client-side tool. The SDK surfaces the call and stops.
        }),
    };
}

/**
 * Clamp a client-reported transport-damage phrase to something safe to paste into a system prompt:
 * one short single-line string, control characters removed. It only ever restricts how the model is
 * asked to answer, so a hostile value costs prompt space and nothing else.
 */
function sanitizeTransportDamage(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const printable = Array.from(value).filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join('');
    const text = printable.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** Canonical fenced-block transcription of a viewer-script tool call. */
function viewerScriptFenceFromCode(code: string): string {
    return `\n\n\`\`\`xopat-script\n${String(code ?? '').trim()}\n\`\`\`\n`;
}

/** Pull the `code` argument out of a tool-call/tool-result stream part, tolerant of SDK field-name variants. */
function extractToolCallCode(part: any): string {
    const input = part?.input ?? part?.args ?? part?.arguments ?? null;
    if (input && typeof input === 'object' && typeof input.code === 'string') return input.code;
    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            if (parsed && typeof parsed.code === 'string') return parsed.code;
        } catch (_) { /* not JSON — fall through */ }
    }
    return '';
}

/**
 * A provider that cannot accept a `tools` param at all (older local runtimes,
 * some openai-compatible backends) rejects the request outright. Detect that so
 * the turn can retry the SAME rung with tools stripped (fence-only), mirroring the
 * streaming-unsupported fallback. Deliberately conservative: only string-matches
 * clear tool/function-calling capability errors, never generic 400s.
 */
function isToolsUnsupportedError(error: any): boolean {
    const msg = String(error?.message || error?.responseBody || error || '').toLowerCase();
    if (!msg) return false;
    return (
        (msg.includes('tool') || msg.includes('function')) &&
        (msg.includes('not support') || msg.includes('unsupported') || msg.includes('does not support')
            || msg.includes('no tools') || msg.includes('tool use is not') || msg.includes('tool_choice'))
    );
}

// Default set of namespaces documented in full in the system prompt (overridable
// per deployment via SendTurnInput.fullPromptNamespaces ← static meta). Everything
// else is listed compactly; full docs arrive via the session-expansion block
// (attempt-first + sticky expansion) or on demand via `describeScriptingApi(...)`.
const CORE_SCRIPT_NAMESPACES = new Set(['application', 'viewer', 'visualization']);

/**
 * LLM diagnostics ride the CORE logging broker (server/LOGGING.md), not a bespoke
 * env var.
 *
 * The previous `XOPAT_CHAT_DEBUG` switch wrote whole conversations — prompts, tool
 * arguments, model output, i.e. potentially PHI — to stdout with no redaction and
 * no retention story. Payload-bearing records now go through `llm.sensitive(...)`,
 * which the broker emits ONLY when an operator set
 * `core.server.logging.allowSensitive` AND the channel is at `trace`. Everything
 * else (shapes, counts, verdicts) is a normal `debug`/`warn` record.
 *
 * It has never been (and must never become) a request-supplied switch: `input`
 * and `session.metadata` are attacker-controlled, so a caller could otherwise turn
 * on conversation logging at will (§7).
 *
 *   core.server.logging.channels: { "module.vercel-ai-chat-sdk:llm": "trace" }
 */
const llm = chatLog('llm');

/**
 * RPC policy ceiling for a chat turn. This one value stays a module constant: the
 * policy object is read by the RPC runtime at import time, before any request or
 * config ctx exists. The knob that matters at runtime — the turn's own budget,
 * deliberately INSIDE this ceiling — is config-driven (`tuning.turnBudgetMs`).
 *
 * The RPC layer's abort is cooperative: it answers 504 but cannot stop an
 * in-flight upstream request, so the turn must carry its own deadline and lose the
 * race on purpose — the caller then sees the real upstream error instead of an
 * opaque RPC_TIMEOUT, and the socket is actually torn down.
 */
const CHAT_SEND_TURN_TIMEOUT_MS = 600_000;

export const policy = {
    ensureModelCapabilities: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 30_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    },
    // ─────────────────────────────────────────────────────────────────────────
    // WITHDRAWN RPCs — provider registration is SERVER-SIDE ONLY for now.
    //
    // `registerProviderType`, `createProvider`, `updateProvider` and
    // `deleteProvider` are commented out deliberately. `buildEntryMap`
    // (server/node/server-runtime.js) exposes only names present in this object,
    // so removing them here removes the endpoints while the exports below stay
    // available to internal callers. No shipped client called any of them —
    // ProviderKeysPanel uses only the three BYOK RPCs.
    //
    // Why they had to go: as written they let ANY session holder obtain the
    // operator's API key.
    //   • `registerProviderType(_ctx, input)` never read `ctx` — no ownership or
    //     admin check of any kind — and `upsertProviderType` merges caller
    //     `fixedConfig` while PRESERVING `fixedSecrets`. One call repoints an
    //     operator provider type's baseUrl at an attacker host and the key flows
    //     there for every user of the untouched operator instance.
    //   • `createProvider` accepted arbitrary `config` (never intersected with the
    //     type's configSchema) plus `requiresLogin:false`, and getProviderRuntime
    //     handed `type.fixedSecrets` to ANY instance of that type — so creating
    //     your own instance of the operator's type handed you the operator's key,
    //     with no auth context verified at all.
    //   • `updateProvider`/`deleteProvider` gated on assertProviderAccess, which
    //     returned early for a null owner — and operator instances are
    //     deliberately null-owned so everyone can READ them. Shared-for-reading
    //     silently meant writable-by-anyone: repoint the endpoint, strip the login
    //     gate, or steal the record by setting metadata.ownerPrincipal.
    //
    // To re-enable, all of the following must hold (see the structural guards
    // already added in chatRegistry.server.ts):
    //   1. Writes go through `assertProviderWrite` (origin:"user" + owner match).
    //   2. `trust:"rpc"` writes intersect config with configSchema and reduce
    //      metadata to the caller-writable allowlist.
    //   3. A server-side admin gate read from SECURE CONFIG for type-level and
    //      operator-record operations — NOT `this.can(...)`: src/USER_ROLES.md
    //      states in its own second paragraph that roles are UI gating and the
    //      browser can self-assign them.
    //
    // registerProviderType: {
    //     auth: { public: false, requireSession: true },
    //     runtime: { timeoutMs: 3_000, maxBodyBytes: 128 * 1024, maxConcurrency: 10, queueLimit: 20 },
    // },
    // createProvider: {
    //     auth: { public: false, requireSession: true },
    //     runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    // },
    // updateProvider: {
    //     auth: { public: false, requireSession: true },
    //     runtime: { timeoutMs: 4_000, maxBodyBytes: 128 * 1024, maxConcurrency: 20, queueLimit: 50 },
    // },
    // deleteProvider: {
    //     auth: { public: false, requireSession: true },
    //     runtime: { timeoutMs: 3_000, maxBodyBytes: 32 * 1024, maxConcurrency: 20, queueLimit: 50 },
    // },
    // ─────────────────────────────────────────────────────────────────────────
    listProviderTypes: {
        auth: { public: true, requireSession: false },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    listProviders: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    getProvider: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 2_000, maxBodyBytes: 32 * 1024, maxConcurrency: 50, queueLimit: 100 },
    },
    resolveProviderRef: {
        auth: { public: false, requireSession: true },
        runtime: { timeoutMs: 5_000, maxBodyBytes: 4 * 1024, maxConcurrency: 10, queueLimit: 20 },
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
        // Real upstream /models discovery — a self-hosted or cold endpoint
        // legitimately takes >5s, and a policy timeout here multiplied into a
        // client retry burst (504 is retriable). The registry caches results.
        runtime: { timeoutMs: 20_000, maxBodyBytes: 64 * 1024, maxConcurrency: 20, queueLimit: 100 },
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
            // Shared with sendTurnStream — one upstream slot pool, not two.
            concurrencyKey: 'chat-turn',
            circuitBreaker: { key: 'chat-upstream', failureThreshold: 5, resetAfterMs: 30_000 },
        },
    },
    sendTurnStream: {
        auth: { public: false, requireSession: true },
        runtime: {
            streaming: true,
            timeoutMs: CHAT_SEND_TURN_TIMEOUT_MS,
            maxBodyBytes: 1024 * 1024,
            maxConcurrency: 5,
            queueLimit: 25,
            concurrencyKey: 'chat-turn',
            circuitBreaker: { key: 'chat-upstream', failureThreshold: 5, resetAfterMs: 30_000 },
        },
    },
} as const;

/** Kill-switch for token streaming: `tuning.streaming: false` → sendTurnStream runs buffered inside the streaming envelope. */
function isStreamingEnabled(ctx?: any): boolean {
    return getChatTuning(ctx).streaming;
}

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

/**
 * @param options.recentMessageLimit hydrate only the last N messages. Pass it
 *        whenever the caller is going to window the history anyway (sendTurn),
 *        so a long transcript is never materialized just to be sliced.
 */
async function requireSessionAccess(
    ctx: any,
    sessionId: string,
    options: { recentMessageLimit?: number } = {},
): Promise<ChatSessionHydration> {
    const hydrated = await getRegistry().hydrateSession(sessionId, options);
    const owner = (hydrated.session.metadata?.ownerPrincipal ?? null) as string | null;

    // Strict principal match. There is deliberately NO "unowned" branch: a record
    // without an owner belongs to nobody and is readable by nobody. (The previous
    // ACL compared `ctx.user?.id ?? null` on both sides — and since nothing ever
    // populated `user.id`, every session compared null === null and was readable,
    // renameable and deletable by any caller.)
    if (!owner) {
        throw new Error('Chat session has no owner and cannot be accessed.');
    }
    if (owner !== resolveUserScope(ctx)) {
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
Never end a message on a step you have not taken yet: a reply that only says what you are about to do is delivered to the user as your answer and stops the turn. Do the step now, or ask the user a question — those are the only two ways a message may end.
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

/** Longest custom system prompt accepted from a client, in characters. */
const PERSONALITY_PROMPT_MAX = 8000;

/**
 * The session's own custom personality, when it matches the requested id.
 *
 * Custom prompts are stored on the session (`metadata.customPersonality`) rather
 * than in the process-wide personality registry — see `createSession` for why.
 */
function sessionCustomPersonality(session: ChatSession, personalityId?: string | null): ChatPersonality | null {
    const custom = session?.metadata?.customPersonality as ChatPersonality | undefined;
    if (!custom || typeof custom.systemPrompt !== 'string') return null;
    if (personalityId && custom.id !== personalityId) return null;
    return custom;
}

/**
 * Attachment index for ONE turn, with payloads fetched on demand.
 *
 * Stored attachment records carry metadata only; the base64 payload lives in
 * blob storage. Materializing every attachment a session ever had — which is
 * what holding `dataUrl` on the record amounted to — is precisely the memory
 * profile being removed, so only the ids referenced by the turn's message
 * window are resolved, and the results are turn-scoped copies that are never
 * written back.
 */
async function buildTurnAttachmentIndex(
    sessionId: string,
    attachments: ChatAttachmentRecord[],
    windowMessages: ChatMessage[],
): Promise<Map<string, ChatAttachmentRecord>> {
    const index = buildAttachmentIndex(attachments);

    const store: any = getRegistry().getSessionStore();
    if (typeof store.getAttachmentPayload !== 'function') return index;

    const wanted = new Set<string>();
    for (const message of windowMessages) {
        for (const part of (message?.parts || []) as any[]) {
            // A part that carries its own payload needs nothing fetched.
            if (part?.attachmentId && !part?.dataUrl && !part?.url) wanted.add(String(part.attachmentId));
        }
    }
    if (!wanted.size) return index;

    await Promise.all([...wanted].map(async (attachmentId) => {
        const record = index.get(attachmentId);
        if (!record || record.dataUrl) return;
        try {
            const dataUrl = await store.getAttachmentPayload(sessionId, attachmentId);
            if (dataUrl) index.set(attachmentId, { ...record, dataUrl });
        } catch {
            // Leave the record payload-less: downstream already renders
            // `[Image unavailable]` rather than failing the turn.
        }
    }));
    return index;
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

    const cacheBudget = getChatTuning().decodedMediaCacheBytes;
    if (decoded.bytes.byteLength <= cacheBudget) {
        decodedMediaCache.set(raw, { bytes: decoded.bytes, mediaType: decoded.mediaType });
        decodedMediaCacheBytes += decoded.bytes.byteLength;
        while (decodedMediaCacheBytes > cacheBudget && decodedMediaCache.size) {
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

function attachmentExceedsInlineLimit(bytes: Uint8Array | null | undefined, ctx?: any): boolean {
    return !!bytes && bytes.byteLength > getChatTuning(ctx).maxInlineAttachmentBytes;
}

function ensureBuiltinAdapters() {
    // No built-in provider adapters are registered by core.
    // Provider plugins are responsible for registering their own adapter implementations.
}

/**
 * Full-detail rendering of one namespace (signatures + descriptions + TS
 * declarations). Shared by the always-full core dump and the session-expanded
 * block so a namespace renders byte-identically in either position — downstream
 * prompt-cache stability depends on it.
 */
function renderFullNamespace(ns: AllowedScriptApiManifest["namespaces"][number]): string {
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
}

function renderCompactNamespace(ns: AllowedScriptApiManifest["namespaces"][number]): string {
    const methodNames = ns.methods.map((m) => m.name).join(', ');
    const namespaceDescription = (ns as any).description ? ` - ${(ns as any).description}` : '';
    return `- namespace ${ns.namespace}${namespaceDescription}
  methods: ${methodNames || '(none)'}`;
}

const EXPANDED_NAMESPACES_MAX = 16;
const EXPANDED_NAMESPACE_NAME_MAX = 64;

/**
 * Client-sent expansion set, sanitized: bounded, string-only, intersected with the
 * request's own manifest (a name whose docs the client did not send cannot be
 * rendered, so unknown/ungranted names drop silently — a mid-session consent
 * revoke self-heals here), minus namespaces already rendered in full. Sorted for
 * byte-stable rendering.
 */
function sanitizeExpandedNamespaces(
    value: unknown,
    allowedScriptApi: AllowedScriptApiManifest | undefined,
    fullNamespaces: Set<string>
): string[] {
    if (!Array.isArray(value) || !value.length) return [];
    const known = new Set((allowedScriptApi?.namespaces || []).map((ns) => ns.namespace));
    const out: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') continue;
        const name = entry.trim();
        if (!name || name.length > EXPANDED_NAMESPACE_NAME_MAX) continue;
        if (!known.has(name) || fullNamespaces.has(name)) continue;
        if (!out.includes(name)) out.push(name);
        if (out.length >= EXPANDED_NAMESPACES_MAX) break;
    }
    return out.sort();
}

/**
 * Stable system block carrying the full signatures of namespaces the model already
 * discovered this session. Placed AFTER the stable prefix blocks and BEFORE the
 * volatile live-viewer snapshot: the set is sorted and monotonic, so within one
 * assistant loop it changes at most once per newly-touched namespace — each such
 * change replaces what would otherwise be a whole describeScriptingApi round-trip.
 * The compact catalogue above deliberately still lists these namespaces (removing
 * them there would churn the cached prefix on every expansion).
 */
function expandedNamespacesSystemContent(
    allowedScriptApi: AllowedScriptApiManifest | undefined,
    expandedNamespaces: string[]
): string {
    if (!expandedNamespaces.length || !allowedScriptApi?.namespaces?.length) return '';
    const byName = new Map(allowedScriptApi.namespaces.map((ns) => [ns.namespace, ns]));
    const blocks = expandedNamespaces
        .map((name) => byName.get(name))
        .filter((ns): ns is AllowedScriptApiManifest["namespaces"][number] => !!ns)
        .map(renderFullNamespace);
    if (!blocks.length) return '';
    // Namespace-specific workflow guidance travels with the namespace's rendering
    // position — when `visualization` is compact-by-default and expands here, its
    // guidance block comes along too.
    const vizGuidance = expandedNamespaces.includes('visualization')
        ? visualizationNamespaceGuidance(allowedScriptApi)
        : '';
    return `### Session-expanded namespaces (full signatures — already discovered this session; do NOT call describeScriptingApi for these)
${blocks.join('\n\n')}${vizGuidance}`;
}

function scriptSystemContent(
    allowedScriptApi?: AllowedScriptApiManifest,
    options: { executionMode?: string | null; fullNamespaces?: Set<string> } = {}
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
- Do not claim host helpers are unavailable unless a runtime error explicitly says so.

Calling the scripting API from a host script:
- The entry point is \`APPLICATION_CONTEXT.Scripting.getApi('<namespace>', { bypassConsent: true })\`. It returns the live namespace object; its methods are async, so \`await\` every call. Example: \`const recorder = APPLICATION_CONTEXT.Scripting.getApi('recorder', { bypassConsent: true }); return await recorder.listRecordings();\`
- \`getApi\` returns undefined for a namespace that is not registered. Enumerate what exists with \`Object.keys(APPLICATION_CONTEXT.Scripting.namespaces)\` instead of guessing.
- Do NOT use \`Scripting.getContext(...).executeScript(...)\` from a host script: that re-enters the sandboxed worker path and is bound by consent and viewer binding you have already bypassed here.
- Do NOT read or depend on underscore-prefixed fields of Scripting objects; they are private implementation details that change.
- Your script receives a \`signal\` (an AbortSignal). A long loop MUST check \`signal.aborted\` and return early — the harness cannot interrupt a host script that ignores it.`;
    }

    if (!allowedScriptApi?.namespaces?.length) {
        return [
            'Scripting API access is currently disabled.',
            'Do not produce executable viewer scripts.',
            'Do not call scripting namespaces.',
            'If the user asks for automation, explain that scripting access is not currently granted.',
        ].join('\n');
    }

    const fullNamespaces = options.fullNamespaces || CORE_SCRIPT_NAMESPACES;
    const coreNamespaces = allowedScriptApi.namespaces.filter((ns) => fullNamespaces.has(ns.namespace));
    const pluginNamespaces = allowedScriptApi.namespaces.filter((ns) => !fullNamespaces.has(ns.namespace));

    const coreText = coreNamespaces.map(renderFullNamespace).join('\n\n');
    const pluginText = pluginNamespaces.length
        ? `\n\nAdditional namespaces (compact catalogue — you may call their listed methods DIRECTLY; if a call is malformed, the runtime's failure feedback contains the exact signatures of every method you referenced. Use \`application.describeScriptingApi('<namespace>')\` only to browse a namespace before deciding):
${pluginNamespaces.map(renderCompactNamespace).join('\n\n')}`
        : '';
    const namespacesText = `${coreText}${pluginText}`;

    // Viz guidance follows the namespace's rendering position: here when rendered in
    // full (stable prefix); appended to the session-expansion block when the
    // namespace is compact and gets expanded mid-session (keeps this block stable).
    const visualizationGuidance = fullNamespaces.has('visualization')
        ? visualizationNamespaceGuidance(allowedScriptApi)
        : '';
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
- Long-running scripts: call \`progress(value)\` (a plain global, not a namespace — do not \`await\` it) whenever you have accumulated usable intermediate data, e.g. \`progress({ scanned: i, findings });\`. If the script is later stopped or times out, the LAST progress payload is what you get back instead of nothing — so a loop over many items should publish progress every few iterations. Progress payloads must be plain JSON-serializable values, and they replace each other (only the last one survives).
- Each script you emit costs a full model round-trip. Do as much of the task as possible in ONE script: chain multiple namespace calls with intermediate variables and return one combined result object. Split into separate scripts ONLY when you must SEE a result before deciding what to do next (a screenshot to judge visually, detected regions to choose between, a validation outcome you cannot predict).

Do not use scripting for greetings, thanks, or simple acknowledgements that do not require viewer inspection or action.
Scripting has priority whenever the allowed API can perform the task, inspect state, fetch viewer data, or automate a multi-step action.
When scripting can help, you MUST use it instead of describing manual steps.
Do not assume any previous script succeeded unless its result is explicitly present in the conversation.
If the user asks who created, authored, or owns annotations, comments, or other viewer items, only answer if the available information identifies the current user. Otherwise state the limitation briefly instead of inferring.

Output rules:
- To run viewer code, call the \`run_viewer_script\` tool with your JavaScript as its \`code\` argument. If tool-calling is unavailable to you, instead return exactly ONE fenced code block tagged xopat-script (\`\`\`xopat-script ... \`\`\`) — the two are equivalent and the runtime executes either automatically. Do NOT do both, and emit at most one script per turn.
- A message with no tool call and no fenced block ENDS THE TURN: it is delivered to the user as your final answer and NOTHING runs. So never announce a step and stop — "let me start by inspecting…", "I'll check…", "first I'll scan…" all end the conversation with an empty promise, and the user has to ask you again to do the thing you just said you would do.
- Therefore: any message that would announce an action must BE that action. Replace "let me check X" with the call that checks X, in that same message; keep at most one short clause of prose alongside it, or none. Describing the script instead of emitting it is the same failure.
- The only two acceptable endings for a turn are: an answer to the user, or a question to the user. Never a stated intention.
- Do NOT hand-write tool-call syntax as message TEXT: pseudo-XML, JSON call envelopes, function-call objects, or tokens such as <call>, <message>, <|start|>, <|channel|>. Use the real tool call, or the fenced block — nothing pasted in between.
- Do NOT say "run this script", "execute this", "here is a script", "use the API", or similar technical wording unless the user explicitly asks for technical details.
- Prefer returning plain JSON-serializable values: string, number, boolean, object, array, or null.
- For user-facing findings, prefer returning a plain object or array with the exact fields you want to inspect next.
- If you produce an image or file, return it together with a short textual summary when possible, for example \`return ["Viewport screenshot captured.", screenshotDataUrl, metadata];\`.
- Do not rely on console output or side effects for feedback. Only the returned value is guaranteed to be passed back.
- If an earlier result was truncated and names a stored-result handle ("res-…"), read the remainder with \`await application.readScriptResult(handle, { path })\` — prefer a targeted \`path\` slice over sequential offset reads, and never re-fetch data you already have.
- If a requested action does not map cleanly to an allowed method, do not invent a method. Ask a brief clarification question or use the closest valid method sequence.
- Assume the application executes xopat-script automatically.
- When the allowed scripting API exposes discovery or documentation methods for the task, inspect those first before mutating state. Prefer exploring available options over guessing field names, layer shapes, or method usage.
- Some namespaces below are documented in full; the rest are listed compactly (name + method names only). Call compact-namespace methods DIRECTLY when the method name plausibly fits — do NOT call \`describeScriptingApi()\` first. If your call is malformed or a method does not exist, the runtime's failure feedback contains the exact signatures of every method your script referenced; correct the call from those. \`describeScriptingApi('<namespace>')\` remains available (every namespace exposes it) for when you want to browse a namespace's capabilities before deciding what to do. The set of available namespaces can change while the app runs — if a new capability is announced, its methods are callable immediately.
- Attempt before you deny. If an allowed namespace lists a method that plausibly does what the user asked (e.g. the user asks to analyze something and an allowed namespace exposes a matching method), you MUST attempt it — do NOT reply that it "won't work", "has no model", or "isn't configured" without having actually tried. Reported failures come from the runtime's host feedback, not from your assumptions about backend/model configuration. If the user names a model or feature that isn't listed verbatim, treat it as a possibly-misheard alias for the closest available capability rather than declaring it absent.
- Attempts are bounded: at most ONE direct attempt plus ONE corrected retry per capability (the failure feedback carries the exact signatures to correct with); call \`describeScriptingApi()\` only when the method you need is not listed at all. If the corrected retry fails, report the runtime's failure text to the user VERBATIM (briefly worded for non-technical users) and stop — never invent an explanation for the failure, never retry the identical call, and never speculate about backend configuration.
- Do not deliver a definitive clinical diagnosis yourself from visual inspection. When an allowed namespace exposes an analysis capability for the domain in question, use it and present its output as model-assisted findings that support the expert's own read, not as a diagnosis. (Namespace-specific guidance below spells out which method to prefer when such a capability is present.)
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
- The host validates every \`addVisualization\` / \`updateVisualizationAt\` / \`replaceVisualizations\` input against the schema and coupling rules BEFORE applying it, and a rejected input fails with precise JSON-pointer schema errors and coupling violations in the failure feedback. Call the mutating method directly and correct from the returned errors. \`visualization.validateProposedVisualization(viz)\` remains available when you want to iterate on a draft without triggering the user review dialog — and when you do use it, pass its \`normalized\` result to the mutating call instead of writing the config out a second time.
- Inside a layer's \`params\`, each control envelope is discriminated by its own \`type\` field (the SAME field name as the shader layer's \`type\`, just one nesting level deeper — context disambiguates). Do NOT use \`uiType\`.
- For the colormap envelope: \`default\` is the SELECTED palette name and \`mode\` constrains which palettes are valid. Pick \`mode\` to match the palette family — \`singlehue\` for single-colour ramps (Blues, Greens, Greys, Purples, Reds); \`sequential\` for perceptual ramps (Viridis, Plasma, Magma, Inferno, Turbo, Hot, YlGnBu, etc.); \`diverging\` for two-ended ramps (RdBu, BrBG, PiYG, Spectral, etc.); \`qualitative\` for categorical sets (Set1, Set2, Paired, Dark2, Accent, etc.). A \`default\` not in the chosen \`mode\`'s group is silently substituted with that mode's default and the user sees the wrong colour. Read \`visualization.getSchema()\` if unsure which group a palette belongs to.
- If the user declines the visualization review without sending feedback (the script error contains "declined the proposal without giving feedback"), do NOT silently retry with a different shader or palette. Ask the user one short clarifying question — what they wanted different — and only re-propose after they answer.
- Worked example (colormap rendering channel-0 intensity in Blues with two breaks → three steps):
  \`\`\`
  return await visualization.addVisualization({
    name: "Blue intensity overlay",
    shaders: { L1: {
      id: "L1", type: "colormap", dataReferences: [0],
      params: {
        color:     { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
        threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
        connect: true,
      },
    } },
  }, { makeActive: true });
  \`\`\`
`;
}

//TODO: We might want to have this as part of the respective module, not here.. on the other side this is
//   a crucial part of the interaction with LLM, so for now keeping it here
/**
 * When the `pathology` namespace is allowed, inject the orient-first playbook so
 * the agent behaves like a pathologist opening a case: get a whole-slide overview,
 * find the actual tissue, then drill in — all rendered OFF-SCREEN so the user's
 * viewport is never hijacked. `exploreSlide` returns the ranked tissue regions;
 * this block encodes the workflow and the coverage-semantics gotcha.
 */
function pathologyNamespaceGuidance(allowedScriptApi?: AllowedScriptApiManifest): string {
    if (!allowedScriptApi?.namespaces?.length) return '';
    if (!allowedScriptApi.namespaces.some((ns) => ns.namespace === 'pathology')) return '';

    return `
### Pathology namespace — orient first, browse off-screen
- Slide-wide jobs (\`exploreSlide\`, \`reviewRegions\`, \`buildOverview\`, region-scoped \`analyzeRegion\`) render regions OFF-SCREEN through the same pipeline the user sees — they NEVER move the user's viewport, and the user keeps navigating freely while they run. You do not need to (and must not) navigate the viewer to "see" a part of the slide: pass a \`region\` instead.
- For ANY question about what is on a slide, or before working on "the tissue"/"a region"/"a tumour", FIRST call \`pathology.exploreSlide()\`. It surveys the whole slide off-screen, detects tissue, and returns \`regions\` (tissue islands ranked largest-first, each with a \`bounds\` box), whole-slide \`slideCoverage\`, and slide metadata (dimensions, µm/px, native magnification).
- To LOOK at a specific place yourself, call \`pathology.analyzeRegion(prompt, { region, magnification | targetPixels })\` — a small patch (e.g. targetPixels ~500k, or a tight bounds) is cheap; request only the resolution the question needs, not a full frame. Without \`region\` it snapshots what the USER currently sees — use that form only for questions about the user's current view ("what am I looking at?").
- ZOOMING IN IS YOUR JOB, NOT A QUESTION FOR THE USER. Inside a task they already asked for, "the resolution was insufficient", "this needs high-power review" and "I recommend inspecting region N" are instructions to call \`analyzeRegion\` again on that region with a higher \`magnification\` — never sentences to put in the answer. Ask the user only for what they know and you cannot measure (what the specimen is, what they want examined). Establish that ONCE, up front, in one bundled question, and store it with \`pathology.setSlideContext({ stain, stainClass, organ })\`; \`pathology.getSlideContext()\` is free, so check it before asking at all. Everything afterwards is grounded in it automatically.
- A request to REPORT what is on the slide ("report the findings", "is there cancer", "what does this show") is a slide-wide hunt: run ONE \`pathology.buildOverview({ query })\` and answer from its tree. Do not hand-loop \`analyzeRegion\` over the regions — each iteration costs a full round-trip, and the walk already drills into anything it could not read, which a hand-loop does not.
- Navigation (\`viewer.frameImageRegion(bounds)\` or region links) is FOR THE USER — offer it so they can look too, only to detected-tissue bounds, NEVER to guessed or arbitrary coordinates.
- If \`isComplete\` is false, the render ran on partially-loaded tiles: the numbers are provisional and likely understated — say so and offer to re-run; do NOT conclude the slide is blank.
- If \`isComplete\` is true and \`slideCoverage\` is ~0 or \`regions\` is empty, tell the user the slide looks blank / has no detectable tissue. Do NOT keep hunting for something to show.
- Coverage semantics — every result names its own scope (\`coverageScope\`): \`exploreSlide.slideCoverage\` is WHOLE-SLIDE; \`annotateTissue.viewCoverage\` is CURRENT-VIEW; \`tissueCoverage.annotationTissueFraction\` is the ANNOTATION's tissue share and \`fractionOfViewTissue\` is the annotation's share of the visible tissue. Quote the number together with its scope.
- The overview is low-resolution, so \`regions[i].bounds\` are approximate (\`isApproximate: true\`). To outline a region precisely, frame it first, then call \`annotateTissue()\` at that zoom (annotateTissue works on the current view).
- To go through tissue region by region ("review the slide", "check each area"), call \`pathology.reviewRegions({ max, feature })\` — it renders each region off-screen and runs the job (default \`analyze\`), returning one result per region. Prefer it over hand-rolling a loop.
- For a BROAD question that needs a map of the whole slide ("where are the regions with X?", "find areas that look like Y", "give me an expert walkthrough"), do NOT hand-loop. First call \`pathology.getOverview()\`; if it returns a tree, answer from it (each node has \`findings\`, \`interest\`, and a \`bounds\` to navigate to with \`viewer.frameImageRegion(node.bounds)\`). If it is null, or its \`query\`/\`builtAtIso\` no longer fits, or \`budget.truncated\` is true, call \`pathology.buildOverview({ query: "X" })\` ONCE — it orients, describes and scores the tissue islands, and drills into the interesting ones on a budget, caching the result. When \`budget.truncated\` is true, tell the user the overview is partial and offer to extend it.
- Rank your answer and build region links from the result's \`ranked\` array (focal regions, highest-interest first) — each \`ranked[i].bounds\` is a tight, on-slide window; map it straight into a region link (bounds {x,y,width,height} → x,y,w,h). Do NOT link the coarse depth-0 \`root\` boxes: they are whole tissue islands and framing them just shows the slide. Never fabricate or "recentre" coordinates — use the bounds as given.
- \`segmentAtPoint\` results carry a \`status\`: "empty" is a genuine negative (nothing segmentable there); "rejected-oversegmented" means the run FAILED validation — report it as a failed attempt, never as a finding about the tissue.
- Present any \`analyzeRegion\`/\`reviewRegions\`/\`hint\` output as model-assisted findings that support the pathologist's own read — never as a definitive diagnosis.
- CHAIN mechanical steps in one script instead of one script per step. Splitting is only needed when a human-like visual judgement (a screenshot, choosing between regions by appearance) must happen in between. Worked example — orient, frame the largest tissue region and outline it in ONE script:
  \`\`\`
  const overview = await pathology.exploreSlide();
  if (!overview.regions?.length) return { overview, note: "no detectable tissue" };
  await viewer.frameImageRegion(overview.regions[0].bounds);
  const annotation = await pathology.annotateTissue();
  return { slideCoverage: overview.slideCoverage, framedRegion: overview.regions[0], annotation };
  \`\`\`
`;
}

const LIVE_VIEWER_CONTEXT_MAX_VIEWERS = 32;
const LIVE_VIEWER_CONTEXT_MAX_NAMESPACES = 32;
const LIVE_VIEWER_CONTEXT_MAX_DRIVERS = 16;
const LIVE_VIEWER_CONTEXT_MAX_FEATURES = 32;
const LIVE_VIEWER_CONTEXT_MAX_STRING = 160;
const LIVE_VIEWER_CONTEXT_MAX_ISO = 64;
const LIVE_VIEWER_CONTEXT_MAX_ZSTACK_LABELS = 64;
// The overview's search query is free-form sentence-like text the assistant wrote,
// not an identifier — it does not belong under the generic id bound above.
const LIVE_VIEWER_CONTEXT_MAX_QUERY = 512;

/**
 * A structural violation of the snapshot shape: a wrong type, an unexpected key, an
 * array over its item limit. It means the client is broken, version-skewed, or hostile,
 * so the whole snapshot is dropped and the turn runs without a viewer-state block.
 *
 * Over-length and empty *strings* are deliberately NOT this: they are ordinary data
 * (an assistant-authored query, a slide with no operator-set name) and are clamped in
 * place. The prompt-injection guarantee is the key allowlist plus a bounded length —
 * a truncated string is exactly as trusted as one that fit.
 */
class LiveContextRejected extends Error {}

function rejectLiveContext(message: string): never {
    throw new LiveContextRejected(`Invalid liveViewerContext: ${message}`);
}

function isPlainObject(value: any): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowedKeys: string[], label: string): void {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) rejectLiveContext(`unexpected ${label}.${key}`);
    }
}

/**
 * Clamp a required string to its bound, recording what was cut. `notes` carries labels
 * and lengths only — never the values, which can hold clinical text.
 */
function sanitizeBoundedString(value: unknown, maxLen: number, label: string, notes: string[]): string {
    if (typeof value !== 'string') rejectLiveContext(`${label} must be a string`);
    if (value.length > maxLen) {
        notes.push(`${label} truncated ${value.length}->${maxLen}`);
        return value.slice(0, maxLen);
    }
    return value;
}

/** As {@link sanitizeBoundedString}, but an absent or empty value normalizes to null. */
function sanitizeNullableBoundedString(value: unknown, maxLen: number, label: string, notes: string[]): string | null {
    if (value == null || value === '') return null;
    return sanitizeBoundedString(value, maxLen, label, notes);
}

function requireBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') rejectLiveContext(`${label} must be boolean`);
    return value;
}

function requireFiniteOptionalNumber(value: unknown, label: string): number | null | undefined {
    if (value == null) return value as null | undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        rejectLiveContext(`${label} must be a finite number`);
    }
    return value;
}

function validateLiveViewerContextZStack(value: unknown, label: string, notes: string[]): LiveViewerContextZStack | null {
    if (value == null) return null;
    if (!isPlainObject(value)) rejectLiveContext(`${label} must be an object or null`);
    assertExactKeys(value, ['count', 'index', 'spacingUm', 'labels'], label);
    if (typeof value.count !== 'number' || !Number.isFinite(value.count)) {
        rejectLiveContext(`${label}.count must be a finite number`);
    }
    if (typeof value.index !== 'number' || !Number.isFinite(value.index)) {
        rejectLiveContext(`${label}.index must be a finite number`);
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
                (item, index) => sanitizeBoundedString(item, LIVE_VIEWER_CONTEXT_MAX_STRING, `${label}.labels[${index}]`, notes)
            ),
    };
}

function validateLiveViewerContextOverview(value: unknown, label: string, notes: string[]): LiveViewerContextOverview | null {
    if (value == null) return null;
    if (!isPlainObject(value)) rejectLiveContext(`${label} must be an object or null`);
    assertExactKeys(
        value,
        ['regionsDescribed', 'depth', 'slideCoverage', 'isComplete', 'truncated', 'builtAtIso', 'query', 'gist',
            'contextKnown', 'warningCount'],
        label
    );
    const requireFiniteNumber = (v: unknown, l: string): number => {
        if (typeof v !== 'number' || !Number.isFinite(v)) rejectLiveContext(`${l} must be a finite number`);
        return v;
    };
    return {
        regionsDescribed: requireFiniteNumber(value.regionsDescribed, `${label}.regionsDescribed`),
        depth: requireFiniteNumber(value.depth, `${label}.depth`),
        slideCoverage: requireFiniteNumber(value.slideCoverage, `${label}.slideCoverage`),
        isComplete: requireBoolean(value.isComplete, `${label}.isComplete`),
        truncated: requireBoolean(value.truncated, `${label}.truncated`),
        builtAtIso: sanitizeBoundedString(value.builtAtIso ?? '', LIVE_VIEWER_CONTEXT_MAX_ISO, `${label}.builtAtIso`, notes),
        query: sanitizeNullableBoundedString(value.query, LIVE_VIEWER_CONTEXT_MAX_QUERY, `${label}.query`, notes),
        gist: sanitizeNullableBoundedString(value.gist, LIVE_VIEWER_CONTEXT_MAX_STRING, `${label}.gist`, notes),
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
    if (!Array.isArray(value)) rejectLiveContext(`${label} must be an array`);
    if (value.length > maxItems) rejectLiveContext(`${label} exceeds item limit`);
    return value.map(mapItem);
}

function validateLiveViewerContextSnapshotOrThrow(input: LiveViewerContext, notes: string[]): LiveViewerContext {
    if (!isPlainObject(input)) rejectLiveContext('expected an object');
    assertExactKeys(
        input,
        ['composedAt', 'activeViewerId', 'viewerCount', 'viewers', 'loadedNamespaces', 'pathologyDrivers'],
        'root'
    );

    const viewers = requireBoundedArray(input.viewers, LIVE_VIEWER_CONTEXT_MAX_VIEWERS, 'viewers', (item, index) => {
        if (!isPlainObject(item)) rejectLiveContext(`viewers[${index}] must be an object`);
        assertExactKeys(item, ['contextId', 'imageName', 'isActive', 'background', 'zoom', 'currentMagnification', 'nativeMagnification', 'zStack', 'pathologyOverview'], `viewers[${index}]`);
        return {
            contextId: sanitizeBoundedString(item.contextId, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].contextId`, notes),
            imageName: sanitizeBoundedString(item.imageName, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].imageName`, notes),
            isActive: requireBoolean(item.isActive, `viewers[${index}].isActive`),
            background: sanitizeNullableBoundedString(item.background, LIVE_VIEWER_CONTEXT_MAX_STRING, `viewers[${index}].background`, notes),
            zoom: requireFiniteOptionalNumber(item.zoom, `viewers[${index}].zoom`),
            currentMagnification: requireFiniteOptionalNumber(item.currentMagnification, `viewers[${index}].currentMagnification`),
            nativeMagnification: requireFiniteOptionalNumber(item.nativeMagnification, `viewers[${index}].nativeMagnification`),
            zStack: validateLiveViewerContextZStack(item.zStack, `viewers[${index}].zStack`, notes),
            pathologyOverview: validateLiveViewerContextOverview(item.pathologyOverview, `viewers[${index}].pathologyOverview`, notes),
        };
    });

    // Absent namespaces mean "the client sent none", the same as pathologyDrivers —
    // not a malformed snapshot.
    const loadedNamespaces = input.loadedNamespaces == null ? [] : requireBoundedArray(
        input.loadedNamespaces,
        LIVE_VIEWER_CONTEXT_MAX_NAMESPACES,
        'loadedNamespaces',
        (item, index) => {
            if (!isPlainObject(item)) rejectLiveContext(`loadedNamespaces[${index}] must be an object`);
            assertExactKeys(item, ['name', 'granted'], `loadedNamespaces[${index}]`);
            return {
                name: sanitizeBoundedString(item.name, LIVE_VIEWER_CONTEXT_MAX_STRING, `loadedNamespaces[${index}].name`, notes),
                granted: requireBoolean(item.granted, `loadedNamespaces[${index}].granted`),
            };
        }
    );

    const pathologyDrivers = input.pathologyDrivers == null
        ? undefined
        : requireBoundedArray(input.pathologyDrivers, LIVE_VIEWER_CONTEXT_MAX_DRIVERS, 'pathologyDrivers', (item, index) => {
            if (!isPlainObject(item)) rejectLiveContext(`pathologyDrivers[${index}] must be an object`);
            assertExactKeys(item, ['id', 'label', 'local', 'features'], `pathologyDrivers[${index}]`);
            return {
                id: sanitizeBoundedString(item.id, LIVE_VIEWER_CONTEXT_MAX_STRING, `pathologyDrivers[${index}].id`, notes),
                label: sanitizeBoundedString(item.label, LIVE_VIEWER_CONTEXT_MAX_STRING, `pathologyDrivers[${index}].label`, notes),
                local: requireBoolean(item.local, `pathologyDrivers[${index}].local`),
                features: requireBoundedArray(
                    item.features,
                    LIVE_VIEWER_CONTEXT_MAX_FEATURES,
                    `pathologyDrivers[${index}].features`,
                    (feature, featureIndex) =>
                        sanitizeBoundedString(
                            feature,
                            LIVE_VIEWER_CONTEXT_MAX_STRING,
                            `pathologyDrivers[${index}].features[${featureIndex}]`,
                            notes
                        )
                ),
            };
        });

    const activeViewerId = sanitizeNullableBoundedString(input.activeViewerId, LIVE_VIEWER_CONTEXT_MAX_STRING, 'activeViewerId', notes);
    if (typeof input.viewerCount !== 'number' || !Number.isFinite(input.viewerCount)) {
        rejectLiveContext('viewerCount must be a finite number');
    }

    return {
        composedAt: sanitizeBoundedString(input.composedAt, LIVE_VIEWER_CONTEXT_MAX_ISO, 'composedAt', notes),
        activeViewerId,
        viewerCount: viewers.length,
        viewers,
        loadedNamespaces,
        pathologyDrivers,
    };
}

/**
 * Vet the client-composed viewer snapshot before it is rendered into the system prompt.
 *
 * Total by contract: the snapshot is advisory telemetry, and its only consumer
 * ({@link liveViewerContextSystemContent}) already renders nothing for `undefined`. A
 * malformed snapshot must therefore cost the user a viewer-state block, never their turn.
 */
function validateLiveViewerContextSnapshot(input?: LiveViewerContext, log?: any): LiveViewerContext | undefined {
    if (input == null) return undefined;
    const notes: string[] = [];
    const channel = log || llm;
    try {
        const snapshot = validateLiveViewerContextSnapshotOrThrow(input, notes);
        if (notes.length) channel.debug({ sanitized: notes }, 'liveViewerContext sanitized');
        return snapshot;
    } catch (e: any) {
        const record = { reason: e?.message || String(e) };
        // A LiveContextRejected is the designed verdict on a broken or hostile client;
        // anything else escaping the validator is our own bug and deserves the louder level.
        if (e instanceof LiveContextRejected) {
            channel.warn(record, 'liveViewerContext rejected - turn proceeds without viewer state');
        } else {
            channel.error(record, 'liveViewerContext validator threw - turn proceeds without viewer state');
        }
        return undefined;
    }
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
            currentMagnification: viewer.currentMagnification ?? null,
            nativeMagnification: viewer.nativeMagnification ?? null,
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
Each viewer reports two different magnifications: "currentMagnification" is what the scalebar shows right now (answer "what magnification am I at?" with this), while "nativeMagnification" is the slide's fixed objective power. "zoom" is an internal OpenSeadragon value — never quote it as a magnification. To CHANGE magnification use viewer.setMagnification(20) or viewer.focusOnImage(x, y, 20), where the number is optical magnification, not zoom.
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
Never end a message on a step you have not taken yet: a reply that only says what you are about to do is delivered to the user as your answer and stops the turn. Do the step now, or ask the user a question — those are the only two ways a message may end.
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

/**
 * Drop an inline payload that duplicates a stored attachment.
 *
 * The client re-sends the full base64 inside the message part as well as
 * uploading it, so every upload was retained TWICE: once on the attachment
 * record and once inside message history — the single largest avoidable
 * allocation in the chat server. The part keeps its `attachmentId`, which is all
 * the model path needs: payloads are resolved per turn from the attachment
 * store. Parts with no `attachmentId` are untouched, since nothing else holds
 * their bytes.
 *
 * Applied at the normalization boundary so it protects EVERY store, including a
 * deployment's own `setSessionStore` implementation.
 */
function stripDuplicatedPartPayloads(message: ChatMessage): ChatMessage {
    const parts = message.parts as any[] | undefined;
    if (!parts?.length) return message;
    let changed = false;
    const next = parts.map((part) => {
        if (!part?.attachmentId || typeof part.dataUrl !== 'string') return part;
        changed = true;
        const { dataUrl, ...rest } = part;
        return rest;
    });
    return changed ? { ...message, parts: next } : message;
}

function normalizeIncomingMessage(input: ChatMessage): ChatMessage {
    const message = stripDuplicatedPartPayloads(input);
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
    const probeBudget = createTimeoutLinkedSignal(ctx?.signal, getChatTuning(ctx).probeBudgetMs);

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
    assertProviderRead(ctx, provider);

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

    const listing = await registry.listModels(input.providerId, { ctx, contextId: input.contextId || null, userScope: scope });
    const discovered = listing.models.find((m) => m.id === input.modelId)?.capabilities || null;

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

/**
 * Contextual-availability filter for the client-facing provider/type pickers.
 *
 * A provider (type or instance) may declare `metadata.contexts` (secure-config
 * only) restricting it to an allow-list of contexts. This filter is UX only —
 * the security boundary is the runtime gate in getProviderRuntime, which
 * degrades *closed*. Listing is not a security boundary, so it degrades *open*:
 *
 *  - Unrestricted entry → always visible.
 *  - Restricted entry, list RPC carries a context → visible iff it matches
 *    (a context-aware client narrows its picker to its own context).
 *  - Restricted entry, list RPC carries NO context → visible. The default chat
 *    client lists without a context; hiding here would make the provider
 *    invisible even to eligible users, so we show it and let getProviderRuntime
 *    refuse resolution outside its context (same shape as a requiresLogin
 *    provider that appears in the picker and prompts login on use).
 */
function isAvailableInContext(entry: any, ctxContextId: string | null): boolean {
    const allowed = normalizeContexts(entry?.metadata?.contexts);
    if (!allowed.length) return true;    // unrestricted
    if (!ctxContextId) return true;      // no context signal → don't hide (runtime gate enforces)
    return allowed.includes(ctxContextId);
}

export async function listProviderTypes(ctx?: any): Promise<ProviderTypeListResult> {
    ensureBuiltinAdapters();
    // Internal-only provider types (metadata.hidden === true) are registered so
    // runVisionInference / other server code can resolve them, but must NOT be
    // offered in the "add provider" UI. Filtering happens here at the
    // client-facing RPC boundary only — the registry's own listProviderTypes()
    // stays unfiltered so internal resolution/dedup still sees them.
    const ctxContextId = typeof ctx?.contextId === 'string' && ctx.contextId ? ctx.contextId : null;
    const providerTypes = getRegistry().listProviderTypes()
        .filter((t: any) => t?.metadata?.hidden !== true)
        .filter((t: any) => isAvailableInContext(t, ctxContextId));
    return { providerTypes };
}

export async function createProvider(ctx: any, input: CreateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    // A user-created provider belongs to its creator's principal. (Operator
    // instances go through ensureManagedProvider and stay unowned = shared.)
    return getRegistry().createProviderInstance(input, resolveUserScope(ctx));
}

/**
 * @deprecated Delegates to {@link ensureManagedPluginProvider} — use that directly.
 *
 * Kept as a thin forwarder rather than deleted because `XS.importServerExport` resolves exports
 * by NAME at runtime, so an out-of-tree plugin importing this would break at boot rather than at
 * build. It is not in the `policy` map, so it was never an RPC endpoint.
 *
 * Its former body was a second, subtly wrong implementation: it deduped through
 * `listProviders(ctx, …)`, which filters `metadata.hidden === true`, so a hidden managed provider
 * was re-created on every boot; and it created through `createProvider(ctx, …)`, which stamps the
 * caller as owner — producing a USER-owned "managed" instance, invisible to other users and (under
 * the reference trust rule) deliberately unreachable by reference.
 */
export async function ensureManagedProvider(ctx: any, input: {
    pluginId: string;
    providerType: CreateProviderTypeInput | UpdateProviderTypeInput;
    provider: Omit<CreateProviderInstanceInput, 'typeId'> & { typeId?: string | null };
    managedKey?: string | null;
}): Promise<{
    ok: true;
    providerTypeId: string;
    providerId: string | null;
    managedKey: string;
    providerCreated: boolean;
    providerUpdated: boolean;
}> {
    ensureBuiltinAdapters();
    return await ensureManagedPluginProvider(ctx, input) as any;
}

/**
 * Resolve a provider REFERENCE (instance id / managed key / plugin id / type id) to an instance id.
 *
 * Exists because the client cannot resolve every reference locally: `listProviders` strips hidden
 * providers, and referencing a hidden provider is the documented way to keep an extraction
 * provider off the user-facing picker. Without this the client can only discover that a configured
 * reference is bad by watching an inference fail minutes later.
 *
 * Returns `{ providerId: null }` rather than throwing on a miss, so a misconfigured deployment
 * renders a clean readiness message instead of an error toast.
 *
 * Disclosure: an id, a type id and the hidden flag — strictly less than the existing `getProvider`
 * RPC returns, and the same class of metadata `listTranscriptionProviders` already publishes for
 * hidden instances by design. It dispenses no config and no secrets, and grants nothing: every
 * credential path still runs the ownership and auth-context gates inside `getProviderRuntime`.
 */
export async function resolveProviderRef(ctx: any, input: { ref: string }): Promise<{
    providerId: string | null;
    typeId?: string | null;
    tier?: string;
    hidden?: boolean;
}> {
    ensureBuiltinAdapters();
    const match = getRegistry().resolveProviderRef(input?.ref);
    if (!match) return { providerId: null };
    const instance = await getRegistry().getProviderInstance(match.id);
    if (!instance) return { providerId: null };
    // The alias tiers only ever land on operator records, which everyone may read — but tier 1
    // takes an EXACT id with no eligibility filter (so the runtime gate can refuse a foreign id
    // properly), and this RPC must not become the one place that answers questions about someone
    // else's provider. Mirror `getProvider`'s gate, and report a refusal as "resolves to nothing"
    // rather than confirming the instance exists.
    try {
        assertProviderRead(ctx, instance);
    } catch (e) {
        return { providerId: null };
    }
    return {
        providerId: match.id,
        typeId: instance.typeId ?? null,
        tier: match.tier,
        hidden: instance.metadata?.hidden === true,
    };
}

export async function listProviders(ctx: any, input?: { typeId?: string | null }): Promise<ProviderListResult> {
    ensureBuiltinAdapters();
    const all = await getRegistry().listProviderInstances({ ownerPrincipal: safeUserScope(ctx), typeId: input?.typeId || null });
    // Hide internal-only providers (metadata.hidden === true) from the chat
    // provider picker. They remain resolvable by id via getProviderRuntime (so
    // runVisionInference and the pathology analyze driver keep working) and
    // still visible to the registry's managed-provider dedup — only this
    // client-facing list excludes them. Context-restricted providers
    // (metadata.contexts) are narrowed out only when the list RPC carries a
    // mismatching context (degrade-open, see isAvailableInContext);
    // getProviderRuntime enforces the real gate on use.
    const ctxContextId = typeof ctx?.contextId === 'string' && ctx.contextId ? ctx.contextId : null;
    const providers = all
        .filter((p: any) => p?.metadata?.hidden !== true)
        .filter((p: any) => isAvailableInContext(p, ctxContextId));
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
    assertProviderRead(ctx, provider);
    return provider;
}

export async function updateProvider(ctx: any, input: UpdateProviderInstanceInput): Promise<any> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.id);
    if (!current) throw new Error(`Unknown provider '${input.id}'.`);
    assertProviderWrite(ctx, current);
    return getRegistry().updateProviderInstance(input.id, input);
}

export async function deleteProvider(ctx: any, input: { providerId: string }): Promise<{ ok: true }> {
    ensureBuiltinAdapters();
    const current = await getRegistry().getProviderInstance(input.providerId);
    if (!current) throw new Error(`Unknown provider '${input.providerId}'.`);
    assertProviderWrite(ctx, current);
    await getRegistry().deleteProviderInstance(input.providerId);
    return { ok: true };
}

const USER_SECRET_MAX_VALUE_LENGTH = 4096;

async function buildUserSecretsStatus(ctx: any, providerId: string): Promise<ProviderUserSecretsStatus> {
    const registry = getRegistry();
    // The BYOK dialog is usually the first thing touched after a sign-in, so
    // reconcile here too rather than waiting for the next credential resolution.
    await registry.reconcileSessionPrincipal(ctx);
    const provider = await registry.getProviderInstance(providerId);
    if (!provider) throw new Error(`Unknown provider '${providerId}'.`);
    assertProviderRead(ctx, provider);

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
    assertProviderRead(ctx, provider);

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
    assertProviderRead(ctx, provider);

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
        const listing = await getRegistry().listModels(input.providerId, { ctx, contextId: input.contextId || null, userScope: safeUserScope(ctx) });
        return { providerId: input.providerId, ...listing };
    }
    if (input.providerTypeId) {
        const listing = await getRegistry().previewListModels(input.providerTypeId, {
            ctx,
            contextId: input.contextId || null,
            draftConfig: input.draftConfig || {},
            draftSecrets: input.draftSecrets || {},
        });
        return { providerTypeId: input.providerTypeId, ...listing };
    }
    throw new Error('listModels requires either providerId or providerTypeId.');
}

export async function createSession(ctx: any, input: CreateSessionInput): Promise<ChatSession> {
    ensureBuiltinAdapters();
    ensureBuiltinPersonalities();
    const registry = getRegistry();
    const provider = await registry.getProviderInstance(input.providerId);
    if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);

    // A caller-supplied personality is stored ON THE SESSION, not in the global
    // personality registry. Registering it globally (as this used to) meant a
    // caller-chosen id created a permanent entry — unbounded growth keyed by
    // request input — and any other caller who guessed the id could read the
    // prompt back. Session-local keeps the same behavior for the owner and gives
    // both properties away to nobody.
    const customPersonality = input.personalityId && input.personalityPrompt
        ? { id: input.personalityId, label: input.personalityId, systemPrompt: String(input.personalityPrompt).slice(0, PERSONALITY_PROMPT_MAX) }
        : null;

    return registry.getSessionStore().createSession({
        id: registry.newId('sess'),
        title: input.title || 'New chat',
        providerId: input.providerId,
        providerTypeId: provider.typeId,
        modelId: input.modelId || provider.defaultModelId || '',
        personalityId: input.personalityId || 'default',
        contextId: input.contextId || provider.contextId || null,
        // Ownership is the caller's principal, resolved server-side. Never a
        // caller-supplied identity, and never null — see requireSessionAccess.
        metadata: {
            ...input.metadata,
            ownerPrincipal: resolveUserScope(ctx),
            ...(customPersonality ? { customPersonality } : {}),
        },
    });
}

export async function listSessions(ctx: any, input?: { providerId?: string | null }): Promise<SessionListResult> {
    const sessions = await getRegistry().getSessionStore().listSessions({
        providerId: input?.providerId || undefined,
        ownerPrincipal: resolveUserScope(ctx),
    });
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
    const messages = input.messages.map(normalizeIncomingMessage);
    llm.debug({
        sessionId: input.sessionId,
        existingMessageCount: hydrated.messages?.length || 0,
        appendedCount: messages.length,
    }, 'appendMessages');
    llm.sensitive("APPEND_MESSAGES_INPUT", {
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

    llm.sensitive("APPEND_MESSAGES_OUTPUT", {
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
    return runTurn(ctx, input, null);
}

/**
 * Streaming variant: identical turn semantics, but text deltas of the model
 * reply are emitted as `{type:'delta', text}` events through the RPC streaming
 * envelope while the model generates. The terminal result is byte-identical to
 * sendTurn's. Providers that reject streaming are detected once, cached on the
 * model's capability record, and transparently served buffered (zero-delta
 * stream) from then on.
 */
export async function sendTurnStream(ctx: any, input: SendTurnInput): Promise<ChatTurnResult> {
    const emit = isStreamingEnabled(ctx) && typeof ctx?.emit === 'function'
        ? (event: any) => ctx.emit(event)
        : null;
    return runTurn(ctx, input, emit);
}

/** Upstream died AFTER emitting deltas — never retried, never persisted. */
class PartialEmissionError extends Error {
    partialText: string;
    override cause: any;
    constructor(cause: any, partialText: string) {
        super(`Upstream stream failed after partial output: ${String(cause?.message || cause)}`);
        this.name = 'PartialEmissionError';
        this.cause = cause;
        this.partialText = partialText;
    }
}

function isStreamingUnsupportedError(error: any): boolean {
    if (/UnsupportedFunctionality/i.test(String(error?.name || ''))) return true;
    const status = Number(error?.statusCode ?? error?.status);
    return status >= 400 && status < 500 && /stream/i.test(String(error?.message || error || ''));
}

async function runTurn(
    ctx: any,
    input: SendTurnInput,
    emit: ((event: any) => Promise<void>) | null
): Promise<ChatTurnResult> {
    ensureBuiltinAdapters();
    ensureBuiltinPersonalities();

    // A turn spends a provider credential. Require an identified caller at the
    // CALL SITE, not only via config, so a misconfigured `rpcVerifiers` cannot
    // re-expose it. (A `sess:` principal satisfies this — it is an "is anybody
    // there" check; the login gate is requireProviderContext.)
    resolveUserScope(ctx);

    const tuning = getChatTuning(ctx);
    const turnBudget = createTimeoutLinkedSignal(ctx?.signal, tuning.turnBudgetMs);

    const registry = getRegistry();
    const sessionStore = registry.getSessionStore();
    // Only the window this turn will actually use is loaded. The +1 headroom
    // covers the inline delta appended below, which is pushed onto the hydrated
    // array before the window is taken.
    const requestedWindow = Math.max(1, Math.min(50, Number(input.maxRecentMessages || 14)));
    const hydrated = await requireSessionAccess(ctx, input.sessionId, {
        recentMessageLimit: requestedWindow + 1,
    });
    const session = hydrated.session;
    const runtime = await registry.getProviderRuntime(session.providerId, { ctx, userScope: safeUserScope(ctx) });
    const adapter = registry.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);
    const executionMode = String(input.executionMode || session.metadata?.testMode || '').trim() || null;
    // Total by contract - a malformed snapshot degrades to no viewer-state block, never
    // to a lost turn. See validateLiveViewerContextSnapshot.
    const liveViewerContext = validateLiveViewerContextSnapshot(input.liveViewerContext, ctx?.log);
    // Shape-only turn record: everything here is metadata, so it is emitted at
    // `debug` — no `allowSensitive` needed. The conversation itself stays behind
    // llm.sensitive(...).
    const turnTimer = llm.time('chat turn');
    llm.debug({
        sessionId: session.id,
        providerId: session.providerId,
        providerType: runtime.type?.id,
        adapter: runtime.type?.adapter,
        modelId: session.modelId,
        historyCount: hydrated.messages?.length || 0,
        attachmentCount: hydrated.attachments?.length || 0,
        deltaCount: Array.isArray(input.messagesDelta) ? input.messagesDelta.length : 0,
        streaming: isStreamingEnabled(ctx) && typeof ctx?.emit === 'function',
        executionMode,
        hasViewerContext: !!liveViewerContext,
    }, 'turn started');

    // Client-proposed id for the assistant reply. Load-bearing for streaming
    // cutoffs: the client synthesizes the partial reply locally under this id and
    // re-sends it in the next turn's delta; store id-dedup converges both sides
    // on one record with zero extra round-trips. Validated, never trusted raw;
    // collision can at worst self-collide within the caller's own session
    // (requireSessionAccess gated above).
    const assistantMessageId = typeof input.assistantMessageId === 'string'
        && /^msg_[A-Za-z0-9-]{8,64}$/.test(input.assistantMessageId)
        ? input.assistantMessageId
        : null;

    // Inline message delta: what used to be a separate appendMessages RPC now rides
    // the turn request — one round-trip, one hydration, one auth check per
    // assistant-loop step. Store-side id-dedup makes a retried turn idempotent even
    // when the earlier attempt persisted the delta and then died.
    let persistedDeltaCount = 0;
    if (Array.isArray(input.messagesDelta) && input.messagesDelta.length) {
        const delta = input.messagesDelta.map(normalizeIncomingMessage);
        llm.sensitive("SEND_TURN_DELTA", {
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

    // Session-local custom personality first (see createSession), then the
    // global registry of built-ins and plugin-registered ones.
    const wantedPersonalityId = input.personalityId || session.personalityId;
    const personality = sessionCustomPersonality(session, wantedPersonalityId)
        || registry.getPersonality(wantedPersonalityId)
        || defaultPersonality();

    const maxRecentMessages = requestedWindow;
    // `hydrated.messages` is already the recent window when the store can
    // produce one (see hydrateSession); the slice stays as a guard for stores
    // that returned the full history.
    const recentMessages = mergeAdjacentUserMultimodalTurns(
        hydrated.messages.slice(-maxRecentMessages)
    ).map((message) => sanitizeMessageForModel(message));

    // Attachment payloads are no longer resident in the stored records — pull
    // back only the ones this turn's window actually references. Failures are
    // per-item and non-fatal: a missing payload degrades to
    // `[Image unavailable]` exactly as an evicted one always did.
    const attachmentIndex = await buildTurnAttachmentIndex(
        session.id,
        hydrated.attachments || [],
        recentMessages,
    );

    const modelCaps = await ensureModelCapabilities(ctx, {
        providerId: session.providerId,
        modelId: session.modelId,
        contextId: session.contextId || null,
    });
    // Native tool-calling surface. When viewer scripting is granted (and not the
    // host-script mode, which keeps its own fenced surface), declare the client-side
    // run_viewer_script tool so a tool-capable model emits a structured call instead
    // of narrating "I'll do it" and never acting. Default ON unless a prior turn
    // proved the provider rejects a tools param; the streamed/buffered attempts
    // transcribe the tool-call back into the ```xopat-script fence the rest of the
    // pipeline already handles. `let` because the tools-unsupported fallback strips it.
    const scriptingToolable = !!(input.allowedScriptApi?.namespaces?.length) && executionMode !== 'host';
    // One-turn client escalation (a script that arrived damaged, or a model repeating itself):
    // drop to the fence surface for THIS request only. Deliberately does NOT touch the cached
    // tools verdict — the model's capability has not changed, and poisoning it here would
    // permanently disable tool calling after a single bad turn.
    const requestedFenceTransport = (input as any).scriptTransport === 'fence';
    // Sticky counterpart, same shape as `emitsToolEnvelopes` below: once this session has proven
    // more than once that the model's own output arrives damaged, stay on the fence surface even
    // when the client forgets to ask (a reload, a second panel). Derived from what was observed,
    // never from the model's name, and scoped to the session — never cached per model.
    const reportedDamage = sanitizeTransportDamage((input as any).transportDamage);
    const sessionDamage = sanitizeTransportDamage(session.metadata?.transportDamage) || reportedDamage;
    const forceFenceTransport = requestedFenceTransport || !!sessionDamage;
    let toolsActive = scriptingToolable && !forceFenceTransport
        && (modelCaps.capabilities as any)?.tools !== 'unsupported';
    let chatTools: Record<string, any> | undefined = toolsActive ? buildViewerScriptTools() : undefined;
    const cacheToolsVerdict = async (verdict: 'supported' | 'unsupported') => {
        if ((modelCaps.capabilities as any)?.tools === verdict) return;
        try {
            await registry.setModelCapabilities(session.providerId, session.modelId, {
                ...(modelCaps.capabilities || {}),
                tools: verdict,
            } as any, safeUserScope(ctx));
            (modelCaps.capabilities as any).tools = verdict;
        } catch (_) { /* verdict cache is best-effort */ }
    };

    // Two ways in: the model id looks like a known Harmony deployment (free head start on turn
    // one), or this session has already been caught emitting envelopes (covers every other
    // model, no vendor list to maintain).
    const emitsToolEnvelopes = session.metadata?.emitsToolEnvelopes === true
        || isHarmonyStyleModel(session.modelId, runtime.type.id);
    // With a real tool declared, native tool-call tokens are DESIRABLE — the SDK
    // parses them into the tool-call we transcribe — so only warn against them on the
    // tool-free (fence-only) fallback path.
    // Standing advisory for a session whose connection has been caught damaging the model's own
    // output. Unlike the one-turn escalation line further down, this one is part of the prompt for
    // every remaining turn — the failure it describes is a property of the connection, and the
    // model demonstrably reverts to the syntax that triggers it as soon as the reminder stops.
    const transportDamageAddendum = sessionDamage
        ? `The connection to you has been observed damaging your output in this conversation (${sessionDamage}). ` +
          "Write defensively: one short script per step, built from small named variables rather than one deeply " +
          "nested literal, and never re-type a value the runtime has already accepted — reuse what it returned to you."
        : null;
    const harmonyAddendum = (emitsToolEnvelopes && !toolsActive)
        ? "Channel/tool-call tokens such as <|start|>, <|channel|>, <|message|>, <|call|>, <|tool_call_argument_begin|>, and <|tool_call_end|> are NOT recognised on this fallback path. Do not emit them — the only accepted tool-call surface here is the ```xopat-script ... ``` fenced block contract documented above."
        : null;

    // Which namespaces render in full unconditionally. Client-configurable (static
    // meta `fullPromptNamespaces` — prompt-shaping only, no security surface: it
    // merely selects which of the client's OWN manifest docs render fully). Bounded
    // and intersected with the manifest; default keeps the historical core set.
    let fullNamespaces = CORE_SCRIPT_NAMESPACES;
    if (Array.isArray((input as any).fullPromptNamespaces) && (input as any).fullPromptNamespaces.length) {
        const known = new Set((input.allowedScriptApi?.namespaces || []).map((ns) => ns.namespace));
        const requested = (input as any).fullPromptNamespaces
            .filter((name: unknown): name is string => typeof name === 'string' && !!name && (name as string).length <= EXPANDED_NAMESPACE_NAME_MAX)
            .filter((name: string) => known.has(name))
            .slice(0, EXPANDED_NAMESPACES_MAX);
        if (requested.length) fullNamespaces = new Set(requested);
    }

    // Session-expanded namespaces: merge the client's set into the session metadata
    // (monotonic — a reloaded session keeps its expansions without re-describing)
    // and render the merged set. Sanitized against the request's own manifest.
    const priorExpanded = Array.isArray(session.metadata?.expandedNamespaces)
        ? (session.metadata!.expandedNamespaces as unknown[]).filter((n): n is string => typeof n === 'string')
        : [];
    const expandedNamespaces = sanitizeExpandedNamespaces(
        [...priorExpanded, ...(Array.isArray(input.expandedNamespaces) ? input.expandedNamespaces : [])],
        input.allowedScriptApi,
        fullNamespaces
    );
    if (expandedNamespaces.length !== priorExpanded.length
        || expandedNamespaces.some((name, i) => name !== priorExpanded[i])) {
        session.metadata = { ...(session.metadata || {}), expandedNamespaces };
        await sessionStore.updateSession(session.id, { metadata: session.metadata });
    }

    // Stable-prefix ordering: everything that survives unchanged across turns comes
    // first (preamble, API schema, personality, region-link contract), the volatile
    // live-viewer snapshot comes LAST — provider prompt caches match on prefixes, so
    // a zoom change must only invalidate the tail, not the multi-KB schema above it.
    // The session-expansion block sits between the stable prefix and the volatile
    // tail: sorted + monotonic, it changes at most once per newly-expanded namespace.
    const mergedSystemContent = [
        sessionPreamble(runtime.instance.label, input.allowedScriptApi, { executionMode }),
        scriptSystemContent(input.allowedScriptApi, { executionMode, fullNamespaces }),
        `Active personality: ${personality.label}

${input.personalityPrompt || personality.systemPrompt}`,
        regionLinkSystemContent(),
        harmonyAddendum,
        expandedNamespacesSystemContent(input.allowedScriptApi, expandedNamespaces),
        transportDamageAddendum,
        // Volatile (this turn only) — kept next to the live snapshot so the stable prefix above
        // it stays cacheable.
        forceFenceTransport && scriptingToolable
            ? "Tool calling is disabled for this turn. Return exactly ONE ```xopat-script fenced block containing the code to run, and keep it short."
            : null,
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

    llm.sensitive("SEND_TURN_CONTEXT", {
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
    });

    llm.sensitive("MODEL_INPUT", {
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

    // Streaming attempt state. Emission is held until the first token, so
    // pre-token errors (incl. context-window overflows) descend the retry
    // ladder invisibly — exactly like the buffered path.
    let streamingActive = !!emit && (modelCaps.capabilities as any)?.streaming !== 'unsupported';
    let lastStreamedText = '';

    const cacheStreamingVerdict = async (verdict: 'supported' | 'unsupported') => {
        if ((modelCaps.capabilities as any)?.streaming === verdict) return;
        try {
            await registry.setModelCapabilities(session.providerId, session.modelId, {
                ...(modelCaps.capabilities || {}),
                streaming: verdict,
            } as any, safeUserScope(ctx));
            (modelCaps.capabilities as any).streaming = verdict;
        } catch (_) { /* verdict cache is best-effort */ }
    };

    const runStreamedAttempt = async (messages: any[], attemptSignal: AbortSignal) => {
        const s: any = streamText({
            model,
            messages,
            maxOutputTokens: tuning.maxOutputTokens,
            abortSignal: attemptSignal,
            maxRetries: tuning.maxRetries,
            // Client-side tool: no execute, so the step ends at the tool-call, which
            // we transcribe into the xopat-script fence below. `toolChoice: 'auto'`
            // keeps plain answers (no viewer action) possible.
            ...(chatTools ? { tools: chatTools, toolChoice: 'auto' } : {}),
        } as any);
        let raw = '';
        let emittedAny = false;
        const pushDelta = async (text: string) => {
            if (!text) return;
            raw += text;
            emittedAny = true;
            lastStreamedText = raw;
            // Raw model output — untrusted; travels as JSON string data and is
            // rendered client-side via textContent only (preview), with the
            // final sanitized message replacing it at turn end.
            await emit!({ type: 'delta', text });
        };
        for await (const part of s.fullStream) {
            const type = part?.type;
            if (type === 'text-delta') {
                await pushDelta(String((part as any).text ?? (part as any).textDelta ?? ''));
            } else if (type === 'tool-call') {
                // The model called run_viewer_script. Transcribe it into the fenced
                // block the client already extracts + executes, and emit it as one
                // delta so the script appears the instant the call completes. (The
                // incremental tool-input deltas are raw argument JSON, not code, so we
                // reconstruct clean code from the completed call rather than stream them.)
                if ((part as any).toolName && (part as any).toolName !== VIEWER_SCRIPT_TOOL_NAME) continue;
                const toolCode = extractToolCallCode(part);
                llm.debug("tool call transcribed to script fence", { toolName: (part as any).toolName || VIEWER_SCRIPT_TOOL_NAME, codeChars: toolCode.length });
                await pushDelta(viewerScriptFenceFromCode(toolCode));
            } else if (type === 'error') {
                const cause = (part as any).error;
                if (!emittedAny) throw cause;
                // After partial emission a smaller history cannot help and a retry
                // would visibly rewind streamed text — terminal, never retried.
                throw new PartialEmissionError(cause, raw);
            }
        }
        let usage: any = null;
        try { usage = (await s.totalUsage) || (await s.usage) || null; } catch (_) { usage = null; }
        let finishReason: any = null;
        try { finishReason = await s.finishReason; } catch (_) { finishReason = null; }
        return { text: raw, finishReason, usage };
    };

    // Buffered (non-streaming) attempt. Folds a client-side run_viewer_script
    // tool-call into the same fenced-block representation the streaming path
    // produces, so everything downstream is method-agnostic.
    const runBufferedAttempt = async (messages: any[], attemptSignal: AbortSignal) => {
        const r: any = await generateText({
            model,
            messages,
            maxOutputTokens: tuning.maxOutputTokens,
            abortSignal: attemptSignal,
            maxRetries: tuning.maxRetries,
            ...(chatTools ? { tools: chatTools, toolChoice: 'auto' } : {}),
        });
        let text = typeof r?.text === 'string' ? r.text : '';
        const calls = Array.isArray(r?.toolCalls) ? r.toolCalls : [];
        const viewerCall = calls.find((c: any) => (c?.toolName ?? c?.name) === VIEWER_SCRIPT_TOOL_NAME) || calls[0];
        if (viewerCall) {
            const code = extractToolCallCode(viewerCall);
            llm.debug({ toolName: viewerCall?.toolName ?? viewerCall?.name ?? null, codeChars: code.length },
                'tool call transcribed to script fence (buffered)');
            if (code && !/```xopat-script/.test(text)) {
                text = `${text}${viewerScriptFenceFromCode(code)}`;
            }
        }
        // Return a plain result rather than the SDK's own object: `text` on it is a GETTER, so
        // assigning the transcribed fence back onto it throws and takes the whole turn down with
        // an internal error — i.e. every buffered tool-call turn used to fail.
        return { text, finishReason: r?.finishReason ?? null, usage: r?.totalUsage || r?.usage || null };
    };

    // A client disconnect after deltas were emitted (fence early-exit, stop
    // button, closed tab) persists the paid-for partial under the client-known
    // id and returns normally — the socket is gone, but both sides converge on
    // one record via id-dedup when the next turn re-sends the client's copy.
    const finalizeClientCutoff = async (): Promise<ChatTurnResult | null> => {
        if (!emit || !ctx?.signal?.aborted || !lastStreamedText.trim()) return null;
        const { text } = sanitizeAssistantOutput(lastStreamedText);
        const finalText = text.trim() ? text : lastStreamedText;
        const message: ChatMessage = {
            id: assistantMessageId || registry.newId('msg'),
            sessionId: session.id,
            role: 'assistant',
            content: finalText,
            parts: [{ type: 'text', text: finalText }],
            createdAt: new Date().toISOString(),
            metadata: { clientCutoff: true } as any,
        };
        await sessionStore.appendMessages(session.id, [message]);
        const autoTitle = await resolveAutoTitle(sessionStore, session);
        const updatedSession = autoTitle !== undefined
            ? await sessionStore.updateSession(session.id, { title: autoTitle })
            : (await sessionStore.getSession(session.id)) || session;
        llm.sensitive("TURN_CLIENT_CUTOFF", { sessionId: session.id, message });
        return {
            message,
            session: updatedSession,
            capabilities: modelCaps.capabilities,
            persistedDeltaCount: persistedDeltaCount || undefined,
        };
    };

    for (const count of retryCounts) {
        if (turnBudget.aborted) break;
        conversation = buildConversation(count);
        try {
            const attemptSignal = createTimeoutLinkedSignal(turnBudget, tuning.attemptTimeoutMs);
            lastStreamedText = '';
            // One attempt at the current rung, honoring the streaming verdict and the
            // (possibly stripped) tools set. Reused for the tools-unsupported retry.
            const attemptOnce = async () => {
                if (streamingActive) {
                    try {
                        const res = await runStreamedAttempt([...systemMessages, ...conversation], attemptSignal);
                        await cacheStreamingVerdict('supported');
                        return res;
                    } catch (streamError) {
                        if (!(streamError instanceof PartialEmissionError)
                            && !isAbortError(streamError)
                            && isStreamingUnsupportedError(streamError)) {
                            // Provider cannot stream this model — remember the verdict
                            // and serve the SAME rung buffered inside the streaming
                            // envelope (zero-delta stream; client copes by design).
                            await cacheStreamingVerdict('unsupported');
                            streamingActive = false;
                            return await runBufferedAttempt([...systemMessages, ...conversation], attemptSignal);
                        }
                        throw streamError;
                    }
                }
                return await runBufferedAttempt([...systemMessages, ...conversation], attemptSignal);
            };
            try {
                result = await attemptOnce();
            } catch (attemptError) {
                // A provider that rejects the `tools` param outright: drop tools and
                // retry the SAME rung fence-only (the fenced-block contract stays in
                // the prompt). Streamed partials are terminal and never re-run.
                if (chatTools
                    && !(attemptError instanceof PartialEmissionError)
                    && !isAbortError(attemptError)
                    && isToolsUnsupportedError(attemptError)) {
                    await cacheToolsVerdict('unsupported');
                    chatTools = undefined;
                    toolsActive = false;
                    result = await attemptOnce();
                } else {
                    throw attemptError;
                }
            }
            if (toolsActive) await cacheToolsVerdict('supported');
            {
                const u: any = (result as any)?.usage || (result as any)?.totalUsage || null;
                llm.debug({
                    conversationSize: count,
                    toolsActive,
                    textChars: typeof result?.text === 'string' ? result.text.length : 0,
                    inputTokens: u?.inputTokens,
                    outputTokens: u?.outputTokens,
                    totalTokens: u?.totalTokens,
                }, 'model call succeeded');
            }
            llm.sensitive("MODEL_OUTPUT", {
                text: typeof result?.text === 'string' ? result.text : null,
                usage: (result as any)?.usage || (result as any)?.totalUsage || null,
                retryConversationSize: count,
            });
            usedConversationSize = count;
            lastContextError = null;
            break;
        } catch (error) {
            llm.warn({ retryConversationSize: count }, 'model call failed', error);
            // Upstream failed after streaming partial output: terminal — the
            // client shows the error and discards its preview.
            if (error instanceof PartialEmissionError) throw error;
            // A timeout or a cancelled turn is not a context-length problem, and a
            // smaller conversation will not fix an upstream that never answered.
            // Retrying here is what turned one dead endpoint into the full turn
            // timeout: report it now.
            if (isAbortError(error) || turnBudget.aborted) {
                const cutoff = await finalizeClientCutoff();
                if (cutoff) return cutoff;
                throw error;
            }
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
        // result — never fall through to reading `result.text` off null. A client
        // cutoff with partial streamed output still finalizes it.
        const cutoff = await finalizeClientCutoff();
        if (cutoff) return cutoff;
        throw (turnBudget.reason instanceof Error
            ? turnBudget.reason
            : new Error(`Chat turn aborted after ${tuning.turnBudgetMs}ms without a model response.`));
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
        // Client-proposed id when present (streaming convergence); the
        // server-authored error-guidance messages above deliberately keep
        // server-minted ids.
        id: assistantMessageId || registry.newId('msg'),
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
    // Same stickiness for the client's transport verdict, so the advisory and the fence surface
    // survive a reload. Spread whatever the patch already holds — `updateSession` replaces the
    // metadata object wholesale, so a second assignment here would drop the flag above.
    if (reportedDamage && session.metadata?.transportDamage !== reportedDamage) {
        sessionPatch.metadata = {
            ...(sessionPatch.metadata || session.metadata || {}),
            transportDamage: reportedDamage,
        };
    }
    const updatedSession = Object.keys(sessionPatch).length
        ? await sessionStore.updateSession(session.id, sessionPatch)
        : (await sessionStore.getSession(session.id)) || session;

    const usage = (result as any).usage || (result as any).totalUsage;
    turnTimer({
        sessionId: session.id,
        modelId: session.modelId,
        textChars: typeof message?.content === 'string' ? message.content.length : 0,
        emittedToolEnvelope,
        persistedDeltaCount,
        totalTokens: usage?.totalTokens,
    });
    llm.sensitive("TURN_RESULT", {
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
