type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

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
  createdAt?: Date | string;
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
  contextId: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string;
  metadata?: Record<string, unknown>;
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
  contextId?: string | null;
  metadata?: Record<string, unknown>;
}

interface SendTurnInput {
  sessionId: string;
  allowedScriptApi?: AllowedScriptApiManifest;
  personalityId?: string | null;
  personalityPrompt?: string | null;
  maxRecentMessages?: number;
  maxInputMessages?: number;
}

interface ChatTurnResult {
  message: ChatMessage;
  session: ChatSession;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
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
