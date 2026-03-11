import type { ChatMessage, ChatPersonality, ChatProviderConfig, ChatService } from "./chatService";
import type { ChatModule } from "./chat";

const { BaseComponent, Button, FAIcon, Checkbox } = (globalThis as any).UI;
const { div, span, select, option, textarea, fieldset, legend } = (globalThis as any).van.tags;

type ChatPanelOptions = {
    id?: string;
    chatService: ChatService;
    defaultProviderId?: string | null;
    defaultPersonalityId?: string | null;
    markdownEnabled?: boolean;
    sanitizeConfig?: any;
};

type ScriptConsentEntry = {
    title: string;
    granted: boolean;
    description?: string;
};

export class ChatPanel extends BaseComponent {
    MAX_SCRIPT_STEPS = 9;

    chat: ChatModule;
    chatService: ChatService;

    _providerId: string | null;
    _personalityId: string | null;
    _messages: ChatMessage[];
    _consentConfigured: boolean;

    _root: HTMLElement | null;
    _messageListEl: HTMLElement | null;
    _inputEl: HTMLTextAreaElement | null;
    _sendBtnEl: any;
    _statusEl: HTMLElement | null;
    _loginBtn: any;
    _consentOverlay: HTMLElement | null;
    _providerSelectEl: HTMLSelectElement | null;
    _personalitySelectEl: HTMLSelectElement | null;

    _displayMode: "all" | "user-friendly";
    _currentPendingBubble: { line: HTMLElement; content: HTMLElement } | null;

    _sanitizeConfig: any;

    declare options: ChatPanelOptions;
    declare classMap: Record<string, string>;

    constructor(options: ChatPanelOptions = void 0 as any) {
        super(options);
        options = this.options;

        this.chat = (window as any).xmodules.chat.ChatModule!.instance();
        this.chatService = options.chatService;

        if (!this.chatService) {
            console.warn("ChatPanel: UI.Services.Chat not available; provide chatService option.");
        }

        this._providerId = options.defaultProviderId || null;
        this._personalityId = options.defaultPersonalityId || null;
        this._messages = [];
        this._consentConfigured = false;

        this._displayMode = "user-friendly";
        this._currentPendingBubble = null;

        this._root = null;
        this._messageListEl = null;
        this._inputEl = null;
        this._sendBtnEl = null;
        this._statusEl = null;
        this._loginBtn = null;
        this._consentOverlay = null;
        this._providerSelectEl = null;
        this._personalitySelectEl = null;

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
                "table","thead","tbody","tr","th","td"
            ],
            allowedAttributes: {
                a: ["href","title","target","rel"],
                code: ["class"],
                pre: ["class"]
            },
            allowedSchemes: ["http","https","mailto"],
            transformTags: {
                a: (tagName: string, attribs: Record<string, string>) => {
                    const attrs = { ...attribs };
                    attrs.target = "_blank";
                    attrs.rel = "noopener noreferrer";
                    return { tagName, attribs: attrs };
                }
            }
        };
    }

    refreshProviders(): void {
        if (!this._providerSelectEl || !this.chatService) return;

        const providers = this.chatService.getProviders();
        this._providerSelectEl.innerHTML = "";
        this._providerSelectEl.appendChild(option({ value: "" }, "Select model…"));

        providers.forEach((p: ChatProviderConfig) => {
            this._providerSelectEl!.appendChild(option({ value: p.id }, p.label));
        });

        if (this._providerId && this.chatService.getProvider(this._providerId)) {
            this._providerSelectEl.value = this._providerId;
        } else {
            this._providerId = null;
            this._providerSelectEl.value = "";
            this._onProviderChange("");
        }
        this._updateLoginButtonState();
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
            if (typeof this.chatService.setPersonality === "function") {
                this.chatService.setPersonality(this._personalityId);
            }
        } catch (e) {
            console.warn("Failed to set personality:", e);
        }

        this.clearMessages();

        if (this._personalityId) {
            const p = typeof this.chatService.getPersonality === "function"
                ? this.chatService.getPersonality(this._personalityId)
                : null;
            const label = p?.label || this._personalityId;
            this.addMessage({ role: "user", content: `Personality set to: ${label}` });
        }
    }

    _rerenderMessages(): void {
        if (!this._messageListEl) return;
        this._messageListEl.innerHTML = "";

        for (const msg of this._messages) {
            this._renderMessageToDom(msg);
        }

        if (this._displayMode === "user-friendly" && this._currentPendingBubble) {
            this._currentPendingBubble = this._createPendingAssistantBubble();
        }

        this._scrollMessagesToEnd();
    }

    _getFriendlyProgressText(reply?: ChatMessage, executionMessage?: ChatMessage, step?: number): string {
        const replyText = String(reply?.content || "");
        const execText = String(executionMessage?.content || "");

        if (execText.includes("Script execution failed")) {
            return "Adjusting the lookup after an execution error…";
        }

        if (/metadata/i.test(replyText)) {
            return "Reading slide metadata…";
        }

        if (/active viewer|selects the current viewer|setActiveViewer/i.test(replyText)) {
            return "Selecting the active viewer…";
        }

        if (/context/i.test(replyText)) {
            return "Checking available viewer contexts…";
        }

        return step === 0 ? "Looking up the slide…" : "Continuing analysis…";
    }

    create(): HTMLElement {
        const displayModeSelect = select({
                class: "select select-xs select-bordered max-w-xs mr-2",
                onchange: (e: Event) => {
                    this._displayMode = ((e.target as HTMLSelectElement).value as any) || "user-friendly";
                    this._rerenderMessages();
                },
            },
            option({ value: "user-friendly" }, "User-friendly"),
            option({ value: "all" }, "All history")
        ) as HTMLSelectElement;

        displayModeSelect.value = this._displayMode;

        this._personalitySelectEl = select({
            class: "select select-xs select-bordered max-w-xs mr-2",
            onchange: (e: Event) => this._onPersonalityChange((e.target as HTMLSelectElement).value),
        }) as HTMLSelectElement;

        this._providerSelectEl = select({
            class: "select select-xs select-bordered max-w-xs mr-2",
            onchange: (e: Event) => this._onProviderChange((e.target as HTMLSelectElement).value),
        }) as HTMLSelectElement;

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

        const headerRow = div(
            { class: "flex items-center justify-between px-2 py-1 border-b border-base-300 bg-base-200" },
            div(
                { class: "flex items-center gap-2" },
                new FAIcon({ name: "fa-comments" }).create(),
                span({ class: "font-semibold text-xs" }, "Pathology Assistant")
            ),
            div(
                { class: "flex items-center gap-2" },
                this._providerSelectEl,
                this._loginBtn.create()
            )
        );

        this._statusEl = span({ class: "text-[11px] text-base-content/70" }) as HTMLElement;
        const statusBar = div(
            { class: "flex px-2 py-1 border-b border-base-200 bg-base-100 text-[11px] content-between" },
            this._statusEl,
            fieldset(legend({ class: "fieldset-legend" }, "Personality"), this._personalitySelectEl, displayModeSelect)
        );

        this._messageListEl = div({ class: "flex-1 overflow-auto px-2 py-2 bg-base-100", id: this.id + "-messages" }) as HTMLElement;

        this._inputEl = textarea({
            class: "textarea textarea-bordered textarea-xs w-full resize-none mb-1",
            rows: 3,
            placeholder: "Ask something or request an automation…",
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._handleSend(e);
            },
        }) as HTMLTextAreaElement;

        const settingsIcon = new FAIcon({ name: "fa-shield-halved", extraClasses: { extra: "mr-2 text-sm" } }).create() as HTMLElement;
        settingsIcon.onclick = () => this._openConsentDialog();

        this._sendBtnEl = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { ml: "ml-3" },
                extraProperties: { title: "Send message" },
                onClick: (e: Event) => this._handleSend(e),
            },
            new FAIcon({ name: "fa-paper-plane" }),
            span("Send")
        ).create();

        const inputArea = div(
            { class: "border-t border-base-300 bg-base-100 px-2 py-2 flex flex-col gap-1" },
            this._inputEl,
            div({ class: "flex items-center justify-between text-[10px]" },
                span(settingsIcon, span("Press Ctrl+Enter to send")),
                this._sendBtnEl
            )
        );

        this._consentOverlay = this._buildConsentOverlay();

        const root = div(
            { ...this.commonProperties, ...this.extraProperties },
            headerRow,
            statusBar,
            this._messageListEl,
            inputArea,
            this._consentOverlay
        ) as HTMLElement;

        this._root = root;

        this.refreshProviders();
        this.refreshPersonalities();
        this._setStatus("Select a model to start.");
        this._updateInputState();
        this.refreshScriptConsent();

        return root;
    }

    addMessage(msg: ChatMessage): void {
        this._messages.push({
            ...msg,
            createdAt: msg.createdAt || new Date(),
        });
        this._renderMessageToDom(msg);
        this._scrollMessagesToEnd();
    }

    clearMessages(): void {
        this._messages = [];
        if (this._messageListEl) {
            this._messageListEl.innerHTML = "";
        }
    }

    refreshScriptConsent(): void {
        if (!this._consentOverlay) return;

        const content = this._consentOverlay.querySelector("[data-script-consent-list]") as HTMLElement | null;
        if (!content) return;

        const chatModule = this.chat;
        const entries = chatModule?.getScriptConsentEntries?.() || {};

        content.innerHTML = "";

        const allEntries = Object.entries(entries);

        if (!allEntries.length) {
            content.appendChild(
                div({ class: "text-xs text-base-content/70 italic" }, "No scripting namespaces are currently available.")
            );
            return;
        }

        allEntries.forEach(([namespace, value]: [string, ScriptConsentEntry]) => {
            const wrapper = div({ class: "flex flex-col gap-1" });
            const checkbox = new Checkbox({
                label: value.title,
                checked: value.granted,
                onchange: (e: Event) => {
                    const checked = !!((e.target as HTMLInputElement).checked);
                    chatModule?.setScriptNamespaceConsent?.(namespace, checked);
                }
            }).create();

            wrapper.appendChild(checkbox);

            if (value.description) {
                wrapper.appendChild(
                    div({ class: "text-[11px] text-base-content/70 pl-6" }, value.description)
                );
            }

            content.appendChild(wrapper);
        });
    }

    _setStatus(text: string | null | undefined): void {
        if (this._statusEl) {
            this._statusEl.textContent = text || "";
        }
    }

    _isReady(): boolean {
        if (!this._providerId || !this.chatService) return false;

        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return false;

        if (provider.requiresLogin !== false && !this.chatService.isAuthenticated(this._providerId)) {
            return false;
        }

        return this._consentConfigured;
    }

    _updateInputState({ keepStatus = false }: { keepStatus?: boolean } = {}): void {
        const ready = this._isReady();
        if (this._inputEl) this._inputEl.disabled = !ready;
        if (this._sendBtnEl) this._sendBtnEl.disabled = !ready;

        if (!keepStatus) {
            if (!ready) {
                this._setStatus("Login and scripting permission review are required before chatting.");
            } else {
                this._setStatus("You can chat with the selected model.");
            }
        }
    }

    _updateLoginButtonState(): void {
        if (!this._loginBtn || !this.chatService) return;

        if (!this._providerId) {
            this._loginBtn.toggleClass("hidden", "hidden", false);
            this._loginBtn.setExtraProperty("disabled", "disabled");
            return;
        }

        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) {
            this._loginBtn.disabled = true;
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

    _buildConsentOverlay(): HTMLElement {
        const scriptConsentList = div(
            { class: "flex flex-col gap-2", "data-script-consent-list": "" }
        );

        const actions = div(
            { class: "mt-2 flex justify-between gap-2" },
            new Button(
                {
                    size: Button.SIZE.SMALL,
                    type: Button.TYPE.NONE,
                    extraClasses: { base: "btn btn-sm" },
                    extraProperties: { title: "Cancel" },
                    onClick: () => this._closeConsentDialog(),
                },
                span("Cancel")
            ).create(),
            new Button(
                {
                    size: Button.SIZE.SMALL,
                    type: Button.TYPE.PRIMARY,
                    extraClasses: { base: "btn btn-sm" },
                    extraProperties: { title: "Continue" },
                    onClick: () => this._applyConsentAndContinue(),
                },
                new FAIcon({ name: "fa-check" }).create(),
                span("Continue")
            ).create()
        );

        const box = div(
            {
                class:
                    "bg-base-100 rounded-lg shadow-xl border border-base-300 w-full max-w-md p-4 flex flex-col gap-3",
            },
            div(
                { class: "flex items-center justify-between mb-1" },
                span({ class: "font-semibold text-lg" }, "Scripting access"),
                new FAIcon({ name: "fa-shield-halved" }).create()
            ),
            span(
                { class: "text-[11px] text-base-content/80" },
                "Choose which scripting namespaces the assistant may use. Without granted namespaces, the assistant only sees what you type in chat."
            ),
            fieldset(
                { class: "fieldset" },
                legend({ class: "fieldset-legend" }, "Allowed scripting namespaces"),
                scriptConsentList
            ),
            actions
        ) as HTMLElement;

        return div({
            class: "hidden fixed inset-0 z-50 flex items-center justify-center bg-base-300/70",
        }, box) as HTMLElement;
    }

    _onProviderChange(providerId: string): void {
        this._providerId = providerId || null;
        this.clearMessages();

        this._updateLoginButtonState();

        if (!providerId) {
            this._consentConfigured = false;
            this._setStatus("Select a model to start.");
            this._updateInputState();
            return;
        }

        const provider = this.chatService?.getProvider(providerId);
        if (!provider) {
            this._consentConfigured = false;
            this._setStatus("Unknown provider.");
            this._updateInputState();
            return;
        }

        const requiresLogin = provider.requiresLogin !== false;
        const authed = this.chatService.isAuthenticated(providerId);

        if (requiresLogin && !authed) {
            this._consentConfigured = false;
            this._setStatus("Model selected. Please log in first.");
            this._updateInputState();
            return;
        }

        this._consentConfigured = false;
        this._openConsentDialog();
    }

    async _handleLoginClick(): Promise<void> {
        if (!this._providerId || !this.chatService) return;
        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return;

        try {
            this._setStatus("Logging in…");
            this._loginBtn?.toggleClass?.("loading", "loading", true);

            await this.chatService.login(this._providerId);

            this._setStatus("Login successful. Please review scripting access.");
            this._openConsentDialog();
        } catch (err) {
            console.error("ChatPanel login failed:", err);
            this._consentConfigured = false;
            this._closeConsentDialog();
            this._setStatus("Login failed. Please try again. See console for details.");
        } finally {
            this._loginBtn?.toggleClass?.("loading", "loading", false);
            this._updateInputState({ keepStatus: true });
            this._updateLoginButtonState();
        }
    }

    _openConsentDialog(): void {
        this.chat?.refreshScriptConsentFromManager?.();
        this.refreshScriptConsent();
        if (!this._consentOverlay) return;
        this._consentOverlay.classList.remove("hidden");
    }

    _closeConsentDialog(): void {
        if (!this._consentOverlay) return;
        this._consentOverlay.classList.add("hidden");
    }

    _isRuntimeFeedbackMessage(msg: ChatMessage): boolean {
        const text = String(msg?.content || "");
        return (
            text.startsWith("Script execution failed.") ||
            text.startsWith("Script execution result:") ||
            text.startsWith("Execution stopped after reaching the hard cap")
        );
    }

    _isAssistantScriptMessage(msg: ChatMessage): boolean {
        if (msg.role !== "assistant") return false;
        return !!this.chat?.extractScriptFromAssistantMessage?.(msg);
    }

    _getDisplayKind(msg: ChatMessage): "user" | "assistant" | "runtime" {
        if (this._isRuntimeFeedbackMessage(msg)) return "runtime";
        if (msg.role === "user") return "user";
        return "assistant";
    }

    _shouldRenderMessage(msg: ChatMessage): boolean {
        if (this._displayMode === "all") return true;

        if (msg.role === "user" && !this._isRuntimeFeedbackMessage(msg)) return true;
        if (msg.role === "assistant" && !this._isAssistantScriptMessage(msg)) return true;

        return false;
    }

    _applyConsentAndContinue(): void {
        this._consentConfigured = true;
        this._closeConsentDialog();
        this._updateInputState();
    }

    _scrollMessagesToEnd(): void {
        if (!this._messageListEl) return;
        this._messageListEl.scrollTop = this._messageListEl.scrollHeight;
    }

    _renderMessageToDom(msg: ChatMessage): void {
        if (!this._messageListEl) return;
        if (!this._shouldRenderMessage(msg)) return;

        const kind = this._getDisplayKind(msg);

        const isUser = kind === "user";
        const isRuntime = kind === "runtime";

        const bubbleCls = isUser
            ? "bg-base-200 text-base-content border border-base-300 shadow-sm"
            : isRuntime
                ? "bg-base-200/40 text-base-content/70 border border-base-300 italic"
                : "";

        const message = span() as HTMLElement;
        this._renderMessageContent(message, msg);

        const line = div(
            { class: "flex mb-2 " + (isUser ? "justify-end" : "justify-start") },
            div(
                {
                    class:
                        "w-[88%] max-w-[100%] rounded-xl px-3 py-1.5 text-[12px] leading-snug whitespace-pre-wrap chat-md " +
                        bubbleCls,
                },
                message
            )
        ) as HTMLElement;

        this._messageListEl.appendChild(line);
    }

    _getMarkdownRenderer(): ((md: string) => string) | null {
        const m = (window as any).xnpm && (window as any).xnpm?.["marked"];
        if (!m) return null;

        if (typeof m.parse === "function") return (md: string) => m.parse(md);
        if (m.marked && typeof m.marked.parse === "function") return (md: string) => m.marked.parse(md);
        if (typeof m === "function") return (md: string) => m(md);
        return null;
    }

    _ensurePendingBubble(): { line: HTMLElement; content: HTMLElement } | null {
        if (this._currentPendingBubble) return this._currentPendingBubble;
        this._currentPendingBubble = this._createPendingAssistantBubble();
        return this._currentPendingBubble;
    }

    _removePendingBubble(): void {
        if (!this._currentPendingBubble) return;
        this._currentPendingBubble.line.remove();
        this._currentPendingBubble = null;
    }

    _sanitizeHtml(html: string): string {
        const sanitizer = (window as any).SanitizeHtml;
        if (!sanitizer) return 'ERROR: missing "sanitize-html" package. Insecure HTML is not rendered.';

        const config = this._sanitizeConfig || this.options?.sanitizeConfig || {};

        if (typeof sanitizer.sanitize === "function") return sanitizer.sanitize(html, config);
        if (typeof sanitizer === "function") return sanitizer(html, config);

        return html;
    }

    _renderMessageContent(el: HTMLElement, message: ChatMessage): void {
        const content = (message && message.content) ? String(message.content) : "";
        const markdownEnabled = this.options?.markdownEnabled !== false;

        if (markdownEnabled && message.role === "assistant") {
            const renderMd = this._getMarkdownRenderer();
            if (renderMd) {
                try {
                    const rawHtml = renderMd(content);
                    const safeHtml = this._sanitizeHtml(rawHtml);
                    el.innerHTML = safeHtml;
                    return;
                } catch (e) {
                    console.warn("Markdown render failed; falling back to textContent", e);
                }
            } else {
                console.warn("Markdown renderer not available; falling back to textContent");
            }
        }

        el.textContent = content;
    }

    async _handleSend(event?: Event): Promise<void> {
        event?.preventDefault?.();
        if (!this._isReady() || !this._inputEl || !this.chatService || !this._providerId) {
            this._updateInputState();
            return;
        }

        const text = this._inputEl.value.trim();
        if (!text) return;

        const userMsg: ChatMessage = {
            role: "user",
            content: text,
            createdAt: new Date(),
        };

        this._inputEl.value = "";

        if (this._sendBtnEl) this._sendBtnEl.disabled = true;

        try {
            await this._runAssistantLoop(userMsg, this.MAX_SCRIPT_STEPS);
            this._setStatus("Ready.");
        } catch (err) {
            console.error("Chat loop failed:", err);
            this._setStatus("Failed. See console for details.");
        } finally {
            this._updateInputState();
        }
    }

    async _runAssistantLoop(initialMessage: ChatMessage, maxSteps: number): Promise<void> {
        const chatModule = this.chat;

        const setProgress = (text: string) => {
            if (!pending) return;
            pending.content.textContent = text;
            this._scrollMessagesToEnd();
        };

        const removePending = () => {
            if (!pending) return;
            pending.line.remove();
            pending = null;
        };

        const getFriendlyProgress = (
            reply?: ChatMessage | null,
            executionMessage?: ChatMessage | null,
            step: number = 0
        ): string => {
            const replyText = String(reply?.content || "");
            const execText = String(executionMessage?.content || "");

            if (/Script execution failed/i.test(execText)) {
                return "Retrying after a script error…";
            }
            if (/hard cap/i.test(execText)) {
                return "Finishing the response…";
            }
            if (/metadata/i.test(replyText)) {
                return "Reading slide metadata…";
            }
            if (/active viewer|setActiveViewer|setActiveContext/i.test(replyText)) {
                return "Selecting the active viewer…";
            }
            if (/context|getGlobalInfo|getContextCount/i.test(replyText)) {
                return "Checking available viewer contexts…";
            }
            return step === 0 ? "Understanding your request…" : "Continuing analysis…";
        };

        let pending: { line: HTMLElement; content: HTMLElement } | null = null;

        this._messages.push(initialMessage);
        this._renderMessageToDom(initialMessage);
        this._scrollMessagesToEnd();

        pending = this._createPendingAssistantBubble();
        setProgress("Understanding your request…");

        try {
            for (let step = 0; step < maxSteps; step++) {
                this._setStatus(step === 0 ? "Sending…" : "Thinking…");

                const reply = await this.chatService.sendMessage(this._providerId!, this._messages.slice());
                this._messages.push(reply);

                const script = chatModule.extractScriptFromAssistantMessage?.(reply);
                setProgress(getFriendlyProgress(reply, null, step));

                if (!script) {
                    removePending();
                    this._renderMessageToDom(reply);
                    this._scrollMessagesToEnd();
                    return;
                }

                this._setStatus("Executing script…");
                setProgress(getFriendlyProgress(reply, null, step));

                let executionMessage: ChatMessage;
                try {
                    executionMessage = await chatModule.executeAssistantScript(script);
                } catch (err) {
                    const errorText = err instanceof Error ? err.message : String(err);
                    executionMessage = {
                        role: "user",
                        content:
                            "Script execution failed.\n" +
                            `Error: ${errorText}\n` +
                            "Please correct the previous response and continue.",
                        createdAt: new Date(),
                    };
                }

                this._messages.push(executionMessage);
                setProgress(getFriendlyProgress(reply, executionMessage, step));
            }

            const capMessage: ChatMessage = {
                role: "user",
                content:
                    `Execution stopped after reaching the hard cap of ${maxSteps} script steps. ` +
                    `Finish with a final user-facing answer without more scripting.`,
                createdAt: new Date(),
            };

            this._messages.push(capMessage);
            setProgress("Preparing the final answer…");

            const finalReply = await this.chatService.sendMessage(this._providerId!, this._messages.slice());
            this._messages.push(finalReply);

            removePending();
            this._renderMessageToDom(finalReply);
            this._scrollMessagesToEnd();
        } finally {
            removePending();
        }
    }

    _createPendingAssistantBubble(): { line: HTMLElement; content: HTMLElement } {
        const content = span({ class: "opacity-70 italic" }, "Thinking…") as HTMLElement;
        const line = div(
            { class: "flex mb-2 justify-start" },
            div(
                { class: "w-[88%] max-w-[100%] rounded-xl px-2 py-2 text-[12px] leading-relaxed whitespace-pre-wrap" },
                content
            )
        ) as HTMLElement;

        this._messageListEl?.appendChild(line);
        this._scrollMessagesToEnd();
        return { line, content };
    }

    // async _handleSend(event?: Event): Promise<void> {
    //     event?.preventDefault?.();
    //     if (!this._isReady() || !this._inputEl || !this.chatService || !this._providerId) {
    //         this._updateInputState();
    //         return;
    //     }
    //
    //     const text = this._inputEl.value.trim();
    //     if (!text) return;
    //
    //     const userMsg: ChatMessage = {
    //         role: "user",
    //         content: text,
    //         createdAt: new Date(),
    //     };
    //     this._messages.push(userMsg);
    //     this._renderMessageToDom(userMsg);
    //     this._inputEl.value = "";
    //     this._scrollMessagesToEnd();
    //
    //     if (this._sendBtnEl) this._sendBtnEl.disabled = true;
    //     this._setStatus("Sending…");
    //
    //     try {
    //         const reply = await this.chatService.sendMessage(this._providerId, this._messages.slice());
    //         this._messages.push(reply);
    //         this._renderMessageToDom(reply);
    //
    //         const chatModule = this.chat;
    //         const script = chatModule?.extractScriptFromAssistantMessage?.(reply);
    //
    //         if (script) {
    //             this._setStatus("Executing script…");
    //             const executionMessage = await chatModule.executeAssistantScript(script);
    //             this._messages.push(executionMessage);
    //             this._renderMessageToDom(executionMessage);
    //         }
    //
    //         this._setStatus("Ready.");
    //     } catch (err) {
    //         console.error("ChatPanel send failed:", err);
    //         this._setStatus("Failed to send message. See console for details.");
    //     } finally {
    //         this._updateInputState();
    //     }
    // }
}