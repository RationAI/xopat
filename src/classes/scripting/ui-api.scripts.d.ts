import type {ScriptApiObject} from "../scripting-manager";
import type {ViewerContextId} from "./app-api.scripts";

/**
 * One reachable piece of the viewer UI.
 *
 * Ids are stable and prefixed by where the element lives:
 * - `appbar:<menu>` top app-bar menus and header buttons (`appbar:view`, `appbar:settings`, ...),
 *   `appbar:<menu>/<row>` rows inside them;
 * - `fullscreen:<panel>` fullscreen panels (`fullscreen:settings-menu`, `fullscreen:keymap-menu`,
 *   plugin panels), `fullscreen:<panel>/<tab>` their sub-tabs;
 * - `viewer-tab:<tab>` side panels of a viewer (`viewer-tab:navigator`, `viewer-tab:shaders`, plugin panels);
 * - `dock:<tab>` tabs of the global dock;
 * - `toolbar:<toolbar>` toolbars, `toolbar:<toolbar>/<button>` their buttons;
 * - `action:<key>` app-bar actions and view toggles;
 * - `shortcut:<id>` keyboard shortcuts (grouped under `shortcut:all`).
 */
export interface UiElementInfo {
    id: string;
    kind: "menu" | "panel" | "tab" | "toolbar" | "item" | "action" | "shortcut" | "group";
    /** Text the user sees, in the user's language. Quote it when guiding the user. */
    label: string;
    hint?: string;
    /** Owning plugin/module id, when known. */
    owner?: string;
    /** Id of the element that must be open for this one to be reachable. */
    parent?: string;
    /** Labels of the ancestors, outermost first — the click path for the user. */
    path: string[];
    /** Exists once per viewer; operations act on the given (or active) viewer. */
    viewerScoped?: boolean;
    state: { open?: boolean; selected?: boolean; disabled?: boolean; hidden?: boolean };
    /** Key combination that triggers it, e.g. "Ctrl+Z". */
    shortcut?: string;
    /** Number of child elements; list them with `listUi({ parent: id })`. */
    children?: number;
    /** Operations this element supports. */
    ops: Array<"open" | "close" | "invoke" | "show">;
}

export interface UiListFilter {
    /** Words matched (all of them, case-insensitive) against id, label, hint, owner and path. */
    query?: string;
    /** Direct children of this element id. */
    parent?: string;
    kind?: UiElementInfo["kind"];
    owner?: string;
    /** Viewer whose side panels to list; defaults to the active viewer. */
    viewerId?: ViewerContextId;
    /** Maximum number of returned items, default 80. */
    limit?: number;
}

export interface UiListResult {
    items: UiElementInfo[];
    total: number;
    truncated: boolean;
}

export interface UiTargetOptions {
    /** Target viewer for viewer-scoped elements; defaults to the active viewer. */
    viewerId?: ViewerContextId;
}

export interface UiShowOptions extends UiTargetOptions {
    /** Short plain-text explanation shown next to the highlighted element. Defaults to its label. */
    message?: string;
}

export interface UiShowResult {
    shown: boolean;
    /** Id of the element actually highlighted — an ancestor when the element itself is not on screen. */
    target?: string;
    reason?: string;
}

export interface UiScriptApi extends ScriptApiObject {
    /**
     * Explore the UI. Without a filter returns the top-level elements; drill down with
     * `{ parent: id }`, or search everything with `{ query: "..." }`. Never assume a menu,
     * panel or button exists — list it first.
     */
    listUi(filter?: UiListFilter): UiListResult;

    /**
     * Details of one element plus its direct children.
     */
    describeUi(id: string, options?: UiTargetOptions): UiElementInfo & { children: UiElementInfo[] };

    /**
     * What is open right now: panels, menus, side panels, dock tabs and visible toolbars.
     */
    getUiState(options?: UiTargetOptions): { open: UiElementInfo[] };

    /**
     * Open a menu, panel, tab or toolbar for the user (its parents are opened first).
     * Opening an already-open element does nothing. Returns the element's new state.
     */
    openUi(id: string, options?: UiTargetOptions): Promise<UiElementInfo>;

    /**
     * Close a menu, panel, tab or toolbar.
     */
    closeUi(id: string, options?: UiTargetOptions): UiElementInfo;

    /**
     * Point the user at an element: opens its parents, then highlights it with a short
     * explanation the user dismisses. Use this to teach the user where something is.
     */
    showUi(id: string, options?: UiShowOptions): Promise<UiShowResult>;

    /**
     * Trigger an element's action (a menu row, toolbar button, app-bar action, quick shortcut),
     * as if the user clicked it. The user is asked to confirm. Only for actions the user asked for.
     */
    invokeUiAction(id: string, options?: UiTargetOptions): Promise<{ invoked: boolean }>;
}
