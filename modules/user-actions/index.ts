/// <reference path="../../src/types/globals.d.ts" />
/**
 * user-actions — persistent, script-backed shortcuts and automations.
 *
 * One schema, three producers: the deployment (static ENV, trusted, works with no
 * model at all), the user (panel editor), and the assistant (`actions` scripting
 * namespace). Every user-side change of executable content is approved by the user
 * before it can mount or run. See README.md.
 */
import { ActionStore, RunRecord } from "./store";
import { ActionRunner, RunOutcome, Trigger } from "./runner";
import { SurfaceMounter, OWNER, shortcutIdOf } from "./surfaces";
import {
    ActionLimits, ActionSpec, AnyAction, DEFAULT_LIMITS, SURFACES, Surface, UserAction,
    isApproved, isPlainObject, toSpec, isValidCombo,
} from "./schema";
import { escapeHtml, presentResult } from "./output";
import { buildPanel, openEditor, PanelHost } from "./ui/panel";
import { confirmDialog, requestApproval } from "./ui/approve";
import { registerActionsScriptingApi } from "./scripting/api";

const g = () => globalThis as any;
const PANEL_SUB_ID = "manage";
const EXPORT_VERSION = 1;

type ProposalOrigin = "user" | "assistant" | "import";

/** XOpatElement members this module uses (the ambient base type does not declare them). */
interface UserActions {
    readonly id: string;
    readonly uid: string;
    readonly cache: { get(key: string): unknown; set(key: string, value: unknown): void } | undefined;
    t(key: string, options?: Record<string, unknown>): string;
    can(capabilityId: string): boolean;
    onCapabilityChange(capabilityId: string, handler: (enabled: boolean) => void): () => void;
    getStaticMeta(key: string, defaultValue?: unknown): any;
    loadLocale(locale?: string, data?: unknown): Promise<unknown>;
}

class UserActions extends XOpatModuleSingleton {
    readonly store: ActionStore;
    readonly runner: ActionRunner;
    private readonly mounter: SurfaceMounter;
    private readonly limits: ActionLimits;
    private readonly allowUser: boolean;
    private readonly allowAssistant: boolean;
    private readonly log: any;
    private _windows = new Map<string, any>();
    private _pinnedOnce: Set<string>;
    private _panelBuilt = false;
    private _ready: Promise<void>;

    constructor() {
        super();
        const ctx = g().APPLICATION_CONTEXT;
        this.log = ctx?.log?.(`module.${OWNER}`) || console;

        // Deployment policy: getStaticMeta only — never session-controllable config (§7).
        const surfaces = this.getStaticMeta("surfaces", SURFACES);
        this.limits = {
            maxScriptBytes: positive(this.getStaticMeta("maxScriptBytes"), DEFAULT_LIMITS.maxScriptBytes),
            maxTimeoutMs: positive(this.getStaticMeta("maxTimeoutMs"), DEFAULT_LIMITS.maxTimeoutMs),
            surfaces: Array.isArray(surfaces) ? SURFACES.filter(s => surfaces.includes(s)) : [...SURFACES],
        };
        this.allowUser = this.getStaticMeta("allowUserActions", true) !== false;
        this.allowAssistant = this.allowUser && this.getStaticMeta("allowAssistantAuthoring", true) !== false;

        let kv: any = null;
        if (this.allowUser) {
            try {
                kv = g().IO_PIPELINE?.kv?.(this.uid, "kv:actions", { sync: false })?.deploymentScoped?.() || null;
            } catch (e) {
                this.log.warn("kv:actions unavailable; user actions will not persist", e);
            }
        }
        this.store = new ActionStore(kv, this.limits,
            positive(this.getStaticMeta("maxActions"), 50), { warn: (m, d) => this.log.warn(m, d) });
        this.runner = new ActionRunner((id, run) => { void this.store.recordRun(id, run); });

        let pinned: unknown = [];
        try { pinned = this.cache?.get?.("pinned-once"); } catch (_) { /* storage blocked */ }
        this._pinnedOnce = new Set(Array.isArray(pinned) ? pinned.filter(x => typeof x === "string") : []);

        this.mounter = new SurfaceMounter({
            t: (key, options) => this.t(key, options),
            invoke: (action, trigger, viewer, extra) => { void this.invoke(action, trigger, viewer, extra); },
            canRun: () => this.can("user-actions.run"),
            claimFirstPin: (id) => this._claimFirstPin(id),
            warn: (m, d) => this.log.warn(m, d),
        });

        this._ready = this._init().catch(e => this.log.error?.("init failed", e));
    }

    /** Resolves once actions are loaded and mounted. */
    whenReady(): Promise<void> {
        return this._ready;
    }

    private async _init(): Promise<void> {
        await this.loadLocale().catch(() => this.loadLocale("en")).catch((e: unknown) => this.log.warn("locale load failed", e));
        this.store.loadDeployment(this.getStaticMeta("actions"), g().$?.i18n?.language);
        if (this.allowUser) await this.store.loadUser();

        const sync = () => {
            this.mounter.sync(this.store.list());
            this._ensurePanel();
        };
        this.store.onChange(sync);
        this.onCapabilityChange("user-actions.run", () => sync());
        this.onCapabilityChange("user-actions.author", () => sync());
        // UI registries may come up after this module; one re-sync after the first open is enough
        // because every registry replaces by id.
        g().VIEWER_MANAGER?.addHandler?.("after-open", () => sync());
        sync();
    }

    // ---- policy ----

    canAuthor(): boolean {
        return this.allowUser && this.can("user-actions.author");
    }

    assistantAuthoringAvailable(): boolean {
        return this.allowAssistant && this.canAuthor();
    }

    // ---- running ----

    async invoke(action: AnyAction, trigger: Trigger, viewer?: any, extra?: Record<string, unknown>): Promise<RunOutcome> {
        const outcome = await this._run(action, { trigger, viewer, extra });
        this._present(action, outcome);
        return outcome;
    }

    private async _run(action: AnyAction, request: Parameters<ActionRunner["run"]>[1]): Promise<RunOutcome> {
        if (!this.can("user-actions.run")) {
            return { ok: false, error: this.t("errors.runDenied"), durationMs: 0 };
        }
        const current = this.store.get(action.id);
        if (!current || !current.enabled || !isApproved(current)) {
            return { ok: false, error: this.t("errors.notRunnable"), durationMs: 0 };
        }
        return this.runner.run(current, request);
    }

    private _present(action: AnyAction, outcome: RunOutcome): void {
        const Dialogs = g().Dialogs;
        if (!outcome.ok) {
            if ((outcome as any).busy) {
                Dialogs?.show(escapeHtml(this.t("run.busy", { label: action.label })), 2500, Dialogs.MSG_WARN);
                return;
            }
            Dialogs?.show(escapeHtml(this.t("run.failed", { label: action.label, error: outcome.error })),
                8000, Dialogs.MSG_ERR, {
                    buttons: [{ label: this.t("run.details"), onClick: () => this.openPanel() }],
                });
            return;
        }
        const presentation = presentResult(outcome.result, action.output, {
            key: this.t("output.key"),
            value: this.t("output.value"),
            truncated: (shown, total) => this.t("output.truncated", { shown, total }),
        });
        switch (presentation.kind) {
            case "none":
                return;
            case "done":
                Dialogs?.show(escapeHtml(this.t("run.done", { label: action.label })), 2500, Dialogs.MSG_SUCCESS);
                return;
            case "toast":
                Dialogs?.show(`<b>${escapeHtml(action.label)}</b>: ${escapeHtml(presentation.text)}`, 6000, Dialogs.MSG_INFO);
                return;
            case "markdown":
                this._showWindow(action, presentation.text);
        }
    }

    private _showWindow(action: AnyAction, markdown: string): void {
        const UI = g().UI;
        let view: any = null;
        try {
            view = g().singletonModule?.("markdown")?.view?.(markdown);
        } catch (e) {
            this.log.warn("markdown module unavailable; showing plain text", e);
        }
        const body = view ? view.create() : Object.assign(document.createElement("pre"), { textContent: markdown });
        const host = document.createElement("div");
        host.className = "p-2 overflow-auto h-full";
        host.appendChild(body);

        const existing = this._windows.get(action.id);
        if (existing?.isOpened?.()) {
            existing.setBody(host);
            existing.focus?.();
            return;
        }
        if (!UI?.FloatingWindow) return;
        const win = new UI.FloatingWindow({
            id: `user-actions-result-${action.id}`,
            title: action.label,
            width: 420,
            height: 360,
            closable: true,
            onClose: () => this._windows.delete(action.id),
        }, host);
        this._windows.set(action.id, win);
        g().USER_INTERFACE?.addHtml?.(win, this.id);
    }

    async runFromAssistant(id: string, mayExposeSensitiveData: () => boolean): Promise<unknown> {
        const action = this.store.get(id);
        if (!action) throw new Error(`No action '${id}'.`);
        const outcome = await this._run(action, { trigger: "assistant", mayExposeSensitiveData });
        return outcome.ok
            ? { ok: true, result: outcome.result, durationMs: outcome.durationMs }
            : { ok: false, error: outcome.error, durationMs: outcome.durationMs };
    }

    // ---- authoring ----

    validateProposal(spec: unknown): any {
        const sanitized = isPlainObject(spec) ? toProposal(spec) : spec;
        const prepared = this.store.prepare(sanitized, "assistant");
        const script = typeof (sanitized as any)?.script === "string" ? (sanitized as any).script : "";
        const SM = g().ScriptingManager;
        const compile = SM?.validateScript?.(script);
        const known = this._knownNamespaces();
        const refs: Array<{ namespace: string }> = SM?.extractApiReferences?.(script, known) || [];
        const referenced = [...new Set(refs.map(r => r.namespace))];
        const unknown = scanUnknownNamespaces(script, known);
        const combo = (sanitized as any)?.placements?.find?.((p: any) => p?.surface === "shortcut")?.combo;
        const shortcutConflict = this._shortcutConflict(combo, (sanitized as any)?.id);
        const errors = prepared.ok ? [] : prepared.errors;
        if (compile && compile.ok === false) {
            errors.push({ field: "script", code: "syntax", message: compile.error?.message || "The script does not parse." });
        }
        // A viewer id written into the script is only valid in the context that saw it (the chat
        // presents per-conversation aliases); an action runs later in a fresh context with the
        // clicked viewer already bound, so a literal id fails there — or picks the wrong slide.
        if (/\bsetActiveViewer\s*\(\s*['"`]/.test(script)) {
            errors.push({
                field: "script",
                code: "fixedViewer",
                message: "Do not bind a fixed viewer id: the action runs on the viewer the user clicked, already bound. " +
                    "Remove the application.setActiveViewer(...) call from the action script.",
            });
        }
        return {
            ok: errors.length === 0,
            errors,
            referencedNamespaces: referenced,
            unknownNamespaces: unknown,
            compiles: compile ? compile.ok !== false : true,
            ...(shortcutConflict ? { shortcutConflict } : {}),
        };
    }

    /**
     * Create or repair a user action. Always shows the approval dialog (the assistant
     * and imports cannot save silently); resolves with the user's decision.
     */
    async propose(spec: unknown, origin: ProposalOrigin): Promise<any> {
        if (!this.canAuthor() || (origin === "assistant" && !this.allowAssistant)) {
            throw new Error(this.t("errors.authorDenied"));
        }
        const validation = this.validateProposal(spec);
        if (!validation.ok) return { status: "invalid", errors: validation.errors };

        const prepared = this.store.prepare(toProposal(spec as Record<string, unknown>),
            origin === "assistant" ? "assistant" : "user");
        if (!prepared.ok) return { status: "invalid", errors: prepared.errors };
        const previous = this.store.get(prepared.action.id) as UserAction | undefined;

        const decision = await requestApproval({
            t: (k, o) => this.t(k, o),
            proposed: toSpec(prepared.action),
            previous: previous ? toSpec(previous) : undefined,
            proposedBy: origin,
            referencedNamespaces: validation.referencedNamespaces,
            unknownNamespaces: validation.unknownNamespaces,
            shortcutConflict: validation.shortcutConflict,
        });
        if (!decision.approved) return { status: "declined", id: prepared.action.id };

        let action = prepared.action;
        const editedByUser = decision.script !== action.script;
        if (editedByUser) {
            // The user's resolved text is what they approved — re-validate it as such.
            const again = this.store.prepare({ ...toSpec(action), script: decision.script }, action.origin);
            if (!again.ok) return { status: "invalid", errors: again.errors };
            action = again.action;
        }
        const saved = await this.store.commit(action, true);
        return { status: "approved", id: saved.id, revision: saved.revision, editedByUser };
    }

    /** Re-approve a pending record (e.g. after import) — same dialog, no changes proposed. */
    async approve(id: string): Promise<void> {
        const action = this.store.get(id);
        if (!action || action.source !== "user" || !this.canAuthor()) return;
        const validation = this.validateProposal(toSpec(action));
        const decision = await requestApproval({
            t: (k, o) => this.t(k, o),
            proposed: toSpec(action),
            proposedBy: action.origin === "assistant" ? "assistant" : "import",
            referencedNamespaces: validation.referencedNamespaces,
            unknownNamespaces: validation.unknownNamespaces,
            shortcutConflict: validation.shortcutConflict,
        });
        if (decision.approved) await this.store.commit({ ...action, enabled: true }, true);
    }

    async setEnabled(id: string, enabled: boolean): Promise<boolean> {
        if (!this.canAuthor()) throw new Error(this.t("errors.authorDenied"));
        return this.store.setEnabled(id, enabled);
    }

    async removeAction(id: string): Promise<boolean> {
        if (!this.canAuthor()) throw new Error(this.t("errors.authorDenied"));
        return this.store.remove(id);
    }

    // ---- description (assistant + panel) ----

    describeActions(): any[] {
        return this.store.list().map(a => this._summary(a));
    }

    describeAction(id: string): any {
        const action = this.store.get(id);
        if (!action) {
            const ids = this.store.list().map(a => a.id);
            throw new Error(`No action '${id}'. Known: ${ids.join(", ") || "none"}.`);
        }
        return { ...this._summary(action), spec: toSpec(action), runs: this.store.runs(id).map(runInfo) };
    }

    private _summary(a: AnyAction): any {
        const shortcutPlacement = a.placements.find(p => p.surface === "shortcut");
        const state = shortcutPlacement ? this.mounter.shortcutState(a.id) : null;
        const last = this.store.lastRun(a.id);
        return {
            id: a.id,
            label: a.label,
            source: a.source,
            ...(a.source === "user" ? { origin: a.origin } : {}),
            enabled: a.enabled,
            approved: isApproved(a),
            surfaces: a.placements.map(p => p.surface),
            ...(shortcutPlacement ? { shortcut: state?.combo || shortcutPlacement.combo } : {}),
            ...(state?.suppressed?.length ? { shortcutConflicts: state.suppressed } : {}),
            ...(last ? { lastRun: runInfo(last) } : {}),
        };
    }

    // ---- panel ----

    openPanel(): void {
        this._ensurePanel(true);
        g().UI?.Services?.FullscreenMenus?.openSubmenu?.(this.id, PANEL_SUB_ID);
    }

    private _ensurePanel(force = false): void {
        if (this._panelBuilt) return;
        const menus = g().UI?.Services?.FullscreenMenus;
        if (!menus?.setMenu || !g().van) return;
        // Only worth a panel when there is something to manage or the user may author.
        if (!force && !this.canAuthor() && !this.store.list().length) return;
        this._panelBuilt = true;
        const body = buildPanel(this._panelHost());
        menus.setMenu(this.id, PANEL_SUB_ID, this.t("panel.title"), body, "ph-lightning", { chrome: "plain" });
        this.mounter.registerPanelEntry(() => this.openPanel());
    }

    private _panelHost(): PanelHost {
        return {
            t: (k, o) => this.t(k, o),
            list: () => this.store.list(),
            lastRun: (id) => this.store.lastRun(id),
            shortcutState: (id) => this.mounter.shortcutState(id),
            isRunning: (id) => this.runner.isRunning(id),
            canAuthor: () => this.canAuthor(),
            allowedSurfaces: () => [...this.limits.surfaces],
            onChange: (cb) => {
                const offStore = this.store.onChange(cb);
                const offRun = this.runner.onRunningChange(() => cb());
                return () => { offStore(); offRun(); };
            },
            run: (id) => {
                const action = this.store.get(id);
                if (action) void this.invoke(action, "panel");
            },
            save: async (spec, previousId) => {
                if (previousId && spec.id !== previousId) throw new Error(this.t("errors.idChanged"));
                const result = await this.propose(spec, "user");
                if (result.status === "invalid") {
                    throw new Error((result.errors || []).map((e: any) => `${e.field}: ${this.t(`errors.${e.code}`)}`).join("; "));
                }
            },
            approve: (id) => this.approve(id),
            setEnabled: async (id, enabled) => { await this.setEnabled(id, enabled); },
            remove: async (id) => {
                const action = this.store.get(id);
                if (!action) return;
                const ok = await confirmDialog(this.t("consent.deleteTitle"),
                    this.t("consent.deleteDescription", { label: action.label }),
                    this.t("panel.delete"), this.t("editor.cancel"));
                if (ok) await this.removeAction(id);
            },
            exportActions: (ids) => this._export(ids),
            importActions: () => this._import(),
        };
    }

    private _export(ids?: string[]): void {
        const actions = this.store.list()
            .filter(a => a.source === "user" && (!ids || ids.includes(a.id)))
            .map(a => toSpec(a));
        if (!actions.length) return;
        const payload = JSON.stringify({ format: "xopat-user-actions", version: EXPORT_VERSION, actions }, null, 2);
        const name = ids?.length === 1 ? `action-${ids[0]}.json` : "xopat-actions.json";
        g().UTILITIES?.downloadAsFile?.(name, payload);
    }

    /**
     * Local-file import. Records land DISABLED and UNAPPROVED: a file is someone
     * else's code until the user has read and approved it.
     */
    private _import(): void {
        if (!this.canAuthor()) return;
        const Dialogs = g().Dialogs;
        g().UTILITIES?.uploadFile?.(async (content: string | ArrayBuffer | Error) => {
            if (typeof content !== "string") {
                Dialogs?.show(escapeHtml(this.t("import.failed")), 4000, Dialogs.MSG_ERR);
                return;
            }
            let parsed: any;
            try { parsed = JSON.parse(content); } catch (_) {
                Dialogs?.show(escapeHtml(this.t("import.failed")), 4000, Dialogs.MSG_ERR);
                return;
            }
            const list = Array.isArray(parsed) ? parsed
                : (isPlainObject(parsed) && parsed.format === "xopat-user-actions" && Array.isArray(parsed.actions))
                    ? parsed.actions : [parsed];
            let imported = 0, rejected = 0;
            for (const entry of list.slice(0, 100)) {
                const prepared = isPlainObject(entry) ? this.store.prepare(toProposal(entry), "user") : null;
                if (!prepared || !prepared.ok) { rejected++; continue; }
                await this.store.commit({ ...prepared.action, enabled: false, approvedRevision: null }, false);
                imported++;
            }
            Dialogs?.show(escapeHtml(this.t("import.done", { imported, rejected })), 5000,
                rejected ? Dialogs.MSG_WARN : Dialogs.MSG_SUCCESS);
        }, "application/json,.json", "text");
    }

    // ---- helpers ----

    private _claimFirstPin(id: string): boolean {
        if (this._pinnedOnce.has(id)) return false;
        this._pinnedOnce.add(id);
        try { this.cache?.set?.("pinned-once", [...this._pinnedOnce]); } catch (_) { /* storage blocked */ }
        return true;
    }

    private _knownNamespaces(): string[] {
        const manager = g().APPLICATION_CONTEXT?.Scripting;
        const names = manager?.namespaces ? Object.keys(manager.namespaces) : [];
        return names.length ? names : [];
    }

    private _shortcutConflict(combo: unknown, ownId: unknown): string | undefined {
        if (!isValidCombo(combo)) return undefined;
        const shortcuts = g().APPLICATION_CONTEXT?.shortcuts;
        const exclude = typeof ownId === "string" ? shortcutIdOf(ownId) : undefined;
        const conflicts: any[] = shortcuts?.findConflicts?.(combo, exclude) || [];
        if (!conflicts.length) return undefined;
        return conflicts.map(c => {
            const spec = typeof c === "string" ? shortcuts?.list?.().find((s: any) => s.id === c) : c;
            const title = spec?.titleKey ? g().$?.t?.(spec.titleKey, spec.titleArgs) : undefined;
            return title || spec?.id || String(c);
        }).join(", ");
    }
}

/** Drop store bookkeeping a proposer may not set (origin/revision/approval are ours). */
function toProposal(spec: Record<string, unknown>): Record<string, unknown> {
    const { origin, createdAt, updatedAt, revision, approvedRevision, source, ...rest } = spec as any;
    return rest;
}

function positive(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function runInfo(run: RunRecord): any {
    return {
        atIso: new Date(run.at).toISOString(),
        ok: run.ok,
        durationMs: run.durationMs,
        trigger: run.trigger,
        ...(run.error ? { error: run.error } : {}),
        ...(run.resultPreview ? { resultPreview: run.resultPreview } : {}),
    };
}

/**
 * `foo.bar(` references whose `foo` is not a known namespace and not a local
 * binding/builtin we can recognise cheaply. Advisory only (shown in review).
 */
function scanUnknownNamespaces(script: string, known: string[]): string[] {
    if (!known.length) return [];
    const declared = new Set<string>();
    for (const m of script.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
    for (const m of script.matchAll(/\(([^()]*)\)\s*=>/g)) {
        for (const p of m[1].split(",")) declared.add(p.trim().replace(/[=\s].*$/, ""));
    }
    for (const m of script.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) declared.add(m[1]);
    const builtins = new Set(["Object", "Array", "Math", "JSON", "Number", "String", "Promise", "Date", "Map", "Set",
        "console", "input", "progress", "Boolean", "RegExp", "Intl", "Symbol", "Reflect", "BigInt", "Error"]);
    const out = new Set<string>();
    for (const m of script.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g)) {
        const name = m[1];
        if (known.includes(name) || declared.has(name) || builtins.has(name)) continue;
        // Only flag names shaped like a namespace someone meant (camelCase identifiers, not `a.b`).
        if (name.length > 3 && /^[a-z]/.test(name)) out.add(name);
    }
    return [...out];
}

// Bundle-eval time: register the namespace (module resolved lazily per call), then the module.
registerActionsScriptingApi(() => {
    try { return (UserActions as any).instance(); } catch (_) { return null; }
});
addModule(OWNER, UserActions, true);

export type { ActionSpec, Surface };
