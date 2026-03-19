export type ChatRole = "user" | "assistant" | "system";

export interface ChatPersonality {
    id: string;
    label: string;
    description?: string;
    systemPrompt: string;
}

export interface ChatMessage {
    role: ChatRole;
    content: string;
    createdAt?: Date;
}

export interface ScriptMethodManifest {
    name: string;
    description?: string;
    params: Array<{ name: string; type: string }>;
    returns: string;
    tsSignature?: string;
    tsDeclaration?: string;
}

export interface ScriptNamespaceManifest {
    namespace: string;
    methods: ScriptMethodManifest[];
    tsDeclaration?: string;
    description?: string;
}

export interface AllowedScriptApiManifest {
    namespaces: ScriptNamespaceManifest[];
}

export interface ChatSendPayload {
    providerId: string;
    messages: ChatMessage[];
    allowedScriptApi?: AllowedScriptApiManifest;
}

export interface ChatProviderConfig {
    id: string;
    label: string;
    description?: string;
    icon?: string;
    requiresLogin?: boolean;
    onLogin?: (providerId: string) => Promise<void> | void;
    onSendMessage: (payload: ChatSendPayload) => Promise<ChatMessage | string> | ChatMessage | string;
}

export interface ChatServiceOptions {
    providers?: ChatProviderConfig[];
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string | null;
    getAllowedScriptApi?: (() => AllowedScriptApiManifest | undefined) | undefined;
}

export class ChatService {
    _providers: Map<string, ChatProviderConfig>;
    _authed: Set<string>;

    _personalities: Map<string, ChatPersonality>;
    _currentPersonalityId: string | null;

    _getAllowedScriptApi: (() => AllowedScriptApiManifest | undefined) | undefined;

    constructor(opts: ChatServiceOptions = {}) {
        this._providers = new Map();
        this._authed = new Set();

        this._personalities = new Map();
        this._currentPersonalityId = null;

        this._getAllowedScriptApi = typeof opts.getAllowedScriptApi === "function"
            ? opts.getAllowedScriptApi
            : undefined;

        (opts.providers || []).forEach((p) => this.registerProvider(p));
        (opts.personalities || []).forEach((p) => this.registerPersonality(p));

        if (opts.defaultPersonalityId) {
            this.setPersonality(opts.defaultPersonalityId);
        } else if (this._personalities.size) {
            this._currentPersonalityId = Array.from(this._personalities.keys())[0] || null;
        }
    }

    registerProvider(cfg: ChatProviderConfig): void {
        if (!cfg || !cfg.id) throw new Error("ChatService.registerProvider: missing provider id");
        if (typeof cfg.onSendMessage !== "function") {
            throw new Error(`ChatService: Provider '${cfg.id}' must implement onSendMessage`);
        }

        const p: ChatProviderConfig = {
            requiresLogin: true,
            ...cfg,
        };
        this._providers.set(p.id, p);
    }

    registerPersonality(personality: ChatPersonality): void {
        if (!personality || !personality.id) {
            throw new Error("ChatService.registerPersonality: missing personality id");
        }
        if (!personality.systemPrompt) {
            throw new Error(`ChatService.registerPersonality: personality '${personality.id}' missing systemPrompt`);
        }
        this._personalities.set(personality.id, { ...personality });
        if (!this._currentPersonalityId) this._currentPersonalityId = personality.id;
    }

    getPersonalities(): ChatPersonality[] {
        return Array.from(this._personalities.values());
    }

    getPersonality(personalityId: string): ChatPersonality | undefined {
        return this._personalities.get(personalityId);
    }

    getCurrentPersonalityId(): string | null {
        return this._currentPersonalityId;
    }

    setPersonality(personalityId: string | null): void {
        if (!personalityId) {
            this._currentPersonalityId = null;
            return;
        }
        if (!this._personalities.has(personalityId)) {
            throw new Error(`ChatService.setPersonality: unknown personality '${personalityId}'`);
        }
        this._currentPersonalityId = personalityId;
    }

    setAllowedScriptApiProvider(getter?: (() => AllowedScriptApiManifest | undefined) | undefined): void {
        this._getAllowedScriptApi = getter;
    }

    getAllowedScriptApi(): AllowedScriptApiManifest | undefined {
        if (!this._getAllowedScriptApi) return undefined;
        return this._getAllowedScriptApi();
    }

    _buildScriptSystemMessage(allowedScriptApi?: AllowedScriptApiManifest): ChatMessage | null {
        if (!allowedScriptApi || !Array.isArray(allowedScriptApi.namespaces) || !allowedScriptApi.namespaces.length) {
            return {
                role: "system",
                content:
                    `Scripting API access is currently disabled.

Do not produce executable viewer scripts.
Do not call scripting namespaces.
If the user asks for automation, explain that scripting access is not currently granted.`
            };
        }

        const namespacesText = allowedScriptApi.namespaces.map((ns) => {
            const methods = ns.methods.map((method) => {
                const args = (method.params || []).map((p) => `${p.name}: ${p.type}`).join(", ");
                const signature = method.tsSignature || `${method.name}(${args}) => ${method.returns || "void"}`;
                const description = method.description ? ` — ${method.description}` : "";
                const declaration = method.tsDeclaration ? `\n    TS: ${method.tsDeclaration}` : "";
                return `  - ${signature}${description}${declaration}`;
            }).join("\n");

            const namespaceDescription = ns.description ? ` — ${ns.description}` : "";
            const namespaceDeclaration = ns.tsDeclaration ? `\n  Namespace TS:\n  ${ns.tsDeclaration}` : "";
            return `- namespace ${ns.namespace}${namespaceDescription}${namespaceDeclaration}\n${methods}`;
        }).join("\n\n");

        return {
            role: "system",
            content:
                `Viewer scripting is available.

You may generate executable scripts only using the namespaces and methods listed below.
Never invent namespaces or methods.
When scripting is appropriate, return exactly one fenced code block with language tag xopat-script.
This code is automatically executed by the viewer automatically, the user never runs your script manually 
unless they tell you so. You can use the API to read data and continue processing 
automatically without user interaction. The script is plain javascript with predefined methods - xopat scripting API.
It runs inside inside web workers (e.g. no DOM). All scripting API calls are asynchronous in the worker. 
Use await when calling. Provided documentation might use typescript types, which should help you to verify
your code syntactically, but do NOT use typescript in your scripts.
Do not wrap explanations inside the code block. Use only the allowed API.

Allowed scripting API:
${namespacesText}`
        };
    }

    _buildSessionPreamble({
                              providerId,
                              allowedScriptApi
                          }: {
        providerId: string;
        allowedScriptApi?: AllowedScriptApiManifest;
    }): ChatMessage {
        const scriptNamespaces = allowedScriptApi?.namespaces?.map((n) => n.namespace).join(", ") || "none";

        const text =
            `You are an assistant integrated into a pathology slide viewer's Chat tab.
Behave as a helpful, professional assistant for this application.
Your users include pathologists, clinicians, students and researchers including IT specialists.

Integration notes:
- You only know what the user explicitly writes in chat unless additional capabilities are granted through the scripting API.
- You may receive access to a scripting API. Only use explicitly allowed namespaces.
- You MUST NOT guess on facts. If information is missing, ask clarifying questions.

Current session:
- Provider: ${providerId}
- Allowed scripting namespaces: ${scriptNamespaces}

When relevant, ask brief clarifying questions and keep outputs readable (Markdown supported).`;

        return { role: "system", content: text };
    }

    _buildPersonalitySystemMessage(): ChatMessage | null {
        const id = this._currentPersonalityId;
        if (!id) return null;
        const p = this._personalities.get(id);
        if (!p) return null;
        const header = `Active personality: ${p.label || p.id}`;
        const text = `${header}

${String(p.systemPrompt).trim()}`;
        return { role: "system", content: text };
    }

    getProviders(): ChatProviderConfig[] {
        return Array.from(this._providers.values());
    }

    getProvider(providerId: string): ChatProviderConfig | undefined {
        return this._providers.get(providerId);
    }

    isAuthenticated(providerId: string): boolean {
        return this._authed.has(providerId);
    }

    _markAuthed(providerId: string): void {
        if (providerId) this._authed.add(providerId);
    }

    async login(providerId: string): Promise<void> {
        const provider = this.getProvider(providerId);
        if (provider && typeof provider.onLogin === "function") {
            await provider.onLogin(providerId);
        }
        this._markAuthed(providerId);
    }

    async sendMessage(providerId: string, messages: ChatMessage[]): Promise<ChatMessage> {
        const provider = this.getProvider(providerId);
        if (!provider) throw new Error("Unknown provider ID");

        const allowedScriptApi = await Promise.resolve(this.getAllowedScriptApi());

        const outbound: ChatMessage[] = [];

        outbound.push(this._buildSessionPreamble({ providerId, allowedScriptApi }));

        const personalityMsg = this._buildPersonalitySystemMessage();
        if (personalityMsg) outbound.push(personalityMsg);

        const scriptMsg = this._buildScriptSystemMessage(allowedScriptApi);
        if (scriptMsg) outbound.push(scriptMsg);

        // preserve runtime order exactly
        if (Array.isArray(messages) && messages.length) {
            outbound.push(...messages);
        }

        const result = await provider.onSendMessage({
            providerId,
            messages: outbound,
            allowedScriptApi,
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