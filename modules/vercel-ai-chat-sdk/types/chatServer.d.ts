type CapabilityState = 'supported' | 'unsupported' | 'unknown';

type ModelCapabilities = {
    text: CapabilityState;
    images: CapabilityState;
    files: CapabilityState;
    /** Token-streaming verdict, learned lazily from the first streamed attempt (never probed up front). */
    streaming?: CapabilityState;
    /** 'observed' = learned from a real turn (a model that accepted or rejected the media). 'probe' is legacy. */
    source: 'probe' | 'provider-metadata' | 'manual' | 'default' | 'observed';
    checkedAt?: string;
};

type ChatProviderModelInfo = {
    id: string;
    label?: string;
    description?: string;
    multimodal?: boolean;
    supportsImages?: boolean;
    supportsFiles?: boolean;
    supportsToolCalls?: boolean;
    capabilities?: ModelCapabilities;
};

type ProviderModelListResult = {
    providerId?: string;
    providerTypeId?: string;
    models: ChatProviderModelInfo[];
    /** Empty catalogue because a required credential is missing; no upstream call was made. */
    needsKey?: boolean;
    missingSecretKeys?: string[];
};

type EnsureModelCapabilitiesInput = {
    providerId: string;
    modelId: string;
    contextId?: string | null;
};

type EnsureModelCapabilitiesResult = {
    providerId: string;
    modelId: string;
    capabilities: ModelCapabilities;
};

type SendTurnResult = {
    session: ChatSession;
    message: ChatMessage;
    capabilities?: ModelCapabilities;
};