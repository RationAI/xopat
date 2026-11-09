/// <reference path="../../../src/types/globals.d.ts" />
/**
 * `actions` scripting namespace — how an assistant creates, inspects and repairs
 * the user's persistent actions. It never saves on its own authority: every
 * create/change of executable content goes through the module's approval
 * dialog, and the user's decision is what the call returns.
 */

const ACTIONS_DTS = `
export type ActionSurface = "quick" | "tools" | "context-menu" | "viewer-control" | "shortcut";

export type ActionPlacement = {
    /**
     * quick = icon button in the top bar (pinnable quick action),
     * tools = row in the Tools menu, context-menu = item under "My actions" on canvas right-click,
     * viewer-control = button in each viewer's control strip, shortcut = keyboard shortcut.
     */
    surface: ActionSurface;
    /** quick only: pin into the top bar right away. */
    pinned?: boolean;
    /** context-menu only: "selection" shows the item only when annotations are selected. */
    when?: "always" | "selection";
    /** shortcut only: one combo, modifiers + KeyboardEvent.code, e.g. "Alt+KeyC", "Shift+Digit1". */
    combo?: string;
};

export type ActionSpec = {
    /** Stable id, [a-z0-9-], max 48 chars. Reusing an id of a user action replaces (repairs) it. */
    id: string;
    /** Button text, max 80 chars, in the user's language. */
    label: string;
    description?: string;
    /** Phosphor icon class, e.g. "ph-chart-bar". */
    icon?: string;
    /**
     * Script body, the same language as run_viewer_script (namespaces as globals, top-level await,
     * must \`return\` its result). It runs later, on click, in a fresh context:
     *  - read the trigger from the read-only global \`input\`:
     *    { trigger, actionId, viewerId, position?: {x,y} image px, viewportPosition?, selection?: [{id, incrementId}] }
     *    (position/selection only for context-menu runs);
     *  - the viewer that was clicked/focused is already bound — do NOT call application.setActiveViewer;
     *  - return value is shown to the user: short text -> notification; flat object -> key/value table;
     *    array of flat objects -> table; longer string -> rendered as markdown.
     */
    script: string;
    placements: ActionPlacement[];
    /** How the result is shown. Default "auto". */
    output?: "auto" | "toast" | "window" | "silent";
    /** Run time limit, ms (default 600000 = 10 min, capped by the deployment). */
    timeoutMs?: number;
    enabled?: boolean;
};

export type ActionRun = {
    atIso: string;
    ok: boolean;
    durationMs: number;
    trigger: string;
    /** Error message of a failed run — start a repair here. */
    error?: string;
    /** Bounded preview of the returned value. */
    resultPreview?: string;
};

export type ActionSummary = {
    id: string;
    label: string;
    /** "deployment" actions are provided by the operator and read-only. */
    source: "deployment" | "user";
    origin?: "user" | "assistant";
    enabled: boolean;
    /** False until the user approved the current revision; unapproved actions are not shown or run. */
    approved: boolean;
    surfaces: ActionSurface[];
    shortcut?: string;
    /** Combos the shortcut lost to other shortcuts (the user can remap it in the Keymap panel). */
    shortcutConflicts?: string[];
    lastRun?: ActionRun;
};

export type ActionDetail = ActionSummary & {
    spec: ActionSpec;
    runs: ActionRun[];
};

export type ActionValidation = {
    ok: boolean;
    errors: Array<{ field: string; code: string; message: string }>;
    /** Namespaces the script references (static scan). */
    referencedNamespaces: string[];
    /** Referenced names that are not available namespaces — usually a typo or a missing module. */
    unknownNamespaces: string[];
    /** False when the script does not parse. */
    compiles: boolean;
    /** Set when a requested shortcut combo is already bound to something else. */
    shortcutConflict?: string;
};

export type ActionProposalResult = {
    /** approved = saved and live; declined = nothing changed; invalid = fix \`errors\` and propose again. */
    status: "approved" | "declined" | "invalid";
    id?: string;
    revision?: number;
    /** True when the user edited the script in the review before approving. */
    editedByUser?: boolean;
    errors?: ActionValidation["errors"];
};

export type ActionRunResult = { ok: true; result: unknown; durationMs: number } | { ok: false; error: string; durationMs: number };

export interface ActionsScriptApi {
    /** All actions (deployment + user), compact. */
    listActions(): ActionSummary[];
    /** One action with its script and the last runs (errors included) — read this before repairing. */
    getAction(id: string): ActionDetail;
    /** Check a spec without side effects: schema, syntax, namespaces, shortcut conflicts. */
    validateAction(spec: ActionSpec): ActionValidation;
    /**
     * Ask the user to save (or repair, when the id exists) an action. Opens a review dialog;
     * resolves with the user's decision. Test the script with run_viewer_script first.
     */
    proposeAction(spec: ActionSpec): Promise<ActionProposalResult>;
    /** Run an approved, enabled action now (as if clicked) and return its result. */
    runAction(id: string): Promise<ActionRunResult>;
    /** Enable or disable a user action (no approval needed). */
    setActionEnabled(id: string, enabled: boolean): Promise<boolean>;
    /** Delete a user action; asks the user to confirm. */
    deleteAction(id: string): Promise<boolean>;
}
`;

export function registerActionsScriptingApi(getModule: () => any): void {
    const ScriptingManager = (globalThis as any).ScriptingManager;
    if (!ScriptingManager?.registerExternalApi || !ScriptingManager?.XOpatScriptingApi) {
        console.warn("[user-actions] ScriptingManager unavailable; scripting namespace not registered.");
        return;
    }
    const ScriptApiBase = ScriptingManager.XOpatScriptingApi as {
        new (namespace: string, name: string, description: string): any;
    };

    class XOpatActionsScriptApi extends ScriptApiBase {
        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: ACTIONS_DTS },
            assistant: {
                promptTier: "compact",
                intentPatterns: [
                    /\b(shortcut|hotkey|quick ?action|automat\w*|macro|my actions?)\b/i,
                    /\b(create|make|add|save|build|write|give)\b[^.?!]{0,60}\b(actions?|buttons?|shortcuts?|hotkeys?|macros?)\b/i,
                    /\b(button|menu item|context menu|right[- ]click)\b.*\b(add|make|create|save|keep|put)\b/i,
                    /\b(add|make|create|save|keep|put)\b.*\b(button|menu item|context menu|right[- ]click|shortcut)\b/i,
                    /\b(fix|repair|broken|fails?|failing|not working)\b.*\b(action|button|shortcut)\b/i,
                ],
                framing:
                    "The user can keep a script as a persistent action (top-bar button, Tools row, right-click item, " +
                    "viewer control or keyboard shortcut) through the `actions` namespace. Recipe: (1) write and test the " +
                    "script with run_viewer_script until it returns the right value; (2) actions.validateAction(spec); " +
                    "(3) actions.proposeAction(spec) — the user reviews and approves it; (4) when approved, " +
                    "`return await actions.runAction(id)` and report from THAT result, not from expectation. " +
                    "To repair: actions.getAction(id) shows the script and the last run errors; fix, test, then propose " +
                    "with the SAME id. Deployment actions are read-only — propose a copy under a new id. " +
                    "Creating an action needs NO interface work: where it appears is the `placements` field of the spec, " +
                    "and proposeAction opens the only dialog involved. Do not use the `ui` namespace to look for, open " +
                    "or click menus, settings or panels while authoring an action. If the user did not say where they " +
                    "want it, use placements [{ surface: 'quick', pinned: true }].",
                guidance:
                    "Action scripts run later, on click, in a fresh context: the clicked/focused viewer is already bound, " +
                    "the trigger arrives in the read-only global `input`, and the return value is what the user sees " +
                    "(never call application.setActiveViewer in an action script — viewer ids from this chat do not " +
                    "exist there; where the data offers a readable name, e.g. a preset name, return it rather than the numeric id) " +
                    "(a flat object becomes a key/value table, an array of flat objects a table). Keep labels short and " +
                    "in the user's language. Never claim an action was saved unless proposeAction returned 'approved'.",
                examples: [
                    "Count annotations per class as a top-bar button: `await actions.proposeAction({ id: 'count-per-class', " +
                    "label: 'Count by class', icon: 'ph-chart-bar', placements: [{ surface: 'quick', pinned: true }], " +
                    "script: \"const names = Object.fromEntries((await annotationsRead.getPresets()).map(p => [p.presetID, " +
                    "p.meta?.category?.value || p.presetID])); const counts = {}; for (const a of await annotationsRead.getAnnotations()) " +
                    "{ const k = names[a.presetID] || 'unassigned'; counts[k] = (counts[k] || 0) + 1; } return counts;\" })`",
                ],
            },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "Actions",
                "Create, inspect, run and repair the user's persistent actions: saved scripts mounted as a top-bar " +
                "button, Tools row, canvas right-click item, viewer control or keyboard shortcut. Saving always asks " +
                "the user to approve. Test the script with run_viewer_script first, then validateAction, then " +
                "proposeAction. To repair, getAction(id) returns the script and the last run errors.",
            );
        }

        isAvailable(): boolean {
            try { return !!getModule()?.assistantAuthoringAvailable(); } catch (_) { return false; }
        }

        _module(): any {
            const module = getModule();
            if (!module) throw new Error("The user-actions module is not available.");
            return module;
        }

        listActions(): unknown {
            return this._module().describeActions();
        }

        getAction(id: string): unknown {
            return this._module().describeAction(String(id));
        }

        validateAction(spec: unknown): unknown {
            return this._module().validateProposal(spec);
        }

        async proposeAction(spec: unknown): Promise<unknown> {
            return await this._module().propose(spec, "assistant");
        }

        async runAction(id: string): Promise<unknown> {
            const ctx = this.scriptingContext;
            return await this._module().runFromAssistant(String(id),
                () => (typeof ctx?.mayExposeSensitiveData === "function" ? ctx.mayExposeSensitiveData() : true));
        }

        async setActionEnabled(id: string, enabled: boolean): Promise<boolean> {
            return await this._module().setEnabled(String(id), enabled === true);
        }

        async deleteAction(id: string): Promise<boolean> {
            const module = this._module();
            const action = module.store.get(String(id));
            if (!action || action.source !== "user") throw new Error(`No user action '${id}'.`);
            await this.requireActionConsent({
                title: module.t("consent.deleteTitle"),
                description: module.t("consent.deleteDescription", { label: action.label }),
                mode: "warning",
                confirmLabel: module.t("panel.delete"),
                rejectedMessage: "The user declined deleting the action.",
            });
            return await module.removeAction(String(id));
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatActionsScriptApi("actions")),
        { label: "actions" },
    );
}
