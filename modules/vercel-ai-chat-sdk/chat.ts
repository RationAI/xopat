import { ChatPanel } from './ui/ChatPanel';
import {ChatService} from './chatService';

class ChatModule extends XOpatModuleSingleton {
    chatService: ChatService;
    chatPanel: ChatPanel;
    _scriptConsent: ScriptNamespaceConsentState;
    _layoutAttached?: boolean;

    constructor() {
        super('vercel-ai-chat-sdk');

        const cfg = this._getChatConfig();
        this._scriptConsent = {};

        this.chatService = new ChatService({
            getAllowedScriptApi: () => this.getAllowedScriptApiManifest(),
            personalities: cfg.personalities,
            defaultPersonalityId: cfg.defaultPersonalityId,
            serverFactory: () => this.server(),
        });

        this.chatPanel = new ChatPanel({
            id: 'pathology-chat-panel',
            chatModule: this,
            chatService: this.chatService,
            defaultPersonalityId: cfg.defaultPersonalityId,
        });

        this.refreshScriptConsentFromManager();
        this._attachToLayout();
        void this._bootstrapProviderCatalog();
    }

    async _bootstrapProviderCatalog(): Promise<void> {
        try {
            await this.chatService.refreshProviderTypesFromServer();
            await this.chatService.refreshProvidersFromServer();
            this.chatPanel?.refreshProviders?.();

            const activeProviderId =
                this.chatPanel?._providerId ||
                this.chatService.getProviders?.()[0]?.id ||
                null;

            if (activeProviderId) {
                await this.chatPanel?._refreshModelsForCurrentProvider?.();
            }
        } catch (error) {
            console.warn('Chat provider bootstrap failed:', error);
        }
    }

    _getActiveSessionModelCapabilities(): ModelCapabilities | null {
        const sessionId = this.chatService._activeSessionId;
        if (!sessionId) return null;

        const state = this.chatService._sessionState?.get?.(sessionId);
        const providerId = state?.providerId || null;
        if (!providerId) return null;

        const hydrationModels = this.chatService.getCachedModels?.(providerId) || [];
        const activeSession = this.chatPanel?._sessions?.find?.((s: any) => s.id === sessionId) || null;
        const modelId = activeSession?.modelId || this.chatPanel?._modelId || null;
        if (!modelId) return null;

        const model = hydrationModels.find((m: any) => m.id === modelId) || null;
        return model?.capabilities || null;
    }

    _isModelImageCapable(): boolean {
        return this._getActiveSessionModelCapabilities()?.images === 'supported';
    }

    _isModelFileCapable(): boolean {
        return this._getActiveSessionModelCapabilities()?.files === 'supported';
    }

    getScriptConsentEntries(): ScriptNamespaceConsentState {
        return this._scriptConsent;
    }

    setScriptNamespaceConsent(namespace: string, granted: boolean): void {
        if (!this._scriptConsent[namespace]) {
            this._scriptConsent[namespace] = {
                title: `Allow scripting namespace '${namespace}'.`,
                granted,
            };
        } else {
            this._scriptConsent[namespace].granted = granted;
        }

        this._syncScriptConsentToManager();
        this.chatPanel?.refreshScriptConsent?.();
    }

    refreshScriptConsentFromManager(): void {
        const manager = APPLICATION_CONTEXT?.Scripting;

        if (!manager || typeof manager.getNamespaceConsentEntries !== 'function') {
            this._scriptConsent = {};
            this.chatPanel?.refreshScriptConsent?.();
            return;
        }

        const inherited = manager.getNamespaceConsentEntries() || {};
        const next: ScriptNamespaceConsentState = {};

        for (const [namespace, entry] of Object.entries(inherited)) {
            const inheritedEntry = entry as { title: string; description?: string; granted?: boolean };
            next[namespace] = {
                title: inheritedEntry.title,
                description: inheritedEntry.description,
                granted: this._scriptConsent[namespace]?.granted ?? false,
            };
        }

        this._scriptConsent = next;
        manager.syncNamespaceConsent?.(this._scriptConsent);
        this.chatPanel?.refreshScriptConsent?.();
    }

    _syncScriptConsentToManager(): void {
        APPLICATION_CONTEXT?.Scripting?.syncNamespaceConsent?.(this._scriptConsent);
    }

    getAllowedScriptApiManifest(): AllowedScriptApiManifest {
        const manager = APPLICATION_CONTEXT?.Scripting;
        if (!manager?.getAllowedApiManifest) return { namespaces: [] };

        manager.syncNamespaceConsent?.(this._scriptConsent);
        return manager.getAllowedApiManifest() || { namespaces: [] };
    }

    async executeAssistantScript(script: string): Promise<ChatMessage> {
        const manager = APPLICATION_CONTEXT.Scripting;

        if (!manager.executeScript) {
            return {
                role: 'tool',
                parts: [{ ok: false, type: 'script-result', text: 'The requested action could not be completed because scripting is not available.' }],
                content: 'The requested action could not be completed because scripting is not available.',
                createdAt: new Date(),
            };
        }

        try {
            const result = await manager.executeScript(script);
            return await this._normalizeScriptResultToMessage(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                role: 'tool',
                parts: [{ ok: false, type: 'script-result', text: `The requested action could not be completed: ${message}` }],
                content: `The requested action could not be completed: ${message}`,
                createdAt: new Date(),
            };
        }
    }

    extractScriptFromAssistantMessage(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");

        const exact = content.match(/```xopat-script\s*([\s\S]*?)```/i);
        if (exact?.[1]?.trim()) return exact[1].trim();

        const fallback = content.match(/```(?:javascript|js|typescript|ts)\s*([\s\S]*?)```/i);
        if (fallback?.[1]?.trim()) return fallback[1].trim();

        return undefined;
    }

    extractAssistantTextWithoutScript(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");
        if (!content.trim()) return undefined;

        const stripped = content
            .replace(/```xopat-script\s*[\s\S]*?```/gi, "")
            .replace(/```(?:javascript|js|typescript|ts)\s*[\s\S]*?```/gi, "")
            .trim();

        return stripped || undefined;
    }

    _getChatConfig(): { personalities: ChatPersonality[]; defaultPersonalityId: string } {
        const inc = (globalThis as any).INCLUDE || (globalThis as any).include || {};
        const chatCfg: ChatConfigShape = inc.chat || (inc.modules && inc.modules.chat) || {};

        const personalities: ChatPersonality[] = Array.isArray(chatCfg.personalities) ? chatCfg.personalities : [];

        if (!personalities.length) {
            personalities.push({
                id: 'default',
                label: 'Default',
                systemPrompt:`
Be helpful and accurate. When the allowed scripting API can do the work, prefer using it silently instead of describing technical steps.
Do not talk about scripts, code blocks, namespaces, or execution unless the user explicitly asks for technical details.
For non-technical users, keep language plain and outcome-focused.
When scripting is not available or insufficient, explain the limitation clearly.`
            });
        }

        const defaultPersonalityId = chatCfg.defaultPersonalityId || personalities[0]?.id || 'default';
        return { personalities, defaultPersonalityId };
    }

    _attachToLayout(): void {
        if (this._layoutAttached || !window.LAYOUT) return;
        window.LAYOUT.addTab({
            id: 'chat',
            title: 'Chat',
            icon: 'fa-comments',
            body: [this.chatPanel],
        });
        this._layoutAttached = true;
    }

    async _normalizeScriptResultToMessage(result: any): Promise<ChatMessage> {
        const UTILITIES = (globalThis as any).UTILITIES || {};
        const isImageLike = typeof UTILITIES.isImageLike === 'function'
            ? UTILITIES.isImageLike.bind(UTILITIES)
            : () => false;
        const imageLikeToDataUrl = typeof UTILITIES.imageLikeToDataUrl === 'function'
            ? UTILITIES.imageLikeToDataUrl.bind(UTILITIES)
            : null;

        const isDataUrl = (value: unknown): value is string =>
            typeof value === 'string' && /^data:[^;]+;base64,/i.test(value.trim());

        const inferMimeType = (value: string, fallback = 'application/octet-stream') => {
            const match = value.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,/i);
            return match?.[1] || fallback;
        };

        const asPlainTextMessage = (text: string, ok = true): ChatMessage => ({
            role: 'tool',
            parts: [{ ok, type: 'script-result', text }],
            content: text,
            createdAt: new Date(),
        });

        const asImageMessage = async (dataUrl: string, name = 'script-image.png'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'image',
                dataUrl,
                mimeType: inferMimeType(dataUrl, 'image/png'),
                name,
            });

            return {
                role: 'tool',
                parts: [{
                    type: 'image',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }],
                content: '[Image]',
                createdAt: new Date(),
            };
        };

        const asFileMessage = async (dataUrl: string, name = 'script-file'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'file',
                dataUrl,
                mimeType: inferMimeType(dataUrl),
                name,
            });

            return {
                role: 'tool',
                parts: [{
                    type: 'file',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name || name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }],
                content: '[File]',
                createdAt: new Date(),
            };
        };

        if (result == null) {
            return asPlainTextMessage('Done.');
        }

        if (typeof result === 'string') {
            const value = result.trim();

            if (isImageLike(value) && this._isModelImageCapable() && imageLikeToDataUrl) {
                const dataUrl = await imageLikeToDataUrl(value);
                return await asImageMessage(dataUrl);
            }

            if (isDataUrl(value) && this._isModelFileCapable()) {
                return await asFileMessage(value);
            }

            return asPlainTextMessage(value || 'Done.');
        }

        if (isImageLike(result) && this._isModelImageCapable() && imageLikeToDataUrl) {
            const dataUrl = await imageLikeToDataUrl(result);
            return await asImageMessage(dataUrl);
        }

        if (Array.isArray(result)) {
            const parts: ChatMessagePart[] = [];
            const textChunks: string[] = [];

            for (const item of result) {
                if (isImageLike(item) && this._isModelImageCapable() && imageLikeToDataUrl) {
                    const dataUrl = await imageLikeToDataUrl(item);
                    const uploaded = await this._storeScriptAttachment({
                        kind: 'image',
                        dataUrl,
                        mimeType: inferMimeType(dataUrl, 'image/png'),
                        name: 'script-image.png',
                    });

                    parts.push({
                        type: 'image',
                        attachmentId: uploaded.id,
                        mimeType: uploaded.mimeType,
                        name: uploaded.name,
                        dataUrl: uploaded.dataUrl,
                        metadata: uploaded.metadata,
                    });
                    continue;
                }

                if (typeof item === 'string' && isDataUrl(item) && this._isModelFileCapable()) {
                    const uploaded = await this._storeScriptAttachment({
                        kind: 'file',
                        dataUrl: item,
                        mimeType: inferMimeType(item),
                        name: 'script-file',
                    });

                    parts.push({
                        type: 'file',
                        attachmentId: uploaded.id,
                        mimeType: uploaded.mimeType,
                        name: uploaded.name || 'script-file',
                        dataUrl: uploaded.dataUrl,
                        metadata: uploaded.metadata,
                    });
                    continue;
                }

                if (typeof item === 'string' && item.trim()) {
                    textChunks.push(item.trim());
                    continue;
                }

                if (item != null) {
                    textChunks.push(JSON.stringify(item, null, 2));
                }
            }

            if (textChunks.length) {
                parts.unshift({
                    ok: true,
                    type: 'script-result',
                    text: textChunks.join('\n\n'),
                });
            }

            if (parts.length) {
                return {
                    role: 'tool',
                    parts,
                    content: textChunks.join('\n\n') || 'Done.',
                    createdAt: new Date(),
                };
            }

            return asPlainTextMessage(textChunks.join('\n\n') || 'Done.');
        }

        return asPlainTextMessage(
            typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result)
        );
    }

    async _storeScriptAttachment(input: {
        kind: 'image' | 'file' | 'screenshot';
        dataUrl: string;
        mimeType: string;
        name?: string;
        metadata?: Record<string, unknown>;
    }): Promise<ChatAttachmentRecord> {
        const sessionId = this.chatService._activeSessionId;
        if (!sessionId) {
            throw new Error('No active session for script attachment.');
        }

        return await this.chatService.uploadAttachment({
            sessionId,
            kind: input.kind,
            name: input.name,
            mimeType: input.mimeType,
            dataBase64: input.dataUrl,
            metadata: input.metadata,
        });
    }

    registerPersonality(personality: ChatPersonality): void {
        this.chatService.registerPersonality(personality);
        this.chatPanel?.refreshPersonalities?.();
    }

    setPersonality(personalityId: string): void {
        this.chatService.setPersonality(personalityId);
        this.chatPanel?.refreshPersonalities?.();
    }

    async registerProviderType(definition: CreateProviderTypeInput): Promise<ChatProviderTypeRecord> {
        const record = await this.chatService.registerProviderType(definition);
        await this.chatService.refreshProviderTypesFromServer();
        return record;
    }

    async createProvider(config: CreateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this.chatService.createProvider(config);
        this.chatPanel?.refreshProviders?.();
        return provider;
    }

    async updateProvider(config: UpdateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this.chatService.updateProvider(config);
        this.chatPanel?.refreshProviders?.();
        return provider;
    }

    async refreshProviders(): Promise<void> {
        await this.chatService.refreshProvidersFromServer();
        this.chatPanel?.refreshProviders?.();
    }
}

export { ChatModule, ChatPanel, ChatService };
