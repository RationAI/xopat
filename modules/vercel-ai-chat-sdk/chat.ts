import { ChatPanel } from './ui/ChatPanel';
import { ProviderKeysPanel } from './ui/ProviderKeysPanel';
import {ChatService} from './chatService';

let enabled: boolean | undefined = undefined;
function isChatDebugModeEnabled(): boolean {
    if (enabled === undefined) {
        enabled = APPLICATION_CONTEXT.getOption("debugMode", true, true);
    }
    return !!enabled;
}

function truncateChatDebugText(value: string, maxChars = 8_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function debugSerializeChatValue(value: any, depth = 0): any {
    if (value == null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return truncateChatDebugText(value);
    if (depth >= 6) return "[Max debug depth reached]";
    if (Array.isArray(value)) return value.slice(0, 25).map((item) => debugSerializeChatValue(item, depth + 1));
    if (typeof value === "object") {
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value).slice(0, 25)) {
            output[key] = debugSerializeChatValue(item, depth + 1);
        }
        return output;
    }
    return String(value);
}

function chatDebugLog(label: string, data?: unknown): void {
    if (!isChatDebugModeEnabled()) return;

    if (typeof data === "undefined") {
        console.debug(`[CHAT DEBUG] ${label}`);
        return;
    }

    console.debug(`[CHAT DEBUG] ${label}`, debugSerializeChatValue(data));
}

class ChatModule extends XOpatModuleSingleton {
    chatService: ChatService;
    chatPanel: ChatPanel;
    _scriptConsent: ScriptNamespaceConsentState;
    /**
     * Scripting-access posture. `all-but-sensitive` (default) grants every non-sensitive namespace;
     * `all` grants everything incl. the patient namespace; `custom` uses per-namespace user choices.
     * Persisted only to the local user's `this.cache` (localStorage) with an expiry — NEVER to the
     * exported/imported session bundle, and never read from imported session data. So a returning
     * local user can be auto-approved, while an imported peer session still cannot escalate access (§7).
     */
    _scriptConsentMode: ScriptConsentMode = 'all-but-sensitive';
    /** Explicit per-namespace user choices, honored only in `custom` mode (survive list refreshes). */
    _customGrants: Record<string, boolean> = {};
    /** True when the current posture was auto-approved from the local remembered-consent cache. */
    _consentAutoApproved = false;
    /** Expiry (ms epoch) of the remembered consent currently applied, or null. Drives the pill tooltip. */
    _consentExpiresAt: number | null = null;
    _layoutAttached?: boolean;
    _settingsMenuAttached?: boolean;
    _providerKeysPanel: ProviderKeysPanel | null = null;
    _pendingNewNamespaces: Set<string> = new Set();
    _namespaceChangeScheduled = false;
    _scriptBaselineSettled = false;
    _scriptBaselineResolve!: () => void;
    _scriptBaselinePromise: Promise<void> = new Promise<void>((resolve) => {
        this._scriptBaselineResolve = resolve;
    });

    /**
     * Anonymization posture for the live viewer context that is streamed to the upstream
     * LLM. Operator-controlled static meta (§7 — read via getStaticMeta, NEVER getOption, so
     * an imported session bundle cannot downgrade it). `off` = real ids/names (current
     * behavior); `handles` = opaque ids, real names; `full` (default) = opaque ids AND names,
     * with the friendly name restored only when rendering to the local user.
     */
    _viewerAnonMode: 'off' | 'handles' | 'full' = 'full';
    /** Per-chat-session alias maps. real uniqueId → {handle,label}; label = real name for render swap. */
    _viewerAliasByReal: Map<string, { handle: string; label: string }> = new Map();
    /** handle → real uniqueId (reverse of _viewerAliasByReal). */
    _viewerRealByHandle: Map<string, string> = new Map();
    _viewerHandleSeq = 0;
    _viewerAliasSessionId: string | null | undefined = undefined;

    /**
     * In-memory workspace-change tracking. Re-baselined at the end of every
     * composeLiveViewerContext (the moment the model is shown the current open-slide set), so a
     * subsequent open/close/background-swap is a detectable delta. On such a delta the module
     * queues a one-shot `[system notice]` — the SAME channel as capability notices — telling the
     * model the workspace changed and the authoritative live "Current viewer state" block wins.
     * The signature is real `uniqueId`s only; it never leaves the client (no anonymization
     * concern) and the notice text names no slides, so it is safe under any anon mode and
     * correct for multi-viewer partial changes.
     */
    _workspaceSessionId: string | null | undefined = undefined;
    _workspaceBaselineSig: string | null = null;
    _workspaceWatchArmed = false;
    _workspaceCheckScheduled = false;

    static CONSENT_CACHE_KEY = 'consent';
    static PROVIDER_CACHE_KEY = 'providerId';
    static DEFAULT_CONSENT_REMEMBER_DAYS = 30;

    constructor() {
        super();

        const cfg = this._getChatConfig();
        this._scriptConsent = {};
        // Prefer the local user's remembered choice (cached in localStorage with an expiry);
        // otherwise the operator-trusted default posture (static meta — an imported session bundle
        // can change neither). Seeds _scriptConsentMode/_customGrants before deriving grants.
        const cached = this._readCachedConsent();
        if (cached) {
            this._scriptConsentMode = cached.mode;
            this._customGrants = cached.customGrants;
            this._consentAutoApproved = true;
            this._consentExpiresAt = cached.expiresAt;
        } else {
            this._scriptConsentMode = this._normalizeConsentMode(
                this.getStaticMeta?.('defaultScriptConsentMode', 'all-but-sensitive')
            );
        }

        this._viewerAnonMode = this._normalizeAnonMode(
            this.getStaticMeta?.('anonymizeViewerContext', 'full')
        );

        this.chatService = new ChatService({
            getAllowedScriptApi: () => this.getAllowedScriptApiManifest(),
            getLiveViewerContext: () => this.composeLiveViewerContext(),
            awaitReadyForSend: () => this.whenScriptBaselineSettled(),
            personalities: cfg.personalities,
            defaultPersonalityId: cfg.defaultPersonalityId,
            serverFactory: () => this.server(),
            sessionOwnerKey: 'vercel-ai-chat-sdk',
            legacySessionSource: 'vercel-ai-chat-sdk',
        });

        this.chatPanel = new ChatPanel({
            id: 'pathology-chat-panel',
            chatModule: this,
            chatService: this.chatService,
            defaultPersonalityId: cfg.defaultPersonalityId,
            maxScriptSteps: cfg.maxScriptSteps,
            maxScriptStepExtensions: cfg.maxScriptStepExtensions,
            scriptStepExtensionSize: cfg.scriptStepExtensionSize,
            minSuccessfulProgressStepsBeforeExtension: cfg.minSuccessfulProgressStepsBeforeExtension,
        });

        this.refreshScriptConsentFromManager();
        this._subscribeToScriptingNamespaceChanges();
        this._armScriptBaselineGate();
        this._attachToLayout();
        this._attachSettingsMenu();
        void this._bootstrapProviderCatalog();
    }

    /**
     * The scripting-capability baseline is "settled" once all boot-time plugins had
     * their chance to register namespaces (viewers opened = plugin loading + late-path
     * registrations done). Until then, namespace registrations are baseline — no
     * "new capability" notices or consent prompts — and sends are held back so the
     * first turn's manifest is complete.
     */
    _armScriptBaselineGate(): void {
        if ((globalThis as any).APPLICATION_CONTEXT?.isUiBootComplete?.()) {
            // Module loaded dynamically after boot — everything registered is baseline.
            this._settleScriptBaseline();
            return;
        }

        const manager = (globalThis as any).VIEWER_MANAGER;
        if (typeof manager?.addHandler === 'function') {
            const onOpen = () => {
                manager.removeHandler?.('after-open', onOpen);
                this._settleScriptBaseline();
            };
            manager.addHandler('after-open', onOpen);
        }
        // Failed/stalled boot must never deadlock the chat permanently.
        setTimeout(() => this._settleScriptBaseline(), 20_000);
    }

    _settleScriptBaseline(): void {
        if (this._scriptBaselineSettled) return;
        this._scriptBaselineSettled = true;
        this._pendingNewNamespaces.clear();
        this.refreshScriptConsentFromManager();
        this._scriptBaselineResolve();
    }

    whenScriptBaselineSettled(): Promise<void> {
        return this._scriptBaselinePromise;
    }

    _subscribeToScriptingNamespaceChanges(): void {
        const manager = APPLICATION_CONTEXT?.Scripting as any;
        if (typeof manager?.addNamespacesChangedHandler !== 'function') return;

        manager.addNamespacesChangedHandler(() => {
            // Registrations arriving before the baseline settles are boot-time plugins,
            // not mid-session additions: absorb them silently (consent list stays
            // current, no capability notices, no consent prompts).
            if (!this._scriptBaselineSettled) {
                this.refreshScriptConsentFromManager();
                return;
            }

            // Snapshot which namespaces we already knew about, then refresh from the
            // manager so newly-registered namespaces surface in the consent settings
            // (default-off, preserving prior grants).
            const priorKeys = new Set(Object.keys(this._scriptConsent));
            this.refreshScriptConsentFromManager();

            for (const key of Object.keys(this._scriptConsent)) {
                if (priorKeys.has(key)) continue;
                // In the preset modes the new namespace is already resolved by the mode
                // (non-sensitive granted, sensitive withheld) — surface a capability
                // notice for anything now granted, and never prompt.
                if (this._scriptConsent[key]?.granted) {
                    this._queueCapabilityNotice([key]);
                    continue;
                }
                // Only queue a per-namespace consent prompt while the user is curating
                // access explicitly (custom mode).
                if (this._scriptConsentMode === 'custom') this._pendingNewNamespaces.add(key);
            }

            // Batch namespaces registered together (e.g. one plugin exposing several)
            // into a single prompt on the next microtask.
            if (!this._namespaceChangeScheduled && this._pendingNewNamespaces.size) {
                this._namespaceChangeScheduled = true;
                queueMicrotask(() => {
                    this._namespaceChangeScheduled = false;
                    const names = [...this._pendingNewNamespaces];
                    this._pendingNewNamespaces.clear();
                    if (names.length) this._promptNewNamespaceConsent(names);
                });
            }
        });
    }

    _namespaceTitle(namespace: string): string {
        return this._scriptConsent[namespace]?.title || namespace;
    }

    _promptNewNamespaceConsent(namespaces: string[]): void {
        // Only nudge the user while a chat session is actually active; otherwise the
        // new namespace just sits (default-off) in the chat settings consent list.
        if (!this.chatService?._activeSessionId) return;

        const Dialogs = (window as any).Dialogs;
        if (typeof Dialogs?.show !== 'function') return;

        const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));

        const single = namespaces.length === 1;
        const label = single
            ? `"${this._namespaceTitle(namespaces[0]!)}"`
            : $.t('chat.newCapabilitiesCount', { count: namespaces.length });
        const message = $.t('chat.newCapabilityPrompt', {
            label,
            pronoun: single ? $.t('chat.pronounIt') : $.t('chat.pronounThem'),
        });

        Dialogs.show(escapeHtml(message), 0, Dialogs.MSG_WARN, {
            buttons: [
                {
                    label: $.t('chat.allow'),
                    class: 'btn-primary',
                    onClick: (_ev: Event, d: any) => {
                        namespaces.forEach((ns) => this.setScriptNamespaceConsent(ns, true));
                        this._queueCapabilityNotice(namespaces);
                        d?.hide?.();
                    },
                },
                {
                    label: $.t('chat.notNow'),
                    onClick: (_ev: Event, d: any) => d?.hide?.(),
                },
            ],
        });
    }

    _queueCapabilityNotice(namespaces: string[]): void {
        for (const ns of namespaces) {
            this.chatService?.queueCapabilityNotice?.(
                `A new capability "${this._namespaceTitle(ns)}" is now available to you. ` +
                `Call application.describeScriptingApi('${ns}') to discover how to use it.`
            );
        }
    }

    /**
     * Watch for the user opening/closing slides or swapping a viewer's image data mid-session, so
     * the model can be told the workspace changed since the previous message. Armed lazily on the
     * first composeLiveViewerContext (VIEWER_MANAGER is up by then, and it only matters once
     * chatting). Mirrors the fire-and-forget subscription style of the baseline gate — the
     * singleton lives for the whole session, so handlers are never removed.
     */
    _installWorkspaceChangeWatch(): void {
        if (this._workspaceWatchArmed) return;
        const manager = (globalThis as any).VIEWER_MANAGER;
        if (typeof manager?.addHandler !== 'function') return;
        this._workspaceWatchArmed = true;
        const onChange = () => this._scheduleWorkspaceCheck();
        // create/destroy = slide opened/closed; reset = background/data swapped within a viewer.
        manager.addHandler('viewer-create', onChange);
        manager.addHandler('viewer-destroy', onChange);
        manager.addHandler('viewer-reset', onChange);
    }

    /** Order-independent fingerprint of the open-slide set. `uniqueId` encodes the background id,
     *  so a data swap changes it too. Real ids — internal diff only, never sent upstream. */
    _currentWorkspaceSignature(): string {
        try {
            const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];
            return viewers
                .map((v: any) => String(v?.uniqueId || ''))
                .filter(Boolean)
                .sort()
                .join('|');
        } catch (_) {
            return '';
        }
    }

    /** Re-baseline to the current open-slide set for the active session (the model just saw it). */
    _markWorkspaceBaselineForSession(): void {
        this._workspaceSessionId = this.chatService?.getActiveSessionId?.() ?? null;
        this._workspaceBaselineSig = this._currentWorkspaceSignature();
    }

    _scheduleWorkspaceCheck(): void {
        if (this._workspaceCheckScheduled) return;
        this._workspaceCheckScheduled = true;
        // Coalesce the create+destroy+reset burst a single slide switch emits.
        setTimeout(() => {
            this._workspaceCheckScheduled = false;
            this._checkWorkspaceChange();
        }, 150);
    }

    _checkWorkspaceChange(): void {
        const sessionId = this.chatService?.getActiveSessionId?.() ?? null;
        // A change "since the previous message" needs a previous message: only act once a session
        // is active AND its baseline was set by a prior composeLiveViewerContext (send).
        if (!sessionId || this._workspaceSessionId !== sessionId || this._workspaceBaselineSig === null) {
            return;
        }
        const sig = this._currentWorkspaceSignature();
        if (sig === this._workspaceBaselineSig) return;
        this._workspaceBaselineSig = sig; // absorb into baseline so the same new state notifies once
        this._queueWorkspaceChangeNotice();
    }

    /** One-shot, drained onto the next user turn as `[system notice]` (same path as capability
     *  notices). Names no slides — the live viewer-state block carries the (anonymized) specifics. */
    _queueWorkspaceChangeNotice(): void {
        this.chatService?.queueCapabilityNotice?.(
            "The user changed the viewer workspace since the previous message: slides were opened, " +
            "closed, or their underlying image data was swapped. The 'Current viewer state' block in " +
            "this turn is authoritative — re-orient to it and do not assume slides referenced earlier " +
            "in the conversation are still open or unchanged."
        );
    }

    async _bootstrapProviderCatalog(): Promise<void> {
        // Idempotent retry in case USER_INTERFACE was not ready at construction.
        this._attachSettingsMenu();
        try {
            await this.chatService.refreshProviderTypesFromServer();
            await this.chatService.refreshProvidersFromServer();
            this.chatPanel?.refreshProviders?.();

            const activeProviderId =
                this.chatPanel?._providerId ||
                this.chatService.getProviders?.()[0]?.id ||
                null;

            if (activeProviderId) {
                await this.chatPanel?._refreshModelsForCurrentProvider?.();
            }
        } catch (error) {
            console.warn('Chat provider bootstrap failed:', error);
        }
    }

    _getActiveSessionModelCapabilities(): ModelCapabilities | null {
        const sessionId = this.chatService._activeSessionId;
        if (!sessionId) return null;

        const state = this.chatService._sessionState?.get?.(sessionId);
        const providerId = state?.providerId || null;
        if (!providerId) return null;

        const hydrationModels = this.chatService.getCachedModels?.(providerId) || [];
        const activeSession = this.chatPanel?._sessions?.find?.((s: any) => s.id === sessionId) || null;
        const modelId = activeSession?.modelId || this.chatPanel?._modelId || null;
        if (!modelId) return null;

        const model = hydrationModels.find((m: any) => m.id === modelId) || null;
        return model?.capabilities || null;
    }

    _isModelImageCapable(): boolean {
        return this._getActiveSessionModelCapabilities()?.images === 'supported';
    }

    _isModelFileCapable(): boolean {
        return this._getActiveSessionModelCapabilities()?.files === 'supported';
    }

    getScriptConsentEntries(): ScriptNamespaceConsentState {
        return this._scriptConsent;
    }

    getScriptConsentMode(): ScriptConsentMode {
        return this._scriptConsentMode;
    }

    /** Coerce an arbitrary (e.g. static-meta) value to a valid mode, defaulting to the safe posture. */
    _normalizeConsentMode(value: unknown): ScriptConsentMode {
        return (value === 'all' || value === 'custom' || value === 'all-but-sensitive')
            ? value
            : 'all-but-sensitive';
    }

    /** Effective grant for a namespace under the current mode. */
    _grantForMode(namespace: string, sensitive: boolean, defaultGranted: Set<string>): boolean {
        switch (this._scriptConsentMode) {
            case 'all':
                return true;
            case 'custom':
                return this._customGrants[namespace] ?? (!sensitive || defaultGranted.has(namespace));
            case 'all-but-sensitive':
            default:
                // Grant everything non-sensitive; an operator may still default-grant a
                // sensitive namespace via defaultGrantedNamespaces (trusted static meta).
                return !sensitive || defaultGranted.has(namespace);
        }
    }

    /** Switch the scripting-access posture and re-derive all grants from it. */
    setScriptConsentMode(mode: ScriptConsentMode): void {
        this._scriptConsentMode = this._normalizeConsentMode(mode);
        this._writeCachedConsent();
        this.refreshScriptConsentFromManager();
    }

    setScriptNamespaceConsent(namespace: string, granted: boolean): void {
        // An individual toggle is an explicit curation → switch to custom and remember the choice.
        this._scriptConsentMode = 'custom';
        this._customGrants[namespace] = granted;

        if (!this._scriptConsent[namespace]) {
            this._scriptConsent[namespace] = {
                title: $.t('chat.allowScriptingNamespaceTitle', { namespace }),
                granted,
            };
        } else {
            this._scriptConsent[namespace].granted = granted;
        }

        this._writeCachedConsent();
        this._syncScriptConsentToManager();
        // Grant-state change only: update checkboxes in place (preserves scroll).
        // syncScriptConsentState falls back to a full rebuild if membership changed.
        this.chatPanel?.syncScriptConsentState?.();
    }

    // ── Remembered consent (local, expiring) ────────────────────────────────
    // Persisted to this.cache (localStorage, owner-scoped) — never to the session bundle.

    _consentRememberEnabled(): boolean {
        return this.getStaticMeta?.('rememberConsent', true) !== false;
    }

    _consentTtlMs(): number {
        const days = Number(this.getStaticMeta?.('consentRememberDays', ChatModule.DEFAULT_CONSENT_REMEMBER_DAYS));
        const safeDays = Number.isFinite(days) && days > 0 ? days : ChatModule.DEFAULT_CONSENT_REMEMBER_DAYS;
        return safeDays * 24 * 60 * 60 * 1000;
    }

    /** Read + validate the remembered consent; prunes and returns null when missing/expired/disabled. */
    _readCachedConsent(): { mode: ScriptConsentMode; customGrants: Record<string, boolean>; expiresAt: number } | null {
        if (!this._consentRememberEnabled()) return null;
        try {
            const raw = this.cache?.get?.(ChatModule.CONSENT_CACHE_KEY);
            if (!raw || typeof raw !== 'string') return null;
            const parsed = JSON.parse(raw);
            const expiresAt = Number(parsed?.expiresAt);
            if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
                this.cache?.delete?.(ChatModule.CONSENT_CACHE_KEY);
                return null;
            }
            return {
                mode: this._normalizeConsentMode(parsed?.mode),
                customGrants: (parsed?.customGrants && typeof parsed.customGrants === 'object') ? parsed.customGrants : {},
                expiresAt,
            };
        } catch (_) {
            return null;
        }
    }

    /** Persist the current posture with a fresh expiry (no-op when remembering is disabled). */
    _writeCachedConsent(): void {
        if (!this._consentRememberEnabled()) return;
        try {
            const expiresAt = Date.now() + this._consentTtlMs();
            this.cache?.set?.(ChatModule.CONSENT_CACHE_KEY, JSON.stringify({
                mode: this._scriptConsentMode,
                customGrants: this._customGrants,
                expiresAt,
            }));
            this._consentExpiresAt = expiresAt;
        } catch (_) {
            // best-effort — a storage failure simply means the user is re-greeted next time
        }
    }

    /** Called when the user explicitly approves via the settings dialog → persist for next time. */
    markConsentApproved(): void {
        this._writeCachedConsent();
        // The user actively confirmed this session — it is no longer an *auto*-approval, so the
        // pill hides until the next load re-applies the remembered consent from cache.
        this._consentAutoApproved = false;
    }

    hasAutoApprovedConsent(): boolean {
        return this._consentAutoApproved;
    }

    getConsentExpiry(): number | null {
        return this._consentExpiresAt;
    }

    /** i18n key describing the currently-applied posture (for the pill tooltip). */
    getConsentModeLabelKey(): string {
        switch (this._scriptConsentMode) {
            case 'all': return 'chat.consentModeAll';
            case 'custom': return 'chat.consentModeCustom';
            default: return 'chat.consentModeAllButPatient';
        }
    }

    // ── Preferred / remembered provider ─────────────────────────────────────

    getRememberedProviderId(): string | null {
        try {
            const id = this.cache?.get?.(ChatModule.PROVIDER_CACHE_KEY);
            return (typeof id === 'string' && id) ? id : null;
        } catch (_) {
            return null;
        }
    }

    rememberProviderId(id: string | null | undefined): void {
        if (!id) return;
        try { this.cache?.set?.(ChatModule.PROVIDER_CACHE_KEY, String(id)); } catch (_) { /* best-effort */ }
    }

    /**
     * Resolve which provider to auto-select: the local user's last-used (if still present) →
     * operator default (static meta) → a server-tagged default provider → the first available.
     */
    getPreferredProviderId(available: Array<{ id: string; metadata?: any }>): string | null {
        const ids = new Set((available || []).map(p => p.id));

        const remembered = this.getRememberedProviderId();
        if (remembered && ids.has(remembered)) return remembered;

        const operatorDefault = this.getStaticMeta?.('defaultProviderId', null) as string | null;
        if (operatorDefault && ids.has(operatorDefault)) return operatorDefault;

        const tagged = (available || []).find(p => p?.metadata?.role === 'default-provider');
        if (tagged) return tagged.id;

        return available?.[0]?.id ?? null;
    }

    refreshScriptConsentFromManager(): void {
        const manager = APPLICATION_CONTEXT?.Scripting;

        if (!manager || typeof manager.getNamespaceConsentEntries !== 'function') {
            this._scriptConsent = {};
            this.chatPanel?.refreshScriptConsent?.();
            return;
        }

        const inherited = manager.getNamespaceConsentEntries() || {};
        const next: ScriptNamespaceConsentState = {};

        // Operator-trusted namespaces granted by default (ENV/include.json via
        // static meta — a session bundle cannot inject grants here).
        const defaultGranted = new Set<string>(
            (this.getStaticMeta?.('defaultGrantedNamespaces', []) as string[]) || []
        );

        for (const [namespace, entry] of Object.entries(inherited)) {
            const inheritedEntry = entry as { title: string; description?: string; granted?: boolean; sensitive?: boolean };
            const sensitive = !!inheritedEntry.sensitive;
            next[namespace] = {
                title: inheritedEntry.title,
                description: inheritedEntry.description,
                sensitive,
                granted: this._grantForMode(namespace, sensitive, defaultGranted),
            };
        }

        this._scriptConsent = next;
        manager.syncNamespaceConsent?.(this._scriptConsent);
        this.chatPanel?.refreshScriptConsent?.();
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

    _normalizeAnonMode(value: any): 'off' | 'handles' | 'full' {
        return (value === 'off' || value === 'handles' || value === 'full') ? value : 'full';
    }

    /** Reset alias maps when the active chat session changes — handles stay stable within a session. */
    _ensureViewerAliasSession(): void {
        const sid = this.chatService?.getActiveSessionId?.() ?? null;
        if (this._viewerAliasSessionId !== sid) {
            this._viewerAliasSessionId = sid;
            this._viewerAliasByReal.clear();
            this._viewerRealByHandle.clear();
            this._viewerHandleSeq = 0;
        }
    }

    /**
     * Get (assigning on first use) the stable opaque handle + friendly render label for a
     * real viewer uniqueId. Sequential (`viewer-1`, …) — opaque, deterministic, no PII.
     */
    _aliasForViewer(realId: string, label?: string | null): { handle: string; label: string } {
        let entry = this._viewerAliasByReal.get(realId);
        const friendly = (typeof label === 'string' && label) ? label : realId;
        if (!entry) {
            this._viewerHandleSeq += 1;
            const handle = `viewer-${this._viewerHandleSeq}`;
            entry = { handle, label: friendly };
            this._viewerAliasByReal.set(realId, entry);
            this._viewerRealByHandle.set(handle, realId);
        } else if (friendly !== realId) {
            // prefer a real operator name over the earlier id fallback
            entry.label = friendly;
        }
        return entry;
    }

    /** Best-effort friendly name (operator-set slide name) for a real viewer id; falls back to the id. */
    _labelForRealViewer(realId: string): string {
        try {
            const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];
            const v = viewers.find((vv: any) => String(vv?.uniqueId || '') === realId);
            const firstItem =
                v?.scalebar?.getReferencedTiledImage?.() ||
                (v?.world?.getItemCount?.() > 0 ? v.world.getItemAt(0) : null);
            const name = firstItem?.getConfig?.('background')?.name;
            return (typeof name === 'string' && name) ? name : realId;
        } catch (_) {
            return realId;
        }
    }

    /**
     * Install the viewer-identity aliasing resolver onto the chat scripting context so the
     * model only ever sees opaque handles for `application.setActiveViewer` / `getGlobalInfo`
     * (identity fields) and, in `full` mode, masked names too. No-op / cleared in `off` mode.
     */
    _installViewerAliasResolver(context: any): void {
        if (!context || typeof context.setViewerIdAlias !== 'function') return;
        if (this._viewerAnonMode === 'off') {
            context.setViewerIdAlias(null);
            return;
        }
        this._ensureViewerAliasSession();
        const full = this._viewerAnonMode === 'full';
        context.setViewerIdAlias({
            toInternal: (handle: string) => this._viewerRealByHandle.get(handle) ?? handle,
            toPresented: (realId: string) =>
                this._aliasForViewer(realId, this._labelForRealViewer(realId)).handle,
            presentName: (realId: string, name: string | null | undefined) => {
                if (!full) return name ?? null;
                const label = (typeof name === 'string' && name) ? name : this._labelForRealViewer(realId);
                return this._aliasForViewer(realId, label).handle;
            },
        });
    }

    /**
     * Restore friendly slide names in text shown to the LOCAL user: replace each session
     * handle token (`viewer-N`) with its friendly label. The user owns the data, so this is a
     * presentation-only reverse of the anonymization the LLM saw. Word-boundary matched so
     * `viewer-1` never corrupts `viewer-10`; replacement via a function so `$` in labels is literal.
     */
    presentTextForUser(text: string): string {
        if (!text || this._viewerAliasByReal.size === 0) return text;
        let out = text;
        for (const entry of this._viewerAliasByReal.values()) {
            if (!entry.handle || !entry.label || entry.label === entry.handle) continue;
            const re = new RegExp(`\\b${entry.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            out = out.replace(re, () => entry.label);
        }
        return out;
    }

    /**
     * Navigate a viewer to the slide region referenced by an in-chat region link
     * (`[label](#xopat-region?...)`). Coordinates are level-0 image pixels, parent-global
     * for virtual-region splits — the same space as annotation coordinates, pathology
     * `bounds`, and `viewer.frameImageRegion(...)` (whose fit/pad semantics this mirrors).
     * The model-facing viewer handle is resolved back to the real viewer uniqueId first.
     */
    navigateToRegionFromChat(link: ChatRegionLinkPayload): boolean {
        const viewer = this._resolveViewerForRegionLink(link?.viewer ?? null);
        const x = Number(link?.x);
        const y = Number(link?.y);
        if (!viewer || !Number.isFinite(x) || !Number.isFinite(y)) {
            this._notifyRegionLinkUnavailable();
            return false;
        }

        try {
            // Switch the focal plane first when the link pins one (z-stack slides only) —
            // same path as viewer.setZDepth; a no-op for single-plane slides.
            const z = Number(link?.z);
            if (Number.isFinite(z)) {
                viewer.__depthController?.setDepth?.(Math.round(z));
            }

            const item: any = viewer.scalebar?.getReferencedTiledImage?.()
                || (viewer.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null);
            if (!item) throw new Error('The viewer has no tiled image to navigate.');

            const OSD = (globalThis as any).OpenSeadragon;
            // Virtual-region crops expose the parent↔region mapping on their source —
            // link coordinates are parent-global, so map them into the crop first.
            const source = item.source;
            const cropped = source && typeof source.getParentId === 'function' && source.getParentId() ? source : null;
            const toViewport = (px: number, py: number) => {
                const local = cropped ? cropped.fromParentImageCoordinates({ x: px, y: py }) : { x: px, y: py };
                return item.imageToViewportCoordinates(new OSD.Point(local.x, local.y));
            };

            const w = Number.isFinite(Number(link?.w)) ? Math.max(0, Number(link.w)) : 0;
            const h = Number.isFinite(Number(link?.h)) ? Math.max(0, Number(link.h)) : 0;
            const tl = toViewport(x, y);
            const br = toViewport(x + w, y + h);

            const vw = Math.abs(br.x - tl.x);
            const vh = Math.abs(br.y - tl.y);
            if (vw > 0 && vh > 0) {
                const pad = 0.1;
                viewer.viewport.fitBounds(new OSD.Rect(
                    Math.min(tl.x, br.x) - vw * pad,
                    Math.min(tl.y, br.y) - vh * pad,
                    vw * (1 + 2 * pad),
                    vh * (1 + 2 * pad),
                ));
            } else {
                // Point of interest — centre on it without changing zoom.
                viewer.viewport.panTo(new OSD.Point(tl.x, tl.y));
            }
            viewer.viewport.applyConstraints();
            return true;
        } catch (error) {
            console.warn('Chat region link navigation failed:', error);
            this._notifyRegionLinkUnavailable();
            return false;
        }
    }

    /**
     * Resolve a region link's viewer reference — a per-session anonymization handle
     * (`viewer-N`) or, with anonymization off, a real uniqueId — to a live viewer.
     * Falls back to the active viewer, then to the only open viewer.
     */
    _resolveViewerForRegionLink(handleOrId: string | null): any | null {
        const viewers: any[] = (globalThis as any).VIEWER_MANAGER?.viewers || [];
        if (!viewers.length) return null;

        let realId = (typeof handleOrId === 'string' && handleOrId.trim()) ? handleOrId.trim() : null;
        if (realId && this._viewerRealByHandle.has(realId)) {
            realId = this._viewerRealByHandle.get(realId)!;
        }
        if (!realId) realId = this._resolveLiveViewerContextId();

        const viewer = realId ? viewers.find((v: any) => String(v?.uniqueId || '') === realId) : null;
        return viewer || (viewers.length === 1 ? viewers[0] : null);
    }

    _notifyRegionLinkUnavailable(): void {
        const Dialogs = (window as any).Dialogs;
        Dialogs?.show?.($.t('chat.regionLinkUnavailable'), 4000, Dialogs?.MSG_WARN);
    }

    /**
     * Compose a snapshot of the live viewer state for prompt injection. Called by
     * ChatService immediately before every sendTurn, so the model always sees the
     * current (not stale) state. Synchronous reads only — no tile waits, no
     * screenshots; every field degrades to null/[] rather than throwing.
     */
    composeLiveViewerContext(): LiveViewerContext {
        const manager = (globalThis as any).VIEWER_MANAGER;
        const viewers: any[] = manager?.viewers || [];

        // Arm the workspace-change watch on first use (VIEWER_MANAGER is up by now).
        this._installWorkspaceChangeWatch();

        // Anonymize slide identity before it reaches the upstream LLM (§7). `off` keeps real
        // values; `handles`/`full` swap ids (and, in `full`, names) for stable opaque handles.
        this._ensureViewerAliasSession();
        const anon = this._viewerAnonMode !== 'off';
        const full = this._viewerAnonMode === 'full';

        const realActiveId = this._resolveLiveViewerContextId();
        const activeViewerId = (anon && realActiveId)
            ? this._aliasForViewer(realActiveId, this._labelForRealViewer(realActiveId)).handle
            : realActiveId;

        const slides: LiveViewerContextSlide[] = viewers.map((viewer: any) => {
            const realContextId = String(viewer?.uniqueId || '');
            let imageName = '';
            let background: string | null = null;
            let zoom: number | null = null;
            let magnification: number | null = null;
            let zStack: LiveViewerContextZStack | null = null;

            try {
                const firstItem =
                    viewer?.scalebar?.getReferencedTiledImage?.() ||
                    (viewer?.world?.getItemCount?.() > 0 ? viewer.world.getItemAt(0) : null);
                const bgConfig = firstItem?.getConfig?.('background');

                // Only the explicit operator-set name — filenames/paths are identifying and are
                // never injected into the assistant context (reachable via the `patient` namespace).
                if (typeof bgConfig?.name === 'string' && bgConfig.name) {
                    imageName = bgConfig.name;
                }
                background = bgConfig?.id != null ? String(bgConfig.id) : (bgConfig?.name ?? null);

                const rawZoom = viewer?.viewport?.getZoom?.(true);
                zoom = Number.isFinite(rawZoom) ? Math.round(rawZoom * 100) / 100 : null;
                const rawMag = viewer?.scalebar?.magnification;
                magnification = Number.isFinite(rawMag) && rawMag > 0 ? rawMag : null;

                const range = viewer?.__depthController?.getRange?.();
                if (range && Number.isFinite(range.count) && range.count > 1) {
                    zStack = {
                        count: range.count,
                        index: Number.isFinite(range.index) ? range.index : 0,
                        spacingUm: Number.isFinite(range.spacingUm) ? range.spacingUm : null,
                        labels: Array.isArray(range.labels)
                            ? range.labels.slice(0, 64).map(String)
                            : null,
                    };
                }
            } catch (_) {
                // partial info is fine — never fail composing over one viewer
            }

            let presentedContextId = realContextId;
            let presentedBackground = background;
            let presentedImageName = imageName || realContextId;
            if (anon && realContextId) {
                const entry = this._aliasForViewer(realContextId, imageName || realContextId);
                presentedContextId = entry.handle;
                presentedBackground = entry.handle;
                presentedImageName = full ? entry.handle : (imageName || entry.handle);
            }

            return {
                contextId: presentedContextId,
                imageName: presentedImageName,
                isActive: !!presentedContextId && presentedContextId === activeViewerId,
                background: presentedBackground,
                zoom,
                magnification,
                zStack,
                pathologyOverview: this._overviewMarkerFor(viewer),
            };
        });

        const loadedNamespaces: LiveViewerContextNamespace[] = Object.entries(this._scriptConsent)
            .map(([name, entry]) => ({ name, granted: !!entry?.granted }));

        let pathologyDrivers: LiveViewerContextDriver[] | undefined;
        try {
            const pathology = (globalThis as any).singletonModule?.('pathology-foundation');
            const drivers = pathology?.listDrivers?.();
            if (Array.isArray(drivers)) {
                pathologyDrivers = drivers.map((d: any) => ({
                    id: String(d?.id || ''),
                    label: String(d?.label || d?.id || ''),
                    local: !!d?.local,
                    features: Array.isArray(d?.features) ? d.features.map(String) : [],
                }));
            }
        } catch (_) {
            // pathology-foundation not loaded — omit the section
        }

        // The model is about to be shown this exact open-slide set — make it the baseline so only
        // LATER opens/closes/swaps count as "changed since the previous message".
        this._markWorkspaceBaselineForSession();

        return {
            composedAt: new Date().toISOString(),
            activeViewerId,
            viewerCount: slides.length,
            viewers: slides,
            loadedNamespaces,
            pathologyDrivers,
        };
    }

    /**
     * Compact marker that a cached pathology overview exists for `viewer`'s slide, so the
     * model knows it can answer broad "regions with X" queries from pathology.getOverview()
     * instead of re-sweeping. Returns null when the module is absent or nothing is cached.
     * Only the tiny summary crosses the wire — the full tree is fetched on demand. Never
     * throws (partial live context is always fine).
     */
    _overviewMarkerFor(viewer: any): LiveViewerContextOverview | null {
        try {
            const pathology = (globalThis as any).singletonModule?.('pathology-foundation');
            const overview = pathology?.getOverview?.(viewer);
            if (!overview || !Array.isArray(overview.root)) return null;

            let regionsDescribed = 0;
            let depth = 0;
            let topGist: string | null = null;
            let topInterest = -1;
            const walk = (n: any) => {
                if (!n) return;
                if (typeof n.depth === 'number' && n.depth > depth) depth = n.depth;
                if (n.findings) {
                    regionsDescribed++;
                    const interest = typeof n.interest === 'number' ? n.interest : 0;
                    if (interest > topInterest) {
                        topInterest = interest;
                        topGist = String(n.findings).split(/(?<=[.!?])\s/)[0].slice(0, 160);
                    }
                }
                (Array.isArray(n.children) ? n.children : []).forEach(walk);
            };
            overview.root.forEach(walk);

            return {
                regionsDescribed,
                depth,
                slideCoverage: typeof overview.slideCoverage === 'number' ? overview.slideCoverage : 0,
                isComplete: !!overview.isComplete,
                truncated: !!overview.budget?.truncated,
                builtAtIso: String(overview.builtAtIso || ''),
                query: overview.query ?? null,
                gist: topGist,
            };
        } catch (_) {
            return null;
        }
    }

    _resolveLiveViewerContextId(): string | null {
        const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];

        const activeViewerId = (globalThis as any).VIEWER_MANAGER?.activeViewer?.uniqueId;
        if (typeof activeViewerId === 'string' && activeViewerId.trim()) {
            return activeViewerId.trim();
        }

        if (viewers.length === 1 && typeof viewers[0]?.uniqueId === 'string' && viewers[0].uniqueId.trim()) {
            return viewers[0].uniqueId.trim();
        }

        return null;
    }

    getActiveChatContextId(): string | null {
        return this._resolveLiveViewerContextId();
    }

    _getScriptExecutionContext(): any | null {
        const manager = APPLICATION_CONTEXT?.Scripting;
        if (!manager || typeof manager.getContext !== 'function') {
            return null;
        }

        const activeSessionId = this.chatService?.getActiveSessionId?.() || null;
        const viewerContextId = this.getActiveChatContextId();
        const contextId = viewerContextId || manager.defaultContextId || 'default';
        const context = manager.getContext(contextId);

        if (viewerContextId && typeof context?.setActiveViewerContextId === 'function') {
            // Stored value stays the REAL id — only the model-facing surface is aliased.
            context.setActiveViewerContextId(viewerContextId);
        }

        // Install the identity-aliasing resolver so the model only round-trips opaque handles.
        this._installViewerAliasResolver(context);

        context?.setLabel?.(`Chat: ${contextId}`);
        context?.patchMetadata?.({
            source: 'chat',
            providerId: this.chatPanel?._providerId || null,
            sessionId: activeSessionId,
            viewerContextId,
            providerRuntimeContextId: this.chatService?.getSessionProviderContextId?.(activeSessionId) || null,
        });

        return context;
    }

    async executeAssistantScript(script: string, options: { signal?: AbortSignal } = {}): Promise<ChatMessage> {
        const context = this._getScriptExecutionContext();
        chatDebugLog("SCRIPT_EXECUTION_REQUEST", {
            contextId: context?.id || null,
            activeViewerContextId: typeof context?.getActiveViewerContextId === "function"
                ? context.getActiveViewerContextId()
                : null,
            script,
        });

        if (!context || typeof context.executeScript !== 'function') {
            return {
                role: 'user',
                parts: [{ ok: false, type: 'script-result', text: 'The requested action could not be completed because scripting is not available.' }],
                content: 'The requested action could not be completed because scripting is not available.',
                createdAt: new Date(),
            };
        }

        const workerId = typeof context?.createWorker === 'function'
            ? `${context.id || 'default'}-chat-script-${Date.now()}-${Math.random().toString(36).slice(2)}`
            : undefined;

        const signal = options?.signal;
        const abortError = () => {
            try {
                if (workerId && typeof context?.abortScript === 'function') {
                    context.abortScript(workerId);
                }
            } catch (_) {
                // ignore abort cleanup failures
            }
            return new DOMException('Stopped by user.', 'AbortError');
        };

        try {
            if (signal?.aborted) {
                throw abortError();
            }

            const executionPromise = context.executeScript(
                script,
                workerId ? { workerId } : {}
            );

            const result = signal
                ? await new Promise((resolve, reject) => {
                    const onAbort = () => reject(abortError());
                    signal.addEventListener('abort', onAbort, { once: true });

                    executionPromise.then(resolve, reject).finally(() => {
                        signal.removeEventListener('abort', onAbort);
                    });
                })
                : await executionPromise;

            chatDebugLog("SCRIPT_EXECUTION_RESULT", {
                contextId: context?.id || null,
                result,
            });
            const normalized = await this._normalizeScriptResultToMessage(result);
            chatDebugLog("SCRIPT_EXECUTION_MESSAGE", normalized);
            return normalized;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            chatDebugLog("SCRIPT_EXECUTION_ERROR", {
                contextId: context?.id || null,
                error,
            });
            return {
                role: 'user',
                parts: [{ ok: false, type: 'script-result', text: `The requested action could not be completed: ${message}`, script } as any],
                content: `The requested action could not be completed: ${message}`,
                createdAt: new Date(),
                metadata: {
                    scriptError: this._extractScriptExecutionErrorDetails(error),
                } as any,
            };
        }
    }

    _extractScriptExecutionErrorDetails(error: any): Record<string, unknown> | null {
        const visited = new Set<any>();
        let current = error;

        while (current && typeof current === "object" && !visited.has(current)) {
            visited.add(current);

            if (current.couplingViolation || Array.isArray(current.ajvErrors)) {
                const details: Record<string, unknown> = {
                    name: current.name || "Error",
                    message: current.message || String(current),
                };

                if (current.couplingViolation && typeof current.couplingViolation === "object") {
                    details.couplingViolation = {
                        coupling: current.couplingViolation.coupling,
                        layerType: current.couplingViolation.layerType,
                        layerPath: current.couplingViolation.layerPath,
                        controls: current.couplingViolation.controls,
                        expected: current.couplingViolation.expected,
                        actual: current.couplingViolation.actual,
                    };
                }

                if (Array.isArray(current.ajvErrors) && current.ajvErrors.length) {
                    details.ajvErrors = current.ajvErrors.slice(0, 5).map((entry: any) => ({
                        instancePath: entry?.instancePath,
                        message: entry?.message,
                        params: entry?.params,
                    }));
                }

                return details;
            }

            current = current.cause;
        }

        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
            };
        }

        if (typeof error === "string" && error.trim()) {
            return { message: error.trim() };
        }

        return null;
    }

    extractScriptFromAssistantMessage(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");

        const exact = content.match(/```xopat-script\s*([\s\S]*?)```/i);
        if (exact?.[1]?.trim()) return exact[1].trim();

        const fallback = content.match(/```(?:javascript|js|typescript|ts)\s*([\s\S]*?)```/i);
        if (fallback?.[1]?.trim()) return fallback[1].trim();

        const pseudoToolCall = this._extractScriptFromToolEnvelope(content);
        if (pseudoToolCall) return pseudoToolCall;

        return undefined;
    }

    extractAssistantTextWithoutScript(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");
        if (!content.trim()) return undefined;

        const stripped = content
            .replace(/```xopat-script\s*[\s\S]*?```/gi, "")
            .replace(/```(?:javascript|js|typescript|ts)\s*[\s\S]*?```/gi, "")
            .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi, "")
            .replace(/functions\.xopat-(?:host-)?script\s*:\s*\d+/gi, "")
            .trim();

        return stripped || undefined;
    }

    _extractScriptFromToolEnvelope(content: string): string | undefined {
        const normalized = String(content || "");
        if (!normalized) return undefined;

        const jsonArgMatches = Array.from(
            normalized.matchAll(
                /functions\.(xopat-(?:host-)?script)\s*:\s*\d+\s*<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*<\|tool_call_end\|>/gi
            )
        );

        for (const match of jsonArgMatches) {
            const toolName = String(match[1] || "").toLowerCase();
            const payloadText = String(match[2] || "").trim();
            const code = this._readCodeFromToolPayload(payloadText);
            if (!code) continue;

            if (toolName === "xopat-host-script") return code;
            return code;
        }

        const looseJsonMatches = Array.from(
            normalized.matchAll(/<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*(?:<\|tool_call_end\|>|$)/gi)
        );
        for (const match of looseJsonMatches) {
            const code = this._readCodeFromToolPayload(String(match[1] || "").trim());
            if (code) return code;
        }

        return undefined;
    }

    _readCodeFromToolPayload(payloadText: string): string | undefined {
        if (!payloadText) return undefined;

        try {
            const parsed = JSON.parse(payloadText);
            if (typeof parsed?.code === "string" && parsed.code.trim()) {
                return parsed.code.trim();
            }
        } catch (_) {
            const codeMatch = payloadText.match(/"code"\s*:\s*"([\s\S]*?)"\s*(?:,|})/i);
            if (!codeMatch?.[1]) return undefined;

            try {
                return JSON.parse(`"${codeMatch[1]}"`).trim();
            } catch {
                return codeMatch[1]
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\t/g, "\t")
                    .trim();
            }
        }

        return undefined;
    }

    _getChatConfig(): {
        personalities: ChatPersonality[];
        defaultPersonalityId: string;
        maxScriptSteps: number;
        maxScriptStepExtensions: number;
        scriptStepExtensionSize: number;
        minSuccessfulProgressStepsBeforeExtension: number;
    } {
        const personalities: ChatPersonality[] = this.getStaticMeta('personalities', []);

        if (!personalities.length) {
            personalities.push({
                id: 'default',
                label: $.t('chat.defaultPersonalityLabel'),
                systemPrompt:`
Be helpful and accurate. When the allowed scripting API can do the work, prefer using it silently instead of describing technical steps.
Do not use scripting for greetings, thanks, or simple acknowledgements that do not require viewer inspection or action.
Do not assume any previous script succeeded unless its result is explicitly present in the conversation.
If the user asks who created, authored, or owns annotations, comments, or other viewer items, only answer if the available information identifies the current user. Otherwise state the limitation briefly instead of inferring.
Do not talk about scripts, code blocks, namespaces, or execution unless the user explicitly asks for technical details.
For non-technical users, keep language plain and outcome-focused.
When scripting is not available or insufficient, explain the limitation clearly.`
            });
        }

        const defaultPersonalityId = this.getStaticMeta('defaultPersonalityId') || personalities[0]?.id || 'default';
        const maxScriptSteps = this.getStaticMeta('maxScriptSteps', 12);
        const maxScriptStepExtensions = this.getStaticMeta('maxScriptStepExtensions', 3);
        const scriptStepExtensionSize = this.getStaticMeta('scriptStepExtensionSize', 4);
        const minSuccessfulProgressStepsBeforeExtension = this.getStaticMeta('minSuccessfulProgressStepsBeforeExtension', 4);

        return {
            personalities,
            defaultPersonalityId,
            maxScriptSteps,
            maxScriptStepExtensions,
            scriptStepExtensionSize,
            minSuccessfulProgressStepsBeforeExtension,
        };
    }

    _attachToLayout(): void {
        if (this._layoutAttached) return;
        (window as any).LAYOUT.addTab({
            id: 'chat',
            title: $.t('chat.tabTitle'),
            icon: 'fa-comments',
            body: [this.chatPanel],
        });
        this._layoutAttached = true;
    }

    /**
     * BYOK key management belongs to the plugin/module settings surface
     * (fullscreen Plugins menu), not to the chat consent dialog — same
     * placement as the annotations settings.
     */
    _attachSettingsMenu(): void {
        if (this._settingsMenuAttached) return;
        const ui = (globalThis as any).USER_INTERFACE;
        if (!ui?.AppBar?.Plugins?.setMenu) return;

        this._providerKeysPanel = new ProviderKeysPanel({
            id: 'chat-provider-keys-panel',
            chatService: this.chatService,
            onKeysChanged: async (providerId: string) => {
                // Re-derive the chat's ready state (models + input enablement)
                // for the affected provider — no consent re-submission needed.
                await this.chatPanel?.onProviderKeysChanged?.(providerId);
            },
        });

        const container = document.createElement('div');
        // `chrome: "plain"` — the panel renders its own fs.card.
        ui.AppBar.Plugins.setMenu(
            'vercel-ai-chat-sdk',
            'provider-keys',
            $.t('chat.providerKeysLegend'),
            container,
            'ph-key',
            { chrome: 'plain' }
        );
        container.appendChild(this._providerKeysPanel.create());
        this._settingsMenuAttached = true;
    }

    async _normalizeScriptResultToMessage(result: any): Promise<ChatMessage> {
        const UTILITIES = (globalThis as any).UTILITIES || {};
        const MAX_RESULT_TEXT_CHARS = 8_000;
        const isImageLike = typeof UTILITIES.isImageLike === 'function'
            ? UTILITIES.isImageLike.bind(UTILITIES)
            : () => false;
        const imageLikeToDataUrl = typeof UTILITIES.imageLikeToDataUrl === 'function'
            ? UTILITIES.imageLikeToDataUrl.bind(UTILITIES)
            : null;

        const parseDataUrl = (value: unknown): { mediaType?: string; base64: string; raw: string } | null => {
            if (typeof value !== 'string') return null;
            const raw = value.trim();
            const match = raw.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
            if (!match) return null;
            const base64 = String(match[2] || '').replace(/\s+/g, '');
            if (!base64 || base64.length < 64) return null;
            if (base64.length % 4 === 1) return null;

            try {
                if (typeof atob === 'function') {
                    atob(base64);
                }
            } catch {
                return null;
            }

            return {
                mediaType: match[1] || undefined,
                base64,
                raw,
            };
        };

        const isDataUrl = (value: unknown): value is string =>
            !!parseDataUrl(value);

        const isImageDataUrl = (value: unknown): value is string =>
            !!parseDataUrl(value)?.mediaType?.match(/^image\//i);

        const inferMimeType = (value: string, fallback = 'application/octet-stream') => {
            const match = value.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,/i);
            return match?.[1] || fallback;
        };
        const truncateText = (value: string, label = 'text') => {
            if (value.length <= MAX_RESULT_TEXT_CHARS) return value;
            return `${value.slice(0, MAX_RESULT_TEXT_CHARS)}\n\n[${label} truncated to ${MAX_RESULT_TEXT_CHARS} characters by vercel-ai-chat-sdk]`;
        };

        const withInternalMetadata = (message: ChatMessage): ChatMessage => ({
            ...message,
            metadata: {
                ...(message.metadata || {}),
                hiddenFromChatUi: true,
                internalSource: 'script-runtime',
            },
        });

        const asFeedbackMessage = (text: string, ok = true): ChatMessage => withInternalMetadata({
            role: 'tool',
            parts: [{ ok, type: 'script-result', text } as any],
            content: text,
            createdAt: new Date(),
        });

        const asGuidanceForMissingReturn = (): ChatMessage => asFeedbackMessage(
            'Script execution finished without a returned value. The runtime only feeds back the explicit return value. Correct the previous script by returning the final string, object, array, or attachment-producing value.',
            false
        );
        const attachmentParts: ChatMessagePart[] = [];
        const uploadEmbeddedDataUrl = async (dataUrl: string, path: string) => {
            const isImage = isImageDataUrl(dataUrl);
            const uploaded = await this._storeScriptAttachment({
                kind: isImage ? 'image' : 'file',
                dataUrl,
                mimeType: inferMimeType(dataUrl, isImage ? 'image/png' : 'application/octet-stream'),
                name: isImage ? `${path || 'script-image'}.png` : `${path || 'script-file'}`,
                metadata: { sourcePath: path || 'result' },
            });

            attachmentParts.push((isImage ? {
                type: 'image',
                attachmentId: uploaded.id,
                mimeType: uploaded.mimeType,
                name: uploaded.name,
                dataUrl: uploaded.dataUrl,
                metadata: uploaded.metadata,
            } : {
                type: 'file',
                attachmentId: uploaded.id,
                mimeType: uploaded.mimeType,
                name: uploaded.name || path || 'script-file',
                dataUrl: uploaded.dataUrl,
                metadata: uploaded.metadata,
            }) as any);

            return isImage
                ? `[Image attachment stored at ${path || 'result'}: ${uploaded.name || 'image'}]`
                : `[File attachment stored at ${path || 'result'}: ${uploaded.name || 'file'}]`;
        };
        const sanitizeStructuredValue = async (value: any, path = 'result', depth = 0): Promise<any> => {
            if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;

            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (isDataUrl(trimmed)) {
                    return await uploadEmbeddedDataUrl(trimmed, path);
                }
                return truncateText(value, path);
            }

            if (isImageLike(value) && imageLikeToDataUrl) {
                const dataUrl = await imageLikeToDataUrl(value);
                return await uploadEmbeddedDataUrl(dataUrl, path);
            }

            if (depth >= 19) {
                return '[Object truncated: maximum serialization depth reached]';
            }

            if (Array.isArray(value)) {
                const items = [];
                const capped = value.slice(0, 50);
                for (let index = 0; index < capped.length; index++) {
                    items.push(await sanitizeStructuredValue(capped[index], `${path}[${index}]`, depth + 1));
                }
                if (value.length > capped.length) {
                    items.push(`[Array truncated: ${value.length - capped.length} more item(s)]`);
                }
                return items;
            }

            if (typeof value === 'object') {
                const entries = Object.entries(value);
                const capped = entries.slice(0, 50);
                const output: Record<string, unknown> = {};
                for (const [key, item] of capped) {
                    output[key] = await sanitizeStructuredValue(item, `${path}.${key}`, depth + 1);
                }
                if (entries.length > capped.length) {
                    output.__truncated__ = `${entries.length - capped.length} more key(s) omitted`;
                }
                return output;
            }

            return truncateText(String(value), path);
        };

        const asImageMessage = async (dataUrl: string, name = 'script-image.png'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'image',
                dataUrl,
                mimeType: inferMimeType(dataUrl, 'image/png'),
                name,
            });

            return withInternalMetadata({
                role: 'tool',
                parts: [{
                    type: 'image',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }, {
                    type: 'host-feedback',
                    text: `Script produced an image attachment${uploaded.name ? `: ${uploaded.name}` : ''}. Read the attachment and any other returned fields to answer the user.`,
                } as any],
                content: uploaded.name ? `[Image: ${uploaded.name}]` : '[Image]',
                createdAt: new Date(),
            });
        };

        const asFileMessage = async (dataUrl: string, name = 'script-file'): Promise<ChatMessage> => {
            const uploaded = await this._storeScriptAttachment({
                kind: 'file',
                dataUrl,
                mimeType: inferMimeType(dataUrl),
                name,
            });

            return withInternalMetadata({
                role: 'tool',
                parts: [{
                    type: 'file',
                    attachmentId: uploaded.id,
                    mimeType: uploaded.mimeType,
                    name: uploaded.name || name,
                    dataUrl: uploaded.dataUrl,
                    metadata: uploaded.metadata,
                }, {
                    type: 'host-feedback',
                    text: `Script produced a file attachment${uploaded.name ? `: ${uploaded.name}` : ''}. Read the attachment and any other returned fields to answer the user.`,
                } as any],
                content: uploaded.name ? `[File: ${uploaded.name}]` : '[File]',
                createdAt: new Date(),
            });
        };

        if (result == null) {
            return asGuidanceForMissingReturn();
        }

        if (typeof result === 'string') {
            const value = result.trim();

            if (!value) {
                return asGuidanceForMissingReturn();
            }

            if (isImageDataUrl(value)) {
                return await asImageMessage(value, 'script-image.png');
            }

            if (isImageLike(value) && imageLikeToDataUrl) {
                const dataUrl = await imageLikeToDataUrl(value);
                return await asImageMessage(dataUrl);
            }

            if (isDataUrl(value)) {
                return await asFileMessage(value);
            }

            return asFeedbackMessage(truncateText(value || ''));
        }

        if (isImageLike(result) && imageLikeToDataUrl) {
            const dataUrl = await imageLikeToDataUrl(result);
            return await asImageMessage(dataUrl);
        }
        const sanitized = await sanitizeStructuredValue(result);
        const text = typeof sanitized === 'string'
            ? sanitized
            : truncateText(JSON.stringify(sanitized, null, 2), 'script-result');
        const parts: ChatMessagePart[] = [];

        if (text.trim()) {
            parts.push({
                ok: true,
                type: 'script-result',
                text,
            } as any);
        }

        if (attachmentParts.length) {
            parts.push(...attachmentParts);
            parts.push({
                type: 'host-feedback',
                text: 'Script produced attachment output. Read the attachment placeholders and any related metadata to answer the user.',
            } as any);
        }

        if (!parts.length) {
            return asGuidanceForMissingReturn();
        }

        return withInternalMetadata({
            role: 'tool',
            parts,
            content: text || 'Script produced non-text output.',
            createdAt: new Date(),
        });
    }

    async _storeScriptAttachment(input: {
        kind: 'image' | 'file' | 'screenshot';
        dataUrl: string;
        mimeType: string;
        name?: string;
        metadata?: Record<string, unknown>;
    }): Promise<ChatAttachmentRecord> {
        const sessionId = this.chatService._activeSessionId;
        if (!sessionId) {
            throw new Error('No active session for script attachment.');
        }

        return await this.chatService.uploadAttachment({
            sessionId,
            kind: input.kind,
            name: input.name,
            mimeType: input.mimeType,
            dataBase64: input.dataUrl,
            metadata: input.metadata,
        });
    }

    registerPersonality(personality: ChatPersonality): void {
        this.chatService.registerPersonality(personality);
        this.chatPanel?.refreshPersonalities?.();
    }

    setPersonality(personalityId: string): void {
        this.chatService.setPersonality(personalityId);
        this.chatPanel?.refreshPersonalities?.();
    }

    async registerProviderType(definition: CreateProviderTypeInput): Promise<ChatProviderTypeRecord> {
        const record = await this.chatService.registerProviderType(definition);
        await this.chatService.refreshProviderTypesFromServer();
        return record;
    }

    async createProvider(config: CreateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this.chatService.createProvider(config);
        this.chatPanel?.refreshProviders?.();
        return provider;
    }

    async updateProvider(config: UpdateProviderInstanceInput): Promise<ChatProviderClientRegistration> {
        const provider = await this.chatService.updateProvider(config);
        this.chatPanel?.refreshProviders?.();
        return provider;
    }

    async refreshProviders(): Promise<void> {
        await this.chatService.refreshProvidersFromServer();
        this.chatPanel?.refreshProviders?.();
    }
}

export { ChatModule, ChatPanel, ChatService };
window.addModule('vercel-ai-chat-sdk', ChatModule);
