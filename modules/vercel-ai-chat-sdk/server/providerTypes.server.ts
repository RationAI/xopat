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

export function buildAnthropicProviderType(input: Partial<Omit<ChatProviderTypeRecord, 'id' | 'label' | 'adapter' | 'configSchema'>> & {
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
    description: input.description || 'Anthropic Claude provider type.',
    icon: input.icon,
    adapter: 'anthropic',
    supportsUploads: input.supportsUploads ?? true,
    supportsFiles: input.supportsFiles ?? false,
    supportsImages: input.supportsImages ?? true,
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
      { key: 'baseUrl', label: 'Base URL', input: 'url', defaultValue: 'https://api.anthropic.com/v1', description: 'Anthropic API base URL. Leave default for direct Claude API access.' },
      { key: 'apiKey', label: 'API key', input: 'password', secret: true, description: 'Stored server-side only. Leave blank to keep plugin default token.' },
      { key: 'anthropicVersion', label: 'Anthropic version', input: 'text', defaultValue: '2023-06-01', description: 'Sent as the anthropic-version header.' },
      { key: 'modelsPath', label: 'Models path', input: 'text', defaultValue: '/models', description: 'Relative or absolute path for Anthropic model discovery.' },
      { key: 'headersJson', label: 'Extra headers JSON', input: 'textarea', description: 'Optional JSON object with additional non-secret headers.' },
    ],
  };
}

export const ProviderTypesServer = {
  openAICompatible: buildOpenAICompatibleProviderType,
  anthropic: buildAnthropicProviderType,
};
