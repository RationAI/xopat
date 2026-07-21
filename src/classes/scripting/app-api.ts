import type {ScriptApiMetadata, AllowedScriptApiManifest, StoredResultSlice} from "./abstract-types";
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

        // Viewer ids/names may be aliased for this context (e.g. chat → LLM sees opaque
        // handles). Identity when no alias installed. `present` maps a real id → handle.
        const present = (id: string | null | undefined): string | null =>
            id != null ? this.scriptingContext.toPresentedViewerId?.(id) ?? id : null;

        return viewers.map((viewer: OpenSeadragon.Viewer) => {
            const realContextId = viewer.uniqueId;
            const contextId = present(realContextId) as string;

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
            // `presentViewerName` lets an aliasing consumer (chat/full mode) mask even the
            // operator name to the handle; identity otherwise.
            const rawImageName =
                (typeof bgConfig?.name === "string" && bgConfig.name) ? bgConfig.name : contextId;
            const imageName =
                this.scriptingContext.presentViewerName?.(realContextId, rawImageName) ?? rawImageName;

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
                    backgroundId: present(itemBg?.id ?? null),
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
                    id: present(bgConfig.id ?? null),
                    name: this.scriptingContext.presentViewerName?.(realContextId, bgConfig.name ?? null)
                        ?? (bgConfig.name ?? null),
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
        // The model may pass an opaque handle; translate handle → real id before matching,
        // and store the real id internally (identity when no alias is installed).
        const realId = this.scriptingContext.toInternalViewerId?.(contextId) ?? contextId;
        const viewer = (VIEWER_MANAGER?.viewers || []).find(
            (v: OpenSeadragon.Viewer) => v.uniqueId === realId
        );

        if (!viewer) {
            // Echo the id the caller gave (the handle) so the model can self-correct.
            throw new Error(`Unknown contextId '${contextId}'.`);
        }

        this.scriptingContext.setActiveViewerContextId(realId);
    }

    getProjectInfo(): ScriptProjectInfo {
        return { };
    }

    describeScriptingApi(namespace?: string): AllowedScriptApiManifest {
        const manager = APPLICATION_CONTEXT?.Scripting;
        if (!manager?.getAllowedApiManifest) return { namespaces: [] };
        return manager.getAllowedApiManifest(namespace ? [namespace] : undefined) || { namespaces: [] };
    }

    readScriptResult(
        handle: string,
        options?: { path?: string; offset?: number; maxChars?: number }
    ): StoredResultSlice {
        const read = this.scriptingContext.readStoredResult?.bind(this.scriptingContext);
        if (!read) {
            throw new Error("Stored results are not available in this scripting context.");
        }
        const result = read(handle, options);
        if (!result) {
            throw new Error(`Unknown result handle '${handle}'. Handles are session-scoped and may have been evicted.`);
        }
        return result;
    }
}
