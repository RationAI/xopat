import { ViewerSelectionState } from "./viewer-selection-state";
import { LEGACY_PLUGINS_COOKIE, pluginsCookieKey } from "./deployment-key";

export class ApplicationLifecycleController {
    /**
     * Bootstrap-only path: raw sessionStorage, and necessarily so.
     *
     * This payload CARRIES the ENV (plus PLUGINS/MODULES/POST_DATA), which
     * `app.ts` applies wholesale over what the server just sent — including
     * `client.io`, the block that configures the storage pipeline. A consumer
     * of ENV cannot be routed through machinery that ENV configures, so this
     * one can never move onto IO_PIPELINE no matter how the boot order is
     * rearranged. See src/IO_PIPELINE.md "Bootstrap exception".
     *
     * Probe-gated: this is the FIRST storage touch of the whole boot, and in a
     * sandboxed iframe (opaque origin) the `sessionStorage` property read
     * throws `SecurityError`. The outer try/catch covers the residual cases the
     * probe cannot see (quota, mid-session policy change).
     *
     * @param currentDeploymentKey identity of the deployment being served
     *   (`initDeploymentKey`, `classes/app/deployment-key.ts`). A payload that
     *   does not carry exactly this key is refused — including an unstamped one,
     *   which predates the scoping and carries no evidence of its origin.
     */
    static restoreLocalState(currentDeploymentKey?: string) {
        if (!XOpatStorageAvailability.sessionStorage) return null;
        const sessionStateKey = "__xopat_session__";

        try {
            if (window.location.hash && window.location.hash.length > 1) {
                sessionStorage.removeItem(sessionStateKey);
                return null;
            }

            const data = sessionStorage.getItem(sessionStateKey);
            if (data) {
                // ONE SHOT. This payload exists to survive a single navigation — a
                // login redirect, an explicit `refreshPage` — and it carries `ENV`,
                // which `app.ts` applies wholesale over the ENV the server just sent.
                // Leaving it in place made every later load of the tab replay the
                // deployment it was captured from: switching a tab from one ENV to
                // another silently kept the old one, forever, because the thing that
                // used to clear it (a URL hash) is only written once the viewer has
                // opened — which a wedged boot never reaches. Consuming it here also
                // un-sticks a tab that is already in that state, on the next reload.
                sessionStorage.removeItem(sessionStateKey);
                try {
                    const parsed = JSON.parse(data);
                    // Not `_`-prefixed: the writer's `safeStringify` strips those.
                    const stamp = parsed?.deploymentStamp;
                    const current = currentDeploymentKey;
                    if (current && stamp !== current) {
                        // Captured under a different deployment. Restoring it would
                        // swap ENV, PLUGINS and MODULES under a viewer that was served
                        // something else entirely.
                        console.warn("xOpat: ignoring a stored session from a different deployment " +
                            `('${stamp ?? "unscoped"}' ≠ '${current}').`);
                        return null;
                    }
                    return parsed;
                } catch (e) {
                    console.debug("Failed to restore session!", e);
                }
            }
        } catch (e) {
            console.debug("Session state storage unavailable.", e);
        }
        return null;
    }

    constructor(
        private readonly appContext: ApplicationContext,
        private readonly cloneRuntimeState: <T>(value: T) => T
    ) {}

    async beginApplicationLifecycle(
        data: any,
        background: BackgroundItem[] | BackgroundConfig[] | undefined,
        visualizations: VisualizationItem[] | undefined,
        initLayers: () => void,
        pluginRegistry: Record<string, XOpatElementItem>
    ) {
        // Renderer capability gate. ViewerManager.add() runs the FlexRenderer
        // self-test during boot and records the verdict here; when it fails no
        // viewer was created, so report the cause clearly and stop the loading
        // spinner instead of proceeding into a broken boot (the old path threw
        // and left an "Unknown error" + endless spinner). See loader.ts add().
        const renderingCapability = (this.appContext as any).__renderingCapability;
        if (renderingCapability && renderingCapability.ok === false) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show(
                $.t("error.rendererUnavailableTitle"),
                `${$.t("error.rendererUnavailable")} <br><code>${renderingCapability.error || ""}</code>`,
                true
            );
            console.error("xOpat renderer unavailable; aborting application lifecycle.", renderingCapability.error || renderingCapability);
            return;
        }
        try {
            initLayers();

            function loadPluginAwaits(pid: string, hasParams: boolean, force = false) {
                const loading = UTILITIES.loadPlugin(pid, undefined, force);
                if (!hasParams) {
                    const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
                    if (config.plugins) {
                        config.plugins[pid] = {};
                    }
                }
                return loading;
            }

            // `disablePluginsAutoload` suppresses ONLY the cookie-driven
            // restore (`_plugins`). Server-side permaLoad and per-session
            // declared plugins still come up normally — the session is
            // meant to pretend cached user picks weren't made, not to
            // disable the deployment's auto-loaded set.
            const allowCookieRestore = !this.appContext.getOption("disablePluginsAutoload");
            // Deployment-scoped: the cookie jar is shared by every deployment on
            // this origin, so an unscoped list resurrected plugins (and their
            // module dependencies) in envs that never shipped them. Two
            // deployments now keep independent lists instead of overwriting
            // each other's.
            this.appContext.AppCookies.delete(LEGACY_PLUGINS_COOKIE);
            const pluginKeys = allowCookieRestore
                ? (this.appContext.AppCookies.get(pluginsCookieKey(), "").split(",") || [])
                : [];
            const config = this.appContext._dangerouslyAccessConfig();
            for (const pid in pluginRegistry) {
                const hasParams = !!config.plugins?.[pid];
                const plugin = pluginRegistry[pid]!;
                // The server shipped this plugin's scripts but they produced no instance:
                // a recovery re-run, and the one case that must re-evaluate files already on
                // the page. `force` covers only the plugin's own files — its shared module
                // dependencies stay deduplicated (re-evaluating those is what defined
                // fabric.js twice).
                const needsRerun = !!(plugin.loaded && !plugin.instance);
                if (needsRerun || (!plugin.loaded && (hasParams || pluginKeys.includes(pid)))) {
                    if (plugin.error) {
                        console.warn("Dynamic plugin loading skipped: ", pid, plugin.error);
                    } else {
                        await loadPluginAwaits(pid, hasParams, needsRerun);
                    }
                }
            }

            // Scripting bootstrap is deliberately NOT awaited: ingesting the
            // `.d.ts` documentation metadata costs network round-trips and no
            // boot step needs it synchronously — consumers await the idempotent
            // `Scripting.initialize()` at point of use. Starting it after the
            // plugin loop also lets plugin-registered external APIs join the
            // preferred bootstrap ingest instead of the late-registration path.
            void this.appContext.Scripting.initialize().catch((e: unknown) =>
                console.error("Scripting bootstrap failed:", e));

            // Slide protocols may require a login of their own (`slide_protocols.<id>.auth`).
            // Declare those contexts before the barrier below looks: otherwise the
            // declaration happens lazily on the first slide of that protocol, so a
            // deployment streaming two credentialed upstreams never reports the second
            // context as unclaimed until someone opens a slide from it.
            try {
                (window as any).SLIDE_PROTOCOLS?.declareAuthContexts?.();
            } catch (e) {
                console.warn("Slide-protocol auth context declaration failed:", e);
            }

            const event = {
                data,
                background,
                visualizations
            };
            await VIEWER_MANAGER.raiseEventAwaiting("before-app-init", event).catch((e: any) => {
                console.error(e);
            });
            // Contexts that log in automatically do so asynchronously (OIDC
            // redirect return, silent renew). Opening backgrounds first sends the
            // slide-info and tile burst out unauthenticated and the upstream
            // answers 401. Wait for the verdict — not for success. Placed after
            // `before-app-init` so contexts declared by plugins loaded above, or
            // by the handlers themselves, are included.
            await this._awaitAuthContexts();
            await this.appContext.openViewerWith(event.data, event.background || [], event.visualizations || []);
            // Boot has reached the point where the first viewer is open and
            // all initial DockableWindows/tabs have had their deferred sync
            // run. Flip the boot-phase gate so further component/viewer
            // creations no longer honor `params.ui.*` as a forced hide —
            // they fall through to AppCache/defaults like a normal session.
            (this.appContext as any).setUiBootComplete?.();
            VIEWER_MANAGER.addHandler("plugin-loaded", (e: PluginLoadedEvent) => {
                if (!e.isInitialLoad) {
                    Dialogs.show($.t("messages.pluginLoadedNamed", { plugin: elementName("plugins", e.id) }), 2500, Dialogs.MSG_INFO);
                }
            });
        } catch (e) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show($.t("error.unknown"), `${$.t("error.reachUs")} <br><code>${e}</code>`, true);
            console.error(e);
        }
    }

    /**
     * Drive and then await the automatic login of every `autoLogin` auth context.
     * Only `autoLogin` contexts qualify: a context declared merely as *required*
     * has nothing driving a login at boot, so waiting for it would only burn the
     * timeout. Never blocks boot — a broken IdP costs `timeoutMs` and then the
     * viewer opens anyway (the upstream 401 is the honest error).
     */
    private async _awaitAuthContexts(timeoutMs: number = 8000): Promise<void> {
        const auth = (this.appContext as any).auth;
        if (typeof auth?.whenAllSettled !== "function") return;
        // A broker that reads its contexts from the server declares them late. Let
        // that discovery finish first, or `listAutoLoginContexts()` reports an empty
        // set, nothing is waited for, and the first slide races the login it should
        // have waited for (401 → auth recovery scrim on a healthy session).
        await auth.whenContextsDiscovered?.();
        const pending: string[] = auth.listAutoLoginContexts?.() ?? [];
        if (!pending.length) {
            // A broker that registered but declared NO CONTEXT AT ALL by this point
            // means the barrier is waiting for nothing — the signature of a module
            // whose contexts land after the first slide open, which then races the
            // login it should have waited for. Derived from the registry, not a
            // hardcoded list: the old list omitted `empaia-workbench` and would omit
            // every broker added after it, so the diagnostic went quiet for exactly
            // the modules most likely to trip it.
            //
            // `listContexts()` is what separates that from a deployment that simply
            // does not want a boot login. Testing only `listAutoLoginContexts()`
            // conflated the two, so every legitimate `autoLogin: false` deployment —
            // an on-demand chat login over an anonymous viewer, and both auth test
            // envs — was told to call `registerContextDiscovery()`, which the brokers
            // shipping here already do. A warning that fires on a supported
            // configuration teaches readers to ignore it.
            const declared: unknown[] = auth.listContexts?.() ?? [];
            if (typeof auth.listBrokerMethods === "function"
                && auth.listBrokerMethods().length > 0 && !declared.length) {
                console.warn("xOpat: an auth module is loaded but had declared NO auth context by the time " +
                    "the first slide opened, so nothing could be waited for. If slides need a credential they " +
                    "may 401 — the module should announce its context declaration via " +
                    "APPLICATION_CONTEXT.auth.registerContextDiscovery(). See src/AUTH.md. " +
                    "(A context declared with autoLogin disabled is a deployment choice and is not this.)");
            }
            return;
        }
        // `Loading.text(true)` resolves to the CURRENT title, so restoring means
        // remembering it rather than passing `true`.
        const previousTitle = document.getElementById("fullscreen-loader-title")?.innerText ?? "";
        // ONE deadline across both steps. They answer different questions —
        // `runAutoLogin` starts and bounds the attempt, `whenAllSettled` observes
        // the verdict (and is what a broker writing its secret a tick after init
        // depends on) — but giving each the full budget would double the boot stall
        // on an unreachable identity provider.
        const deadline = Date.now() + timeoutMs;
        try {
            USER_INTERFACE.Loading.text($.t("auth.waitingForLogin"));
            // Core owns the click-less login ladder: silent first, then at most one
            // navigating login, then the interaction gate. Brokers supply the
            // mechanism only. See src/AUTH.md.
            await auth.runAutoLogin({ timeoutMs: Math.max(0, deadline - Date.now()) });
            const results: Record<string, boolean> = await auth.whenAllSettled({
                timeoutMs: Math.max(0, deadline - Date.now()),
            });
            for (const [contextId, ok] of Object.entries(results)) {
                if (!ok) {
                    console.warn(`xOpat: auth context '${contextId}' did not authenticate before the first slide ` +
                        `open — requests bound to it may fail with 401. See src/AUTH.md.`);
                }
            }
        } catch (e) {
            console.warn("xOpat: waiting for auth contexts failed; opening the viewer anyway.", e);
        } finally {
            USER_INTERFACE.Loading.text(previousTitle);
        }
    }

    async replaceVisualizationSet(
        visualizations: VisualizationItem[],
        newData: DataID[] = [],
        activeVizIndex: number | number[] | undefined = undefined
    ) {
        if (!Array.isArray(visualizations)) {
            throw new Error("Visualizations must be an array.");
        }

        const previousData = this.cloneRuntimeState(Array.isArray(this.appContext.config.data) ? this.appContext.config.data : []);
        const previousVisualizations = this.cloneRuntimeState(Array.isArray(this.appContext.config.visualizations) ? this.appContext.config.visualizations : []);
        // Capture the per-slot viz selection by reading each bg entry's
        // `visualizationIndex`. The active slot order is `activeBackgroundIndex`.
        const previousActiveBg = ViewerSelectionState.normalizeSelectionValue(
            this.appContext.getOption("activeBackgroundIndex", undefined, true, true)
        ) || [];
        const previousBackgrounds: any[] = Array.isArray(this.appContext.config.background) ? this.appContext.config.background : [];
        const previousActiveViz = previousActiveBg.map((bgIdx: any) => {
            const v = Number.isInteger(bgIdx) ? previousBackgrounds[bgIdx as number]?.visualizationIndex : undefined;
            return Number.isInteger(v) ? v as number : undefined;
        });

        const currentData = [...previousData];
        if (newData.length > 0) {
            currentData.push(...newData);
        }

        // If the caller supplies an explicit selection, honor it; otherwise
        // keep the previous per-slot viz selection.
        const vizSpec = activeVizIndex !== undefined ? activeVizIndex : previousActiveViz;

        try {
            return await this.appContext.openViewerWith(
                currentData,
                undefined,
                visualizations,
                undefined,
                vizSpec,
                {
                    strictVisualization: true,
                }
            );
        } catch (error) {
            try {
                await this.appContext.openViewerWith(
                    previousData,
                    undefined,
                    previousVisualizations,
                    undefined,
                    previousActiveViz,
                    {
                        historyMode: "skip",
                        fromHistory: true,
                        strictVisualization: false,
                        skipVisualizationCapabilityCheck: true,
                        suppressDialogsOnVisualizationFailure: true,
                    }
                );
            } catch (restoreError) {
                console.error("Failed to restore visualization state after a rejected update.", restoreError);
            }
            throw error;
        }
    }
}
