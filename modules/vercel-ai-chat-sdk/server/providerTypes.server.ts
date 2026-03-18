export function buildOpenAICompatibleProviderType(input: Partial<Omit<ChatProviderTypeRecord, 'id' | 'label' | 'adapter' | 'configSchema'>> & {
  id: string;
  label: string;
  description?: string;
  defaultModelId?: string;
  fixedConfig?: Record<string, unknown>;
  fixedSecrets?: Record<string, unknown>;
}): ChatProviderTypeRecord {
  return {
    id: input.id,
    label: input.label,
    description: input.description || 'OpenAI-compatible provider type.',
    icon: input.icon,
    adapter: 'openai-compatible',
    supportsUploads: input.supportsUploads ?? true,
    supportsFiles: input.supportsFiles ?? false,
    supportsImages: input.supportsImages ?? false,
    supportsToolCalls: input.supportsToolCalls ?? false,
    defaultModelId: input.defaultModelId,
    requiresLogin: input.requiresLogin,
    contextId: input.contextId ?? null,
    authType: input.authType ?? null,
    fixedConfig: input.fixedConfig,
    fixedSecrets: input.fixedSecrets,
    metadata: input.metadata,
    source: input.source || 'plugin',
    configSchema: [
      { key: 'baseUrl', label: 'Base URL', input: 'url', required: true, placeholder: 'https://example.invalid/v1' },
      { key: 'modelsPath', label: 'Models path', input: 'text', defaultValue: '/models' },
      { key: 'apiKey', label: 'API key', input: 'password', secret: true, description: 'Stored server-side only. Leave blank to keep plugin default token.' },
      { key: 'apiKeyHeader', label: 'API key header', input: 'text', defaultValue: 'Authorization' },
      { key: 'headersJson', label: 'Extra headers JSON', input: 'textarea' },
    ],
  };
}

export const ProviderTypesServer = {
  openAICompatible: buildOpenAICompatibleProviderType,
};
