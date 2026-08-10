type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

type CapabilityState = 'supported' | 'unsupported' | 'unknown';

type ModelCapabilities = {
    text: CapabilityState;
    images: CapabilityState;
    files: CapabilityState;
    /** Token-streaming verdict, learned lazily from the first streamed attempt (never probed up front). */
    streaming?: CapabilityState;
    source: 'probe' | 'provider-metadata' | 'manual' | 'default';
    checkedAt?: string;
};

interface ChatPersonality {
    id: string;
    label: string;
    description?: string;
    systemPrompt: string;
}

interface ScriptMethodManifest {
    name: string;
    description?: string;
    params: Array<{ name: string; type: string }>;
    returns: string;
    tsSignature?: string;
    tsDeclaration?: string;
}

interface ScriptNamespaceManifest {
    namespace: string;
    methods: ScriptMethodManifest[];
    tsDeclaration?: string;
    description?: string;
    /** Namespace exposes identifying / patient-sensitive data — never auto-expanded by intent hints. */
    sensitive?: boolean;
}

interface AllowedScriptApiManifest {
    namespaces: ScriptNamespaceManifest[];
}

type ChatAttachmentKind = 'image' | 'file' | 'screenshot';

interface ChatAttachmentRecord {
    id: string;
    sessionId: string;
    kind: ChatAttachmentKind;
    name?: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl?: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
}

type ChatMessagePart =
    | { type: 'text'; text: string }
    | {
    type: 'image';
    attachmentId: string;
    mimeType: string;
    name?: string;
    url?: string;
    dataUrl?: string;
    metadata?: Record<string, unknown>;
}
    | {
    type: 'file';
    attachmentId: string;
    mimeType: string;
    name: string;
    url?: string;
    dataUrl?: string;
    metadata?: Record<string, unknown>;
}
    | {
    type: 'host-feedback';
    text: string;
    metadata?: Record<string, unknown>;
}
    | {
    /**
     * Host-injected capability announcement (e.g. a scripting namespace became
     * available mid-session). Rides on the user message so no extra system turn
     * is needed, but is NOT user-authored: hidden in user-friendly display mode.
     */
    type: 'capability-notice';
    text: string;
    metadata?: Record<string, unknown>;
}
    | {
    type: 'script-result';
    ok: boolean;
    script?: string;
    text: string;
    metadata?: Record<string, unknown>;
};

interface ChatMessage {
    id?: string;
    sessionId?: string;
    role: ChatRole;
    parts?: ChatMessagePart[];
    content?: string;
    createdAt?: Date | string | undefined;
    metadata?: Record<string, unknown>;
}

interface ChatProviderModelInfo {
    id: string;
    label?: string;
    description?: string;
    multimodal?: boolean;
    supportsFiles?: boolean;
    supportsImages?: boolean;
    supportsToolCalls?: boolean;
    capabilities?: ModelCapabilities;
}

type ChatProviderFieldInput = 'text' | 'password' | 'url' | 'textarea' | 'number' | 'boolean' | 'select';

interface ChatProviderFieldOption {
    value: string;
    label: string;
    description?: string;
}

interface ChatProviderConfigField {
    key: string;
    label: string;
    input: ChatProviderFieldInput;
    description?: string;
    placeholder?: string;
    required?: boolean;
    secret?: boolean;
    defaultValue?: unknown;
    options?: ChatProviderFieldOption[];
}

interface ChatProviderTypeRecord {
    id: string;
    label: string;
    description?: string;
    icon?: string;
    adapter: string;
    supportsUploads?: boolean;
    supportsFiles?: boolean;
    supportsImages?: boolean;
    supportsToolCalls?: boolean;
    defaultModelId?: string;
    requiresLogin?: boolean;
    contextId?: string | null;
    authType?: string | null;
    configSchema: ChatProviderConfigField[];
    fixedConfig?: Record<string, unknown>;
    fixedSecrets?: Record<string, unknown>;
    /**
     * Free-form metadata. Reserved keys:
     * - `hidden: true` marks the type as INTERNAL — registered and resolvable
     *   server-side (e.g. by runVisionInference) but excluded from the client
     *   `listProviderTypes` RPC, so it is never offered in the "add provider" UI.
     *   Use for models a plugin drives internally rather than as a chat agent.
     * - `contexts: string[]` restricts contextual availability to a named
     *   allow-list of auth/deployment contexts (SECURE-CONFIG ONLY). Absent/empty
     *   ⇒ unrestricted. Enforced at resolve time in getProviderRuntime and
     *   mirrored as a picker filter in `listProviderTypes`/`listProviders`. Each
     *   listed context MUST have a configured `server.secure.rpcVerifiers.<ctx>`
     *   entry, else the gate degrades closed and refuses to resolve.
     */
    metadata?: Record<string, unknown>;
    source?: 'builtin' | 'plugin' | 'user';
    createdAt?: string;
    updatedAt?: string;
}

type ChatProviderTypeClientRecord = Omit<ChatProviderTypeRecord, 'fixedSecrets'>;

interface CreateProviderTypeInput extends Omit<ChatProviderTypeRecord, 'createdAt' | 'updatedAt'> {}
interface UpdateProviderTypeInput extends Partial<Omit<ChatProviderTypeRecord, 'id' | 'createdAt' | 'updatedAt'>> {
    id: string;
}

interface ChatProviderInstanceRecord {
    id: string;
    typeId: string;
    label: string;
    description?: string;
    icon?: string;
    defaultModelId?: string | null;
    requiresLogin?: boolean;
    contextId?: string | null;
    authType?: string | null;
    supportsUploads?: boolean;
    supportsFiles?: boolean;
    supportsImages?: boolean;
    supportsToolCalls?: boolean;
    config: Record<string, unknown>;
    /**
     * Free-form metadata. Reserved keys:
     * - `hidden: true` marks the instance as INTERNAL — resolvable by id via
     *   getProviderRuntime (so runVisionInference / the pathology analyze driver
     *   keep working) but excluded from the client `listProviders` RPC that
     *   populates the chat provider picker. Managed-provider dedup still sees it,
     *   so it is not re-created on each boot.
     * - `contexts: string[]` restricts contextual availability to a named
     *   allow-list of verifier-backed contexts (SECURE-CONFIG ONLY). The runtime
     *   gate in getProviderRuntime reads this instance-level list first (falling
     *   back to the type's). Absent/empty ⇒ unrestricted.
     * - `managedByPlugin: string`, `managedKey: string`, `autoCreated: true`,
     *   `role: "default-provider"` are stamped by the managed-registration path
     *   (server/providerRegistration.server.ts). `managedKey` and
     *   `managedByPlugin` are the STABLE identity static config references,
     *   since `id` is re-minted on every server start (shared/providerRef.ts).
     *   Beware: these are stamped by the server only on the operator's own
     *   registration path — `createProviderInstance` spreads caller metadata, so
     *   a USER-created instance can carry forged copies of all four. Never treat
     *   them as proof of provenance; check `origin` below. That is exactly why
     *   reference resolution considers operator records only.
     */
    metadata?: Record<string, unknown>;
    /**
     * Trust tier, SERVER-ASSIGNED and never settable from RPC input.
     * - `"operator"` — registered through the server-internal path. Readable by
     *   everyone (this is what makes a service-provided key work), writable by no
     *   RPC. Only these instances receive the provider type's `fixedSecrets`.
     * - `"user"` — created by a caller; readable and writable only by that
     *   principal, and unusable until the user supplies their own key.
     *
     * Sharing used to be expressed as the *absence* of an owner, which meant one
     * bit carried two policies and the write policy defaulted open.
     */
    origin?: 'operator' | 'user';
    createdAt: string;
    updatedAt: string;
    hasSecretOverrides?: boolean;
    hasSecretDefaults?: boolean;
    secretKeys?: string[];
}

type ChatProviderClientRegistration = ChatProviderInstanceRecord;

/**
 * Per-caller BYOK secret status for one provider. Never carries secret
 * values — booleans and key names only. Returned by the
 * get/set/clearProviderUserSecrets RPCs.
 */
interface ProviderUserSecretsStatus {
    providerId: string;
    /** Caller has own stored secrets for this provider (in their user/session scope). */
    hasUserSecrets: boolean;
    /** Names of the caller's stored secret fields. */
    userSecretKeys: string[];
    /** Deployment/admin configured secrets exist (type fixedSecrets or instance overrides). */
    hasAdminSecrets: boolean;
    /** Secret field keys declared by the provider type's configSchema — BYOK-capable when non-empty. */
    secretSchemaKeys: string[];
    /** No admin key and no user key, but the schema declares secret fields. */
    needsKey: boolean;
}

interface SetProviderUserSecretsInput {
    providerId: string;
    /** Patch semantics: '' / null delete the stored field. */
    secrets: Record<string, string | null>;
}

interface CreateProviderInstanceInput {
    typeId: string;
    label: string;
    description?: string;
    icon?: string;
    defaultModelId?: string | null;
    contextId?: string | null;
    authType?: string | null;
    requiresLogin?: boolean;
    config?: Record<string, unknown>;
    secrets?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

interface UpdateProviderInstanceInput {
    id: string;
    label?: string;
    description?: string;
    icon?: string;
    defaultModelId?: string | null;
    contextId?: string | null;
    authType?: string | null;
    requiresLogin?: boolean;
    config?: Record<string, unknown>;
    secrets?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
}

interface ChatSession {
    id: string;
    title: string;
    providerId: string;
    providerTypeId?: string | null;
    modelId: string;
    personalityId: string | null;
    contextId: string | null; // provider/runtime context, not viewer context
    createdAt: string;
    updatedAt: string;
    summary: string;
    metadata?: Record<string, unknown> & { viewerContextId?: string | null };
}

interface ChatSessionHydration {
    session: ChatSession;
    messages: ChatMessage[];
    attachments: ChatAttachmentRecord[];
}

interface CreateSessionInput {
    providerId: string;
    modelId: string;
    title?: string;
    personalityId?: string | null;
    personalityPrompt?: string | null;
    contextId?: string | null; // provider/runtime context, not viewer context
    metadata?: Record<string, unknown> & { viewerContextId?: string | null };
}

/**
 * Snapshot of the live viewer state, composed client-side immediately before each
 * turn and rendered into the system prompt server-side. Lets the model answer
 * basic viewer-state questions (open slides, active viewer, zoom, capabilities)
 * without spending a script step on discovery, and defeats stale-viewer
 * hallucinations because it is recomputed on every send.
 */
interface LiveViewerContextZStack {
    /** Number of focal planes (always > 1 when present). */
    count: number;
    /** Currently displayed plane index (0-based). */
    index: number;
    /** Physical spacing between planes in micrometres, when known. */
    spacingUm?: number | null;
    labels?: string[] | null;
}

interface LiveViewerContextSlide {
    /**
     * Opaque per-session viewer handle ("viewer-1", …) under the default `anonymizeViewerContext`
     * posture, or the real viewer uniqueId when anonymization is off. Used verbatim as the
     * join key for tool calls (setActiveViewer / getGlobalInfo / viewer.* / annotations*).
     */
    contextId: string;
    /**
     * Explicit operator-set slide name, or the contextId. Never a filename/path (identifying).
     * Masked to the handle under the `full` anonymization posture and restored for the local user.
     */
    imageName: string;
    isActive: boolean;
    /** Viewer/background handle (or real background id when anonymization is off). */
    background?: string | null;
    zoom?: number | null;
    magnification?: number | null;
    /** Focal-plane (z-stack) state; null for single-plane slides. */
    zStack?: LiveViewerContextZStack | null;
    /** Compact marker that a cached pathology overview index exists for this slide. */
    pathologyOverview?: LiveViewerContextOverview | null;
}

/**
 * Compact per-slide marker that a hierarchical pathology overview was built (via
 * pathology.buildOverview) and is cached — a hint that the agent can answer broad
 * "regions with X" queries from pathology.getOverview() instead of re-sweeping.
 * Deliberately tiny: the full tree is fetched on demand, not carried every turn.
 */
interface LiveViewerContextOverview {
    /** Number of described regions across the tree. */
    regionsDescribed: number;
    /** Deepest recursion level reached. */
    depth: number;
    /** Whole-slide tissue coverage the overview reported (0..1). */
    slideCoverage: number;
    /** False when the underlying overview ran on partially-loaded tiles. */
    isComplete: boolean;
    /** True when a budget cap stopped the walk early (the map is partial). */
    truncated: boolean;
    /** ISO timestamp the overview was built (freshness). */
    builtAtIso: string;
    /**
     * The feature the overview hunted for, if any. Free-form assistant text, so it is
     * clamped to 512 characters on the wire (the cached overview keeps the full string).
     */
    query?: string | null;
    /** One-line gist of the highest-interest finding (tissue description only). */
    gist?: string | null;
    /**
     * True when the overview knew the slide's stain and/or specimen site. False means the
     * walk ran blind and its findings are structure-only — the agent should ask the user
     * for those before trusting it. Deliberately a BOOLEAN: the values themselves are
     * clinical payload and stay out of the every-turn live context.
     */
    contextKnown: boolean;
    /** Count of caveats on the overview (unparsed scores, unknown context, truncation). */
    warningCount?: number;
}

interface LiveViewerContextNamespace {
    name: string;
    granted: boolean;
}

interface LiveViewerContextDriver {
    id: string;
    label: string;
    local: boolean;
    features: string[];
}

interface LiveViewerContext {
    composedAt: string;
    activeViewerId: string | null;
    viewerCount: number;
    viewers: LiveViewerContextSlide[];
    loadedNamespaces: LiveViewerContextNamespace[];
    pathologyDrivers?: LiveViewerContextDriver[];
}

// Re-exported node/result types are defined in the pathology-foundation module; the
// chat SDK only carries the compact LiveViewerContextOverview marker above.

/**
 * Parsed payload of an in-chat region link (`[label](#xopat-region?viewer=..&x=..&y=..&w=..&h=..)`) —
 * the assistant's clickable "go there" affordance. Coordinates are level-0 image pixels
 * (parent-global for virtual-region splits), x/y the top-left corner. `viewer` carries the
 * model-facing contextId (an anonymization handle under the default posture) and is resolved
 * back to the real viewer uniqueId by the chat module before navigating.
 */
interface ChatRegionLinkPayload {
    viewer?: string | null;
    x: number;
    y: number;
    w?: number | null;
    h?: number | null;
    /** Focal-plane (z-stack) index to switch to before framing; only for z-stack slides. */
    z?: number | null;
}

interface SendTurnInput {
    sessionId: string;
    allowedScriptApi?: AllowedScriptApiManifest;
    personalityId?: string | null;
    personalityPrompt?: string | null;
    executionMode?: 'host' | 'viewer-script' | 'plain';
    maxRecentMessages?: number;
    maxInputMessages?: number;
    liveViewerContext?: LiveViewerContext;
    /**
     * Namespaces the model already discovered this session (used/described/hinted).
     * The server renders them with FULL signatures in a stable system block placed
     * before the volatile live-context block, and persists the merged set into the
     * session metadata. Sorted + monotonic client-side for prompt-cache stability;
     * server-side the list is bounded and intersected with `allowedScriptApi`.
     */
    expandedNamespaces?: string[];
    /**
     * Namespaces to render in FULL unconditionally (deployment knob, static meta
     * `fullPromptNamespaces`). Prompt-shaping only; server bounds it and intersects
     * with `allowedScriptApi`. Absent → the server's default core set.
     */
    fullPromptNamespaces?: string[];
    /**
     * Not-yet-synced messages folded into the turn request — replaces the separate
     * appendMessages RPC per assistant-loop step. Every message MUST carry a client
     * id: the store dedups by id, which is what makes a retried turn (whose earlier
     * attempt persisted the delta but failed later) idempotent.
     */
    messagesDelta?: ChatMessage[];
    /**
     * Client-proposed id for the assistant reply (`msg_<8-64 [A-Za-z0-9-]>`).
     * Streaming convergence anchor: on a client cutoff (fence early-exit, stop)
     * the server persists the partial under this id while the client synthesizes
     * the same message locally — the next turn's delta + store id-dedup converge
     * both sides on one record. Invalid values are ignored.
     */
    assistantMessageId?: string;
}

interface ChatTurnResult {
    message: ChatMessage;
    session: ChatSession;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
    capabilities?: ModelCapabilities;
    /** How many messagesDelta entries are persisted server-side (echoed so the client advances its sync cursor). */
    persistedDeltaCount?: number;
}

/**
 * How a turn ended. `rendered` says whether the user got a message out of it; a turn
 * that ends with nothing rendered and no stop behind it is a bug, not an outcome.
 */
interface ChatTurnOutcome {
    kind: "answered" | "stopped" | "error";
    /** Which exit fired — carried into the console, the diagnostic bubble and the turn event. */
    reason: string;
    rendered: boolean;
}

/** Where a turn came in from. Free-form so external drivers can label themselves. */
type ChatTurnSource = "user" | "voice" | "api" | (string & {});

/** Payload of the `turn-start` module event. */
interface ChatTurnStartPayload {
    sessionId: string | null;
    userText: string;
    source: ChatTurnSource;
}

/** Payload of the `turn-complete` module event — raised once per turn, on EVERY terminal path. */
interface ChatTurnCompletePayload extends ChatTurnStartPayload {
    outcome: ChatTurnOutcome;
    /** Snapshot of the client transcript at the moment the turn ended. */
    messages: ChatMessage[];
    /** Present when the turn ended by throwing rather than by a loop outcome. */
    error?: unknown;
}

/**
 * Payload of the `utterance-appended` module event — raised when a user
 * utterance is appended to the transcript WITHOUT running an assistant turn
 * (transcript-only mode / `appendTranscriptUtterance`). Real turns raise
 * `turn-start`/`turn-complete` instead; `messages-changed` fires for both.
 */
interface ChatUtteranceAppendedPayload {
    sessionId: string | null;
    text: string;
    source: ChatTurnSource;
    message: ChatMessage;
    /** False when the server-side persist failed and the message is session-local only. */
    persisted: boolean;
}

/** Payload of the `messages-changed` module event. */
interface ChatMessagesChangedPayload {
    sessionId: string | null;
    messages: ChatMessage[];
    /** What moved the transcript: a single append, a full hydration, or a reset. */
    change: "append" | "replace" | "clear";
    /** The appended message, for `change === "append"` only. */
    message?: ChatMessage;
}

/** Payload of the `session-changed` module event. */
interface ChatSessionChangedPayload {
    sessionId: string | null;
    session: ChatSession | null;
    reason: "created" | "loaded" | "cleared";
}

/** Payload of the `voice-segment` module event. */
interface ChatVoiceSegmentPayload {
    text: string;
    /** Turn index within the current continuous capture; `-1` for one-shot dictation. */
    index: number;
    /** Whether the segment passed the noise/language gates and will be submitted. */
    accepted: boolean;
    /**
     * "once" = one-shot dictation, "continuous" = hands-free segment,
     * "flush" = text salvaged from a shutdown path that could not append it to
     * the transcript (`accepted: false`, `index: -1`) — treat it as spoken
     * evidence that never became a chat message.
     */
    mode: "once" | "continuous" | "flush";
}

/** Payload of the `voice-transcribing` module event (segment transcription start/end). */
interface ChatVoiceTranscribingPayload {
    /** True when transcription begins; false when it ends (success or failure). */
    active: boolean;
}

/** Payload of the `voice-error` module event (transcription failed outright). */
interface ChatVoiceErrorPayload {
    message: string;
    /** True for a driver-configuration error that will keep failing until fixed. */
    permanent: boolean;
    code?: string;
}

/**
 * Payload of the `voice-state` module event. Fired on every voice on/off
 * transition (manual dictation start/stop, hands-free arm/disarm, and every
 * self-shutoff: inactivity, watchdog, session end, Send-flush) so an external
 * observer can track the shared capture instead of polling a one-time flag.
 */
interface ChatVoiceStatePayload {
    /** True while any capture (manual or hands-free) is running. */
    listening: boolean;
    /** True while hands-free (conversation) mode owns the microphone. */
    auto: boolean;
}

/**
 * A phase of the chat panel that makes the user wait. Every indicator (header progress bar,
 * status line, disabled controls, session picker) derives from the set of running phases —
 * see `ui/ChatBusy.ts`. Ordered by priority: the first running one supplies the status text.
 */
type ChatBusyKind =
    | "turn"
    | "session-load"
    | "session-create"
    | "login"
    | "attachment"
    | "models"
    | "sessions"
    | "provider"
    | "boot";

/** Payload of the `busy-changed` module event. Both fields are empty exactly when idle. */
interface ChatBusyChangedPayload {
    /** Distinct running phases, highest priority first. */
    kinds: ChatBusyKind[];
    /** The phase whose text the status line is showing. */
    primary: ChatBusyKind | null;
}

interface SessionListResult {
    sessions: ChatSession[];
}

interface ProviderTypeListResult {
    providerTypes: ChatProviderTypeClientRecord[];
}

interface ProviderListResult {
    providers: ChatProviderClientRegistration[];
}

interface ProviderModelListResult {
    providerId?: string;
    providerTypeId?: string;
    models: ChatProviderModelInfo[];
}

type ScriptNamespaceConsentState = Record<string, { title: string; granted: boolean; description?: string; sensitive?: boolean }>;

/**
 * Chat scripting-access posture: grant every non-sensitive namespace (default), grant everything
 * including the patient namespace, or curate per-namespace grants explicitly.
 */
type ScriptConsentMode = 'all-but-sensitive' | 'all' | 'custom';

type ChatConfigShape = {
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string;
};
