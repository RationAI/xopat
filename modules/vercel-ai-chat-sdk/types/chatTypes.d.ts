type ChatRole = "user" | "assistant" | "system";

interface ChatPersonality {
    id: string;
    label: string;
    description?: string;
    systemPrompt: string;
}

interface ChatMessage {
    role: ChatRole;
    content: string;
    createdAt?: Date;
}

interface ScriptMethodManifest {
    name: string;
    description?: string;
    params: Array<{ name: string; type: string }>;
    returns: string;
    tsSignature?: string;
    tsDeclaration?: string;
}

interface ScriptNamespaceManifest {
    namespace: string;
    methods: ScriptMethodManifest[];
    tsDeclaration?: string;
    description?: string;
}

interface AllowedScriptApiManifest {
    namespaces: ScriptNamespaceManifest[];
}

interface ChatSendPayload {
    providerId: string;
    messages: ChatMessage[];
    allowedScriptApi?: AllowedScriptApiManifest;
}

interface ChatProviderConfig {
    id: string;
    label: string;
    description?: string;
    icon?: string;
    requiresLogin?: boolean;
    onLogin?: (providerId: string) => Promise<void> | void;
    onSendMessage: (payload: ChatSendPayload) => Promise<ChatMessage | string> | ChatMessage | string;
}

interface ChatServiceOptions {
    providers?: ChatProviderConfig[];
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string | null;
    getAllowedScriptApi?: (() => AllowedScriptApiManifest | undefined) | undefined;
}

type ScriptNamespaceConsentState = Record<string, { title: string; granted: boolean; description?: string }>;

type ChatConfigShape = {
    personalities?: ChatPersonality[];
    defaultPersonalityId?: string;
};

declare const XOpatModuleSingleton: any;
