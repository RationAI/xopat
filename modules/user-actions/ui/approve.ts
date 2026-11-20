/// <reference path="../../../src/types/globals.d.ts" />
/**
 * Mandatory user approval of an action's executable surface. Not skippable by a
 * scripting context's `bypassConsentDialog`: it is our own modal, not
 * `requireActionConsent`, because saving an action is a lasting decision, not a
 * one-off call.
 *
 * A repair (an existing action whose script changed) is shown as a diff in
 * `SuggestionEditor`; the user can decline individual hunks, and what they
 * resolve is what gets saved.
 */
import type { ActionSpec } from "../schema";

export interface ApprovalRequest {
    t(key: string, options?: Record<string, unknown>): string;
    proposed: ActionSpec;
    previous?: ActionSpec;
    proposedBy: "user" | "assistant" | "import";
    referencedNamespaces: string[];
    unknownNamespaces: string[];
    shortcutConflict?: string;
}

export type ApprovalResult = { approved: false } | { approved: true; script: string };

const g = () => globalThis as any;

export function requestApproval(req: ApprovalRequest): Promise<ApprovalResult> {
    const UI = g().UI;
    const van = g().van;
    if (!UI?.Modal || !van) return Promise.resolve({ approved: false });
    const { div, span, pre, button } = van.tags;
    const t = req.t;
    const p = req.proposed;

    return new Promise<ApprovalResult>((resolve) => {
        let settled = false;
        let modal: any;

        const isRepair = !!req.previous && req.previous.script !== p.script;
        const editor = isRepair
            ? new UI.SuggestionEditor({ original: req.previous!.script, suggested: p.script, spellcheck: false,
                surfaceStyle: "font-family: monospace; white-space: pre-wrap; max-height: 40vh; overflow: auto;" })
            : null;

        const finish = (result: ApprovalResult) => {
            if (settled) return;
            settled = true;
            try { modal.close(); } catch (_) { /* already closed */ }
            try { modal.root?.remove(); } catch (_) { /* detached */ }
            resolve(result);
        };

        const row = (label: string, value: any) => div({ class: "flex gap-2 text-sm" },
            span({ class: "opacity-60 shrink-0 w-28" }, label),
            span({ class: "min-w-0 break-words" }, value));

        const surfaces = p.placements.map(pl => t(`surface.${pl.surface}`)
            + (pl.combo ? ` (${pl.combo})` : "")).join(", ") || t("approve.noSurfaces");

        const body = div({ class: "flex flex-col gap-3" },
            div({ class: "alert alert-warning text-sm" },
                span(t(req.proposedBy === "assistant" ? "approve.warningAssistant"
                    : req.proposedBy === "import" ? "approve.warningImport" : "approve.warningUser"))),
            row(t("approve.label"), p.label),
            p.description ? row(t("approve.description"), p.description) : null,
            row(t("approve.surfaces"), surfaces),
            req.shortcutConflict ? row(t("approve.conflict"), req.shortcutConflict) : null,
            row(t("approve.namespaces"), req.referencedNamespaces.join(", ") || "—"),
            req.unknownNamespaces.length
                ? div({ class: "text-sm text-error" }, t("approve.unknownNamespaces", { list: req.unknownNamespaces.join(", ") }))
                : null,
            span({ class: "text-sm font-semibold" }, t(isRepair ? "approve.scriptDiff" : "approve.script")),
            editor
                ? editor.create()
                // textContent rendering: the script is shown, never interpreted.
                : pre({ class: "bg-base-200 rounded p-2 text-xs overflow-auto", style: "max-height: 40vh; white-space: pre-wrap;" }, p.script),
        );

        const footer = div({ class: "flex gap-2" },
            button({ class: "btn btn-ghost", onclick: () => finish({ approved: false }) }, t("approve.decline")),
            button({ class: "btn btn-primary", onclick: () => finish({
                approved: true,
                script: editor ? editor.getValue() : p.script,
            }) }, t("approve.accept")),
        );

        modal = new UI.Modal({
            header: t(isRepair ? "approve.titleRepair" : "approve.title"),
            body,
            footer,
            width: "min(92vw, 760px)",
            allowResize: true,
        });
        const close = modal.close.bind(modal);
        modal.close = () => {
            const r = close();
            if (!settled) {
                settled = true;
                try { modal.root?.remove(); } catch (_) { /* detached */ }
                resolve({ approved: false });
            }
            return r;
        };
        modal.mount(document.body).open();
    });
}

/** Small yes/no confirmation on the shared Modal. Resolves false when dismissed. */
export function confirmDialog(header: string, text: string, confirmLabel: string, cancelLabel: string): Promise<boolean> {
    const UI = g().UI;
    const van = g().van;
    if (!UI?.Modal || !van) return Promise.resolve(false);
    const { div, span, button } = van.tags;
    return new Promise<boolean>((resolve) => {
        let settled = false;
        let modal: any;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            try { modal.close(); } catch (_) { /* closed */ }
            try { modal.root?.remove(); } catch (_) { /* detached */ }
            resolve(value);
        };
        modal = new UI.Modal({
            header,
            body: div({ class: "text-sm" }, span(text)),
            footer: div({ class: "flex gap-2" },
                button({ class: "btn btn-ghost", onclick: () => finish(false) }, cancelLabel),
                button({ class: "btn btn-error", onclick: () => finish(true) }, confirmLabel)),
        });
        const close = modal.close.bind(modal);
        modal.close = () => {
            const r = close();
            if (!settled) {
                settled = true;
                try { modal.root?.remove(); } catch (_) { /* detached */ }
                resolve(false);
            }
            return r;
        };
        modal.mount(document.body).open();
    });
}
