import type { QuestionnaireBaseElement, QuestionnaireContentElement, QuestionnaireElement, QuestionnaireFileElement, QuestionnairePage, QuestionnaireRatingElement, QuestionnaireSchema, QuestionnaireSelectElement } from "./types";
import { ALLOWED_KINDS, sanitizeName, titleCase } from "./utils";
export function createDefaultSchema(): QuestionnaireSchema { return { version: 1, title: "Questionnaire", description: "", pages: [{ id: "page_1", title: "Page 1", xBgSpec: 0, elements: [{ id: "name", kind: "text", name: "name", label: "Name", required: true, width: "full", validation: { minLength: 1 } }] }] }; }
export function makePage(index: number): QuestionnairePage { return { id: `page_${Date.now()}_${index}`, title: `Page ${index}`, description: "", xBgSpec: 0, elements: [] }; }
export function makeElement(kind: QuestionnaireElement["kind"]): QuestionnaireElement {
  const seed = `${kind}_${Date.now()}`;
  const base: QuestionnaireBaseElement = { id: seed, kind, name: sanitizeName(seed), label: titleCase(kind), description: "", required: false, readOnly: false, placeholder: "", width: "full", validation: {} };
  if (kind === "select" || kind === "multiselect" || kind === "radio") return { ...base, kind, options: [{ value: "option_1", label: "Option 1" }, { value: "option_2", label: "Option 2" }] } as QuestionnaireSelectElement;
  if (kind === "content") return { ...base, kind, label: "Content", html: "<p>Informational content</p>" } as QuestionnaireContentElement;
  if (kind === "checkbox" || kind === "toggle") return { ...base, defaultValue: false };
  if (kind === "rating") return { ...base, kind, maxRating: 5 } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, multiple: false, accept: "" } as QuestionnaireFileElement;
  if (kind === "number") base.validation = { min: 0 };
  return base;
}
export function normalizeSchema(value: any, fallback: QuestionnaireSchema): QuestionnaireSchema {
  const schema: QuestionnaireSchema = { version: 1, title: typeof value?.title === "string" ? value.title : fallback.title || "Questionnaire", description: typeof value?.description === "string" ? value.description : fallback.description || "", pages: Array.isArray(value?.pages) ? value.pages : fallback.pages };
  schema.pages = schema.pages.filter((page) => page && Array.isArray(page.elements)).map((page, index) => ({ id: typeof page.id === "string" ? page.id : `page_${index + 1}`, title: typeof page.title === "string" ? page.title : `Page ${index + 1}`, description: typeof page.description === "string" ? page.description : "", xBgSpec: Number.isFinite(Number(page.xBgSpec)) ? Number(page.xBgSpec) : 0, visibleWhen: page.visibleWhen, elements: page.elements.filter(Boolean).map((element: any, elementIndex: number) => normalizeElement(element, page.id || `page_${index + 1}`, elementIndex)) }));
  if (!schema.pages.length) schema.pages = fallback.pages;
  return schema;
}
export function normalizeElement(value: any, pageId: string, index: number): QuestionnaireElement {
  const kind = ALLOWED_KINDS.includes(value?.kind) ? value.kind : "text";
  const base: QuestionnaireBaseElement = { id: typeof value?.id === "string" ? value.id : `${pageId}_element_${index + 1}`, kind, name: sanitizeName(typeof value?.name === "string" ? value.name : `${kind}_${index + 1}`), label: typeof value?.label === "string" ? value.label : titleCase(kind), description: typeof value?.description === "string" ? value.description : "", required: !!value?.required, requiredWhen: value?.requiredWhen, readOnly: !!value?.readOnly, placeholder: typeof value?.placeholder === "string" ? value.placeholder : "", defaultValue: value?.defaultValue, visibleWhen: value?.visibleWhen, width: value?.width === "1/2" ? "1/2" : "full", validation: typeof value?.validation === "object" && value.validation ? { min: numberOrUndefined(value.validation.min), max: numberOrUndefined(value.validation.max), minLength: numberOrUndefined(value.validation.minLength), maxLength: numberOrUndefined(value.validation.maxLength), pattern: typeof value.validation.pattern === "string" ? value.validation.pattern : undefined, message: typeof value.validation.message === "string" ? value.validation.message : undefined } : {} };
  if (kind === "select" || kind === "multiselect" || kind === "radio") return { ...base, kind, options: Array.isArray(value?.options) ? value.options.filter(Boolean).map((option: any, optionIndex: number) => ({ value: String(option?.value ?? `option_${optionIndex + 1}`), label: String(option?.label ?? option?.value ?? `Option ${optionIndex + 1}`) })) : [] } as QuestionnaireSelectElement;
  if (kind === "content") return { ...base, kind, html: typeof value?.html === "string" ? value.html : "" } as QuestionnaireContentElement;
  if (kind === "rating") return { ...base, kind, maxRating: Number.isFinite(Number(value?.maxRating)) ? Number(value.maxRating) : 5 } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, multiple: !!value?.multiple, accept: typeof value?.accept === "string" ? value.accept : "" } as QuestionnaireFileElement;
  return base;
}
function numberOrUndefined(value: any): number | undefined { return Number.isFinite(Number(value)) ? Number(value) : undefined; }
