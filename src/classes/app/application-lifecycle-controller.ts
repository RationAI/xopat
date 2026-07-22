import { ViewerSelectionState } from "./viewer-selection-state";

export class ApplicationLifecycleController {
    /**
     * Bootstrap-only path: must use raw sessionStorage because it runs
     * before initXOpatLoader creates IO_PIPELINE. See src/IO_PIPELINE.md
     * "Bootstrap exception".
     */
    static restoreLocalState() {
        const sessionStateKey = "__xopat_session__";

        if (window.location.hash && window.location.hash.length > 1) {
            sessionStorage.removeItem(sessionStateKey);
            return null;
        }

        const data = sessionStorage.getItem(sessionStateKey);
        if (data) {
            try {
                return JSON.parse(data);
            } catch (e) {
                console.debug("Failed to restore session!", e);
                sessionStorage.removeItem(sessionStateKey);
            }
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

            function loadPluginAwaits(pid: string, hasParams: boolean) {
                return new Promise<void>((resolve) => {
                    UTILITIES.loadPlugin(pid, resolve);
                    if (!hasParams) {
                        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
                        if (config.plugins) {
                            config.plugins[pid] = {};
                        }
                    }
                });
            }

            // `disablePluginsAutoload` suppresses ONLY the cookie-driven
            // restore (`_plugins`). Server-side permaLoad and per-session
            // declared plugins still come up normally — the session is
            // meant to pretend cached user picks weren't made, not to
            // disable the deployment's auto-loaded set.
            const allowCookieRestore = !this.appContext.getOption("disablePluginsAutoload", false);
            const pluginKeys = allowCookieRestore
                ? (this.appContext.AppCookies.get("_plugins", "").split(",") || [])
                : [];
            const config = this.appContext._dangerouslyAccessConfig();
            for (const pid in pluginRegistry) {
                const hasParams = !!config.plugins?.[pid];
                const plugin = pluginRegistry[pid]!;
                if (
                    (plugin.loaded && !plugin.instance) ||
                    (!plugin.loaded && (hasParams || pluginKeys.includes(pid)))
                ) {
                    if (plugin.error) {
                        console.warn("Dynamic plugin loading skipped: ", pid, plugin.error);
                    } else {
                        await loadPluginAwaits(pid, hasParams);
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

            const event = {
                data,
                background,
                visualizations
            };
            await VIEWER_MANAGER.raiseEventAwaiting("before-app-init", event).catch((e: any) => {
                console.error(e);
            });
            await this.appContext.openViewerWith(event.data, event.background || [], event.visualizations || []);
            // Boot has reached the point where the first viewer is open and
            // all initial DockableWindows/tabs have had their deferred sync
            // run. Flip the boot-phase gate so further component/viewer
            // creations no longer honor `params.ui.*` as a forced hide —
            // they fall through to AppCache/defaults like a normal session.
            (this.appContext as any).setUiBootComplete?.();
            VIEWER_MANAGER.addHandler("plugin-loaded", (e: PluginLoadedEvent) => {
                if (!e.isInitialLoad) {
                    Dialogs.show($.t("messages.pluginLoadedNamed", { plugin: pluginRegistry[e.id]?.name }), 2500, Dialogs.MSG_INFO);
                }
            });
        } catch (e) {
            USER_INTERFACE.Loading.show(false);
            USER_INTERFACE.Errors.show($.t("error.unknown"), `${$.t("error.reachUs")} <br><code>${e}</code>`, true);
            console.error(e);
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
