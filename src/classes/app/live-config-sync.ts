/**
 * Continuous renderer → structural-config write-back.
 *
 * The open pipeline hands FlexRenderer a CLONE of each viewer's shader
 * configs (assemble-render-output.ts clones, then per-viewer shader-id
 * namespacing renames — the structural objects cannot be shared by
 * reference). Every UI / scripting edit therefore lands only in the
 * renderer's clone; before this bridge existed, APPLICATION_CONTEXT.config
 * was reconciled exclusively at export time.
 *
 * This bridge keeps the structural config (shader `type`, `params`/state,
 * `cache`, layer order) continuously in sync:
 *
 *  - listens per-viewer to the renderer's canonical `visualization-change`
 *    event (fires on every control edit — sliders, colors, channels) and
 *    to the VIEWER_MANAGER `shader-config-update` / `shader-layer-order-changed`
 *    broadcasts (type swaps, blend toggles, filters, reorder),
 *  - debounces ~100 ms per viewer, then merges that viewer's live state
 *    into APPLICATION_CONTEXT.config via `mergeViewerLiveIntoConfig`
 *    (scoped to the bg entry + visualization the viewer actually renders),
 *  - stamps `viewer.__lastShaderEditAt` (monotonic counter) on genuine
 *    local edits — serializeScene uses it as a merge-order fallback,
 *  - copy-on-write: when a viewer edits a visualization whose index is
 *    shared by another background entry, the visualization is forked
 *    (deep clone appended to cfg.visualizations, the editing viewer's bg
 *    entry repointed) so per-viewer divergence stays representable,
 *  - forwards control edits to `UTILITIES._emitShaderConfigUpdate` so the
 *    session-sync fast path and visualization-history cover slider drags
 *    (previously only the session provider's poll caught them).
 *
 * No feedback loops: the write-back only mutates the structural config
 * (caches deep-cloned by `mergeRuntimeIntoStructuralShader`), never the
 * renderer, and raises no events itself. Visualization-history is keyed
 * off live-renderer snapshots, so structural writes add no history entries.
 *
 * Known limit (by design): two viewers displaying the SAME background
 * entry cannot be separated by repointing `bg.visualizationIndex` — they
 * genuinely share one config slot and keep last-write-wins semantics.
 */

import { mergeViewerLiveIntoConfig } from "./canonical-scene";
import { ViewerSelectionState } from "./viewer-selection-state";

const WRITE_BACK_DEBOUNCE_MS = 100;

let editSeq = 0;

function appContext(): any {
    return (window as any).APPLICATION_CONTEXT;
}

function liveConfig(): any {
    const APP = appContext();
    return typeof APP?._dangerouslyAccessConfig === "function"
        ? APP._dangerouslyAccessConfig()
        : APP?.config;
}

function viewerManager(): any {
    return (window as any).VIEWER_MANAGER;
}

function isSuppressedApply(viewer: any): boolean {
    return !!(viewer?.__sessionApplyingRemote || viewer?.__historyApplyingLocal);
}

/**
 * Copy-on-write fork: ensure the visualization the viewer renders is not
 * shared with any OTHER background entry before this viewer's edits land
 * in it. When shared, the pristine structural visualization is deep-cloned,
 * appended to `cfg.visualizations`, and the viewer's bg entry repointed to
 * the clone — the original index (and its state) stays with the others.
 *
 * Must run synchronously on the FIRST local edit, before the debounced
 * write-back flushes — the clone has to capture the visualization
 * UNTOUCHED by this viewer's new edits (they live only in the renderer
 * until the write-back merges them into the fork).
 *
 * Returns the visualization index the viewer owns afterwards, or
 * undefined when the viewer has no visualization.
 */
export function ensureViewerOwnsVisualization(viewer: any, cfg: any): number | undefined {
    if (!viewer || !cfg) return undefined;
    const bgIdx = ViewerSelectionState.getViewerSelectionIndex(
        viewer, "activeBackgroundIndex", appContext(), viewerManager(),
    );
    if (!Number.isInteger(bgIdx)) return undefined;
    const backgrounds: any[] = Array.isArray(cfg.background) ? cfg.background : [];
    const bg = backgrounds[bgIdx as number];
    const vizIdx = bg?.visualizationIndex;
    if (!Number.isInteger(vizIdx)) return undefined;

    const shared = backgrounds.some((other, j) =>
        j !== bgIdx && other && other.visualizationIndex === vizIdx);
    if (!shared) return vizIdx as number;

    if (!Array.isArray(cfg.visualizations)) return vizIdx as number;
    const visualizations: any[] = cfg.visualizations;
    const source = visualizations[vizIdx as number];
    if (!source) return vizIdx as number;

    let clone: any;
    try {
        clone = JSON.parse(JSON.stringify(source));
    } catch (e) {
        console.warn("[live-config-sync] visualization fork failed to clone:", e);
        return vizIdx as number;
    }
    visualizations.push(clone);
    const newIdx = visualizations.length - 1;
    bg.visualizationIndex = newIdx;

    refreshVisualizationDropdowns(cfg);
    return newIdx;
}

/** Re-render every viewer's visualization select after the list changed. */
function refreshVisualizationDropdowns(cfg: any): void {
    const VM = viewerManager();
    const APP = appContext();
    const viewers: any[] = Array.isArray(VM?.viewers) ? VM.viewers.filter(Boolean) : [];
    for (const viewer of viewers) {
        try {
            viewer.getMenu?.()?.getShadersTab?.()?.updateVisualizationList?.(
                cfg.visualizations,
                ViewerSelectionState.getViewerVisualizationIndex(viewer, APP, VM),
            );
        } catch (e) {
            console.warn("[live-config-sync] dropdown refresh failed:", e);
        }
    }
}

type Attachment = {
    renderer: any;
    onVizChange: (e: any) => void;
    timer: any;
};

/**
 * Mount the bridge. Call once after the first open (mirrors
 * `bootstrapVisualizationHistory`). Returns a teardown function.
 */
export function bootstrapLiveConfigSync(): () => void {
    const VM = viewerManager();
    if (!VM || typeof VM.broadcastHandler !== "function") {
        const handle = setTimeout(() => bootstrapLiveConfigSync(), 200);
        return () => clearTimeout(handle);
    }

    const attachments = new Map<any, Attachment>();

    const scheduleWriteBack = (viewer: any) => {
        const att = attachments.get(viewer);
        const flush = () => {
            const current = attachments.get(viewer);
            if (current) current.timer = null;
            try {
                mergeViewerLiveIntoConfig(viewer, liveConfig());
            } catch (e) {
                console.warn("[live-config-sync] write-back failed:", e);
            }
            // Keep the URL hash carrying the current session so a plain
            // reload preserves edits (further debounced in layers.js).
            try { UTILITIES.scheduleSessionUrlSync?.(); } catch (e) { /* optional */ }
        };
        if (!att) {
            // Broadcast event for a viewer whose renderer never attached
            // (e.g. non-flex drawer) — still attempt a one-shot sync.
            setTimeout(flush, WRITE_BACK_DEBOUNCE_MS);
            return;
        }
        if (att.timer !== null) clearTimeout(att.timer);
        att.timer = setTimeout(flush, WRITE_BACK_DEBOUNCE_MS);
    };

    const markLocalEdit = (viewer: any) => {
        viewer.__lastShaderEditAt = ++editSeq;
        try {
            ensureViewerOwnsVisualization(viewer, liveConfig());
        } catch (e) {
            console.warn("[live-config-sync] visualization fork failed:", e);
        }
    };

    const attach = (viewer: any) => {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer || typeof renderer.addHandler !== "function") return;
        const existing = attachments.get(viewer);
        if (existing) {
            if (existing.renderer === renderer) return;
            // Drawer was recreated — detach from the stale renderer first.
            try { existing.renderer.removeHandler?.("visualization-change", existing.onVizChange); }
            catch (e) { /* stale renderer may already be disposed */ }
            if (existing.timer !== null) clearTimeout(existing.timer);
            attachments.delete(viewer);
        }

        const onVizChange = (e: any) => {
            const localEdit = !e?.external && !isSuppressedApply(viewer);
            if (localEdit) {
                markLocalEdit(viewer);
                // Control edits (sliders, colors, channels) historically
                // bypassed the fast path — forward them so session sync
                // and viz-history react without waiting for the poll.
                if (e?.reason === "control-change" || e?.reason === "channel-change") {
                    try {
                        UTILITIES._emitShaderConfigUpdate?.(viewer, e.shaderId, {
                            control: e.controlName,
                            value: e.encodedValue,
                        });
                    } catch (err) {
                        console.warn("[live-config-sync] fast-path forward failed:", err);
                    }
                }
            }
            // Config must mirror the renderer regardless of edit source
            // (external configs and remote/history applies included).
            scheduleWriteBack(viewer);
        };

        renderer.addHandler("visualization-change", onVizChange);
        attachments.set(viewer, { renderer, onVizChange, timer: null });
        console.info("[live-config-sync] attached to viewer", viewer?.id ?? "(no id)");
    };

    const detach = (viewer: any) => {
        const att = attachments.get(viewer);
        if (!att) return;
        try { att.renderer.removeHandler?.("visualization-change", att.onVizChange); }
        catch (e) { /* renderer may already be disposed */ }
        if (att.timer !== null) clearTimeout(att.timer);
        attachments.delete(viewer);
    };

    let broadcastSeen = false;
    const onShaderUpdate = (e: any) => {
        const viewer = e?.viewer || e?.eventSource;
        if (!viewer) return;
        if (!broadcastSeen) {
            broadcastSeen = true;
            console.info("[live-config-sync] shader-config-update broadcast received");
        }
        if (!isSuppressedApply(viewer)) markLocalEdit(viewer);
        scheduleWriteBack(viewer);
    };

    // Direct edit-signal hook — called straight from
    // UTILITIES._emitShaderConfigUpdate (src/layers.js) so the critical
    // local-edit signal does not depend on the viewer-event broadcast
    // relay. The broadcast listener above stays as a redundant path
    // (stamp/fork are idempotent, write-back is debounced).
    let directSeen = false;
    UTILITIES._notifyShaderConfigEdited = (viewer: any) => {
        if (!viewer) return;
        if (!directSeen) {
            directSeen = true;
            console.info("[live-config-sync] direct edit hook invoked");
        }
        if (!isSuppressedApply(viewer)) markLocalEdit(viewer);
        scheduleWriteBack(viewer);
    };
    const onLayerOrder = (e: any) => {
        const viewer = e?.viewer || e?.eventSource;
        if (viewer) scheduleWriteBack(viewer);
    };
    const onViewerCreate = (e: any) => {
        const viewer = e?.eventSource || e?.viewer;
        if (!viewer) return;
        // Defer so the drawer/renderer finish initializing.
        setTimeout(() => attach(viewer), 0);
    };
    const onVisualizationReady = (e: any) => {
        const viewer = e?.eventSource;
        if (viewer) attach(viewer);
    };
    const onViewerDestroy = (e: any) => {
        const viewer = e?.eventSource || e?.viewer;
        if (viewer) detach(viewer);
    };

    VM.broadcastHandler("shader-config-update", onShaderUpdate);
    VM.broadcastHandler("shader-layer-order-changed", onLayerOrder);
    VM.broadcastHandler("visualization-ready", onVisualizationReady);
    VM.addHandler?.("viewer-create", onViewerCreate);
    VM.addHandler?.("viewer-destroy", onViewerDestroy);
    VM.addHandler?.("viewer-reset", onViewerDestroy);

    // Attach to viewers already alive at bootstrap.
    const alive: any[] = Array.isArray(VM.viewers) ? VM.viewers.filter(Boolean) : [];
    for (const viewer of alive) attach(viewer);
    console.info(`[live-config-sync] mounted (${alive.length} viewers alive, ${attachments.size} attached)`);

    return () => {
        if (UTILITIES._notifyShaderConfigEdited) delete UTILITIES._notifyShaderConfigEdited;
        VM.cancelBroadcast?.("shader-config-update", onShaderUpdate);
        VM.cancelBroadcast?.("shader-layer-order-changed", onLayerOrder);
        VM.cancelBroadcast?.("visualization-ready", onVisualizationReady);
        VM.removeHandler?.("viewer-create", onViewerCreate);
        VM.removeHandler?.("viewer-destroy", onViewerDestroy);
        VM.removeHandler?.("viewer-reset", onViewerDestroy);
        for (const viewer of Array.from(attachments.keys())) detach(viewer);
    };
}
