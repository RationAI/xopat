/**
 * pathology-medgemma (client)
 *
 * Ensures a dedicated, server-side MedGemma provider exists (see
 * medgemma-host.server.ts) and registers it as the pathology-foundation
 * `analyze` driver. The image→text call runs isolated on the server through the
 * chat SDK's stateless `runVisionInference` RPC — no chat session/history is
 * touched, and the endpoint/secrets stay server-side.
 *
 * Nothing here is MedGemma- or Ollama-specific: the model is reached over the
 * OpenAI-compatible wire format via the shared registry, so this plugin adds no
 * new transport code — it only wires an existing capability into the pathology
 * broker.
 */

/** Blob → base64 (no data-URL prefix), matching runVisionInference's contract. */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * A same-origin RPC HttpClient with a longer timeout than the 30s default.
 * Vision inference is slow — minutes on CPU-only backends — so the default
 * client aborts mid-request. Mirrors the chat service's `_getRpcHttpClient` /
 * `_getAuthedRpcHttpClient`.
 *
 * When the provider requires login the client must actually attach the context's
 * secret, otherwise the server-side gate finds the verifier and then rejects for
 * want of a Bearer header. Secret TYPES come from the context's owning auth
 * module — never hardcoded here (see XOpatAuth.getSecretTypes).
 */
function makeLongTimeoutRpcClient(timeoutMs, contextId) {
    const app = window.APPLICATION_CONTEXT;
    const current = app?.httpClient;
    const HttpClientCtor = window.HttpClient;
    if (!HttpClientCtor || !current) return current || null;
    try {
        return new HttpClientCtor({
            baseURL: current.baseURL || app?.url,
            timeoutMs,
            maxRetries: current.maxRetries || 3,
            ...(contextId ? {
                auth: {
                    contextId,
                    types: app?.auth?.getSecretTypes?.(contextId) ?? ["jwt"],
                    required: true,
                    refreshOn401: true,
                },
            } : {}),
        });
    } catch (_) {
        return current;
    }
}

const MEDGEMMA_SYSTEM = "You are MedGemma, a medical vision-language model assisting a pathologist. "
    + "You are shown a snapshot of the current region of a whole-slide pathology image. "
    + "Describe only what is visible, be precise and cautious, use correct histopathology terminology, "
    + "and never state a definitive clinical diagnosis — frame findings as observations for expert review.";

addPlugin("pathology-medgemma", class extends XOpatPlugin {
    constructor(id) {
        super(id);
    }

    async pluginReady() {
        // Auth is context-based and OPT-IN, exactly like the chat provider plugins:
        // `authContext` (default "core") names WHERE we authenticate, never HOW, and
        // `authMode: "none"` (the default) needs no auth configured anywhere.
        const contextId = this.authContextId;
        const requiresLogin = this.authRequiresLogin;
        const authType = this.getStaticMeta("authMode", "none");

        // Let the core broker force + drive login for that context. Whichever auth
        // module owns it configures it. (This was missing entirely, so a jwt-mode
        // deployment declared a login it never asked the user to perform.)
        this.requireAuthContext();

        // Detached registration — the loader holds the boot loading overlay on every
        // pluginReady, so a cold provider backend must never be awaited here. The chat
        // SDK's shared helper bounds each attempt (15s RPC timeout instead of the
        // 30s client backstop), retries with backoff, and reports through the chat
        // panel's busy UI; the analyze driver is wired once registration completes
        // (`registerDriver` is a live registry, late registration is fine).
        const register = () => this.server().ensureMedGemmaProvider(
            { contextId, authType, requiresLogin },
            { timeoutMs: 15000 }
        );
        const onRegistered = (res) => {
            const providerId = res?.providerId;
            if (!providerId) {
                console.warn("[pathology-medgemma] no providerId returned; the analyze driver was not registered.");
                return;
            }
            void this._wireAnalyzeDriver(providerId, { contextId, requiresLogin });
        };
        const chat = xmodules["vercel-ai-chat-sdk"]?.instance?.();
        if (chat?.registerManagedProvider) {
            // `onRegistered` rather than `completion.then`: completion settles once, so a
            // user-triggered Retry (chat panel failure notice) — or the automatic re-run
            // after a login — would never re-resolve it; the hook fires on every successful
            // registration.
            //
            // `contextId` only when a login is actually required: it makes the helper wait
            // for that context's verdict before the first attempt (the RPC otherwise races
            // the boot login), and passing it for an authMode "none" deployment would make
            // it wait on a context nobody ever authenticates.
            chat.registerManagedProvider(register, {
                label: "MedGemma", pluginId: this.id, onRegistered,
                ...(requiresLogin ? { contextId } : {}),
            });
        } else {
            register().then(onRegistered).catch((e) => {
                console.error("[pathology-medgemma] failed to register the MedGemma provider:", e);
            });
        }
    }

    /** Register the pathology-foundation `analyze` driver once the provider exists. */
    async _wireAnalyzeDriver(providerId, { contextId, requiresLogin }) {
        // onRegistered fires again after a panel-side Retry; the driver only needs wiring once.
        if (this._analyzeDriverWired) return;
        this._analyzeDriverWired = true;

        const pathology = singletonModule("pathology-foundation");
        if (!pathology?.registerDriver) {
            console.info("[pathology-medgemma] pathology-foundation module not available; skipping driver registration.");
            return;
        }

        // Vision inference can take minutes on CPU-only backends; the default 30s
        // RPC client would abort. Use a dedicated long-timeout client (overridable
        // via include.json / env `inferenceTimeoutMs`). Keep it >= the server-side
        // XOPAT_PATHOLOGY_VISION_TIMEOUT_MS so the server's result/timeout wins.
        const inferenceTimeoutMs = Number(this.getStaticMeta("inferenceTimeoutMs", 315000)) || 315000;
        // Built lazily and memoized only once an auth module actually owns the
        // context: a context declared from the server (SAML's listContexts RPC)
        // arrives asynchronously, and a client built before that would freeze the
        // wrong secret types. Same reasoning as ChatService._getAuthedRpcHttpClient.
        let rpcClient = null;
        const getRpcClient = () => {
            if (rpcClient) return rpcClient;
            const authCtx = requiresLogin ? contextId : null;
            const client = makeLongTimeoutRpcClient(inferenceTimeoutMs, authCtx);
            if (client && (!authCtx || window.APPLICATION_CONTEXT?.auth?.hasContext?.(authCtx))) {
                rpcClient = client;
            }
            return client;
        };

        // The driver label is snapshotted here, so ensure this plugin's locale bundle is loaded
        // first — otherwise getStaticMeta("name") returns the raw "%meta.name%" reference (the
        // bundle may not have attached yet when pluginReady fires). Guard against a genuinely
        // missing locale so the placeholder never leaks into the consent dialog.
        try { await loadElementLocale?.("plugins", this.id); } catch (_) { /* metadata stays raw */ }
        let driverLabel = this.getStaticMeta("name", "MedGemma");
        if (typeof driverLabel === "string" && driverLabel.startsWith("%") && driverLabel.endsWith("%")) {
            driverLabel = "MedGemma";
        }

        pathology.registerDriver({
            id: "medgemma",
            label: driverLabel,
            // Remote: the viewport snapshot leaves the browser for the server,
            // so callers get the "data leaves the viewer" consent prompt.
            local: false,
            features: {
                analyze: async ({ imageBlob, prompt }) => {
                    const imageBase64 = await blobToBase64(imageBlob);
                    const sdk = xserver?.module?.["vercel-ai-chat-sdk"];
                    if (!sdk?.runVisionInference) {
                        throw new Error("[pathology-medgemma] vercel-ai-chat-sdk module or its runVisionInference RPC is not available.");
                    }
                    const client = getRpcClient();
                    const res = await sdk.runVisionInference(
                        {
                            providerId,
                            model: null, // null → provider defaultModelId, resolved server-side
                            system: MEDGEMMA_SYSTEM,
                            prompt: prompt || "Describe the tissue and any notable features in this view.",
                            imageBase64,
                            mediaType: "image/png",
                        },
                        // `contextId` selects the server-side verifier context for
                        // this call; omit it entirely when the provider needs no login.
                        {
                            ...(client ? { httpClient: client } : {}),
                            ...(requiresLogin ? { contextId } : {}),
                        },
                    );
                    return { text: typeof res?.text === "string" ? res.text : "" };
                },
            },
        });
    }
});
