import type {ScriptApiObject} from "../scripting-manager";
import type {AllowedScriptApiManifest} from "./abstract-types";
import type {VisualizationShaderGroupOrLayer} from "./visualization-api.scripts";

export type ViewerContextId = string;

export interface GlobalContextInfo {
    contextId: ViewerContextId;
    imageName: string;
    serverPath: string | null;

    sessionName?: string | null;

    background?: {
        id?: string | null;
        name?: string | null;
        dataReference?: number | null;
        dataPath?: string | null;
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
        dataPath?: string | null;
        backgroundId?: string | null;
        visualizationName?: string | null;
    }>;
}

export interface ScriptProjectInfo {
    // todo some useful script api
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
}
