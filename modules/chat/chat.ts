import { ChatPanel } from "./chatPanel";
import {
    ChatService,
    type AllowedScriptApiManifest,
    type ChatMessage,
    type ChatPersonality,
    type ChatProviderConfig,
} from "./chatService";
import getOpenaiProvider from "./providers/openai";

type ScriptNamespaceConsentState = Record<string, { title: string; granted: boolean; description?: string }>;

type ChatConfigShape = {
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string;
};

declare const XOpatModuleSingleton: any;

declare global {
    interface Window {
        LAYOUT?: {
            addTab(config: {
                id: string;
                title: string;
                icon: string;
                body: any[];
            }): void;
        };
    }
}

class ChatModule extends XOpatModuleSingleton {

    chatService: ChatService;
    chatPanel: ChatPanel;
    _scriptConsent: ScriptNamespaceConsentState;
    _layoutAttached?: boolean;

    constructor() {
        super("chat");

        const cfg = this._getChatConfig();

        this._scriptConsent = {};

        this.chatService = new ChatService({
            getAllowedScriptApi: () => this.getAllowedScriptApiManifest(),
            personalities: cfg.personalities,
            defaultPersonalityId: cfg.defaultPersonalityId,
        });

        this.chatPanel = new ChatPanel({
            id: "pathology-chat-panel",
            chatService: this.chatService,
            defaultPersonalityId: cfg.defaultPersonalityId,
        });

        this.refreshScriptConsentFromManager();
        this._attachToLayout();
    }

    getScriptConsentEntries(): ScriptNamespaceConsentState {
        return this._scriptConsent;
    }

    setScriptNamespaceConsent(namespace: string, granted: boolean): void {
        if (!this._scriptConsent[namespace]) {
            this._scriptConsent[namespace] = {
                title: `Allow scripting namespace '${namespace}'.`,
                granted
            };
        } else {
            this._scriptConsent[namespace].granted = granted;
        }

        this._syncScriptConsentToManager();
        this.chatPanel?.refreshScriptConsent?.();
    }

    refreshScriptConsentFromManager(): void {
        const manager = APPLICATION_CONTEXT?.Scripting;

        if (!manager || typeof manager.getNamespaceConsentEntries !== "function") {
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
                granted: this._scriptConsent[namespace]?.granted ?? false
            };
        }

        this._scriptConsent = next;
        manager.syncNamespaceConsent?.(this._scriptConsent);
        this.chatPanel?.refreshScriptConsent?.();
    }

    _buildInitialScriptConsent(): ScriptNamespaceConsentState {
        return {};
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
                role: "user",
                content: "Script execution failed.\n\nScripting manager is not available.",
                createdAt: new Date(),
            };
        }

        console.log('test script', script);

        try {
            const result = await manager.executeScript(script);
            const content = typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2);

            console.log("Script executed successfully:", content);
            return {
                role: "user",
                content: `Script executed successfully.\n\n\`\`\`json\n${content}\n\`\`\``,
                createdAt: new Date(),
            };
        } catch (error) {
            console.error("Script execution failed:", error);
            const message = error instanceof Error ? error.message : String(error);
            return {
                role: "user",
                content: `Script execution failed.\n\n${message}`,
                createdAt: new Date(),
            };
        }
    }

    extractScriptFromAssistantMessage(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");
        const match = content.match(/```xopat-script\s*([\s\S]*?)```/i);
        return match ? match[1]?.trim() : undefined;
    }

    _getChatConfig(): { personalities: ChatPersonality[]; defaultPersonalityId: string } {
        const inc = (globalThis as any).INCLUDE || (globalThis as any).include || {};
        const chatCfg: ChatConfigShape = inc.chat || (inc.modules && inc.modules.chat) || {};

        const personalities: ChatPersonality[] = Array.isArray(chatCfg.personalities) ? chatCfg.personalities : [];

        if (!personalities.length) {
            personalities.push({
                id: "default",
                label: "Default",
                systemPrompt:
                    "Be helpful and accurate. Use the scripting API when it is available and useful. " +
                    "When it is not available or insufficient, explain the limitation clearly."
            });
        }

        const defaultPersonalityId = chatCfg.defaultPersonalityId || personalities[0]?.id || "default";

        return { personalities, defaultPersonalityId };
    }

    _attachToLayout(): void {
        if (this._layoutAttached || !window.LAYOUT) return;
        window.LAYOUT.addTab({
            id: "chat",
            title: "Chat",
            icon: "fa-comments",
            body: [this.chatPanel],
        });
        this._layoutAttached = true;
    }

    registerPersonality(personality: ChatPersonality): void {
        this.chatService.registerPersonality(personality);
        if (this.chatPanel && typeof this.chatPanel.refreshPersonalities === "function") {
            this.chatPanel.refreshPersonalities();
        }
    }

    setPersonality(personalityId: string): void {
        this.chatService.setPersonality(personalityId);
        if (this.chatPanel && typeof this.chatPanel.refreshPersonalities === "function") {
            this.chatPanel.refreshPersonalities();
        }
    }

    registerModel(config: ChatProviderConfig): void {
        this.chatService.registerProvider(config);
        if (this.chatPanel) {
            this.chatPanel.refreshProviders();
        }
    }
}

const Providers = {
    openAI: getOpenaiProvider(ChatModule)
};
export { ChatModule, Providers, ChatPanel, ChatService };