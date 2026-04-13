export type QuestionnairePrimitive = string | number | boolean | null | undefined;
export type QuestionnaireFileValue = { name: string; size: number; type: string; lastModified: number; };
export type QuestionnaireValue = QuestionnairePrimitive | string[] | QuestionnaireFileValue[] | Record<string, any>;
export type QuestionnaireOption = { value: string; label: string };
export type QuestionnaireCondition =
  | { op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "empty" | "notEmpty" | "in" | "notIn"; field: string; value?: QuestionnaireValue; }
  | { op: "and" | "or"; args: QuestionnaireCondition[] };
export type QuestionnaireValidationRule = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string; message?: string; };
export type QuestionnaireWidth = "full" | "1/2";
export type QuestionnaireBaseElement = {
  id: string;
  kind: "text"|"textarea"|"number"|"email"|"date"|"tel"|"url"|"select"|"multiselect"|"checkbox"|"radio"|"toggle"|"content"|"rating"|"file";
  name: string; label?: string; description?: string; required?: boolean; requiredWhen?: QuestionnaireCondition; readOnly?: boolean;
  placeholder?: string; defaultValue?: QuestionnaireValue; visibleWhen?: QuestionnaireCondition; width?: QuestionnaireWidth; validation?: QuestionnaireValidationRule;
};
export type QuestionnaireSelectElement = QuestionnaireBaseElement & { kind: "select" | "multiselect" | "radio"; options?: QuestionnaireOption[]; };
export type QuestionnaireContentElement = QuestionnaireBaseElement & { kind: "content"; html?: string; };
export type QuestionnaireRatingElement = QuestionnaireBaseElement & { kind: "rating"; maxRating?: number; };
export type QuestionnaireFileElement = QuestionnaireBaseElement & { kind: "file"; multiple?: boolean; accept?: string; };
export type QuestionnaireElement = QuestionnaireBaseElement | QuestionnaireSelectElement | QuestionnaireContentElement | QuestionnaireRatingElement | QuestionnaireFileElement;
export type QuestionnairePage = { id: string; title: string; description?: string; xBgSpec?: number; visibleWhen?: QuestionnaireCondition; elements: QuestionnaireElement[]; };
export type QuestionnaireSchema = { version: 1; title?: string; description?: string; pages: QuestionnairePage[]; };
export type QuestionnaireAnswers = Record<string, QuestionnaireValue>;
export type ViewerLikeRecord = { viewer: OpenSeadragon.Viewer; uniqueId: string; index: number; };
export type QuestionnaireSelection = { kind: "form" } | { kind: "page"; pageId: string } | { kind: "element"; pageId: string; elementId: string };
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
  "questionnaire-before-apply-background": { pageIndex: number; page: QuestionnairePage; bgSpec: number | null; viewerIds: string[]; cancel: boolean; };
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
};
