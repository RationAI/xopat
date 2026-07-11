import { ChatPanel } from './ui/ChatPanel';
import {ChatService} from './chatService';

let enabled: boolean | undefined = undefined;
function isChatDebugModeEnabled(): boolean {
    if (enabled === undefined) {
        enabled = APPLICATION_CONTEXT.getOption("debugMode", true, true);
    }
    return !!enabled;
}

function truncateChatDebugText(value: string, maxChars = 8_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function debugSerializeChatValue(value: any, depth = 0): any {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return truncateChatDebugText(value);
    if (depth >= 6) return "[Max debug depth reached]";
    if (Array.isArray(value)) return value.slice(0, 25).map((item) => debugSerializeChatValue(item, depth + 1));
    if (typeof value === "object") {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, 25)) {
            output[key] = debugSerializeChatValue(item, depth + 1);
        }
        return output;
    }
    return String(value);
}

function chatDebugLog(label: string, data?: unknown): void {
    if (!isChatDebugModeEnabled()) return;

    if (typeof data === "undefined") {
        console.debug(`[CHAT DEBUG] ${label}`);
        return;
    }

    console.debug(`[CHAT DEBUG] ${label}`, debugSerializeChatValue(data));
}

class ChatModule extends XOpatModuleSingleton {
    chatService: ChatService;
    chatPanel: ChatPanel;
    _scriptConsent: ScriptNamespaceConsentState;
    _layoutAttached?: boolean;
    _pendingNewNamespaces: Set<string> = new Set();
    _namespaceChangeScheduled = false;

    constructor() {
        super();

        const cfg = this._getChatConfig();
        this._scriptConsent = {};

        this.chatService = new ChatService({
            getAllowedScriptApi: () => this.getAllowedScriptApiManifest(),
            personalities: cfg.personalities,
            defaultPersonalityId: cfg.defaultPersonalityId,
            serverFactory: () => this.server(),
            sessionOwnerKey: 'vercel-ai-chat-sdk',
            legacySessionSource: 'vercel-ai-chat-sdk',
        });

        this.chatPanel = new ChatPanel({
            id: 'pathology-chat-panel',
            chatModule: this,
            chatService: this.chatService,
            defaultPersonalityId: cfg.defaultPersonalityId,
            maxScriptSteps: cfg.maxScriptSteps,
            maxScriptStepExtensions: cfg.maxScriptStepExtensions,
            scriptStepExtensionSize: cfg.scriptStepExtensionSize,
            minSuccessfulProgressStepsBeforeExtension: cfg.minSuccessfulProgressStepsBeforeExtension,
        });

        this.refreshScriptConsentFromManager();
        this._subscribeToScriptingNamespaceChanges();
        this._attachToLayout();
        void this._bootstrapProviderCatalog();
    }

    _subscribeToScriptingNamespaceChanges(): void {
        const manager = APPLICATION_CONTEXT?.Scripting as any;
        if (typeof manager?.addNamespacesChangedHandler !== 'function') return;

        manager.addNamespacesChangedHandler(() => {
            // Snapshot which namespaces we already knew about, then refresh from the
            // manager so newly-registered namespaces surface in the consent settings
            // (default-off, preserving prior grants).
            const priorKeys = new Set(Object.keys(this._scriptConsent));
            this.refreshScriptConsentFromManager();

            for (const key of Object.keys(this._scriptConsent)) {
                if (!priorKeys.has(key)) this._pendingNewNamespaces.add(key);
            }

            // Batch namespaces registered together (e.g. one plugin exposing several)
            // into a single prompt on the next microtask.
            if (!this._namespaceChangeScheduled && this._pendingNewNamespaces.size) {
                this._namespaceChangeScheduled = true;
                queueMicrotask(() => {
                    this._namespaceChangeScheduled = false;
                    const names = [...this._pendingNewNamespaces];
                    this._pendingNewNamespaces.clear();
                    if (names.length) this._promptNewNamespaceConsent(names);
                });
            }
        });
    }

    _namespaceTitle(namespace: string): string {
        return this._scriptConsent[namespace]?.title || namespace;
    }

    _promptNewNamespaceConsent(namespaces: string[]): void {
        // Only nudge the user while a chat session is actually active; otherwise the
        // new namespace just sits (default-off) in the chat settings consent list.
        if (!this.chatService?._activeSessionId) return;

        const Dialogs = (window as any).Dialogs;
        if (typeof Dialogs?.show !== 'function') return;

        const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));

        const single = namespaces.length === 1;
        const label = single
            ? `"${this._namespaceTitle(namespaces[0]!)}"`
            : $.t('chat.newCapabilitiesCount', { count: namespaces.length });
        const message = $.t('chat.newCapabilityPrompt', {
            label,
            pronoun: single ? $.t('chat.pronounIt') : $.t('chat.pronounThem'),
        });

        Dialogs.show(escapeHtml(message), 0, Dialogs.MSG_WARN, {
            buttons: [
                {
                    label: $.t('chat.allow'),
                    class: 'btn-primary',
                    onClick: (_ev: Event, d: any) => {
                        namespaces.forEach((ns) => this.setScriptNamespaceConsent(ns, true));
                        this._queueCapabilityNotice(namespaces);
                        d?.hide?.();
                    },
                },
                {
                    label: $.t('chat.notNow'),
                    onClick: (_ev: Event, d: any) => d?.hide?.(),
                },
            ],
        });
    }

    _queueCapabilityNotice(namespaces: string[]): void {
        for (const ns of namespaces) {
            this.chatService?.queueCapabilityNotice?.(
                `A new capability "${this._namespaceTitle(ns)}" is now available to you. ` +
                `Call application.describeScriptingApi('${ns}') to discover how to use it.`
            );
        }
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
                title: $.t('chat.allowScriptingNamespaceTitle', { namespace }),
                granted,
            };
        } else {
            this._scriptConsent[namespace].granted = granted;
        }

        this._syncScriptConsentToManager();
        // Grant-state change only: update checkboxes in place (preserves scroll).
        // syncScriptConsentState falls back to a full rebuild if membership changed.
        this.chatPanel?.syncScriptConsentState?.();
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

    _resolveLiveViewerContextId(): string | null {
        const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];

        const activeViewerId = (globalThis as any).VIEWER_MANAGER?.activeViewer?.uniqueId;
        if (typeof activeViewerId === 'string' && activeViewerId.trim()) {
            return activeViewerId.trim();
        }

        if (viewers.length === 1 && typeof viewers[0]?.uniqueId === 'string' && viewers[0].uniqueId.trim()) {
            return viewers[0].uniqueId.trim();
        }

        return null;
    }

    getActiveChatContextId(): string | null {
        return this._resolveLiveViewerContextId();
    }

    _getScriptExecutionContext(): any | null {
        const manager = APPLICATION_CONTEXT?.Scripting;
        if (!manager || typeof manager.getContext !== 'function') {
            return null;
        }

        const activeSessionId = this.chatService?.getActiveSessionId?.() || null;
        const viewerContextId = this.getActiveChatContextId();
        const contextId = viewerContextId || manager.defaultContextId || 'default';
        const context = manager.getContext(contextId);

        if (viewerContextId && typeof context?.setActiveViewerContextId === 'function') {
            context.setActiveViewerContextId(viewerContextId);
        }

        context?.setLabel?.(`Chat: ${contextId}`);
        context?.patchMetadata?.({
            source: 'chat',
            providerId: this.chatPanel?._providerId || null,
            sessionId: activeSessionId,
            viewerContextId,
            providerRuntimeContextId: this.chatService?.getSessionProviderContextId?.(activeSessionId) || null,
        });

        return context;
    }

    async executeAssistantScript(script: string, options: { signal?: AbortSignal } = {}): Promise<ChatMessage> {
        const context = this._getScriptExecutionContext();
        chatDebugLog("SCRIPT_EXECUTION_REQUEST", {
            contextId: context?.id || null,
            activeViewerContextId: typeof context?.getActiveViewerContextId === "function"
                ? context.getActiveViewerContextId()
                : null,
            script,
        });

        if (!context || typeof context.executeScript !== 'function') {
            return {
                role: 'user',
                parts: [{ ok: false, type: 'script-result', text: 'The requested action could not be completed because scripting is not available.' }],
                content: 'The requested action could not be completed because scripting is not available.',
                createdAt: new Date(),
            };
        }

        const workerId = typeof context?.createWorker === 'function'
            ? `${context.id || 'default'}-chat-script-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;

        const signal = options?.signal;
        const abortError = () => {
            try {
                if (workerId && typeof context?.abortScript === 'function') {
                    context.abortScript(workerId);
                }
            } catch (_) {
                // ignore abort cleanup failures
            }
            return new DOMException('Stopped by user.', 'AbortError');
        };

        try {
            if (signal?.aborted) {
                throw abortError();
            }

            const executionPromise = context.executeScript(
                script,
                workerId ? { workerId } : {}
            );

            const result = signal
                ? await new Promise((resolve, reject) => {
                    const onAbort = () => reject(abortError());
                    signal.addEventListener('abort', onAbort, { once: true });

                    executionPromise.then(resolve, reject).finally(() => {
                        signal.removeEventListener('abort', onAbort);
                    });
                })
                : await executionPromise;

            chatDebugLog("SCRIPT_EXECUTION_RESULT", {
                contextId: context?.id || null,
                result,
            });
            const normalized = await this._normalizeScriptResultToMessage(result);
            chatDebugLog("SCRIPT_EXECUTION_MESSAGE", normalized);
            return normalized;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            chatDebugLog("SCRIPT_EXECUTION_ERROR", {
                contextId: context?.id || null,
                error,
            });
            return {
                role: 'user',
                parts: [{ ok: false, type: 'script-result', text: `The requested action could not be completed: ${message}`, script } as any],
                content: `The requested action could not be completed: ${message}`,
                createdAt: new Date(),
                metadata: {
                    scriptError: this._extractScriptExecutionErrorDetails(error),
                } as any,
            };
        }
    }

    _extractScriptExecutionErrorDetails(error: any): Record<string, unknown> | null {
        const visited = new Set<any>();
        let current = error;

        while (current && typeof current === "object" && !visited.has(current)) {
            visited.add(current);

            if (current.couplingViolation || Array.isArray(current.ajvErrors)) {
                const details: Record<string, unknown> = {
                    name: current.name || "Error",
                    message: current.message || String(current),
                };

                if (current.couplingViolation && typeof current.couplingViolation === "object") {
                    details.couplingViolation = {
                        coupling: current.couplingViolation.coupling,
                        layerType: current.couplingViolation.layerType,
                        layerPath: current.couplingViolation.layerPath,
                        controls: current.couplingViolation.controls,
                        expected: current.couplingViolation.expected,
                        actual: current.couplingViolation.actual,
                    };
                }

                if (Array.isArray(current.ajvErrors) && current.ajvErrors.length) {
                    details.ajvErrors = current.ajvErrors.slice(0, 5).map((entry: any) => ({
                        instancePath: entry?.instancePath,
                        message: entry?.message,
                        params: entry?.params,
                    }));
                }

                return details;
            }

            current = current.cause;
        }

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
            };
        }

        if (typeof error === "string" && error.trim()) {
            return { message: error.trim() };
        }

        return null;
    }

    extractScriptFromAssistantMessage(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");

        const exact = content.match(/```xopat-script\s*([\s\S]*?)```/i);
        if (exact?.[1]?.trim()) return exact[1].trim();

        const fallback = content.match(/```(?:javascript|js|typescript|ts)\s*([\s\S]*?)```/i);
        if (fallback?.[1]?.trim()) return fallback[1].trim();

        const pseudoToolCall = this._extractScriptFromToolEnvelope(content);
        if (pseudoToolCall) return pseudoToolCall;

        return undefined;
    }

    extractAssistantTextWithoutScript(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");
        if (!content.trim()) return undefined;

        const stripped = content
            .replace(/```xopat-script\s*[\s\S]*?```/gi, "")
            .replace(/```(?:javascript|js|typescript|ts)\s*[\s\S]*?```/gi, "")
            .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi, "")
            .replace(/functions\.xopat-(?:host-)?script\s*:\s*\d+/gi, "")
            .trim();

        return stripped || undefined;
    }

    _extractScriptFromToolEnvelope(content: string): string | undefined {
        const normalized = String(content || "");
        if (!normalized) return undefined;

        const jsonArgMatches = Array.from(
            normalized.matchAll(
                /functions\.(xopat-(?:host-)?script)\s*:\s*\d+\s*<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*<\|tool_call_end\|>/gi
            )
        );

        for (const match of jsonArgMatches) {
            const toolName = String(match[1] || "").toLowerCase();
            const payloadText = String(match[2] || "").trim();
            const code = this._readCodeFromToolPayload(payloadText);
            if (!code) continue;

            if (toolName === "xopat-host-script") return code;
            return code;
        }

        const looseJsonMatches = Array.from(
            normalized.matchAll(/<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*(?:<\|tool_call_end\|>|$)/gi)
        );
        for (const match of looseJsonMatches) {
            const code = this._readCodeFromToolPayload(String(match[1] || "").trim());
            if (code) return code;
        }

        return undefined;
    }

    _readCodeFromToolPayload(payloadText: string): string | undefined {
        if (!payloadText) return undefined;

        try {
            const parsed = JSON.parse(payloadText);
            if (typeof parsed?.code === "string" && parsed.code.trim()) {
                return parsed.code.trim();
            }
        } catch (_) {
            const codeMatch = payloadText.match(/"code"\s*:\s*"([\s\S]*?)"\s*(?:,|})/i);
            if (!codeMatch?.[1]) return undefined;

            try {
                return JSON.parse(`"${codeMatch[1]}"`).trim();
            } catch {
                return codeMatch[1]
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\t/g, "\t")
                    .trim();
            }
        }

        return undefined;
    }

    _getChatConfig(): {
        personalities: ChatPersonality[];
        defaultPersonalityId: string;
        maxScriptSteps: number;
        maxScriptStepExtensions: number;
        scriptStepExtensionSize: number;
        minSuccessfulProgressStepsBeforeExtension: number;
    } {
        const personalities: ChatPersonality[] = this.getStaticMeta('personalities', []);

        if (!personalities.length) {
            personalities.push({
                id: 'default',
                label: $.t('chat.defaultPersonalityLabel'),
                systemPrompt:`
Be helpful and accurate. When the allowed scripting API can do the work, prefer using it silently instead of describing technical steps.
Do not use scripting for greetings, thanks, or simple acknowledgements that do not require viewer inspection or action.
Do not assume any previous script succeeded unless its result is explicitly present in the conversation.
If the user asks who created, authored, or owns annotations, comments, or other viewer items, only answer if the available information identifies the current user. Otherwise state the limitation briefly instead of inferring.
Do not talk about scripts, code blocks, namespaces, or execution unless the user explicitly asks for technical details.
For non-technical users, keep language plain and outcome-focused.
When scripting is not available or insufficient, explain the limitation clearly.`
            });
        }

        const defaultPersonalityId = this.getStaticMeta('defaultPersonalityId') || personalities[0]?.id || 'default';
        const maxScriptSteps = this.getStaticMeta('maxScriptSteps', 12);
        const maxScriptStepExtensions = this.getStaticMeta('maxScriptStepExtensions', 3);
        const scriptStepExtensionSize = this.getStaticMeta('scriptStepExtensionSize', 4);
        const minSuccessfulProgressStepsBeforeExtension = this.getStaticMeta('minSuccessfulProgressStepsBeforeExtension', 4);

        return {
            personalities,
            defaultPersonalityId,
            maxScriptSteps,
            maxScriptStepExtensions,
            scriptStepExtensionSize,
            minSuccessfulProgressStepsBeforeExtension,
        };
    }

    _attachToLayout(): void {
        if (this._layoutAttached) return;
        (window as any).LAYOUT.addTab({
            id: 'chat',
            title: $.t('chat.tabTitle'),
            icon: 'fa-comments',
            body: [this.chatPanel],
        });
        this._layoutAttached = true;
    }

    async _normalizeScriptResultToMessage(result: any): Promise<ChatMessage> {
        const UTILITIES = (globalThis as any).UTILITIES || {};
        const MAX_RESULT_TEXT_CHARS = 8_000;
        const isImageLike = typeof UTILITIES.isImageLike === 'function'
            ? UTILITIES.isImageLike.bind(UTILITIES)
            : () => false;
        const imageLikeToDataUrl = typeof UTILITIES.imageLikeToDataUrl === 'function'
            ? UTILITIES.imageLikeToDataUrl.bind(UTILITIES)
            : null;

        const parseDataUrl = (value: unknown): { mediaType?: string; base64: string; raw: string } | null => {
            if (typeof value !== 'string') return null;
            const raw = value.trim();
            const match = raw.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
            if (!match) return null;
            const base64 = String(match[2] || '').replace(/\s+/g, '');
            if (!base64 || base64.length < 64) return null;
            if (base64.length % 4 === 1) return null;

            try {
                if (typeof atob === 'function') {
                    atob(base64);
                }
            } catch {
                return null;
            }

            return {
                mediaType: match[1] || undefined,
                base64,
                raw,
            };
        };

        const isDataUrl = (value: unknown): value is string =>
            !!parseDataUrl(value);

        const isImageDataUrl = (value: unknown): value is string =>
            !!parseDataUrl(value)?.mediaType?.match(/^image\//i);

        const inferMimeType = (value: string, fallback = 'application/octet-stream') => {
            const match = value.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,/i);
            return match?.[1] || fallback;
        };
        const truncateText = (value: string, label = 'text') => {
            if (value.length <= MAX_RESULT_TEXT_CHARS) return value;
            return `${value.slice(0, MAX_RESULT_TEXT_CHARS)}\n\n[${label} truncated to ${MAX_RESULT_TEXT_CHARS} characters by vercel-ai-chat-sdk]`;
        };

        const withInternalMetadata = (message: ChatMessage): ChatMessage => ({
            ...message,
            metadata: {
                ...(message.metadata || {}),
                hiddenFromChatUi: true,
                internalSource: 'script-runtime',
            },
        });

        const asFeedbackMessage = (text: string, ok = true): ChatMessage => withInternalMetadata({
            role: 'tool',
            parts: [{ ok, type: 'script-result', text } as any],
            content: text,
            createdAt: new Date(),
        });

        const asGuidanceForMissingReturn = (): ChatMessage => asFeedbackMessage(
            'Script execution finished without a returned value. The runtime only feeds back the explicit return value. Correct the previous script by returning the final string, object, array, or attachment-producing value.',
            false
        );
        const attachmentParts: ChatMessagePart[] = [];
        const uploadEmbeddedDataUrl = async (dataUrl: string, path: string) => {
            const isImage = isImageDataUrl(dataUrl);
            const uploaded = await this._storeScriptAttachment({
                kind: isImage ? 'image' : 'file',
                dataUrl,
                mimeType: inferMimeType(dataUrl, isImage ? 'image/png' : 'application/octet-stream'),
                name: isImage ? `${path || 'script-image'}.png` : `${path || 'script-file'}`,
                metadata: { sourcePath: path || 'result' },
            });

            attachmentParts.push((isImage ? {
                type: 'image',
                attachmentId: uploaded.id,
                mimeType: uploaded.mimeType,
                name: uploaded.name,
                dataUrl: uploaded.dataUrl,
                metadata: uploaded.metadata,
            } : {
                type: 'file',
                attachmentId: uploaded.id,
                mimeType: uploaded.mimeType,
                name: uploaded.name || path || 'script-file',
                dataUrl: uploaded.dataUrl,
                metadata: uploaded.metadata,
            }) as any);

            return isImage
                ? `[Image attachment stored at ${path || 'result'}: ${uploaded.name || 'image'}]`
                : `[File attachment stored at ${path || 'result'}: ${uploaded.name || 'file'}]`;
        };
        const sanitizeStructuredValue = async (value: any, path = 'result', depth = 0): Promise<any> => {
            if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;

            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (isDataUrl(trimmed)) {
                    return await uploadEmbeddedDataUrl(trimmed, path);
                }
                return truncateText(value, path);
            }

            if (isImageLike(value) && imageLikeToDataUrl) {
                const dataUrl = await imageLikeToDataUrl(value);
                return await uploadEmbeddedDataUrl(dataUrl, path);
            }

            if (depth >= 19) {
                return '[Object truncated: maximum serialization depth reached]';
            }

            if (Array.isArray(value)) {
                const items = [];
                const capped = value.slice(0, 50);
                for (let index = 0; index < capped.length; index++) {
                    items.push(await sanitizeStructuredValue(capped[index], `${path}[${index}]`, depth + 1));
                }
                if (value.length > capped.length) {
                    items.push(`[Array truncated: ${value.length - capped.length} more item(s)]`);
                }
                return items;
            }

            if (typeof value === 'object') {
                const entries = Object.entries(value);
                const capped = entries.slice(0, 50);
                const output: Record<string, unknown> = {};
                for (const [key, item] of capped) {
                    output[key] = await sanitizeStructuredValue(item, `${path}.${key}`, depth + 1);
                }
                if (entries.length > capped.length) {
                    output.__truncated__ = `${entries.length - capped.length} more key(s) omitted`;
                }
                return output;
            }

            return truncateText(String(value), path);
        };

        const asImageMessage = async (dataUrl: string, name = 'script-image.png'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'image',
                dataUrl,
                mimeType: inferMimeType(dataUrl, 'image/png'),
                name,
            });

            return withInternalMetadata({
                role: 'tool',
                parts: [{
                    type: 'image',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }, {
                    type: 'host-feedback',
                    text: `Script produced an image attachment${uploaded.name ? `: ${uploaded.name}` : ''}. Read the attachment and any other returned fields to answer the user.`,
                } as any],
                content: uploaded.name ? `[Image: ${uploaded.name}]` : '[Image]',
                createdAt: new Date(),
            });
        };

        const asFileMessage = async (dataUrl: string, name = 'script-file'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'file',
                dataUrl,
                mimeType: inferMimeType(dataUrl),
                name,
            });

            return withInternalMetadata({
                role: 'tool',
                parts: [{
                    type: 'file',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name || name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }, {
                    type: 'host-feedback',
                    text: `Script produced a file attachment${uploaded.name ? `: ${uploaded.name}` : ''}. Read the attachment and any other returned fields to answer the user.`,
                } as any],
                content: uploaded.name ? `[File: ${uploaded.name}]` : '[File]',
                createdAt: new Date(),
            });
        };

        if (result == null) {
            return asGuidanceForMissingReturn();
        }

        if (typeof result === 'string') {
            const value = result.trim();

            if (!value) {
                return asGuidanceForMissingReturn();
            }

            if (isImageDataUrl(value)) {
                return await asImageMessage(value, 'script-image.png');
            }

            if (isImageLike(value) && imageLikeToDataUrl) {
                const dataUrl = await imageLikeToDataUrl(value);
                return await asImageMessage(dataUrl);
            }

            if (isDataUrl(value)) {
                return await asFileMessage(value);
            }

            return asFeedbackMessage(truncateText(value || ''));
        }

        if (isImageLike(result) && imageLikeToDataUrl) {
            const dataUrl = await imageLikeToDataUrl(result);
            return await asImageMessage(dataUrl);
        }
        const sanitized = await sanitizeStructuredValue(result);
        const text = typeof sanitized === 'string'
            ? sanitized
            : truncateText(JSON.stringify(sanitized, null, 2), 'script-result');
        const parts: ChatMessagePart[] = [];

        if (text.trim()) {
            parts.push({
                ok: true,
                type: 'script-result',
                text,
            } as any);
        }

        if (attachmentParts.length) {
            parts.push(...attachmentParts);
            parts.push({
                type: 'host-feedback',
                text: 'Script produced attachment output. Read the attachment placeholders and any related metadata to answer the user.',
            } as any);
        }

        if (!parts.length) {
            return asGuidanceForMissingReturn();
        }

        return withInternalMetadata({
            role: 'tool',
            parts,
            content: text || 'Script produced non-text output.',
            createdAt: new Date(),
        });
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
window.addModule('vercel-ai-chat-sdk', ChatModule);
