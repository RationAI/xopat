/// <reference path="../../../src/types/globals.d.ts" />
/**
 * "Actions" management panel (FullscreenMenus sub-tab of this module) and the
 * action editor. The panel body is built once and repopulates itself from the
 * store's change signal — FullscreenMenus does not rebuild bodies on open.
 */
import type { ActionSpec, AnyAction, OutputMode, Placement, Surface } from "../schema";
import { OUTPUT_MODES, SURFACES, isApproved, toSpec } from "../schema";
import type { RunRecord } from "../store";

export interface PanelHost {
    t(key: string, options?: Record<string, unknown>): string;
    list(): AnyAction[];
    lastRun(id: string): RunRecord | undefined;
    shortcutState(id: string): { combo?: string; suppressed: string[] } | null;
    isRunning(id: string): boolean;
    canAuthor(): boolean;
    allowedSurfaces(): Surface[];
    onChange(cb: () => void): () => void;
    run(id: string): void;
    save(spec: ActionSpec, previousId?: string): Promise<void>;
    approve(id: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<void>;
    remove(id: string): Promise<void>;
    exportActions(ids?: string[]): void;
    importActions(): void;
}

const g = () => globalThis as any;

export function buildPanel(host: PanelHost): HTMLElement {
    const van = g().van;
    const menus = g().UI?.Services?.FullscreenMenus;
    const { div, span, button } = van.tags;
    const t = host.t;

    const deploymentList = div({ class: "flex flex-col gap-2" });
    const userList = div({ class: "flex flex-col gap-2" });
    const userToolbar = div({ class: "flex flex-wrap gap-2" });

    const iconNode = (icon?: string) => van.tags.i({ class: `ph-light ${icon || "ph-lightning"} text-lg shrink-0` });

    const badge = (text: string, cls = "badge-ghost") => span({ class: `badge badge-sm ${cls}` }, text);

    const surfacesText = (a: AnyAction) => a.placements
        .map(p => t(`surface.${p.surface}`) + (p.combo ? ` (${p.combo})` : "")).join(", ");

    const runText = (run?: RunRecord) => {
        if (!run) return t("panel.neverRun");
        const when = new Date(run.at).toLocaleString();
        return run.ok ? t("panel.lastRunOk", { when }) : t("panel.lastRunFailed", { when, error: run.error || "" });
    };

    const actionButton = (label: string, onclick: () => void, extra = "") =>
        button({ class: `btn btn-xs ${extra}`, onclick }, label);

    const row = (a: AnyAction) => {
        const isUser = a.source === "user";
        const approved = isApproved(a);
        const run = host.lastRun(a.id);
        const shortcut = host.shortcutState(a.id);
        const conflict = a.placements.some(p => p.surface === "shortcut") && shortcut && !shortcut.combo;

        const badges = [
            isUser && a.origin === "assistant" ? badge(t("panel.badgeAssistant"), "badge-info") : null,
            !approved ? badge(t("panel.badgePending"), "badge-warning") : null,
            !a.enabled ? badge(t("panel.badgeDisabled")) : null,
            conflict ? badge(t("panel.badgeConflict"), "badge-error") : null,
        ];

        const buttons = [
            approved && a.enabled ? actionButton(host.isRunning(a.id) ? t("panel.running") : t("panel.run"),
                () => host.run(a.id), "btn-primary") : null,
            isUser && !approved && host.canAuthor() ? actionButton(t("panel.review"), () => { void host.approve(a.id); }, "btn-warning") : null,
            isUser && host.canAuthor() ? actionButton(t("panel.edit"), () => openEditor(host, a)) : null,
            !isUser && host.canAuthor() ? actionButton(t("panel.duplicate"), () => openEditor(host, {
                ...toSpec(a), id: `${a.id}-copy`.slice(0, 48),
            } as any, true)) : null,
            isUser ? actionButton(a.enabled ? t("panel.disable") : t("panel.enable"),
                () => { void host.setEnabled(a.id, !a.enabled); }) : null,
            isUser ? actionButton(t("panel.export"), () => host.exportActions([a.id])) : null,
            isUser ? actionButton(t("panel.delete"), () => { void host.remove(a.id); }, "btn-error btn-outline") : null,
        ];

        return div({ class: "rounded-lg border border-base-300 p-3 flex flex-col gap-1" },
            div({ class: "flex items-center gap-2 min-w-0" },
                iconNode(a.icon),
                span({ class: "font-semibold truncate" }, a.label),
                ...badges),
            a.description ? span({ class: "text-sm opacity-70" }, a.description) : null,
            span({ class: "text-xs opacity-60" }, surfacesText(a) || t("approve.noSurfaces")),
            span({ class: `text-xs ${run && !run.ok ? "text-error" : "opacity-60"}`, title: run?.error || "" }, runText(run)),
            div({ class: "flex flex-wrap gap-1 pt-1" }, ...buttons),
        );
    };

    const render = () => {
        const all = host.list();
        const deployment = all.filter(a => a.source === "deployment");
        const user = all.filter(a => a.source === "user");
        deploymentList.replaceChildren(...(deployment.length
            ? deployment.map(row) : [span({ class: "text-sm opacity-70" }, t("panel.noDeployment"))]));
        userList.replaceChildren(...(user.length
            ? user.map(row) : [span({ class: "text-sm opacity-70" }, t("panel.noUser"))]));
        userToolbar.replaceChildren(...(host.canAuthor() ? [
            actionButton(t("panel.new"), () => openEditor(host), "btn-primary"),
            actionButton(t("panel.import"), () => host.importActions()),
            user.length ? actionButton(t("panel.exportAll"), () => host.exportActions()) : null,
        ] : []));
    };

    render();
    host.onChange(render);

    const card = (title: string, ...children: any[]) => menus?.card
        ? menus.card(title, ...children)
        : div({ class: "card" }, span({ class: "font-semibold" }, title), ...children);
    const deploymentCard = card(t("panel.deploymentTitle"), deploymentList);
    const userCard = card(t("panel.userTitle"), span({ class: "text-sm opacity-70" }, t("panel.userHint")), userToolbar, userList);
    return menus?.layout ? menus.layout(t("panel.title"), userCard, deploymentCard)
        : div({}, userCard, deploymentCard);
}

/** Create / edit form. Saving goes through the host, which requires approval. */
export function openEditor(host: PanelHost, existing?: AnyAction | ActionSpec, isDuplicate = false): void {
    const UI = g().UI;
    const van = g().van;
    if (!UI?.Modal || !van) return;
    const { div, span, input, textarea, select, option, label, button } = van.tags;
    const t = host.t;
    const spec: ActionSpec | undefined = existing ? ("source" in existing ? toSpec(existing as AnyAction) : existing) : undefined;
    const previousId = existing && !isDuplicate ? spec?.id : undefined;

    const field = (caption: string, control: any, hint?: string) => label({ class: "form-control w-full gap-1" },
        span({ class: "label-text" }, caption), control,
        hint ? span({ class: "label-text-alt opacity-60" }, hint) : null);

    const idInput = input({ class: "input input-bordered input-sm", value: spec?.id || "", disabled: !!previousId,
        placeholder: "count-per-class", maxlength: 48 });
    const labelInput = input({ class: "input input-bordered input-sm", value: spec?.label || "", maxlength: 80 });
    const descInput = input({ class: "input input-bordered input-sm", value: spec?.description || "", maxlength: 400 });
    const iconInput = input({ class: "input input-bordered input-sm", value: spec?.icon || "", placeholder: "ph-chart-bar" });
    const scriptInput = textarea({ class: "textarea textarea-bordered font-mono text-xs", rows: 12, spellcheck: false },
        spec?.script || "");
    const outputSelect = select({ class: "select select-bordered select-sm" },
        ...OUTPUT_MODES.map(m => option({ value: m, selected: (spec?.output || "auto") === m }, t(`output.${m}`))));

    const placementOf = (s: Surface) => spec?.placements.find(p => p.surface === s);
    const allowed = host.allowedSurfaces();
    const surfaceChecks = new Map<Surface, HTMLInputElement>();
    const comboInput = input({ class: "input input-bordered input-xs w-32", placeholder: "Alt+KeyC",
        value: placementOf("shortcut")?.combo || "" });
    const pinnedCheck = input({ type: "checkbox", class: "checkbox checkbox-xs", checked: !!placementOf("quick")?.pinned });
    const selectionCheck = input({ type: "checkbox", class: "checkbox checkbox-xs",
        checked: placementOf("context-menu")?.when === "selection" });

    const surfaceRows = SURFACES.filter(s => allowed.includes(s)).map(s => {
        const check = input({ type: "checkbox", class: "checkbox checkbox-sm", checked: !!placementOf(s) });
        surfaceChecks.set(s, check);
        const extra = s === "shortcut" ? comboInput
            : s === "quick" ? label({ class: "flex items-center gap-1 text-xs" }, pinnedCheck, t("editor.pinned"))
            : s === "context-menu" ? label({ class: "flex items-center gap-1 text-xs" }, selectionCheck, t("editor.onlySelection"))
            : null;
        return div({ class: "flex items-center gap-2" },
            label({ class: "flex items-center gap-2 cursor-pointer" }, check, span({ class: "text-sm" }, t(`surface.${s}`))),
            extra);
    });

    const errorBox = div({ class: "text-sm text-error" });

    let modal: any;
    const save = async () => {
        const placements: Placement[] = [];
        for (const [s, check] of surfaceChecks) {
            if (!check.checked) continue;
            const p: Placement = { surface: s };
            if (s === "shortcut") p.combo = comboInput.value.trim();
            if (s === "quick" && pinnedCheck.checked) p.pinned = true;
            if (s === "context-menu") p.when = selectionCheck.checked ? "selection" : "always";
            placements.push(p);
        }
        const next: any = {
            id: idInput.value.trim(),
            label: labelInput.value,
            script: scriptInput.value,
            placements,
            output: outputSelect.value as OutputMode,
            enabled: spec?.enabled ?? true,
        };
        if (descInput.value.trim()) next.description = descInput.value.trim();
        if (iconInput.value.trim()) next.icon = iconInput.value.trim();
        if (spec?.timeoutMs) next.timeoutMs = spec.timeoutMs;
        try {
            errorBox.textContent = "";
            await host.save(next, previousId);
            modal.close();
            modal.root?.remove();
        } catch (e: any) {
            errorBox.textContent = String(e?.message || e);
        }
    };

    const body = div({ class: "flex flex-col gap-2" },
        field(t("editor.id"), idInput, t("editor.idHint")),
        field(t("editor.label"), labelInput),
        field(t("editor.description"), descInput),
        field(t("editor.icon"), iconInput, t("editor.iconHint")),
        field(t("editor.script"), scriptInput, t("editor.scriptHint")),
        span({ class: "label-text" }, t("editor.surfaces")),
        ...surfaceRows,
        field(t("editor.output"), outputSelect),
        errorBox,
    );
    const footer = div({ class: "flex gap-2" },
        button({ class: "btn btn-ghost", onclick: () => { modal.close(); modal.root?.remove(); } }, t("editor.cancel")),
        button({ class: "btn btn-primary", onclick: () => { void save(); } }, t("editor.save")),
    );
    modal = new UI.Modal({
        header: t(previousId ? "editor.titleEdit" : "editor.titleNew"),
        body, footer, width: "min(92vw, 720px)", allowResize: true,
    });
    modal.mount(document.body).open();
}
