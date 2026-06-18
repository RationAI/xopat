import type { ViewerLikeRecord } from "./types";

/**
 * Region-of-interest capture, encapsulating ALL annotations-module specifics so
 * the designer/runtime never reach into the module directly (AGENTS.md: couple
 * low-level details together). The module is consulted conditionally — every
 * entry point degrades to a no-op when annotations are not loaded.
 *
 * Strategy: rather than drive the module's draw-mode/preset/factory machinery
 * (fragile, version-specific), we *consume* whatever the user draws with the
 * existing annotation tools — capture the single selected annotation, serialize
 * it, and store the result as the answer. "Show" re-focuses/zooms to it later.
 */

// The OSDAnnotations singleton is an untyped global module here.
type FabricWrapper = {
  canvas?: { getObjects?: () => unknown[] };
  getSelectedAnnotations?: () => any[];
  /** Highlight + zoom to a live annotation object (multi-image safe). */
  focusObjectOrArea?: (object: unknown, incrementId?: number, adjustZoom?: boolean) => unknown;
  /** Zoom to a plain image-space bbox (multi-image safe). */
  focusArea?: (bbox: { left: number; top: number; width: number; height: number }, incrementId?: number, adjustZoom?: boolean) => unknown;
};
type AnnotationsModule = {
  getFabric?: (viewer: unknown) => FabricWrapper | undefined;
  /** Active-viewer fabric wrapper (fallback when no viewer list is available). */
  fabric?: FabricWrapper;
};

export function annotationsModule(): AnnotationsModule | undefined {
  // `window.xmodules` holds module *class exports*, not instances — `getFabric` /
  // `getSelectedAnnotations` are instance methods, so we must resolve the live
  // singleton via the loader's `singletonModule(id)` helper (lazy-instantiates
  // if needed). Falling back to the raw export here would silently no-op.
  const win = window as unknown as { singletonModule?: (id: string) => AnnotationsModule | undefined };
  return win.singletonModule?.("annotations");
}

export function isAnnotationsAvailable(): boolean {
  return !!annotationsModule();
}

export type CapturedRegion = {
  incrementId?: number;
  factoryID?: string;
  bounds?: { left: number; top: number; width: number; height: number };
  /** Serialized fabric object (geometry); portable JSON for the IO pipeline. */
  object?: unknown;
  viewerId?: string;
  capturedAt?: string;
};

/** Find the single selected annotation across the given viewers and serialize it. */
export function captureSelectedRegion(viewers: ViewerLikeRecord[]): CapturedRegion | undefined {
    debugger;
  const module = annotationsModule();
  if (!module) return undefined;
  // Probe each known viewer's fabric wrapper; fall back to the module's active
  // fabric so capture still works when the viewer map is empty (e.g. the plugin
  // mounted before any viewer-create event was observed).
  const candidates: Array<{ fabric: FabricWrapper | undefined; viewerId?: string }> =
    viewers.map((rec) => ({ fabric: module.getFabric?.(rec.viewer), viewerId: rec.uniqueId }));
  if (module.fabric) candidates.push({ fabric: module.fabric, viewerId: viewers[0]?.uniqueId });
  for (const { fabric, viewerId } of candidates) {
    const selected = fabric?.getSelectedAnnotations?.() || [];
    if (selected.length === 1) {
      const obj = selected[0] as { incrementId?: number; factoryID?: string; toObject?: () => unknown; getBoundingRect?: (a: boolean, b: boolean) => { left: number; top: number; width: number; height: number } };
      let object: unknown;
      try { object = obj.toObject?.(); } catch { object = undefined; }
      let bounds: CapturedRegion["bounds"];
      try { const r = obj.getBoundingRect?.(true, true); if (r) bounds = { left: r.left, top: r.top, width: r.width, height: r.height }; } catch { /* ignore */ }
      return { incrementId: obj.incrementId, factoryID: obj.factoryID, bounds, object, viewerId, capturedAt: new Date().toISOString() };
    }
  }
  return undefined;
}

/** Focus and/or zoom to a previously captured region on the matching (or first) viewer. */
export function showRegion(viewers: ViewerLikeRecord[], region: CapturedRegion): boolean {
  const module = annotationsModule();
  if (!module || !region) return false;
  const rec = viewers.find((v) => v.uniqueId === region.viewerId) || viewers[0];
  if (!rec) return false;
  const fabric = module.getFabric?.(rec.viewer);
  if (!fabric) return false;

  // Delegate the zoom/highlight to the module's own focus API — it converts
  // image-space bounds with TiledImage.imageToViewportRectangle, which is the
  // multi-image-correct transform (Viewport.* warns and is inaccurate here).
  const existing = region.incrementId != null
    ? (fabric.canvas?.getObjects?.() || []).find((o) => (o as { incrementId?: number }).incrementId === region.incrementId)
    : undefined;
  if (existing && fabric.focusObjectOrArea) {
    fabric.focusObjectOrArea(existing);
    return true;
  }
  // No live object on canvas (e.g. captured in another session) — fall back to
  // the stored image-space bounds (copied: focusArea mutates the bbox in place).
  if (region.bounds && fabric.focusArea) {
    fabric.focusArea({ ...region.bounds });
    return true;
  }
  return false;
}

export function describeRegion(region: CapturedRegion | undefined): string {
  if (!region || (!region.bounds && region.incrementId == null)) return "No region captured yet.";
  const b = region.bounds;
  const size = b ? `${Math.round(b.width)}×${Math.round(b.height)} px` : "region";
  return `Captured ${region.factoryID || "annotation"} #${region.incrementId ?? "?"} (${size}).`;
}
