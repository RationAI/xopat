import { ChatPanel } from './ui/ChatPanel';
import { ProviderKeysPanel } from './ui/ProviderKeysPanel';
import {ChatService} from './chatService';
import { extractToolEnvelopeScripts, readCodeFromToolPayload } from './shared/tool-envelope';
import {
    bracketCensus, describeCensusDamage, findScriptFence, formatCensus,
} from './shared/script-text';
import { matchProviderRef } from './shared/providerRef';

/** Where a script came from and what shape it was in when it arrived. */
export type ScriptCandidate = {
    script: string;
    /** False when the fence was never closed — the model was cut off mid-code. */
    terminated: boolean;
    /** False when the text does not hold together structurally (see `bracketCensus`). */
    balanced: boolean;
    source: 'xopat-fence' | 'code-fence' | 'tool-envelope';
};

let enabled: boolean | undefined = undefined;
function isChatDebugModeEnabled(): boolean {
    if (enabled === undefined) {
        enabled = APPLICATION_CONTEXT.getOption("debugMode");
    }
    return !!enabled;
}

function truncateChatDebugText(value: string, maxChars = 8_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

/** Options of {@link ChatModule.registerManagedProvider}. */
type ManagedProviderRegistrationOpts<T = any> = {
    /** Human provider name, for busy/status/log lines and the failure notice. */
    label?: string;
    /** Fires on EVERY successful registration (initial or panel Retry) — see registerManagedProvider docs. */
    onRegistered?: (result: T) => void;
    /**
     * Owning plugin id. Indexes the minted instance id under its stable references (plugin id,
     * type id, managed key) so static config can name this provider — including a HIDDEN one,
     * which never reaches `chatService._providers` because `listProviders` filters it out.
     */
    pluginId?: string;
};

// Wire bounds for the live viewer snapshot, mirroring LIVE_VIEWER_CONTEXT_MAX_* in
// server/chat.server.ts. The two bundles cannot share a constant, so both sides carry
// them: the server clamps whatever arrives, and this keeps the composed snapshot valid
// in the first place. Raise them together or not at all.
const LIVE_CTX_MAX_STRING = 160;
const LIVE_CTX_MAX_ISO = 64;
const LIVE_CTX_MAX_QUERY = 512;

/** Clamp one string headed for the live viewer snapshot; empty and absent both mean null. */
function clampLiveContextString(value: unknown, maxLen = LIVE_CTX_MAX_STRING): string | null {
    if (value == null) return null;
    const text = String(value);
    return text ? text.slice(0, maxLen) : null;
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
    _catalogPromise: Promise<void> | null = null;
    /**
     * True when a catalog bootstrap ran and FAILED. Both "never fetched" and "failed"
     * leave `_catalogPromise` null, but they need opposite handling on a later provider
     * registration: never-fetched self-heals through the lazy `ensureCatalog`, while a
     * failed one leaves an already-visible panel showing an empty provider list that
     * nothing re-fetches. See `refreshProviders`.
     */
    _catalogBootstrapFailed = false;
    _catalogVisibilityUnsub?: (() => void) | null;
    /** In-flight managed provider registrations (see registerManagedProvider). */
    _managedRegistrations: Set<Promise<unknown>> = new Set();
    /** Registrations that exhausted their retries, kept (with the register thunk) for the panel's Retry action. */
    _failedRegistrations: Map<string, { register: () => Promise<any>; opts: ManagedProviderRegistrationOpts; reason: string }> = new Map();
    /**
     * Provider reference → resolved instance id. Fed by managed registrations (whose RPC result
     * carries the freshly minted id) and memoized server lookups. This is the only client-side
     * route to a hidden provider's id — `chatService._providers` never contains one.
     */
    _providerRefIndex: Map<string, string> = new Map();
    /** In-flight `resolveProviderRef` RPCs, so N consumers of one ref make one call. */
    _providerRefLookups: Map<string, Promise<string | null>> = new Map();
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
    /**
     * Memoized live viewer-context snapshot. `composeLiveViewerContext` runs once per
     * MODEL STEP (up to ~12 per user turn) and walks every viewer plus the whole cached
     * pathology-overview tree each time; the state it reads only actually changes when
     * (a) the workspace changes (watched below), (b) an assistant script executed
     * (scripts mutate viewer state), or (c) a new user turn starts (the user may have
     * panned/zoomed manually) — each of those calls invalidateLiveViewerContext().
     * A stable snapshot also keeps the rendered prompt block byte-identical across
     * loop steps, which is what lets provider prompt caches hit.
     */
    _liveContextCache: { sessionId: string | null; value: LiveViewerContext } | null = null;

    /**
     * Session-scoped, monotonic set of namespaces whose full signatures the model has
     * seen (referenced by an executed script, explicitly described, or intent-hinted
     * from the user message). Rides every turn request; the server renders these
     * namespaces in full inside a stable system block, so the model never needs a
     * describeScriptingApi round-trip for them again. Grows only — shrinking would
     * churn the prompt prefix and re-hide docs the model already relied on.
     */
    _expandedNamespaces: Set<string> = new Set();
    _expandedNamespacesSessionId: string | null | undefined = undefined;

    /**
     * The reused chat script worker (one hardened realm per chat session; perf only —
     * the model is never promised cross-step realm state). Recycled whenever the
     * scripting manifest generation changes: a reused worker's frozen namespace stubs
     * can gain new namespaces but never new methods on an existing namespace.
     */
    _reusedScriptWorker: { workerId: string; contextId: string; generation: number | null } | null = null;

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
            getExpandedNamespaces: () => this.getSessionExpandedNamespaces(),
            // Deployment knob (H flag): which namespaces render in FULL every turn.
            // Default (unset) keeps the server's core set incl. visualization; flip
            // to ['application','viewer'] after eval to shrink the steady-state prompt.
            fullPromptNamespaces: this.getStaticMeta?.('fullPromptNamespaces', null) || undefined,
            onUserTurnText: (text: string) => this.applyIntentExpansionHints(text),
            onSessionHydrated: (session: any) => {
                const stored = session?.metadata?.expandedNamespaces;
                if (Array.isArray(stored)) this.seedExpandedNamespaces(stored);
            },
            awaitReadyForSend: async () => {
                // Any send implies chat use: wait out in-flight managed provider
                // registrations and make sure the lazily-fetched provider catalog
                // exists before the turn runs.
                await this._awaitChatUsable();
                await this.whenScriptBaselineSettled();
            },
            personalities: cfg.personalities,
            defaultPersonalityId: cfg.defaultPersonalityId,
            serverFactory: () => this.server(),
            sessionOwnerKey: 'vercel-ai-chat-sdk',
            legacySessionSource: 'vercel-ai-chat-sdk',
            // Deployment knob (static meta = ENV/include.json — a session bundle
            // cannot flip it): 'off' disables token streaming, buffered turns only.
            streamingEnabled: this.getStaticMeta?.('streamingMode', 'on') !== 'off',
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
    }

    /**
     * Lazily bootstrap the provider catalog (types + providers + models) and,
     * through the panel's provider auto-selection, the session hydration chain.
     * Nothing at boot needs any of it — the fetch fires on first actual chat
     * use (panel becoming visible, or a headless/send entry point). Idempotent;
     * a failed bootstrap clears the memo so the next trigger retries.
     */
    ensureCatalog(): Promise<void> {
        if (!this._catalogPromise) {
            this._catalogPromise = this._bootstrapProviderCatalog().then(() => {
                this._catalogBootstrapFailed = false;
            }, (error) => {
                this._catalogPromise = null;
                this._catalogBootstrapFailed = true;
                console.warn('Chat provider bootstrap failed:', error);
            });
        }
        return this._catalogPromise;
    }

    /**
     * Chat-use gate shared by sends and the headless entry points: wait out any
     * in-flight managed provider registrations (bounded — each is a short retry
     * loop that never rejects), THEN ensure the catalog, so a chat use racing a
     * boot-time registration sees the provider instead of "provider not found".
     */
    async _awaitChatUsable(): Promise<void> {
        await this.whenManagedRegistrationsSettled();
        await this.ensureCatalog();
    }

    /**
     * The scripting-capability baseline is "settled" once all boot-time plugins had
     * their chance to register namespaces (viewers opened = plugin loading + late-path
     * registrations done). Until then, namespace registrations are baseline — no
     * "new capability" notices or consent prompts — and sends are held back so the
     * first turn's manifest is complete.
     */
    _armScriptBaselineGate(): void {
        // The scripting bootstrap runs in the background (boot does not await
        // it), so "boot reached X" alone does not mean namespaces are ingested.
        // Wait for the (idempotent) initialize() before settling, otherwise
        // boot-time namespaces would surface as post-baseline "new capability"
        // notices/prompts.
        const settleAfterScriptingReady = () => {
            const scripting = (globalThis as any).APPLICATION_CONTEXT?.Scripting;
            Promise.resolve(scripting?.initialize?.())
                .catch(() => { /* failed bootstrap must not block the baseline */ })
                .then(() => this._settleScriptBaseline());
        };

        if ((globalThis as any).APPLICATION_CONTEXT?.isUiBootComplete?.()) {
            // Module loaded dynamically after boot — everything registered is baseline.
            settleAfterScriptingReady();
            return;
        }

        const manager = (globalThis as any).VIEWER_MANAGER;
        if (typeof manager?.addHandler === 'function') {
            const onOpen = () => {
                manager.removeHandler?.('after-open', onOpen);
                settleAfterScriptingReady();
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

    /**
     * Synchronous probe of the same gate. A send blocks on the baseline *inside* the first model
     * call, so without this the UI can only call that wait "thinking" — which is a lie for what is
     * really the host still registering scripting namespaces.
     */
    isScriptBaselineSettled(): boolean {
        return this._scriptBaselineSettled;
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

    /** Human-readable title of a registered scripting namespace, as declared by its API schema. */
    namespaceTitle(namespace: string): string {
        return this._scriptConsent[namespace]?.title || namespace;
    }

    _namespaceTitle(namespace: string): string {
        return this.namespaceTitle(namespace);
    }

    /**
     * Registered scripting namespaces referenced by a script body, in order of first appearance.
     * Textual scan only (the script is never parsed or evaluated here) — it exists so the UI can
     * tell the user what the assistant is about to do without knowing any namespace up front.
     */
    getScriptNamespaces(script: string): string[] {
        const found: string[] = [];
        const callRe = /\b([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g;
        let match: RegExpExecArray | null;
        while ((match = callRe.exec(String(script || "")))) {
            const namespace = match[1]!;
            if (this._scriptConsent[namespace] && !found.includes(namespace)) found.push(namespace);
        }
        return found;
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
                `A new capability "${this._namespaceTitle(ns)}" (namespace \`${ns}\`) is now available to you. ` +
                `You may call its listed methods directly; if a call is malformed the runtime returns the exact signatures. ` +
                `Call application.describeScriptingApi('${ns}') only if you want to browse its full API first.`
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
            this.invalidateLiveViewerContext();
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
        await Promise.all([
            this.chatService.refreshProviderTypesFromServer(),
            this.chatService.refreshProvidersFromServer(),
        ]);
        this.chatPanel?.refreshProviders?.();

        const activeProviderId =
            this.chatPanel?._providerId ||
            this.chatService.getProviders?.()[0]?.id ||
            null;

        if (activeProviderId) {
            await this.chatPanel?._refreshModelsForCurrentProvider?.();
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
     * Resolve a provider REFERENCE to an instance id from local state only — an instance id, a
     * managed key, a plugin id or a type id (see `shared/providerRef.ts`).
     *
     * Synchronous, so it is usable from render paths. Returns null for anything it cannot settle
     * locally, notably a hidden provider that was registered by a different browser session;
     * {@link resolveProviderRefAsync} covers that case.
     */
    resolveProviderRef(ref: string | null | undefined): string | null {
        const wanted = typeof ref === 'string' ? ref.trim() : '';
        if (!wanted) return null;
        if (this.chatService?.getProvider?.(wanted)) return wanted;
        const indexed = this._providerRefIndex.get(wanted);
        if (indexed) return indexed;
        return matchProviderRef(this.chatService?.getProviders?.() || [], wanted)?.id || null;
    }

    /**
     * {@link resolveProviderRef}, falling back to the server — the only way to reach a provider the
     * client cannot see (hidden ones are stripped from `listProviders` by design).
     *
     * Never throws and never rejects: an unresolvable reference is a configuration problem the
     * caller reports as readiness, not an exception to handle at every call site.
     */
    async resolveProviderRefAsync(ref: string | null | undefined): Promise<string | null> {
        const wanted = typeof ref === 'string' ? ref.trim() : '';
        if (!wanted) return null;

        const local = this.resolveProviderRef(wanted);
        if (local) return local;

        let lookup = this._providerRefLookups.get(wanted);
        if (!lookup) {
            lookup = (async () => {
                try {
                    const result = await this.chatService?.resolveProviderRef?.(wanted);
                    const id = result?.providerId || null;
                    if (id) this._providerRefIndex.set(wanted, id);
                    return id;
                } catch (e) {
                    console.warn(`chat: could not resolve provider reference '${wanted}'`, e);
                    return null;
                } finally {
                    this._providerRefLookups.delete(wanted);
                }
            })();
            this._providerRefLookups.set(wanted, lookup);
        }
        return await lookup;
    }

    /**
     * Index a completed managed registration under every stable reference that names it.
     *
     * Runs on every success, including a panel Retry: the server re-mints the instance id when its
     * process restarted, so a stale index entry must be overwritten rather than kept.
     */
    _indexManagedRegistration(pluginId: string | undefined, result: any): void {
        const providerId = typeof result?.providerId === 'string' ? result.providerId : null;
        if (!providerId) return;
        const typeId = typeof result?.providerTypeId === 'string' ? result.providerTypeId : null;
        // Server-reported key wins: a host may register with a custom managedKey, and deriving
        // `${pluginId}:${typeId}:default` would then index a key nothing resolves to.
        const managedKey = typeof result?.managedKey === 'string' && result.managedKey
            ? result.managedKey
            : (pluginId && typeId ? `${pluginId}:${typeId}:default` : null);
        for (const ref of [pluginId, typeId, managedKey]) {
            if (ref) this._providerRefIndex.set(ref, providerId);
        }
    }

    /**
     * Resolve which provider to auto-select: the local user's last-used (if still present) →
     * operator default (static meta, accepts a reference) → a server-tagged default provider →
     * the first available.
     */
    getPreferredProviderId(available: Array<{ id: string; metadata?: any }>): string | null {
        const ids = new Set((available || []).map(p => p.id));

        const remembered = this.getRememberedProviderId();
        if (remembered && ids.has(remembered)) return remembered;

        const operatorDefault = this.getStaticMeta?.('defaultProviderId', null) as string | null;
        // A reference, so an operator can route the picker to one provider by plugin id while
        // extraction runs on another. The `ids.has` test stays: the picker must never auto-select
        // something it cannot display, so a default naming a hidden provider correctly falls
        // through to the next rule rather than selecting an invisible entry.
        const resolvedDefault = operatorDefault ? this.resolveProviderRef(operatorDefault) : null;
        if (resolvedDefault && ids.has(resolvedDefault)) return resolvedDefault;

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

    /** Reset the expanded-namespace set when the active chat session changes. */
    _ensureExpansionSession(): void {
        const sid = this.chatService?.getActiveSessionId?.() ?? null;
        if (this._expandedNamespacesSessionId !== sid) {
            this._expandedNamespacesSessionId = sid;
            this._expandedNamespaces = new Set();
        }
    }

    /**
     * Mark namespaces as expanded for this session (only currently-granted ones stick).
     * Consent is re-checked at read time too, so a mid-session revoke self-heals.
     */
    _markNamespacesExpanded(namespaces: string[]): void {
        this._ensureExpansionSession();
        for (const ns of namespaces || []) {
            if (typeof ns !== 'string' || !ns) continue;
            if (!this._scriptConsent[ns]?.granted) continue;
            this._expandedNamespaces.add(ns);
        }
    }

    /** Sorted, granted-filtered expansion set — sent with every turn request. */
    getSessionExpandedNamespaces(): string[] {
        this._ensureExpansionSession();
        return [...this._expandedNamespaces]
            .filter((ns) => this._scriptConsent[ns]?.granted)
            .sort();
    }

    /** Seed expansions restored from a loaded session's metadata (server-persisted). */
    seedExpandedNamespaces(namespaces: string[]): void {
        this._ensureExpansionSession();
        for (const ns of namespaces || []) {
            if (typeof ns === 'string' && ns) this._expandedNamespaces.add(ns);
        }
    }

    /**
     * Cheap keyword routing from the user's message to namespaces they will likely
     * need, so their full signatures are in the system prompt on the FIRST model step
     * (no attempt-fail or describe round-trip). English-biased — a miss costs nothing
     * (the attempt-first flow with signature feedback is the backstop). Sensitive
     * namespaces (e.g. `patient`) NEVER hint-expand: their docs enter the prompt only
     * after an actual consent-gated call or describe.
     */
    static NAMESPACE_INTENT_HINTS: Record<string, RegExp> = {
        annotationsRead: /annotat|measure|outlin|marking|comment/i,
        annotationsWrite: /annotat|draw|outlin|\bmark\b|label/i,
        visualization: /heat\s*map|overlay|colou?r\s*map|visuali[sz]|shader|layer|channel|opacity/i,
        pathology: /tissue|tumou?r|lesion|biops|analy[sz]e|segment|region of interest|slide overview|explore/i,
        mlflowSink: /mlflow|experiment|metric/i,
    };

    applyIntentExpansionHints(userText: string): void {
        const text = String(userText || '');
        if (!text) return;
        const hits: string[] = [];
        for (const [ns, re] of Object.entries(ChatModule.NAMESPACE_INTENT_HINTS)) {
            const entry = this._scriptConsent[ns];
            if (!entry?.granted || entry.sensitive) continue;
            if (re.test(text)) hits.push(ns);
        }
        if (hits.length) this._markNamespacesExpanded(hits);
    }

    /** Reuse one hardened worker realm across a session's scripts (perf; static-meta opt-out). */
    _shouldReuseScriptWorker(context: any): boolean {
        if (this.getStaticMeta?.('reuseScriptWorkers', true) === false) return false;
        return typeof context?.executeScript === 'function' && typeof context?.createWorker === 'function';
    }

    /**
     * Stable per-session workerId for the reused realm. Recycles the previous worker
     * when the session changed (different id), the context changed, or the scripting
     * manifest generation moved (namespace/consent change — frozen stubs on a live
     * worker cannot gain methods on an already-installed namespace). Termination is
     * lazy-recreate: executeScript acquires a fresh pooled worker on the next run.
     */
    _ensureReusableScriptWorkerId(context: any): string {
        const sessionId = this.chatService?.getActiveSessionId?.() || 'default';
        const workerId = `chat-${String(sessionId).replace(/[^A-Za-z0-9_-]+/g, '_')}`;
        const manager = APPLICATION_CONTEXT?.Scripting as any;
        const generation = typeof manager?.manifestGeneration === 'number' ? manager.manifestGeneration : null;

        const prev = this._reusedScriptWorker;
        if (prev && (prev.workerId !== workerId || prev.contextId !== context?.id || prev.generation !== generation)) {
            try {
                const prevContext = prev.contextId === context?.id
                    ? context
                    : manager?.getContext?.(prev.contextId);
                prevContext?.abortScript?.(prev.workerId);
            } catch (_) { /* best-effort recycle */ }
        }
        this._reusedScriptWorker = { workerId, contextId: context?.id, generation };
        return workerId;
    }

    /** Drop the reused worker (failed script may leave corrupted realm state). */
    _recycleReusableScriptWorker(context: any, workerId: string | undefined): void {
        if (!workerId) return;
        try { context?.abortScript?.(workerId); } catch (_) { /* best-effort */ }
        if (this._reusedScriptWorker?.workerId === workerId) this._reusedScriptWorker = null;
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
        for (const entry of this._viewerAliasByReal.values() as Iterable<any>) {
            if (!entry.handle || !entry.label || entry.label === entry.handle) continue;
            // Compiled once per alias, not per rendered text part — this runs for
            // every assistant bubble on every render.
            entry.re = entry.re || new RegExp(`\\b${entry.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            out = out.replace(entry.re, () => entry.label);
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
    /** Drop the memoized snapshot; the next composeLiveViewerContext recomputes. */
    invalidateLiveViewerContext(): void {
        this._liveContextCache = null;
    }

    composeLiveViewerContext(): LiveViewerContext {
        const cacheSessionId = this.chatService?.getActiveSessionId?.() ?? null;
        if (this._liveContextCache && this._liveContextCache.sessionId === cacheSessionId) {
            return this._liveContextCache.value;
        }
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
            let currentMagnification: number | null = null;
            let nativeMagnification: number | null = null;
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
                // Two different numbers, and conflating them told the model every turn that the
                // user was at 40× while they looked at 1.5×: `scalebar.magnification` is the
                // slide's NATIVE objective power (a constant), `getMagnification()` is what the
                // scalebar shows right now.
                const rawNativeMag = viewer?.scalebar?.magnification;
                nativeMagnification = Number.isFinite(rawNativeMag) && rawNativeMag > 0 ? rawNativeMag : null;
                const rawCurrentMag = viewer?.scalebar?.getMagnification?.();
                currentMagnification = Number.isFinite(rawCurrentMag) && rawCurrentMag > 0
                    ? Math.round(rawCurrentMag * 100) / 100
                    : null;

                const range = viewer?.__depthController?.getRange?.();
                if (range && Number.isFinite(range.count) && range.count > 1) {
                    zStack = {
                        count: range.count,
                        index: Number.isFinite(range.index) ? range.index : 0,
                        spacingUm: Number.isFinite(range.spacingUm) ? range.spacingUm : null,
                        labels: Array.isArray(range.labels)
                            ? range.labels.slice(0, 64).map((label: unknown) => clampLiveContextString(label) ?? '')
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
                contextId: clampLiveContextString(presentedContextId) ?? '',
                imageName: clampLiveContextString(presentedImageName) ?? '',
                isActive: !!presentedContextId && presentedContextId === activeViewerId,
                background: clampLiveContextString(presentedBackground),
                zoom,
                currentMagnification,
                nativeMagnification,
                zStack,
                pathologyOverview: this._overviewMarkerFor(viewer),
            };
        });

        const loadedNamespaces: LiveViewerContextNamespace[] = Object.entries(this._scriptConsent)
            .map(([name, entry]) => ({ name: clampLiveContextString(name) ?? '', granted: !!entry?.granted }));

        let pathologyDrivers: LiveViewerContextDriver[] | undefined;
        try {
            const pathology = (globalThis as any).singletonModule?.('pathology-foundation');
            const drivers = pathology?.listDrivers?.();
            if (Array.isArray(drivers)) {
                pathologyDrivers = drivers.map((d: any) => ({
                    id: clampLiveContextString(d?.id) ?? '',
                    label: clampLiveContextString(d?.label ?? d?.id) ?? '',
                    local: !!d?.local,
                    features: Array.isArray(d?.features)
                        ? d.features.map((feature: unknown) => clampLiveContextString(feature) ?? '')
                        : [],
                }));
            }
        } catch (_) {
            // pathology-foundation not loaded — omit the section
        }

        // The model is about to be shown this exact open-slide set — make it the baseline so only
        // LATER opens/closes/swaps count as "changed since the previous message".
        this._markWorkspaceBaselineForSession();

        const value: LiveViewerContext = {
            composedAt: clampLiveContextString(new Date().toISOString(), LIVE_CTX_MAX_ISO) ?? '',
            activeViewerId: clampLiveContextString(activeViewerId),
            viewerCount: slides.length,
            viewers: slides,
            loadedNamespaces,
            pathologyDrivers,
        };
        this._liveContextCache = { sessionId: cacheSessionId, value };
        return value;
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
                    // Rank by the overview's own composite score, not raw interest — a node
                    // with no score must not win the gist by defaulting to zero-or-better.
                    const score = typeof n.rankScore === 'number' ? n.rankScore
                        : (typeof n.interest === 'number' ? n.interest : -1);
                    if (score > topInterest) {
                        topInterest = score;
                        topGist = clampLiveContextString(String(n.findings).split(/(?<=[.!?])\s/)[0]);
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
                builtAtIso: clampLiveContextString(overview.builtAtIso, LIVE_CTX_MAX_ISO) ?? '',
                // The assistant authored this query and can make it arbitrarily long; the
                // marker is a per-turn wire field, so it is clamped like every other string here.
                query: clampLiveContextString(overview.query, LIVE_CTX_MAX_QUERY),
                gist: topGist,
                // Boolean only — the stain/site values are clinical payload and belong in the
                // overview the agent fetches on demand, not in every turn's live context.
                contextKnown: !!(overview.context?.stain || overview.context?.organ),
                warningCount: Array.isArray(overview.warnings) ? overview.warnings.length : 0,
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

        if (typeof context?.setActiveViewerContextId === 'function') {
            // Stored value stays the REAL id — only the model-facing surface is aliased.
            // With no live viewer the context is left EXPLICITLY unbound: the scripting
            // API then resolves the viewer live, instead of inheriting a stale binding
            // from a previous turn whose viewer may since have closed.
            context.setActiveViewerContextId(viewerContextId || null);
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
            census: formatCensus(bracketCensus(script)),
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

        // Static `namespace.method` reference scan (text only, never evaluated).
        // Drives sticky namespace expansion (full docs in the next step's system
        // prompt) and exact-signature failure feedback.
        const knownNamespaces = Object.keys(this._scriptConsent || {});
        const apiRefs: Array<{ namespace: string; method: string }> =
            (window as any).ScriptingManager?.extractApiReferences?.(script, knownNamespaces) || [];

        // Transport-integrity gate. Text that cannot execute must never reach a worker: the
        // resulting SyntaxError describes code the model believes it wrote correctly, so it
        // re-emits the same bytes and the retry budget drains without anyone learning anything.
        const validation = (window as any).ScriptingManager?.validateScript?.(script);
        const malformed = this._checkScriptIntegrity(script, validation);
        if (malformed) {
            // The attempt still expands the namespaces — the retry's prompt then carries their
            // full signatures, exactly as on the runtime-failure path below.
            this._markNamespacesExpanded(apiRefs.map((r) => r.namespace));
            return malformed;
        }

        const reuse = this._shouldReuseScriptWorker(context);
        const workerId = reuse
            ? this._ensureReusableScriptWorkerId(context)
            : (typeof context?.createWorker === 'function'
                ? `${context.id || 'default'}-chat-script-${Date.now()}-${Math.random().toString(36).slice(2)}`
                : undefined);

        const signal = options?.signal;
        let lastProgress: unknown = undefined;
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

            // Partial results from `progress(value)`: if the run is stopped or times out,
            // this is what the model gets instead of nothing.
            const executionPromise = context.executeScript(script, {
                ...(workerId ? { workerId, reuseWorker: reuse } : {}),
                onProgress: (value: unknown) => { lastProgress = value; },
            });

            const result = signal
                ? await new Promise((resolve, reject) => {
                    const onAbort = () => reject(abortError());
                    signal.addEventListener('abort', onAbort, { once: true });

                    executionPromise.then(resolve, reject).finally(() => {
                        signal.removeEventListener('abort', onAbort);
                    });
                })
                : await executionPromise;

            // The script may have mutated viewer state (zoom, active viewer, overview,
            // opened data) — the next model step must see a fresh snapshot.
            this.invalidateLiveViewerContext();

            // The model has now used these namespaces — render them in full in the
            // system prompt from the next step on (a describe call counts too).
            this._markNamespacesExpanded(apiRefs.map((r) => r.namespace));

            chatDebugLog("SCRIPT_EXECUTION_RESULT", {
                contextId: context?.id || null,
                result,
            });
            const normalized = await this._normalizeScriptResultToMessage(result, context, {
                hadReturn: validation?.hasTopLevelReturn,
            });
            chatDebugLog("SCRIPT_EXECUTION_MESSAGE", normalized);
            return normalized;
        } catch (error) {
            // Even a failed script may have mutated viewer state before throwing.
            this.invalidateLiveViewerContext();
            // A thrown script may leave corrupted state in a shared realm — recycle.
            if (reuse) this._recycleReusableScriptWorker(context, workerId);
            // The attempt still expands the namespaces: the next step's prompt carries
            // their full signatures, exactly what a corrected retry needs.
            this._markNamespacesExpanded(apiRefs.map((r) => r.namespace));
            const message = error instanceof Error ? error.message : String(error);
            chatDebugLog("SCRIPT_EXECUTION_ERROR", {
                contextId: context?.id || null,
                error,
            });
            const scriptError: Record<string, unknown> = this._extractScriptExecutionErrorDetails(error) || {};
            const referencedSignatures = this._collectReferencedSignatures(apiRefs);
            if (referencedSignatures.length) scriptError.referencedSignatures = referencedSignatures;

            // A stopped or timed-out script is not necessarily worthless: hand back
            // whatever it published via progress() so the model can decide whether to
            // continue in smaller batches or answer from the partial data.
            const partial = (error as any)?.partialResult ?? lastProgress;
            const partialText = partial === undefined ? '' : await this._formatPartialScriptResult(partial);
            const text = `The requested action could not be completed: ${message}${partialText}`;

            return {
                role: 'user',
                parts: [{ ok: false, type: 'script-result', text, script } as any],
                content: text,
                createdAt: new Date(),
                metadata: {
                    scriptError: Object.keys(scriptError).length ? scriptError : null,
                } as any,
            };
        }
    }

    /**
     * Reject a script whose text did not survive the trip intact, WITHOUT running it.
     *
     * Two independent signals, because neither alone is enough: the compile probe proves the
     * text does not parse but reports no position (a Function-constructor `SyntaxError` carries
     * none), while the bracket census locates the break and names which character class went
     * missing entirely — the signature of a lossy transport rather than a model mistake.
     *
     * Returns the failure message to hand back, or undefined when the script may proceed.
     */
    _checkScriptIntegrity(script: string, validation: any): ChatMessage | undefined {
        const census = bracketCensus(script);

        if (validation?.ok !== false && census.balanced) return undefined;

        // Openers with zero closers is not something a model produces; it is something a
        // transport does. Distinguishing the two is what lets the retry ladder react.
        const kind = census.vanished.length ? 'transport-corruption' : 'syntax';
        const damage = describeCensusDamage(census);
        const syntaxMessage = validation?.error?.message;

        const detail = [
            syntaxMessage ? `${validation.error.name}: ${syntaxMessage}` : null,
            damage || null,
        ].filter(Boolean).join(' — ');

        const text = `The script text the runtime received did not parse and was NOT executed: ${
            detail || 'the script is not well-formed'}`;

        chatDebugLog("SCRIPT_TRANSPORT_INTEGRITY", {
            kind,
            census: formatCensus(census),
            probe: validation?.reason || null,
            script,
        });

        // No referenced signatures here on purpose: the question is not "is this call correct?"
        // but "did this text arrive intact?", and attaching up to 24 TS declarations would both
        // cost tokens and contradict the instruction to re-emit the same logic unchanged.
        const scriptError: Record<string, unknown> = {
            name: validation?.error?.name || 'MalformedScriptError',
            message: syntaxMessage || damage || 'The script is not well-formed.',
            kind,
            census,
            hasTopLevelReturn: !!validation?.hasTopLevelReturn,
        };

        return {
            role: 'user',
            parts: [{ ok: false, type: 'script-result', text, script } as any],
            content: text,
            createdAt: new Date(),
            metadata: {
                scriptFailureKind: 'malformed-script',
                scriptError,
            } as any,
        };
    }

    /**
     * Consent-filtered documentation for the `namespace.method` pairs a failing
     * script referenced — attached to the failure feedback so the model can correct
     * its call in ONE retry instead of a describeScriptingApi round-trip. Entries
     * with `found: false` name methods that do not exist (or are not granted).
     */
    _collectReferencedSignatures(
        apiRefs: Array<{ namespace: string; method: string }>
    ): Array<Record<string, unknown>> {
        if (!apiRefs?.length) return [];
        const manager = APPLICATION_CONTEXT?.Scripting as any;
        if (typeof manager?.getMethodManifest !== 'function') return [];
        try {
            const entries = manager.getMethodManifest(apiRefs) || [];
            // Cap defensively — a pathological script could reference dozens of methods.
            return entries.slice(0, 24);
        } catch (_) {
            return [];
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

    /**
     * True when the reply opens a script fence it never closes — i.e. the model was cut
     * off mid-code.
     *
     * Every extractor below needs a CLOSING fence, so a truncated script matches nothing
     * and is silently not executed: the run just stops with the half-written code sitting
     * in the transcript looking like it ran. The server flags this from `finishReason`,
     * but not every provider reports one, so detect it structurally too.
     */
    hasUnterminatedScriptFence(message: ChatMessage): boolean {
        const content = String(message?.content || "");
        if (!/```xopat-script/i.test(content)) return false;
        const fence = findScriptFence(content);
        return !!fence && !fence.terminated;
    }

    /**
     * The script the model asked to run, plus what the transport made of it.
     *
     * `balanced: false` means the fenced text does not hold together structurally — either the
     * model wrote broken code or something between the model and here dropped characters. The
     * caller must not silently execute it; see the integrity gate in `executeAssistantScript`.
     */
    extractScriptCandidate(message: ChatMessage): ScriptCandidate | undefined {
        const content = String(message?.content || "");

        const fence = findScriptFence(content);
        if (fence?.body) {
            return {
                script: fence.body,
                terminated: fence.terminated,
                balanced: fence.balanced,
                source: fence.tag.startsWith("xopat-") ? "xopat-fence" : "code-fence",
            };
        }

        const pseudoToolCall = this._extractScriptFromToolEnvelope(content);
        if (pseudoToolCall) {
            return {
                script: pseudoToolCall,
                terminated: true,
                balanced: bracketCensus(pseudoToolCall).balanced,
                source: "tool-envelope",
            };
        }

        return undefined;
    }

    /**
     * The runnable script, or undefined when there is none.
     *
     * An UNTERMINATED fence yields nothing on purpose: the model was cut off mid-code, and the
     * half it managed to write can be accidentally well-formed — running it would perform part
     * of an action nobody asked for. The caller reports the truncation instead
     * (`hasUnterminatedScriptFence`); `extractScriptCandidate` still exposes the partial body.
     */
    extractScriptFromAssistantMessage(message: ChatMessage): string | undefined {
        const candidate = this.extractScriptCandidate(message);
        return candidate?.terminated ? candidate.script : undefined;
    }

    extractAssistantTextWithoutScript(message: ChatMessage): string | undefined {
        const content = String(message?.content || "");
        if (!content.trim()) return undefined;

        // Remove fences by the SAME boundaries the extractor uses, so prose never inherits a
        // fragment of a script (or loses a paragraph to a lazily-matched inner backtick).
        let withoutFences = content;
        for (let guard = 0; guard < 8; guard++) {
            const fence = findScriptFence(withoutFences);
            if (!fence) break;
            withoutFences = withoutFences.slice(0, fence.start) + "\n" + withoutFences.slice(fence.end);
        }

        const stripped = withoutFences
            .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi, "")
            .replace(/functions\.xopat-(?:host-)?script\s*:\s*\d+/gi, "")
            .trim();

        return stripped || undefined;
    }

    /**
     * Last-resort recovery for a reply that encoded its call as native tool-call tokens.
     *
     * The server normally rewrites those envelopes into an xopat-script fence before the
     * message ever gets here, so this rarely fires — it covers paths that bypass server
     * sanitisation (cached/imported history, a future direct-provider client path).
     */
    _extractScriptFromToolEnvelope(content: string): string | undefined {
        return extractToolEnvelopeScripts(content)[0];
    }

    _readCodeFromToolPayload(payloadText: string): string | undefined {
        return readCodeFromToolPayload(payloadText);
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
        const wrapper = (window as any).LAYOUT.addTab({
            id: 'chat',
            title: $.t('chat.tabTitle'),
            icon: 'fa-comments',
            body: [this.chatPanel],
        });
        this._layoutAttached = true;

        // Lazy catalog trigger: fetch providers/models/sessions the first time
        // the chat surface is actually shown instead of at boot. A user whose
        // cached layout keeps the chat tab open gets the old eager behavior.
        const vm = wrapper?.visibilityManager;
        if (vm?.is?.()) {
            void this.ensureCatalog();
        } else if (typeof vm?.onChange === 'function') {
            this._catalogVisibilityUnsub = vm.onChange((visible: boolean) => {
                if (!visible) return;
                this._catalogVisibilityUnsub?.();
                this._catalogVisibilityUnsub = null;
                void this.ensureCatalog();
            });
        } else {
            // No visibility signal available — keep the previous eager fetch
            // rather than risking a dead chat panel.
            void this.ensureCatalog();
        }
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

    /**
     * Render the last `progress(value)` payload of a script that never finished.
     * Deliberately small and lossy — it is a hint for the model's next decision
     * (retry in batches vs. answer from what is there), not a result surface.
     */
    async _formatPartialScriptResult(partial: unknown): Promise<string> {
        const MAX_PARTIAL_CHARS = 2_000;
        let text: string;
        try {
            text = typeof partial === 'string' ? partial : JSON.stringify(partial);
        } catch (_) {
            text = String(partial);
        }
        if (!text) return '';
        if (text.length > MAX_PARTIAL_CHARS) {
            text = `${text.slice(0, MAX_PARTIAL_CHARS)}… [partial progress truncated at ${MAX_PARTIAL_CHARS} chars]`;
        }
        return `\n\n[partial progress — the script published this before it stopped; it did NOT finish]\n${text}`;
    }

    async _normalizeScriptResultToMessage(
        result: any,
        context?: any,
        options: { hadReturn?: boolean } = {}
    ): Promise<ChatMessage> {
        const UTILITIES = (globalThis as any).UTILITIES || {};
        const MAX_RESULT_TEXT_CHARS = 8_000;

        // Lazily park the FULL raw result under a context-scoped handle the first
        // time anything gets truncated, so truncation is no longer lossy: the model
        // reads the rest back in slices via application.readScriptResult(handle).
        let storedHandle: string | null | undefined = undefined;
        const resultHandle = (): string | null => {
            if (storedHandle !== undefined) return storedHandle;
            storedHandle = null;
            try {
                if (typeof context?.storeResult === 'function') {
                    storedHandle = context.storeResult(result, { label: 'script-result' });
                }
            } catch (_) { storedHandle = null; }
            return storedHandle ?? null;
        };
        const handleSuffix = (): string => {
            const handle = resultHandle();
            return handle
                ? ` — full result stored under handle "${handle}"; read it with await application.readScriptResult("${handle}", { path, offset, maxChars })`
                : '';
        };
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
            const head = value.slice(0, MAX_RESULT_TEXT_CHARS);
            const handle = resultHandle();
            if (handle) {
                return `${head}\n\n[${label} truncated at ${MAX_RESULT_TEXT_CHARS}/${value.length} chars. `
                    + `The FULL result is stored under handle "${handle}" — read the rest with `
                    + `await application.readScriptResult("${handle}", { path: "<dotted.path>" }) or { offset, maxChars }. `
                    + `Prefer a targeted path slice over sequential offset reads.]`;
            }
            return `${head}\n\n[${label} truncated to ${MAX_RESULT_TEXT_CHARS} characters by vercel-ai-chat-sdk]`;
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

        /**
         * A script that produced no value SUCCEEDED — a navigation or a toggle has nothing to
         * report. Emitting a `script-result` part here (even with `ok: true`) would render a
         * "no output" bubble for every side-effect script, and `ok: false` used to mark the run
         * as failed, burning a retry on work that actually happened.
         */
        const asVoidCompletion = (): ChatMessage => withInternalMetadata({
            role: 'tool',
            parts: [{
                type: 'host-feedback',
                text: options.hadReturn === false
                    ? 'Script completed successfully; any side effects were applied. It contained no `return`, so no data came back. If you need data, run ONE more script that returns it; otherwise answer the user now.'
                    : 'Script completed. It returned no value, so there is nothing to report from it. Treat the action as done — do not re-run it just to obtain data unless you actually need some.',
            } as any],
            content: 'Script completed with no returned value.',
            createdAt: new Date(),
            metadata: { scriptOutcome: 'void' } as any,
        });
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
                    items.push(`[Array truncated: ${value.length - capped.length} more item(s)${handleSuffix()}]`);
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
                    output.__truncated__ = `${entries.length - capped.length} more key(s) omitted${handleSuffix()}`;
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

        // `undefined` is "no value"; `null` is a value — a script answering "nothing found"
        // must not be told it forgot to return.
        if (result === undefined) {
            return asVoidCompletion();
        }

        if (typeof result === 'string') {
            const value = result.trim();

            if (!value) {
                return asVoidCompletion();
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
            return asVoidCompletion();
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
        // Provider plugins call this at boot right after registering their
        // server-side provider. Before first chat use there is nothing to
        // refresh — the lazily-fetched catalog (ensureCatalog) will already
        // see the registration. Only refresh a catalog that exists.
        if (!this._catalogPromise) {
            // ...unless a bootstrap already ran and failed. A cold backend fails the
            // catalog fetch and the provider registration together, so the panel is
            // sitting on an empty provider list with the memo cleared; refreshing
            // "the catalog that exists" would be a no-op and a successful retry would
            // never surface (empty "select provider", every control disabled).
            if (this._catalogBootstrapFailed) await this.ensureCatalog();
            return;
        }
        await this._catalogPromise;
        // Types as well as instances: a provider registered after the catalog snapshot
        // brings its own provider type, and the panel/model paths resolve a provider
        // through its type record — refreshing only instances leaves that dangling.
        await Promise.all([
            this.chatService.refreshProviderTypesFromServer(),
            this.chatService.refreshProvidersFromServer(),
        ]);
        this.chatPanel?.refreshProviders?.();
    }

    /**
     * Register a plugin-managed chat provider with boot resilience. Provider plugins
     * call this from `pluginReady` instead of invoking their own
     * `ensureChatProviderRegistered` RPC + `refreshProviders` inline.
     *
     * Why it lives here (shared) rather than in each plugin: the failure mode is a
     * cold/slow auth backend at boot, common to every provider plugin. A bounded
     * retry (each attempt failing fast via the caller's short RPC `timeoutMs`) plus a
     * visible status lets a transient outage self-heal with NO manual page reload —
     * the server-side registry persists the provider, so one successful retry
     * surfaces it. `register` is a thunk because `ensureChatProviderRegistered` is the
     * plugin's own server method (the module cannot own a call it was never handed).
     *
     * Detached by design: the method returns synchronously — the loader holds the
     * fullscreen loading overlay until every `pluginReady` settles, so a cold provider
     * backend must never be awaited on the boot path. The retry loop runs in the
     * background and reports through the panel's busy machinery; sends and headless
     * entry points gate on `whenManagedRegistrationsSettled()` so a chat use racing
     * the registration waits for it instead of failing with "provider not found".
     *
     * @param register thunk performing the plugin's ensureChatProviderRegistered RPC
     * @param opts.label human provider name, for busy/status/log lines
     * @param opts.onRegistered called on EVERY successful registration — the initial
     * one or a later user-triggered Retry. Use this (not `completion.then`) for wiring
     * that must also happen after a Retry: `completion` settles exactly once, so a
     * consumer that only chained it would miss the retry's success.
     * @returns handle whose `completion` resolves with the thunk's result once
     * registration + refresh succeeded, or `null` when all attempts failed. It never
     * rejects. (A legacy `await registerManagedProvider(...)` awaits this plain
     * object and resolves in a microtask — still non-blocking.)
     */
    registerManagedProvider<T = any>(
        register: () => Promise<T>,
        opts: ManagedProviderRegistrationOpts<T> = {}
    ): { completion: Promise<T | null> } {
        // A fresh (re)run supersedes a recorded failure for the same provider —
        // the busy phase takes over from the failure notice.
        this._failedRegistrations.delete(opts.label || 'provider');
        this._syncRegistrationFailureNotice();

        const completion = this._runManagedRegistration(register, opts);
        this._managedRegistrations.add(completion);
        completion.finally(() => this._managedRegistrations.delete(completion));
        return { completion };
    }

    /**
     * Resolves once every currently in-flight managed provider registration has
     * settled (including ones added while waiting). Each registration is bounded by
     * its own retry loop and never rejects, so this cannot hang or throw.
     */
    async whenManagedRegistrationsSettled(): Promise<void> {
        while (this._managedRegistrations.size) {
            await Promise.all([...this._managedRegistrations]);
        }
    }

    /**
     * Re-run every managed provider registration that exhausted its retries — the
     * Retry action of the panel's failure notice. Each re-run goes through the full
     * `registerManagedProvider` path again: busy visibility, send gating, and (on
     * another total failure) a fresh failure notice.
     */
    retryFailedProviderRegistrations(): void {
        const entries = [...this._failedRegistrations.values()];
        this._failedRegistrations.clear();
        this._syncRegistrationFailureNotice();
        for (const entry of entries) {
            this.registerManagedProvider(entry.register, entry.opts);
        }
    }

    async _runManagedRegistration<T>(
        register: () => Promise<T>,
        opts: ManagedProviderRegistrationOpts<T>
    ): Promise<T | null> {
        const attempts = 4; // ~0.8 + 1.6 + 3.2s backoff between the 4 tries
        const label = opts.label || 'provider';
        // Registered as a panel busy phase rather than written straight to the status line: a
        // plain status is erased by the next state recompute, so the retries used to run invisibly.
        const busyKey = `provider-registration:${label}`;
        try {
            this.chatPanel?.setExternalBusy?.(busyKey, 'chat.providerRegistering', 'provider', { label });
            for (let i = 0; i < attempts; i++) {
                try {
                    const result = await register();
                    await this.refreshProviders();
                    // Before onRegistered: that hook wires consumers (medgemma's analyze driver),
                    // and one of them may want to resolve a reference straight away.
                    this._indexManagedRegistration(opts.pluginId, result);
                    try {
                        opts.onRegistered?.(result);
                    } catch (hookError) {
                        console.error(`chat: onRegistered hook for '${label}' failed`, hookError);
                    }
                    return result;
                } catch (e) {
                    const last = i === attempts - 1;
                    if (last) {
                        const reason = this._describeRegistrationError(e);
                        this.chatPanel?.setExternalBusy?.(busyKey, null);
                        this.chatPanel?._setStatus?.($.t('chat.providerUnavailable'));
                        console.error(
                            `chat: provider '${opts.label || ''}' registration failed after ${attempts} attempts`,
                            e
                        );
                        // Persist for the panel's Retry action; the notice band is the
                        // user-visible surface (the status line above is transient).
                        this._failedRegistrations.set(label, { register, opts, reason });
                        this._syncRegistrationFailureNotice();
                        this.raiseEvent('provider-registration-failed', { label: opts.label || null, reason });
                        return null;
                    }
                    this.chatPanel?.setExternalBusy?.(busyKey, 'chat.providerRetrying');
                    await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** i));
                }
            }
            return null;
        } finally {
            this.chatPanel?.setExternalBusy?.(busyKey, null);
        }
    }

    /** One short human-readable line out of a registration failure. */
    _describeRegistrationError(error: any): string {
        const message = typeof error?.message === 'string' && error.message.trim()
            ? error.message.trim()
            : String(error ?? '');
        return message.length > 160 ? `${message.slice(0, 157)}…` : message;
    }

    /**
     * Mirror `_failedRegistrations` into the panel's persistent notice band: one
     * combined message naming every failed provider and its reason, plus a Retry
     * action. Cleared automatically when the map empties (retry started, or a
     * later registration for the same label succeeded).
     */
    _syncRegistrationFailureNotice(): void {
        const panel = this.chatPanel;
        if (!panel?.setPanelNotice) return;
        const entries = [...this._failedRegistrations.values()];
        if (!entries.length) {
            panel.setPanelNotice(null);
            return;
        }
        const text = entries
            .map((entry) => $.t('chat.providerRegistrationFailed', {
                label: entry.opts.label || 'provider',
                reason: entry.reason,
                // The notice renders through textContent (van span), so i18next's HTML
                // escaping would only double-encode quotes in upstream error messages.
                interpolation: { escapeValue: false },
            }))
            .join(' ');
        panel.setPanelNotice({
            text,
            actionText: $.t('common.retry'),
            onAction: () => this.retryFailedProviderRegistrations(),
        });
    }

    // =========================================================================
    // Headless API — drive chat without user interaction.
    //
    // Every call routes through the panel rather than around it. The panel owns the
    // one tested turn loop (retry guards, step budgeting, fingerprint dedup, stop
    // semantics), and going through it means an open chat tab renders external
    // activity live — bubbles, progress, streaming preview, session picker, status.
    //
    // Observers subscribe on this module (an OpenSeadragon.EventSource):
    //   singletonModule('vercel-ai-chat-sdk').addHandler('turn-complete', e => ...)
    // See EVENTS.md for the event catalogue and payloads.
    // =========================================================================

    /** The active session id, or null when no session is open. */
    getActiveSessionId(): string | null {
        return this.chatService.getActiveSessionId();
    }

    /** True while a turn is running — a second `appendUserUtterance` would be refused. */
    isTurnRunning(): boolean {
        return !!this.chatPanel?._isRunning;
    }

    /** Sessions visible to the current owner/provider, newest first. */
    async listSessions(providerId?: string): Promise<ChatSession[]> {
        return await this.chatService.listSessions(providerId);
    }

    /**
     * Create a session and make it the live one.
     *
     * Provider/model default to the panel's current selection, so a caller can pass
     * nothing. Pass `metadata.source` to tag externally-owned sessions — the picker
     * filters on it, which is how chat-based-tester keeps its sessions out of the UI.
     */
    async createSession(input: Partial<CreateSessionInput> = {}): Promise<ChatSession> {
        await this._awaitChatUsable();
        await this.whenScriptBaselineSettled();

        const panel = this.chatPanel;
        const providerId = input.providerId || panel?._providerId;
        if (!providerId) throw new Error($.t('chat.selectProviderFirst'));

        const modelId = input.modelId
            || (providerId === panel?._providerId ? panel?._modelId : null)
            || (await this.chatService.listModels(providerId))[0]?.id;
        if (!modelId) throw new Error($.t('chat.providerReturnedNoModels', { provider: providerId }));

        const session = await this.chatService.createSession({
            ...input,
            providerId,
            modelId,
            personalityId: Object.prototype.hasOwnProperty.call(input, 'personalityId')
                ? input.personalityId
                : panel?._personalityId,
            contextId: input.contextId ?? (this.chatService.getProvider(providerId)?.contextId || null),
            metadata: {
                viewerContextId: this.getActiveChatContextId(),
                ...(input.metadata || {}),
            },
        } as CreateSessionInput);

        // Only fold the new session into the panel when it belongs to the provider the panel is
        // showing. A session created against a different provider would otherwise leave the panel
        // with a foreign model selected — the session is still live in ChatService either way.
        if (panel && session.providerId === panel._providerId) {
            panel.adoptCreatedSession(session, { showChatView: false, fallbackModelId: modelId });
        }
        return session;
    }

    /** Hydrate an existing session into the panel and make it the live one. */
    async openSession(sessionId: string): Promise<ChatSession> {
        if (!sessionId) throw new Error('openSession requires a session id.');
        const panel = this.chatPanel;
        if (!panel) throw new Error('Chat panel is not available.');

        const session = await panel._loadSession(sessionId);
        if (!session) throw new Error(`Failed to open chat session '${sessionId}'.`);
        return session;
    }

    /**
     * Read a transcript. With no id (or the active id) this returns the panel's live
     * client transcript; any other id is fetched read-only and does NOT switch the panel.
     */
    async getTranscript(sessionId?: string): Promise<ChatMessage[]> {
        const activeId = this.getActiveSessionId();
        if (!sessionId || sessionId === activeId) {
            return (this.chatPanel?._messages || []).slice();
        }
        // Read-only hydration: does NOT switch the active session or fire the
        // session-hydrated host callback, so the live conversation's session-scoped
        // state (e.g. expanded scripting namespaces) is left untouched.
        const hydration = await this.chatService.loadSession(sessionId, { activate: false });
        return hydration.messages || [];
    }

    /**
     * Push a user utterance and run the full turn, resolving with how it ended.
     *
     * Identical to a typed message in every respect except the `source` tag on the
     * emitted events. Refuses (rather than queues) while another turn runs.
     */
    async appendUserUtterance(
        text: string,
        options: { sessionId?: string; signal?: AbortSignal; source?: ChatTurnSource } = {}
    ): Promise<ChatTurnOutcome> {
        const panel = this.chatPanel;
        if (!panel) throw new Error('Chat panel is not available.');

        await this._awaitChatUsable();
        await this.whenScriptBaselineSettled();

        if (options.sessionId && options.sessionId !== this.getActiveSessionId()) {
            await this.openSession(options.sessionId);
        }

        return await panel.sendText(text, {
            source: options.source || 'api',
            signal: options.signal,
        });
    }

    /**
     * Append a user utterance to the transcript WITHOUT running an assistant turn —
     * the display-only counterpart of `appendUserUtterance`. The message renders in
     * the panel, persists to the session store, and raises `utterance-appended`
     * (never `turn-start`/`turn-complete`). Dictation/reporting flows use this to
     * keep the chat a readable record while owning all LLM work themselves.
     */
    async appendTranscriptUtterance(
        text: string,
        options: { sessionId?: string; source?: ChatTurnSource } = {}
    ): Promise<{ sessionId: string | null; message: ChatMessage }> {
        const panel = this.chatPanel;
        if (!panel) throw new Error('Chat panel is not available.');

        // No model call happens, so the scripting baseline is irrelevant here.
        await this._awaitChatUsable();

        if (options.sessionId && options.sessionId !== this.getActiveSessionId()) {
            await this.openSession(options.sessionId);
        }

        return await panel.appendTranscriptMessage(text, { source: options.source || 'api' });
    }

    /**
     * Show (or update in place) a UI-only assistant bubble in the ACTIVE session —
     * a host-authored "response" that never ran a model turn. Not persisted, not
     * part of any turn context; tagged `metadata.internalSource: "assistant-note"`
     * so transcript consumers can filter it. See `ChatPanel.upsertAssistantNote`.
     *
     * Purely presentational: when `sessionId` is given and is NOT the active
     * session this is a no-op (never opens/switches sessions for it).
     * @returns true when the bubble was shown/updated
     */
    upsertAssistantNote(
        text: string,
        options: { sessionId?: string; noteId?: string; metadata?: Record<string, unknown> } = {}
    ): boolean {
        const panel = this.chatPanel;
        if (!panel || typeof (panel as any).upsertAssistantNote !== 'function') return false;
        if (options.sessionId && options.sessionId !== this.getActiveSessionId()) return false;
        return panel.upsertAssistantNote(text, { noteId: options.noteId, metadata: options.metadata });
    }

    /**
     * Route hands-free voice submits to the transcript only (no assistant reply).
     * See `ChatPanel.setTranscriptOnly`. Pass `{hideEcho:true}` for "summaries
     * only": raw transcript echoes are still recorded/persisted/extracted but not
     * rendered, so the consumer's own summary bubbles are all the chat shows.
     */
    setTranscriptOnlyMode(on: boolean, options: { hideEcho?: boolean } = {}): void {
        this.chatPanel?.setTranscriptOnly(!!on, options);
    }

    /**
     * Re-transcribe the whole recorded dictation session in a single pass and return
     * the text, or null when nothing was recorded (transcript-only mode archives the
     * session automatically).
     *
     * Why a consumer wants this: live dictation transcribes each segment on its own,
     * with none of the surrounding speech for context, which is where transcription
     * models mis-hear domain vocabulary and invent plausible-but-wrong words. One
     * pass over the whole recording is substantially more accurate, so a consumer
     * holding an authoritative transcript (a dictated report awaiting review) should
     * upgrade to this before showing it to the author.
     *
     * Rejects if the configured transcription driver fails — it does NOT fall back to
     * the in-browser model, whose output would be worse than the segments it replaces.
     */
    async transcribeSessionAudio(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string | null> {
        const panel: any = this.chatPanel;
        if (!panel || typeof panel.transcribeSessionAudio !== 'function') return null;
        return panel.transcribeSessionAudio(options);
    }

    /**
     * What dictation audio is retained, or null when there is none: `count`
     * recordings, and `truncated` when the archive hit its size/duration cap and
     * therefore does NOT cover the whole dictation. A caller must check `truncated`
     * before adopting a whole-audio transcript as authoritative — it would be more
     * accurate but silently incomplete.
     */
    /**
     * Dictation windows transcribed in the BACKGROUND while recording ran — each ~90 s
     * of speech decoded with its full surrounding context, in seal order.
     *
     * This is the accurate transcript, available without waiting: a consumer building
     * an authoritative record joins these instead of re-uploading the whole recording
     * at the end. Also raised as the `voice-window` event as each one lands.
     */
    getSessionWindows(): Array<{ index: number; text: string; fromSegment: number; toSegment: number; final: boolean }> {
        const panel: any = this.chatPanel;
        try { return panel?.getSessionWindows?.() || []; }
        catch (_e) { return []; }
    }

    /**
     * Extra vocabulary for the transcription bias prompt (Whisper `prompt`), on top of
     * the built-in glossary. Use it for terms you know are mis-heard in this
     * deployment: biasing the recognizer prevents the error, which is strictly better
     * than correcting it after the fact. Takes effect from the next capture.
     */
    setVoicePromptTerms(terms: string[]): void {
        const panel: any = this.chatPanel;
        try { panel?.setVoicePromptTerms?.(terms); }
        catch (_e) { /* voice absent */ }
    }

    sessionAudioInfo(): { count: number; windows: number; truncated: boolean } | null {
        const panel: any = this.chatPanel;
        try {
            const audio = panel?.getSessionAudio?.();
            const windows = panel?.getSessionWindows?.() || [];
            const count = audio ? audio.blobs.length : 0;
            if (!count && !windows.length) return null;
            // With windowing the blobs are handed over as they seal, so the truncation
            // flag has to come from the module rather than from a retained recording.
            const truncated = !!(audio?.truncated) || !!panel?.isSessionAudioTruncated?.();
            return { count, windows: windows.length, truncated };
        } catch (_e) { return null; }
    }

    /**
     * Drop the retained session recording. Callers should do this as soon as the
     * transcript it produced has been adopted — raw patient dictation is the most
     * sensitive thing in the session and there is no reason to keep it in memory
     * past its one use.
     */
    clearSessionAudio(): void {
        const panel: any = this.chatPanel;
        try { panel?.clearSessionAudio?.(); }
        catch (_e) { /* voice absent — nothing retained */ }
    }

    /** Stop the running turn, exactly as the Stop button does. No-op when idle. */
    stopTurn(): void {
        this.chatPanel?._handleStop();
    }

    /** Delete a session; clears the panel when it was the live one. */
    async destroySession(sessionId: string): Promise<void> {
        if (!sessionId) return;
        const wasActive = this.getActiveSessionId() === sessionId;

        await this.chatService.deleteSession(sessionId);

        if (wasActive) await this.chatPanel?._handleSessionSelection(null);
        await this.chatPanel?._refreshSessionsForCurrentProvider?.({ autoLoadLatest: false });
    }

    // ---- voice ----

    /** Is speech capture usable (module loaded, driver available, mic permitted)? */
    isVoiceAvailable(): boolean {
        return !!this.chatPanel?.isVoiceAvailable();
    }

    /**
     * Start hands-free capture. Completed speech turns are submitted as chat turns,
     * and every recognized segment (accepted or rejected) is reported via the
     * `voice-segment` event.
     */
    startVoiceCapture(): void {
        this.chatPanel?.startVoiceCapture();
    }

    /** Stop capture and release the microphone (discards a mid-turn utterance). */
    stopVoiceCapture(): void {
        this.chatPanel?.stopVoiceCapture();
    }

    /**
     * Finish hands-free capture gracefully: flush and submit the last utterance
     * (as a real chat turn) before releasing the microphone. Use when a manual stop
     * means "finish and submit" rather than discard.
     */
    async finishVoiceCapture(): Promise<void> {
        await this.chatPanel?.finishVoiceCapture();
    }

    /** Run a single dictation into the composer (auto-submitted only if configured). */
    async dictateOnce(): Promise<void> {
        await this.chatPanel?.dictateOnce();
    }
}

export { ChatModule, ChatPanel, ChatService };
window.addModule('vercel-ai-chat-sdk', ChatModule);
