import type { LanguageModel } from 'ai';

export interface ServerProviderRuntimeContext {
  ctx: any;
  providerId: string;
  providerTypeId: string;
  modelId: string;
  contextId?: string | null;
}

export interface ChatProviderAdapterRuntimeArgs extends ServerProviderRuntimeContext {
  type: ChatProviderTypeRecord;
  instance: ChatProviderInstanceRecord;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
}

export interface ChatProviderAdapter {
  id: string;
  listModels?: (args: Omit<ChatProviderAdapterRuntimeArgs, 'modelId'> & { draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }) => Promise<ChatProviderModelInfo[]> | ChatProviderModelInfo[];
  resolveModel: (args: ChatProviderAdapterRuntimeArgs) => Promise<LanguageModel> | LanguageModel;
}

export interface ChatSessionStore {
  createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession>;
  updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession>;
  getSession(sessionId: string): Promise<ChatSession | null>;
  listSessions(args?: { providerId?: string; userId?: string | null }): Promise<ChatSession[]>;
  deleteSession(sessionId: string): Promise<void>;
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]>;
  listMessages(sessionId: string): Promise<ChatMessage[]>;
  uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord>;
  listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]>;
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeField(field: ChatProviderConfigField): ChatProviderConfigField {
  return {
    ...field,
    options: Array.isArray(field.options) ? field.options.map((opt) => ({ ...opt })) : undefined,
  };
}

function clone(value: Record<string, unknown> | undefined | null): Record<string, unknown> {
  return value ? { ...value } : {};
}

function normalizeSecretsPatch(current: Record<string, unknown>, patch?: Record<string, unknown>): Record<string, unknown> {
  if (!patch) return { ...current };
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || value === '') {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

class InMemoryChatSessionStore implements ChatSessionStore {
  sessions = new Map<string, ChatSession>();
  messages = new Map<string, ChatMessage[]>();
  attachments = new Map<string, ChatAttachmentRecord[]>();

  async createSession(input: Omit<ChatSession, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string }): Promise<ChatSession> {
    const now = new Date().toISOString();
    const session: ChatSession = {
      ...input,
      createdAt: now,
      updatedAt: now,
      summary: input.summary || '',
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    this.attachments.set(session.id, []);
    return session;
  }

  async updateSession(sessionId: string, patch: Partial<ChatSession>): Promise<ChatSession> {
    const current = this.sessions.get(sessionId);
    if (!current) throw new Error(`Unknown session '${sessionId}'.`);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(sessionId, next);
    return next;
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async listSessions(args?: { providerId?: string; userId?: string | null }): Promise<ChatSession[]> {
    let items = Array.from(this.sessions.values());
    if (args?.providerId) items = items.filter((s) => s.providerId === args.providerId);
    if (args?.userId) {
      items = items.filter((s) => {
        const owner = (s.metadata?.userId ?? null) as string | null;
        return owner === null || owner === args.userId;
      });
    }
    return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.messages.delete(sessionId);
    this.attachments.delete(sessionId);
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const existing = this.messages.get(sessionId) || [];
    const normalized = messages.map((m) => ({
      ...m,
      id: m.id || uid('msg'),
      sessionId,
      createdAt: typeof m.createdAt === 'string' || m.createdAt instanceof Date ? m.createdAt : new Date().toISOString(),
    }));
    existing.push(...normalized);
    this.messages.set(sessionId, existing);
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, updatedAt: new Date().toISOString() });
    }
    return normalized;
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    return [...(this.messages.get(sessionId) || [])];
  }

  async uploadAttachment(record: ChatAttachmentRecord): Promise<ChatAttachmentRecord> {
    const existing = this.attachments.get(record.sessionId) || [];
    existing.push(record);
    this.attachments.set(record.sessionId, existing);
    const session = this.sessions.get(record.sessionId);
    if (session) {
      this.sessions.set(record.sessionId, { ...session, updatedAt: new Date().toISOString() });
    }
    return record;
  }

  async listAttachments(sessionId: string): Promise<ChatAttachmentRecord[]> {
    return [...(this.attachments.get(sessionId) || [])];
  }
}

interface ProviderInstanceStored extends Omit<ChatProviderInstanceRecord, 'config' | 'hasSecretOverrides' | 'hasSecretDefaults' | 'secretKeys'> {
  configOverrides: Record<string, unknown>;
}

class ChatServerRegistry {
  private static _instance: ChatServerRegistry | undefined;
  private providerTypes = new Map<string, ChatProviderTypeRecord>();
  private providerAdapters = new Map<string, ChatProviderAdapter>();
  private providerInstances = new Map<string, ProviderInstanceStored>();
  private providerSecrets = new Map<string, Record<string, unknown>>();
  private personalities = new Map<string, ChatPersonality>();
  private sessionStore: ChatSessionStore = new InMemoryChatSessionStore();

  static instance(): ChatServerRegistry {
    if (!this._instance) this._instance = new ChatServerRegistry();
    return this._instance;
  }

  registerAdapter(adapter: ChatProviderAdapter): void {
    if (!adapter?.id) throw new Error('Provider adapter registration is missing id.');
    if (typeof adapter.resolveModel !== 'function') {
      throw new Error(`Provider adapter '${adapter.id}' must implement resolveModel().`);
    }
    this.providerAdapters.set(adapter.id, adapter);
  }

  getAdapter(adapterId: string): ChatProviderAdapter | undefined {
    return this.providerAdapters.get(adapterId);
  }

  upsertProviderType(input: CreateProviderTypeInput | UpdateProviderTypeInput): ChatProviderTypeRecord {
    if (!input?.id) throw new Error('Provider type registration is missing id.');
    if (!input.adapter) throw new Error(`Provider type '${input.id}' is missing adapter.`);
    if (!this.providerAdapters.has(input.adapter)) {
      throw new Error(`Unknown provider adapter '${input.adapter}' for type '${input.id}'.`);
    }

    const current = this.providerTypes.get(input.id);
    const now = new Date().toISOString();
    const next: ChatProviderTypeRecord = {
      id: input.id,
      label: input.label ?? current?.label ?? input.id,
      description: input.description ?? current?.description,
      icon: input.icon ?? current?.icon,
      adapter: input.adapter,
      supportsUploads: input.supportsUploads ?? current?.supportsUploads,
      supportsFiles: input.supportsFiles ?? current?.supportsFiles,
      supportsImages: input.supportsImages ?? current?.supportsImages,
      supportsToolCalls: input.supportsToolCalls ?? current?.supportsToolCalls,
      defaultModelId: input.defaultModelId ?? current?.defaultModelId,
      requiresLogin: input.requiresLogin ?? current?.requiresLogin,
      contextId: input.contextId ?? current?.contextId ?? null,
      authType: input.authType ?? current?.authType ?? null,
      configSchema: Array.isArray(input.configSchema)
        ? input.configSchema.map(normalizeField)
        : current?.configSchema || [],
      fixedConfig: { ...(current?.fixedConfig || {}), ...(input.fixedConfig || {}) },
      fixedSecrets: { ...(current?.fixedSecrets || {}), ...(input.fixedSecrets || {}) },
      metadata: { ...(current?.metadata || {}), ...(input.metadata || {}) },
      source: input.source ?? current?.source ?? 'plugin',
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };

    this.providerTypes.set(next.id, next);
    return next;
  }

  getProviderType(typeId: string): ChatProviderTypeRecord | undefined {
    return this.providerTypes.get(typeId);
  }

  private sanitizeProviderType(record: ChatProviderTypeRecord): ChatProviderTypeClientRecord {
    const schema = (record.configSchema || []).map((field) => ({
      ...field,
      defaultValue: field.secret ? undefined : (field.defaultValue !== undefined ? field.defaultValue : record.fixedConfig?.[field.key]),
    }));

    const { fixedSecrets: _hidden, ...rest } = record;
    return {
      ...rest,
      configSchema: schema,
      fixedConfig: clone(record.fixedConfig),
    };
  }

  listProviderTypes(): ChatProviderTypeClientRecord[] {
    return Array.from(this.providerTypes.values())
      .map((record) => this.sanitizeProviderType(record))
      .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
  }

  private buildInstanceRecord(stored: ProviderInstanceStored): ChatProviderInstanceRecord {
    const type = this.getProviderType(stored.typeId);
    const fixedConfig = clone(type?.fixedConfig);
    const fixedSecrets = clone(type?.fixedSecrets);
    const overrideSecrets = clone(this.providerSecrets.get(stored.id));
    const secretKeys = Array.from(new Set([
      ...Object.keys(fixedSecrets),
      ...Object.keys(overrideSecrets),
    ])).sort();

    return {
      id: stored.id,
      typeId: stored.typeId,
      label: stored.label,
      description: stored.description,
      icon: stored.icon,
      defaultModelId: stored.defaultModelId ?? type?.defaultModelId ?? null,
      requiresLogin: stored.requiresLogin ?? type?.requiresLogin,
      contextId: stored.contextId ?? type?.contextId ?? null,
      authType: stored.authType ?? type?.authType ?? null,
      supportsUploads: stored.supportsUploads ?? type?.supportsUploads,
      supportsFiles: stored.supportsFiles ?? type?.supportsFiles,
      supportsImages: stored.supportsImages ?? type?.supportsImages,
      supportsToolCalls: stored.supportsToolCalls ?? type?.supportsToolCalls,
      config: { ...fixedConfig, ...(stored.configOverrides || {}) },
      metadata: stored.metadata,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      hasSecretOverrides: Object.keys(overrideSecrets).length > 0,
      hasSecretDefaults: Object.keys(fixedSecrets).length > 0,
      secretKeys,
    };
  }

  async createProviderInstance(input: CreateProviderInstanceInput, ownerUserId?: string | null): Promise<ChatProviderInstanceRecord> {
    const type = this.getProviderType(input.typeId);
    if (!type) throw new Error(`Unknown provider type '${input.typeId}'.`);

    const id = uid('prov');
    const now = new Date().toISOString();
    const stored: ProviderInstanceStored = {
      id,
      typeId: input.typeId,
      label: input.label,
      description: input.description,
      icon: input.icon ?? type.icon,
      defaultModelId: input.defaultModelId ?? type.defaultModelId ?? null,
      requiresLogin: input.requiresLogin ?? type.requiresLogin,
      contextId: input.contextId ?? type.contextId ?? null,
      authType: input.authType ?? type.authType ?? null,
      supportsUploads: type.supportsUploads,
      supportsFiles: type.supportsFiles,
      supportsImages: type.supportsImages,
      supportsToolCalls: type.supportsToolCalls,
      configOverrides: clone(input.config),
      metadata: { ...(input.metadata || {}), ownerUserId: ownerUserId ?? null },
      createdAt: now,
      updatedAt: now,
    };
    this.providerInstances.set(id, stored);
    this.providerSecrets.set(id, normalizeSecretsPatch({}, input.secrets));
    return this.buildInstanceRecord(stored);
  }

  async updateProviderInstance(providerId: string, patch: UpdateProviderInstanceInput): Promise<ChatProviderInstanceRecord> {
    const current = this.providerInstances.get(providerId);
    if (!current) throw new Error(`Unknown provider '${providerId}'.`);
    const now = new Date().toISOString();
    const next: ProviderInstanceStored = {
      ...current,
      label: patch.label ?? current.label,
      description: patch.description ?? current.description,
      icon: patch.icon ?? current.icon,
      defaultModelId: patch.defaultModelId ?? current.defaultModelId,
      requiresLogin: patch.requiresLogin ?? current.requiresLogin,
      contextId: patch.contextId ?? current.contextId,
      authType: patch.authType ?? current.authType,
      configOverrides: patch.config ? { ...current.configOverrides, ...patch.config } : current.configOverrides,
      metadata: patch.metadata ? { ...(current.metadata || {}), ...patch.metadata } : current.metadata,
      updatedAt: now,
    };
    this.providerInstances.set(providerId, next);
    if (patch.secrets) {
      const mergedSecrets = normalizeSecretsPatch(this.providerSecrets.get(providerId) || {}, patch.secrets);
      this.providerSecrets.set(providerId, mergedSecrets);
    }
    return this.buildInstanceRecord(next);
  }

  async getProviderInstance(providerId: string): Promise<ChatProviderInstanceRecord | null> {
    const current = this.providerInstances.get(providerId);
    return current ? this.buildInstanceRecord(current) : null;
  }

  async listProviderInstances(args?: { userId?: string | null; typeId?: string | null }): Promise<ChatProviderClientRegistration[]> {
    let items = Array.from(this.providerInstances.values());
    if (args?.typeId) items = items.filter((p) => p.typeId === args.typeId);
    if (args?.userId) {
      items = items.filter((p) => {
        const owner = (p.metadata?.ownerUserId ?? null) as string | null;
        return owner === null || owner === args.userId;
      });
    }
    return items
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((item) => this.buildInstanceRecord(item));
  }

  async deleteProviderInstance(providerId: string): Promise<void> {
    this.providerInstances.delete(providerId);
    this.providerSecrets.delete(providerId);
  }

  async getProviderRuntime(providerId: string): Promise<{ type: ChatProviderTypeRecord; instance: ChatProviderInstanceRecord; config: Record<string, unknown>; secrets: Record<string, unknown> }> {
    const stored = this.providerInstances.get(providerId);
    if (!stored) throw new Error(`Unknown provider '${providerId}'.`);
    const type = this.getProviderType(stored.typeId);
    if (!type) throw new Error(`Unknown provider type '${stored.typeId}'.`);
    const instance = this.buildInstanceRecord(stored);
    return {
      type,
      instance,
      config: { ...(type.fixedConfig || {}), ...(stored.configOverrides || {}) },
      secrets: { ...(type.fixedSecrets || {}), ...(this.providerSecrets.get(providerId) || {}) },
    };
  }

  async listModels(providerId: string, args: { ctx: any; contextId?: string | null }): Promise<ChatProviderModelInfo[]> {
    const runtime = await this.getProviderRuntime(providerId);
    const adapter = this.getAdapter(runtime.type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${runtime.type.adapter}'.`);
    if (adapter.listModels) {
      return adapter.listModels({
        ...args,
        providerId: runtime.instance.id,
        providerTypeId: runtime.type.id,
        modelId: runtime.instance.defaultModelId || runtime.type.defaultModelId || '',
        type: runtime.type,
        instance: runtime.instance,
        config: runtime.config,
        secrets: runtime.secrets,
      });
    }
    if (runtime.instance.defaultModelId || runtime.type.defaultModelId) {
      const id = runtime.instance.defaultModelId || runtime.type.defaultModelId!;
      return [{ id, label: id }];
    }
    return [];
  }

  async previewListModels(typeId: string, args: { ctx: any; contextId?: string | null; draftConfig?: Record<string, unknown>; draftSecrets?: Record<string, unknown> }): Promise<ChatProviderModelInfo[]> {
    const type = this.getProviderType(typeId);
    if (!type) throw new Error(`Unknown provider type '${typeId}'.`);
    const adapter = this.getAdapter(type.adapter);
    if (!adapter) throw new Error(`Unknown provider adapter '${type.adapter}'.`);
    if (!adapter.listModels) return [];


    const instance: ChatProviderInstanceRecord = {
      id: `draft_${type.id}`,
      typeId: type.id,
      label: type.label,
      description: type.description,
      icon: type.icon,
      defaultModelId: type.defaultModelId ?? null,
      requiresLogin: type.requiresLogin,
      contextId: args.contextId ?? type.contextId ?? null,
      authType: type.authType ?? null,
      supportsUploads: type.supportsUploads,
      supportsFiles: type.supportsFiles,
      supportsImages: type.supportsImages,
      supportsToolCalls: type.supportsToolCalls,
      config: { ...(type.fixedConfig || {}), ...(args.draftConfig || {}) },
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hasSecretOverrides: !!args.draftSecrets && Object.keys(args.draftSecrets).length > 0,
      hasSecretDefaults: !!type.fixedSecrets && Object.keys(type.fixedSecrets).length > 0,
      secretKeys: Array.from(new Set([
        ...Object.keys(type.fixedSecrets || {}),
        ...Object.keys(args.draftSecrets || {}),
      ])).sort(),
    };

    return adapter.listModels({
      ...args,
      providerId: instance.id,
      providerTypeId: type.id,
      modelId: instance.defaultModelId || '',
      type,
      instance,
      config: { ...(type.fixedConfig || {}), ...(args.draftConfig || {}) },
      secrets: { ...(type.fixedSecrets || {}), ...(args.draftSecrets || {}) },
      draftConfig: args.draftConfig,
      draftSecrets: args.draftSecrets,
    });
  }

  registerPersonality(personality: ChatPersonality): void {
    if (!personality?.id) throw new Error('Personality registration is missing id.');
    this.personalities.set(personality.id, personality);
  }

  getPersonality(personalityId?: string | null): ChatPersonality | undefined {
    return personalityId ? this.personalities.get(personalityId) : undefined;
  }

  listPersonalities(): ChatPersonality[] {
    return Array.from(this.personalities.values());
  }

  getSessionStore(): ChatSessionStore {
    return this.sessionStore;
  }

  setSessionStore(store: ChatSessionStore): void {
    this.sessionStore = store;
  }

  async hydrateSession(sessionId: string): Promise<ChatSessionHydration> {
    const session = await this.sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Unknown session '${sessionId}'.`);
    const [messages, attachments] = await Promise.all([
      this.sessionStore.listMessages(sessionId),
      this.sessionStore.listAttachments(sessionId),
    ]);
    return { session, messages, attachments };
  }

  newId(prefix: string): string {
    return uid(prefix);
  }
}

export { ChatServerRegistry, InMemoryChatSessionStore };
