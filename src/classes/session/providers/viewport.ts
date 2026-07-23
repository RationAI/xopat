// Core SessionSyncProvider: viewport (pan/zoom/rotation) per viewer.
// Attaches to every existing and future OSD viewer via VIEWER_MANAGER.broadcastHandler.
// See src/SESSION.md.

import { applyViewport } from "../../app/canonical-scene";

// Compact wire format; the OSD write path goes through the canonical
// `applyViewport` helper (canonical-scene.ts). The read path intentionally
// keeps `getZoom(true)` (current, not target) — echo suppression needs the
// live value, which differs from the canonical snapshot's target zoom.
type ViewportPayload = { cx: number; cy: number; zoom: number; rot: number };

const EPSILON = 1e-6;

function nearlyEqual(a: number, b: number) {
    return Math.abs(a - b) < EPSILON;
}

function readState(viewer: any): ViewportPayload | null {
    const vp = viewer?.viewport;
    if (!vp || typeof vp.getCenter !== "function") return null;
    const c = vp.getCenter();
    return {
        cx: c.x,
        cy: c.y,
        zoom: vp.getZoom(true),
        rot: typeof vp.getRotation === "function" ? vp.getRotation() : 0,
    };
}

export function makeViewportProvider(): SessionSyncProvider {
    // Per-viewer state used to suppress echo + detect meaningful change.
    const applying = new Map<string, boolean>();
    const lastSent = new Map<string, ViewportPayload>();
    const rafPending = new Map<string, number>();

    let emit: ((delta: SessionDelta) => void) | null = null;

    const attach = (viewer: any) => {
        const id: string = viewer.uniqueId;
        if (!id) return;

        const onAnimation = () => {
            if (applying.get(id)) return;
            // Coalesce to next frame so we emit at most once per rAF per viewer.
            if (rafPending.has(id)) return;
            const handle = requestAnimationFrame(() => {
                rafPending.delete(id);
                const state = readState(viewer);
                if (!state || !emit) return;
                const prev = lastSent.get(id);
                if (
                    prev &&
                    nearlyEqual(prev.cx, state.cx) &&
                    nearlyEqual(prev.cy, state.cy) &&
                    nearlyEqual(prev.zoom, state.zoom) &&
                    nearlyEqual(prev.rot, state.rot)
                ) {
                    return;
                }
                lastSent.set(id, state);
                emit({
                    providerId: "core:viewport",
                    viewerUniqueId: id,
                    intentId: "",            // filled by session-sync
                    sourceUserId: "",        // filled by session-sync
                    kind: "set",
                    payload: state,
                });
            });
            rafPending.set(id, handle);
        };

        viewer.addHandler("animation", onAnimation);
        viewer.__sessionViewportHandler = onAnimation;
    };

    const detach = (viewer: any) => {
        const h = viewer.__sessionViewportHandler;
        if (h) {
            viewer.removeHandler("animation", h);
            delete viewer.__sessionViewportHandler;
        }
        const handle = rafPending.get(viewer.uniqueId);
        if (handle) {
            cancelAnimationFrame(handle);
            rafPending.delete(viewer.uniqueId);
        }
    };

    return {
        id: "core:viewport",
        scope: "per-viewer",
        priority: 20,

        snapshot(viewer?: any) {
            if (viewer) return readState(viewer);
            const out: Record<string, ViewportPayload | null> = {};
            const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];
            for (const v of viewers) if (v?.uniqueId) out[v.uniqueId] = readState(v);
            return out;
        },

        async applySnapshot(data: any, viewer?: any) {
            if (viewer) {
                await applyTo(viewer, data, applying);
                return;
            }
            const viewers = (globalThis as any).VIEWER_MANAGER?.viewers || [];
            for (const v of viewers) {
                if (v?.uniqueId && data?.[v.uniqueId]) {
                    await applyTo(v, data[v.uniqueId], applying);
                }
            }
        },

        subscribe(emitFn) {
            emit = emitFn;
            const vm: any = (globalThis as any).VIEWER_MANAGER;
            if (!vm) return () => { emit = null; };

            // Attach to existing viewers.
            for (const v of vm.viewers || []) attach(v);
            // And future ones.
            const onCreate = (e: any) => attach(e.viewer || e.eventSource);
            const onDestroy = (e: any) => detach(e.viewer || e.eventSource);
            vm.addHandler?.("viewer-create", onCreate);
            vm.addHandler?.("viewer-destroy", onDestroy);

            return () => {
                emit = null;
                vm.removeHandler?.("viewer-create", onCreate);
                vm.removeHandler?.("viewer-destroy", onDestroy);
                for (const v of vm.viewers || []) detach(v);
                for (const h of rafPending.values()) cancelAnimationFrame(h);
                rafPending.clear();
                lastSent.clear();
                applying.clear();
            };
        },

        async applyDelta(delta: SessionDelta<ViewportPayload>, meta: SessionApplyMeta) {
            const id = delta.viewerUniqueId;
            if (!id) return;
            const vm: any = (globalThis as any).VIEWER_MANAGER;
            const viewer = vm?.viewers?.find((v: any) => v?.uniqueId === id);
            if (!viewer) return;
            await applyTo(viewer, delta.payload, applying, meta.bootstrap === false);
            lastSent.set(id, delta.payload);
        },
    };
}

async function applyTo(
    viewer: any,
    state: ViewportPayload,
    applying: Map<string, boolean>,
    animate = false,
) {
    if (!viewer?.viewport || !state) return;
    const id: string = viewer.uniqueId;
    applying.set(id, true);
    try {
        applyViewport(viewer, {
            zoomLevel: state.zoom,
            point: { x: state.cx, y: state.cy },
            rotation: state.rot,
        }, animate);
    } finally {
        // Release on next frame so OSD's animation event has fired.
        requestAnimationFrame(() => applying.set(id, false));
    }
}
