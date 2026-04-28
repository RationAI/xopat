// Core SessionSyncProvider: peer cursors, scoped per-viewer.
// Tracks the local mouse in image coordinates, throttles to ~30 Hz,
// and renders remote peers' cursors as OSD overlays tinted by their
// assigned HSL color. Bootstrap is a no-op (cursors are transient).

type CursorPayload = {
    x: number;      // image-space x
    y: number;      // image-space y
    visible: boolean;
};

const THROTTLE_MS = 1000 / 30;

function makeOverlayEl(color: string, name: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "xopat-session-peer-cursor";
    el.style.pointerEvents = "none";
    el.style.position = "absolute";
    el.style.transform = "translate(-50%, -50%)";
    el.style.zIndex = "1000";
    el.innerHTML = `
        <div style="width:10px;height:10px;border-radius:50%;background:${color};box-shadow:0 0 0 2px rgba(255,255,255,0.7);"></div>
        <div style="position:absolute;top:8px;left:10px;padding:1px 4px;font-size:10px;line-height:1.2;color:white;background:${color};border-radius:2px;white-space:nowrap;">${escapeHtml(name)}</div>
    `;
    return el;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function makeCursorProvider(getLocalPeer: () => SessionPeer | null,
                                   getPeer: (userId: string) => SessionPeer | null): SessionSyncProvider {
    let emit: ((delta: SessionDelta) => void) | null = null;
    let lastEmit = 0;
    const trackers: Map<string, { viewer: any; handler: (e: MouseEvent) => void; leave: () => void }> = new Map();
    // peerId → viewerUniqueId → overlay element
    const overlays: Map<string, Map<string, HTMLElement>> = new Map();

    const attach = (viewer: any) => {
        const id: string = viewer.uniqueId;
        const el: HTMLElement | undefined = viewer.canvas || viewer.element;
        if (!id || !el) {
            console.warn("[cursor] attach skipped — no id/el; uniqueId=", id, "canvas=", !!viewer.canvas, "element=", !!viewer.element);
            return;
        }
        if (trackers.has(id)) return;
        console.info(`[cursor] attached tracker to viewer uniqueId=${id}`);

        const send = (x: number, y: number, visible: boolean) => {
            if (!emit) return;
            const now = performance.now();
            if (now - lastEmit < THROTTLE_MS) return;
            lastEmit = now;
            emit({
                providerId: "core:cursor",
                viewerUniqueId: id,
                intentId: "",
                sourceUserId: "",
                kind: "move",
                payload: { x, y, visible },
            });
        };

        const onMove = (e: MouseEvent) => {
            const rect = el.getBoundingClientRect();
            const pixel = new (globalThis as any).OpenSeadragon.Point(
                e.clientX - rect.left,
                e.clientY - rect.top,
            );
            const imgPoint = viewer.viewport?.viewerElementToImageCoordinates(pixel);
            if (!imgPoint) return;
            send(imgPoint.x, imgPoint.y, true);
        };
        const onLeave = () => send(0, 0, false);

        el.addEventListener("mousemove", onMove);
        el.addEventListener("mouseleave", onLeave);
        trackers.set(id, {
            viewer,
            handler: onMove,
            leave: () => {
                el.removeEventListener("mousemove", onMove);
                el.removeEventListener("mouseleave", onLeave);
            },
        });
    };

    const detach = (viewer: any) => {
        const t = trackers.get(viewer.uniqueId);
        if (t) {
            t.leave();
            trackers.delete(viewer.uniqueId);
        }
    };

    const ensureOverlay = (peerId: string, viewer: any): HTMLElement | null => {
        const peer = getPeer(peerId);
        if (!peer) return null;
        let byViewer = overlays.get(peerId);
        if (!byViewer) {
            byViewer = new Map();
            overlays.set(peerId, byViewer);
        }
        let el = byViewer.get(viewer.uniqueId);
        if (!el) {
            el = makeOverlayEl(peer.color, peer.userName);
            byViewer.set(viewer.uniqueId, el);
            try {
                viewer.addOverlay({
                    element: el,
                    location: new (globalThis as any).OpenSeadragon.Point(0, 0),
                    placement: (globalThis as any).OpenSeadragon.Placement?.CENTER ?? "CENTER",
                });
            } catch (e) {
                console.warn("[SESSION] failed to attach cursor overlay:", e);
            }
        }
        return el;
    };

    const removePeerOverlays = (peerId: string) => {
        const byViewer = overlays.get(peerId);
        if (!byViewer) return;
        const vm: any = (globalThis as any).VIEWER_MANAGER;
        for (const [viewerId, el] of byViewer.entries()) {
            const viewer = vm?.viewers?.find((v: any) => v?.uniqueId === viewerId);
            try { viewer?.removeOverlay(el); } catch { /* ignore */ }
        }
        overlays.delete(peerId);
    };

    return {
        id: "core:cursor",
        scope: "per-viewer",
        priority: 100, // cursors apply last; they don't affect other providers

        snapshot: () => null,           // cursors are transient
        applySnapshot: () => { /* no-op */ },

        subscribe(emitFn) {
            emit = emitFn;
            const vm: any = (globalThis as any).VIEWER_MANAGER;
            if (!vm) return () => { emit = null; };

            for (const v of vm.viewers || []) attach(v);
            const onCreate = (e: any) => attach(e.viewer || e.eventSource);
            const onDestroy = (e: any) => detach(e.viewer || e.eventSource);
            vm.addHandler?.("viewer-create", onCreate);
            vm.addHandler?.("viewer-destroy", onDestroy);

            const onPeerDropped = (e: any) => {
                if (e?.peer?.userId) removePeerOverlays(e.peer.userId);
            };
            const session: any = (globalThis as any).SESSION;
            session?.addHandler?.("session-peer-dropped", onPeerDropped);

            return () => {
                emit = null;
                vm.removeHandler?.("viewer-create", onCreate);
                vm.removeHandler?.("viewer-destroy", onDestroy);
                session?.removeHandler?.("session-peer-dropped", onPeerDropped);
                for (const v of vm.viewers || []) detach(v);
                for (const peerId of Array.from(overlays.keys())) removePeerOverlays(peerId);
            };
        },

        applyDelta(delta: SessionDelta<CursorPayload>) {
            const local = getLocalPeer();
            if (!delta.viewerUniqueId) return;
            if (local && delta.sourceUserId === local.userId) return; // never render our own
            const vm: any = (globalThis as any).VIEWER_MANAGER;
            const viewer = vm?.viewers?.find((v: any) => v?.uniqueId === delta.viewerUniqueId);
            if (!viewer) {
                console.warn(`[cursor] applyDelta: no local viewer for uniqueId=${delta.viewerUniqueId}; have:`,
                    (vm?.viewers || []).map((v: any) => v?.uniqueId));
                return;
            }
            const el = ensureOverlay(delta.sourceUserId, viewer);
            if (!el) {
                console.warn(`[cursor] applyDelta: no overlay element for peer=${delta.sourceUserId}`);
                return;
            }
            if (!delta.payload.visible) {
                el.style.display = "none";
                return;
            }
            el.style.display = "";
            try {
                viewer.updateOverlay(
                    el,
                    new (globalThis as any).OpenSeadragon.Point(delta.payload.x, delta.payload.y),
                );
            } catch (e) {
                console.warn("[cursor] updateOverlay failed:", e);
            }
        },
    };
}
