/// <reference path="../../src/types/globals.d.ts" />
// Client glue for the SAML provider. Registers a "saml" broker into the core
// auth broker (APPLICATION_CONTEXT.auth). It never sees the IdP certificate, the
// SP private key or the token signing secret — it just pulls the current
// short-lived token from the server (which mints and re-mints it from the
// validated assertion) and writes it into XOpatUser, so HttpClient works
// transparently. Same shape as modules/oidc-server-ts. See src/AUTH.md.

const ROUTE = "/auth/saml";

interface SamlContextFlags {
    contextId: string;
    autoLogin: boolean;
    serviceName: string;
    flow: "popup" | "redirect";
    sloEnabled: boolean;
}

class SamlAuth extends XOpatModuleSingleton {

    /** How long a negative `_adoptServerSession` answer is reused. Long enough to
     *  cover the boot burst (init + both silent rungs), short enough that it never
     *  masks a session that appeared meanwhile. */
    private static readonly ADOPT_MEMO_MS = 2000;
    /**
     * Hard bound on a token RPC whose promise is SHARED (the boot/silent path). Short,
     * because later callers coalesce onto it and one wedged request would freeze the
     * sign-in click.
     */
    private static readonly ADOPT_TIMEOUT_MS = 8000;
    /**
     * Bound on an unshared (`force`) RPC — the sync after a popup closes, the 401
     * refresh. Nobody waits behind these; they must not inherit the short bound,
     * which would report a user who took their time at the identity provider as "the
     * server is unreachable".
     */
    private static readonly ADOPT_FORCED_TIMEOUT_MS = 120000;
    /**
     * Ceiling on how long a sign-in window may go unheard from. Generous: the user is
     * at an identity provider and may take their time. It exists only so
     * {@link _startPopup} can never return a promise that does not settle — which is
     * how the recovery scrim came to freeze on "Working…", swallowing every click.
     */
    private static readonly POPUP_CEILING_MS = 10 * 60 * 1000;

    private _flags = new Map<string, SamlContextFlags>();
    private _handlerBound = new Set<string>();
    private _adoptInFlight = new Map<string, Promise<{ ok: boolean; transportFailed: boolean }>>();
    private _adoptMemo = new Map<string, { at: number; result: { ok: boolean; transportFailed: boolean } }>();
    /** `_configured` flips true ONLY after contexts are actually applied; `_inflight`
     *  is the separate re-entrancy guard while the async run is pending. Conflating
     *  the two would let the bootstrap report success (and stop polling) before
     *  `listContexts()` settles, stranding the broker registered but never
     *  configured if that first RPC failed. */
    private _configured = false;
    private _inflight = false;
    /** Resolves when discovery is over (applied, or given up). Core's boot barrier
     *  awaits it through `registerContextDiscovery`, so it must ALWAYS settle:
     *  otherwise the first slide opens before a late `autoLogin` context is even
     *  known, races the login, and 401s on a healthy session. */
    private _discoveryDone: () => void = () => {};
    private _discovery: Promise<void> = new Promise<void>((resolve) => { this._discoveryDone = resolve; });
    private _discoveryAnnounced = false;

    constructor() {
        super();
        this.loadLocale();
        this._bootstrap();
    }

    // ── Token plumbing ───────────────────────────────────────────────────────

    private _decodeJwtPayload(token: string): Record<string, any> {
        try {
            const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            return JSON.parse(decodeURIComponent(escape(atob(p))));
        } catch (e) { return {}; }
    }

    private _applyToken(contextId: string, token: string | null | undefined): boolean {
        if (!token) return false;
        const user = (window as any).XOpatUser.instance();
        const p = this._decodeJwtPayload(token);
        const subject = p.sub || "user";
        // Re-assert the identity whenever the token's SUBJECT differs from the one
        // currently bound — not merely when nobody is logged in. After an account
        // switch at the IdP, the old guard kept displaying (and reporting) user A
        // while attaching user B's bearer token. XOpatUser.login() is idempotent
        // for an unchanged subject and swaps identities for a changed one.
        if (!user.getIsLogged(contextId) || user.getUserId?.(contextId) !== subject) {
            const name = p.name || p.email || p.sub || "User";
            user.login(subject, name, "", contextId);
        }
        user.setSecret(token, "jwt", contextId);
        return true;
    }

    /**
     * Mirror the server-side session token into XOpatUser.
     *
     * Returns `{ok, transportFailed}`. The distinction is load-bearing: a `getToken`
     * RPC that never reached xserver (still starting, a network blip) is NOT evidence
     * that the user has no SAML session, and reporting the two the same way is what
     * made core answer a boot-time blip with a full-page redirect — replacing the
     * viewer, and the unsaved workspace, with the browser's own error page. The
     * server cooperates: `register.server.ts` returns `{token: null}` for "no
     * session" and only throws for a transport failure or an unknown context.
     */
    private async _syncFromServer(contextId: string): Promise<{ ok: boolean; transportFailed: boolean }> {
        let res: any = null;
        try {
            res = await this.server().getToken({ contextId });
        } catch (e) {
            return { ok: false, transportFailed: true };
        }
        return { ok: this._applyToken(contextId, res && res.token), transportFailed: false };
    }

    /**
     * Adopt an existing server session, retrying once on a transport failure, and
     * coalescing concurrent callers onto one attempt.
     *
     * Core runs the silent rung more than once per boot (phase 1 of `runAutoLogin`,
     * then again inside `login`), and `init` adopts too. Core cannot dedupe those
     * against each other — `init` returns `void`, so it never learns what we
     * concluded — so the coalescing has to live here. The short memo covers the
     * boot burst without pinning a stale answer: any real auth transition is
     * followed by a fresh call anyway.
     */
    private async _adoptServerSession(
        contextId: string, opts: { force?: boolean } = {}
    ): Promise<{ ok: boolean; transportFailed: boolean }> {
        // `force` bypasses the IN-FLIGHT attempt as well as the memo: a caller that
        // knows the answer just changed must not be joined onto an older attempt that
        // predates the change — and must never be joined onto one that is wedged.
        if (opts.force) {
            this._adoptMemo.delete(contextId);
        } else {
            const running = this._adoptInFlight.get(contextId);
            if (running) return running;
            const memo = this._adoptMemo.get(contextId);
            if (memo && Date.now() - memo.at < SamlAuth.ADOPT_MEMO_MS) return memo.result;
        }

        const attempt = (async () => {
            let result = await this._syncFromServer(contextId);
            if (!result.ok && result.transportFailed) {
                // One retry: this runs at boot, when xserver may still be coming up,
                // and a missed RPC must not be read as "no session".
                result = await this._syncFromServer(contextId);
            }
            return result;
        })();
        // ALWAYS settles. An unbounded promise here is not merely slow: later callers
        // coalesce onto it, so one wedged RPC freezes the recovery scrim's sign-in
        // click with no way back. A timeout reports what actually happened — we did
        // not reach the server — which core reads as `"unknown"` and declines to
        // escalate into a navigation.
        const boundMs = opts.force ? SamlAuth.ADOPT_FORCED_TIMEOUT_MS : SamlAuth.ADOPT_TIMEOUT_MS;
        const bounded = Promise.race([
            attempt,
            new Promise<{ ok: boolean; transportFailed: boolean; timedOut?: boolean }>((resolve) =>
                setTimeout(() => resolve({ ok: false, transportFailed: true, timedOut: true }), boundMs)),
        ]);
        if (!opts.force) {
            this._adoptInFlight.set(contextId, bounded);
            void bounded.finally(() => {
                if (this._adoptInFlight.get(contextId) === bounded) this._adoptInFlight.delete(contextId);
            });
        }

        const result = await bounded;
        if ((result as any).timedOut) {
            console.warn(`saml-auth: the token RPC for context '${contextId}' did not answer within ` +
                `${boundMs}ms; treating it as unreachable.`);
        }
        // Only a NEGATIVE answer is worth remembering — a success has already written
        // the secret, and every later caller short-circuits on `isAuthenticated`.
        if (!result.ok) this._adoptMemo.set(contextId, { at: Date.now(), result });
        return result;
    }

    /** The server refreshes the token from the stored assertion claims; bind once
     *  per context so an expiring secret is renewed without an IdP round-trip. */
    private _bindRefreshHandler(contextId: string): void {
        if (this._handlerBound.has(contextId)) return;
        this._handlerBound.add(contextId);
        const user = (window as any).XOpatUser.instance();
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e: any) => {
            if (e && e.type && e.type !== "jwt") return;
            // `force`: a 401 is fresh evidence that the answer changed, so the boot
            // memo must not be reused here.
            const { ok, transportFailed } = await this._adoptServerSession(contextId, { force: true });
            if (ok) return;
            if (transportFailed) {
                // We could not ASK whether the session is still there. Reporting a
                // dead session because the RPC itself did not get through would put
                // the recovery scrim on screen over a network hiccup.
                console.warn(`saml-auth: could not reach the server to refresh context '${contextId}'; ` +
                    `leaving the session untouched.`);
                return;
            }
            // The server has no live SAML session left, so only an interactive
            // login can help — and a refresh handler runs off an HTTP 401 with no
            // user gesture, which means a popup would be blocked and a redirect
            // would discard the workspace. Hand it to the core recovery gate,
            // which prompts on the user's next click.
            (window as any).APPLICATION_CONTEXT?.auth?.markNeedsInteraction?.(
                contextId, { reason: "session-expired" });
        });
    }

    // ── Interactive login ────────────────────────────────────────────────────

    private _routeUrl(action: string, contextId: string, display: string, nonce?: string | null): string {
        let u = `${window.location.origin}${ROUTE}/${action}/${encodeURIComponent(contextId)}?display=${display}`;
        if (display === "redirect") u += `&return=${encodeURIComponent(window.location.href)}`;
        if (nonce) u += `&n=${encodeURIComponent(nonce)}`;
        return u;
    }

    private _startRedirect(action: string, contextId: string, nonce?: string | null): void {
        window.location.assign(this._routeUrl(action, contextId, "redirect", nonce));
    }

    /**
     * Authorize one SP-initiated logout. The `/slo/<ctx>` route has no CSRF check
     * of its own (server routes bypass the RPC gate), so it demands a single-use
     * nonce that only this session + CSRF gated RPC can mint.
     */
    private async _logoutNonce(contextId: string): Promise<string | null> {
        try {
            const res = await this.server().beginLogout({ contextId });
            return (res && res.nonce) || null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Claim a popup window, blank, RIGHT NOW.
     *
     * Split from navigating it so a caller that must await something first (the SLO
     * nonce) can still spend the click's transient activation, which expires a few
     * seconds after the gesture. Opening blank and setting `location` later is the
     * standard way to carry activation across an await.
     */
    private _openBlankWindow(name: string): Window | null {
        const w = 520, h = 640;
        const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
        const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2);
        const popup = window.open("", name,
            `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
        if (!popup) {
            // Report it; do NOT navigate. Core decided this attempt may not unload the
            // document (framed, or the user has unsaved work) and handed that down as
            // `mayNavigate: false` — a provider redirecting anyway overrides a policy
            // it cannot see. In a framed deployment that navigates the embedder's
            // iframe out from under them.
            this._notify($.t("saml-auth:error.popupBlocked"), false);
        }
        return popup;
    }

    /** Popup keeps the viewer tab (and its unsaved workspace) intact. The server
     *  closes the popup and postMessages the opener; we then pull the token. */
    private _startPopup(action: string, contextId: string, nonce?: string | null): Promise<void> {
        const popup = this._openBlankWindow(`xopat-saml-${contextId}`);
        if (!popup) return Promise.resolve();
        return this._driveWindow(popup, action, contextId, nonce);
    }

    /** Navigate an already-claimed window to the route and wait for its verdict. */
    private _driveWindow(popup: Window, action: string, contextId: string,
                         nonce?: string | null): Promise<void> {
        try { popup.location.replace(this._routeUrl(action, contextId, "popup", nonce)); }
        catch (e) {
            try { popup.close(); } catch (ignored) { /* ignore */ }
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            let done = false;
            const finish = async (failed = false) => {
                if (done) return;
                done = true;
                window.removeEventListener("message", onMessage);
                clearInterval(poll);
                clearTimeout(ceiling);
                try { popup.close(); } catch (e) { /* ignore */ }
                if (failed) { resolve(); return; }   // nothing to fetch; the server said no
                // Pull the token on EITHER the message OR the popup closing — some
                // browsers sever window.opener across the IdP navigation, so the
                // message may not arrive; the server has the token if login worked.
                //
                // `force`: a login just happened, so the negative answer memoized
                // moments ago (by this very login's head sync) is exactly the answer
                // that must NOT be reused — it would report a successful sign-in as
                // a failure.
                await this._adoptServerSession(contextId, { force: true });
                resolve();
            };
            const onMessage = (e: MessageEvent) => {
                if (e.origin !== window.location.origin) return;    // same-origin only
                const d: any = e && e.data;
                if (!d || d.type !== "xopat-saml:done" || d.contextId !== contextId) return;
                if (d.ok === false) {
                    // The server told us why instead of leaving a dead page in a
                    // window nothing was listening to.
                    console.warn(`saml-auth: sign-in did not complete for '${contextId}': ${d.reason || "unknown"}`);
                    void finish(true);
                    return;
                }
                void finish();
            };
            const poll = setInterval(() => {
                let closed = false;
                // Unreadable while the popup sits on an identity provider that sets
                // Cross-Origin-Opener-Policy (Google does); readable again once it
                // returns to our origin.
                try { closed = popup.closed; } catch (e) { return; }
                if (closed) void finish();
            }, 500);
            // A promise that can never settle is how the recovery scrim froze on
            // "Working…" and swallowed every further click. The user may take a while
            // at the identity provider, so the ceiling is generous — it exists to
            // guarantee an answer, not to hurry anyone.
            const ceiling = setTimeout(() => {
                console.warn(`saml-auth: the sign-in window for '${contextId}' did not report back in time.`);
                void finish();
            }, SamlAuth.POPUP_CEILING_MS);
            window.addEventListener("message", onMessage);
        });
    }

    /**
     * Interactive login, by the route the CALLER already chose.
     *
     * `navigate` is decided once, in `broker.login`, from core's `mayNavigate`, the
     * gesture, and the deployment's `flow`. Re-deriving any of that here would
     * silently override it — which is exactly what happened: the caller correctly
     * concluded "no gesture, so redirect", and this method then re-applied
     * `flow !== "popup"` and opened a popup that could not appear.
     *
     * A popup preserves the workspace, but `window.open` without a user gesture is
     * blocked by every browser, so it is only ever an option when a click brought us
     * here. This method only knows how to do each; it decides nothing.
     */
    private async _interactiveLogin(contextId: string, navigate = true): Promise<void> {
        if (navigate) {
            this._startRedirect("login", contextId);
            await new Promise<void>(() => { /* navigating away */ });
        } else {
            await this._startPopup("login", contextId);
        }
        if (!this._isAuthenticated(contextId)) {
            this._notify($.t("saml-auth:error.loginFailed", {
                service: this._flags.get(contextId)?.serviceName || contextId,
            }), false);
        }
    }

    private _isAuthenticated(contextId: string): boolean {
        const user = (window as any).XOpatUser.instance();
        return !!user.getIsLogged(contextId) && !!user.getSecret("jwt", contextId);
    }

    private _notify(message: string, ok: boolean): void {
        const Dialogs = (window as any).Dialogs;
        if (typeof Dialogs?.show !== "function") return;
        Dialogs.show(message, 7000, ok ? Dialogs.MSG_OK : Dialogs.MSG_WARN);
    }

    // ── Broker + context wiring ──────────────────────────────────────────────

    private get _broker() {
        return {
            init: async (contextId: string) => {
                this._bindRefreshHandler(contextId);
                // Pick up a token the server already holds (e.g. right after a
                // login redirect returned) and mirror it into XOpatUser. NOTHING
                // else: acting on `autoLogin` here is what let this broker
                // redirect-loop, because it had no way to know a previous page load
                // had already tried. Core drives it now (XOpatAuth.runAutoLogin),
                // where the boot-attempt marker and the one-navigation rule live.
                await this._adoptServerSession(contextId);
            },
            // The server re-mints the token from the stored assertion claims, so
            // there is a real silent route here — no IdP round trip, no window, no
            // navigation. It always existed; it just was not exposed under the
            // contract name, so `auth.loginSilent()` reported false for SAML.
            loginSilent: async (contextId: string) => {
                const { ok, transportFailed } = await this._adoptServerSession(contextId);
                if (ok) return true;
                // `"unknown"`, not `false`. We declare `navigatesOnLogin`, so `false`
                // here licenses core to redirect — and redirecting because we could
                // not REACH the server throws the viewer at an identity provider over
                // what is usually a two-second blip, taking the unsaved workspace
                // with it.
                if (transportFailed) {
                    console.warn(`saml-auth: the token RPC for context '${contextId}' did not reach the ` +
                        `server; reporting "unknown" rather than a failed login.`);
                    return "unknown";
                }
                return false;
            },
            // The gesture-free flow is a full-page redirect: allowed without a
            // click, and it unloads the document, so it takes the one boot
            // navigation slot core arbitrates.
            canLoginWithoutGesture: () => true,
            navigatesOnLogin: () => true,
            login: async (contextId: string, _cfg: any,
                          options?: { gesture?: boolean; mayNavigate?: boolean }) => {
                this._bindRefreshHandler(contextId);
                // Core owns whether we may unload the document; `flow` is only the
                // deployment's preference for a CLICK-DRIVEN login.
                //
                // `gesture === false` forces the redirect regardless of `flow`: an
                // automatic login has no user activation, so `window.open` is blocked
                // by every browser. Without this arm a `flow: "popup"` deployment
                // opened a popup at boot that could never appear — and since a
                // provider must not override core's `mayNavigate`, there was no
                // fallback left either. `oidc-server-ts` has always had this arm.
                const mayNavigate = options ? options.mayNavigate !== false : true;
                const navigating = mayNavigate
                    && (options?.gesture === false || this._flags.get(contextId)?.flow !== "popup");
                // The head sync saves a pointless IdP round trip when the server
                // already holds a session — but it is an AWAITED RPC, so it may only
                // run when we are about to NAVIGATE. `location.assign` needs no user
                // activation; `window.open` does, and transient activation expires a
                // few seconds after the click. Awaiting before opening a popup either
                // burned the gesture or, on a hung RPC, left the recovery scrim
                // spinning on "Working…" with no way back.
                //
                // Skipped for a click-less call too: core has just run the silent
                // rung, which IS this sync.
                if (navigating && options?.gesture !== false
                    && (await this._adoptServerSession(contextId)).ok) return true;
                await this._interactiveLogin(contextId, navigating);
                // The popup path resolves when the popup closes — signed in or
                // dismissed. Reporting the verdict is what lets core stop waiting for
                // login events instead of holding its caller (and the recovery scrim)
                // for the full interactive-login timeout. The redirect path never
                // reaches here (the page is unloading).
                return this._isAuthenticated(contextId);
            },
            logout: async (contextId: string) => {
                const wantsSlo = !!this._flags.get(contextId)?.sloEnabled;
                const viaPopup = wantsSlo && this._flags.get(contextId)?.flow !== "redirect";

                // Claim the window SYNCHRONOUSLY, while the click's activation is
                // still live. The nonce needs a server round trip, and by the time it
                // arrives (up to 3 s, plus the logout RPC) the activation is long
                // gone — so `window.open` was blocked, the user got a spurious
                // "popup blocked" warning on a deliberate sign-out, and the fallback
                // navigated the whole tab. Opening blank now and navigating later is
                // the standard way to carry activation across an await.
                const sloWindow = viaPopup ? this._openBlankWindow(`xopat-saml-${contextId}`) : null;

                // The identity goes FIRST. Every visible reaction — the toast, the
                // app-bar identity, the user menu — hangs off this event, and it used
                // to sit behind the nonce RPC, so a sign-out looked like it did
                // nothing for up to three seconds. The ordering constraint that
                // comment described is real but narrower: the nonce is minted into the
                // SERVER session, so it only has to precede the server logout below.
                try { (window as any).XOpatUser.instance().logout(contextId); } catch (e) { /* ignore */ }

                const nonce = wantsSlo ? await this._logoutNonce(contextId) : null;
                let serverLoggedOut = false;
                try { await this.server().logout({ contextId }); serverLoggedOut = true; } catch (e) { /* ignore */ }

                // Terminate the IdP session too when the deployment supports SLO,
                // otherwise the next login would silently re-authenticate.
                //
                // Only when the server-side session really went away: the SLO popup
                // shares _startPopup's completion path, which re-syncs the token on
                // close — with a still-live server session that would silently log
                // the user back in at the end of an explicit logout.
                if (wantsSlo && nonce && serverLoggedOut) {
                    if (!sloWindow) this._startRedirect("slo", contextId, nonce);
                    else await this._driveWindow(sloWindow, "slo", contextId, nonce);
                } else if (sloWindow) {
                    // No nonce, or the server session outlived the request: there is
                    // nothing to drive the window to, and leaving a blank one open is
                    // worse than never having claimed it.
                    try { sloWindow.close(); } catch (e) { /* ignore */ }
                }
            },
            // isAuthenticated / getToken intentionally omitted: XOpatAuth's defaults
            // (getIsLogged + getSecret("jwt", ctx)) already do exactly this.
        };
    }

    /** Fetch the server-declared contexts (public flags only; IdP config and the
     *  signing secret live server-side) and register each with the core broker. */
    private async _configureFromServer(auth: any): Promise<void> {
        if (this._configured || this._inflight) return;
        this._inflight = true;
        let list: SamlContextFlags[] = [];
        try { list = (await this.server().listContexts())?.contexts || []; }
        catch (e) { this._inflight = false; return; }   // xserver not ready yet — retry on next poll
        for (const c of list) {
            this._flags.set(c.contextId, c);
            try {
                await auth.configureContext({
                    contextId: c.contextId,
                    method: "saml",
                    serviceName: c.serviceName || c.contextId,
                    autoLogin: c.autoLogin === true,
                    // Redirect by default: the only flow that works with no gesture,
                    // so it is what an unconfigured deployment needs at boot. Core
                    // falls back to a popup on its own when it decides a navigation
                    // is not allowed (framed, or unsaved work).
                    flow: c.flow === "popup" ? "popup" : "redirect",
                    sloEnabled: c.sloEnabled === true,
                    // The broker declares what it stores, so consumers never
                    // hardcode HttpClient's auth.types (XOpatAuth.getSecretTypes).
                    secretTypes: ["jwt"],
                });
            } catch (e) {
                console.error(`saml-auth: configure context '${c.contextId}' failed`, e);
            }
        }
        this._configured = true;
        this._inflight = false;
        this._discoveryDone();
    }

    private _tryRegister(): boolean {
        const auth = (window as any).APPLICATION_CONTEXT && (window as any).APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!auth.hasBroker("saml")) auth.registerBroker("saml", this._broker);
        // Announced ONCE (this runs on a poll): core waits for the whole discovery,
        // retries included, not for each individual attempt.
        if (!this._discoveryAnnounced && typeof auth.registerContextDiscovery === "function") {
            this._discoveryAnnounced = true;
            auth.registerContextDiscovery(this._discovery);
        }
        void this._configureFromServer(auth);
        return this._configured;   // keep polling until contexts are applied (xserver ready)
    }

    private _bootstrap(): void {
        if (this._tryRegister()) return;
        const iv = setInterval(() => { if (this._tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => { clearInterval(iv); this._discoveryDone(); }, 15000);
    }
}

addModule("saml-auth", SamlAuth as any, true);
