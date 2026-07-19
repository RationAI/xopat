// Core SessionSyncProvider: visualization (data, shader layers, active goal)
// + viewer layout. State is broadcast via periodic config-hash polling so we
// don't depend on knowing every UI code path that mutates state.
//
// What the snapshot carries
//   - data, viewerCount, activeBackgroundIndex         (top-level config)
//   - background — clone of `config.background`; each entry carries its
//     `visualizationIndex` (per-slot viz binding)
//   - visualizations                                   (kept for shape check)
//   - viewerRenderState[uniqueId] = exportLiveVisualization(viewer)
//     where the per-viewer payload is the **live** renderer state from
//     `UTILITIES.exportLiveVisualization`: per-layer `cache` (where UI
//     controls persist values like opacity), `state`
//     (visible/use_mode/use_blend), `type`, and layer order. None of these
//     are reflected back into `APPLICATION_CONTEXT.config.visualizations`,
//     so the live state is the only source of truth.
//
// Apply
//   - light: `UTILITIES.importLiveVisualization(viewer, payload)` per
//     viewer — overwrites cache, applies state, swaps type via the renderer's
//     `_applyShaderConfigMutationRequest`, restores layer order, then
//     rebuilds. No `Loading` overlay.
//   - heavy: `APPLICATION_CONTEXT.openViewerWith` (full reopen) when the
//     number of viewers, the data array, the visualization shape, or any
//     layer's type differs. Followed by a light pass to restore per-viewer
//     cache on top.
//
// Echo-suppression: the polling tick skips emission while
// `applyingRemote` is true; per-viewer importLiveVisualization runs with
// `viewer.__sessionApplyingRemote=true` so the renderer's
// `shader-config-update` events fire-suppress.

type LiveViewerPayload = {
    layerOrder: string[];
    layers: Record<string, {
        id?: string;
        type: string;
        cache: Record<string, unknown>;
        state: Record<string, unknown>;
    }>;
};

type SnapshotPayload = {
    kind: "snapshot";
    data: unknown[];
    background: unknown[];
    visualizations: unknown[];
    activeBackgroundIndex: unknown;
    viewerCount: number;
    /** Per-viewer live renderer state, keyed by `viewer.uniqueId`. */
    viewerRenderState: Record<string, LiveViewerPayload | null>;
};

const POLL_MS = 250;

function captureSnapshot(): SnapshotPayload {
    const ctx: any = (globalThis as any).APPLICATION_CONTEXT;
    const cfg: any = (typeof ctx?._dangerouslyAccessConfig === "function"
        ? ctx._dangerouslyAccessConfig()
        : ctx?.config) || {};
    const vm: any = (globalThis as any).VIEWER_MANAGER;
    const U: any = (globalThis as any).UTILITIES;
    const viewers = Array.isArray(vm?.viewers) ? vm.viewers.filter(Boolean) : [];
    const viewerRenderState: Record<string, LiveViewerPayload | null> = {};
    for (const v of viewers) {
        if (!v?.uniqueId) continue;
        viewerRenderState[v.uniqueId] = typeof U?.exportLiveVisualization === "function"
            ? U.exportLiveVisualization(v) : null;
    }
    const activeBackgroundIndex = typeof ctx?.getOption === "function"
        ? ctx.getOption("activeBackgroundIndex", undefined, true, true)
        : undefined;
    return {
        kind: "snapshot",
        data: Array.isArray(cfg.data) ? JSON.parse(JSON.stringify(cfg.data)) : [],
        background: Array.isArray(cfg.background)
            ? JSON.parse(JSON.stringify(cfg.background))
            : [],
        visualizations: Array.isArray(cfg.visualizations)
            ? JSON.parse(JSON.stringify(cfg.visualizations))
            : [],
        activeBackgroundIndex: activeBackgroundIndex ?? undefined,
        viewerCount: viewers.length,
        viewerRenderState,
    };
}

// Expose a debug helper so the user can inspect the live state from
// devtools and confirm whether their UI action mutates it at all.
(globalThis as any).__sessionDumpViz = () => {
    const snap = captureSnapshot();
    const out = {
        viewerCount: snap.viewerCount,
        dataLen: snap.data.length,
        vizLen: snap.visualizations.length,
        activeBackgroundIndex: snap.activeBackgroundIndex,
        sigLen: signature(snap).length,
        renderState: snap.viewerRenderState,
        firstViz: snap.visualizations[0],
    };
    console.info("[viz-provider] __sessionDumpViz:", out);
    return out;
};

function signature(s: SnapshotPayload): string {
    return JSON.stringify({
        d: s.data,
        b: s.background,
        v: s.visualizations,
        a: s.activeBackgroundIndex,
        n: s.viewerCount,
        r: s.viewerRenderState,
    });
}

function dataSignature(data: unknown[]): string {
    return JSON.stringify(data);
}

/**
 * Decide whether the snapshot can be applied in place (cheap: write
 * cache/state into each viewer's live shader configs and rebuild) or
 * needs a full re-open (heavy: triggers Loading overlay).
 *
 * Light apply is correct only when the per-layer set + types match;
 * a different number of viewers, a different data array, a different
 * active visualization, a different visualization shape, or a layer
 * `type` change requires the heavy path so tile sources, drawers and
 * shader programs are rebuilt cleanly. (We still chain a light pass
 * after heavy to restore per-viewer cache.)
 */
function needsHeavyApply(next: SnapshotPayload): boolean {
    const ctx: any = (globalThis as any).APPLICATION_CONTEXT;
    const cfg: any = ctx?.config || {};
    const vm: any = (globalThis as any).VIEWER_MANAGER;
    const viewers = Array.isArray(vm?.viewers) ? vm.viewers.filter(Boolean) : [];
    if (viewers.length !== next.viewerCount) return true;
    const curData = Array.isArray(cfg.data) ? cfg.data : [];
    if (dataSignature(curData) !== dataSignature(next.data)) return true;
    const curActiveBg = typeof ctx?.getOption === "function"
        ? ctx.getOption("activeBackgroundIndex", undefined, true, true)
        : undefined;
    if (JSON.stringify(curActiveBg ?? null)
        !== JSON.stringify(next.activeBackgroundIndex ?? null)) return true;
    // Background entries carry `visualizationIndex` — diff them.
    const curBg = Array.isArray(cfg.background) ? cfg.background : [];
    const nextBg = Array.isArray(next.background) ? (next.background as any[]) : [];
    if (JSON.stringify(curBg) !== JSON.stringify(nextBg)) return true;
    // Structural shape: same number of visualizations, same layer ids per viz.
    const curViz: any[] = Array.isArray(cfg.visualizations) ? cfg.visualizations : [];
    const nextViz: any[] = Array.isArray(next.visualizations) ? (next.visualizations as any[]) : [];
    if (curViz.length !== nextViz.length) return true;
    for (let i = 0; i < curViz.length; i++) {
        if (shapeKey(curViz[i]) !== shapeKey(nextViz[i])) return true;
    }
    // Per-viewer: layer set or any layer's `type` differs.
    const U: any = (globalThis as any).UTILITIES;
    if (typeof U?.exportLiveVisualization === "function") {
        for (const v of viewers) {
            const remote = next.viewerRenderState?.[v.uniqueId];
            const local = U.exportLiveVisualization(v);
            if (!remote && !local) continue;
            if (!remote || !local) return true;
            const remoteKeys = Object.keys(remote.layers).sort();
            const localKeys = Object.keys(local.layers).sort();
            if (remoteKeys.join("/") !== localKeys.join("/")) return true;
            for (const k of remoteKeys) {
                if ((remote.layers[k]?.type || "") !== (local.layers[k]?.type || "")) return true;
            }
        }
    }
    return false;
}

/**
 * Stable key over a visualization's structural shape (layer ids and
 * nesting), independent of leaf parameter values like opacity or mode.
 */
function shapeKey(viz: any): string {
    const layers: any = viz?.shaders ?? viz?.layers ?? {};
    const walk = (m: any): any => {
        if (!m || typeof m !== "object") return null;
        const out: Record<string, any> = {};
        for (const k of Object.keys(m).sort()) {
            const v = m[k];
            if (v && typeof v === "object") {
                out[k] = { type: v.type, children: walk(v.shaders ?? v.layers ?? null) };
            }
        }
        return out;
    };
    return JSON.stringify(walk(layers));
}

async function applyHeavy(payload: SnapshotPayload): Promise<void> {
    const ctx: any = (globalThis as any).APPLICATION_CONTEXT;
    if (!ctx || typeof ctx.openViewerWith !== "function") return;
    // Per-viewer viz selection rides on the per-bg `visualizationIndex` in
    // payload.background; no separate vizSpec needed.
    await ctx.openViewerWith(
        payload.data,
        payload.background,
        payload.visualizations,
        payload.activeBackgroundIndex,
        undefined,
        {
            historyMode: "visualization-step",
            historyLabel: "session: apply visualization",
            strictVisualization: true,
        },
    );
    // After the reopen, restore per-viewer cache (opacity, mode, …) on top
    // of the freshly built renderers. openViewerWith only consumes the
    // static visualizations array, not the live cache.
    applyLight(payload);
}

function applyLight(payload: SnapshotPayload): void {
    const vm: any = (globalThis as any).VIEWER_MANAGER;
    const U: any = (globalThis as any).UTILITIES;
    if (typeof U?.importLiveVisualization !== "function") return;
    const viewers = Array.isArray(vm?.viewers) ? vm.viewers.filter(Boolean) : [];
    for (const viewer of viewers) {
        const live = payload.viewerRenderState?.[viewer.uniqueId];
        if (!live) continue;
        viewer.__sessionApplyingRemote = true;
        try {
            U.importLiveVisualization(viewer, live);
        } catch (e) {
            console.warn("[viz-provider] importLiveVisualization failed:", e);
        } finally {
            // Release on next frame so OSD/renderer events that fire
            // synchronously during rebuild are still suppressed.
            requestAnimationFrame(() => { viewer.__sessionApplyingRemote = false; });
        }
    }
}

export function makeVisualizationProvider(): SessionSyncProvider {
    let emit: ((delta: SessionDelta) => void) | null = null;
    let pollTimer: any = null;
    let lastSentSig = "";
    let applyingRemote = false;

    return {
        id: "core:visualization",
        scope: "global",
        priority: 10,

        snapshot: () => captureSnapshot(),

        async applySnapshot(data: SnapshotPayload) {
            applyingRemote = true;
            try {
                if (needsHeavyApply(data)) await applyHeavy(data);
                else applyLight(data);
            } finally {
                // Use the POST-apply local state as our baseline. The
                // bootstrap data may serialize subtly differently from
                // what `captureSnapshot()` emits after the parser fills
                // in default fields — using the local view here prevents
                // a spurious emit on the next polling tick.
                lastSentSig = signature(captureSnapshot());
                setTimeout(() => { applyingRemote = false; }, POLL_MS * 2);
            }
        },

        subscribe(emitFn) {
            emit = emitFn;
            const initial = captureSnapshot();
            lastSentSig = signature(initial);
            console.info(
                "[viz-provider] subscribe() — polling every", POLL_MS, "ms;",
                "initial sig.length=", lastSentSig.length,
                "viewers=", initial.viewerCount,
                "vizCount=", initial.visualizations.length,
            );

            const tryEmit = (reason: string, force = false) => {
                try {
                    if (!emit) { console.info("[viz-provider] tryEmit no emit fn"); return; }
                    if (applyingRemote) return;
                    const snap = captureSnapshot();
                    const sig = signature(snap);
                    if (!force && sig === lastSentSig) return;
                    console.info(
                        `[viz-provider] emit (${reason}); sig diff=${sig !== lastSentSig};`,
                        `oldLen=${lastSentSig.length} newLen=${sig.length} viewers=${snap.viewerCount}`,
                    );
                    lastSentSig = sig;
                    emit({
                        providerId: "core:visualization",
                        intentId: "",
                        sourceUserId: "",
                        kind: "snapshot",
                        payload: snap,
                    });
                } catch (e) {
                    console.error(`[viz-provider] tryEmit threw (${reason}):`, e);
                }
            };

            // Polling fallback — catches state mutations from any code
            // path that doesn't fire `shader-config-update`.
            let tickCount = 0;
            pollTimer = setInterval(() => {
                tickCount++;
                if (tickCount % 16 === 0) {
                    const snap = captureSnapshot();
                    console.info(`[viz-provider] tick=${tickCount} alive; sigLen=${signature(snap).length} viewers=${snap.viewerCount} applyingRemote=${applyingRemote}`);
                }
                tryEmit("poll");
            }, POLL_MS);

            // Fast path: every UI shader edit fires `shader-config-update`.
            // Capture a microtask later (so the renderer rebuild has
            // settled) and force-emit so we don't depend on poll cadence.
            const vm: any = (globalThis as any).VIEWER_MANAGER;
            const onShaderUpdate = (e: any) => {
                console.info(`[viz-provider] shader-config-update event layerId=${e?.layerId}`);
                Promise.resolve().then(() => tryEmit(`shader-update:${e?.layerId}`, /*force*/ true));
            };
            const broadcastFn = typeof vm?.broadcastHandler === "function"
                ? vm.broadcastHandler.bind(vm)
                : null;
            if (broadcastFn) broadcastFn("shader-config-update", onShaderUpdate);

            // Same for viewer-create / viewer-destroy: ensure layout-changes
            // propagate immediately rather than waiting up to POLL_MS.
            const onLayoutChange = () => {
                Promise.resolve().then(() => tryEmit("layout-change", /*force*/ true));
            };
            vm?.addHandler?.("viewer-create", onLayoutChange);
            vm?.addHandler?.("viewer-destroy", onLayoutChange);
            vm?.addHandler?.("viewer-reset", onLayoutChange);

            return () => {
                if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
                if (typeof vm?.cancelBroadcast === "function") {
                    vm.cancelBroadcast("shader-config-update", onShaderUpdate);
                }
                vm?.removeHandler?.("viewer-create", onLayoutChange);
                vm?.removeHandler?.("viewer-destroy", onLayoutChange);
                vm?.removeHandler?.("viewer-reset", onLayoutChange);
                emit = null;
                console.info("[viz-provider] unsubscribed");
            };
        },

        async applyDelta(delta: SessionDelta<SnapshotPayload>) {
            const payload = delta.payload;
            if (!payload || payload.kind !== "snapshot") {
                console.warn("[viz-provider] applyDelta: payload missing or wrong kind", payload?.kind);
                return;
            }
            const incomingSig = signature(payload);
            const currentSig = signature(captureSnapshot());
            // Already in sync — skip the apply entirely. This prevents the
            // round-trip storm where each side emits a snapshot, the other
            // applies it (re-rendering the page), then re-emits in turn.
            if (incomingSig === currentSig) {
                lastSentSig = currentSig;
                return;
            }
            const heavy = needsHeavyApply(payload);
            console.info(
                "[viz-provider] applyDelta — heavy =", heavy,
                "fromSeq =", delta.seq,
                "remoteViewerCount =", payload.viewerCount,
            );
            applyingRemote = true;
            try {
                if (heavy) await applyHeavy(payload);
                else applyLight(payload);
            } catch (e) {
                console.error("[viz-provider] applyDelta failed:", e);
            } finally {
                lastSentSig = signature(captureSnapshot());
                setTimeout(() => { applyingRemote = false; }, POLL_MS * 2);
            }
        },
    };
}
