import type {ChatService} from "../chatService";
import type {ChatModule} from "../chat";
import {ChatSessionPicker} from "./ChatSessionPicker";
import {ChatAttachmentBar} from "./ChatAttachmentBar";
import {ChatVoiceController} from "./ChatVoiceController";
import {ChatMessageList} from "./ChatMessageList";

const { BaseComponent, Button, FAIcon, PhIcon, Checkbox } = (globalThis as any).UI;
const { div, span, select, option, textarea, fieldset, legend, label, input, a } = (globalThis as any).van.tags;

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

/**
 * How a turn ended — declared globally as `ChatTurnOutcome` (types/shared.d.ts) so
 * event consumers can name it. Kept as a local alias for the existing call sites.
 */
type AssistantTurnOutcome = ChatTurnOutcome;

/**
 * Friendly progress wording per scripting namespace. Keys only — resolve with $.t at call time,
 * never at module load. Namespaces absent here (plugin-provided ones) fall back to a generic
 * phrase built from the namespace's registered title.
 */
const PROGRESS_KEY_BY_NAMESPACE: Record<string, string> = {
    application: 'chat.progressApplication',
    viewer: 'chat.progressViewer',
    visualization: 'chat.progressVisualization',
    patient: 'chat.progressPatient',
    annotationsRead: 'chat.progressAnnotationsRead',
    annotationsWrite: 'chat.progressAnnotationsWrite',
    measurements: 'chat.progressMeasurements',
    pathology: 'chat.progressPathology',
    recorder: 'chat.progressRecorder',
    questionnaire: 'chat.progressQuestionnaire',
};

type ScriptConsentEntry = {
    title: string;
    granted: boolean;
    description?: string;
    sensitive?: boolean;
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
    _voiceOverlayEl: HTMLElement | null;
    _voiceLabelEl: HTMLElement | null;
    _voiceMeterEl: HTMLElement | null;
    _voiceIcon: any;
    _voiceBars: HTMLElement[];
    _voiceLevels: number[];
    _sendBtnEl: any;
    _sendBtnLabelEl: HTMLElement | null;
    _statusEl: HTMLElement | null;
    _sessionTitleEl: HTMLElement | null;
    _sessionsBtnEl: any;
    _sessionsNewBtnEl: any;
    _loginBtn: any;
    _authUnsub?: (() => void) | undefined;
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
    _voiceController: ChatVoiceController | null;
    _messageList: ChatMessageList | null;

    _sanitizeConfig: any;
    _isRunning: boolean;
    _stopRequested: boolean;
    _turnAbortController: AbortController | null;

    // Streamed-reply state for the CURRENT model step (see _onStreamDelta).
    _streamStepActive = false;
    _streamPreviewBuffer = "";
    _streamPreviewTickPending = false;
    _fenceExitTriggered = false;

    // Sessions load behind the scripting baseline, long after the panel renders and unlocks its
    // input. These track that window: `_sessionsReady` is the promise a send waits on, and
    // `_sessionLoadEpoch` invalidates a hydration whose target is no longer the intended one.
    _sessionsPending = 0;
    _sessionsReady: Promise<void> | null = null;
    _awaitingSessions = false;
    _sessionLoadEpoch = 0;

    _scriptConsentCheckboxes: Map<string, HTMLInputElement>;
    _scriptConsentGrantAllEl: HTMLInputElement | null;
    _scriptConsentModeRadios: Map<string, HTMLInputElement> = new Map();
    _scriptConsentListEl: HTMLElement | null = null;
    _consentPillEl: HTMLElement | null = null;

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
        this._voiceOverlayEl = null;
        this._voiceLabelEl = null;
        this._voiceMeterEl = null;
        this._voiceIcon = null;
        this._voiceBars = [];
        this._voiceLevels = [];
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
        this._voiceController = null;
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
                    // In-page fragment hrefs (assistant region links) must not open a new tab.
                    if (!attrs.download && !String(attrs.href || "").startsWith("#")) {
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
        this._providerSelectEl.appendChild(option({ value: "" }, $.t('chat.selectProviderOption')));

        providers.forEach((p: ChatProviderInstanceRecord) => {
            this._providerSelectEl!.appendChild(option({ value: p.id }, p.label));
        });

        const current = this._providerId && this.chatService.getProvider(this._providerId) ? this._providerId : null;
        if (current) {
            this._providerSelectEl.value = current;
        } else {
            // No (or stale) selection — auto-select the preferred provider (remembered last-used,
            // else operator default, else a server-tagged default, else the first available).
            const preferred = this.chat?.getPreferredProviderId?.(providers as any) || null;
            if (preferred) {
                this._providerSelectEl.value = preferred;
                void this._onProviderChange(preferred);
            } else {
                this._providerId = null;
                this._providerSelectEl.value = "";
                void this._onProviderChange("");
            }
        }
        this._updateLoginButtonState();
        this._updateSessionPickerState();
        this._updateConsentPill();
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
            this._setStatus($.t('chat.personalityChanged'));
        }
    }

    async _refreshModelsForCurrentProvider(preferredModelId?: string | null): Promise<void> {
        if (!this._modelSelectEl || !this.chatService || !this._providerId) {
            this._models = [];
            this._modelId = null;
            if (this._modelSelectEl) {
                this._modelSelectEl.innerHTML = "";
                this._modelSelectEl.appendChild(option({ value: "" }, $.t('chat.noModels')));
                this._modelSelectEl.value = "";
                this._modelSelectEl.disabled = true;
            }
            return;
        }

        // A login-required provider that is not authenticated must NOT hit
        // listModels: that call goes through the authed RPC client (refreshOn401),
        // so with no valid token it 401s and the refresh keeps retrying in a loop.
        // Skip the RPC and settle into the clean "login required" state instead —
        // _updateInputState() renders the correct status + disabled input.
        const currentProvider = this.chatService.getProvider(this._providerId);
        if (currentProvider && currentProvider.requiresLogin !== false
            && !this.chatService.isAuthenticated(this._providerId)) {
            this._models = [];
            this._modelId = null;
            this._modelSelectEl.innerHTML = "";
            this._modelSelectEl.appendChild(option({ value: "" }, $.t('chat.noModels')));
            this._modelSelectEl.value = "";
            this._modelSelectEl.disabled = true;
            this._updateInputState();
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
                this._modelSelectEl.appendChild(option({ value: "" }, $.t('chat.noModels')));
                this._modelSelectEl.value = "";
                this._modelSelectEl.disabled = true;
                this._updateAttachmentCapabilityState();
                void this._maybeShowNeedsKeyHint();
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
            this._modelSelectEl.appendChild(option({ value: "" }, $.t('chat.noModels')));
            this._modelSelectEl.value = "";
            this._modelSelectEl.disabled = true;
            // Recompute the input/send/status after a failed refresh so the panel
            // can't be left stuck in a stale enabled-but-broken state.
            this._updateInputState();
            void this._maybeShowNeedsKeyHint();
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
            this._setStatus($.t('chat.modelChangedFinishSetup'));
            this._updateInputState({ keepStatus: true });
            return;
        }

        this._setStatus($.t('chat.modelChangedCreatingSession'));
        await this._handleNewSession({ successStatus: $.t('chat.modelChangedSessionCreated') });
    }

    _showChatView(): void {
        this._viewMode = "chat";
        this._chatViewEl?.classList.remove("hidden");
        this._sessionsViewEl?.classList.add("hidden");
    }

    _showSessionsView(): void {
        if (!this._providerId || !this.chatService?.getProvider(this._providerId)) {
            this._setStatus($.t('chat.selectProviderToBrowseSessions'));
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
            this._sessionTitleEl.textContent = resolved?.title || $.t('chat.noActiveSession');
            this._sessionTitleEl.setAttribute("title", resolved?.id ? $.t('chat.clickToRenameSession') : $.t('chat.noActiveSession'));
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
            option({ value: "user-friendly" }, $.t('chat.displayUserFriendly')),
            option({ value: "all" }, $.t('chat.displayAllHistory'))
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
        this._modelSelectEl.appendChild(option({ value: "" }, $.t('chat.noModels')));
        this._modelSelectEl.disabled = true;

        this._loginBtn = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: $.t('chat.logIn'), disabled: "" },
                onClick: () => this._handleLoginClick(),
            },
            new FAIcon({ name: "fa-right-to-bracket" }),
            span($.t('chat.login'))
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

        // Voice input. Deployment-controlled config lives on the chat module's
        // static meta (trusted, §7); the controls self-hide unless the
        // standalone speech-to-text module is loaded with a usable driver.
        const voiceCfg = (this.chat?.getStaticMeta?.("voice", {}) || {}) as any;
        // Language stability: pin transcription to the deployment's `voice.language`
        // if set, else inherit the live UI locale so the model tracks the app's
        // language instead of free-detecting it per utterance.
        const voiceLanguage = voiceCfg.language ?? (($ as any)?.i18n?.language || undefined);
        // Pathology biasing prompt, rebuilt at each capture (lazy) so it can fold in
        // live viewer terms. Base glossary is translatable; deployment can extend it
        // via `voice.prompt`. Only generic domain-tool vocabulary is added — never
        // slide/patient identity, which must not egress to the transcription endpoint.
        const buildVoicePrompt = (): string | undefined => {
            const parts: string[] = [];
            const base = $.t('chat.voice.transcriptionPrompt');
            if (base && base !== 'transcriptionPrompt') parts.push(String(base));
            if (typeof voiceCfg.prompt === 'string' && voiceCfg.prompt.trim()) {
                parts.push(voiceCfg.prompt.trim());
            }
            try {
                const pathology = (window as any).singletonModule?.('pathology-foundation');
                const drivers = pathology?.listDrivers?.();
                if (Array.isArray(drivers)) {
                    const labels = drivers.map((d: any) => String(d?.label || '').trim()).filter(Boolean);
                    if (labels.length) parts.push(labels.join(', '));
                }
            } catch (_e) { /* pathology-foundation absent — the glossary alone still helps */ }
            const joined = parts.join('. ').trim();
            return joined || undefined;
        };
        this._voiceController = new ChatVoiceController({
            fillInput: (text) => this._insertIntoInput(text),
            submit: () => this._handleSend(),
            isReady: () => this._isReady(),
            isBusy: () => this._isRunning,
            setStatus: (message) => this._setStatus(message),
            onVoiceUI: (state, level) => this._setVoiceUI(state, level),
            onSegment: (segment) => this._emit("voice-segment", { ...segment }),
            onStateChange: (state) => this._emit("voice-state", { ...state }),
            language: voiceLanguage,
            prompt: buildVoicePrompt,
            silenceMs: voiceCfg.silenceMs,
            autoSubmit: voiceCfg.autoSubmit === true,
            reArmDelayMs: voiceCfg.reArmDelayMs,
            minCaptureChars: voiceCfg.minCaptureChars,
            turnSilenceMs: voiceCfg.turnSilenceMs,
            speechFloorMult: voiceCfg.speechFloorMult,
            minSpeechMs: voiceCfg.minSpeechMs,
            minVoicedMs: voiceCfg.minVoicedMs,
            idleAutoOffMs: voiceCfg.idleAutoOffMs,
        });

        this._messageList = new ChatMessageList({
            id: this.id + "-messages",
            markdownEnabled: this.options?.markdownEnabled !== false,
            sanitizeConfig: this._sanitizeConfig,
            displayMode: this._displayMode,
            extractScriptFromAssistantMessage: (message) => this.chat?.extractScriptFromAssistantMessage?.(message),
            presentText: (text) => this.chat?.presentTextForUser?.(text) ?? text,
            onRegionLink: (payload) => this.chat?.navigateToRegionFromChat?.(payload),
        });

        const headerRow = div(
            { class: "flex items-center justify-between gap-2 px-2 py-1 border-b border-base-300 bg-base-200" },
            div(
                { class: "flex items-center gap-2 min-w-0" },
                new FAIcon({ name: "fa-comments" }).create(),
                span({ class: "font-semibold text-xs truncate" }, $.t('chat.pathologyAssistant'))
            ),
            div(
                { class: "flex items-center gap-2 shrink-0" },
                this._providerSelectEl,
                this._loginBtn.create(),
                (this._consentPillEl = span({
                    class: "badge badge-sm badge-success cursor-pointer hidden",
                    onclick: () => this._openSettingsDialog(),
                }, new PhIcon({name: "ph-shield-check"}).create(), $.t('chat.consentAutoApprovedPill')) as HTMLElement)
            )
        );

        this._statusEl = span({ class: "text-[11px] text-base-content/70 truncate" }) as HTMLElement;
        this._sessionTitleEl = span({
            class: "truncate flex-1 text-[12px] font-medium",
            title: $.t('chat.noActiveSession'),
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
        }, $.t('chat.noActiveSession')) as HTMLElement;

        this._sessionsBtnEl = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: $.t('chat.openSessionManager') },
                onClick: () => this._showSessionsView(),
            },
            new FAIcon({ name: "fa-comments" }),
            span($.t('chat.sessions'))
        ).create();

        const consentBtn = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { base: "btn btn-xs btn-square" },
                extraProperties: { title: $.t('chat.consentAndSettings') },
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
            span($.t('chat.back'))
        ).create();

        this._sessionsNewBtnEl = new Button(
            {
                size: Button.SIZE.TINY,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-xs" },
                extraProperties: { title: $.t('chat.startNewSession') },
                onClick: () => { void this._handleNewSession(); },
            },
            new FAIcon({ name: "fa-plus" }),
            span($.t('chat.new'))
        ).create();

        this._sessionsViewEl = div(
            { class: "hidden flex-1 min-h-0 flex flex-col bg-base-100" },
            div(
                { class: "px-2 py-2 border-b border-base-200 flex items-center justify-between gap-2" },
                div(
                    { class: "flex items-center gap-2 min-w-0" },
                    sessionsBackBtn,
                    span({ class: "font-semibold text-sm truncate" }, $.t('chat.sessions')),
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
            placeholder: $.t('chat.inputPlaceholder'),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._handleSend(e);
            },
        }) as HTMLTextAreaElement;

        this._sendBtnLabelEl = span($.t('chat.send')) as HTMLElement;
        this._sendBtnEl = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-sm" },
                extraProperties: { title: $.t('chat.sendMessage') },
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
            title: $.t('chat.completeSetupToMessage'),
            "aria-label": $.t('chat.completeSetupToMessage'),
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
            this._buildVoiceOverlay(),
        );

        const composer = div(
            { class: "border-t border-base-300 bg-base-100 px-2 py-2 flex flex-col gap-2" },
            inputWrap,
            div(
                { class: "flex items-center gap-2" },
                this._modelSelectEl,
                this._voiceController.create(),
                this._sendBtnEl,
            ),
            div(
                { class: "flex items-center justify-between text-[10px] gap-2" },
                this._statusEl,
                span({ class: "shrink-0 text-base-content/60" }, $.t('chat.ctrlEnterToSend'))
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
        this._setStatus($.t('chat.selectProviderToStart'));
        this._updateInputState();
        this.refreshScriptConsent();
        this._updateSessionPickerState();

        // React to auth-state changes (e.g. a redirect-return login completing on
        // reload, or a popup login finishing) so the Login button hides and the
        // chat unlocks without user interaction. The panel is app-lifetime.
        this._authUnsub = this.chatService.onProviderAuthChange?.(() => {
            this._updateLoginButtonState();
            // Re-fetch models: while the provider was unauthenticated,
            // _refreshModelsForCurrentProvider skipped listModels and cleared the
            // list, so without this the chat stays stuck on "No models" after a
            // successful login. The refresh re-checks auth (no-op if still logged
            // out) and, on success, populates + enables the model dropdown; then
            // recompute input/session state.
            void this._refreshModelsForCurrentProvider().finally(() => {
                this._updateInputState({ keepStatus: true });
                this._updateSessionPickerState();
            });
        });
        return root;
    }

    /**
     * Fan a module-level event out to external observers.
     *
     * The panel owns the turn engine, so it is the only place that knows when a turn
     * starts, when the transcript moves and how a turn ended — but the *module* is the
     * EventSource consumers can reach (`singletonModule('vercel-ai-chat-sdk')`). This is
     * the one-way bridge between the two. See EVENTS.md.
     *
     * An observer must never be able to break a turn, hence the try/catch: a throwing
     * handler is logged and skipped, exactly like ChatService treats `onDelta`.
     */
    _emit(eventName: string, payload: Record<string, unknown>): void {
        try {
            (this.chat as any)?.raiseEvent?.(eventName, payload);
        } catch (error) {
            console.error(`[ChatPanel] '${eventName}' handler failed:`, error);
        }
    }

    addMessage(msg: ChatMessage): void {
        const normalized = { ...msg, createdAt: msg.createdAt || new Date() };
        this._messages.push(normalized);
        this._messageList?.addMessage(normalized);
        this._emit("messages-changed", {
            sessionId: this.chatService?.getActiveSessionId?.() ?? null,
            messages: this._messages.slice(),
            change: "append",
            message: normalized,
        });
    }

    clearMessages(): void {
        // Any hydration still in flight targets the state being discarded here — invalidate it.
        this._sessionLoadEpoch += 1;
        this._messages = [];
        this._messageList?.clear();
        this._emit("messages-changed", {
            sessionId: this.chatService?.getActiveSessionId?.() ?? null,
            messages: [],
            change: "clear",
        });
    }

    /** True while a session list/hydration is scheduled or in flight. */
    get _sessionsLoading(): boolean {
        return this._sessionsPending > 0;
    }

    _updateSessionPickerState(): void {
        const hasProvider = !!(this._providerId && this.chatService?.getProvider(this._providerId));
        const disableSessionActions = !hasProvider || this._isRunning || this._sessionsLoading;

        this._sessionPicker?.setLoading(this._sessionsLoading);
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

    /**
     * Show the "Auto-approved" pill next to the provider when the local user's consent was applied
     * from the remembered-consent cache; tooltip names what was approved and until when.
     */
    _updateConsentPill(): void {
        const pill = this._consentPillEl;
        if (!pill) return;

        const auto = !!this.chat?.hasAutoApprovedConsent?.();
        pill.classList.toggle("hidden", !auto);
        if (!auto) { pill.removeAttribute("title"); return; }

        const expiry = this.chat?.getConsentExpiry?.();
        const modeKey = this.chat?.getConsentModeLabelKey?.();
        const mode = modeKey ? $.t(modeKey) : "";
        const date = (typeof expiry === "number" && Number.isFinite(expiry))
            ? new Date(expiry).toLocaleDateString()
            : "";
        pill.setAttribute("title", $.t('chat.consentAutoApprovedTooltip', { mode, date }));
    }

    refreshScriptConsent(): void {
        if (!this._settingsContentEl) return;

        const content = this._settingsContentEl.querySelector("[data-script-consent-list]") as HTMLElement | null;
        if (!content) return;

        const chatModule = this.chat;
        const entries = chatModule?.getScriptConsentEntries?.() || {};

        // Reflect the current posture onto the radios and reveal the per-namespace
        // list only in custom mode.
        const mode = chatModule?.getScriptConsentMode?.() || 'all-but-sensitive';
        for (const [radioMode, radio] of this._scriptConsentModeRadios) {
            radio.checked = radioMode === mode;
        }
        const isCustom = mode === 'custom';
        (this._scriptConsentListEl || content).classList.toggle("hidden", !isCustom);

        content.innerHTML = "";
        this._scriptConsentCheckboxes = new Map();
        this._scriptConsentGrantAllEl = null;
        const allEntries = Object.entries(entries) as [string, ScriptConsentEntry][];

        if (!isCustom) return;

        if (!allEntries.length) {
            content.appendChild(div({ class: "text-xs text-base-content/70 italic" }, $.t('chat.noScriptingNamespaces')));
            return;
        }

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

            const titleRow = value.sensitive
                ? span({ class: "flex items-center gap-1" },
                    value.title,
                    span({ class: "badge badge-xs badge-warning" }, $.t('chat.sensitiveBadge')))
                : span(value.title);

            wrapper.appendChild(label({
                style: "display: flex; flex-direction: column; gap: 0.25rem; flex: 1; pl-1",
                for: "chat-namespace-consent-" + namespace,
            }, titleRow, value.description
                ? span({ class: "text-[11px] text-base-content/70" }, value.description)
                : span()));

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

    /**
     * Status line with a trailing action link (DOM-built, no HTML strings).
     * Used to make actionable states ("no models", "key required") clickable.
     */
    _setStatusAction(text: string, actionText: string, onAction: () => void): void {
        if (!this._statusEl) return;
        this._statusEl.textContent = "";
        this._statusEl.append(
            span(`${text} `),
            a({ class: "link link-primary cursor-pointer", onclick: onAction }, actionText)
        );
    }

    /** Focus the BYOK key management tab in the fullscreen Plugins menu. */
    _openProviderKeysMenu(): void {
        try {
            (globalThis as any).USER_INTERFACE?.AppBar?.Plugins?.openSubmenu?.('vercel-ai-chat-sdk', 'provider-keys');
        } catch (error) {
            console.warn("Failed to open provider keys menu:", error);
        }
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
        if (this._sendBtnEl) this._sendBtnEl.disabled = this._isRunning ? false : (!ready || this._awaitingSessions);
        if (this._sendBtnLabelEl) this._sendBtnLabelEl.textContent = this._isRunning ? $.t('chat.stop') : $.t('chat.send');
        if (this._sendBtnEl) this._sendBtnEl.title = this._isRunning ? $.t('chat.stopCurrentResponse') : $.t('chat.sendMessage');
        this._attachmentBar?.setDisabled(!ready || this._isRunning);
        this._voiceController?.setState(ready, this._isRunning);
        this._sessionPicker?.setLoading(this._sessionsLoading);
        this._sessionPicker?.setDisabled(!this._providerId || this._isRunning || this._sessionsLoading);
        if (this._modelSelectEl) this._modelSelectEl.disabled = this._isRunning || !this._providerId || !this._models.length;
        if (this._providerSelectEl) this._providerSelectEl.disabled = this._isRunning;
        if (this._personalitySelectEl) this._personalitySelectEl.disabled = this._isRunning;
        if (this._displayModeSelectEl) this._displayModeSelectEl.disabled = this._isRunning;

        if (!keepStatus) {
            if (this._isRunning) {
                this._setStatus(this._stopRequested ? $.t('chat.stopping') : $.t('chat.waitingForAssistant'));
            } else if (ready && (this._sessionsLoading || this._awaitingSessions)) {
                this._setStatus($.t('chat.loadingSessions'));
            } else if (!this._providerId) {
                this._setStatus($.t('chat.selectProviderToStart'));
            } else if (!ready) {
                const provider = this.chatService.getProvider(this._providerId);
                if (provider?.requiresLogin !== false && !this.chatService.isAuthenticated(this._providerId)) {
                    this._setStatus($.t('chat.loginRequired'));
                } else {
                    this._setStatus($.t('chat.reviewSettingsBeforeChatting'));
                }
            } else if (this.chatService.getActiveSessionId()) {
                this._setStatus($.t('chat.ready'));
            } else {
                this._setStatus($.t('chat.readyStartOrSend'));
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
            this._setStatus($.t('chat.selectProviderToStart'));
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

        // 3) Provider returned no usable models — most often a missing API key.
        // Take the user straight to the BYOK key management tab and leave a
        // clickable status behind for when they close it.
        if (!this._modelId && !this._models.length) {
            this._setStatusAction(
                $.t('chat.providerNoModels'),
                $.t('chat.openProviderKeys'),
                () => this._openProviderKeysMenu()
            );
            this._openProviderKeysMenu();
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

    /**
     * Three-way scripting-access posture radios. Selecting a preset re-derives all grants; "Custom"
     * reveals the per-namespace list below. Mirrors ChatModule.getScriptConsentMode/setScriptConsentMode.
     */
    _buildConsentModeRadios(): HTMLElement {
        this._scriptConsentModeRadios = new Map();
        const chatModule = this.chat;

        const mkOption = (mode: ScriptConsentMode, labelKey: string) => {
            const radio = input({
                type: "radio",
                name: "chat-consent-mode",
                class: "radio radio-sm",
                value: mode,
                onchange: (e: Event) => {
                    if (!(e.target as HTMLInputElement).checked) return;
                    chatModule?.setScriptConsentMode?.(mode);
                    this.refreshScriptConsent();
                }
            }) as HTMLInputElement;
            this._scriptConsentModeRadios.set(mode, radio);
            return label(
                { class: "flex flex-row items-center gap-2 cursor-pointer" },
                radio,
                span($.t(labelKey))
            );
        };

        return div(
            { class: "flex flex-col gap-1 pb-2 mb-1" },
            mkOption('all-but-sensitive', 'chat.consentModeAllButPatient'),
            mkOption('all', 'chat.consentModeAll'),
            mkOption('custom', 'chat.consentModeCustom'),
        );
    }

    _buildSettingsContent(): HTMLElement {
        const scriptConsentList = div({
            class: "flex flex-col gap-2 max-h-48 overflow-y-auto pr-1 border border-base-200 rounded p-2",
            "data-script-consent-list": ""
        });
        this._scriptConsentListEl = scriptConsentList as HTMLElement;

        const applyBtn = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-sm" },
                extraProperties: { title: $.t('chat.saveSettings') },
                onClick: () => { void this._applySettingsAndContinue(); },
            },
            new FAIcon({ name: "fa-check" }).create(),
            span($.t('chat.save'))
        ).create();

        return div(
            { class: "w-full max-w-lg p-4 flex flex-col gap-4" },
            div(
                { class: "flex items-center justify-between gap-2" },
                div(
                    { class: "flex items-center gap-2" },
                    new FAIcon({ name: "fa-shield-halved" }).create(),
                    span({ class: "font-semibold text-lg" }, $.t('chat.consentSettingsTitle'))
                )
            ),
            span(
                { class: "text-[11px] text-base-content/80" },
                $.t('chat.settingsDescription')
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, $.t('chat.personality')),
                this._personalitySelectEl || div()
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, $.t('chat.display')),
                this._displayModeSelectEl || div()
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, $.t('chat.consentModeLegend')),
                this._buildConsentModeRadios(),
                scriptConsentList
            ),
            div({ class: "flex items-center justify-end gap-2" }, applyBtn)
        ) as HTMLElement;
    }

    /** Last provider id a change chain was started for (re-entry guard). */
    _providerChangeStarted: string | null = null;

    async _onProviderChange(providerId: string): Promise<void> {
        const next = providerId || null;
        // Re-entry guard: during init, bootstrap and every provider-plugin
        // registration each call refreshProviders; without this, duplicate calls
        // re-ran the whole destructive chain (clear messages, listModels, session
        // reload) for the provider that is already selected.
        if (next !== null && next === this._providerId && this._providerChangeStarted === next) return;
        this._providerChangeStarted = next;
        this._providerId = providerId || null;
        // Remember the last-used provider so it auto-selects on the next load.
        if (providerId) this.chat?.rememberProviderId?.(providerId);
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
            this._setStatus($.t('chat.selectProviderToStart'));
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        const provider = this.chatService?.getProvider(providerId);
        if (!provider) {
            this._consentConfigured = false;
            this._setStatus($.t('chat.unknownProvider'));
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        const requiresLogin = provider.requiresLogin !== false;
        const authed = this.chatService.isAuthenticated(providerId);

        if (requiresLogin && !authed) {
            this._consentConfigured = false;
            this._setStatus($.t('chat.providerSelectedLogInFirst'));
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }

        this._updateSessionPickerState();
        this._proceedAfterProviderReady();
    }

    /**
     * Provider is selected + authenticated. If the local user's consent is remembered (auto-approved
     * from cache), skip the greeting and go straight to ready; otherwise open the consent dialog.
     */
    _proceedAfterProviderReady(): void {
        if (this.chat?.hasAutoApprovedConsent?.()) {
            this._consentConfigured = true;
            this._updateConsentPill();
            // Sessions load right away: listing and hydration read stored rows only, never the
            // scripting manifest. The boot-time scripting baseline (plugin namespace registration)
            // gates *sends* instead, inside chatService.sendMessage -> awaitReadyForSend, so the
            // first turn's manifest is still complete.
            this._sessionsPending += 1;
            this._sessionsReady = Promise.resolve(this._refreshSessionsForCurrentProvider?.({ autoLoadLatest: true }))
                .catch((error) => console.error("Failed to load chat sessions:", error))
                .finally(() => {
                    this._sessionsPending = Math.max(0, this._sessionsPending - 1);
                    if (!this._sessionsLoading) this._sessionsReady = null;
                    this._updateInputState({ keepStatus: this._isRunning });
                    this._updateSessionPickerState();
                });
            this._updateInputState();
            this._updateSessionPickerState();
            return;
        }
        this._consentConfigured = false;
        this._openSettingsDialog();
    }

    async _handleLoginClick(): Promise<void> {
        if (!this._providerId || !this.chatService) return;
        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return;

        try {
            this._setStatus($.t('chat.loggingIn'));
            this._loginBtn?.toggleClass?.("loading", "loading", true);
            await this.chatService.login(this._providerId);
            this._setStatus($.t('chat.loginSuccessful'));
            this._proceedAfterProviderReady();
        } catch (err) {
            console.error("ChatPanel login failed:", err);
            this._consentConfigured = false;
            this._closeSettingsDialog();
            this._setStatus($.t('chat.loginFailed'));
        } finally {
            this._loginBtn?.toggleClass?.("loading", "loading", false);
            this._updateInputState({ keepStatus: true });
            this._updateLoginButtonState();
        }
    }

    /**
     * A BYOK key was saved/removed for `providerId`. If it is the selected
     * provider, re-derive the whole ready state: refresh models, and when the
     * consent posture is already settled (granted this session or remembered),
     * enable the input without forcing the user back through the consent dialog.
     */
    async onProviderKeysChanged(providerId: string): Promise<void> {
        if (!this.chatService || this._providerId !== providerId) return;
        await this._refreshModelsForCurrentProvider();
        if (!this._models.length) {
            this._updateInputState();
            return;
        }
        if (!this._consentConfigured && this.chat?.hasAutoApprovedConsent?.()) {
            // Consent was remembered but the panel never reached the ready flow
            // because the provider had no models at selection time — finish it now.
            this._proceedAfterProviderReady();
            return;
        }
        // Consent already configured this session (or still pending — then the
        // input overlay keeps guiding the user). Recompute enablement + status.
        this._updateInputState();
    }

    /**
     * When the selected provider failed to produce models because nobody has
     * configured a key anywhere, surface an actionable hint instead of the
     * generic failure status. Key management itself lives in the fullscreen
     * plugin-settings menu (ProviderKeysPanel). Best-effort — never throws.
     */
    async _maybeShowNeedsKeyHint(): Promise<void> {
        if (!this._providerId || !this.chatService) return;
        try {
            const status = await this.chatService.getProviderUserSecretsStatus(this._providerId);
            if (status?.needsKey) {
                this._setStatusAction(
                    $.t('chat.providerKeyRequiredStatus'),
                    $.t('chat.openProviderKeys'),
                    () => this._openProviderKeysMenu()
                );
            }
        } catch (_) {
            // Status is a hint only; the generic failure state already renders.
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
        // Persist the approved posture locally (with expiry) so the user is auto-approved next time.
        this.chat?.markConsentApproved?.();
        this._updateConsentPill();
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

        // A turn owns the message list and the send delta while it runs: auto-hydrating underneath
        // it would replace both with pre-turn server state. The post-turn refresh (autoLoadLatest
        // false) is the one that legitimately runs with _isRunning still set.
        if (autoLoadLatest && this._isRunning) return;

        this._sessionsPending += 1;
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
            this._setStatus($.t('chat.readyStartOrChoose'));
        } catch (error) {
            console.error("Failed to refresh sessions:", error);
            this._setStatus($.t('chat.failedToLoadSessions'));
        } finally {
            this._sessionsPending = Math.max(0, this._sessionsPending - 1);
            this._updateSessionPickerState();
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
        const firstLine = String(text || "").split(/\r?\n/, 1)[0]?.trim() || $.t('chat.repeatedScriptFailuresShort');
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

        // Exact signatures of every API method the failing script referenced
        // (consent-filtered host data) — lets the model correct the call in one
        // retry instead of a describeScriptingApi round-trip.
        const referenced = Array.isArray(structured?.referencedSignatures) ? structured.referencedSignatures : [];
        const signatureLines: string[] = [];
        for (const entry of referenced) {
            if (!entry?.namespace || !entry?.method) continue;
            if (entry.found === false) {
                signatureLines.push(`- ${entry.namespace}.${entry.method}: DOES NOT EXIST — do not retry it.`);
                continue;
            }
            const signature = entry.tsSignature
                || `${entry.method}(${(entry.params || []).map((p: any) => `${p?.name}: ${p?.type}`).join(", ")}) => ${entry.returns || "void"}`;
            const description = entry.description ? ` — ${entry.description}` : "";
            const declaration = entry.tsDeclaration ? `\n  TS: ${entry.tsDeclaration}` : "";
            signatureLines.push(`- ${entry.namespace}.${signature}${description}${declaration}`);
        }

        const errorText = executionMessage.content || "Script execution failed.";
        const feedbackText = [
            "Script execution failed.",
            `Error: ${errorText}`,
            details.length ? `Structured details:\n${details.join("\n")}` : null,
            signatureLines.length
                ? `Exact signatures of the API methods your script referenced:\n${signatureLines.join("\n")}`
                : null,
            signatureLines.length
                ? "Correct the call using the signatures above. If required information is still missing, ask a brief clarification question."
                : "Do not guess field names or methods. Use only fields explicitly shown in the allowed API. If required information is missing, ask a brief clarification question.",
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

    /**
     * Hydrate `sessionId` into the panel. Returns the session on success, or null when the
     * load failed or was superseded — external callers (ChatModule.openSession) need to tell
     * those apart, while the UI call sites simply ignore the value.
     */
    async _loadSession(sessionId: string): Promise<ChatSession | null> {
        // Hydration replaces the whole message list, so a load that has been superseded (provider
        // switched, another session picked, a new session created) must never apply its result.
        const epoch = ++this._sessionLoadEpoch;

        try {
            const hydration = await this.chatService.loadSession(sessionId);
            if (epoch !== this._sessionLoadEpoch) return null;

            this._messages = (hydration.messages || []).map((m) => ({ ...m, createdAt: m.createdAt || new Date() }));
            this._messageList?.setMessages(this._messages);
            this._sessionPicker?.setActiveSession(hydration.session.id);
            this._updateSessionTitle(hydration.session);
            this._emit("session-changed", {
                sessionId: hydration.session.id,
                session: hydration.session,
                reason: "loaded",
            });
            this._emit("messages-changed", {
                sessionId: hydration.session.id,
                messages: this._messages.slice(),
                change: "replace",
            });

            if (hydration.session.personalityId && this.chatService.getPersonality(hydration.session.personalityId)) {
                this._personalityId = hydration.session.personalityId;
                this.chatService.setPersonality(hydration.session.personalityId);
                if (this._personalitySelectEl) this._personalitySelectEl.value = hydration.session.personalityId;
            }

            if (hydration.session.modelId) {
                await this._refreshModelsForCurrentProvider(hydration.session.modelId);
                if (epoch !== this._sessionLoadEpoch) return null;
            }

            this._showChatView();
            this._setStatus($.t('chat.loadedSession', { title: hydration.session.title }));
            return hydration.session;
        } catch (error) {
            console.error("Failed to load session:", error);
            if (epoch === this._sessionLoadEpoch) this._setStatus($.t('chat.failedToLoadSession'));
            return null;
        }
    }

    async _handleSessionSelection(sessionId: string | null): Promise<void> {
        if (!sessionId) {
            this.chatService.setActiveSessionId(null);
            this.clearMessages();
            this._updateSessionTitle(null);
            this._emit("session-changed", { sessionId: null, session: null, reason: "cleared" });
            this._setStatus($.t('chat.readyStartOrChoose'));
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
        if (!this._providerId) throw new Error($.t('chat.selectProviderFirst'));

        const modelId = this._modelId || this._models[0]?.id || (await this.chatService.listModels(this._providerId))[0]?.id;
        if (!modelId) throw new Error($.t('chat.providerReturnedNoModels', { provider: this._providerId }));

        this._setStatus($.t('chat.creatingNewSession'));

        const session = await this.chatService.createSession({
            providerId: this._providerId,
            modelId,
            personalityId: this._personalityId,
            contextId: this.chatService.getProvider(this._providerId)?.contextId || null,
            metadata: {
                viewerContextId: this._getCurrentViewerContextId(),
            },
        });

        this.adoptCreatedSession(session, { showChatView, preserveMessages, fallbackModelId: modelId });

        this._setStatus($.t('chat.newChatReady'));
        return session.id;
    }

    /**
     * Make a freshly created session the panel's live one.
     *
     * Split out of `_ensureActiveSession` so a session created headlessly
     * (`ChatModule.createSession`) lands in the UI through exactly the same steps — an
     * externally created session must not leave the panel showing a stale transcript or
     * a stale picker selection.
     */
    adoptCreatedSession(
        session: ChatSession,
        options: { showChatView?: boolean; preserveMessages?: boolean; fallbackModelId?: string | null } = {}
    ): void {
        const { showChatView = true, preserveMessages = false, fallbackModelId = null } = options;

        // This session is now the live one; a hydration of the previously intended session must
        // not land on top of it (it would drop the messages this call was told to preserve).
        this._sessionLoadEpoch += 1;

        this._modelId = session.modelId || fallbackModelId || this._modelId;
        if (this._modelSelectEl) this._modelSelectEl.value = this._modelId || "";
        this._sessions = [session, ...this._sessions.filter((s) => s.id !== session.id)];
        this._sessionPicker?.setSessions(this._sessions, session.id);
        this._updateSessionTitle(session);
        this._emit("session-changed", { sessionId: session.id, session, reason: "created" });

        if (!preserveMessages) {
            this.clearMessages();
        }

        this._updateSessionPickerState();

        if (showChatView) {
            this._showChatView();
        }
    }

    async _handleNewSession(options: { successStatus?: string } = {}): Promise<void> {
        if (!this._isReady()) {
            this._updateInputState();
            return;
        }

        try {
            this._setStatus($.t('chat.creatingNewSession'));
            this.chatService.setActiveSessionId(null);
            this.clearMessages();
            await this._ensureActiveSession({ showChatView: true });
            this._setStatus(options.successStatus || $.t('chat.newSessionCreated'));
        } catch (error) {
            console.error("Failed to create a new session:", error);
            this._setStatus($.t('chat.failedToStartSession'));
        } finally {
            this._updateSessionPickerState();
        }
    }

    async _handleRenameSession(sessionId: string | null): Promise<void> {
        if (!sessionId) return;
        const current = this._sessions.find((s) => s.id === sessionId);
        const nextTitle = window.prompt($.t('chat.renameSessionPrompt'), current?.title || "")?.trim();
        if (!nextTitle) return;

        try {
            await this.chatService.renameSession(sessionId, nextTitle);
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
            this._sessionPicker?.setActiveSession(sessionId);
            this._updateSessionTitle(this._sessions.find((s) => s.id === sessionId) || null);
            this._setStatus($.t('chat.sessionRenamed'));
        } catch (error) {
            console.error("Failed to rename session:", error);
            this._setStatus($.t('chat.failedToRenameSession'));
        }
    }

    async _handleDeleteSession(sessionId: string | null): Promise<void> {
        if (!sessionId) return;
        const current = this._sessions.find((s) => s.id === sessionId);
        if (!window.confirm($.t('chat.deleteSessionConfirm', { title: current?.title || sessionId }))) return;

        try {
            await this.chatService.deleteSession(sessionId);
            if (this.chatService.getActiveSessionId() === sessionId) {
                this.chatService.setActiveSessionId(null);
                this.clearMessages();
                this._updateSessionTitle(null);
            }
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: true });
            this._setStatus($.t('chat.sessionDeleted'));
        } catch (error) {
            console.error("Failed to delete session:", error);
            this._setStatus($.t('chat.failedToDeleteSession'));
        }
    }

    async _handleFilesSelected(files: FileList | File[]): Promise<void> {
        const model = this._getCurrentModelInfo();
        const caps = model?.capabilities;

        const onlyImages = Array.from(files as any as File[]).every((f: File) =>
            String(f.type || '').startsWith('image/')
        );

        if (onlyImages && caps?.images === 'unsupported') {
            this._setStatus($.t('chat.imageUploadUnavailable'));
            return;
        }

        if (!onlyImages && caps?.files === 'unsupported') {
            this._setStatus($.t('chat.fileUploadUnavailable'));
            return;
        }

        if (!this._isReady()) {
            this._updateInputState();
            return;
        }

        try {
            const sessionId = await this._ensureActiveSession();
            const items = Array.from(files as any as File[]);
            // Uploads (the heavy base64 payloads) run concurrently; the message
            // attachments stay sequential so chat order and the sync cursor are stable.
            const attachments = await Promise.all(
                items.map((file) => this.chatService.uploadAttachment({ sessionId, file, name: file.name }))
            );
            for (const attachment of attachments) {
                await this.chatService.attachUploadedFileAsMessage({ sessionId, attachment, role: "user" });
                this.addMessage(this._messageFromAttachment(attachment));
            }
            await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
            this._sessionPicker?.setActiveSession(sessionId);
            this._updateSessionTitle(this._sessions.find((s) => s.id === sessionId) || null);
            this._setStatus($.t('chat.attachmentAdded'));
        } catch (error) {
            console.error("Failed to upload attachment:", error);
            this._pushErrorBubble($.t('chat.fileCouldNotAttach'), error);
            this._setStatus($.t('chat.attachmentFailed'));
        }
    }

    async _handleAttachScreenshot(): Promise<void> {
        const caps = this._getCurrentModelInfo()?.capabilities;
        if (caps?.images === 'unsupported') {
            this._setStatus($.t('chat.screenshotUnavailable'));
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
            this._setStatus($.t('chat.screenshotAttached'));
        } catch (error) {
            console.error("Failed to attach screenshot:", error);
            this._pushErrorBubble($.t('chat.screenshotCouldNotAttach'), error);
            this._setStatus($.t('chat.screenshotFailed'));
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
            this._setStatus($.t('chat.screenshotAndFileUnavailable'));
        } else if (imagesUnsupported) {
            this._setStatus($.t('chat.screenshotUnavailable'));
        } else if (filesUnsupported) {
            this._setStatus($.t('chat.fileUploadUnavailable'));
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
            throw new Error($.t('chat.noViewerScreenshotAvailable'));
        }
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error($.t('chat.failedToCaptureScreenshot')));
            }, "image/png");
        });
    }

    /**
     * Append recognized speech to the composer for review. Inserts a separating
     * space when the box is non-empty and focuses the caret at the end so the
     * user can immediately edit or send. Never auto-sends — that decision is the
     * voice controller's (manual = review, auto mode = explicit submit).
     */
    _insertIntoInput(text: string): void {
        if (!this._inputEl || !text) return;
        const existing = this._inputEl.value;
        const sep = existing && !/\s$/.test(existing) ? " " : "";
        this._inputEl.value = existing + sep + text;
        try {
            this._inputEl.focus();
            const end = this._inputEl.value.length;
            this._inputEl.setSelectionRange(end, end);
        } catch (_e) { /* focus is best-effort */ }
    }

    /**
     * Recording overlay shown over the composer input while dictating. Makes the
     * mode obvious (a live level meter while listening, a spinner while
     * transcribing) and doubles as a big click-target to stop capture. Hidden
     * when idle so normal typing is unaffected.
     */
    _buildVoiceOverlay(): HTMLElement {
        const BAR_COUNT = 28;
        this._voiceBars = [];
        this._voiceLevels = new Array(BAR_COUNT).fill(0);
        const bars: HTMLElement[] = [];
        for (let b = 0; b < BAR_COUNT; b++) {
            const bar = span({
                class: "inline-block rounded-full bg-primary",
                // Inline width/height/transition: arbitrary Tailwind sizes are purged
                // from the shipped build, so we don't rely on w-[3px] existing.
                style: "width:3px; height:8%; transition:height 80ms linear;",
            }) as HTMLElement;
            this._voiceBars.push(bar);
            bars.push(bar);
        }
        this._voiceMeterEl = div(
            { class: "flex items-center justify-center h-6 flex-1 min-w-0 overflow-hidden", style: "gap:2px;" },
            ...bars
        ) as HTMLElement;

        this._voiceIcon = new PhIcon({ name: "ph-microphone" });
        this._voiceIcon.setClass("color", "text-error");
        this._voiceIcon.setClass("anim", "animate-pulse");
        this._voiceLabelEl = span(
            { class: "text-xs font-medium text-base-content shrink-0", style: "opacity:0.85;" },
            $.t("listening", { ns: "speech-to-text" })
        ) as HTMLElement;

        const stop = () => this._voiceController?.stopCapture();
        this._voiceOverlayEl = div(
            {
                class: "absolute inset-0 z-30 hidden items-center gap-2 px-3 rounded-lg bg-base-200 cursor-pointer select-none",
                role: "button",
                tabindex: 0,
                title: $.t("micTooltipListening", { ns: "speech-to-text" }),
                "aria-label": $.t("micTooltipListening", { ns: "speech-to-text" }),
                onclick: stop,
                onkeydown: (e: KeyboardEvent) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    stop();
                },
            },
            this._voiceIcon.create(),
            this._voiceLabelEl,
            this._voiceMeterEl,
        ) as HTMLElement;
        return this._voiceOverlayEl;
    }

    /** Push a new level (0..1) into the rolling meter and repaint the bars. */
    _pushVoiceLevel(level: number): void {
        if (!this._voiceBars.length) return;
        const lvl = Math.max(0, Math.min(1, level || 0));
        this._voiceLevels.push(lvl);
        this._voiceLevels.shift();
        for (let i = 0; i < this._voiceBars.length; i++) {
            const h = 8 + this._voiceLevels[i] * 92; // 8%..100%
            this._voiceBars[i].style.height = `${h}%`;
        }
    }

    /** Drive the recording overlay: listening (with live level), processing, idle. */
    _setVoiceUI(state: "listening" | "processing" | "idle", level?: number): void {
        const ov = this._voiceOverlayEl;
        if (!ov) return;
        if (state === "idle") {
            ov.classList.add("hidden");
            ov.classList.remove("flex");
            return;
        }
        ov.classList.remove("hidden");
        ov.classList.add("flex");

        if (state === "processing") {
            if (this._voiceLabelEl) this._voiceLabelEl.textContent = $.t("processing", { ns: "speech-to-text" });
            this._voiceIcon?.changeIcon("ph-circle-notch");
            this._voiceIcon?.setClass("color", "text-primary");
            this._voiceIcon?.setClass("anim", "animate-spin");
            this._voiceMeterEl?.classList.add("invisible");
            return;
        }

        // listening — slashed mic reads unambiguously as "click to stop".
        if (this._voiceLabelEl) this._voiceLabelEl.textContent = $.t("listening", { ns: "speech-to-text" });
        this._voiceIcon?.changeIcon("ph-microphone-slash");
        this._voiceIcon?.setClass("color", "text-error");
        this._voiceIcon?.setClass("anim", "animate-pulse");
        this._voiceMeterEl?.classList.remove("invisible");
        if (typeof level === "number") this._pushVoiceLevel(level);
    }

    // ---- voice passthroughs (see ChatModule's voice API) ----

    /** Is the speech-to-text module loaded with a usable driver? */
    isVoiceAvailable(): boolean {
        return !!this._voiceController?.available;
    }

    /** Start hands-free capture, as if the auto button had been pressed. */
    startVoiceCapture(): void {
        this._voiceController?.startAuto();
    }

    /**
     * Stop any capture (hands-free or manual) and release the microphone. Deliberately
     * not `stopAll()`, which also unregisters the speech-to-text handlers — that is
     * teardown, and the panel must stay usable afterwards.
     */
    stopVoiceCapture(): void {
        this._voiceController?.stopAuto();
        this._voiceController?.stopCapture();
    }

    /** Run a single manual dictation; resolves when the transcript has been handled. */
    async dictateOnce(): Promise<void> {
        await this._voiceController?.dictateOnce();
    }

    async _handleSend(event?: Event): Promise<void> {
        event?.preventDefault?.();

        if (this._isRunning) {
            this._handleStop(event);
            return;
        }

        // A direct Send while dictating stops the mic and flushes the transcript
        // into the input so it goes out in this same action. Only on a real user
        // gesture (event present) — the programmatic auto-mode submit must not
        // tear down its own capture loop.
        if (event) {
            await this._voiceController?.finishAndFlush();
        }

        if (!this._isReady() || !this._inputEl || !this.chatService || !this._providerId) {
            this._updateInputState();
            return;
        }

        const text = this._inputEl.value.trim();
        if (!text) return;
        this._inputEl.value = "";

        await this.sendText(text, {
            source: event ? "user" : "voice",
            restoreInputOnHold: true,
        });
    }

    /**
     * Run one full turn for `text` — the panel's turn entry point, independent of the DOM input.
     *
     * `_handleSend` is the UI wrapper (read the textarea, clear it, call this); external drivers
     * reach the same engine through `ChatModule.appendUserUtterance`. Routing programmatic turns
     * here rather than around the panel is deliberate: there is exactly one turn loop to maintain,
     * and the panel keeps rendering bubbles, progress and streaming preview for API-driven turns,
     * so an open chat tab reflects external activity live.
     *
     * Raises `turn-start` once the user message is on the transcript and `turn-complete` on every
     * terminal path — including the ones that unwind by throwing, which `_runAssistantLoop`'s own
     * `finish()` never sees.
     */
    async sendText(
        text: string,
        options: { source?: ChatTurnSource; signal?: AbortSignal; restoreInputOnHold?: boolean } = {}
    ): Promise<ChatTurnOutcome> {
        const { source = "api", restoreInputOnHold = false } = options;

        if (this._isRunning) {
            return { kind: "error", reason: "turn-already-running", rendered: false };
        }
        if (!this._isReady() || !this.chatService || !this._providerId) {
            this._updateInputState();
            return { kind: "error", reason: "not-ready", rendered: false };
        }

        text = String(text || "").trim();
        if (!text) return { kind: "error", reason: "empty-text", rendered: false };

        // Sessions may still be loading (the auto-load waits for the scripting baseline). Hold the
        // send until they land, so the message joins the hydrated session instead of forcing a new
        // one — and so the late hydration cannot wipe it. Typing stays enabled throughout, hence
        // the input is cleared by the caller rather than after the wait.
        if (this._sessionsReady) {
            this._awaitingSessions = true;
            this._updateInputState();
            try {
                await this._sessionsReady;
            } finally {
                this._awaitingSessions = false;
            }
            if (!this._isReady() || this._isRunning) {
                if (restoreInputOnHold && this._inputEl && !this._inputEl.value) this._inputEl.value = text;
                this._updateInputState();
                return { kind: "error", reason: "not-ready-after-session-load", rendered: false };
            }
        }

        const userMsg: ChatMessage = {
            role: "user",
            content: text,
            parts: [{ type: "text", text }],
            createdAt: new Date(),
        };

        this._isRunning = true;
        this._stopRequested = false;
        this._turnAbortController = new AbortController();

        // An external driver may hand in its own signal; mirror it onto the turn controller so
        // the existing stop path (and only it) remains responsible for tearing the turn down.
        let unlinkSignal: (() => void) | null = null;
        if (options.signal) {
            const externalSignal = options.signal;
            const onExternalAbort = () => this._handleStop();
            if (externalSignal.aborted) onExternalAbort();
            else {
                externalSignal.addEventListener("abort", onExternalAbort, { once: true });
                unlinkSignal = () => externalSignal.removeEventListener("abort", onExternalAbort);
            }
        }

        // The user may have panned/zoomed/switched viewers since the last turn —
        // start the turn from a fresh viewer-context snapshot (it is then memoized
        // across this turn's model steps until a script mutates state).
        (this.chat as any)?.invalidateLiveViewerContext?.();

        this.addMessage(userMsg); // show immediately

        this._updateInputState({ keepStatus: true });
        this._updateSessionPickerState();
        this._setStatus($.t('chat.sendingRequest'));

        this._emit("turn-start", {
            sessionId: this.chatService.getActiveSessionId(),
            userText: text,
            source,
        });

        let outcome: ChatTurnOutcome = { kind: "error", reason: "unknown", rendered: false };
        let turnError: unknown = undefined;

        try {
            await this._ensureActiveSession({ preserveMessages: true });
            outcome = await this._runAssistantLoop(this.MAX_SCRIPT_STEPS, this._turnAbortController.signal);

            // A turn that ends with an empty transcript and no explanation is never
            // correct. A stop is the one benign case — the user knows why it ended.
            if (!outcome.rendered && outcome.kind !== "stopped") {
                console.error("[ChatPanel] turn produced no visible message", outcome);
                this._pushErrorBubble($.t('chat.turnEndedWithoutAnswer', { reason: outcome.reason }));
            }

            if (outcome.kind === "stopped") {
                this._setStatus($.t('chat.stopped'));
            } else if (!this._stopRequested) {
                await this._refreshSessionsForCurrentProvider({ autoLoadLatest: false });
                this._sessionPicker?.setActiveSession(this.chatService.getActiveSessionId());
                this._updateSessionTitle(this._sessions.find((s) => s.id === this.chatService.getActiveSessionId()) || null);
                this._setStatus($.t('chat.ready'));
            } else {
                this._setStatus($.t('chat.stopped'));
            }
        } catch (err) {
            const detail = this._toErrorText(err, $.t('chat.assistantCouldNotComplete'));
            turnError = err;

            // Our own stop is authoritative and must be checked by signal, not by error
            // shape: _handleStop aborts with a plain string reason, so the rejection that
            // unwinds the loop carries no AbortError name to recognize.
            if (this._stopRequested) {
                outcome = { kind: "stopped", reason: "stopped-by-user", rendered: false };
                this._setStatus($.t('chat.stopped'));
            } else if (this.chatService?.isAbortError?.(err)) {
                const timedOut = /timeout|timed out|deadline/i.test(detail);
                this._pushErrorBubble(
                    timedOut
                        ? $.t('chat.requestTimedOut')
                        : $.t('chat.requestInterrupted'),
                    err
                );
                outcome = { kind: "error", reason: timedOut ? "timeout" : "interrupted", rendered: true };
                this._setStatus($.t('chat.turnFailed'));
            } else {
                console.error("Chat loop failed:", err);
                this._pushErrorBubble($.t('chat.assistantCouldNotComplete'), err);
                outcome = { kind: "error", reason: "turn-threw", rendered: true };
                this._setStatus($.t('chat.turnFailed'));
            }
        } finally {
            this._isRunning = false;
            this._stopRequested = false;
            this._turnAbortController = null;
            unlinkSignal?.();
            this.chatService?.cancelActiveTurn?.();
            this._messageList?.removeProgress();
            this._updateInputState({ keepStatus: true });
            this._updateSessionPickerState();

            // The turn funnel. `_runAssistantLoop`'s finish() only covers the loop's own
            // returns — a throw from _ensureActiveSession or the transport bypasses it
            // entirely, so the event has to be raised here to cover every terminal path.
            this._emit("turn-complete", {
                sessionId: this.chatService?.getActiveSessionId?.() ?? null,
                userText: text,
                source,
                outcome,
                messages: this._messages.slice(),
                ...(turnError !== undefined ? { error: turnError } : {}),
            });
        }

        return outcome;
    }

    _handleStop(event?: Event): void {
        event?.preventDefault?.();
        if (!this._isRunning) return;

        this._stopRequested = true;
        this._setStatus($.t('chat.stopping'));
        this._messageList?.updateProgress($.t('chat.stopping'));
        this._turnAbortController?.abort("Stopped by user.");
        this.chatService?.cancelActiveTurn?.("Stopped by user.");
        this._updateInputState({ keepStatus: true });
    }

    _shouldStopAssistantLoop(): boolean {
        return !!this._stopRequested || !!this._turnAbortController?.signal?.aborted;
    }

    /**
     * Run the turn to a terminal state and SAY WHICH ONE.
     *
     * Every exit reports an outcome, and `rendered` records whether the user actually
     * got something in the transcript. A turn that ends with `rendered: false` and no
     * stop behind it is a bug: the model was billed, the server logged a reply, and the
     * user saw an empty panel with no error. `_handleSubmit` surfaces that rather than
     * letting it pass as success.
     */
    async _runAssistantLoop(maxSteps: number, signal?: AbortSignal): Promise<AssistantTurnOutcome> {
        const chatModule = this.chat;
        let rendered = false;
        const finish = (kind: AssistantTurnOutcome["kind"], reason: string): AssistantTurnOutcome => {
            console.debug(`[ChatPanel] turn ended: ${kind} (${reason}), rendered=${rendered}`);
            return { kind, reason, rendered };
        };
        let allowedSteps = Math.max(1, Number(maxSteps || this.MAX_SCRIPT_STEPS || 12));
        let extensionsUsed = 0;
        let consecutiveSuccessfulScriptSteps = 0;
        let consecutiveFailedScriptSteps = 0;
        const maxConsecutiveFailedScriptSteps = 3;
        let consecutiveEmptyReplies = 0;
        const maxConsecutiveEmptyReplies = 3;

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

        this._messageList?.showProgress($.t('chat.understandingRequest'));

        try {
            for (let step = 0; step < allowedSteps; step++) {
                if (this._shouldStopAssistantLoop()) return finish("stopped", "stop-before-send");

                this._setStatus(step === 0 ? $.t('chat.sending') : $.t('chat.thinking'));
                // Only the activity line moves here. The note keeps whatever the assistant last
                // said about what it is doing — that outlives the silent seconds of this call.
                this._messageList?.updateProgress(step === 0 ? $.t('chat.understandingRequest') : $.t('chat.thinking'));
                this._messageList?.setProgressStep(step + 1);

                this._beginStreamStep();
                let reply: ChatMessage;
                try {
                    reply = await this.chatService.sendMessage(this._providerId!, this._messages.slice(), {
                        signal,
                        onDelta: (accumulated) => this._onStreamDelta(accumulated),
                    });
                } finally {
                    this._endStreamStep();
                }
                if (this._shouldStopAssistantLoop()) {
                    // The reply already exists and was paid for — keep it, and show it if it
                    // is a plain answer. Dropping it here is what made a stopped turn look
                    // like nothing ever happened.
                    this._messages.push(reply);
                    if (!chatModule.extractScriptFromAssistantMessage?.(reply)) {
                        this._messageList?.removeProgress();
                        this._messageList?.addMessage(reply);
                        rendered = true;
                    }
                    return finish("stopped", "stop-after-send");
                }

                if ((reply as any)?.metadata?.historyTruncatedTo != null) {
                    this._setStatus($.t('chat.historyTruncatedHint'));
                }

                const script = chatModule.extractScriptFromAssistantMessage?.(reply);
                // A reply cut off at the output limit usually ends mid-script, which then
                // matches no fence and would quietly do nothing. Name it instead.
                const outputTruncated = (reply as any)?.metadata?.outputTruncated === true
                    || (!script && chatModule.hasUnterminatedScriptFence?.(reply) === true);
                if (outputTruncated) {
                    this._setStatus($.t('chat.outputTruncatedHint'));
                }
                // An unusable reply sanitised down to nothing is kept out of the history it would
                // otherwise pollute: replaying an empty assistant turn teaches the model nothing
                // and some providers reject empty content outright. The guard below re-prompts
                // with explicit host feedback instead.
                const sanitizedToEmpty = (reply as any)?.metadata?.sanitizedToEmpty === true;
                if (!sanitizedToEmpty) this._messages.push(reply);
                if (script && this._displayMode === "all") {
                    // In user-friendly mode this prose goes to the progress bubble instead, so the
                    // transcript keeps only the question and the final answer.
                    const placeholder = this._createAssistantScriptPlaceholder(reply);
                    if (!this._isHiddenInternalMessage(placeholder)) {
                        this._messageList?.addMessage(placeholder);
                    }
                }
                this._messageList?.setProgressNote(this._progressNote(reply));
                this._messageList?.updateProgress(this._progressActivity(script, null, step));

                if (!script) {
                    // The model said something the runtime could not use at all (typically a
                    // native tool-call envelope with no readable payload, sanitised away to
                    // nothing). An empty bubble presented as the final answer is how this
                    // failure used to pass for a completed turn — retry, then fail loudly.
                    if (sanitizedToEmpty) {
                        consecutiveSuccessfulScriptSteps = 0;
                        consecutiveEmptyReplies += 1;
                        if (consecutiveEmptyReplies >= maxConsecutiveEmptyReplies) {
                            const userText = $.t('chat.emptyReplies', { count: maxConsecutiveEmptyReplies });
                            const visibleMessage: ChatMessage = {
                                role: "assistant",
                                content: userText,
                                parts: [{ type: "text", text: userText }],
                                metadata: { uiVariant: "error", reason: "empty-replies" } as any,
                                createdAt: new Date(),
                            };
                            this._messages.push(visibleMessage);
                            this._messageList?.removeProgress();
                            this._messageList?.addMessage(visibleMessage);
                            rendered = true;
                            this._setStatus($.t('chat.stoppedAfterEmptyReplies'));
                            return finish("error", "empty-replies");
                        }

                        this._setStatus($.t('chat.emptyReplyHint'));
                        const nudge =
                            "Your previous reply contained no content this runtime could read. " +
                            "Native tool-call syntax and channel tokens are not available here and are discarded. " +
                            "Reply again in plain text, and if you need to act, use exactly one ```xopat-script fenced block.";
                        this._pushInternalMessage({
                            role: "tool",
                            content: nudge,
                            parts: [{ type: "host-feedback", text: nudge }],
                            metadata: {
                                hiddenFromChatUi: true,
                                internalSource: "script-runtime",
                                reason: "empty-reply-guard",
                            } as any,
                            createdAt: new Date(),
                        });
                        continue;
                    }

                    consecutiveEmptyReplies = 0;
                    this._messageList?.removeProgress();
                    this._messageList?.addMessage(reply);
                    rendered = true;
                    return finish("answered", "final-answer");
                }

                consecutiveEmptyReplies = 0;

                this._setStatus($.t('chat.executingScript'));
                this._messageList?.beginProgressStep(this._scriptStepLabel(script));

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

                this._messageList?.endProgressStep(!failedScript);

                if (this._shouldStopAssistantLoop()) return finish("stopped", "stop-after-script");

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
                this._messageList?.updateProgress(this._progressActivity(script, executionMessage, step));

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
                    const terminalError = String(executionMessage.content || $.t('chat.repeatedScriptFailuresShort'));
                    console.debug("[ChatPanel] repeated-script-failures terminal", terminalError);
                    const summaryLine = this._oneLineErrorSummary(terminalError);
                    const userText = $.t('chat.repeatedScriptFailures', {
                        count: maxConsecutiveFailedScriptSteps,
                        error: summaryLine,
                    });
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
                    rendered = true;
                    this._setStatus($.t('chat.stoppedAfterFailures'));
                    return finish("error", "repeated-script-failures");
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
                    this._setStatus($.t('chat.continuingAutomation', { steps: allowedSteps }));
                }
            }

            if (this._shouldStopAssistantLoop()) return finish("stopped", "stop-at-step-cap");

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
            this._messageList?.updateProgress($.t('chat.preparingFinalAnswer'));

            this._beginStreamStep();
            let finalReply: ChatMessage;
            try {
                finalReply = await this.chatService.sendMessage(this._providerId!, this._messages.slice(), {
                    signal,
                    onDelta: (accumulated) => this._onStreamDelta(accumulated),
                });
            } finally {
                this._endStreamStep();
            }
            if (this._shouldStopAssistantLoop()) {
                // Same bargain as the in-loop stop: the answer exists, so show it.
                this._messages.push(finalReply);
                if (!chatModule.extractScriptFromAssistantMessage?.(finalReply)) {
                    this._messageList?.removeProgress();
                    this._messageList?.addMessage(finalReply);
                    rendered = true;
                }
                return finish("stopped", "stop-after-final-send");
            }

            if (chatModule.extractScriptFromAssistantMessage?.(finalReply)) {
                const stepLimitText = $.t('chat.stepLimitNoFinalAnswer');
                const visibleMessage: ChatMessage = {
                    role: "assistant",
                    content: stepLimitText,
                    parts: [{
                        type: "text",
                        text: stepLimitText,
                    }],
                    metadata: { uiVariant: "error", reason: "script-step-limit-without-final-answer" } as any,
                    createdAt: new Date(),
                };

                this._messages.push(visibleMessage);
                this._messageList?.removeProgress();
                this._messageList?.addMessage(visibleMessage);
                rendered = true;
                this._setStatus($.t('chat.noFinalAnswer'));
                return finish("error", "script-step-limit-without-final-answer");
            }

            this._messages.push(finalReply);
            this._messageList?.removeProgress();
            this._messageList?.addMessage(finalReply);
            rendered = true;
            return finish("answered", "final-answer-after-step-cap");
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

    /**
     * The assistant's own words for what it is about to do, cut down to a hint-sized snippet:
     * the first sentences of the reply prose (the script and any reasoning removed), with viewer
     * handles resolved back to their real labels.
     */
    /** Reset per-step streaming state; deltas may start arriving right after. */
    _beginStreamStep(): void {
        this._streamStepActive = true;
        this._streamPreviewBuffer = "";
        this._fenceExitTriggered = false;
    }

    /** Close the step: the finalized reply (or error) replaces the transient preview. */
    _endStreamStep(): void {
        this._streamStepActive = false;
        this._streamPreviewBuffer = "";
        this._messageList?.endStreamingPreview();
    }

    /**
     * Streamed-delta observer. Trailing-edge coalescer (~200ms, mirroring the
     * workspace-change coalescer in chat.ts): per tick it (1) cuts the stream
     * the moment a COMPLETE ```xopat-script fence is buffered — the loop was
     * going to execute the script and re-prompt anyway, so trailing prose is
     * paid-for-and-discarded tokens — and (2) renders the preview: raw text in
     * dev ('all') mode, script/reasoning-stripped prose otherwise.
     */
    _onStreamDelta(accumulated: string): void {
        this._streamPreviewBuffer = accumulated;
        if (this._streamPreviewTickPending) return;
        this._streamPreviewTickPending = true;
        setTimeout(() => {
            this._streamPreviewTickPending = false;
            this._streamPreviewTick();
        }, 200);
    }

    _streamPreviewTick(): void {
        if (!this._streamStepActive) return; // reply already landed; never resurrect the preview
        const raw = this._streamPreviewBuffer;
        if (!raw) return;

        // Complete script fence → abort the remainder of the generation. Uses the
        // extractor's own pattern (chat.ts): what triggers the exit is exactly
        // what will execute. The service synthesizes the partial reply under the
        // deterministic id, so the loop proceeds with zero extra latency.
        if (!this._fenceExitTriggered && /```xopat-script[\s\S]*?```/i.test(raw)) {
            this._fenceExitTriggered = true;
            this.chatService.cancelActiveTurn('fence-complete');
            return;
        }

        const text = this._displayMode === "all" ? raw : this._streamPreviewProse(raw);
        if (!text.trim()) return;
        this._messageList?.updateStreamingPreview(text);
        this._messageList?.updateProgress($.t('chat.streamingAnswer'));
    }

    /** Prose for the user-friendly preview: drop (possibly unterminated) code fences + reasoning, restore friendly names. */
    _streamPreviewProse(raw: string): string {
        let text = String(raw || "").replace(/```(?:xopat-script|xopat-host-script|javascript|js|ts)[\s\S]*?(?:```|$)/gi, "");
        text = this._stripAssistantReasoning(text);
        return String(this.chat?.presentTextForUser?.(text) ?? text).trim();
    }

    _progressProse(reply?: ChatMessage | null): string {
        if (!reply) return "";
        const extracted = this.chat?.extractAssistantTextWithoutScript?.(reply) || "";
        const stripped = this._stripAssistantReasoning(extracted);
        const text = String(this.chat?.presentTextForUser?.(stripped) ?? stripped)
            .replace(/\s+/g, " ")
            .trim();
        if (!text) return "";

        const MAX = 200;
        let snippet = "";
        for (const sentence of text.match(/[^.!?]+[.!?]*/g)?.slice(0, 2) || []) {
            if (snippet && (snippet.length + sentence.length) > MAX) break;
            snippet += sentence;
        }
        snippet = (snippet || text).trim();
        return snippet.length > MAX ? `${snippet.slice(0, MAX).trimEnd()}…` : snippet;
    }

    /**
     * The sticky progress note: the assistant's own words, or "" when it emitted script only.
     * "" leaves the previous note standing — never overwrite the model's words with a generic
     * phrase, those belong to `_progressActivity`.
     */
    _progressNote(reply?: ChatMessage | null): string {
        return this._progressProse(reply);
    }

    /**
     * The churning activity line: what the host is doing right now, named after the scripting
     * namespace the emitted script calls (the chat is non-streaming, so nothing at all is known
     * until the whole reply lands).
     */
    _progressActivity(script?: string | null, executionMessage?: ChatMessage | null, step: number = 0): string {
        const execText = String(executionMessage?.content || "");

        if (/Script execution failed/i.test(execText)) return $.t('chat.retryingAfterError');
        if (/hard cap/i.test(execText)) return $.t('chat.finishingResponse');

        const namespace = this._scriptNamespace(script);
        if (namespace) {
            const key = PROGRESS_KEY_BY_NAMESPACE[namespace];
            if (key) return $.t(key);
            return $.t('chat.progressUsingCapability', { title: this.chat.namespaceTitle(namespace) });
        }
        return step === 0 ? $.t('chat.understandingRequest') : $.t('chat.continuingAnalysis');
    }

    _scriptNamespace(script?: string | null): string | undefined {
        return script ? this.chat?.getScriptNamespaces?.(script)?.[0] : undefined;
    }

    /** Trail label for one executed script — its capability, or a generic step name. */
    _scriptStepLabel(script?: string | null): string {
        const namespace = this._scriptNamespace(script);
        if (!namespace) return $.t('chat.progressRunningStep');
        return this.chat?.namespaceTitle?.(namespace) || $.t('chat.progressRunningStep');
    }
}
