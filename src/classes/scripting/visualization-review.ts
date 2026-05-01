/**
 * Helper that opens the Visualization Playground in "review" mode for a
 * scripting-API caller (typically the LLM chat integration) and returns a
 * structured decision: accept, send-back-to-LLM-with-feedback, or decline.
 *
 * Replaces the simple yes/no consent dialog for visualization-mutating
 * operations. The user *sees* the proposed visualization in context and can
 * edit it before accepting; the feedback path produces a MutationResult code
 * the LLM can re-plan against.
 *
 * Design contract:
 *   - The caller's `proposed.visualizations[activeIdx]` is the FINAL,
 *     fully-formed visualization config (the four scripting-API methods
 *     `addVisualization`, `updateVisualizationAt`, `replaceVisualizations`,
 *     `restoreState` already build it that way before invoking review).
 *   - This module does NOT read or merge the source viewer's runtime shader
 *     map. Doing so would pull in the auto-generated background-identity
 *     wrappers that `viewer-open-pipeline.ts` owns; persisting those into
 *     the visualization config produces duplicate-id renderOutput entries
 *     that the renderer's sanitizeKey collapses into a single GLSL program
 *     declared twice.
 *   - The playground page renders backgrounds itself (see playground-page.ts
 *     openSourceMirror) from the `background` array we forward here, parallel
 *     to the production pipeline's background-shader assembly. The user
 *     therefore sees: configured backgrounds + proposed visualization, both
 *     keyed under non-colliding ids.
 */

import type { VisualizationStateSnapshot } from "./visualization-api.scripts";

export interface VisualizationReviewOptions {
    /** Short title shown in the playground modal header. */
    title?: string;
    /**
     * Human-readable explanation supplied by the LLM (e.g. "Highlight tumor
     * regions and dim the background noise."). Shown as a one-line subtitle.
     */
    rationale?: string;
    /** Forwarded to applyVisualizationStateSnapshot when the user accepts. */
    historyLabel?: string;
}

export type VisualizationReviewDecision =
    | { decision: "accept"; appliedSnapshot: VisualizationStateSnapshot }
    | { decision: "feedback"; feedback: string; editedSnapshot: VisualizationStateSnapshot }
    | { decision: "decline" };

let inFlight = false;

/** True while a review is currently open. Concurrent review attempts must be rejected. */
export function isReviewInFlight(): boolean {
    return inFlight;
}

/**
 * Open the playground in review mode and resolve to the user's decision.
 *
 * @param viewer    The OSD viewer whose slide is shown in the playground.
 * @param proposed  The snapshot the LLM (or any other producer) wants applied.
 * @param applySnapshot Callback that actually applies a snapshot to the source
 *                      session — usually `applyVisualizationStateSnapshot` from
 *                      visualization-api. Called only on accept.
 * @param options   Display + history labels.
 *
 * Returns a VisualizationReviewDecision. Throws if PlaygroundService is not
 * available — callers should fall back to a plain consent dialog in that case.
 */
export async function reviewVisualizationProposal(
    viewer: any,
    proposed: VisualizationStateSnapshot,
    applySnapshot: (snapshot: VisualizationStateSnapshot, options: { historyLabel?: string }) => Promise<boolean>,
    options: VisualizationReviewOptions = {},
): Promise<VisualizationReviewDecision> {
    const PLAYGROUND: any = (window as any).PLAYGROUND;
    if (!PLAYGROUND?.open) {
        throw new Error("PlaygroundService is not available; cannot open visualization review.");
    }
    if (inFlight) {
        throw new Error("Another visualization review is already in progress.");
    }
    inFlight = true;

    try {
        const activeIndex = resolveActiveIndex(proposed);
        const proposedViz = proposed.visualizations?.[activeIndex];
        if (!proposedViz) {
            throw new Error("Proposed snapshot has no visualization at the active index.");
        }

        // Forward the FULL snapshot (the post-mutation parent session config)
        // and the source viewer's backgrounds. The playground inherits the
        // parent's world layout and assembles its renderer config via the
        // same helper the production open-pipeline uses, so what the user
        // sees in the modal matches what the source viewer will render after
        // accept (WYSIWYG).
        //
        // Backgrounds: read from the viewer's world (each opened tile carries
        // its bg config via getConfig("background")), NOT from the global
        // APPLICATION_CONTEXT.config.background pool. The pool can hold
        // backgrounds that are not opened in this particular viewer (e.g.
        // a multi-viewer session where each viewer picks one bg via
        // activeBackgroundIndex[viewerIndex], or simply unused entries from
        // the persisted config). Cloning the whole pool produces phantom
        // layers in the playground that the source viewer never displays.
        const APP: any = (window as any).APPLICATION_CONTEXT;
        const viewerBackgrounds = collectViewerBackgrounds(viewer);
        const sourceBackgrounds = viewerBackgrounds.length
            ? cloneJson(viewerBackgrounds)
            : (Array.isArray(APP?.config?.background) ? cloneJson(APP.config.background) : undefined);

        // Debug surface: stash the snapshot + backgrounds the playground will
        // see, so the inspector can diff against APPLICATION_CONTEXT.config and
        // against the playground's edited state.
        if (PLAYGROUND._debug) {
            PLAYGROUND._debug.lastProposed = cloneJson(proposed);
            PLAYGROUND._debug.lastSourceBackgrounds = sourceBackgrounds;
        }

        let outcome: VisualizationReviewDecision = { decision: "decline" };

        const result = await PLAYGROUND.open({
            source: {
                kind: "viewer-with-override",
                viewer,
                snapshot: cloneJson(proposed),
                visualization: cloneJson(proposedViz),
                data: proposed.data,
                background: sourceBackgrounds,
            },
            title: options.title || tr("playground.review.title", "Review proposed visualization"),
            actions: [
                {
                    id: "accept",
                    label: tr("playground.review.accept", "Accept"),
                    primary: true,
                    onClick: (ctx: any) => {
                        const page = ctx.activePage;
                        const editedSnapshot = composeEditedSnapshot(proposed, page);
                        outcome = { decision: "accept", appliedSnapshot: editedSnapshot };
                        // Fire-and-forget: close the modal right away so the user sees the
                        // source viewer update without waiting for applySnapshot to settle.
                        // applySnapshot still runs to completion on the source viewer in the
                        // background; failures only log.
                        Promise.resolve()
                            .then(() => applySnapshot(editedSnapshot, { historyLabel: options.historyLabel }))
                            .catch((e) => console.warn("[visualization-review] applySnapshot failed", e));
                        ctx.closeModal("accept");
                    },
                },
                {
                    id: "feedback",
                    label: tr("playground.review.feedback", "Send to LLM with feedback"),
                    onClick: async (ctx: any) => {
                        const feedback = await promptForFeedback();
                        if (!feedback) return; // user cancelled the sub-dialog; keep playground open
                        const page = ctx.activePage;
                        const editedSnapshot = composeEditedSnapshot(proposed, page);
                        outcome = { decision: "feedback", feedback, editedSnapshot };
                        ctx.closeModal("feedback");
                    },
                },
                {
                    id: "decline",
                    label: tr("playground.review.decline", "Decline"),
                    onClick: (ctx: any) => {
                        outcome = { decision: "decline" };
                        ctx.closeModal("decline");
                    },
                },
            ],
            // Defaults (close-confirm + draft persistence) are auto-disabled when
            // `actions` is supplied. We use the rationale as a one-line banner via
            // Dialogs.show after the modal mounts.
        });

        if (options.rationale) {
            const Dialogs: any = (window as any).Dialogs;
            Dialogs?.show?.(options.rationale, 6000, Dialogs?.MSG_INFO);
        }

        // X / ESC dismissal also resolves the playground promise — map it to decline.
        if (result?.actionId === "dismiss") {
            outcome = { decision: "decline" };
        }
        return outcome;
    } finally {
        inFlight = false;
    }
}

// ---------------------------------------------------------------------------

function resolveActiveIndex(snapshot: VisualizationStateSnapshot): number {
    const idx = snapshot.activeVisualizationIndex;
    if (Array.isArray(idx)) {
        for (const entry of idx) {
            if (Number.isInteger(entry)) return entry as number;
        }
    } else if (Number.isInteger(idx)) {
        return idx as unknown as number;
    }
    return 0;
}

/**
 * Build the snapshot to commit on accept (or to send back to the LLM with
 * feedback). The playground page returns its current visualization config —
 * which is exactly the merged-in-place edits of the proposal — so we just
 * place it at the active index. No merging, no stripping; the page never
 * carried foreign state in the first place.
 */
function composeEditedSnapshot(
    proposed: VisualizationStateSnapshot,
    page: any,
): VisualizationStateSnapshot {
    const editedViz = page?.getVisualization?.();
    if (!editedViz) return cloneSnapshot(proposed);

    const out = cloneSnapshot(proposed);
    const idx = resolveActiveIndex(out);
    out.visualizations = Array.isArray(out.visualizations) ? [...out.visualizations] : [];
    out.visualizations[idx] = editedViz;
    return out;
}

function cloneJson<T>(v: T): T {
    if (v === undefined || v === null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

/**
 * Walk the viewer's OSD world and collect the BackgroundConfig objects of
 * every opened tile. The viewer-open-pipeline stamps each tile's getConfig
 * map with `background` → its BackgroundConfig at open time, so this is the
 * authoritative "which bgs are actually shown in this viewer" lookup. Order
 * matches the world (= render) order; duplicates by reference are dropped
 * (one BackgroundConfig per opened bg, even if it claims multiple tiles).
 */
function collectViewerBackgrounds(viewer: any): any[] {
    const out: any[] = [];
    if (!viewer?.world?.getItemAt || !viewer.world.getItemCount) return out;
    const seen = new Set<any>();
    const count = viewer.world.getItemCount() || 0;
    for (let i = 0; i < count; i++) {
        const item = viewer.world.getItemAt(i);
        const bg = typeof item?.getConfig === "function" ? item.getConfig("background") : undefined;
        if (bg && !seen.has(bg)) {
            seen.add(bg);
            out.push(bg);
        }
    }
    return out;
}

function cloneSnapshot(s: VisualizationStateSnapshot): VisualizationStateSnapshot {
    try { return JSON.parse(JSON.stringify(s)); } catch (e) { return s; }
}

/**
 * Modal sub-dialog that captures the user's feedback for the LLM. Returns the
 * trimmed string on submit, or null if the user cancels. Send is disabled until
 * the textarea has at least 1 non-whitespace character; max length is capped to
 * keep payloads sane.
 */
function promptForFeedback(): Promise<string | null> {
    const ui: any = (globalThis as any).UI;
    return new Promise<string | null>((resolve) => {
        if (!ui?.Modal) {
            const out = window.prompt(tr("playground.review.feedbackPrompt", "Describe what should change:"));
            resolve(out && out.trim() ? out.trim().slice(0, 4000) : null);
            return;
        }

        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";

        const hint = document.createElement("p");
        hint.className = "text-sm opacity-80";
        hint.textContent = tr(
            "playground.review.feedbackHint",
            "Tell the assistant what to change. The current state of the playground will be sent along.",
        );
        wrap.appendChild(hint);

        const ta = document.createElement("textarea");
        ta.className = "textarea textarea-bordered w-full";
        ta.rows = 6;
        ta.maxLength = 4000;
        ta.placeholder = tr(
            "playground.review.feedbackPlaceholder",
            "e.g. The tumor mask is too aggressive — try a softer threshold and keep the stroma layer visible.",
        );
        wrap.appendChild(ta);

        const footer = document.createElement("div");
        footer.className = "w-full flex items-center justify-end gap-2";

        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn btn-sm";
        cancel.textContent = tr("playground.review.feedbackCancel", "Cancel");

        const send = document.createElement("button");
        send.type = "button";
        send.className = "btn btn-sm btn-primary";
        send.textContent = tr("playground.review.feedbackSend", "Send");
        send.disabled = true;

        ta.addEventListener("input", () => {
            send.disabled = ta.value.trim().length === 0;
        });

        footer.appendChild(cancel);
        footer.appendChild(send);

        let settled = false;
        const modal = new ui.Modal({
            header: tr("playground.review.feedbackTitle", "Send feedback to assistant"),
            body: wrap,
            footer,
            width: "min(36rem, 92vw)",
            isBlocking: true,
            allowClose: true,
        });

        const finish = (value: string | null) => {
            if (settled) return;
            settled = true;
            try { modal.close(); } catch (e) { /* noop */ }
            const root = (modal as any).root as HTMLElement | undefined;
            root?.remove();
            resolve(value);
        };
        cancel.addEventListener("click", () => finish(null));
        send.addEventListener("click", () => finish(ta.value.trim().slice(0, 4000) || null));

        const node = modal.create();
        // The playground modal sits at z-index 9999 (visualization-playground-modal.ts);
        // float this nested feedback dialog above it so the textarea is reachable.
        try { (node as HTMLElement).style.zIndex = "10000"; } catch (e) { /* noop */ }
        document.body.appendChild(node);
        modal.open();
        // Focus the textarea on open for fast typing.
        setTimeout(() => ta.focus(), 0);
    });
}

function tr(key: string, fallback: string): string {
    const $: any = (window as any).$;
    try {
        const out = $?.t?.(key);
        if (typeof out === "string" && out !== key) return out;
    } catch (e) { /* noop */ }
    return fallback;
}
