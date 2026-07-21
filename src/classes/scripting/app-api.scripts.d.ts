import type {ScriptApiObject} from "../scripting-manager";
import type {AllowedScriptApiManifest} from "./abstract-types";
import type {VisualizationShaderGroupOrLayer} from "./visualization-api.scripts";

export type ViewerContextId = string;

export interface GlobalContextInfo {
    contextId: ViewerContextId;

    /**
     * The explicit operator-set slide name, or the neutral contextId when none is set. Never a
     * filename — raw paths / filenames are identifying and live in the `patient` namespace.
     */
    imageName: string;

    background?: {
        id?: string | null;
        name?: string | null;
        dataReference?: number | null;
    } | null;

    visualization?: {
        index?: number | null;
        name?: string | null;
        goalIndex?: number | null;
        shaders?: Record<string, VisualizationShaderGroupOrLayer>;
    } | null;

    worldItems?: Array<{
        worldIndex: number;
        kind: "background" | "visualization" | "unknown";
        dataReference?: number | null;
        backgroundId?: string | null;
        visualizationName?: string | null;
    }>;
}

export interface ScriptProjectInfo {
    // todo some useful script api
}

/**
 * A bounded slice of a stored script result. `slice` is the serialized JSON text
 * fragment of the addressed value (raw text when the addressed value is a string);
 * `truncated` is true when more characters remain outside the returned window.
 */
export interface StoredResultSlice {
    slice: string;
    totalChars: number;
    offset: number;
    truncated: boolean;
}

export interface ApplicationScriptApi extends ScriptApiObject {
    /**
     * Returns the number of active context windows (slides) currently open.
     */
    getContextCount(): number;

    /**
     * Provides metadata for all open contexts.
     */
    getGlobalInfo(): GlobalContextInfo[];

    /**
     * Directs subsequent viewer or annotations calls in this script context to a specific window.
     */
    setActiveViewer(contextId: ViewerContextId): void;

    /**
     * Returns details about the current project.
     */
    getProjectInfo(): ScriptProjectInfo;

    /**
     * Returns the detailed manifest (method signatures, parameters, return types and
     * TypeScript declarations) for the requested scripting namespace, or for all
     * currently-available namespaces when called without an argument. Use this to
     * discover the full signatures of a namespace before calling its methods — the
     * set of available namespaces can change while the application is running.
     */
    describeScriptingApi(namespace?: string): AllowedScriptApiManifest;

    /**
     * Reads back a large script result that the runtime replaced with a stored-result
     * handle (a marker like `res-…` embedded in a truncation notice). Returns a bounded
     * slice of the stored value: `path` addresses into the structure with dotted or
     * bracketed segments (e.g. "items[3].name"), `offset` and `maxChars` window the
     * serialized JSON text of the addressed value. Prefer a targeted `path` slice over
     * sequential offset reads. Handles are session-scoped and may be evicted.
     */
    readScriptResult(handle: string, options?: { path?: string; offset?: number; maxChars?: number }): StoredResultSlice;
}
