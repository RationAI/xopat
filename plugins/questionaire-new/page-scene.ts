import type { QuestionnairePageAnimation, QuestionnairePageScene, ViewerLikeRecord } from "./types";
import { clone } from "./utils";

function viewerTitle(record: ViewerLikeRecord): string {
  try {
    const context = (UTILITIES as typeof UTILITIES & {
      getViewerIOContext?: (viewerOrUniqueId: OpenSeadragon.Viewer | UniqueViewerId, stripSuffix?: boolean) => {
        uniqueId?: string;
        title?: string;
        fileName?: string;
      } | undefined;
    }).getViewerIOContext?.(record.viewer, true);
    return context?.title || context?.fileName || record.viewer.uniqueId || `Viewer ${record.index + 1}`;
  } catch {
    return record.viewer.uniqueId || `Viewer ${record.index + 1}`;
  }
}

export function captureCurrentPageScene(viewers: ViewerLikeRecord[]): QuestionnairePageScene {
  return {
    data: clone(Array.isArray(APPLICATION_CONTEXT.config.data) ? APPLICATION_CONTEXT.config.data : []),
    background: clone(Array.isArray(APPLICATION_CONTEXT.config.background) ? APPLICATION_CONTEXT.config.background : []),
    visualizations: clone(Array.isArray(APPLICATION_CONTEXT.config.visualizations) ? APPLICATION_CONTEXT.config.visualizations : []),
    activeBackgroundIndex: clone(APPLICATION_CONTEXT.getOption("activeBackgroundIndex", null, true, true)),
    activeVisualizationIndex: clone(APPLICATION_CONTEXT.getOption("activeVisualizationIndex", null, true, true)),
    viewerCount: viewers.length || undefined,
    viewerTitles: viewers.map(viewerTitle),
    capturedAt: new Date().toISOString(),
  };
}

export async function applyPageScene(scene: QuestionnairePageScene): Promise<boolean> {
  return APPLICATION_CONTEXT.openViewerWith(
    clone(scene.data || []),
    clone(scene.background || []),
    clone(scene.visualizations || []),
    scene.activeBackgroundIndex ?? null,
    scene.activeVisualizationIndex ?? null,
    {
      deriveOverlayFromBackgroundGoals: true,
      historyMode: "content-switch",
      preserveHistoryOnBackgroundChange: true,
    },
  );
}

export function getRecorderModule(): RecorderModule | undefined {
  const win = window as Window & { xmodules: Record<string, unknown> };
  return win.xmodules["recorder-module"] as RecorderModule | undefined;
}

export function captureRecorderSession(recorder: RecorderModule | undefined): QuestionnairePageAnimation | undefined {
  if (!recorder) return undefined;
  const steps = recorder.exportJSON(false);
  if (!Array.isArray(steps) || !steps.length) return undefined;
  const viewerTitles = Array.from(new Set(steps.map((step) => step.viewerTitle || step.viewerContextKey || step.viewerId).filter(Boolean) as string[]));
  return { steps: clone(steps), stepCount: steps.length, capturedAt: new Date().toISOString(), autoplay: false, viewerTitles };
}

export function applyPageAnimationToRecorder(recorder: RecorderModule | undefined, animation: QuestionnairePageAnimation, autoplay = false): void {
  if (!recorder || !animation.steps.length) return;
  recorder.importJSON(clone(animation.steps));
  if (autoplay) recorder.playFromIndex(0);
  else recorder.goToIndex(0);
}

export function describePageScene(scene: QuestionnairePageScene | undefined): string {
  if (!scene) return "No saved viewer setup.";
  const bg = Array.isArray(scene.activeBackgroundIndex) ? scene.activeBackgroundIndex.join(", ") : (scene.activeBackgroundIndex ?? "default");
  const viz = Array.isArray(scene.activeVisualizationIndex) ? scene.activeVisualizationIndex.join(", ") : (scene.activeVisualizationIndex ?? "default");
  const viewers = scene.viewerTitles?.length ? scene.viewerTitles.join(", ") : `${scene.viewerCount || 0} viewer(s)`;
  return `Captured ${viewers}. Active backgrounds: ${bg}. Active visualizations: ${viz}.${scene.capturedAt ? ` Saved ${scene.capturedAt}.` : ""}`;
}

export function describePageAnimation(animation: QuestionnairePageAnimation | undefined): string {
  if (!animation) return "No saved animation.";
  const viewers = animation.viewerTitles?.length ? animation.viewerTitles.join(", ") : "recorded viewer set";
  return `${animation.stepCount} recorded step(s) for ${viewers}.${animation.autoplay ? " Autoplay is enabled." : " Autoplay is off."}${animation.capturedAt ? ` Saved ${animation.capturedAt}.` : ""}`;
}
