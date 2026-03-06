/**
 * @typedef {Object} ChatProviderConfig
 * @property {string} id                Unique provider ID, e.g. "openai"
 * @property {string} label             Human readable name
 * @property {string} [description]     Short description
 * @property {string} [icon]            FontAwesome name, e.g. "fa-robot"
 * @property {boolean} [requiresLogin]  If true, ChatPanel will force login() before chatting
 * @property {function(string): Promise<void>} [onLogin] Async callback for authentication
 * @property {function(ChatSendPayload): Promise<ChatMessage|string>} onSendMessage Async callback for generating a response
 */

/**
 * @typedef {Object} ChatConsent
 * @property {boolean} allowScreenshots
 * @property {boolean} allowAnnotations
 * @property {boolean} allowPHI
 */
/**
 * @typedef {Object} ChatPersonality
 * @property {string} id
 *   Unique id of the personality (e.g. "default", "concise", "teaching").
 * @property {string} label
 *   Human-readable label shown in the UI.
 * @property {string} [description]
 *   Optional description shown as tooltip in future.
 * @property {string} systemPrompt
 *   System instruction injected into the session to steer behavior.
 */


/**
 * @typedef {Object} ChatMessage
 * @property {"user"|"assistant"|"system"} role
 * @property {string} content
 * @property {Date} [createdAt]
 */

/**
 * @typedef {Object} ChatSendPayload
 * @property {string} providerId
 * @property {ChatMessage[]} messages
 * @property {ChatConsent} consent
 * @property {any} [viewerContext]
 */

export class ChatService {
    constructor(opts = {}) {
        /** @type {Map<string, ChatProviderConfig>} */
        this._providers = new Map();
        /** @type {Set<string>} */
        this._authed = new Set();
        /** @type {Map<string, ChatConsent>} */
        this._consent = new Map();


        /** @type {Map<string, ChatPersonality>} */
        this._personalities = new Map();
        /** @type {string|null} */
        this._currentPersonalityId = null;

        this._getViewerContext = typeof opts.getViewerContext === "function"
            ? opts.getViewerContext
            : undefined;

        (opts.providers || []).forEach((p) => this.registerProvider(p));

        // Personalities are optional. If none are provided, UI can still run with a built-in default.
        (opts.personalities || []).forEach((p) => this.registerPersonality(p));
        if (opts.defaultPersonalityId) {
            this.setPersonality(opts.defaultPersonalityId);
        } else if (this._personalities.size) {
            // Pick the first registered personality as the default.
            this._currentPersonalityId = Array.from(this._personalities.keys())[0] || null;
        }
    }

    registerProvider(cfg) {
        if (!cfg || !cfg.id) throw new Error("ChatService.registerProvider: missing provider id");
        if (typeof cfg.onSendMessage !== "function") throw new Error(`ChatService: Provider '${cfg.id}' must implement onSendMessage`);

        const p = {
            requiresLogin: true,
            ...cfg,
        };
        this._providers.set(p.id, p);
    }


    // -------- personalities --------

    /**
     * Register a personality configuration.
     * @param {ChatPersonality} personality
     */
    registerPersonality(personality) {
        if (!personality || !personality.id) throw new Error("ChatService.registerPersonality: missing personality id");
        if (!personality.systemPrompt) throw new Error(`ChatService.registerPersonality: personality '${personality.id}' missing systemPrompt`);
        this._personalities.set(personality.id, { ...personality });
        // If nothing selected yet, select the first registered personality.
        if (!this._currentPersonalityId) this._currentPersonalityId = personality.id;
    }

    getPersonalities() {
        return Array.from(this._personalities.values());
    }

    getPersonality(personalityId) {
        return this._personalities.get(personalityId);
    }

    getCurrentPersonalityId() {
        return this._currentPersonalityId;
    }

    setPersonality(personalityId) {
        if (!personalityId) {
            this._currentPersonalityId = null;
            return;
        }
        if (!this._personalities.has(personalityId)) {
            throw new Error(`ChatService.setPersonality: unknown personality '${personalityId}'`);
        }
        this._currentPersonalityId = personalityId;
    }

    _buildSessionPreamble({ providerId, consent, viewerContext }) {
        const consentSummary = [
            consent?.allowScreenshots ? "screenshots" : null,
            consent?.allowAnnotations ? "annotations" : null,
            consent?.allowPHI ? "PHI" : null,
        ].filter(Boolean).join(", ") || "none";

        const hasCtx = viewerContext && typeof viewerContext === "object";
        const ctxKeys = hasCtx ? Object.keys(viewerContext).filter((k) => viewerContext[k] != null) : [];
        const ctxSummary = ctxKeys.length ? ctxKeys.join(", ") : "no viewer context provided";

        const text =
            `You are an assistant integrated into a pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.

Integration notes:
- You MAY receive optional viewer context (e.g., viewport/slide info, annotations, selection) depending on user consent and integration.
- You MUST treat viewer context as sensitive; do not request or reveal patient identifiers unless the user explicitly provides them and consent allows PHI.
- You cannot directly manipulate the viewer; instead, propose clear steps, commands, or annotation suggestions the user can apply.

Current session:
- Provider: ${providerId}
- Data sharing consent: ${consentSummary}
- Viewer context: ${ctxSummary}

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).`;

        return { role: "system", content: text };
    }

    _buildPersonalitySystemMessage() {
        const id = this._currentPersonalityId;
        if (!id) return null;
        const p = this._personalities.get(id);
        if (!p) return null;
        const header = `Active personality: ${p.label || p.id}`;
        const text = `${header}

${String(p.systemPrompt).trim()}`;
        return { role: "system", content: text };
    }

    getProviders() {
        return Array.from(this._providers.values());
    }

    getProvider(providerId) {
        return this._providers.get(providerId);
    }

    isAuthenticated(providerId) {
        return this._authed.has(providerId);
    }

    _markAuthed(providerId) {
        if (providerId) this._authed.add(providerId);
    }

    async login(providerId) {
        const provider = this.getProvider(providerId);
        if (provider && typeof provider.onLogin === "function") {
            await provider.onLogin(providerId);
        }
        this._markAuthed(providerId);
    }

    getConsent(providerId) {
        return this._consent.get(providerId);
    }

    setConsent(providerId, consent) {
        this._consent.set(providerId, { ...consent });
    }

    getViewerContext() {
        if (!this._getViewerContext) return undefined;
        return this._getViewerContext();
    }

    async sendMessage(providerId, messages) {
        const provider = this.getProvider(providerId);
        if (!provider) throw new Error("Unknown provider ID");

        const consent = this.getConsent(providerId) || {
            allowScreenshots: false,
            allowAnnotations: false,
            allowPHI: false,
        };
        const ctx = await Promise.resolve(this.getViewerContext());

        // Build outbound history:
        //   [session preamble, personality prompt, ...user-visible history]
        // We do NOT mutate the UI history; we only augment what providers receive.
        const outbound = [];

        outbound.push(this._buildSessionPreamble({ providerId, consent, viewerContext: ctx }));

        const personalityMsg = this._buildPersonalitySystemMessage();
        if (personalityMsg) outbound.push(personalityMsg);

        if (Array.isArray(messages) && messages.length) outbound.push(...messages);

        const result = await provider.onSendMessage({
            providerId,
            messages: outbound,
            consent,
            viewerContext: ctx,
        });

        if (typeof result === "string") {
            return { role: "assistant", content: result, createdAt: new Date() };
        }
        return {
            ...result,
            role: result.role || "assistant",
            createdAt: result.createdAt || new Date(),
        };
    }
}