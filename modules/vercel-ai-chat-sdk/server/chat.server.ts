import { generateText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ChatServerRegistry, type ChatProviderAdapter } from './chatRegistry.server';
import type {
  AllowedScriptApiManifest,
  ChatAttachmentRecord,
  ChatMessage,
  ChatPersonality,
  ChatProviderModelInfo,
  ChatProviderTypeClientRecord,
  ChatProviderTypeRecord,
  ChatSession,
  ChatTurnResult,
  CreateProviderInstanceInput,
  CreateProviderTypeInput,
  CreateSessionInput,
  ProviderListResult,
  ProviderModelListResult,
  ProviderTypeListResult,
  SendTurnInput,
  SessionListResult,
  UpdateProviderInstanceInput,
  UpdateProviderTypeInput,
} from './chat-shared';

export const policy = {
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
      timeoutMs: 60_000,
      maxBodyBytes: 512 * 1024,
      maxConcurrency: 5,
      queueLimit: 25,
      circuitBreaker: { key: 'chat-upstream', failureThreshold: 5, resetAfterMs: 30_000 },
    },
  },
} as const;

function getRegistry() {
  return ChatServerRegistry.instance();
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function defaultPersonality(): ChatPersonality {
  return {
    id: 'default',
    label: 'Default',
    systemPrompt:
      'Be helpful and accurate. Use the scripting API when it is available and useful. ' +
      'When it is not available or insufficient, explain the limitation clearly.',
  };
}

function ensureDefaultPersonality() {
  const registry = getRegistry();
  if (!registry.getPersonality('default')) {
    registry.registerPersonality(defaultPersonality());
  }
}

function buildOpenAICompatibleHeaders(config: Record<string, unknown>, secrets: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = typeof secrets.apiKey === 'string' && secrets.apiKey ? String(secrets.apiKey) : '';
  const headerName = typeof config.apiKeyHeader === 'string' && config.apiKeyHeader ? String(config.apiKeyHeader) : 'Authorization';
  if (apiKey) {
    headers[headerName] = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
  }
  const headersJson = typeof config.headersJson === 'string' ? config.headersJson.trim() : '';
  if (headersJson) {
    try {
      const extra = JSON.parse(headersJson);
      if (extra && typeof extra === 'object') {
        for (const [key, value] of Object.entries(extra)) {
          if (value != null) headers[key] = String(value);
        }
      }
    } catch (_error) {
      throw new Error('Invalid headersJson. Expected a JSON object.');
    }
  }
  return headers;
}

function ensureBuiltinAdapters() {
  const registry = getRegistry();

  if (!registry.getAdapter('openai-compatible')) {
    const adapter: ChatProviderAdapter = {
      id: 'openai-compatible',
      async listModels({ ctx, config, secrets, type }) {
        const baseURL = String(config.baseUrl || config.baseURL || '').trim();
        if (!baseURL) return [];
        const modelsPath = String(config.modelsPath || '/models');
        const url = new URL(modelsPath, ensureSlash(baseURL)).toString();
        const headers = buildOpenAICompatibleHeaders(config, secrets);
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: ctx?.signal,
        });
        if (!res.ok) throw new Error(`Model discovery failed: ${res.status} ${res.statusText}`);
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        return data.map((item: any): ChatProviderModelInfo => ({
          id: String(item.id),
          label: item?.name || String(item.id),
          description: item?.description || undefined,
          multimodal: true,
          supportsFiles: type.supportsFiles,
          supportsImages: type.supportsImages,
          supportsToolCalls: type.supportsToolCalls,
        }));
      },
      resolveModel({ instance, modelId, config, secrets }) {
        const baseURL = String(config.baseUrl || config.baseURL || '').trim();
        if (!baseURL) throw new Error(`Provider '${instance.label}' is missing baseUrl.`);
        const apiKey = typeof secrets.apiKey === 'string' && secrets.apiKey ? String(secrets.apiKey) : undefined;
        const headers = buildOpenAICompatibleHeaders(config, secrets);
        const provider = createOpenAICompatible({
          name: instance.id,
          baseURL,
          apiKey,
          headers,
        });
        return provider(modelId);
      },
    };
    registry.registerAdapter(adapter);
  }

  if (!registry.getProviderType('openai-compatible')) {
    registry.upsertProviderType({
      id: 'openai-compatible',
      label: 'OpenAI-compatible',
      description: 'Generic OpenAI-compatible endpoint. Plugin defaults may provide a visible default URL and hidden default token. Users may override both; secret values stay server-side.',
      adapter: 'openai-compatible',
      supportsUploads: true,
      supportsFiles: true,
      supportsImages: true,
      supportsToolCalls: false,
      configSchema: [
        { key: 'baseUrl', label: 'Base URL', input: 'url', required: true, placeholder: 'https://example.invalid/v1', description: 'OpenAI-compatible base URL, usually ending with /v1.' },
        { key: 'modelsPath', label: 'Models path', input: 'text', defaultValue: '/models', description: 'Relative or absolute path for model discovery.' },
        { key: 'apiKey', label: 'API key', input: 'password', secret: true, description: 'Optional static API key. Hidden in the UI after save and stored server-side only.' },
        { key: 'apiKeyHeader', label: 'API key header', input: 'text', defaultValue: 'Authorization' },
        { key: 'headersJson', label: 'Extra headers JSON', input: 'textarea', description: 'Optional JSON object with additional non-secret headers.' },
      ],
      source: 'builtin',
    });
  }
}

function scriptSystemContent(allowedScriptApi?: AllowedScriptApiManifest): string {
  if (!allowedScriptApi?.namespaces?.length) {
    return [
      'Scripting API access is currently disabled.',
      'Do not produce executable viewer scripts.',
      'Do not call scripting namespaces.',
      'If the user asks for automation, explain that scripting access is not currently granted.',
    ].join('\n');
  }

  const namespacesText = allowedScriptApi.namespaces.map((ns) => {
    const methods = ns.methods.map((method) => {
      const args = (method.params || []).map((p) => `${p.name}: ${p.type}`).join(', ');
      const signature = method.tsSignature || `${method.name}(${args}) => ${method.returns || 'void'}`;
      const description = method.description ? ` — ${method.description}` : '';
      const declaration = method.tsDeclaration ? `\n    TS: ${method.tsDeclaration}` : '';
      return `  - ${signature}${description}${declaration}`;
    }).join('\n');
    const namespaceDescription = ns.description ? ` — ${ns.description}` : '';
    const namespaceDeclaration = ns.tsDeclaration ? `\n  Namespace TS:\n  ${ns.tsDeclaration}` : '';
    return `- namespace ${ns.namespace}${namespaceDescription}${namespaceDeclaration}\n${methods}`;
  }).join('\n\n');

  return [
    'Viewer scripting is available.',
    '',
    'You may generate executable scripts only using the namespaces and methods listed below.',
    'Never invent namespaces or methods.',
    'When scripting is appropriate, return exactly one fenced code block with language tag xopat-script.',
    'This code is automatically executed by the viewer automatically, the user never runs your script manually unless they tell you so.',
    'You can use the API to read data and continue processing automatically without user interaction.',
    'The script is plain javascript with predefined methods - xopat scripting API.',
    'It runs inside web workers (e.g. no DOM). All scripting API calls are asynchronous in the worker.',
    'Use await when calling. Provided documentation might use typescript types, which should help you to verify your code syntactically, but do NOT use typescript in your scripts.',
    'Do not wrap explanations inside the code block. Use only the allowed API.',
    '',
    'Allowed scripting API:',
    namespacesText,
  ].join('\n');
}

function sessionPreamble(providerId: string, allowedScriptApi?: AllowedScriptApiManifest): string {
  const scriptNamespaces = allowedScriptApi?.namespaces?.map((n) => n.namespace).join(', ') || 'none';
  return [
    "You are an assistant integrated into a pathology slide viewer's Chat tab.",
    'Behave as a helpful, professional assistant for this application.',
    'Your users include pathologists, clinicians, students and researchers including IT specialists.',
    '',
    'Integration notes:',
    '- You only know what the user explicitly writes in chat unless additional capabilities are granted through the scripting API.',
    '- You may receive access to a scripting API. Only use explicitly allowed namespaces.',
    '- You MUST NOT guess on facts. If information is missing, ask clarifying questions.',
    '',
    'Current session:',
    `- Provider: ${providerId}`,
    `- Allowed scripting namespaces: ${scriptNamespaces}`,
    '',
    'When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).',
  ].join('\n');
}

function summarizeForTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const text = coerceMessageText(firstUser || null).trim();
  if (!text) return 'New chat';
  return text.slice(0, 80);
}

function coerceMessageText(message: ChatMessage | null | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string' && message.content.trim()) return message.content;
  const parts = message.parts || [];
  return parts.map((part) => {
    switch (part.type) {
      case 'text': return part.text;
      case 'host-feedback': return part.text;
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

function toModelMessage(message: ChatMessage) {
  const role = message.role === 'tool' ? 'assistant' : message.role;
  const parts = message.parts || (message.content ? [{ type: 'text', text: message.content }] : []);

  const content = parts.map((part) => {
    switch (part.type) {
      case 'text':
      case 'host-feedback':
        return { type: 'text', text: part.text } as const;
      case 'script-result':
        return { type: 'text', text: part.text } as const;
      case 'image':
        return { type: 'image', image: part.dataUrl || part.url || '' } as const;
      case 'file':
        return {
          type: 'file',
          mediaType: part.mimeType,
          data: part.dataUrl || part.url || '',
          filename: part.name,
        } as const;
      default:
        return { type: 'text', text: '' } as const;
    }
  });

  return { role, content } as any;
}

function sanitizeClientProviderTypeInput(input: CreateProviderTypeInput | UpdateProviderTypeInput): CreateProviderTypeInput | UpdateProviderTypeInput {
  const cloned: any = { ...input };
  delete cloned.fixedSecrets;
  return cloned;
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
  return { providerTypes: getRegistry().listProviderTypes() };
}

export async function createProvider(ctx: any, input: CreateProviderInstanceInput): Promise<any> {
  ensureBuiltinAdapters();
  return getRegistry().createProviderInstance(input, ctx?.user?.id ?? null);
}

export async function listProviders(ctx: any, input?: { typeId?: string | null }): Promise<ProviderListResult> {
  ensureBuiltinAdapters();
  const providers = await getRegistry().listProviderInstances({ userId: ctx?.user?.id ?? null, typeId: input?.typeId || null });
  return { providers };
}

export async function getProvider(ctx: any, input: { providerId: string }): Promise<any> {
  ensureBuiltinAdapters();
  const provider = await getRegistry().getProviderInstance(input.providerId);
  if (!provider) throw new Error(`Unknown provider '${input.providerId}'.`);
  const owner = provider.metadata?.ownerUserId ?? null;
  if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
  return provider;
}

export async function updateProvider(ctx: any, input: UpdateProviderInstanceInput): Promise<any> {
  ensureBuiltinAdapters();
  const current = await getRegistry().getProviderInstance(input.id);
  if (!current) throw new Error(`Unknown provider '${input.id}'.`);
  const owner = current.metadata?.ownerUserId ?? null;
  if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
  return getRegistry().updateProviderInstance(input.id, input);
}

export async function deleteProvider(ctx: any, input: { providerId: string }): Promise<{ ok: true }> {
  ensureBuiltinAdapters();
  const current = await getRegistry().getProviderInstance(input.providerId);
  if (!current) throw new Error(`Unknown provider '${input.providerId}'.`);
  const owner = current.metadata?.ownerUserId ?? null;
  if (owner && ctx?.user?.id && owner !== ctx.user.id) throw new Error('Provider does not belong to current user.');
  await getRegistry().deleteProviderInstance(input.providerId);
  return { ok: true };
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
    const models = await getRegistry().listModels(input.providerId, { ctx, contextId: input.contextId || null });
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
  ensureDefaultPersonality();
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

export async function getSession(_ctx: any, input: { sessionId: string; hydrateMessages?: boolean }): Promise<{ session: ChatSession; messages?: ChatMessage[]; attachments?: ChatAttachmentRecord[] }> {
  const hydrated = await getRegistry().hydrateSession(input.sessionId);
  return input.hydrateMessages === false ? { session: hydrated.session } : hydrated;
}

export async function renameSession(_ctx: any, input: { sessionId: string; title: string }): Promise<ChatSession> {
  return getRegistry().getSessionStore().updateSession(input.sessionId, { title: input.title });
}

export async function deleteSession(_ctx: any, input: { sessionId: string }): Promise<{ ok: true }> {
  await getRegistry().getSessionStore().deleteSession(input.sessionId);
  return { ok: true };
}

export async function uploadAttachment(_ctx: any, input: {
  sessionId: string;
  kind?: 'image' | 'file' | 'screenshot';
  name?: string;
  mimeType: string;
  dataBase64: string;
  metadata?: Record<string, unknown>;
}): Promise<ChatAttachmentRecord> {
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

export async function appendMessages(_ctx: any, input: { sessionId: string; messages: ChatMessage[] }): Promise<{ messages: ChatMessage[] }> {
  const messages = input.messages.map(normalizeIncomingMessage);
  const appended = await getRegistry().getSessionStore().appendMessages(input.sessionId, messages);
  const all = await getRegistry().getSessionStore().listMessages(input.sessionId);
  const title = summarizeForTitle(all);
  await getRegistry().getSessionStore().updateSession(input.sessionId, { title });
  return { messages: appended };
}

export async function sendTurn(ctx: any, input: SendTurnInput): Promise<ChatTurnResult> {
  ensureBuiltinAdapters();
  ensureDefaultPersonality();

  const registry = getRegistry();
  const sessionStore = registry.getSessionStore();
  const hydrated = await registry.hydrateSession(input.sessionId);
  const session = hydrated.session;
  const runtime = await registry.getProviderRuntime(session.providerId);
  const adapter = registry.getAdapter(runtime.type.adapter);
  if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);

  const personality = (input.personalityId ? registry.getPersonality(input.personalityId) : registry.getPersonality(session.personalityId)) || defaultPersonality();
  const maxRecentMessages = Math.max(1, Math.min(50, Number(input.maxRecentMessages || 14)));
  const recentMessages = hydrated.messages.slice(-maxRecentMessages);

  const systemMessages = [
    { role: 'system', content: sessionPreamble(runtime.instance.label, input.allowedScriptApi) },
    { role: 'system', content: `Active personality: ${personality.label}\n\n${input.personalityPrompt || personality.systemPrompt}` },
    { role: 'system', content: scriptSystemContent(input.allowedScriptApi) },
  ].map(toModelMessage);

  const conversation = recentMessages.map(toModelMessage);
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

  const result = await generateText({
    model,
    messages: [...systemMessages, ...conversation],
  });

  const text = typeof result.text === 'string' ? result.text : '';
  const message: ChatMessage = {
    id: registry.newId('msg'),
    sessionId: session.id,
    role: 'assistant',
    content: text,
    parts: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  };

  await sessionStore.appendMessages(session.id, [message]);
  const title = summarizeForTitle(await sessionStore.listMessages(session.id));
  const updatedSession = await sessionStore.updateSession(session.id, { title });

  const usage = (result as any).usage || (result as any).totalUsage;
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
  };
}
