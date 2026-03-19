import type {ScriptApiMetadata} from "./abstract-types";
import type {ApplicationScriptApi, GlobalContextInfo, ViewerContextId, ScriptProjectInfo} from "./app-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";

export class XOpatApplicationScriptApi extends XOpatScriptingApi implements ApplicationScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatApplicationScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: async () => {
                const res = await fetch(APPLICATION_CONTEXT.url + "src/classes/scripting/app-api.scripts.d.ts");
                if (!res.ok) throw new Error("Failed to load viewer-api.scripts.d.ts");
                return await res.text();
            }
        }
    };

    constructor(namespace: string) {
        super(namespace, "Application Interface", "Manage viewer contexts and application-level metadata.");
    }

    getContextCount(): number {
        return VIEWER_MANAGER?.viewers?.length || 0;
    }

    getGlobalInfo(): GlobalContextInfo[] {
        const viewers = VIEWER_MANAGER?.viewers || [];
        const config = APPLICATION_CONTEXT?.config;

        return viewers.map((viewer: OpenSeadragon.Viewer) => {
            const contextId = viewer.uniqueId;
            let imageName = "";
            let serverPath: string | null = null;

            const firstItem =
                viewer.world && viewer.world.getItemCount() > 0
                    ? viewer.world.getItemAt(0)
                    : null;

            const bgConfig = firstItem?.getConfig?.("background");
            const dataRef = bgConfig?.dataReference;

            if (typeof bgConfig?.name === "string" && bgConfig.name) {
                imageName = bgConfig.name;
            } else if (typeof dataRef === "number") {
                const rawPath = config?.data?.[dataRef];
                if (typeof rawPath === "string") {
                    serverPath = rawPath;
                    imageName = UTILITIES.fileNameFromPath(rawPath, true);
                }
            }

            if (!serverPath) {
                const itemConfig = firstItem?.getConfig?.();
                const rawPath =
                    (typeof itemConfig?.dataReference === "number"
                        ? config?.data?.[itemConfig.dataReference]
                        : undefined) ||
                    firstItem?.source?.url ||
                    null;

                serverPath = typeof rawPath === "string" ? rawPath : null;
            }

            if (!imageName) {
                imageName = serverPath
                    ? UTILITIES.fileNameFromPath(serverPath, true)
                    : contextId;
            }

            const activeVizIndex =
                APPLICATION_CONTEXT.getOption("activeVisualizationIndex", undefined, true, true)?.[0] ?? null;
            const activeViz =
                activeVizIndex != null ? config?.visualizations?.[activeVizIndex] : null;

            const worldItems = [];
            const itemCount = viewer.world?.getItemCount?.() ?? 0;

            for (let i = 0; i < itemCount; i++) {
                const item = viewer.world.getItemAt(i);
                const itemBg = item?.getConfig?.("background");
                const itemViz = item?.getConfig?.("visualization");

                let itemDataRef: number | null = null;
                let kind: "background" | "visualization" | "unknown" = "unknown";

                if (itemBg) {
                    kind = "background";
                    itemDataRef = typeof itemBg.dataReference === "number" ? itemBg.dataReference : null;
                } else if (itemViz) {
                    kind = "visualization";
                }

                worldItems.push({
                    worldIndex: i,
                    kind,
                    dataReference: itemDataRef,
                    dataPath: itemDataRef != null ? config?.data?.[itemDataRef] ?? null : null,
                    backgroundId: itemBg?.id ?? null,
                    visualizationName: itemViz?.name ?? null,
                });
            }

            return {
                contextId,
                imageName,
                serverPath,
                sessionName: APPLICATION_CONTEXT.sessionName ?? null,
                background: bgConfig ? {
                    id: bgConfig.id ?? null,
                    name: bgConfig.name ?? null,
                    dataReference: typeof bgConfig.dataReference === "number" ? bgConfig.dataReference : null,
                    dataPath: typeof bgConfig.dataReference === "number"
                        ? config?.data?.[bgConfig.dataReference] ?? null
                        : null,
                } : null,
                visualization: activeViz ? {
                    index: activeVizIndex,
                    name: activeViz.name ?? null,
                    goalIndex: activeViz.goalIndex,
                    shaders: Object.entries(activeViz.shaders || {}).map(([id, shader]: [string, any]) => ({
                        id: shader?.id ?? id,
                        name: shader?.name,
                        type: shader?.type,
                        dataReferences: shader?.dataReferences,
                        tiledImages: shader?.tiledImages,
                    })),
                } : null,
                worldItems,
            };
        });
    }

    setActiveViewer(contextId: ViewerContextId): void {
        const viewer = (VIEWER_MANAGER?.viewers || []).find(
            (v: OpenSeadragon.Viewer) => v.uniqueId === contextId
        );

        if (!viewer) {
            throw new Error(`Unknown contextId '${contextId}'.`);
        }

        VIEWER_MANAGER.setActive(viewer);
    }

    getProjectInfo(): ScriptProjectInfo {
        return { };
    }
}