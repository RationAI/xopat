import type {ChatService} from "../chatService";
import type {ChatModule} from "../chat";
import {ChatSessionPicker} from "./ChatSessionPicker";
import {ChatAttachmentBar} from "./ChatAttachmentBar";
import {ChatMessageList} from "./ChatMessageList";

const { BaseComponent, Button, FAIcon, Checkbox } = (globalThis as any).UI;
const { div, span, select, option, textarea, fieldset, legend, label, input } = (globalThis as any).van.tags;

type ChatPanelOptions = {
    id?: string;
    chatModule: ChatModule;
    chatService: ChatService;
    defaultProviderId?: string | null;
    defaultPersonalityId?: string | null;
    markdownEnabled?: boolean;
    sanitizeConfig?: any;
    maxScriptSteps?: number;
    maxScriptStepExtensions?: number;
    scriptStepExtensionSize?: number;
    minSuccessfulProgressStepsBeforeExtension?: number;
};

type ScriptConsentEntry = {
    title: string;
    granted: boolean;
    description?: string;
};

export class ChatPanel extends BaseComponent {
    MAX_SCRIPT_STEPS: number;
    MAX_SCRIPT_STEP_EXTENSIONS: number;
    SCRIPT_STEP_EXTENSION_SIZE: number;
    MIN_SUCCESSFUL_PROGRESS_STEPS_BEFORE_EXTENSION: number;

    chat: ChatModule;
    chatService: ChatService;

    _providerId: string | null;
    _personalityId: string | null;
    _modelId: string | null;
    _models: ChatProviderModelInfo[];
    _messages: ChatMessage[];
    _sessions: ChatSession[];
    _consentConfigured: boolean;

    _root: HTMLElement | null;
    _inputEl: HTMLTextAreaElement | null;
    _inputOverlayEl: HTMLElement | null;
    _sendBtnEl: any;
    _sendBtnLabelEl: HTMLElement | null;
    _statusEl: HTMLElement | null;
    _sessionTitleEl: HTMLElement | null;
    _sessionsBtnEl: any;
    _sessionsNewBtnEl: any;
    _loginBtn: any;
    _settingsModal: any;
    _settingsContentEl: HTMLElement | null;
    _providerSelectEl: HTMLSelectElement | null;
    _personalitySelectEl: HTMLSelectElement | null;
    _displayModeSelectEl: HTMLSelectElement | null;
    _modelSelectEl: HTMLSelectElement | null;
    _chatViewEl: HTMLElement | null;
    _sessionsViewEl: HTMLElement | null;

    _displayMode: "all" | "user-friendly";
    _viewMode: "chat" | "sessions";

    _sessionPicker: ChatSessionPicker | null;
    _attachmentBar: ChatAttachmentBar | null;
    _messageList: ChatMessageList | null;

    _sanitizeConfig: any;
    _isRunning: boolean;
    _stopRequested: boolean;
    _turnAbortController: AbortController | null;

    _scriptConsentCheckboxes: Map<string, HTMLInputElement>;
    _scriptConsentGrantAllEl: HTMLInputElement | null;

    declare options: ChatPanelOptions;
    declare classMap: Record<string, string>;

    constructor(options: ChatPanelOptions = void 0 as any) {
        super(options);
        options = this.options;

        this.chat = options.chatModule;
        this.chatService = options.chatService;

        if (!this.chatService) {
            console.warn("ChatPanel: UI.Services.Chat not available; provide chatService option.");
        }

        this._providerId = options.defaultProviderId || null;
        this._personalityId = options.defaultPersonalityId || null;
        this._modelId = null;
        this._models = [];
        this._messages = [];
        this._sessions = [];
        this._consentConfigured = false;

        this._displayMode = "user-friendly";
        this._viewMode = "chat";

        this._scriptConsentCheckboxes = new Map();
        this._scriptConsentGrantAllEl = null;

        this._root = null;
        this._inputEl = null;
        this._inputOverlayEl = null;
        this._sendBtnEl = null;
        this._sendBtnLabelEl = null;
        this._statusEl = null;
        this._sessionTitleEl = null;
        this._sessionsBtnEl = null;
        this._sessionsNewBtnEl = null;
        this._loginBtn = null;
        this._settingsModal = null;
        this._settingsContentEl = null;
        this._providerSelectEl = null;
        this._personalitySelectEl = null;
        this._displayModeSelectEl = null;
        this._modelSelectEl = null;
        this._chatViewEl = null;
        this._sessionsViewEl = null;

        this._sessionPicker = null;
        this._attachmentBar = null;
        this._messageList = null;

        this._isRunning = false;
        this._stopRequested = false;
        this._turnAbortController = null;

        const positiveInt = (value: unknown, fallback: number) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
        };

        this.MAX_SCRIPT_STEPS = positiveInt(options.maxScriptSteps, 12);
        this.MAX_SCRIPT_STEP_EXTENSIONS = positiveInt(options.maxScriptStepExtensions, 2);
        this.SCRIPT_STEP_EXTENSION_SIZE = positiveInt(options.scriptStepExtensionSize, 4);
        this.MIN_SUCCESSFUL_PROGRESS_STEPS_BEFORE_EXTENSION = positiveInt(
            options.minSuccessfulProgressStepsBeforeExtension,
            4
        );

        this.classMap["base"] = "flex flex-col h-full border-l border-base-300 bg-base-100 text-sm";
        this._applyOptions(options);

        this._sanitizeConfig = {
            allowedTags: [
                "p","br","strong","em","b","i",
                "h1","h2","h3","h4","h5","h6",
                "ul","ol","li",
                "blockquote",
                "pre","code",
                "a","hr",
                "table","thead","tbody","tr","th","td",
                "img"
            ],
            allowedAttributes: {
                a: ["href","title","target","rel","download"],
                code: ["class"],
                pre: ["class"],
                img: ["src","alt","class"]
            },
            allowedSchemes: ["http","https","mailto","data"],
            transformTags: {
                a: (tagName: string, attribs: Record<string, string>) => {
                    const attrs = { ...attribs };
                    if (!attrs.download) {
                        attrs.target = "_blank";
                        attrs.rel = "noopener noreferrer";
                    }
                    return { tagName, attribs: attrs };
                }
            }
        };
    }

    refreshProviders(): void {
        if (!this._providerSelectEl || !this.chatService) return;

        const providers = this.chatService.getProviders();
        this._providerSelectEl.innerHTML = "";
        this._providerSelectEl.appendChild(option({ value: "" }, "Select provider…"));

        providers.forEach((p: ChatProviderInstanceRecord) => {
            this._providerSelectEl!.appendChild(option({ value: p.id }, p.label));
        });

        const current = this._providerId && this.chatService.getProvider(this._providerId) ? this._providerId : null;
        if (current) {
            this._providerSelectEl.value = current;
        } else {
            this._providerId = null;
            this._providerSelectEl.value = "";
            void this._onProviderChange("");
        }
        this._updateLoginButtonState();
        this._updateSessionPickerState();
    }

    refreshPersonalities(): void {
        if (!this._personalitySelectEl || !this.chatService) return;

        const personalities = typeof this.chatService.getPersonalities === "function"
            ? this.chatService.getPersonalities()
            : [];

        if (!personalities || !personalities.length) {
            this._personalitySelectEl.classList.add("hidden");
            return;
        }
        this._personalitySelectEl.classList.remove("hidden");

        this._personalitySelectEl.innerHTML = "";
        personalities.forEach((p: ChatPersonality) => {
            const opt = option({ value: p.id }, p.label || p.id);
            this._personalitySelectEl!.appendChild(opt);
        });

        const serviceCurrent = typeof this.chatService.getCurrentPersonalityId === "function"
            ? this.chatService.getCurrentPersonalityId()
            : null;

        const preferred = this._personalityId || serviceCurrent || personalities[0]?.id || null;
        if (preferred && personalities.find((p: ChatPersonality) => p.id === preferred)) {
            this._personalityId = preferred;
            this._personalitySelectEl.value = preferred;
            try { this.chatService.setPersonality(preferred); } catch (_) {}
        } else {
            this._personalityId = personalities[0]?.id || null;
            if (this._personalityId) {
                this._personalitySelectEl.value = this._personalityId;
                try { this.chatService.setPersonality(this._personalityId); } catch (_) {}
            }
        }
    }

    _onPersonalityChange(personalityId: string): void {
        if (!this.chatService) return;
        this._personalityId = personalityId || null;

        try {
            this.chatService.setPersonality(this._personalityId);
        } catch (e) {
            console.warn("Failed to set personality:", e);
        }

        if (this.chatService.getActiveSessionId()) {
            this._setStatus("Personality changed. New turns will use the updated personality.");
        }
    }

    async _refreshModelsForCurrentProvider(preferredModelId?: string | null): Promise<void> {
        if (!this._modelSelectEl || !this.chatService || !this._providerId) {
            this._models = [];
            this._modelId = null;
            if (this._modelSelectEl) {
                this._modelSelectEl.innerHTML = "";
                this._modelSelectEl.appendChild(option({ value: "" }, "No models"));
                this._modelSelectEl.value = "";
                this._modelSelectEl.disabled = true;
            }
            return;
        }

        try {
            const models = await this.chatService.listModels(this._providerId);
            this._models = Array.isArray(models) ? models : [];
            const nextPreferred = preferredModelId || this._modelId;
            this._modelId = nextPreferred && this._models.some((m) => m.id === nextPreferred)
                ? nextPreferred
                : (this._models[0]?.id || null);

            this._modelSelectEl.innerHTML = "";
            if (!this._models.length) {
                this._modelSelectEl.appendChild(option({ value: "" }, "No models"));
                this._modelSelectEl.value = "";
                this._modelSelectEl.disabled = true;
                this._updateAttachmentCapabilityState();
                return;
            }

            this._models.forEach((m) => {
                this._modelSelectEl!.appendChild(option({ value: m.id }, m.label || m.id));
            });
            this._modelSelectEl.value = this._modelId || "";
            this._modelSelectEl.disabled = false;
        } catch (error) {
            console.error("Failed to refresh models:", error);
            this._models = [];
            this._modelId = null;
            this._modelSelectEl.innerHTML = "";
            this._modelSelectEl.appendChild(option({ value: "" }, "No models"));
            this._modelSelectEl.value = "";
            this._modelSelectEl.disabled = true;
        }
        this._updateAttachmentCapabilityState();
    }

    async _onModelChange(modelId: string): Promise<void> {
        const nextModelId = modelId || null;
        const previousModelId = this._modelId;

        this._modelId = nextModelId;
        this._updateAttachmentCapabilityState();

        if (!nextModelId || nextModelId === previousModelId) {
            return;
        }

        if (!this._providerId) {
            this._updateSessionPickerState();
            return;
        }

        if (!this._isReady()) {
            this._setStatus("Model changed. Finish provider setup to start a new chat session.");
            this._updateInputState({ keepStatus: true });
            return;
        }

        this._setStatus("Model changed. Creating a new chat session…");
        await this._handleNewSession({ successStatus: "Model changed. New chat session created." });
    }

    _showChatView(): void {
        this._viewMode = "chat";
        this._chatViewEl?.classList.remove("hidden");
        this._sessionsViewEl?.classList.add("hidden");
    }

    _showSessionsView(): void {
        if (!this._providerId || !this.chatService?.getProvider(this._providerId)) {
            this._setStatus("Select a provider to browse chat sessions.");
            return;
        }

        this._viewMode = "sessions";
        this._chatViewEl?.classList.add("hidden");
        this._sessionsViewEl?.classList.remove("hidden");
    }

    _updateSessionTitle(session?: ChatSession | null): void {
        const activeId = session?.id || this.chatService.getActiveSessionId();
        const resolved = session || this._sessions.find((s) => s.id === activeId) || null;
        if (this._sessionTitleEl) {
            this._sessionTitleEl.textContent = resolved?.title || "No active session";
            this._sessionTitleEl.setAttribute("title", resolved?.id ? "Click to rename this chat session" : "No active session");
            this._sessionTitleEl.classList.toggle("cursor-pointer", !!resolved?.id);
            this._sessionTitleEl.classList.toggle("hover:underline", !!resolved?.id);
            this._sessionTitleEl.setAttribute("aria-disabled", resolved?.id ? "false" : "true");
        }
    }

    create(): HTMLElement {
        this._displayModeSelectEl = select({
                class: "select select-sm select-bordered w-full",
                onchange: (e: Event) => {
                    this._displayMode = ((e.target as HTMLSelectElement).value as any) || "user-friendly";
                    this._messageList?.setDisplayMode(this._displayMode);
                },
            },
            option({ value: "user-friendly" }, "User-friendly"),
            option({ value: "all" }, "All history")
        ) as HTMLSelectElement;
        this._displayModeSelectEl.value = this._displayMode;

        this._personalitySelectEl = select({
            class: "select select-sm select-bordered w-full",
            onchange: (e: Event) => this._onPersonalityChange((e.target as HTMLSelectElement).value),
        }) as HTMLSelectElement;

        this._providerSelectEl = select({
            class: "select select-sm select-bordered max-w-[12rem]",
            onchange: (e: Event) => { void this._onProviderChange((e.target as HTMLSelectElement).value); },
        }) as HTMLSelectElement;

        this._modelSelectEl = select({
            class: "select select-sm select-bordered flex-1 min-w-0",
            onchange: (e: Event) => { void this._onModelChange((e.target as HTMLSelectElement).value); },
        }) as HTMLSelectElement;
        this._modelSelectEl.appendChild(option({ value: "" }, "No models"));
        this._modelSelectEl.disabled = true;

        this._loginBtn = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: "Log in", disabled: "" },
                onClick: () => this._handleLoginClick(),
            },
            new FAIcon({ name: "fa-right-to-bracket" }),
            span("Login")
        );

        this._sessionPicker = new ChatSessionPicker({
            onSelect: (sessionId) => { void this._handleSessionSelection(sessionId); },
            onRename: (sessionId) => { void this._handleRenameSession(sessionId); },
            onDelete: (sessionId) => { void this._handleDeleteSession(sessionId); },
        });

        this._attachmentBar = new ChatAttachmentBar({
            onFilesSelected: (files) => { void this._handleFilesSelected(files); },
            onScreenshot: () => { void this._handleAttachScreenshot(); },
        });

        this._messageList = new ChatMessageList({
            id: this.id + "-messages",
            markdownEnabled: this.options?.markdownEnabled !== false,
            sanitizeConfig: this._sanitizeConfig,
            displayMode: this._displayMode,
            extractScriptFromAssistantMessage: (message) => this.chat?.extractScriptFromAssistantMessage?.(message),
        });

        const headerRow = div(
            { class: "flex items-center justify-between gap-2 px-2 py-1 border-b border-base-300 bg-base-200" },
            div(
                { class: "flex items-center gap-2 min-w-0" },
                new FAIcon({ name: "fa-comments" }).create(),
                span({ class: "font-semibold text-xs truncate" }, "Pathology Assistant")
            ),
            div(
                { class: "flex items-center gap-2 shrink-0" },
                this._providerSelectEl,
                this._loginBtn.create()
            )
        );

        this._statusEl = span({ class: "text-[11px] text-base-content/70 truncate" }) as HTMLElement;
        this._sessionTitleEl = span({
            class: "truncate flex-1 text-[12px] font-medium",
            title: "No active session",
            tabindex: 0,
            role: "button",
            onclick: () => {
                const sessionId = this.chatService.getActiveSessionId();
                if (sessionId) {
                    void this._handleRenameSession(sessionId);
                }
            },
            onkeydown: (e: KeyboardEvent) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                const sessionId = this.chatService.getActiveSessionId();
                if (!sessionId) return;
                e.preventDefault();
                void this._handleRenameSession(sessionId);
            },
        }, "No active session") as HTMLElement;

        this._sessionsBtnEl = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: "Open session manager" },
                onClick: () => this._showSessionsView(),
            },
            new FAIcon({ name: "fa-comments" }),
            span("Sessions")
        ).create();

        const consentBtn = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { base: "btn btn-xs btn-square" },
                extraProperties: { title: "Consent and chat settings" },
                onClick: () => this._openSettingsDialog(),
            },
            new FAIcon({ name: "fa-shield-halved" })
        ).create();

        const sessionBar = div(
            { class: "px-2 py-1 border-b border-base-200 bg-base-100 flex items-center gap-2" },
            this._sessionsBtnEl,
            this._sessionTitleEl,
            consentBtn,
        );

        this._chatViewEl = div(
            { class: "flex-1 min-h-0 flex flex-col" },
            this._messageList.create(),
        ) as HTMLElement;

        const sessionsBackBtn = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { base: "btn btn-xs" },
                onClick: () => this._showChatView(),
            },
            new FAIcon({ name: "fa-arrow-left" }),
            span("Back")
        ).create();

        this._sessionsNewBtnEl = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: "Start a new chat session" },
                onClick: () => { void this._handleNewSession(); },
            },
            new FAIcon({ name: "fa-plus" }),
            span("New")
        ).create();

        this._sessionsViewEl = div(
            { class: "hidden flex-1 min-h-0 flex flex-col bg-base-100" },
            div(
                { class: "px-2 py-2 border-b border-base-200 flex items-center justify-between gap-2" },
                div(
                    { class: "flex items-center gap-2 min-w-0" },
                    sessionsBackBtn,
                    span({ class: "font-semibold text-sm truncate" }, "Sessions"),
                ),
                this._sessionsNewBtnEl,
            ),
            div(
                { class: "p-2 overflow-auto w-full" },
                this._sessionPicker.create(),
            ),
        ) as HTMLElement;

        this._inputEl = textarea({
            class: "textarea textarea-bordered textarea-sm w-full resize-none pr-12",
            rows: 4,
            placeholder: "Ask something or request an automation…",
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._handleSend(e);
            },
        }) as HTMLTextAreaElement;

        this._sendBtnLabelEl = span("Send") as HTMLElement;
        this._sendBtnEl = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-sm" },
                extraProperties: { title: "Send message" },
                onClick: (e: Event) => this._isRunning ? this._handleStop(e) : this._handleSend(e),
            },
            new FAIcon({ name: "fa-paper-plane" }),
            this._sendBtnLabelEl
        ).create();

        // Transparent click-catcher shown over the input while chatting is not yet
        // available. A disabled <textarea> swallows pointer events, so we cannot
        // listen on it directly — this overlay lets a click on the "disabled" input
        // open whichever setup step is still pending (provider / login / consent).
        this._inputOverlayEl = div({
            class: "absolute inset-0 z-20 cursor-pointer hidden",
            role: "button",
            tabindex: 0,
            title: "Complete chat setup to start messaging.",
            "aria-label": "Complete chat setup to start messaging.",
            onclick: () => this._promptCompleteSetup(),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                this._promptCompleteSetup();
            },
        }) as HTMLElement;

        const inputWrap = div(
            { class: "relative" },
            this._inputEl,
            div({ class: "absolute top-2 right-2" }, this._attachmentBar.create()),
            this._inputOverlayEl,
        );

        const composer = div(
            { class: "border-t border-base-300 bg-base-100 px-2 py-2 flex flex-col gap-2" },
            inputWrap,
            div(
                { class: "flex items-center gap-2" },
                this._modelSelectEl,
                this._sendBtnEl,
            ),
            div(
                { class: "flex items-center justify-between text-[10px] gap-2" },
                this._statusEl,
                span({ class: "shrink-0 text-base-content/60" }, "Ctrl+Enter to send")
            )
        );

        this._settingsContentEl = this._buildSettingsContent();

        const root = div(
            { ...this.commonProperties, ...this.extraProperties },
            headerRow,
            sessionBar,
            this._chatViewEl,
            this._sessionsViewEl,
            composer,
        ) as HTMLElement;

        this._root = root;
        this.refreshProviders();
        this.refreshPersonalities();
        this._messageList.setMessages(this._messages);
        this._updateSessionTitle(null);
        this._setStatus("Select a provider to start.");
        this._updateInputState();
        this.refreshScriptConsent();
        this._updateSessionPickerState();
        return root;
    }

    addMessage(msg: ChatMessage): void {
        const normalized = { ...msg, createdAt: msg.createdAt || new Date() };
        this._messages.push(normalized);
        this._messageList?.addMessage(normalized);
    }

    clearMessages(): void {
        this._messages = [];
        this._messageList?.clear();
    }

    _updateSessionPickerState(): void {
        const hasProvider = !!(this._providerId && this.chatService?.getProvider(this._providerId));
        const disableSessionActions = !hasProvider || this._isRunning;

        this._sessionPicker?.setDisabled(disableSessionActions);
        if (this._sessionsBtnEl) this._sessionsBtnEl.disabled = !hasProvider;
        if (this._sessionsNewBtnEl) this._sessionsNewBtnEl.disabled = disableSessionActions;

        if (!hasProvider && this._viewMode === "sessions") {
            this._showChatView();
        }
    }

    _getCurrentModelInfo(): ChatProviderModelInfo | null {
        return this._models.find((m) => m.id === this._modelId) || null;
    }

    _getCurrentViewerContextId(): string | null {
        return this.chat?.getActiveChatContextId?.() || null;
    }

    refreshScriptConsent(): void {
        if (!this._settingsContentEl) return;

        const content = this._settingsContentEl.querySelector("[data-script-consent-list]") as HTMLElement | null;
        if (!content) return;

        const chatModule = this.chat;
        const entries = chatModule?.getScriptConsentEntries?.() || {};

        content.innerHTML = "";
        this._scriptConsentCheckboxes = new Map();
        this._scriptConsentGrantAllEl = null;
        const allEntries = Object.entries(entries);

        if (!allEntries.length) {
            content.appendChild(div({ class: "text-xs text-base-content/70 italic" }, "No scripting namespaces are currently available."));
            return;
        }

        // Toggle all
        const allGranted = allEntries.every(([_, value]: [string, any]) => value.granted);

        const toggleAllWrap = div({ class: "pb-2 mb-2 border-b border-base-200" });
        const toggleAllCheckbox = input({
            id: "chat-namespace-consent-grant-all",
            type: "checkbox",
            class: "checkbox checkbox-sm align-middle",
            checked: allGranted,
            onchange: (e: Event) => {
                const checked = !!((e.target as HTMLInputElement).checked);
                allEntries.forEach(([namespace]) => {
                    chatModule?.setScriptNamespaceConsent?.(namespace, checked);
                });
                // Update individual checkboxes in place (preserves scroll position)
                this.syncScriptConsentState();
            }
        }) as HTMLInputElement;
        this._scriptConsentGrantAllEl = toggleAllCheckbox;

        toggleAllWrap.appendChild(toggleAllCheckbox);
        toggleAllWrap.appendChild(label({ for: "chat-namespace-consent-grant-all" }, "  ", "Grant all"));
        content.appendChild(toggleAllWrap);

        const consentsWrap = div({ class: "max-h-[15rem] overflow-x-auto" });
        allEntries.forEach(([namespace, value]: [string, ScriptConsentEntry]) => {
            const wrapper = div({ class: "flex flex-row gap-1 mt-2" });

            const rowCheckbox = input({
                id: "chat-namespace-consent-" + namespace,
                type: "checkbox",
                class: "checkbox checkbox-sm self-center mr-1",
                checked: value.granted,
                onchange: (e: Event) => {
                    const checked = !!((e.target as HTMLInputElement).checked);
                    chatModule?.setScriptNamespaceConsent?.(namespace, checked);
                }
            }) as HTMLInputElement;
            this._scriptConsentCheckboxes.set(namespace, rowCheckbox);
            wrapper.appendChild(rowCheckbox);
            if (value.description) {
                wrapper.appendChild(label({
                    style: "display: flex; flex-direction: column; gap: 0.25rem; flex: 1; pl-1",
                    for: "chat-namespace-consent-" + namespace,
                }, value.title, span({ class: "text-[11px] text-base-content/70" }, value.description)));
            }
            consentsWrap.appendChild(wrapper);
        });
        content.appendChild(consentsWrap);
    }

    /**
     * Reflect current grant state onto the existing consent checkboxes without
     * rebuilding the DOM (preserves scroll position). Falls back to a full
     * rebuild only when the set of namespaces changed (membership change).
     */
    syncScriptConsentState(): void {
        if (!this._settingsContentEl) return;

        const entries = this.chat?.getScriptConsentEntries?.() || {};
        const allEntries = Object.entries(entries);

        // Membership changed (added/removed namespace) → structural rebuild needed.
        if (allEntries.length !== this._scriptConsentCheckboxes.size
            || allEntries.some(([namespace]) => !this._scriptConsentCheckboxes.has(namespace))) {
            this.refreshScriptConsent();
            return;
        }

        for (const [namespace, value] of allEntries) {
            const checkbox = this._scriptConsentCheckboxes.get(namespace);
            if (checkbox) checkbox.checked = !!value.granted;
        }
        if (this._scriptConsentGrantAllEl) {
            this._scriptConsentGrantAllEl.checked = allEntries.every(([_, value]: [string, any]) => value.granted);
        }
    }

    _setStatus(text: string | null | undefined): void {
        if (this._statusEl) this._statusEl.textContent = text || "";
    }

    _isReady(): boolean {
        if (!this._providerId || !this.chatService) return false;
        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return false;
        if (provider.requiresLogin !== false && !this.chatService.isAuthenticated(this._providerId)) return false;
        const hasModel = !!this._modelId || this._models.length > 0;
        if (!hasModel) return false;
        return this._consentConfigured;
    }

    _updateInputState({ keepStatus = false }: { keepStatus?: boolean } = {}): void {
        const ready = this._isReady();
        if (this._inputEl) this._inputEl.disabled = !ready;
        if (this._inputOverlayEl) this._inputOverlayEl.classList.toggle("hidden", ready || this._isRunning);
        if (this._sendBtnEl) this._sendBtnEl.disabled = this._isRunning ? false : !ready;
        if (this._sendBtnLabelEl) this._sendBtnLabelEl.textContent = this._isRunning ? "Stop" : "Send";
        if (this._sendBtnEl) this._sendBtnEl.title = this._isRunning ? "Stop the current response" : "Send message";
        this._attachmentBar?.setDisabled(!ready || this._isRunning);
        this._sessionPicker?.setDisabled(!this._providerId || this._isRunning);
        if (this._modelSelectEl) this._modelSelectEl.disabled = this._isRunning || !this._providerId || !this._models.length;
        if (this._providerSelectEl) this._providerSelectEl.disabled = this._isRunning;
        if (this._personalitySelectEl) this._personalitySelectEl.disabled = this._isRunning;
        if (this._displayModeSelectEl) this._displayModeSelectEl.disabled = this._isRunning;

        if (!keepStatus) {
            if (this._isRunning) {
                this._setStatus(this._stopRequested ? "Stopping…" : "Waiting for the assistant…");
            } else if (!this._providerId) {
                this._setStatus("Select a provider to start.");
            } else if (!ready) {
                const provider = this.chatService.getProvider(this._providerId);
                if (provider?.requiresLogin !== false && !this.chatService.isAuthenticated(this._providerId)) {
                    this._setStatus("Login required before chatting.");
                } else {
                    this._setStatus("Review chat settings before chatting.");
                }
            } else if (this.chatService.getActiveSessionId()) {
                this._setStatus("Ready.");
            } else {
                this._setStatus("Ready. Start a new chat or send a message to begin.");
            }
        }
        this._updateAttachmentCapabilityState();
    }

    /**
     * Invoked when the user clicks the chat input while it is disabled because the
     * provider is not fully set up. Opens whichever step is still pending — provider
     * selection, login, or the consent/settings dialog — so the user knows what to
     * complete before chatting.
     */
    _promptCompleteSetup(): void {
        if (this._isRunning || this._isReady() || !this.chatService) return;

        // 1) No provider selected yet — guide the user to the provider picker.
        const provider = this._providerId ? this.chatService.getProvider(this._providerId) : null;
        if (!provider) {
            this._setStatus("Select a provider to start.");
            this._providerSelectEl?.focus();
            try { (this._providerSelectEl as any)?.showPicker?.(); } catch (_) {}
            return;
        }

        // 2) Login required but not authenticated yet.
        const requiresLogin = provider.requiresLogin !== false;
        if (requiresLogin && !this.chatService.isAuthenticated(this._providerId!)) {
            void this._handleLoginClick();
            return;
        }

        // 3) Provider returned no usable models.
        if (!this._modelId && !this._models.length) {
            this._setStatus("The selected provider has no available models.");
            return;
        }

        // 4) Consent/settings not reviewed yet — open the settings dialog.
        if (!this._consentConfigured) {
            this._openSettingsDialog();
            return;
        }
    }

    _updateLoginButtonState(): void {
        if (!this._loginBtn || !this.chatService) return;

        if (!this._providerId) {
            // No provider chosen yet — there is nothing to log into, so keep the
            // button hidden rather than showing a disabled login affordance.
            this._loginBtn.setExtraProperty("disabled", "disabled");
            this._loginBtn.toggleClass("hidden", "hidden", true);
            return;
        }

        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) {
            // Provider list not resolved yet — hide until we know its auth mode.
            this._loginBtn.disabled = true;
            this._loginBtn.toggleClass("hidden", "hidden", true);
            return;
        }

        const requiresLogin = provider.requiresLogin !== false;
        if (!requiresLogin) {
            this._loginBtn.disabled = true;
            this._loginBtn.toggleClass("hidden", "hidden", true);
            return;
        }

        const authed = this.chatService.isAuthenticated(this._providerId);
        this._loginBtn.setExtraProperty("disabled", false as any);
        this._loginBtn.toggleClass("hidden", "hidden", authed);
    }

    _buildSettingsContent(): HTMLElement {
        const scriptConsentList = div({
            class: "flex flex-col gap-2 max-h-48 overflow-y-auto pr-1 border border-base-200 rounded p-2",
            "data-script-consent-list": ""
        });

        const applyBtn = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-sm" },
                extraProperties: { title: "Save settings" },
                onClick: () => { void this._applySettingsAndContinue(); },
            },
            new FAIcon({ name: "fa-check" }).create(),
            span("Save")
        ).create();

        return div(
            { class: "w-full max-w-lg p-4 flex flex-col gap-4" },
            div(
                { class: "flex items-center justify-between gap-2" },
                div(
                    { class: "flex items-center gap-2" },
                    new FAIcon({ name: "fa-shield-halved" }).create(),
                    span({ class: "font-semibold text-lg" }, "Consent & settings")
                )
            ),
            span(
                { class: "text-[11px] text-base-content/80" },
                "Configure the model personality, verbosity and viewer control access."
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, "Personality"),
                this._personalitySelectEl || div()
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, "Display"),
                this._displayModeSelectEl || div()
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, "Allowed scripting namespaces"),
                scriptConsentList
            ),
            div({ class: "flex items-center justify-end gap-2" }, applyBtn)
        ) as HTMLElement;
    }

    async _onProviderChange(providerId: string): Promise<void> {
        this._providerId = providerId || null;
        this.chatService.setActiveSessionId(null);
        this._sessions = [];
        this._modelId = null;
        this.clearMessages();
        this._sessionPicker?.setSessions([], null);
        this._updateSessionTitle(null);
        this._updateLoginButtonState();
        this._updateSessionPickerState();
        await this._refreshModelsForCurrentProvider();

        if (!providerId) {
            this._consentConfigured = false;
            this._setStatus("Select a provider to start.");
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        const provider = this.chatService?.getProvider(providerId);
        if (!provider) {
            this._consentConfigured = false;
            this._setStatus("Unknown provider.");
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        const requiresLogin = provider.requiresLogin !== false;
        const authed = this.chatService.isAuthenticated(providerId);

        if (requiresLogin && !authed) {
            this._consentConfigured = false;
            this._setStatus("Provider selected. Please log in first.");
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        this._consentConfigured = false;
        this._updateSessionPickerState();
        this._openSettingsDialog();
    }

    async _handleLoginClick(): Promise<void> {
        if (!this._providerId || !this.chatService) return;
        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return;

        try {
            this._setStatus("Logging in…");
            this._loginBtn?.toggleClass?.("loading", "loading", true);
            await this.chatService.login(this._providerId);
            this._setStatus("Login successful. Review chat settings to continue.");
            this._openSettingsDialog();
        } catch (err) {
            console.error("ChatPanel login failed:", err);
            this._consentConfigured = false;
            this._closeSettingsDialog();
            this._setStatus("Login failed. Please try again. See console for details.");
        } finally {
            this._loginBtn?.toggleClass?.("loading", "loading", false);
            this._updateInputState({ keepStatus: true });
            this._updateLoginButtonState();
        }
    }

    _openSettingsDialog(): void {
        this.chat?.refreshScriptConsentFromManager?.();
        this.refreshScriptConsent();

        if (!this._settingsContentEl) return;

        if (!this._settingsModal) {
            this._settingsModal = new (globalThis as any).UI.Modal({
                header: null,
                body: this._settingsContentEl,
                footer: null,
                width: "min(560px, 92vw)",
                isBlocking: true,
                allowClose: true,
                allowResize: false,
                destroyOnClose: false,
                onClose: () => {
                    // keep instance/content for reuse
                },
            });

            USER_INTERFACE.addHtml(this._settingsModal, "vercel-ai-chat-sdk");
        } else if (!this._settingsModal.root?.parentNode) {
            USER_INTERFACE.addHtml(this._settingsModal, "vercel-ai-chat-sdk");
        }

        this._settingsModal.open();
    }

    _closeSettingsDialog(): void {
        this._settingsModal?.close?.();
    }

    async _applySettingsAndContinue(): Promise<void> {
        this._consentConfigured = true;
        this._closeSettingsDialog();
        this._updateInputState();
        this._updateSessionPickerState();
        await this._refreshSessionsForCurrentProvider({ autoLoadLatest: true });
    }

    async _refreshSessionsForCurrentProvider({ autoLoadLatest = false }: { autoLoadLatest?: boolean } = {}): Promise<void> {
        if (!this._providerId || !this.chatService) {
            this._sessions = [];
            this._sessionPicker?.setSessions([], null);
            this._sessionPicker?.setDisabled(true);
            this._updateSessionTitle(null);
            return;
        }

        this._updateSessionPickerState();

        try {
            const sessions = await this.chatService.listSessions(this._providerId);
            this._sessions = sessions;

            const currentActive = this.chatService.getActiveSessionId();
            const active = currentActive && sessions.some((s) => s.id === currentActive)
                ? currentActive
                : null;

            this._sessionPicker?.setSessions(sessions, active);

            if (active) {
                await this._loadSession(active);
                return;
            }

            if (autoLoadLatest && sessions.length) {
                await this._loadSession(sessions[0]!.id);
                return;
            }

            this.chatService.setActiveSessionId(null);
            this._sessionPicker?.setActiveSession(null);
            this._updateSessionTitle(null);
            this.clearMessages();
            this._setStatus("Ready. Start a new chat or choose an existing session.");
        } catch (error) {
            console.error("Failed to refresh sessions:", error);
            this._setStatus("Failed to load chat sessions.");
        }
    }

    _isHiddenInternalMessage(message: ChatMessage | null | undefined): boolean {
        const metadata = (message as any)?.metadata || {};
        return metadata.hiddenFromChatUi === true || metadata.internalSource === 'script-runtime';
    }

    _getVisibleMessages(messages: ChatMessage[]): ChatMessage[] {
        return (messages || []).filter((message) => !this._isHiddenInternalMessage(message));
    }

    _pushInternalMessage(message: ChatMessage): void {
        this._messages.push(message);
        this._messageList?.addMessage(message);
    }

    _truncateInternalText(value: string, limit = 4000): string {
        if (value.length <= limit) return value;
        return `${value.slice(0, limit)}\n\n[truncated to ${limit} characters by chat panel]`;
    }

    _stripAssistantReasoning(text: string): string {
        return String(text || "")
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    _oneLineErrorSummary(text: string): string {
        const firstLine = String(text || "").split(/\r?\n/, 1)[0]?.trim() || "Repeated script execution failures.";
        return firstLine.length > 220 ? firstLine.slice(0, 217) + "…" : firstLine;
    }

    // Library-noise: getSchema()/getVisualizations() trip the FlexRenderer "published examples failed validation"
    // path on every call. Don't burn the failure budget on it. Track upstream patch B4 in
    // docs/patches/flex-renderer-llm-schema.md; remove this guard once patched.
    _isLibraryNoiseScriptFailure(executionMessage: ChatMessage | null | undefined): boolean {
        const message = String(
            (executionMessage as any)?.metadata?.scriptError?.message ||
            (executionMessage as any)?.content ||
            ""
        );
        return /published examples failed validation/i.test(message);
    }

    _makeHiddenInternalMessage(role: "user" | "assistant", text: string, metadata: Record<string, unknown> = {}): ChatMessage {
        return {
            role,
            content: text,
            parts: [{
                type: "host-feedback",
                text,
            } as any],
            metadata: {
                hiddenFromChatUi: true,
                ...metadata,
            } as any,
            createdAt: new Date(),
        };
    }

    _createAssistantScriptPlaceholder(reply: ChatMessage): ChatMessage {
        const fallback = "Prepared a viewer automation step from the current request and prior runtime feedback.";
        const extracted = this.chat?.extractAssistantTextWithoutScript?.(reply) || "";
        const stripped = this._stripAssistantReasoning(extracted);
        const hasRealProse = !!stripped;
        const text = this._truncateInternalText(stripped || fallback, 800);

        return {
            role: "assistant",
            content: text,
            parts: [{ type: "text", text }],
            metadata: hasRealProse ? {} as any : {
                hiddenFromChatUi: true,
                internalSource: "assistant-script-placeholder",
            } as any,
            createdAt: reply.createdAt || new Date(),
        };
    }

    _buildScriptFailureFeedback(executionMessage: ChatMessage): ChatMessage {
        const metadata = (executionMessage as any)?.metadata || {};
        const structured = metadata?.scriptError || null;
        const coupling = structured?.couplingViolation || null;
        const ajvErrors = Array.isArray(structured?.ajvErrors) ? structured.ajvErrors : [];
        const details: string[] = [];

        if (coupling) {
            details.push(`coupling: ${coupling.coupling || "unknown"}`);
            if (coupling.layerType) details.push(`layerType: ${coupling.layerType}`);
            if (coupling.layerPath) details.push(`layerPath: ${coupling.layerPath}`);
            if (coupling.expected !== undefined) details.push(`expected: ${JSON.stringify(coupling.expected)}`);
            if (coupling.actual !== undefined) details.push(`actual: ${JSON.stringify(coupling.actual)}`);
            if (Array.isArray(coupling.controls) && coupling.controls.length) {
                details.push(`controls: ${JSON.stringify(coupling.controls)}`);
            }
        }

        if (ajvErrors.length) {
            details.push(`ajvErrors: ${JSON.stringify(ajvErrors)}`);
        }

        const errorText = executionMessage.content || "Script execution failed.";
        const feedbackText = [
            "Script execution failed.",
            `Error: ${errorText}`,
            details.length ? `Structured details:\n${details.join("\n")}` : null,
            "Do not guess field names or methods. Use only fields explicitly shown in the allowed API. If required information is missing, ask a brief clarification question.",
        ].filter(Boolean).join("\n");

        const incomingParts = Array.isArray(executionMessage.parts) ? executionMessage.parts : [];
        const visibleScriptResultParts = incomingParts.filter((p: any) => p?.type === "script-result");

        return {
            role: "tool",
            content: feedbackText,
            parts: [
                ...visibleScriptResultParts,
                { type: "host-feedback", text: feedbackText } as any,
            ],
            metadata: {
                scriptError: structured,
            } as any,
            createdAt: new Date(),
        };
    }

    async _loadSession(sessionId: string): Promise<void> {
        try {
            const hydration = await this.chatService.loadSession(sessionId);
            this._messages = (hydration.messages || []).map((m) => ({ ...m, createdAt: m.createdAt || new Date() }));
            this._messageList?.setMessages(this._messages);
            this._sessionPicker?.setActiveSession(hydration.session.id);
            this._updateSessionTitle(hydration.session);

            if (hydration.session.personalityId && this.chatService.getPersonality(hydration.session.personalityId)) {
                this._personalityId = hydration.session.personalityId;
                this.chatService.setPersonality(hydration.session.personalityId);
                if (this._personalitySelectEl) this._personalitySelectEl.value = hydration.session.personalityId;
            }

            if (hydration.session.modelId) {
                await this._refreshModelsForCurrentProvider(hydration.session.modelId);
            }

            this._showChatView();
            this._setStatus(`Loaded session: ${hydration.session.title}`);
        } catch (error) {
            console.error("Failed to load session:", error);
            this._setStatus("Failed to load the selected session.");
        }
    }

    async _handleSessionSelection(sessionId: string | null): Promise<void> {
        if (!sessionId) {
            this.chatService.setActiveSessionId(null);
            this.clearMessages();
            this._updateSessionTitle(null);
            this._setStatus("Ready. Start a new chat or choose an existing session.");
            return;
        }
        await this._loadSession(sessionId);
    }

    async _ensureActiveSession(
        options: { showChatView?: boolean; preserveMessages?: boolean } = {}
    ): Promise<string> {
        const { showChatView = true, preserveMessages = false } = options;

        const current = this.chatService.getActiveSessionId();
        if (current) return current;
        if (!this._providerId) throw new Error("Select a provider first.");

        const modelId = this._modelId || this._models[0]?.id || (await this.chatService.listModels(this._providerId))[0]?.id;
        if (!modelId) throw new Error(`Provider '${this._providerId}' did not return any models.`);

        this._setStatus("Creating new chat session…");

        const session = await this.chatService.createSession({
            providerId: this._providerId,
            modelId,
            personalityId: this._personalityId,
            contextId: this.chatService.getProvider(this._providerId)?.contextId || null,
            metadata: {
                viewerContextId: this._getCurrentViewerContextId(),
            },
        });

        this._modelId = session.modelId || modelId;
        if (this._modelSelectEl) this._modelSelectEl.value = this._modelId || "";
        this._sessions = [session, ...this._sessions.filter((s) => s.id !== session.id)];
        this._sessionPicker?.setSessions(this._sessions, session.id);
        this._updateSessionTitle(session);

        if (!preserveMessages) {
            this.clearMessages();
        }

        this._updateSessionPickerState();

        if (showChatView) {
            this._showChatView();
        }

        this._setStatus("New chat ready.");
        return session.id;
    }

    async _handleNewSession(options: { successStatus?: string } = {}): Promise<void> {
        if (!this._isReady()) {
            this._updateInputState();
            return;
        }

        try {
            this._setStatus("Creating new chat session…");
            this.chatService.setActiveSessionId(null);
            this.clearMessages();
            await this._ensureActiveSession({ showChatView: true });
            this._setStatus(options.successStatus || "New chat session created.");
        } catch (error) {
            console.error("Failed to create a new session:", error);
            this._setStatus("Failed to start a new chat session.");
        } finally {
            this._updateSessionPickerState();
        }
    }

    async _handleRenameSession(sessionId: string | null): Promise<void> {
        if (!sessionId) return;
        const current = this._sessions.find((s) => s.id === sessionId);
        const nextTitle = window.prompt("Rename chat session", current?.title || "")?.trim();
        if (!nextTitle) return;

        try {
            await this.chatService.renameSession(sessionId, nextTitle);
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
            this._sessionPicker?.setActiveSession(sessionId);
            this._updateSessionTitle(this._sessions.find((s) => s.id === sessionId) || null);
            this._setStatus("Chat session renamed.");
        } catch (error) {
            console.error("Failed to rename session:", error);
            this._setStatus("Failed to rename chat session.");
        }
    }

    async _handleDeleteSession(sessionId: string | null): Promise<void> {
        if (!sessionId) return;
        const current = this._sessions.find((s) => s.id === sessionId);
        if (!window.confirm(`Delete chat session "${current?.title || sessionId}"?`)) return;

        try {
            await this.chatService.deleteSession(sessionId);
            if (this.chatService.getActiveSessionId() === sessionId) {
                this.chatService.setActiveSessionId(null);
                this.clearMessages();
                this._updateSessionTitle(null);
            }
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: true });
            this._setStatus("Chat session deleted.");
        } catch (error) {
            console.error("Failed to delete session:", error);
            this._setStatus("Failed to delete chat session.");
        }
    }

    async _handleFilesSelected(files: FileList | File[]): Promise<void> {
        const model = this._getCurrentModelInfo();
        const caps = model?.capabilities;

        const onlyImages = Array.from(files as any as File[]).every((f: File) =>
            String(f.type || '').startsWith('image/')
        );

        if (onlyImages && caps?.images === 'unsupported') {
            this._setStatus("Screenshot/image upload unavailable for this model.");
            return;
        }

        if (!onlyImages && caps?.files === 'unsupported') {
            this._setStatus("File upload unavailable for this model.");
            return;
        }

        if (!this._isReady()) {
            this._updateInputState();
            return;
        }

        try {
            const sessionId = await this._ensureActiveSession();
            const items = Array.from(files as any as File[]);
            for (const file of items) {
                const attachment = await this.chatService.uploadAttachment({ sessionId, file, name: file.name });
                await this.chatService.attachUploadedFileAsMessage({ sessionId, attachment, role: "user" });
                this.addMessage(this._messageFromAttachment(attachment));
            }
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
            this._sessionPicker?.setActiveSession(sessionId);
            this._updateSessionTitle(this._sessions.find((s) => s.id === sessionId) || null);
            this._setStatus("Attachment added to the current chat.");
        } catch (error) {
            console.error("Failed to upload attachment:", error);
            this._pushErrorBubble("The file could not be attached.", error);
            this._setStatus("Attachment failed.");
        }
    }

    async _handleAttachScreenshot(): Promise<void> {
        const caps = this._getCurrentModelInfo()?.capabilities;
        if (caps?.images === 'unsupported') {
            this._setStatus("Screenshot unavailable for this model.");
            return;
        }

        if (!this._isReady()) {
            this._updateInputState();
            return;
        }

        try {
            const sessionId = await this._ensureActiveSession();
            const blob = await this._captureViewerScreenshotBlob();
            const attachment = await this.chatService.uploadAttachment({
                sessionId,
                file: blob,
                name: `viewer-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
                kind: "screenshot",
                metadata: { source: "viewer" },
            });
            await this.chatService.attachUploadedFileAsMessage({ sessionId, attachment, role: "user" });
            this.addMessage(this._messageFromAttachment(attachment));
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
            this._sessionPicker?.setActiveSession(sessionId);
            this._updateSessionTitle(this._sessions.find((s) => s.id === sessionId) || null);
            this._setStatus("Screenshot attached to the current chat.");
        } catch (error) {
            console.error("Failed to attach screenshot:", error);
            this._pushErrorBubble("The screenshot could not be attached.", error);
            this._setStatus("Screenshot failed.");
        }
    }

    _messageFromAttachment(attachment: ChatAttachmentRecord): ChatMessage {
        if (attachment.kind === "image" || attachment.kind === "screenshot") {
            return {
                role: "user",
                parts: [{
                    type: "image",
                    attachmentId: attachment.id,
                    mimeType: attachment.mimeType,
                    name: attachment.name,
                    dataUrl: attachment.dataUrl,
                    metadata: attachment.metadata,
                }],
                createdAt: new Date(),
            };
        }
        return {
            role: "user",
            parts: [{
                type: "file",
                attachmentId: attachment.id,
                mimeType: attachment.mimeType,
                name: attachment.name || attachment.id,
                dataUrl: attachment.dataUrl,
                metadata: attachment.metadata,
            }],
            createdAt: new Date(),
        };
    }

    _updateAttachmentCapabilityState(): void {
        const model = this._getCurrentModelInfo();
        const caps = model?.capabilities;

        const imagesUnsupported = caps?.images === 'unsupported';
        const filesUnsupported = caps?.files === 'unsupported';

        const screenshotAvailable = !imagesUnsupported;
        const fileAvailable = !filesUnsupported;

        this._attachmentBar?.setDisabled(!this._isReady());
        this._attachmentBar?.setAvailability({
            files: fileAvailable,
            screenshot: screenshotAvailable,
        });

        if (!this._isReady()) return;

        if (imagesUnsupported && filesUnsupported) {
            this._setStatus("Screenshot unavailable. File upload unavailable for this model.");
        } else if (imagesUnsupported) {
            this._setStatus("Screenshot unavailable for this model.");
        } else if (filesUnsupported) {
            this._setStatus("File upload unavailable for this model.");
        }
    }

    async _captureViewerScreenshotBlob(): Promise<Blob> {
        const manager = globalThis.VIEWER_MANAGER;
        const viewers = manager.viewers;
        const preferredViewerId = this._getCurrentViewerContextId();

        let viewer = preferredViewerId
            ? viewers.find((item: any) => item?.uniqueId === preferredViewerId)
            : null;

        if (!viewer) {
            viewer = globalThis.VIEWER;
        }

        const canvas: HTMLCanvasElement | undefined = viewer?.drawer?.canvas || viewer?.canvas;
        if (!canvas || typeof canvas.toBlob !== "function") {
            throw new Error("No active viewer screenshot is available.");
        }
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Failed to capture viewer screenshot."));
            }, "image/png");
        });
    }

    async _handleSend(event?: Event): Promise<void> {
        event?.preventDefault?.();

        if (this._isRunning) {
            this._handleStop(event);
            return;
        }

        if (!this._isReady() || !this._inputEl || !this.chatService || !this._providerId) {
            this._updateInputState();
            return;
        }

        const text = this._inputEl.value.trim();
        if (!text) return;

        const userMsg: ChatMessage = {
            role: "user",
            content: text,
            parts: [{ type: "text", text }],
            createdAt: new Date(),
        };

        this._inputEl.value = "";
        this._isRunning = true;
        this._stopRequested = false;
        this._turnAbortController = new AbortController();

        this.addMessage(userMsg); // show immediately

        this._updateInputState({ keepStatus: true });
        this._setStatus("Sending request…");

        try {
            await this._ensureActiveSession({ preserveMessages: true });
            await this._runAssistantLoop(this.MAX_SCRIPT_STEPS, this._turnAbortController.signal);

            if (!this._stopRequested) {
                await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
                this._sessionPicker?.setActiveSession(this.chatService.getActiveSessionId());
                this._updateSessionTitle(this._sessions.find((s) => s.id === this.chatService.getActiveSessionId()) || null);
                this._setStatus("Ready.");
            } else {
                this._setStatus("Stopped.");
            }
        } catch (err) {
            const detail = this._toErrorText(err, "The assistant could not complete this turn.");

            if (this.chatService?.isAbortError?.(err)) {
                if (this._stopRequested) {
                    this._setStatus("Stopped.");
                } else {
                    this._pushErrorBubble(
                        /timeout|timed out|deadline/i.test(detail)
                            ? "The request timed out."
                            : "The request was interrupted.",
                        err
                    );
                    this._setStatus("Turn failed.");
                }
            } else {
                console.error("Chat loop failed:", err);
                this._pushErrorBubble("The assistant could not complete this turn.", err);
                this._setStatus("Turn failed.");
            }
        } finally {
            this._isRunning = false;
            this._stopRequested = false;
            this._turnAbortController = null;
            this.chatService?.cancelActiveTurn?.();
            this._messageList?.removeProgress();
            this._updateInputState({ keepStatus: true });
        }
    }

    _handleStop(event?: Event): void {
        event?.preventDefault?.();
        if (!this._isRunning) return;

        this._stopRequested = true;
        this._setStatus("Stopping…");
        this._messageList?.updateProgress("Stopping…");
        this._turnAbortController?.abort("Stopped by user.");
        this.chatService?.cancelActiveTurn?.("Stopped by user.");
        this._updateInputState({ keepStatus: true });
    }

    _shouldStopAssistantLoop(): boolean {
        return !!this._stopRequested || !!this._turnAbortController?.signal?.aborted;
    }

    async _runAssistantLoop(maxSteps: number, signal?: AbortSignal): Promise<void> {
        const chatModule = this.chat;
        let allowedSteps = Math.max(1, Number(maxSteps || this.MAX_SCRIPT_STEPS || 12));
        let extensionsUsed = 0;
        let consecutiveSuccessfulScriptSteps = 0;
        let consecutiveFailedScriptSteps = 0;
        const maxConsecutiveFailedScriptSteps = 3;

        // Idempotent-loop guard: if the assistant emits the same script body and the runtime
        // returns the same observable result twice in a row, there is nothing further the loop
        // can produce. Break with a host-feedback nudge instead of looping indefinitely.
        let lastFingerprint: string | null = null;
        let identicalRepeatCount = 0;
        const fingerprintFor = (scriptBody: string, msg: ChatMessage): string => {
            const norm = String(scriptBody || '').replace(/\s+/g, ' ').trim();
            const resultText = String(msg?.content || '').slice(0, 4000);
            return `${norm}${resultText}`;
        };

        this._messageList?.showProgress("Understanding your request…");

        try {
            for (let step = 0; step < allowedSteps; step++) {
                if (this._shouldStopAssistantLoop()) return;

                this._setStatus(step === 0 ? "Sending…" : "Thinking…");

                const reply = await this.chatService.sendMessage(this._providerId!, this._messages.slice(), { signal });
                if (this._shouldStopAssistantLoop()) return;

                const script = chatModule.extractScriptFromAssistantMessage?.(reply);
                this._messages.push(reply);
                if (script) {
                    const placeholder = this._createAssistantScriptPlaceholder(reply);
                    if (!this._isHiddenInternalMessage(placeholder)) {
                        this._messageList?.addMessage(placeholder);
                    }
                }
                this._messageList?.updateProgress(this._friendlyProgress(reply, null, step));

                if (!script) {
                    this._messageList?.removeProgress();
                    this._messageList?.addMessage(reply);
                    return;
                }

                this._setStatus("Executing script…");

                let executionMessage: ChatMessage;
                let failedScript = false;
                try {
                    executionMessage = await chatModule.executeAssistantScript(script, { signal });
                    failedScript =
                        (executionMessage.parts || []).some((p: any) => p.type === "script-result" && p.ok === false);

                    if (failedScript) {
                        executionMessage = this._buildScriptFailureFeedback(executionMessage);
                    }
                } catch (err) {
                    failedScript = true;
                    const errorText = err instanceof Error ? err.message : String(err);
                    executionMessage = {
                        role: "tool",
                        content:
                            "Script execution failed.\n" +
                            `Error: ${errorText}\n` +
                            "Please correct the previous response and continue.",
                        parts: [{
                            type: "host-feedback",
                            text: `Script execution failed.\nError: ${errorText}\nPlease correct the previous response and continue.`,
                        }],
                        createdAt: new Date(),
                    };
                }

                if (this._shouldStopAssistantLoop()) return;

                const isLibraryNoiseFailure = this._isLibraryNoiseScriptFailure(executionMessage);

                if (failedScript) {
                    consecutiveSuccessfulScriptSteps = 0;
                    if (!isLibraryNoiseFailure) {
                        consecutiveFailedScriptSteps += 1;
                    }
                } else {
                    consecutiveSuccessfulScriptSteps += 1;
                    consecutiveFailedScriptSteps = 0;
                }

                this._pushInternalMessage(executionMessage);
                this._messageList?.updateProgress(this._friendlyProgress(reply, executionMessage, step));

                const fingerprint = fingerprintFor(script, executionMessage);
                if (fingerprint && fingerprint === lastFingerprint) {
                    identicalRepeatCount += 1;
                } else {
                    identicalRepeatCount = 0;
                    lastFingerprint = fingerprint;
                }
                if (identicalRepeatCount >= 1) {
                    const nudge =
                        "Identical script with identical result emitted twice in a row. " +
                        "The runtime has nothing further to produce from this script. " +
                        "Stop scripting and reply to the user with the result already obtained, " +
                        "or ask a clarifying question if more input is required.";
                    const guardMessage: ChatMessage = {
                        role: "tool",
                        content: nudge,
                        parts: [{ type: "host-feedback", text: nudge }],
                        metadata: {
                            hiddenFromChatUi: true,
                            internalSource: "script-runtime",
                            reason: "idempotent-loop-guard",
                        } as any,
                        createdAt: new Date(),
                    };
                    this._pushInternalMessage(guardMessage);
                }

                if (failedScript && consecutiveFailedScriptSteps >= maxConsecutiveFailedScriptSteps) {
                    const terminalError = String(executionMessage.content || "Repeated script execution failures.");
                    console.debug("[ChatPanel] repeated-script-failures terminal", terminalError);
                    const summaryLine = this._oneLineErrorSummary(terminalError);
                    const userText =
                        `The assistant tried ${maxConsecutiveFailedScriptSteps} times and stopped. ` +
                        `Last error: ${summaryLine} ` +
                        "Open the developer console for full details, or rephrase the request.";
                    const visibleMessage: ChatMessage = {
                        role: "assistant",
                        content: userText,
                        parts: [{ type: "text", text: userText }],
                        metadata: { uiVariant: "error", reason: "repeated-script-failures" } as any,
                        createdAt: new Date(),
                    };

                    this._messages.push(visibleMessage);
                    this._messageList?.removeProgress();
                    this._messageList?.addMessage(visibleMessage);
                    this._setStatus("Stopped after repeated script failures.");
                    return;
                }

                const isLastAllowedStep = step >= allowedSteps - 1;
                const canExtend = extensionsUsed < this.MAX_SCRIPT_STEP_EXTENSIONS;
                const shouldExtend =
                    isLastAllowedStep &&
                    canExtend &&
                    consecutiveSuccessfulScriptSteps >= this.MIN_SUCCESSFUL_PROGRESS_STEPS_BEFORE_EXTENSION;

                if (shouldExtend) {
                    allowedSteps += this.SCRIPT_STEP_EXTENSION_SIZE;
                    extensionsUsed += 1;
                    this._setStatus(`Continuing successful automation (${allowedSteps} total steps)…`);
                }
            }

            if (this._shouldStopAssistantLoop()) return;

            const capMessage: ChatMessage = {
                role: "tool",
                content: `Execution stopped after reaching the current limit of ${allowedSteps} script steps. Finish with a final user-facing answer without more scripting.`,
                parts: [{
                    type: "host-feedback",
                    text: `Execution stopped after reaching the current limit of ${allowedSteps} script steps. Finish with a final user-facing answer without more scripting.`,
                }],
                createdAt: new Date(),
            };

            this._messages.push(capMessage);
            this._messageList?.updateProgress("Preparing the final answer…");

            const finalReply = await this.chatService.sendMessage(this._providerId!, this._messages.slice(), { signal });
            if (this._shouldStopAssistantLoop()) return;

            if (chatModule.extractScriptFromAssistantMessage?.(finalReply)) {
                const visibleMessage: ChatMessage = {
                    role: "assistant",
                    content:
                        "The assistant reached the scripting step limit and did not produce a final user-facing answer.\n\n" +
                        "Start a new turn and ask it to summarize what it found so far without further scripting.",
                    parts: [{
                        type: "text",
                        text:
                            "The assistant reached the scripting step limit and did not produce a final user-facing answer.\n\n" +
                            "Start a new turn and ask it to summarize what it found so far without further scripting.",
                    }],
                    metadata: { uiVariant: "error", reason: "script-step-limit-without-final-answer" } as any,
                    createdAt: new Date(),
                };

                this._messages.push(visibleMessage);
                this._messageList?.removeProgress();
                this._messageList?.addMessage(visibleMessage);
                this._setStatus("No final answer was produced.");
                return;
            }

            this._messages.push(finalReply);
            this._messageList?.removeProgress();
            this._messageList?.addMessage(finalReply);
        } finally {
            this._messageList?.removeProgress();
        }
    }

    _toErrorText(error: unknown, fallback: string): string {
        if (error instanceof Error && error.message) return error.message;
        if (typeof error === "string" && error.trim()) return error;
        return fallback;
    }

    _pushErrorBubble(summary: string, error?: unknown): void {
        const detail = this._toErrorText(error, summary);
        const message: ChatMessage = {
            role: "assistant",
            content: `${summary}\n\n${detail}`,
            parts: [{
                type: "text",
                text: `${summary}\n\n${detail}`,
            }],
            metadata: { uiVariant: "error" },
            createdAt: new Date(),
        };
        this._messages.push(message);
        this._messageList?.addMessage(message);
    }

    _friendlyProgress(reply?: ChatMessage | null, executionMessage?: ChatMessage | null, step: number = 0): string {
        const replyText = String(reply?.content || "");
        const execText = String(executionMessage?.content || "");

        if (/Script execution failed/i.test(execText)) return "Retrying after a script error…";
        if (/hard cap/i.test(execText)) return "Finishing the response…";
        if (/metadata/i.test(replyText)) return "Reading slide metadata…";
        if (/active viewer|setActiveViewer|setActiveContext/i.test(replyText)) return "Selecting the active viewer…";
        if (/context|getGlobalInfo|getContextCount/i.test(replyText)) return "Checking available viewer contexts…";
        return step === 0 ? "Understanding your request…" : "Continuing analysis…";
    }
}
