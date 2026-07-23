/** Stored answer of a "file" element — content embedded as a data URL. */
export type QuestionnaireFileValue = {
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
};

export type QuestionnaireValue =
  | string
  | number
  | boolean
  | string[]
  | QuestionnaireAnswers[]
  | Record<string, string>
  | QuestionnaireFileValue
  | QuestionnaireFileValue[]
  | null
  | undefined;

export type QuestionnaireAnswers = Record<string, QuestionnaireValue>;
export type QuestionnaireOption = { value: string; label: string };

export type QuestionnaireSimpleCondition =
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; field: string; value?: QuestionnaireValue }
  | { op: "empty" | "notEmpty"; field: string }
  | { op: "in" | "notIn"; field: string; value?: QuestionnaireValue | QuestionnaireValue[] };

export type QuestionnaireCondition =
  | QuestionnaireSimpleCondition
  | { op: "and" | "or"; args: QuestionnaireCondition[] };

export type QuestionnaireValidation = {
  required?: boolean;
  requiredWhen?: QuestionnaireCondition;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  message?: string;
};

export type QuestionnaireBaseElement = {
  id: string;
  kind:
    | "text"
    | "textarea"
    | "number"
    | "email"
    | "date"
    | "tel"
    | "url"
    | "select"
    | "multiselect"
    | "checkbox"
    | "radio"
    | "toggle"
    | "content"
    | "rating"
    | "file"
    | "repeat"
    | "matrix"
    | "measurement"
    | "roi";
  name: string;
  label?: string;
  description?: string;
  readOnly?: boolean;
  placeholder?: string;
  defaultValue?: QuestionnaireValue;
  visibleWhen?: QuestionnaireCondition;
  width?: "full" | "1/2";
  validation?: QuestionnaireValidation;
};

export type QuestionnaireSelectElement = QuestionnaireBaseElement & {
  kind: "select" | "multiselect" | "radio";
  options?: QuestionnaireOption[];
};

export type QuestionnaireContentElement = QuestionnaireBaseElement & {
  kind: "content";
  /** "header" renders as a large heading, "text" as a paragraph. */
  variant?: "header" | "text";
  /** Plain text content (rendered via textContent — never innerHTML). */
  text?: string;
  /** @deprecated legacy raw HTML; migrated to `text` on normalize. */
  html?: string;
};

export type QuestionnaireMeasurementElement = QuestionnaireBaseElement & {
  kind: "measurement";
  /** Selectable units; first is the default. */
  units?: string[];
};

export type QuestionnaireRoiElement = QuestionnaireBaseElement & {
  kind: "roi";
  /** Drawing shape offered for the region capture. */
  shape?: "rect" | "polygon";
};

export type QuestionnaireRatingElement = QuestionnaireBaseElement & {
  kind: "rating";
  maxRating?: number;
};

export type QuestionnaireFileElement = QuestionnaireBaseElement & {
  kind: "file";
  accept?: string;
  multiple?: boolean;
};

export type QuestionnaireRepeatElement = QuestionnaireBaseElement & {
  kind: "repeat";
  addLabel?: string;
  minItems?: number;
  maxItems?: number;
  elements: QuestionnaireElement[];
};

export type QuestionnaireMatrixElement = QuestionnaireBaseElement & {
  kind: "matrix";
  rows: Array<{ value: string; label: string }>;
  columns: Array<{ value: string; label: string }>;
};

export type QuestionnaireElement =
  | QuestionnaireBaseElement
  | QuestionnaireSelectElement
  | QuestionnaireContentElement
  | QuestionnaireRatingElement
  | QuestionnaireFileElement
  | QuestionnaireRepeatElement
  | QuestionnaireMatrixElement
  | QuestionnaireMeasurementElement
  | QuestionnaireRoiElement;

/**
 * A page's saved viewer setup — the core `CanonicalScene` shape (produced by
 * `APPLICATION_CONTEXT.scene.serialize({ includeViewport: true })`) decorated
 * with display metadata. Pre-canonical captures are field-compatible
 * (normalizeScene stamps the missing `version`).
 */
export type QuestionnairePageScene = CanonicalSceneLike & {
  /** @deprecated pre-canonical captures only; ignored on apply (viz binding rides on background entries). */
  activeVisualizationIndex?: number | number[] | null;
  viewerCount?: number;
  viewerTitles?: string[];
  capturedAt?: string;
};

/** @deprecated input-only legacy shape; normalized into `QuestionnairePageRecordingBinding[]` on import. */
export type QuestionnairePageAnimation = {
  steps: RecorderSnapshotStep[];
  stepCount: number;
  capturedAt?: string;
  autoplay?: boolean;
  viewerTitles?: string[];
};

/**
 * How a page's saved viewer setup is applied on visit when the open content
 * differs. `"auto"` restores immediately; `"prompt"` shows a non-blocking
 * banner the respondent confirms (viewport-only restore stays automatic
 * either way). Unset = inherit the deployment default (static meta
 * `sceneApplyMode`, default `"prompt"`).
 */
export type QuestionnaireSceneApplyMode = "auto" | "prompt";

/**
 * One recording bound to a page's viewer slot: a *reference* into the
 * author's recorder (`recordingId`, for staleness/Refresh) plus an embedded
 * snapshot of the steps and the overlay assets they reference, so the
 * questionnaire bundle is self-contained — respondents need no recorder
 * persistence. At page visit the snapshot is upserted into the recorder as a
 * transient recording (`qn:<pageId>:<bindingId>`) and optionally autoplayed.
 */
export type QuestionnairePageRecordingBinding = {
  id: string;
  /** Viewer slot in the page scene / VIEWER_MANAGER order. */
  slotIndex: number;
  /** Capture-time viewer id — may regenerate across sessions (hint only). */
  viewerUniqueId?: string;
  /** Content-derived viewer key (title/fileName) — cross-session hint. */
  viewerContextKey?: string;
  viewerTitle?: string;
  /** Source recording in the author's recorder (for Refresh/staleness). */
  recordingId: string;
  recordingName: string;
  /** Source recording's updatedAt at snapshot time — staleness detection. */
  recordingUpdatedAt?: number;
  /** Slide the recording was captured on; playback restores it. */
  backgroundId?: string;
  steps: RecorderSnapshotStep[];
  stepCount: number;
  /** Only the binary assets referenced by the steps' overlays. */
  assets?: RecorderAsset[];
  capturedAt?: string;
  autoplay?: boolean;
};

export type QuestionnairePage = {
  id: string;
  title: string;
  description?: string;
  /** @deprecated legacy fallback background index; no longer applied — pages without a `scene` leave the viewer untouched. */
  xBgSpec?: number;
  visibleWhen?: QuestionnaireCondition;
  scene?: QuestionnairePageScene;
  /** Unset = deployment default. See {@link QuestionnaireSceneApplyMode}. */
  sceneApplyMode?: QuestionnaireSceneApplyMode;
  /** @deprecated input-only; migrated to `recordings` by normalizeSchema. */
  pageAnimation?: QuestionnairePageAnimation;
  recordings?: QuestionnairePageRecordingBinding[];
  elements: QuestionnaireElement[];
};

export type QuestionnaireSchema = {
  version: 1;
  title?: string;
  description?: string;
  pages: QuestionnairePage[];
};

export type ViewerLikeRecord = {
  viewer: OpenSeadragon.Viewer;
  uniqueId: string;
  index: number;
};

export type QuestionnaireSelection =
  | { kind: "form" }
  | { kind: "page"; pageId: string }
  | { kind: "element"; pageId: string; elementId: string };

export type QuestionnaireAnimationApplyMode = "designer" | "runtime" | "manual";

export type PluginEventMap = {
  "questionnaire-schema-imported": { schema: QuestionnaireSchema };
  "questionnaire-schema-change": { schema: QuestionnaireSchema; reason: string };
  "questionnaire-designer-toggle": { active: boolean };
  "questionnaire-selection-change": { selection: QuestionnaireSelection };
  "questionnaire-page-change": { pageIndex: number; page: QuestionnairePage; viewerIds: string[] };
  "questionnaire-change": { answers: QuestionnaireAnswers; changedKey?: string };
  "questionnaire-draft-saved": { answers: QuestionnaireAnswers };
  "questionnaire-submit": { answers: QuestionnaireAnswers; schema: QuestionnaireSchema };
  "questionnaire-validation-failed": { pageIndex: number; errors: Record<string, string> };
  /** @deprecated no longer fired — the legacy xBgSpec fallback apply was removed (pages without a scene leave the viewer untouched). */
  "questionnaire-before-apply-background": { pageIndex: number; page: QuestionnairePage; bgSpec: number | null; viewerIds: string[]; cancel: boolean };
  "questionnaire-background-applied": { pageIndex: number; page: QuestionnairePage; bgSpec: number | null; viewerIds: string[] };
  "questionnaire-background-apply-failed": { pageIndex: number; page: QuestionnairePage; bgSpec: number | null; viewerIds: string[]; error: unknown };
  "questionnaire-viewer-added": ViewerLikeRecord;
  "questionnaire-viewer-removed": ViewerLikeRecord;
  "questionnaire-viewer-reset": ViewerLikeRecord;
  "questionnaire-page-added": { page: QuestionnairePage; index: number };
  "questionnaire-page-removed": { pageId: string; index: number };
  "questionnaire-page-moved": { pageId: string; oldIndex: number; newIndex: number };
  "questionnaire-element-added": { pageId: string; element: QuestionnaireElement; index: number };
  "questionnaire-element-removed": { pageId: string; elementId: string; index: number };
  "questionnaire-element-moved": { pageId: string; elementId: string; oldIndex: number; newIndex: number };
  "questionnaire-page-scene-captured": { pageId: string; scene: QuestionnairePageScene };
  "questionnaire-page-scene-applied": { pageId: string; scene: QuestionnairePageScene; mode: QuestionnaireAnimationApplyMode; pageIndex: number };
  /** The page's saved viewer setup differs from the open content and awaits the respondent's confirmation. */
  "questionnaire-page-scene-prompt": { pageId: string; pageIndex: number };
  /** @deprecated no longer fired — the destructive "consume" flow was replaced by recording bindings. */
  "questionnaire-page-animation-consumed": { pageId: string; animation: QuestionnairePageAnimation; clearedRecorder: boolean };
  /** @deprecated no longer fired — see `questionnaire-page-recordings-applied`. */
  "questionnaire-page-animation-applied": { pageId: string; animation: QuestionnairePageAnimation; mode: QuestionnaireAnimationApplyMode; pageIndex: number };
  "questionnaire-page-recording-bound": { pageId: string; binding: QuestionnairePageRecordingBinding };
  "questionnaire-page-recordings-applied": { pageId: string; bindings: QuestionnairePageRecordingBinding[]; mode: QuestionnaireAnimationApplyMode; pageIndex: number };
};
