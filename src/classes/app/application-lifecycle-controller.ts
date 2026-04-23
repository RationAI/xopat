import { ViewerSelectionState } from "./viewer-selection-state";

export class ApplicationLifecycleController {
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
        try {
            await this.appContext.Scripting.initialize();

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

            const pluginKeys = this.appContext.AppCookies.get("_plugins", "").split(",") || [];
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

            const event = {
                data,
                background,
                visualizations
            };
            await VIEWER_MANAGER.raiseEventAwaiting("before-app-init", event).catch((e: any) => {
                console.error(e);
            });
            await this.appContext.openViewerWith(event.data, event.background || [], event.visualizations || []);
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
        const previousActiveViz = this.cloneRuntimeState(
            ViewerSelectionState.normalizeSelectionValue(this.appContext.getOption("activeVisualizationIndex", undefined, true, true))
        );

        const currentData = [...previousData];
        if (newData.length > 0) {
            currentData.push(...newData);
        }

        let vizSpec = activeVizIndex;
        if (vizSpec === undefined) {
            vizSpec = this.appContext.getOption("activeVisualizationIndex", 0, true, true);
        }

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
