import type {ScriptApiMetadata, AllowedScriptApiManifest} from "./abstract-types";
import type {ApplicationScriptApi, GlobalContextInfo, ViewerContextId, ScriptProjectInfo} from "./app-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";
import { ViewerSelectionState } from "../app/viewer-selection-state";

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
        super(namespace, "Application Interface", "Manage viewer contexts and application-level metadata for the current script context.");
    }

    getContextCount(): number {
        return VIEWER_MANAGER?.viewers?.length || 0;
    }

    getGlobalInfo(): GlobalContextInfo[] {
        const viewers = VIEWER_MANAGER?.viewers || [];
        const config = APPLICATION_CONTEXT?.config;

        return viewers.map((viewer: OpenSeadragon.Viewer) => {
            const contextId = viewer.uniqueId;

            const firstItem =
                viewer.scalebar?.getReferencedTiledImage?.() ||
                (viewer.world && viewer.world.getItemCount() > 0
                    ? viewer.world.getItemAt(0)
                    : null);

            const bgConfig = firstItem?.getConfig?.("background");

            // Only the explicit operator-set name is used here. Filenames are
            // identifying (they routinely embed patient ids / case numbers), so
            // when no explicit name is set we fall back to the neutral contextId.
            // The raw path / filename lives in the isolated `patient` namespace
            // (patient.getSlidePaths()), never here.
            const imageName =
                (typeof bgConfig?.name === "string" && bgConfig.name) ? bgConfig.name : contextId;

            const activeVizIndex =
                ViewerSelectionState.getViewerVisualizationIndex(
                    viewer,
                    APPLICATION_CONTEXT
                ) ?? null;
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
                    backgroundId: itemBg?.id ?? null,
                    visualizationName: itemViz?.name ?? null,
                });
            }

            // Raw paths (serverPath / dataPath), the filename, and sessionName are
            // identifying and deliberately omitted here — they live in the isolated
            // `patient` namespace (patient.getSlidePaths()).
            return {
                contextId,
                imageName,
                background: bgConfig ? {
                    id: bgConfig.id ?? null,
                    name: bgConfig.name ?? null,
                    dataReference: typeof bgConfig.dataReference === "number" ? bgConfig.dataReference : null,
                } : null,
                visualization: activeViz ? {
                    index: activeVizIndex,
                    name: activeViz.name ?? null,
                    goalIndex: activeViz.goalIndex,
                    shaders: activeViz.shaders || {},
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

        this.scriptingContext.setActiveViewerContextId(contextId);
    }

    getProjectInfo(): ScriptProjectInfo {
        return { };
    }

    describeScriptingApi(namespace?: string): AllowedScriptApiManifest {
        const manager = APPLICATION_CONTEXT?.Scripting;
        if (!manager?.getAllowedApiManifest) return { namespaces: [] };
        return manager.getAllowedApiManifest(namespace ? [namespace] : undefined) || { namespaces: [] };
    }
}
