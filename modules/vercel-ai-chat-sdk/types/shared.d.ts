type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

type CapabilityState = 'supported' | 'unsupported' | 'unknown';

type ModelCapabilities = {
    text: CapabilityState;
    images: CapabilityState;
    files: CapabilityState;
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
     * Free-form metadata. Reserved key: `hidden: true` marks the type as
     * INTERNAL — it is registered and resolvable server-side (e.g. by
     * runVisionInference) but excluded from the client `listProviderTypes` RPC,
     * so it is never offered in the "add provider" UI. Use for models a plugin
     * drives internally rather than exposing as a chat agent.
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
     * Free-form metadata. Reserved key: `hidden: true` marks the instance as
     * INTERNAL — resolvable by id via getProviderRuntime (so runVisionInference /
     * the pathology analyze driver keep working) but excluded from the client
     * `listProviders` RPC that populates the chat provider picker. Managed-provider
     * dedup still sees it, so it is not re-created on each boot.
     */
    metadata?: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
    hasSecretOverrides?: boolean;
    hasSecretDefaults?: boolean;
    secretKeys?: string[];
}

type ChatProviderClientRegistration = ChatProviderInstanceRecord;

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
    contextId: string;
    /** Explicit operator-set slide name, or the contextId. Never a filename/path (identifying). */
    imageName: string;
    isActive: boolean;
    background?: string | null;
    zoom?: number | null;
    magnification?: number | null;
    /** Focal-plane (z-stack) state; null for single-plane slides. */
    zStack?: LiveViewerContextZStack | null;
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

interface SendTurnInput {
    sessionId: string;
    allowedScriptApi?: AllowedScriptApiManifest;
    personalityId?: string | null;
    personalityPrompt?: string | null;
    executionMode?: 'host' | 'viewer-script' | 'plain';
    maxRecentMessages?: number;
    maxInputMessages?: number;
    liveViewerContext?: LiveViewerContext;
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
