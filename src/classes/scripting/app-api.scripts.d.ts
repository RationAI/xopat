import type {ScriptApiObject} from "../scripting-manager";

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
        shaders?: Array<{
            id?: string;
            name?: string;
            type?: string;
            dataReferences?: number[];
            tiledImages?: number[];
        }>;
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
     * Directs subsequent viewer or annotations calls to a specific window.
     */
    setActiveViewer(contextId: ViewerContextId): void;

    /**
     * Returns details about the current project.
     */
    getProjectInfo(): ScriptProjectInfo;
}