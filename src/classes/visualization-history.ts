/**
 * Records visualization & background-shader edits onto the global history
 * stack so the user can undo/redo slider drags, colormap changes, layer
 * reorder, blend-mode toggles, etc.
 *
 * Reuses the snapshot pair the session sync already relies on:
 *   UTILITIES.exportLiveVisualization / importLiveVisualization (src/layers.js).
 *
 * Listens to VIEWER_MANAGER `shader-config-update` (the same fast-path event
 * the session provider taps for cross-peer sync), debounces edit bursts into
 * a single history entry, and pushes per-viewer
 *   forward = importLiveVisualization(next),
 *   backward = importLiveVisualization(prev).
 *
 * Out of scope: structural changes that route through the open pipeline
 * (`viewer-open-pipeline.ts` already pushes `historyMode: "visualization-step"`),
 * background reference swaps (open pipeline clears history), and the
 * playground's isolated viewer (not registered in VIEWER_MANAGER.viewers).
 */
import type { XOpatHistory } from "./history";

const COMMIT_DEBOUNCE_MS = 300;

type LivePayload = any; // shape from UTILITIES.exportLiveVisualization

function exportLive(viewer: any): LivePayload | null {
    const U: any = (window as any).UTILITIES;
    if (typeof U?.exportLiveVisualization !== "function") return null;
    try { return U.exportLiveVisualization(viewer); } catch (e) { return null; }
}

function importLive(viewer: any, payload: LivePayload): void {
    const U: any = (window as any).UTILITIES;
    if (typeof U?.importLiveVisualization !== "function") return;
    try { U.importLiveVisualization(viewer, payload); } catch (e) {
        console.warn("[viz-history] importLiveVisualization failed", e);
    }
}

export function bootstrapVisualizationHistory(history: XOpatHistory): () => void {
    const VM: any = (window as any).VIEWER_MANAGER;
    if (!VM || typeof VM.broadcastHandler !== "function") {
        // VIEWER_MANAGER not ready yet — retry shortly.
        const handle = setTimeout(() => bootstrapVisualizationHistory(history), 200);
        return () => clearTimeout(handle);
    }

    // Per-viewer baseline (last-committed snapshot).
    const baselines = new Map<string, string /* JSON sig */>();
    const baselinePayloads = new Map<string, LivePayload>();
    let pendingTimer: any = null;

    const reseedBaseline = (viewer: any) => {
        if (!viewer || !viewer.world || (viewer.world.getItemCount?.() ?? 0) === 0) return;
        if (!viewer.uniqueId) return;
        const snap = exportLive(viewer);
        if (!snap) return;
        baselinePayloads.set(viewer.uniqueId, snap);
        baselines.set(viewer.uniqueId, JSON.stringify(snap));
    };

    const reseedAll = () => {
        const viewers = Array.isArray(VM.viewers) ? VM.viewers.filter(Boolean) : [];
        for (const v of viewers) reseedBaseline(v);
    };

    const commit = () => {
        pendingTimer = null;
        if (!history.isRecordingEnabled) return; // we're inside an undo/redo apply

        const viewers = Array.isArray(VM.viewers) ? VM.viewers.filter(Boolean) : [];
        for (const viewer of viewers) {
            // Skip empty-world viewers (transient mid-reset state) before
            // touching the uniqueId getter — see loader.ts findViewerUniqueId.
            if (!viewer.world || (viewer.world.getItemCount?.() ?? 0) === 0) continue;
            if (!viewer.uniqueId) continue;
            // Skip remote applies (session sync) and local apply re-entries.
            if (viewer.__sessionApplyingRemote) continue;
            if (viewer.__historyApplyingLocal) continue;

            const next = exportLive(viewer);
            if (!next) continue;
            const nextSig = JSON.stringify(next);
            const prevSig = baselines.get(viewer.uniqueId);

            if (prevSig === undefined) {
                // First time we're seeing this viewer — establish baseline,
                // don't push (no prior state to undo to).
                baselines.set(viewer.uniqueId, nextSig);
                baselinePayloads.set(viewer.uniqueId, next);
                continue;
            }
            if (prevSig === nextSig) continue; // no real change

            const prev = baselinePayloads.get(viewer.uniqueId);
            // Snapshot baseline NOW (closure capture); update before pushing
            // so a re-entrant event from the apply itself sees the new baseline.
            baselines.set(viewer.uniqueId, nextSig);
            baselinePayloads.set(viewer.uniqueId, next);

            const apply = (payload: LivePayload) => {
                viewer.__historyApplyingLocal = true;
                try {
                    history.withoutRecording(() => importLive(viewer, payload));
                } finally {
                    // Release on next frame so any synchronous shader-config-update
                    // events fired during the rebuild are still suppressed.
                    requestAnimationFrame(() => { viewer.__historyApplyingLocal = false; });
                }
            };

            history.pushExecuted(
                () => apply(next),
                () => apply(prev),
                { kind: "viz-edit", label: "visualization edit" } as any,
            );
        }
    };

    const schedule = () => {
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(commit, COMMIT_DEBOUNCE_MS);
    };

    const onShaderUpdate = (_e: any) => { schedule(); };
    const onLayerOrder = (_e: any) => { schedule(); };

    const onViewerCreate = (e: any) => {
        // Establish baseline once the viewer is ready; renderer may need a tick.
        const viewer = e?.eventSource || e?.viewer;
        if (!viewer) return;
        // Defer to allow the renderer to populate its shader stack.
        setTimeout(() => reseedBaseline(viewer), 0);
    };
    const onVisualizationReady = (e: any) => {
        const viewer = e?.eventSource;
        if (viewer) reseedBaseline(viewer);
    };
    const onViewerDestroy = (e: any) => {
        const viewer = e?.eventSource || e?.viewer;
        const id = viewer?.uniqueId;
        if (!id) return;
        baselines.delete(id);
        baselinePayloads.delete(id);
    };

    // History clear (e.g. background reference swap) → drop the pending commit
    // and reseed baselines from the freshly-opened viewers on the next event.
    const onHistoryClear = () => {
        if (pendingTimer !== null) { clearTimeout(pendingTimer); pendingTimer = null; }
        baselines.clear();
        baselinePayloads.clear();
        // Reseed lazily — viewer-create / visualization-ready will fire as the
        // pipeline rebuilds, but also reseed now in case those events already passed.
        setTimeout(reseedAll, 0);
    };
    history.addHandler?.("clear", onHistoryClear);

    VM.broadcastHandler("shader-config-update", onShaderUpdate);
    // Layer reorder doesn't always fire shader-config-update; also catch it.
    VM.broadcastHandler("shader-layer-order-changed", onLayerOrder);
    VM.addHandler?.("viewer-create", onViewerCreate);
    VM.addHandler?.("viewer-destroy", onViewerDestroy);
    VM.broadcastHandler("visualization-ready", onVisualizationReady);

    // Seed baselines for any viewers already alive at bootstrap time.
    reseedAll();

    return () => {
        if (pendingTimer !== null) clearTimeout(pendingTimer);
        VM.cancelBroadcast?.("shader-config-update", onShaderUpdate);
        VM.cancelBroadcast?.("shader-layer-order-changed", onLayerOrder);
        VM.cancelBroadcast?.("visualization-ready", onVisualizationReady);
        VM.removeHandler?.("viewer-create", onViewerCreate);
        VM.removeHandler?.("viewer-destroy", onViewerDestroy);
        history.removeHandler?.("clear", onHistoryClear);
        baselines.clear();
        baselinePayloads.clear();
    };
}
