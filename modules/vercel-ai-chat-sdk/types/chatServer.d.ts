type CapabilityState = 'supported' | 'unsupported' | 'unknown';

type ModelCapabilities = {
    text: CapabilityState;
    images: CapabilityState;
    files: CapabilityState;
    source: 'probe' | 'provider-metadata' | 'manual' | 'default';
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