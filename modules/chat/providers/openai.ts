import type { ChatMessage, ChatProviderConfig, ChatSendPayload } from "../chatService";
import type {ChatModule} from "../chat";

type OpenAIModelConfig = {
    id: string;
    model: string;
    label?: string;
    icon?: string;
    requiresLogin?: boolean;
};

type OpenAIModelDiscoveryConfig = {
    path?: string;
    authRequired?: boolean;
    mapResponse?: (raw: any) => OpenAIModelConfig[] | undefined;
    filter?: (model: OpenAIModelConfig) => boolean;
    labelPrefix?: string;
    providerIdPrefix?: string;
};

type RegisterOpenAIChatProvidersOptions = {
    proxyAlias?: string;
    apiUrl?: string;
    oidcConfig?: Record<string, any>;
    userContextId?: string | null;
    serviceName?: string;
    models?: OpenAIModelConfig[];
    discovery?: OpenAIModelDiscoveryConfig | null;
    defaultIcon?: string;
    authMode?: string;
};

declare const OIDCAuthClient: any;
declare const HttpClient: any;
declare const XOpatUser: any;

export default function (ChatModule: ChatModule) {
    return async function registerOpenAIChatProviders({
                                                          proxyAlias = "openai",
                                                          apiUrl = "/v1/chat/completions",
                                                          oidcConfig = {},
                                                          userContextId = null,
                                                          serviceName = "OpenAI Chat",
                                                          models = [],
                                                          discovery = null,
                                                          defaultIcon = "fa-robot",
                                                          authMode = "jwt",
                                                      }: RegisterOpenAIChatProvidersOptions = {}): Promise<void> {

        const useViewerAuth = authMode !== "none";
        if (!userContextId) {
            userContextId = undefined as any;
        }

        // ---------- shared OIDC + HTTP clients ----------

        const authClient = useViewerAuth
            ? new OIDCAuthClient(oidcConfig, {
                userContextId,
                serviceName,
                authMethod: "popup",
            })
            : null;

        const httpClient = new HttpClient({
            proxy: proxyAlias,
            baseURL: apiUrl,
            ...(useViewerAuth
                ? {
                    auth: {
                        contextId: userContextId,
                        types: ["jwt"],
                    },
                }
                : {}),
        });

        const ensureLogin = async (): Promise<void> => {
            if (!useViewerAuth || !authClient) return;
            const user = XOpatUser.instance();
            if (!user.getIsLogged(userContextId)) {
                await authClient.signIn();
            }
        };

        // ---------- discover models (optional) ----------
        let finalModels = [...models];

        if (discovery) {
            const {
                path = "/v1/models",
                authRequired = false,
                mapResponse,
                filter,
                labelPrefix = "",
                providerIdPrefix = "",
            } = discovery;

            try {
                // If the discovery endpoint requires the same auth context, log in first
                if (authRequired && useViewerAuth) {
                    // todo: discovery MUST NOT auto-fire auth by default!!!
                    await ensureLogin();
                }

                // Use a separate HttpClient pointing at the discovery endpoint
                const discoveryClient = new HttpClient({
                    proxy: proxyAlias,
                    baseURL: path,
                    ...(useViewerAuth && authRequired
                        ? {
                            auth: {
                                contextId: userContextId,
                                types: ["jwt"],
                            },
                        }
                        : {}),
                });

                const raw = await discoveryClient.request("", { method: "GET" });

                let discovered: OpenAIModelConfig[] = [];
                if (typeof mapResponse === "function") {
                    discovered = mapResponse(raw) || [];
                } else {
                    const list = Array.isArray(raw?.data) ? raw.data : [];
                    discovered = list.map((m: any) => ({
                        id: (providerIdPrefix || "openai-") + m.id,
                        label: `${labelPrefix}${m.id}`,
                        model: m.id,
                    }));
                }

                if (typeof filter === "function") {
                    discovered = discovered.filter(filter);
                }

                finalModels = [...finalModels, ...discovered];
            } catch (err) {
                console.warn("[OpenAIChat] Model discovery failed, using static models only:", err);
            }
        }

        // De-duplicate by provider id
        const seen = new Set<string>();
        finalModels = finalModels.filter((m) => {
            if (!m || !m.id || !m.model) return false;
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });

        if (!finalModels.length) {
            console.warn("[OpenAIChat] No models configured or discovered; nothing to register.");
            return;
        }

        // ---------- register providers ----------
        finalModels.forEach((m) => {
            const providerId = m.id;
            const label = m.label || m.id;
            const modelName = m.model;
            const icon = m.icon || defaultIcon;

            // If we’re not using viewer auth at all, provider never requires login.
            const requiresLogin = useViewerAuth && m.requiresLogin !== false;
            console.log(`[OpenAIChat] Registering provider ${providerId} (model=${modelName}) login ${requiresLogin}`);

            const provider: ChatProviderConfig = {
                id: providerId,
                label,
                icon,
                requiresLogin,

                onLogin: async () => {
                    if (!requiresLogin || !useViewerAuth) return;
                    console.log(`[OpenAIChat] Login for provider ${providerId} (model=${modelName})`);
                    await ensureLogin();
                },

                async onSendMessage({ messages }: ChatSendPayload): Promise<ChatMessage> {
                    console.log(
                        `[OpenAIChat] send for ${providerId} (model=${modelName})`);

                    const mappedMessages = messages.map((msg) => ({
                        role: msg.role,
                        content: msg.content,
                    }));

                    try {
                        const response = await httpClient.request("", {
                            method: "POST",
                            body: {
                                model: modelName,
                                messages: mappedMessages,
                            },
                        });

                        const content =
                            response?.choices?.[0]?.message?.content ??
                            "No response from model.";

                        return {
                            role: "assistant",
                            content,
                        };
                    } catch (err: any) {
                        console.error(
                            `[OpenAIChat] Request failed for provider ${providerId}:`,
                            err
                        );
                        const msg =
                            err && err.message
                                ? err.message
                                : "Unknown error. Check console for details.";
                        return {
                            role: "assistant",
                            content: `**Error:** Failed to get a response from ${label}. (${msg})`,
                        };
                    }
                },
            };

            ChatModule.instance().registerModel(provider);
        });
    }
}