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

        this._getViewerContext = typeof opts.getViewerContext === "function"
            ? opts.getViewerContext
            : undefined;

        (opts.providers || []).forEach((p) => this.registerProvider(p));
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

        const result = await provider.onSendMessage({
            providerId,
            messages,
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