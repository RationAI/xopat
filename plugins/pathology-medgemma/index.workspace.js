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
 * client aborts mid-request. Mirrors the chat service's `_getRpcHttpClient`.
 */
function makeLongTimeoutRpcClient(timeoutMs) {
    const app = window.APPLICATION_CONTEXT;
    const current = app?.httpClient;
    const HttpClientCtor = window.HttpClient;
    if (!HttpClientCtor || !current) return current || null;
    try {
        return new HttpClientCtor({
            baseURL: current.baseURL || app?.url,
            timeoutMs,
            maxRetries: current.maxRetries || 3,
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
        const contextId = this.getStaticMeta("authContext", null);
        const authType = this.getStaticMeta("authMode", "jwt");
        const requiresLogin = authType === "jwt";

        let providerId;
        try {
            const res = await this.server().ensureMedGemmaProvider({ contextId, authType, requiresLogin });
            providerId = res?.providerId;
        } catch (e) {
            console.error("[pathology-medgemma] failed to register the MedGemma provider:", e);
            return;
        }
        if (!providerId) {
            console.warn("[pathology-medgemma] no providerId returned; the analyze driver was not registered.");
            return;
        }

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
        const rpcClient = makeLongTimeoutRpcClient(inferenceTimeoutMs);

        pathology.registerDriver({
            id: "medgemma",
            label: this.getStaticMeta("name", "MedGemma"),
            // Remote: the viewport snapshot leaves the browser for the server,
            // so callers get the "data leaves the viewer" consent prompt.
            local: false,
            features: {
                analyze: async ({ imageBlob, prompt }) => {
                    const imageBase64 = await blobToBase64(imageBlob);
                    const res = await xserver.module["vercel-ai-chat-sdk"].runVisionInference(
                        {
                            providerId,
                            model: null, // null → provider defaultModelId, resolved server-side
                            system: MEDGEMMA_SYSTEM,
                            prompt: prompt || "Describe the tissue and any notable features in this view.",
                            imageBase64,
                            mediaType: "image/png",
                        },
                        rpcClient ? { httpClient: rpcClient } : undefined,
                    );
                    return { text: typeof res?.text === "string" ? res.text : "" };
                },
            },
        });
    }
});
