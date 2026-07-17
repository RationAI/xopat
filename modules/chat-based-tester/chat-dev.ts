declare const XOpatModuleSingleton: any;
declare const singletonModule: (id: string) => any;

type AutomationBlock = {
    kind: "script" | "host";
    code: string;
};

type TestMode = "scripting" | "host";

// Level tags for the console.log/info/debug extension of the shared
// `console.appTrace` export buffer (index.html captures WARN/ERROR only).
// Padded to align with the template's "ERROR "/"WARN  " tags.
const CONSOLE_LEVEL_TAGS: Record<string, string> = {
    log: "LOG   ",
    info: "INFO  ",
    debug: "DEBUG ",
};

function consoleTimestamp() {
    // Same format as the appTrace bootstrap script in server/templates/index.html.
    const ts = new Date(), pad = "000", ms = ts.getMilliseconds().toString();
    return ts.toLocaleTimeString("cs-CZ") + "." + pad.substring(0, pad.length - ms.length) + ms + " ";
}

function formatConsoleElement(value: any): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name || "Error"}: ${value.message}`;
    try {
        const text = JSON.stringify(value);
        return typeof text === "string" && text.length > 2000
            ? `${text.slice(0, 2000)}…`
            : (text ?? String(value));
    } catch {
        return String(value);
    }
}

class ChatBasedTester extends XOpatModuleSingleton {
    _panel: any;
    _chatModule: any;
    _sessionId: string | null;
    _providerId: string | null;
    _modelId: string | null;
    _lastLogId: number;
    _lastConsoleIndex: number;
    _running: boolean;
    _abortController: AbortController | null;
    _personalityId: string;
    _bootstrappedSessions: Set<string>;
    _testMode: TestMode;

    constructor() {
        super("chat-based-tester");
        this._panel = new ChatDevPanel(this);
        this._chatModule = null;
        this._sessionId = null;
        this._providerId = null;
        this._modelId = null;
        this._lastLogId = 0;
        this._lastConsoleIndex = 0;
        this._running = false;
        this._abortController = null;
        this._personalityId = "viewer-dev-tester";
        this._bootstrappedSessions = new Set();
        this._testMode = this._getConfig().defaultTestMode;

        if (this.isServerDevMode()) {
            this._installConsoleCapture();
        }
        this._attachToLayout();
        void this._boot();
    }

    _attachToLayout() {
        globalThis.LAYOUT?.addTab?.({
            id: "chat-based-tester",
            title: "Chat Dev",
            icon: "fa-flask",
            body: [this._panel.create()],
        });
    }

    async _boot() {
        try {
            if (!this.isServerDevMode()) {
                this._panel.setStatus("Disabled: chat-based-tester is available only when the server runs in dev mode.");
                return;
            }

            this._panel.setStatus("Waiting for vercel-ai-chat-sdk...");
            this._chatModule = await this._waitForChatModule();
            this._registerDevPersonality();
            // Chat provider plugins register providers in their pluginReady,
            // which can run after this boot — refresh on each plugin load so
            // the provider dropdown fills in without manual refresh.
            (globalThis as any).VIEWER_MANAGER?.addHandler?.("plugin-loaded", () => {
                void this.refreshProviders().catch(() => { /* panel keeps last state */ });
            });
            await this.refreshProviders();
            this._panel.setStatus(this.isUnsafeHostExecutionAllowed()
                ? "Ready. Dev host execution is enabled."
                : "Ready. Only constrained viewer scripting is enabled.");
        } catch (error) {
            console.error("[chat-based-tester] boot failed", error);
            this._panel.setStatus(this._errorText(error, "Failed to initialize chat-based-tester."));
        }
    }

    _getConfig() {
        // Fallbacks intentionally match include.json so the two never disagree.
        const maxAutomationSteps = Number(this.getStaticMeta("maxAutomationSteps", 8));
        const bootstrapMaxFileChars = Number(this.getStaticMeta("bootstrapMaxFileChars", 3000));
        const consoleLogBufferSize = Number(this.getStaticMeta("consoleLogBufferSize", 5000));
        return {
            defaultAttachScreenshot: this.getStaticMeta("defaultAttachScreenshot", false) === true,
            defaultIncludeServerLogs: this.getStaticMeta("defaultIncludeServerLogs", true) !== false,
            defaultIncludeConsoleLogs: this.getStaticMeta("defaultIncludeConsoleLogs", true) !== false,
            defaultIncludeWorkspaceDocs: this.getStaticMeta("defaultIncludeWorkspaceDocs", true) !== false,
            maxAutomationSteps: Number.isFinite(maxAutomationSteps) ? Math.max(1, maxAutomationSteps) : 8,
            bootstrapMaxFileChars: Number.isFinite(bootstrapMaxFileChars) ? Math.max(800, bootstrapMaxFileChars) : 3000,
            consoleLogBufferSize: Number.isFinite(consoleLogBufferSize)
                ? Math.max(1000, Math.min(20000, consoleLogBufferSize))
                : 5000,
            defaultTestMode: this.getStaticMeta("defaultTestMode", "host") === "scripting" ? "scripting" : "host",
        };
    }

    /**
     * Extend the shared `console.appTrace` export buffer (installed by the
     * earliest inline script in server/templates/index.html, which captures
     * WARN/ERROR + window errors) with LOG/INFO/DEBUG entries. Dev mode only.
     * One buffer, one format — the loader error export sees the same data.
     */
    _installConsoleCapture() {
        const consoleAny = console as any;
        if (!Array.isArray(consoleAny.appTrace)) consoleAny.appTrace = [];
        if (consoleAny.__xopatChatDevConsoleCapture) return;
        consoleAny.__xopatChatDevConsoleCapture = true;
        consoleAny.__appTraceShift = Number(consoleAny.__appTraceShift || 0);

        for (const [level, tag] of Object.entries(CONSOLE_LEVEL_TAGS)) {
            const original = typeof consoleAny[level] === "function"
                ? consoleAny[level].bind(console)
                : () => { /* no-op */ };
            consoleAny[level] = (...args: any[]) => {
                try {
                    consoleAny.appTrace.push(tag, consoleTimestamp(), ...args, "\n");
                    this._trimConsoleBuffer();
                } catch (_) {
                    // capture must never break the console
                }
                return original(...args);
            };
        }
    }

    /**
     * Bound appTrace growth. Trimmed element count accumulates in
     * `console.__appTraceShift` so absolute cursors stay valid across trims.
     */
    _trimConsoleBuffer() {
        const consoleAny = console as any;
        const buffer = consoleAny.appTrace;
        if (!Array.isArray(buffer)) return;
        const overflow = buffer.length - this._getConfig().consoleLogBufferSize;
        if (overflow > 0) {
            buffer.splice(0, overflow);
            consoleAny.__appTraceShift = Number(consoleAny.__appTraceShift || 0) + overflow;
        }
    }

    /**
     * Read the browser console buffer (`console.appTrace`).
     * Cursor semantics mirror the server getLogs contract: pass the previous
     * `nextAfterIndex` as `afterIndex` to only receive new entries.
     */
    readConsoleLogs(payload: any = {}) {
        const consoleAny = console as any;
        this._trimConsoleBuffer();
        const buffer: any[] = Array.isArray(consoleAny.appTrace) ? consoleAny.appTrace : [];
        const shift = Number(consoleAny.__appTraceShift || 0);
        const afterIndex = Math.max(0, Number(payload?.afterIndex) || 0);
        const start = Math.max(0, afterIndex - shift);
        const limit = Math.max(1, Math.min(500, Number(payload?.limit) || 200));
        const maxChars = Math.max(1000, Math.min(20000, Number(payload?.maxChars) || 20000));
        const search = typeof payload?.search === "string" ? payload.search.trim().toLowerCase() : "";

        // Each captured call pushed "<LEVEL> ", [timestamp,] ...args, "\n" —
        // format elements, join, and split back into per-call lines.
        const text = buffer.slice(start).map(formatConsoleElement).join(" ");
        let lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        if (search) {
            lines = lines.filter((line) => line.toLowerCase().includes(search));
        }

        const hasMore = lines.length > limit;
        if (hasMore) lines = lines.slice(lines.length - limit);

        let joined = lines.join("\n");
        let truncated = false;
        if (joined.length > maxChars) {
            joined = joined.slice(joined.length - maxChars);
            truncated = true;
        }

        return {
            lines,
            text: joined,
            truncated,
            hasMore,
            nextAfterIndex: shift + buffer.length,
            totalBuffered: buffer.length,
        };
    }

    isServerDevMode() {
        const appEnv = (globalThis as any).APPLICATION_CONTEXT?.env || {};
        const coreServer = (globalThis as any).CORE?.server || appEnv?.server || {};
        return globalThis.XOPAT_DEV_MODE === true || coreServer.devMode === true;
    }

    isUnsafeHostExecutionAllowed() {
        return this.isServerDevMode();
    }

    requireChatModule() {
        if (this._chatModule) return this._chatModule;
        const module = singletonModule?.("vercel-ai-chat-sdk");
        if (!module) throw new Error("vercel-ai-chat-sdk is not available.");
        this._chatModule = module;
        return module;
    }

    async _waitForChatModule(timeoutMs = 15000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const mod = singletonModule?.("vercel-ai-chat-sdk");
            if (mod) return mod;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        throw new Error("Timed out waiting for vercel-ai-chat-sdk.");
    }

    _registerDevPersonality() {
        // Every createSession/sendTurn passes an explicit per-turn
        // personalityPrompt (mode-specific), which the SDK prefers over the
        // registered systemPrompt. The registration exists so the personality
        // id resolves in the SDK's personality registry / UI listing.
        this.requireChatModule().registerPersonality?.({
            id: this._personalityId,
            label: "Viewer Dev Tester",
            systemPrompt: this._buildHarnessPersonalityPrompt(),
        });
    }

    _buildHarnessPersonalityPrompt(): string {
        const base = [
            "You are a development testing assistant embedded in the xOpat viewer.",
            "Inspect the current viewer state, drive the viewer through automation, inspect implementation files when needed, and produce concise test-oriented findings.",
            "Use screenshots, logs, source files, and READMEs as evidence. Do not claim anything not supported by evidence.",
            "Keep each automation step targeted and reversible when possible.",
            "After you have enough evidence, stop scripting and return a concise report with: summary, evidence, likely root cause, and next manual check.",
            "Never invent API namespaces or methods.",
            "Do not ask the host to execute code manually.",
            "Always return the final value from xopat-script and xopat-host-script blocks.",
        ];

        if (this._testMode === "host") {
            return [
                ...base,
                "Selected test mode: host.",
                "Treat this as host-application testing, not scripting-API testing.",
                "Do not assume the viewer scripting API should be used.",
                "Prefer exactly one fenced code block tagged xopat-host-script whenever execution is needed.",
                "You may use direct host JavaScript and the injected host helper object.",
                "Host helper functions are also injected as direct globals: getServerStatus(), getServerLogs(), getConsoleLogs(), listWorkspaceDir(path), readWorkspaceFiles(paths), getDevSessionBootstrap(), captureViewerScreenshotDataUrl(), capturePageScreenshotDataUrl(), inspectRuntime(), inspectDom().",
                "getConsoleLogs({afterIndex?, limit?, search?}) returns recent browser console output (log/info/debug/warn/error + window errors); pass the previous result's nextAfterIndex as afterIndex to read only new entries.",
                "Prefer runtime inspection first: inspectRuntime(), singletonModule(id), viewerSingletonModule(className, viewerLike), window.xmodules, window.xplugins, plugin(id), and the visible DOM.",
                "Never guess file paths. Discover them with listWorkspaceDir(path) (readable roots: src, modules, plugins, server, ui, docs, plus *.md/*.json at the repo root), then read with readWorkspaceFiles(paths). Failed paths come back in the result's 'errors' array while valid paths still return content.",
                "Do not capture screenshots unless they are actually needed. For viewer-content evidence use captureViewerScreenshotDataUrl(). For UI structure prefer inspectDom() — capturePageScreenshotDataUrl() renders without external stylesheets, is only approximate, and is unavailable in Chromium-based browsers (tainted canvas).",
                "The bootstrap includes developer guidance. Use readWorkspaceFiles([...]) to pull more docs or source files before making assumptions about APIs or UI structure.",
                "At top level, return the final value directly. Avoid wrapping code in an async IIFE unless you return that promise explicitly.",
                "Do not emit xopat-script unless the harness explicitly switches to scripting mode.",
            ].join("\n");
        }

        return [
            ...base,
            "Selected test mode: scripting.",
            "Treat this as scripting-API testing.",
            "Prefer exactly one fenced code block tagged xopat-script whenever execution is needed.",
            "Use only the explicitly allowed viewer scripting API.",
            "Every scripting API call is asynchronous regardless of its declared return type: always await each namespace call (e.g. `const info = await application.getGlobalInfo();`).",
            "Do not emit xopat-host-script unless the harness explicitly switches to host mode.",
        ].join("\n");
    }

    getChatService() {
        return this.requireChatModule().chatService;
    }

    async refreshProviders() {
        const service = this.getChatService();
        await service.refreshProviderTypesFromServer?.();
        await service.refreshProvidersFromServer?.();
        const providers = service.getProviders?.() || [];

        if (!this._providerId || !providers.some((item: any) => item.id === this._providerId)) {
            this._providerId = providers[0]?.id || null;
        }

        if (this._providerId) {
            await this.refreshModels(this._providerId);
        }

        this._panel.setProviders(providers, this._providerId);
        this._panel.setModels(this._panel._models || [], this._modelId);
        return providers;
    }

    async refreshModels(providerId?: string | null) {
        const service = this.getChatService();
        const resolvedProviderId = providerId || this._providerId;
        if (!resolvedProviderId) {
            this._modelId = null;
            this._panel.setModels([], null);
            return [];
        }

        const models = await service.listModels(resolvedProviderId);
        if (!this._modelId || !models.some((item: any) => item.id === this._modelId)) {
            this._modelId = models[0]?.id || null;
        }
        this._panel.setModels(models, this._modelId);
        return models;
    }

    async setProvider(providerId: string | null) {
        this._providerId = providerId || null;
        this._sessionId = null;
        this._bootstrappedSessions.clear();
        await this.refreshModels(this._providerId);
    }

    setModel(modelId: string | null) {
        this._modelId = modelId || null;
        this._sessionId = null;
        this._bootstrappedSessions.clear();
    }

    grantAllScriptConsent() {
        const chat = this.requireChatModule();
        const entries = globalThis.APPLICATION_CONTEXT?.Scripting?.getNamespaceConsentEntries?.() || {};

        for (const namespace of Object.keys(entries)) {
            chat.setScriptNamespaceConsent?.(namespace, true);
        }

        chat.refreshScriptConsentFromManager?.();
        return chat.getAllowedScriptApiManifest?.() || { namespaces: [] };
    }

    getTestMode(): TestMode {
        return this._testMode;
    }

    setTestMode(mode: string | null) {
        this._testMode = mode === "scripting" ? "scripting" : "host";
        this._sessionId = null;
        this._lastLogId = 0;
        this._lastConsoleIndex = 0;
        this._bootstrappedSessions.clear();
        this.getChatService().setActiveSessionId?.(null);
        this._panel.clearMessages();
        this._panel.setStatus(
            this._testMode === "host"
                ? "Host test mode selected. The next run will start a fresh host-testing session."
                : "Scripting test mode selected. The next run will start a fresh scripting session."
        );
    }

    async ensureSession() {
        const service = this.getChatService();
        const providerId = this._providerId;
        if (!providerId) throw new Error("Select a provider first.");

        const provider = service.getProvider?.(providerId);
        const modelId = this._modelId || (await service.listModels(providerId))[0]?.id;
        if (!modelId) throw new Error(`Provider '${providerId}' did not return any models.`);

        if (this._sessionId) {
            service.setActiveSessionId?.(this._sessionId);
            await this._bootstrapSessionIfNeeded(this._sessionId);
            return this._sessionId;
        }

        const session = await service.createSession({
            providerId,
            modelId,
            personalityId: this._personalityId,
            personalityPrompt: this._buildHarnessPersonalityPrompt(),
            contextId: provider?.contextId || null,
            metadata: {
                sessionOwnerKey: "chat-based-tester",
                source: "chat-based-tester",
                testMode: this._testMode,
            },
        });

        this._sessionId = session.id;
        this._modelId = session.modelId || modelId;
        service.setActiveSessionId?.(session.id);
        await this._bootstrapSessionIfNeeded(session.id);
        return session.id;
    }

    async _bootstrapSessionIfNeeded(sessionId: string) {
        if (this._bootstrappedSessions.has(sessionId)) return;

        const service = this.getChatService();
        const bootstrapMessages = await this._buildBootstrapMessages();
        if (!bootstrapMessages.length) {
            this._bootstrappedSessions.add(sessionId);
            return;
        }

        await service.appendMessages(sessionId, bootstrapMessages);
        bootstrapMessages.forEach((message) => this._panel.addMessage(message));
        this._bootstrappedSessions.add(sessionId);
    }

    async _buildBootstrapMessages() {
        const messages: any[] = [];
        const statusMessage = await this._buildServerStatusMessage();
        if (statusMessage) messages.push(statusMessage);

        const workspaceMessages = await this._buildWorkspaceBootstrapMessages();
        messages.push(...workspaceMessages);

        const intro = this._testMode === "host"
            ? [
                "Selected test mode: host",
                "Treat this as host-application testing, not scripting-API testing.",
                "You are not required to use the viewer scripting API in this session.",
                "Prefer xopat-host-script for direct host-app inspection, DOM work, global state access, and custom JavaScript execution.",
                "The host helper exposes: getServerStatus(), getServerLogs(), getConsoleLogs(), listWorkspaceDir(path), readWorkspaceFiles(paths), getDevSessionBootstrap(), captureViewerScreenshotDataUrl(), capturePageScreenshotDataUrl(), inspectRuntime(), inspectDom().",
                "getConsoleLogs({afterIndex?, limit?, search?}) returns recent browser console output (log/info/debug/warn/error + window errors); pass the previous nextAfterIndex as afterIndex to read only new entries.",
                "Discover app capabilities through inspectRuntime(), singletonModule(id), viewerSingletonModule(className, viewerLike), window.xmodules, window.xplugins, plugin(id), and targeted workspace file reads.",
                "Never guess file paths: list directories with listWorkspaceDir(path) first, then readWorkspaceFiles(paths). Failed paths are reported in the result's 'errors' array; valid paths still return content.",
                "For viewer-content evidence use captureViewerScreenshotDataUrl(). For UI structure prefer inspectDom(); capturePageScreenshotDataUrl() renders without external stylesheets, is only an approximation, and is unavailable in Chromium-based browsers (tainted canvas).",
                "The developer guide and repository docs were attached so you can pull more documentation yourself when needed.",
                "Return the final value explicitly from every script block.",
            ].join("\n")
            : [
                "Selected test mode: scripting",
                "Treat this as scripting-API testing.",
                "Prefer xopat-script and the allowed viewer scripting API.",
                "Every scripting API call is asynchronous regardless of its declared return type: always await each namespace call.",
                "Do not use xopat-host-script unless the harness explicitly switches to host mode.",
                "The developer guide and repository docs were attached so you can inspect documentation while testing.",
                "Return the final value explicitly from every script block.",
            ].join("\n");

        messages.unshift(this._hostFeedbackMessage(intro, { source: "chat-based-tester/bootstrap" }));
        return messages;
    }

    async _buildWorkspaceBootstrapMessages() {
        const rpc = (globalThis as any).xserver?.module?.["chat-based-tester"];
        if (!rpc?.getDevSessionBootstrap) return [];

        try {
            const response = await rpc.getDevSessionBootstrap({
                includeReadmes: this._getConfig().defaultIncludeWorkspaceDocs,
                includeSources: false,
                maxFileChars: this._getConfig().bootstrapMaxFileChars,
            });

            const messages: any[] = [];
            const instructions = Array.isArray(response?.instructions) ? response.instructions : [];
            if (instructions.length) {
                messages.push(this._hostFeedbackMessage(
                    `Development session instructions:\n${instructions.join("\n")}`,
                    { source: "chat-based-tester/bootstrap-instructions" }
                ));
            }

            const files = Array.isArray(response?.files) ? response.files : [];
            for (const file of files) {
                const header = [
                    `Workspace ${file.kind || "text"}: ${file.path}`,
                    file.truncated ? "(content truncated for bootstrap)" : null,
                ].filter(Boolean).join("\n");
                messages.push(this._hostFeedbackMessage(`${header}\n\n${file.content || ""}`, {
                    source: "chat-based-tester/workspace-file",
                    path: file.path,
                    kind: file.kind,
                    truncated: !!file.truncated,
                }));
            }

            const omittedPaths = Array.isArray(response?.omittedPaths) ? response.omittedPaths : [];
            if (omittedPaths.length) {
                messages.push(this._hostFeedbackMessage(
                    `Bootstrap omitted ${omittedPaths.length} file(s) to stay within the prompt budget. Pull extra files on demand with readWorkspaceFiles(paths).\n${omittedPaths.join("\n")}`,
                    { source: "chat-based-tester/bootstrap-omitted" }
                ));
            }

            return messages;
        } catch (error) {
            return [this._hostFeedbackMessage(
                `Unable to load workspace bootstrap documents: ${this._errorText(error, "Unknown error")}`,
                { source: "chat-based-tester/bootstrap-error" }
            )];
        }
    }

    async _buildServerStatusMessage() {
        const rpc = (globalThis as any).xserver?.server?.core;
        if (!rpc?.getStatus) return null;

        try {
            const status = await rpc.getStatus({ includeRegistry: true });
            const text = [
                "Dev server status:",
                `version: ${status?.version || "unknown"}`,
                `devMode: ${status?.devMode === true ? "true" : "false"}`,
                `startedAt: ${status?.startedAt || "unknown"}`,
                `uptimeMs: ${status?.uptimeMs ?? "unknown"}`,
                `pid: ${status?.pid ?? "unknown"}`,
                `node: ${status?.node || "unknown"}`,
                `plugins: ${status?.registry?.pluginCount ?? 0}`,
                `modules: ${status?.registry?.moduleCount ?? 0}`,
                `bufferedLogs: ${status?.logBuffer?.totalBuffered ?? 0}/${status?.logBuffer?.maxEntries ?? 0}`,
            ].join("\n");
            return this._hostFeedbackMessage(text, { source: "chat-based-tester/server-status" });
        } catch (error) {
            return this._hostFeedbackMessage(
                `Unable to read dev server status: ${this._errorText(error, "Unknown error")}`,
                { source: "chat-based-tester/server-status-error" }
            );
        }
    }

    async resetSession() {
        this._sessionId = null;
        this._lastLogId = 0;
        this._lastConsoleIndex = 0;
        this._bootstrappedSessions.clear();
        this.getChatService().setActiveSessionId?.(null);
        this._panel.clearMessages();
        this._panel.setStatus("Session cleared. The next turn will start a fresh test session.");
    }

    async runTestTurn(input: {
        prompt: string;
        attachScreenshot?: boolean;
        includeServerLogs?: boolean;
        includeConsoleLogs?: boolean;
        maxSteps?: number;
    }) {
        if (this._running) throw new Error("A test run is already in progress.");
        if (!this.isServerDevMode()) throw new Error("chat-based-tester requires server dev mode.");

        const chat = this.requireChatModule();
        const service = this.getChatService();
        const sessionId = await this.ensureSession();
        const controller = new AbortController();
        const allowedScriptApi = this._testMode === "scripting"
            ? this.grantAllScriptConsent()
            : undefined;
        this._abortController = controller;
        this._running = true;
        service.setActiveSessionId?.(sessionId);

        try {
            if (input.includeServerLogs) {
                const logMessage = await this._buildServerLogMessage();
                if (logMessage) {
                    await service.appendMessages(sessionId, [logMessage]);
                    this._panel.addMessage(logMessage);
                }
            }

            if (input.includeConsoleLogs) {
                const consoleMessage = this._buildConsoleLogMessage();
                if (consoleMessage) {
                    await service.appendMessages(sessionId, [consoleMessage]);
                    this._panel.addMessage(consoleMessage);
                }
            }

            if (input.attachScreenshot) {
                // Screenshot capture must never abort the run (e.g. Chromium
                // throws SecurityError for tainted canvases) — degrade to a
                // textual notice the model can act on.
                try {
                    const screenshotMessage = await this._attachDefaultScreenshot(sessionId);
                    if (screenshotMessage) {
                        this._panel.addMessage(screenshotMessage);
                    }
                } catch (error) {
                    const notice = this._hostFeedbackMessage([
                        `Screenshot attachment failed: ${this._errorText(error, "Unknown error")}`,
                        "Continue without the initial screenshot. Use inspectDom() for UI structure or captureViewerScreenshotDataUrl() for viewer-canvas evidence.",
                    ].join("\n"), { source: "chat-based-tester/screenshot-error" });
                    await service.appendMessages(sessionId, [notice]);
                    this._panel.addMessage(notice);
                }
            }

            const userMessage = {
                role: "user",
                parts: [{ type: "text", text: input.prompt }],
                content: input.prompt,
                createdAt: new Date(),
            };
            await service.appendMessages(sessionId, [userMessage]);
            this._panel.addMessage(userMessage);

            const maxSteps = Math.max(1, Number(input.maxSteps || this._getConfig().maxAutomationSteps || 8));

            for (let step = 0; step < maxSteps; step++) {
                if (controller.signal.aborted) throw new DOMException("Stopped by user.", "AbortError");

                this._panel.setStatus(step === 0 ? "Sending..." : `Continuing automation (${step + 1}/${maxSteps})...`);
                const reply = await service.sendTurn({
                    sessionId,
                    providerId: this._providerId,
                    allowedScriptApi,
                    personalityId: this._personalityId,
                    personalityPrompt: this._buildHarnessPersonalityPrompt(),
                    executionMode: this._testMode === "host" ? "host" : "viewer-script",
                    signal: controller.signal,
                });

                this._panel.addMessage(reply);

                const block = this._extractAutomationBlock(reply);
                if (!block) {
                    this._panel.setStatus("Assistant finished.");
                    return;
                }

                this._panel.setStatus(block.kind === "host"
                    ? `Executing host script (${step + 1}/${maxSteps})...`
                    : `Executing viewer script (${step + 1}/${maxSteps})...`);

                let executionMessage = await this._executeAutomationBlock(chat, block, controller.signal);
                const failed = (executionMessage?.parts || []).some((part: any) => part.type === "script-result" && part.ok === false);

                if (failed) {
                    const text = executionMessage?.content || "Script execution failed.";
                    executionMessage = this._hostFeedbackMessage([
                        `${block.kind === "host" ? "Host execution" : "Script execution"} failed.`,
                        `Error: ${text}`,
                        "Use only capabilities explicitly granted by the harness. If necessary information is missing, ask one short clarification question.",
                    ].join("\n"), {
                        source: "chat-based-tester/execution-error",
                        kind: block.kind,
                    });
                }

                await service.appendMessages(sessionId, [executionMessage]);
                this._panel.addMessage(executionMessage);
            }

            const cappedMessage = this._hostFeedbackMessage(
                `Harness stopped after reaching the max automation depth of ${maxSteps} steps. Produce a concise report from the evidence collected so far.`,
                { source: "chat-based-tester/max-steps" }
            );
            await service.appendMessages(sessionId, [cappedMessage]);
            this._panel.addMessage(cappedMessage);

            const finalReply = await service.sendTurn({
                sessionId,
                providerId: this._providerId,
                allowedScriptApi,
                personalityId: this._personalityId,
                personalityPrompt: this._buildHarnessPersonalityPrompt(),
                executionMode: this._testMode === "host" ? "host" : "viewer-script",
                signal: controller.signal,
            });
            this._panel.addMessage(finalReply);
            this._panel.setStatus("Assistant finished after max-step cap.");
        } finally {
            this._running = false;
            this._abortController = null;
        }
    }

    stopRun() {
        this._abortController?.abort("Stopped by user.");
        this.getChatService()?.cancelActiveTurn?.("Stopped by user.");
        this._panel.setStatus("Stopping...");
    }

    _extractAutomationBlock(message: any): AutomationBlock | null {
        const content = String(message?.content || "");
        const hostMatch = content.match(/```xopat-host-script\s*([\s\S]*?)```/i);
        if (hostMatch?.[1]?.trim()) {
            return { kind: "host", code: hostMatch[1].trim() };
        }

        const safeMatch = this.requireChatModule().extractScriptFromAssistantMessage?.(message);
        if (safeMatch?.trim()) {
            // In host mode a generic ```js / ```ts (or bare xopat-script) block is
            // host code — the sandboxed worker would reject it anyway because no
            // scripting-API manifest is granted in this mode.
            return { kind: this._testMode === "host" ? "host" : "script", code: safeMatch.trim() };
        }

        return null;
    }

    async _executeAutomationBlock(chatModule: any, block: AutomationBlock, signal?: AbortSignal) {
        if (block.kind === "host") {
            return this._executeUnsafeHostScript(chatModule, block.code, { signal });
        }
        return chatModule.executeAssistantScript(block.code, { signal });
    }

    async _executeUnsafeHostScript(chatModule: any, script: string, options: { signal?: AbortSignal } = {}) {
        if (this._testMode !== "host") {
            return {
                role: "user",
                parts: [{ ok: false, type: "script-result", text: "Host execution is disabled while the harness is in scripting test mode." }],
                content: "Host execution is disabled while the harness is in scripting test mode.",
                createdAt: new Date(),
            };
        }
        if (!this.isUnsafeHostExecutionAllowed()) {
            return {
                role: "user",
                parts: [{ ok: false, type: "script-result", text: "Unsafe host execution is disabled outside server dev mode." }],
                content: "Unsafe host execution is disabled outside server dev mode.",
                createdAt: new Date(),
            };
        }

        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
        const signal = options.signal;

        try {
            if (signal?.aborted) throw new DOMException("Stopped by user.", "AbortError");

            const host = this._createHostExecutionApi();
            const result = await new AsyncFunction(
                "window",
                "globalThis",
                "document",
                "APPLICATION_CONTEXT",
                "VIEWER_MANAGER",
                "VIEWER",
                "USER_INTERFACE",
                "UTILITIES",
                "xserver",
                "singletonModule",
                "chatModule",
                "host",
                "getServerStatus",
                "getServerLogs",
                "getConsoleLogs",
                "readWorkspaceFiles",
                "listWorkspaceDir",
                "getDevSessionBootstrap",
                "captureViewerScreenshotDataUrl",
                "capturePageScreenshotDataUrl",
                "inspectRuntime",
                "inspectDom",
                "signal",
                `"use strict";\n${script}`
            )(
                window,
                globalThis,
                document,
                (globalThis as any).APPLICATION_CONTEXT,
                (globalThis as any).VIEWER_MANAGER,
                (globalThis as any).VIEWER,
                (globalThis as any).USER_INTERFACE,
                (globalThis as any).UTILITIES,
                (globalThis as any).xserver,
                singletonModule,
                chatModule,
                host,
                host.getServerStatus,
                host.getServerLogs,
                host.getConsoleLogs,
                host.readWorkspaceFiles,
                host.listWorkspaceDir,
                host.getDevSessionBootstrap,
                host.captureViewerScreenshotDataUrl,
                host.capturePageScreenshotDataUrl,
                host.inspectRuntime,
                host.inspectDom,
                signal || null,
            );

            if (signal?.aborted) throw new DOMException("Stopped by user.", "AbortError");
            return await chatModule._normalizeScriptResultToMessage(result);
        } catch (error) {
            const text = this._errorText(error, "Unknown host execution error");
            return {
                role: "user",
                parts: [{ ok: false, type: "script-result", text }],
                content: text,
                createdAt: new Date(),
            };
        }
    }

    _createHostExecutionApi() {
        return {
            getServerStatus: async (payload: any = {}) => {
                const rpc = (globalThis as any).xserver?.server?.core;
                if (!rpc?.getStatus) throw new Error("Dev server status RPC is not available.");
                return rpc.getStatus(payload);
            },
            getServerLogs: async (payload: any = {}) => {
                const rpc = (globalThis as any).xserver?.server?.core;
                if (!rpc?.getLogs) throw new Error("Dev server logs RPC is not available.");
                return rpc.getLogs(payload);
            },
            getConsoleLogs: (payload: any = {}) => this.readConsoleLogs(payload),
            readWorkspaceFiles: async (paths: string[], payload: any = {}) => {
                const rpc = (globalThis as any).xserver?.module?.["chat-based-tester"];
                if (!rpc?.readWorkspaceFiles) throw new Error("Workspace file RPC is not available.");
                return rpc.readWorkspaceFiles({
                    paths,
                    maxFileChars: payload?.maxFileChars,
                });
            },
            listWorkspaceDir: async (dirPath: string = "", payload: any = {}) => {
                const rpc = (globalThis as any).xserver?.module?.["chat-based-tester"];
                if (!rpc?.listWorkspaceDir) throw new Error("Workspace directory RPC is not available.");
                return rpc.listWorkspaceDir({
                    path: dirPath,
                    maxEntries: payload?.maxEntries,
                });
            },
            getDevSessionBootstrap: async (payload: any = {}) => {
                const rpc = (globalThis as any).xserver?.module?.["chat-based-tester"];
                if (!rpc?.getDevSessionBootstrap) throw new Error("Dev session bootstrap RPC is not available.");
                return rpc.getDevSessionBootstrap(payload);
            },
            captureViewerScreenshotDataUrl: async () => {
                const blob = await this._captureViewerScreenshotBlob();
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onerror = () => reject(reader.error || new Error("Failed to read screenshot blob."));
                    reader.onload = () => resolve(String(reader.result || ""));
                    reader.readAsDataURL(blob);
                });
            },
            capturePageScreenshotDataUrl: async () => {
                return await this._capturePageScreenshotDataUrl();
            },
            inspectRuntime: () => {
                const xmods = (globalThis as any).xmodules || {};
                const xplugins = (globalThis as any).xplugins || {};
                const viewerManager = (globalThis as any).VIEWER_MANAGER;
                const viewers = Array.isArray(viewerManager?.viewers) ? viewerManager.viewers : [];
                return {
                    location: {
                        href: globalThis.location?.href || null,
                        pathname: globalThis.location?.pathname || null,
                    },
                    devMode: this.isServerDevMode(),
                    moduleExports: Object.keys(xmods).sort(),
                    pluginExports: Object.keys(xplugins).sort(),
                    singletonModuleAvailable: typeof (globalThis as any).singletonModule === "function",
                    pluginLookupAvailable: typeof (globalThis as any).plugin === "function",
                    viewerSingletonModuleAvailable: typeof (globalThis as any).viewerSingletonModule === "function",
                    viewers: viewers.map((viewer: any) => ({
                        id: viewer?.uniqueId || null,
                        elementId: viewer?.element?.id || null,
                        containerId: viewer?.container?.id || null,
                    })),
                    activeViewerId: viewerManager?.activeViewer?.uniqueId || null,
                    layoutTabs: Array.from(document.querySelectorAll("[data-tab-id], .tabs [id], .menu [id]"))
                        .slice(0, 40)
                        .map((el) => ({
                            tag: el.tagName,
                            id: (el as HTMLElement).id || null,
                            dataTabId: (el as HTMLElement).getAttribute?.("data-tab-id") || null,
                            text: ((el as HTMLElement).innerText || "").trim().slice(0, 120),
                        })),
                };
            },
            inspectDom: (payload: any = {}) => {
                const selector = typeof payload?.selector === "string" ? payload.selector.trim() : "";
                const selectors = Array.isArray(payload?.selectors)
                    ? payload.selectors.map((item: any) => String(item || "").trim()).filter(Boolean)
                    : [];
                const resolvedSelectors = selector ? [selector, ...selectors] : selectors;
                const maxNodes = Math.max(1, Math.min(100, Number(payload?.maxNodes) || 30));
                const pickNodes = (elements: Element[]) => elements.slice(0, maxNodes).map((el) => ({
                    tag: el.tagName,
                    id: (el as HTMLElement).id || null,
                    classes: (el as HTMLElement).className || "",
                    role: (el as HTMLElement).getAttribute?.("role") || null,
                    title: (el as HTMLElement).getAttribute?.("title") || null,
                    ariaLabel: (el as HTMLElement).getAttribute?.("aria-label") || null,
                    text: ((el as HTMLElement).innerText || "").trim().slice(0, 160),
                    rect: (() => {
                        const rect = (el as HTMLElement).getBoundingClientRect?.();
                        return rect ? {
                            x: Math.round(rect.x),
                            y: Math.round(rect.y),
                            width: Math.round(rect.width),
                            height: Math.round(rect.height),
                        } : null;
                    })(),
                }));

                if (resolvedSelectors.length) {
                    return {
                        mode: "selectors",
                        selectors: resolvedSelectors.map((item) => ({
                            selector: item,
                            count: document.querySelectorAll(item).length,
                            nodes: pickNodes(Array.from(document.querySelectorAll(item))),
                        })),
                    };
                }

                const clickable = Array.from(document.querySelectorAll("button,a,[role='button'],input,select,textarea"));
                return {
                    mode: "overview",
                    title: document.title,
                    activeElement: document.activeElement ? {
                        tag: (document.activeElement as HTMLElement).tagName,
                        id: (document.activeElement as HTMLElement).id || null,
                        classes: (document.activeElement as HTMLElement).className || "",
                    } : null,
                    clickableCount: clickable.length,
                    clickables: pickNodes(clickable),
                };
            },
        };
    }

    async _capturePageScreenshotDataUrl() {
        const width = Math.max(
            1,
            Math.ceil(
                Math.max(
                    document.documentElement?.scrollWidth || 0,
                    document.documentElement?.clientWidth || 0,
                    window.innerWidth || 0
                )
            )
        );
        const height = Math.max(
            1,
            Math.ceil(
                Math.max(
                    document.documentElement?.scrollHeight || 0,
                    document.documentElement?.clientHeight || 0,
                    window.innerHeight || 0
                )
            )
        );

        const clone = document.documentElement.cloneNode(true) as HTMLElement;
        for (const el of Array.from(clone.querySelectorAll("script"))) {
            el.remove();
        }

        const serializer = new XMLSerializer();
        const serialized = serializer.serializeToString(clone);
        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
            `<foreignObject width="100%" height="100%">`,
            `<div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div>`,
            `</foreignObject>`,
            `</svg>`,
        ].join("");

        const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const element = new Image();
                element.onload = () => resolve(element);
                element.onerror = () => reject(new Error("Failed to render page snapshot image."));
                element.src = url;
            });

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Unable to create 2D canvas context for page snapshot.");
            ctx.drawImage(img, 0, 0);
            try {
                return canvas.toDataURL("image/png");
            } catch (error) {
                // Chromium taints canvases that drew SVG foreignObject content.
                throw new Error(
                    "Page screenshot is not supported in this browser (SVG foreignObject taints the canvas). "
                    + "Use captureViewerScreenshotDataUrl() for viewer-canvas evidence or inspectDom() for UI structure."
                );
            }
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async _buildServerLogMessage() {
        const rpc = (globalThis as any).xserver?.server?.core;
        if (!rpc?.getLogs) return null;

        try {
            const response = await rpc.getLogs({
                afterId: this._lastLogId,
                limit: 120,
            });
            const entries = Array.isArray(response?.entries) ? response.entries : [];
            this._lastLogId = Number(response?.nextAfterId || this._lastLogId || 0);
            if (!entries.length) return null;

            const text = [
                "Recent dev server logs:",
                ...entries.map((entry: any) => {
                    const timestamp = entry?.timestamp ? new Date(entry.timestamp).toISOString() : "";
                    const level = String(entry?.level || "log").toUpperCase();
                    const source = entry?.source ? ` (${entry.source})` : "";
                    return `[${timestamp}] ${level}${source}: ${entry?.message || ""}`.trim();
                }),
            ].join("\n");

            return this._hostFeedbackMessage(text, { source: "chat-based-tester/server-logs" });
        } catch (error) {
            return this._hostFeedbackMessage(
                `Unable to read dev server logs: ${this._errorText(error, "Unknown error")}`,
                { source: "chat-based-tester/server-logs-error" }
            );
        }
    }

    _buildConsoleLogMessage() {
        try {
            const snapshot = this.readConsoleLogs({
                afterIndex: this._lastConsoleIndex,
                limit: 120,
            });
            this._lastConsoleIndex = Number(snapshot?.nextAfterIndex || this._lastConsoleIndex || 0);
            if (!snapshot?.lines?.length) return null;

            const text = [
                "Recent browser console logs:",
                snapshot.truncated ? "(oldest lines truncated to fit)" : null,
                snapshot.text,
            ].filter(Boolean).join("\n");
            return this._hostFeedbackMessage(text, { source: "chat-based-tester/console-logs" });
        } catch (error) {
            return this._hostFeedbackMessage(
                `Unable to read browser console logs: ${this._errorText(error, "Unknown error")}`,
                { source: "chat-based-tester/console-logs-error" }
            );
        }
    }

    async _attachDefaultScreenshot(sessionId: string) {
        // The viewer canvas is the only reliably exportable capture: the
        // full-page SVG-foreignObject render taints the canvas in Chromium
        // (SecurityError on toDataURL). Page capture stays available as an
        // on-demand host helper for browsers that support it.
        return this._attachViewerScreenshot(sessionId);
    }

    async _attachViewerScreenshot(sessionId: string) {
        const service = this.getChatService();
        const blob = await this._captureViewerScreenshotBlob();
        const attachment = await service.uploadAttachment({
            sessionId,
            file: blob,
            name: `chat-dev-screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
            kind: "screenshot",
            metadata: {
                source: "viewer",
                via: "chat-based-tester",
            },
        });
        await service.attachUploadedFileAsMessage({ sessionId, attachment, role: "user" });
        return this._messageFromAttachment(attachment);
    }

    _messageFromAttachment(attachment: any) {
        if (attachment.kind === "image" || attachment.kind === "screenshot") {
            return {
                role: "user",
                parts: [{
                    type: "image",
                    attachmentId: attachment.id,
                    mimeType: attachment.mimeType,
                    name: attachment.name,
                    dataUrl: attachment.dataUrl,
                    metadata: attachment.metadata,
                }],
                createdAt: new Date(),
            };
        }

        return {
            role: "user",
            parts: [{
                type: "file",
                attachmentId: attachment.id,
                mimeType: attachment.mimeType,
                name: attachment.name || attachment.id,
                dataUrl: attachment.dataUrl,
                metadata: attachment.metadata,
            }],
            createdAt: new Date(),
        };
    }

    async _captureViewerScreenshotBlob() {
        const viewer = (globalThis as any).VIEWER_MANAGER?.activeViewer || (globalThis as any).VIEWER;
        if (!viewer) {
            throw new Error("No viewer is open — cannot capture a viewer screenshot.");
        }

        const drawerCanvas = viewer.drawer?.canvas;
        // Prefer the OSD tools screenshot (same path as the scripting API's
        // viewer.getViewportScreenshot) — it copies the drawer canvas into a
        // fresh, untainted 2D canvas. Fall back to the raw drawer canvas.
        // (`viewer.canvas` is OSD's container div, never usable here.)
        let canvas: any = null;
        try {
            const ctx = viewer.tools?.screenshot?.(false, {
                x: drawerCanvas?.width || 0,
                y: drawerCanvas?.height || 0,
            });
            canvas = ctx?.canvas || null;
        } catch (_) {
            canvas = null;
        }
        if (!canvas || typeof canvas.toBlob !== "function") canvas = drawerCanvas;
        if (!canvas || typeof canvas.toBlob !== "function") {
            throw new Error("The viewer canvas is not available for screenshot capture (no image rendered yet?).");
        }

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob: Blob | null) => {
                if (blob) resolve(blob);
                else reject(new Error("Failed to capture viewer screenshot."));
            }, "image/png");
        });
    }

    _hostFeedbackMessage(text: string, metadata: Record<string, unknown> = {}) {
        return {
            role: "user",
            parts: [{
                type: "host-feedback",
                text,
                metadata,
            }],
            content: text,
            createdAt: new Date(),
            metadata,
        };
    }

    _errorText(error: any, fallback: string) {
        return error instanceof Error ? error.message : String(error || fallback);
    }
}

class ChatDevPanel {
    module: any;
    root: HTMLElement | null;
    messagesEl: HTMLElement | null;
    statusEl: HTMLElement | null;
    promptEl: HTMLTextAreaElement | null;
    providerSelectEl: HTMLSelectElement | null;
    modelSelectEl: HTMLSelectElement | null;
    modeSelectEl: HTMLSelectElement | null;
    screenshotCheckboxEl: HTMLInputElement | null;
    screenshotLabelEl: HTMLSpanElement | null;
    logsCheckboxEl: HTMLInputElement | null;
    consoleLogsCheckboxEl: HTMLInputElement | null;
    maxStepsInputEl: HTMLInputElement | null;
    sendBtnEl: HTMLButtonElement | null;
    stopBtnEl: HTMLButtonElement | null;
    _models: any[];

    constructor(module: any) {
        this.module = module;
        this.root = null;
        this.messagesEl = null;
        this.statusEl = null;
        this.promptEl = null;
        this.providerSelectEl = null;
        this.modelSelectEl = null;
        this.modeSelectEl = null;
        this.screenshotCheckboxEl = null;
        this.screenshotLabelEl = null;
        this.logsCheckboxEl = null;
        this.consoleLogsCheckboxEl = null;
        this.maxStepsInputEl = null;
        this.sendBtnEl = null;
        this.stopBtnEl = null;
        this._models = [];
    }

    create() {
        const cfg = this.module._getConfig();

        const root = this._el("div", { className: "flex flex-col h-full bg-base-100 text-sm border-l border-base-300" });
        const header = this._el("div", { className: "flex items-center justify-between gap-2 px-3 py-2 border-b border-base-300 bg-base-200" },
            this._el("div", { className: "font-semibold" }, "Viewer Test Harness"),
            this._el("div", { className: "text-xs opacity-70" }, this.module.isUnsafeHostExecutionAllowed() ? "dev host JS enabled" : "safe scripting only")
        );

        this.providerSelectEl = this._el("select", {
            className: "select select-sm select-bordered w-full",
            onchange: async (e: Event) => {
                const value = String((e.target as HTMLSelectElement).value || "");
                await this.module.setProvider(value || null);
            },
        }) as HTMLSelectElement;

        this.modelSelectEl = this._el("select", {
            className: "select select-sm select-bordered w-full",
            onchange: (e: Event) => {
                const value = String((e.target as HTMLSelectElement).value || "");
                this.module.setModel(value || null);
            },
        }) as HTMLSelectElement;

        this.modeSelectEl = this._el("select", {
            className: "select select-sm select-bordered w-full",
            onchange: (e: Event) => {
                const value = String((e.target as HTMLSelectElement).value || "");
                this.module.setTestMode(value || "host");
                this._refreshScreenshotLabel();
            },
        }) as HTMLSelectElement;
        this.modeSelectEl.appendChild(this._el("option", { value: "host" }, "Host App"));
        this.modeSelectEl.appendChild(this._el("option", { value: "scripting" }, "Scripting API"));
        this.modeSelectEl.value = this.module.getTestMode();

        this.screenshotCheckboxEl = this._checkbox(cfg.defaultAttachScreenshot);
        this.screenshotLabelEl = this._el("span", {}) as HTMLSpanElement;
        this.logsCheckboxEl = this._checkbox(cfg.defaultIncludeServerLogs);
        this.consoleLogsCheckboxEl = this._checkbox(cfg.defaultIncludeConsoleLogs);
        this.maxStepsInputEl = this._el("input", {
            className: "input input-sm input-bordered w-24",
            type: "number",
            min: "1",
            max: "20",
            value: String(cfg.maxAutomationSteps || 8),
        }) as HTMLInputElement;

        const controls = this._el("div", { className: "p-3 border-b border-base-200 flex flex-col gap-3" },
            this._field("Mode", this.modeSelectEl),
            this._field("Provider", this.providerSelectEl),
            this._field("Model", this.modelSelectEl),
            this._el("div", { className: "flex flex-wrap gap-3 items-center" },
                this._checkboxWrap(this.screenshotCheckboxEl, this.screenshotLabelEl),
                this._checkboxWrap(this.logsCheckboxEl, "Include recent server logs"),
                this._checkboxWrap(this.consoleLogsCheckboxEl, "Include recent console logs"),
                this._fieldInline("Max steps", this.maxStepsInputEl)
            )
        );
        this._refreshScreenshotLabel();

        this.messagesEl = this._el("div", {
            className: "flex-1 min-h-0 overflow-auto p-3 flex flex-col gap-2 bg-base-100",
        }) as HTMLElement;

        this.statusEl = this._el("div", { className: "text-xs opacity-70 truncate" }, "Initializing...") as HTMLElement;
        this.promptEl = this._el("textarea", {
            className: "textarea textarea-bordered textarea-sm w-full resize-none",
            rows: 5,
            placeholder: "Describe the test you want to run. Example: verify the active viewer can pan, zoom, inspect source-backed behavior, and report any server-side errors.",
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void this._handleSend();
                }
            },
        }) as HTMLTextAreaElement;

        this.sendBtnEl = this._button("Run", "btn btn-sm btn-primary", () => { void this._handleSend(); });
        this.stopBtnEl = this._button("Stop", "btn btn-sm", () => this.module.stopRun());
        const clearBtn = this._button("New session", "btn btn-sm", () => { void this.module.resetSession(); });
        const refreshBtn = this._button("Refresh providers", "btn btn-sm", () => { void this.module.refreshProviders(); });

        const composer = this._el("div", { className: "border-t border-base-300 p-3 flex flex-col gap-2" },
            this.promptEl,
            this._el("div", { className: "flex items-center justify-between gap-2 flex-wrap" },
                this.statusEl,
                this._el("div", { className: "flex items-center gap-2 flex-wrap" },
                    refreshBtn,
                    clearBtn,
                    this.stopBtnEl,
                    this.sendBtnEl
                )
            )
        );

        root.append(header, controls, this.messagesEl, composer);
        this.root = root;
        return root;
    }

    _field(labelText: string, input: HTMLElement) {
        return this._el("label", { className: "flex flex-col gap-1 text-xs font-medium" },
            this._el("span", {}, labelText),
            input
        );
    }

    _fieldInline(labelText: string, input: HTMLElement) {
        return this._el("label", { className: "flex items-center gap-2 text-xs font-medium" },
            this._el("span", {}, labelText),
            input
        );
    }

    _checkbox(checked: boolean) {
        return this._el("input", {
            type: "checkbox",
            className: "checkbox checkbox-sm",
            checked,
        }) as HTMLInputElement;
    }

    _checkboxWrap(input: HTMLInputElement, labelContent: string | Node) {
        return this._el("label", { className: "flex items-center gap-2 text-xs cursor-pointer" }, input, typeof labelContent === "string" ? this._el("span", {}, labelContent) : labelContent);
    }

    _refreshScreenshotLabel() {
        if (!this.screenshotLabelEl) return;
        this.screenshotLabelEl.textContent = "Attach viewer screenshot";
    }

    _button(text: string, className: string, onClick: () => void) {
        return this._el("button", { className, onclick: onClick, type: "button" }, text) as HTMLButtonElement;
    }

    setProviders(providers: any[], selectedId: string | null) {
        if (!this.providerSelectEl) return;
        this.providerSelectEl.innerHTML = "";
        this.providerSelectEl.appendChild(this._el("option", { value: "" }, "Select provider..."));
        providers.forEach((provider) => {
            this.providerSelectEl!.appendChild(this._el("option", { value: provider.id }, provider.label || provider.id));
        });
        this.providerSelectEl.value = selectedId || "";
    }

    setModels(models: any[], selectedId: string | null) {
        this._models = models || [];
        if (!this.modelSelectEl) return;
        this.modelSelectEl.innerHTML = "";
        if (!models.length) {
            this.modelSelectEl.appendChild(this._el("option", { value: "" }, "No models"));
            this.modelSelectEl.value = "";
            this.modelSelectEl.disabled = true;
            return;
        }

        models.forEach((model) => {
            this.modelSelectEl!.appendChild(this._el("option", { value: model.id }, model.label || model.id));
        });
        this.modelSelectEl.disabled = false;
        this.modelSelectEl.value = selectedId || models[0]?.id || "";
    }

    async _handleSend() {
        const prompt = String(this.promptEl?.value || "").trim();
        if (!prompt) return;

        try {
            this.setStatus("Starting test run...");
            await this.module.runTestTurn({
                prompt,
                attachScreenshot: !!this.screenshotCheckboxEl?.checked,
                includeServerLogs: !!this.logsCheckboxEl?.checked,
                includeConsoleLogs: !!this.consoleLogsCheckboxEl?.checked,
                maxSteps: Number(this.maxStepsInputEl?.value || 8),
            });
        } catch (error) {
            console.error("[chat-based-tester] run failed", error);
            this.addMessage({
                role: "user",
                parts: [{ type: "host-feedback", text: `Harness error: ${error instanceof Error ? error.message : String(error)}` }],
                content: `Harness error: ${error instanceof Error ? error.message : String(error)}`,
                createdAt: new Date(),
            });
            this.setStatus(error instanceof Error ? error.message : String(error));
        }
    }

    clearMessages() {
        if (this.messagesEl) this.messagesEl.innerHTML = "";
    }

    setStatus(text: string) {
        if (this.statusEl) this.statusEl.textContent = text || "";
    }

    addMessage(message: any) {
        if (!this.messagesEl) return;

        const role = String(message?.role || "assistant");
        const wrapper = this._el("div", {
            className: `rounded-2xl border border-base-300 px-3 py-2 ${role === "assistant" ? "bg-base-200" : "bg-base-100"}`,
        });

        wrapper.appendChild(this._el("div", { className: "text-[11px] uppercase tracking-wide opacity-60 mb-1" }, role));

        const text = this._friendlyText(message);
        if (text) {
            wrapper.appendChild(this._el("pre", {
                className: "whitespace-pre-wrap break-words text-xs m-0 font-sans",
            }, text));
        }

        for (const part of (message?.parts || [])) {
            if (part?.type === "image" && part?.dataUrl) {
                wrapper.appendChild(this._el("img", {
                    src: part.dataUrl,
                    alt: part.name || "image",
                    className: "mt-2 rounded-xl border border-base-300 max-w-full",
                }));
            }
        }

        this.messagesEl.appendChild(wrapper);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _friendlyText(message: any) {
        const module = this.module._chatModule;
        if (message?.role === "assistant" && module?.extractAssistantTextWithoutScript) {
            const base = module.extractAssistantTextWithoutScript(message) || message?.content || "";
            return String(base).replace(/```xopat-host-script\s*[\s\S]*?```/gi, "").trim();
        }

        if (typeof message?.content === "string" && message.content.trim()) {
            return message.content;
        }

        const parts = Array.isArray(message?.parts) ? message.parts : [];
        return parts.map((part: any) => {
            switch (part?.type) {
            case "text":
            case "host-feedback":
            case "script-result":
                return part.text || "";
            case "image":
                return part.name ? `[Image: ${part.name}]` : "[Image]";
            case "file":
                return part.name ? `[File: ${part.name}]` : "[File]";
            default:
                return "";
            }
        }).filter(Boolean).join("\n\n");
    }

    _el(tag: string, props: Record<string, any> = {}, ...children: any[]) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === "className") node.className = String(value);
            else if (key === "checked") (node as any).checked = !!value;
            else if (key.startsWith("on") && typeof value === "function") (node as any)[key.toLowerCase()] = value;
            else (node as any)[key] = value;
        }
        for (const child of children.flat()) {
            if (child === undefined || child === null || child === false) continue;
            node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return node;
    }
}

export { ChatBasedTester };
// Eager: nothing else instantiates this module, and module scripts execute
// after app init (LAYOUT / VIEWER_MANAGER / xserver already exist).
window.addModule("chat-based-tester", ChatBasedTester, true);
