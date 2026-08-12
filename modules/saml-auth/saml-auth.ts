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

    private _flags = new Map<string, SamlContextFlags>();
    private _handlerBound = new Set<string>();
    /** `_configured` flips true ONLY after contexts are actually applied; `_inflight`
     *  is the separate re-entrancy guard while the async run is pending. Conflating
     *  the two would let the bootstrap report success (and stop polling) before
     *  `listContexts()` settles, stranding the broker registered but never
     *  configured if that first RPC failed. */
    private _configured = false;
    private _inflight = false;

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

    private async _syncFromServer(contextId: string): Promise<boolean> {
        try {
            const res = await this.server().getToken({ contextId });
            return this._applyToken(contextId, res && res.token);
        } catch (e) {
            return false;
        }
    }

    /** The server refreshes the token from the stored assertion claims; bind once
     *  per context so an expiring secret is renewed without an IdP round-trip. */
    private _bindRefreshHandler(contextId: string): void {
        if (this._handlerBound.has(contextId)) return;
        this._handlerBound.add(contextId);
        const user = (window as any).XOpatUser.instance();
        user.addHandler(user.getEventName("secret-needs-update", contextId), async (e: any) => {
            if (e && e.type && e.type !== "jwt") return;
            const ok = await this._syncFromServer(contextId);
            if (ok) return;
            // The server has no live SAML session left, so only an interactive
            // login can help — and a refresh handler runs off an HTTP 401 with no
            // user gesture, which means a popup would be blocked and a redirect
            // would discard the workspace. Hand it to the core recovery gate,
            // which prompts on the user's next click.
            const auth = (window as any).APPLICATION_CONTEXT?.auth;
            if (auth?.markNeedsInteraction) {
                auth.markNeedsInteraction(contextId, { reason: "session-expired" });
            } else if (this._flags.get(contextId)?.autoLogin) {
                await this._interactiveLogin(contextId, false);
            }
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

    /** Popup keeps the viewer tab (and its unsaved workspace) intact. The server
     *  closes the popup and postMessages the opener; we then pull the token. */
    private _startPopup(action: string, contextId: string, nonce?: string | null): Promise<void> {
        const w = 520, h = 640;
        const left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2);
        const top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2);
        const popup = window.open(this._routeUrl(action, contextId, "popup", nonce), `xopat-saml-${contextId}`,
            `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
        if (!popup) {
            this._notify($.t("saml-auth:error.popupBlocked"), false);
            this._startRedirect(action, contextId, nonce);      // popup blocked → full-page redirect
            return new Promise<void>(() => { /* navigating away */ });
        }
        return new Promise<void>((resolve) => {
            let done = false;
            const finish = async () => {
                if (done) return;
                done = true;
                window.removeEventListener("message", onMessage);
                clearInterval(poll);
                try { popup.close(); } catch (e) { /* ignore */ }
                // Pull the token on EITHER the message OR the popup closing — some
                // browsers sever window.opener across the IdP navigation, so the
                // message may not arrive; the server has the token if login worked.
                await this._syncFromServer(contextId);
                resolve();
            };
            const onMessage = (e: MessageEvent) => {
                if (e.origin !== window.location.origin) return;    // same-origin only
                const d: any = e && e.data;
                if (d && d.type === "xopat-saml:done" && d.contextId === contextId) void finish();
            };
            const poll = setInterval(() => { if (popup.closed) void finish(); }, 500);
            window.addEventListener("message", onMessage);
        });
    }

    /**
     * Interactive login. A popup preserves the workspace, but `window.open`
     * without a user gesture is blocked by every browser — so an automatic login
     * (boot `autoLogin`, or a token refresh that found no server session) MUST go
     * through a full-page redirect. `flow` only governs user-initiated logins.
     */
    private async _interactiveLogin(contextId: string, userGesture = true): Promise<void> {
        if (!userGesture || this._flags.get(contextId)?.flow === "redirect") {
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
            init: async (contextId: string, cfg: any) => {
                this._bindRefreshHandler(contextId);
                // Pick up a token the server already holds (e.g. right after a
                // login redirect returned) and mirror it into XOpatUser.
                if (await this._syncFromServer(contextId)) return;
                // Nothing there — this is what makes `autoLogin` mean anything:
                // the context signs in at boot instead of waiting for a 401. Core
                // does not do this for us; every broker owns its own boot login
                // (oidc-client-ts does it inside OIDCAuthClient.init).
                const autoLogin = cfg?.autoLogin ?? this._flags.get(contextId)?.autoLogin;
                if (autoLogin) await this._interactiveLogin(contextId, false);
            },
            login: async (contextId: string) => {
                this._bindRefreshHandler(contextId);
                if (!(await this._syncFromServer(contextId))) {
                    await this._interactiveLogin(contextId);
                }
            },
            logout: async (contextId: string) => {
                // Authorize the SLO round-trip BEFORE dropping the local session:
                // the nonce is minted into that session, and beginLogout would have
                // nothing to mint into once it is gone.
                const wantsSlo = !!this._flags.get(contextId)?.sloEnabled;
                const nonce = wantsSlo ? await this._logoutNonce(contextId) : null;

                try { (window as any).XOpatUser.instance().logout(contextId); } catch (e) { /* ignore */ }
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
                    if (this._flags.get(contextId)?.flow === "redirect") this._startRedirect("slo", contextId, nonce);
                    else await this._startPopup("slo", contextId, nonce);
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
                    flow: c.flow === "redirect" ? "redirect" : "popup",
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
    }

    private _tryRegister(): boolean {
        const auth = (window as any).APPLICATION_CONTEXT && (window as any).APPLICATION_CONTEXT.auth;
        if (!auth || typeof auth.registerBroker !== "function") return false;
        if (!auth.hasBroker("saml")) auth.registerBroker("saml", this._broker);
        void this._configureFromServer(auth);
        return this._configured;   // keep polling until contexts are applied (xserver ready)
    }

    private _bootstrap(): void {
        if (this._tryRegister()) return;
        const iv = setInterval(() => { if (this._tryRegister()) clearInterval(iv); }, 50);
        setTimeout(() => clearInterval(iv), 15000);
    }
}

addModule("saml-auth", SamlAuth as any, true);
