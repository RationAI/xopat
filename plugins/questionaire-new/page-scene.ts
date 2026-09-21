import type { QuestionnairePageRecordingBinding, QuestionnairePageScene, ViewerLikeRecord } from "./types";
import { clone, tRaw } from "./utils";

type ViewerIOContext = { uniqueId?: string; title?: string; fileName?: string };

function getViewerContext(viewer: OpenSeadragon.Viewer): ViewerIOContext | undefined {
  try {
    return (UTILITIES as typeof UTILITIES & {
      getViewerIOContext?: (viewerOrUniqueId: OpenSeadragon.Viewer | UniqueViewerId, stripSuffix?: boolean) => ViewerIOContext | undefined;
    }).getViewerIOContext?.(viewer, true);
  } catch {
    return undefined;
  }
}

/**
 * Content-derived viewer key mirroring the recorder's `viewerContextKey`
 * (title → fileName → uniqueId) so bindings can re-attach to "the viewer
 * showing this slide" even when uniqueIds regenerate across sessions.
 */
function viewerContextKey(viewer: OpenSeadragon.Viewer): string | undefined {
  const context = getViewerContext(viewer);
  return context?.title || context?.fileName || viewer.uniqueId || undefined;
}

function viewerTitle(record: ViewerLikeRecord): string {
  const context = getViewerContext(record.viewer);
  return context?.title || context?.fileName || record.viewer.uniqueId || `Viewer ${record.index + 1}`;
}

/**
 * Snapshot the live session through the core canonical-scene API
 * (`APPLICATION_CONTEXT.scene`) — multi-viewer slot layout, per-bg
 * visualization binding, live shader state, and per-viewer viewports all
 * come from core; this module only decorates the result with display
 * metadata (viewer titles, capture time).
 */
export function captureCurrentPageScene(viewers: ViewerLikeRecord[]): QuestionnairePageScene {
  const scene = APPLICATION_CONTEXT.scene.serialize({ includeViewport: true }) as QuestionnairePageScene;
  scene.viewerCount = viewers.length || undefined;
  scene.viewerTitles = viewers.map(viewerTitle);
  scene.capturedAt = new Date().toISOString();
  return scene;
}

/**
 * Cheap structural fingerprint of what a scene opens (slides, per-slot
 * selection, per-bg visualization binding) — intentionally ignores viewports
 * and live shader tweaks so "the same content is already open" can be
 * detected without diffing the full canonical payload.
 */
export function sceneContentFingerprint(scene: Partial<QuestionnairePageScene> | undefined): string {
  if (!scene || typeof scene !== "object") return "";
  const background = Array.isArray(scene.background) ? scene.background : [];
  return JSON.stringify({
    data: Array.isArray(scene.data) ? scene.data : [],
    bgIds: background.map((bg: any) => bg?.id ?? bg?.dataReference ?? null),
    viz: background.map((bg: any) => bg?.visualizationIndex ?? null),
    active: scene.activeBackgroundIndex ?? null,
  });
}

/** True when the live viewer session already shows the scene's content. */
export function currentSceneMatches(scene: QuestionnairePageScene | undefined): boolean {
  if (!scene) return false;
  try {
    return sceneContentFingerprint(APPLICATION_CONTEXT.scene.serialize() as QuestionnairePageScene)
      === sceneContentFingerprint(scene);
  } catch {
    return false;
  }
}

/** Restore only the per-viewer viewports recorded in a scene (content untouched). */
export function applySceneViewports(scene: QuestionnairePageScene): void {
  const overlays = Array.isArray(scene.viewers) ? scene.viewers : [];
  if (!overlays.length) return;
  const liveViewers = (VIEWER_MANAGER?.viewers || []).filter(Boolean);
  overlays.forEach((overlay, index) => {
    if (!overlay?.viewport) return;
    const target = liveViewers.find((v: any) => v?.uniqueId === overlay.uniqueId) ?? liveViewers[index];
    if (target) APPLICATION_CONTEXT.scene.applyViewport(target, overlay.viewport);
  });
}

/**
 * Unconditional full canonical restore — reopens slides/layout even when the
 * content fingerprint matches. The caller owns the fast path: when
 * `currentSceneMatches(scene)`, prefer `applySceneViewports(scene)` (no
 * reopen, no flicker) — the plugin's prompt gating needs that decision
 * outside this helper.
 */
export async function applyPageSceneFull(scene: QuestionnairePageScene): Promise<void> {
  await APPLICATION_CONTEXT.scene.deserialize(clone(scene), {
    historyMode: "content-switch",
  });
}

export function getRecorderModule(): RecorderModule | undefined {
  // Resolve the live singleton via the loader helper (lazy-instantiates when
  // the module is available) — `window.xmodules` holds class exports, not
  // instances, and would silently no-op here.
  const win = window as unknown as { singletonModule?: (id: string) => RecorderModule | undefined };
  return win.singletonModule?.("recorder");
}

/** Recordings offered in the designer picker: user-authored, non-empty. */
export function listViewerRecordings(recorder: RecorderModule, viewerId: UniqueViewerId): RecorderRecording[] {
  try {
    return recorder.listRecordings(viewerId).filter((r) => !r.transient && r.steps.length > 0);
  } catch {
    return [];
  }
}

/** Collect the ids of every binary asset the steps' overlays reference. */
function referencedAssetIds(steps: RecorderSnapshotStep[]): string[] {
  const ids = new Set<string>();
  for (const step of steps) {
    for (const overlay of step?.overlays ?? []) {
      if (!overlay) continue;
      if (overlay.kind === "composite" && overlay.imageAssetId) ids.add(overlay.imageAssetId);
      else if ((overlay.kind === "image" || overlay.kind === "audio") && overlay.assetId) ids.add(overlay.assetId);
    }
  }
  return Array.from(ids);
}

/**
 * Snapshot a named recorder recording into a page binding: a reference
 * (`recordingId` + `recordingUpdatedAt`, for staleness/Refresh) plus an
 * embedded copy of the steps and ONLY the overlay assets they reference, so
 * the questionnaire bundle replays standalone. Non-destructive — the
 * recorder keeps the original.
 */
export function snapshotRecordingBinding(
  recorder: RecorderModule,
  viewerId: UniqueViewerId,
  recording: RecorderRecording,
  slotIndex: number,
  previous?: QuestionnairePageRecordingBinding,
): QuestionnairePageRecordingBinding {
  const viewer = VIEWER_MANAGER?.viewers?.find((v: any) => v?.uniqueId === viewerId);
  const assets = referencedAssetIds(recording.steps)
    .map((id) => recorder.getAsset(id))
    .filter((asset): asset is RecorderAsset => !!asset);
  return {
    id: previous?.id ?? `binding_${slotIndex}`,
    slotIndex,
    viewerUniqueId: viewerId,
    viewerContextKey: (viewer && viewerContextKey(viewer)) || recording.viewerContextKey,
    viewerTitle: recording.viewerTitle || (viewer && viewerContextKey(viewer)) || undefined,
    recordingId: recording.id,
    recordingName: recording.name,
    recordingUpdatedAt: recording.updatedAt ?? recording.createdAt,
    backgroundId: recording.backgroundId,
    steps: clone(recording.steps),
    stepCount: recording.steps.length,
    assets: assets.length ? clone(assets) : undefined,
    capturedAt: new Date().toISOString(),
    autoplay: previous?.autoplay ?? false,
  };
}

/**
 * Find the live viewer a binding belongs to. UniqueIds regenerate across
 * sessions, so fall back from the capture-time id to the slot position and
 * finally to the content-derived context key.
 */
export function resolveBindingViewer(binding: QuestionnairePageRecordingBinding): OpenSeadragon.Viewer | undefined {
  const viewers = ((VIEWER_MANAGER?.viewers || []) as OpenSeadragon.Viewer[]).filter(Boolean);
  if (!viewers.length) return undefined;
  if (binding.viewerUniqueId) {
    const byId = viewers.find((v: any) => v?.uniqueId === binding.viewerUniqueId);
    if (byId) return byId;
  }
  if (Number.isInteger(binding.slotIndex) && viewers[binding.slotIndex]) return viewers[binding.slotIndex];
  if (binding.viewerContextKey) {
    return viewers.find((v) => viewerContextKey(v) === binding.viewerContextKey);
  }
  return undefined;
}

/**
 * Upsert a binding's embedded snapshot into the recorder as a transient
 * recording (excluded from the user's recorder persistence) and make it the
 * viewer's active recording. Deterministic id ⇒ repeated page visits replace
 * rather than duplicate. Returns the target viewer id, or undefined when no
 * live viewer resolves.
 */
export function loadBindingIntoRecorder(
  recorder: RecorderModule,
  binding: QuestionnairePageRecordingBinding,
  pageId: string,
): UniqueViewerId | undefined {
  const viewer = resolveBindingViewer(binding);
  const viewerId = viewer?.uniqueId as UniqueViewerId | undefined;
  if (!viewerId) return undefined;
  const loaded = recorder.upsertRecording(viewerId, {
    id: `qn:${pageId}:${binding.id}`,
    name: binding.recordingName,
    backgroundId: binding.backgroundId,
    viewerContextKey: binding.viewerContextKey,
    viewerTitle: binding.viewerTitle,
    createdAt: Date.now(),
    steps: clone(binding.steps),
  }, { assets: binding.assets ? clone(binding.assets) : undefined, activate: true, transient: true });
  return loaded ? viewerId : undefined;
}

/** Approximate serialized footprint of a binding (steps + embedded assets). */
export function bindingByteSize(binding: QuestionnairePageRecordingBinding): number {
  try {
    return JSON.stringify(binding).length;
  } catch {
    return 0;
  }
}

export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

export function describePageScene(scene: QuestionnairePageScene | undefined): string {
  if (!scene) return $.t("questionaire:scene.none");
  const viewers = scene.viewerTitles?.length
    ? scene.viewerTitles.join(", ")
    : $.t("questionaire:scene.viewerCount", { count: scene.viewerCount || (scene.viewers?.length ?? 0) || 1 });
  const when = scene.capturedAt ? formatCapturedAt(scene.capturedAt) : undefined;
  return when
    ? tRaw("questionaire:scene.summaryWithDate", { viewers, date: when })
    : tRaw("questionaire:scene.summary", { viewers });
}

/** Human-readable local date-time for a stored ISO timestamp. */
export function formatCapturedAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

export function describeRecordingBinding(binding: QuestionnairePageRecordingBinding): string {
  const base = tRaw("questionaire:recordings.summary", {
    name: binding.recordingName,
    count: binding.stepCount,
    size: formatByteSize(bindingByteSize(binding)),
  });
  const when = formatCapturedAt(binding.capturedAt);
  return when ? `${base} ${tRaw("questionaire:savedAt", { date: when })}` : base;
}
