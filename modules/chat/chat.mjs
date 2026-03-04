import { ChatPanel } from "./chatPanel.mjs";
import { ChatService } from "./chatService.mjs";
import {registerOpenAIChatProviders} from "./providers/openai.js";

/**
 * One message in the chat history.
 *
 * This is the internal format used by ChatPanel + ChatService.
 *
 * @typedef {Object} ChatMessage
 * @property {"system"|"user"|"assistant"} role
 *   Logical role of the author.
 * @property {string} content
 *   Plaintext content of the message.
 * @property {Date} [createdAt]
 *   Optional timestamp; if omitted ChatPanel may fill it in.
 */

/**
 * Per-provider consent flags that describe what the model
 * is allowed to see from the viewer.
 *
 * @typedef {Object} ChatConsent
 * @property {boolean} allowScreenshots
 * @property {boolean} allowAnnotations
 * @property {boolean} allowPHI
 */

/**
 * Context information coming from the pathology viewer.
 * This is intentionally open-ended – providers should treat it
 * as an opaque bag of data.
 *
 * @typedef {Object} ViewerContext
 * @property {any} [viewport]        - Current viewport / slide info.
 * @property {any} [annotations]     - Visible annotations, if provided.
 * @property {any} [selection]       - Current selection, if provided.
 * // Add more fields as the viewer exposes them.
 */

/**
 * Arguments passed to a provider when ChatService wants to send
 * a message to a model.
 *
 * @typedef {Object} ChatProviderSendParams
 * @property {ChatMessage[]} messages
 *   Full conversation history including the latest user message.
 * @property {ChatConsent} consent
 *   Consent flags currently granted by the user for this provider.
 * @property {ViewerContext} viewerContext
 *   Snapshot of viewer state at the time of the request.
 */

/**
 * Optional hook used by providers to perform login / OIDC flows.
 * Called by ChatService when the user presses the "Login" button.
 *
 * The implementation is responsible for:
 *  - Running whatever auth UI / redirect is needed.
 *  - Storing tokens/secrets into XOpatUser (so HttpClient can use them).
 *
 * @callback ChatProviderLoginHandler
 * @returns {Promise<void>|void}
 */

/**
 * Required hook used by providers to call the underlying model API.
 *
 * It must:
 *  - Map {@link ChatMessage} history to the provider's wire format.
 *  - Use HttpClient (or another client) to perform the HTTP request.
 *  - Map the response back to a single {@link ChatMessage} with
 *    role "assistant" and the model's reply in `content`.
 *
 * @callback ChatProviderSendHandler
 * @param {ChatProviderSendParams} params
 * @returns {Promise<ChatMessage>|ChatMessage}
 */

/**
 * Optional model-discovery hook.
 *
 * If implemented, this lets a provider expose multiple underlying
 * models (e.g. "gpt-4o", "gpt-4o-mini", "gemini-1.5-flash") via a
 * single provider implementation.
 *
 * NOTE: ChatService / ChatPanel don't *need* to use this yet, but
 * the type is defined so you can wire it up later.
 *
 * @typedef {Object} ChatModelInfo
 * @property {string} id
 *   Stable id used inside the viewer (e.g. "openai-gpt-4o").
 * @property {string} model
 *   Raw model identifier for the API (e.g. "gpt-4o").
 * @property {string} [label]
 *   Human-readable label for dropdowns.
 * @property {string} [description]
 *   Optional longer description or capabilities.
 */

/**
 * Optional handler that returns available models for this provider.
 *
 * @callback ChatProviderListModelsHandler
 * @returns {Promise<ChatModelInfo[]>|ChatModelInfo[]}
 */

/**
 * Configuration object that a plugin passes to
 * `ChatModule.instance().registerModel(...)`.
 *
 * This is the "generic provider" interface.
 *
 * @typedef {Object} ChatProviderConfig
 *
 * @property {string} id
 *   Unique id of this provider/model within the chat module.
 *   (Used by ChatPanel & ChatService as the provider key.)
 *
 * @property {string} label
 *   User-facing name shown in the model dropdown.
 *
 * @property {string} [icon]
 *   Optional FontAwesome icon class (e.g. "fa-robot", "fa-bolt").
 *
 * @property {boolean} [requiresLogin=true}
 *   If true, ChatPanel will require `chatService.login(id)` before
 *   enabling the input. If false, the provider is considered
 *   anonymous/public and `onLogin` is never called.
 *
 * @property {ChatProviderLoginHandler} [onLogin]
 *   Optional login handler. If omitted, `chatService.login(id)`
 *   simply marks the provider as authenticated.
 *
 * @property {ChatProviderSendHandler} onSendMessage
 *   REQUIRED. Called by ChatService when the user sends a message.
 *   Must return a single assistant {@link ChatMessage}.
 *
 * @property {ChatProviderListModelsHandler} [listModels]
 *   OPTIONAL. If implemented, can be used by higher-level code to
 *   dynamically populate multiple model variants from a single
 *   provider (e.g. OpenAI / Gemini / local LLM router).
 */

/**
 * Central entry point for the chat feature.
 *
 * `ChatModule` is a singleton (via {@link XOpatModuleSingleton}) that:
 *
 *  - Owns a single {@link ChatService} instance which manages providers.
 *  - Owns a single {@link ChatPanel} instance which renders the UI.
 *  - Attaches the chat panel as a tab to the global viewer layout.
 *
 * The class is attached to the global `window` as `ChatModule`.
 *
 * Typical plugin usage:
 *
 * ```js
 * const chatModule = ChatModule.instance(); // inherited from XOpatModuleSingleton
 *
 * chatModule.registerModel({
 *   id: "my-provider",
 *   label: "My Model",
 *   icon: "fa-robot",
 *   requiresLogin: true,
 *   onLogin: async () => { ... },
 *   onSendMessage: async ({ messages, consent, viewerContext }) => {
 *     // call backend / LLM and return a ChatMessage with role "assistant"
 *     return { role: "assistant", content: "Hello!" };
 *   },
 * });
 * ```
 *
 * @class ChatModule
 * @extends XOpatModuleSingleton
 *
 * @property {ChatService} chatService
 *   Shared service responsible for managing registered chat providers
 *   and routing calls from the UI to the correct provider.
 *
 * @property {ChatPanel} chatPanel
 *   The UI component displayed in the viewer's layout tab.
 */
window.ChatModule = class ChatModule extends XOpatModuleSingleton {

    // Publishing providers
    static Providers = {
        registerOpenAIChatProviders
    }

    constructor() {
        // loader.js passes undefined when calling static instance(), so we enforce the ID here.
        super('chat');

        this.chatService = new ChatService({
            getViewerContext: () => {
                // TODO: integrate with pathology viewer (viewport, annotations...)
                return {
                    viewport: "not implemented",
                };
            }
        });

        this.chatPanel = new ChatPanel({
            id: "pathology-chat-panel",
            chatService: this.chatService,
        });

        this._attachToLayout();
    }

    _attachToLayout() {
        if (this._layoutAttached || !window.LAYOUT) return;
        window.LAYOUT.addTab({
            id: 'chat',
            title: 'Chat',
            icon: 'fa-comments',
            body: [this.chatPanel],
        });
        this._layoutAttached = true;
    }

    /**
     * Register a chat model/provider with the chat module.
     *
     * This forwards the configuration to {@link ChatService.registerProvider}
     * and refreshes the UI so the new provider appears in the model dropdown.
     *
     * @param {ChatProviderConfig} config
     *   Provider configuration object implementing the generic provider
     *   interface (see ChatProviderConfig typedef).
     */
    registerModel(config) {
        this.chatService.registerProvider(config);
        if (this.chatPanel) {
            this.chatPanel.refreshProviders();
        }
    }
}

