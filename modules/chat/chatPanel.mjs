const { BaseComponent, Button, FAIcon, Div, Checkbox } = globalThis.UI;
const { div, span, select, option, textarea, ul, li, strong } = globalThis.van.tags;

/**
 * Simple chat panel with provider selection, login, consent and message list.
 *
 * @extends UI.BaseComponent
 */
export class ChatPanel extends BaseComponent {
    /**
     * @param {{
     *   id?: string,
     *   chatService?: ChatService,
     * }} [options]
     */
    constructor(options = void 0) {
        super(options);
        options = this.options;

        this.chatService = options.chatService || (globalThis.UI?.Services?.Chat);

        if (!this.chatService) {
            console.warn("ChatPanel: UI.Services.Chat not available; provide chatService option.");
        }

        this._providerId = options.defaultProviderId || null;
        this._messages = [];
        this._consentGranted = false;
        this._consent = { allowScreenshots: false, allowAnnotations: false, allowPHI: false };

        this._root = null;
        this._messageListEl = null;
        this._inputEl = null;
        this._sendBtnEl = null;
        this._statusEl = null;
        this._loginBtn = null;
        this._consentOverlay = null;
        this._providerSelectEl = null; // New ref for dynamic updates

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
                a: (tagName, attribs) => {
                    // ensure safe links
                    const attrs = { ...attribs };
                    attrs.target = "_blank";
                    attrs.rel = "noopener noreferrer";
                    return { tagName, attribs: attrs };
                }
            }
        };
    }

    // ... (Keep existing methods: addMessage, clearMessages, _setStatus, _isReady, _updateInputState, _onProviderChange, _handleLoginClick, _openConsentDialog, _closeConsentDialog, _applyConsentAndContinue, _scrollMessagesToEnd, _renderMessageToDom, _handleSend) ...

    /**
     * Rebuilds the model select dropdown when new providers are registered.
     */
    refreshProviders() {
        if (!this._providerSelectEl || !this.chatService) return;

        const providers = this.chatService.getProviders();
        this._providerSelectEl.innerHTML = "";
        this._providerSelectEl.appendChild(option({ value: "" }, "Select model…"));

        providers.forEach((p) => {
            this._providerSelectEl.appendChild(option({ value: p.id }, p.label));
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

    create() {
        // Build the bare select element. We will populate it via refreshProviders.
        this._providerSelectEl = select({
            class: "select select-xs select-bordered max-w-xs mr-2",
            onchange: (e) => this._onProviderChange(e.target.value),
        });

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

        this._statusEl = span({ class: "text-[11px] text-base-content/70" });
        const statusBar = div({ class: "px-2 py-1 border-b border-base-200 bg-base-100 text-[11px]" }, this._statusEl);

        this._messageListEl = div({ class: "flex-1 overflow-auto px-2 py-2 bg-base-100", id: this.id + "-messages" });

        this._inputEl = textarea({
            class: "textarea textarea-bordered textarea-xs w-full resize-none mb-1",
            rows: 3,
            placeholder: "Describe what you see in the slide…",
            onkeydown: (e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) this._handleSend(e);
            },
        });

        this._sendBtnEl = new Button(
            {
                size: Button.SIZE.SMALL,
                type: Button.TYPE.PRIMARY,
                extraClasses: { base: "btn btn-sm ml-auto" },
                extraProperties: { title: "Send message" },
                onClick: (e) => this._handleSend(e),
            },
            new FAIcon({ name: "fa-paper-plane" }),
            span("Send")
        ).create();

        const inputArea = div(
            { class: "border-t border-base-300 bg-base-100 px-2 py-2 flex flex-col gap-1" },
            this._inputEl,
            div({ class: "flex items-center justify-between text-[10px]" },
                span("Press Ctrl+Enter to send"),
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
        );

        this._root = root;

        // Populate providers immediately after root is built
        this.refreshProviders();
        this._setStatus("Select a model to start.");
        this._updateInputState();


        return root;
    }

    // -------- public API --------

    /**
     * Add a message programmatically (e.g. system messages).
     * @param {ChatMessage} msg
     */
    addMessage(msg) {
        this._messages.push({
            ...msg,
            createdAt: msg.createdAt || new Date(),
        });
        this._renderMessageToDom(msg);
        this._scrollMessagesToEnd();
    }

    /**
     * Reset chat history.
     */
    clearMessages() {
        this._messages = [];
        if (this._messageListEl) {
            this._messageListEl.innerHTML = "";
        }
    }

    // -------- internal helpers --------

    _setStatus(text) {
        if (this._statusEl) {
            this._statusEl.textContent = text || "";
        }
    }

    _isReady() {
        if (!this._providerId) return false;
        const provider = this.chatService?.getProvider(this._providerId);
        if (!provider) return false;
        if (provider.requiresLogin !== false && !this.chatService.isAuthenticated(this._providerId)) {
            return false;
        }
        return this._consentGranted;
    }

    _updateInputState({ keepStatus = false } = {}) {
        const ready = this._isReady();
        if (this._inputEl) this._inputEl.disabled = !ready;
        if (this._sendBtnEl) this._sendBtnEl.disabled = !ready;

        if (!keepStatus) {
            if (!ready) {
                this._setStatus("Login and data access approval are required before chatting.");
            } else {
                this._setStatus("You can chat with the selected model.");
            }
        }
    }

    _updateLoginButtonState() {
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
        this._loginBtn.setExtraProperty("disabled", false);
        this._loginBtn.toggleClass("hidden", "hidden", authed);
    }

    _onProviderChange(providerId) {
        this._providerId = providerId || null;
        this.clearMessages();
        this._consentGranted = false;

        this._updateLoginButtonState();

        if (!providerId) {
            this._setStatus("Select a model to start.");
            this._updateInputState();
            return;
        }

        const provider = this.chatService?.getProvider(providerId);
        if (!provider) {
            this._setStatus("Unknown provider.");
            this._updateInputState();
            return;
        }

        const requiresLogin = provider.requiresLogin !== false;
        const authed = this.chatService.isAuthenticated(providerId);

        if (requiresLogin && !authed) {
            this._setStatus("Model selected. Please log in first.");
            this._updateInputState();
            return;
        }

        // Already logged in -> ask for consent
        this._openConsentDialog();
    }

    async _handleLoginClick() {
        if (!this._providerId || !this.chatService) return;
        const provider = this.chatService.getProvider(this._providerId);
        if (!provider) return;

        try {
            this._setStatus("Logging in…");
            this._loginBtn?.toggleClass?.("loading", "loading", true);

            await this.chatService.login(this._providerId);

            // only if login succeeded:
            this._setStatus("Login successful. Please approve data access.");
            this._openConsentDialog();
        } catch (err) {
            console.error("ChatPanel login failed:", err);

            // make sure a failed login cannot behave like “continue”
            this._consentGranted = false;
            this._closeConsentDialog();
            this._setStatus("Login failed. Please try again. See console for details.");
        } finally {
            // ← THIS is the finally block: always runs, success or failure
            this._loginBtn?.toggleClass?.("loading", "loading", false);
            this._updateInputState({ keepStatus: true });
            this._updateLoginButtonState();
        }
    }

    _openConsentDialog() {
        if (!this._consentOverlay) return;
        this._consentOverlay.classList.remove("hidden");
    }

    _closeConsentDialog() {
        if (!this._consentOverlay) return;
        this._consentOverlay.classList.add("hidden");
    }

    _applyConsentAndContinue() {
        if (!this._providerId || !this.chatService) {
            this._closeConsentDialog();
            return;
        }

        const provider = this.chatService.getProvider(this._providerId);
        const requiresLogin = provider && provider.requiresLogin !== false;
        if (requiresLogin) {
            const authed = this.chatService.isAuthenticated(this._providerId);
            if (!authed) {
                this._consentGranted = false;
                this._setStatus("Login failed or expired. Please log in successfully before approving data access.");
                this._closeConsentDialog();
                this._updateInputState();
                return;
            }
        }

        // existing behavior
        this.chatService.setConsent(this._providerId, this._consent);
        this._consentGranted = true;
        this._closeConsentDialog();
        this._updateInputState();
    }

    _scrollMessagesToEnd() {
        if (!this._messageListEl) return;
        this._messageListEl.scrollTop = this._messageListEl.scrollHeight;
    }

    /**
     * Render a single message into DOM.
     * @param {ChatMessage} msg
     */
    _renderMessageToDom(msg) {
        if (!this._messageListEl) return;

        const isUser = msg.role === "user";
        const bubbleCls = isUser
            ? "bg-primary text-primary-content"
            : "bg-base-200 text-base-content";

        const message = span();
        this._renderMessageContent(message, msg);
        const line = div(
            { class: "flex mb-2 " + (isUser ? "justify-end" : "justify-start") },
            div(
                {
                    class:
                        "max-w-[100%] rounded-md px-2 py-1 text-xs whitespace-pre-wrap " +
                        bubbleCls,
                },
                message
            )
        );
        this._messageListEl.appendChild(line);
    }

    _getMarkdownRenderer() {
        // marked could be exported in different shapes depending on bundling
        const m = window.npm && window.npm?.modules?.['marked'];
        if (!m) return null;

        if (typeof m.parse === "function") return (md) => m.parse(md);
        if (m.marked && typeof m.marked.parse === "function") return (md) => m.marked.parse(md);
        if (typeof m === "function") return (md) => m(md);
        return null;
    }

    _sanitizeHtml(html) {
        const sanitizer = window.SanitizeHtml;
        if (!sanitizer) return 'ERROR: missing "sanitize-html" package. Insecure HTML is not rendered.';

        // config hook: allow overriding per panel or per provider later
        const config = this._sanitizeConfig || this.options?.sanitizeConfig || {};

        // Support common APIs:
        if (typeof sanitizer.sanitize === "function") return sanitizer.sanitize(html, config);
        if (typeof sanitizer === "function") return sanitizer(html, config);

        return html;
    }

    /**
     * Render message content into a DOM element.
     * - assistant: markdown -> sanitized HTML
     * - user/system: plain text (safe + predictable)
     */
    _renderMessageContent(el, message) {
        const content = (message && message.content) ? String(message.content) : "";

        // Optional toggle: default on for assistant messages
        const markdownEnabled = (this.options?.markdownEnabled !== false);

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

        // fallback: plain text
        el.textContent = content;
    }

    async _handleSend(event) {
        event?.preventDefault?.();
        if (!this._isReady() || !this._inputEl || !this.chatService || !this._providerId) {
            this._updateInputState();
            return;
        }

        const text = this._inputEl.value.trim();
        if (!text) return;

        const userMsg = /** @type {ChatMessage} */ ({
            role: "user",
            content: text,
            createdAt: new Date(),
        });
        this._messages.push(userMsg);
        this._renderMessageToDom(userMsg);
        this._inputEl.value = "";
        this._scrollMessagesToEnd();

        if (this._sendBtnEl) this._sendBtnEl.disabled = true;
        this._setStatus("Sending…");

        try {
            const reply = await this.chatService.sendMessage(this._providerId, this._messages.slice());
            this._messages.push(reply);
            this._renderMessageToDom(reply);
            this._setStatus("Ready.");
        } catch (err) {
            console.error("ChatPanel send failed:", err);
            this._setStatus("Failed to send message. See console for details.");
        } finally {
            this._updateInputState();
        }
    }

    // -------- BaseComponent override --------
    //
    // /**
    //  * Create the component root DOM node.
    //  * Note: respects BaseComponent's commonProperties + extraProperties.
    //  * @returns {HTMLElement}
    //  */
    // create() {
    //     const providers = this.chatService?.getProviders() || [];
    //
    //     // header: title + provider select + login button
    //     const providerOptions = providers.map((p) =>
    //         option({ value: p.id }, p.label)
    //     );
    //
    //     const providerSelectEl = select(
    //         {
    //             class:
    //                 "select select-xs select-bordered max-w-xs mr-2",
    //             onchange: (e) => this._onProviderChange(e.target.value),
    //         },
    //         option({ value: "" }, "Select model…"),
    //         ...providerOptions
    //     );
    //
    //     if (this._providerId) {
    //         providerSelectEl.value = this._providerId;
    //     }
    //
    //     this._loginBtn = new Button(
    //         {
    //             size: Button.SIZE.TINY,
    //             type: Button.TYPE.PRIMARY,
    //             extraClasses: { base: "btn btn-xs" },
    //             extraProperties: { title: "Log in" },
    //             onClick: () => this._handleLoginClick(),
    //         },
    //         new FAIcon({ name: "fa-right-to-bracket" }),
    //         span("Login")
    //     );
    //
    //     const headerRow = div(
    //         {
    //             class:
    //                 "flex items-center justify-between px-2 py-1 border-b border-base-300 bg-base-200",
    //         },
    //         div(
    //             { class: "flex items-center gap-2" },
    //             new FAIcon({ name: "fa-comments" }).create(),
    //             span({ class: "font-semibold text-xs" }, "Pathology Assistant")
    //         ),
    //         div(
    //             { class: "flex items-center gap-2" },
    //             providerSelectEl,
    //             this._loginBtn.create()
    //         )
    //     );
    //
    //     // status/info line
    //     this._statusEl = span({
    //         class: "text-[11px] text-base-content/70",
    //     });
    //     const statusBar = div(
    //         {
    //             class:
    //                 "px-2 py-1 border-b border-base-200 bg-base-100 text-[11px]",
    //         },
    //         this._statusEl
    //     );
    //
    //     // messages container
    //     this._messageListEl = div({
    //         class: "flex-1 overflow-auto px-2 py-2 bg-base-100",
    //         id: this.id + "-messages",
    //     });
    //
    //     // input area
    //     this._inputEl = textarea({
    //         class:
    //             "textarea textarea-bordered textarea-xs w-full resize-none mb-1",
    //         rows: 3,
    //         placeholder: "Describe what you see in the slide…",
    //         onkeydown: (e) => {
    //             if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    //                 this._handleSend(e);
    //             }
    //         },
    //     });
    //
    //     this._sendBtnEl = new Button(
    //         {
    //             size: Button.SIZE.SMALL,
    //             type: Button.TYPE.PRIMARY,
    //             extraClasses: { base: "btn btn-sm ml-auto" },
    //             extraProperties: { title: "Send message" },
    //             onClick: (e) => this._handleSend(e),
    //         },
    //         new FAIcon({ name: "fa-paper-plane" }),
    //         span("Send")
    //     ).create();
    //
    //     const inputArea = div(
    //         {
    //             class:
    //                 "border-t border-base-300 bg-base-100 px-2 py-2 flex flex-col gap-1",
    //         },
    //         this._inputEl,
    //         div({ class: "flex items-center justify-between text-[10px]" },
    //             span("Press Ctrl+Enter to send"),
    //             this._sendBtnEl
    //         )
    //     );
    //
    //     // consent overlay
    //     this._consentOverlay = this._buildConsentOverlay();
    //
    //     // root container
    //     const root = div(
    //         {
    //             ...this.commonProperties,
    //             ...this.extraProperties,
    //         },
    //         headerRow,
    //         statusBar,
    //         this._messageListEl,
    //         inputArea,
    //         this._consentOverlay
    //     );
    //
    //     this._root = root;
    //
    //     // Initial state message
    //     this._setStatus("Select a model to start.");
    //     this._updateInputState();
    //
    //     return root;
    // }

    /**
     * Build the consent dialog overlay.
     * @returns {HTMLElement}
     * @private
     */
    _buildConsentOverlay() {
        const overlay = div({
            class:
                "hidden fixed inset-0 z-50 flex items-center justify-center bg-base-300/70",
        });

        const box = div(
            {
                class:
                    "bg-base-100 rounded-lg shadow-xl border border-base-300 w-full max-w-md p-4 flex flex-col gap-3",
            },
            div(
                { class: "flex items-center justify-between mb-1" },
                span({ class: "font-semibold text-sm" }, "Data access for model"),
                new FAIcon({ name: "fa-shield-halved" }).create()
            ),
            span(
                { class: "text-[11px] text-base-content/80" },
                "Choose what the assistant is allowed to access from the viewer. You can change this later by reopening the dialog."
            )
        );

        // Use Checkbox components
        const cbScreenshots = new Checkbox({
            label: "Allow sending viewport screenshots to the model.",
            checked: this._consent.allowScreenshots,
            onchange: (e) => {
                this._consent.allowScreenshots = !!e.target.checked;
            },
        }).create();

        const cbAnnotations = new Checkbox({
            label: "Allow the model to see and propose annotations.",
            checked: this._consent.allowAnnotations,
            onchange: (e) => {
                this._consent.allowAnnotations = !!e.target.checked;
            },
        }).create();

        const cbPHI = new Checkbox({
            label: "Allow content that may contain patient identifiers (PHI).",
            checked: this._consent.allowPHI,
            onchange: (e) => {
                this._consent.allowPHI = !!e.target.checked;
            },
        }).create();

        const actions = div(
            {
                class: "mt-2 flex justify-between gap-2",
            },
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
                    extraProperties: { title: "Approve and continue" },
                    onClick: () => this._applyConsentAndContinue(),
                },
                new FAIcon({ name: "fa-check" }).create(),
                span("Approve & continue")
            ).create()
        );

        box.appendChild(cbScreenshots);
        box.appendChild(cbAnnotations);
        box.appendChild(cbPHI);
        box.appendChild(actions);

        overlay.appendChild(box);
        return overlay;
    }
}