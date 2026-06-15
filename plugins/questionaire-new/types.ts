export type QuestionnaireValue =
  | string
  | number
  | boolean
  | string[]
  | QuestionnaireAnswers[]
  | Record<string, string>
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

export type QuestionnairePageScene = {
  data: DataID[];
  background: BackgroundItem[];
  visualizations: VisualizationItem[];
  activeBackgroundIndex?: number | number[] | null;
  activeVisualizationIndex?: number | number[] | null;
  viewerCount?: number;
  viewerTitles?: string[];
  capturedAt?: string;
};

export type QuestionnairePageAnimation = {
  steps: RecorderSnapshotStep[];
  stepCount: number;
  capturedAt?: string;
  autoplay?: boolean;
  viewerTitles?: string[];
};

export type QuestionnairePage = {
  id: string;
  title: string;
  description?: string;
  xBgSpec?: number;
  visibleWhen?: QuestionnaireCondition;
  scene?: QuestionnairePageScene;
  pageAnimation?: QuestionnairePageAnimation;
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
  "questionnaire-page-animation-consumed": { pageId: string; animation: QuestionnairePageAnimation; clearedRecorder: boolean };
  "questionnaire-page-animation-applied": { pageId: string; animation: QuestionnairePageAnimation; mode: QuestionnaireAnimationApplyMode; pageIndex: number };
};
