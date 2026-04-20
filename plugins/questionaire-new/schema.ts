    import type {
  QuestionnaireBaseElement,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireMatrixElement,
  QuestionnairePage,
  QuestionnaireRatingElement,
  QuestionnaireRepeatElement,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
} from "./types";
import { clone, sanitizeName, titleCase, uid } from "./utils";

export function defaultSchema(): QuestionnaireSchema {
  return {
    version: 1,
    title: "Questionnaire",
    description: "",
    pages: [
      {
        id: "page_1",
        title: "Page 1",
        xBgSpec: 0,
        elements: [{ id: "name", kind: "text", name: "name", label: "Name", validation: { required: true }, width: "full" }],
      },
    ],
  };
}

export function makePage(pageCount: number): QuestionnairePage {
  const n = pageCount + 1;
  return { id: uid("page"), title: `Page ${n}`, description: "", xBgSpec: 0, elements: [] };
}

export function makeElement(kind: QuestionnaireElement["kind"]): QuestionnaireElement {
  const id = uid(kind);
  const base: QuestionnaireBaseElement = {
    id,
    kind,
    name: sanitizeName(id),
    label: titleCase(kind),
    description: "",
    readOnly: false,
    placeholder: "",
    width: "full",
    validation: {},
  };
  if (kind === "select" || kind === "multiselect" || kind === "radio") {
    return { ...base, kind, options: [{ value: "option_1", label: "Option 1" }, { value: "option_2", label: "Option 2" }] } as QuestionnaireSelectElement;
  }
  if (kind === "content") return { ...base, kind, html: "<p>Informational content</p>" } as QuestionnaireContentElement;
  if (kind === "checkbox" || kind === "toggle") base.defaultValue = false;
  if (kind === "rating") return { ...base, kind, maxRating: 5 } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, accept: "", multiple: false } as QuestionnaireElement;
  if (kind === "repeat") {
    return { ...base, kind, addLabel: "Add item", minItems: 0, maxItems: 10, elements: [{ id: uid("repeat_text"), kind: "text", name: sanitizeName(uid("repeat_text")), label: "Item", width: "full", validation: {} }] } as QuestionnaireRepeatElement;
  }
  if (kind === "matrix") {
    return { ...base, kind, rows: [{ value: "row_1", label: "Row 1" }, { value: "row_2", label: "Row 2" }], columns: [{ value: "col_1", label: "Column 1" }, { value: "col_2", label: "Column 2" }] } as QuestionnaireMatrixElement;
  }
  return base;
}

export function normalizeSchema(value: any): QuestionnaireSchema {
  const fallback = defaultSchema();
  const schema: QuestionnaireSchema = {
    version: 1,
    title: typeof value?.title === "string" ? value.title : fallback.title,
    description: typeof value?.description === "string" ? value.description : fallback.description,
    pages: Array.isArray(value?.pages) ? value.pages : fallback.pages,
  };
  schema.pages = schema.pages.filter((page: any) => page && Array.isArray(page.elements)).map((page: any, index: number) => ({
    id: typeof page.id === "string" ? page.id : `page_${index + 1}`,
    title: typeof page.title === "string" ? page.title : `Page ${index + 1}`,
    description: typeof page.description === "string" ? page.description : "",
    xBgSpec: Number.isFinite(Number(page.xBgSpec)) ? Number(page.xBgSpec) : 0,
    visibleWhen: page.visibleWhen,
    scene: normalizeScene(page.scene),
    pageAnimation: normalizePageAnimation(page.pageAnimation),
    elements: page.elements.map((element: any, elementIndex: number) => normalizeElement(element, page.id || `page_${index + 1}`, elementIndex)),
  }));
  if (!schema.pages.length) schema.pages = clone(fallback.pages);
  return schema;
}

function normalizeScene(value: any) {
  if (!value || typeof value !== "object") return undefined;
  return {
    data: Array.isArray(value.data) ? value.data : [],
    background: Array.isArray(value.background) ? value.background : [],
    visualizations: Array.isArray(value.visualizations) ? value.visualizations : [],
    activeBackgroundIndex: value.activeBackgroundIndex ?? null,
    activeVisualizationIndex: value.activeVisualizationIndex ?? null,
    viewerCount: Number.isFinite(Number(value.viewerCount)) ? Number(value.viewerCount) : undefined,
    viewerTitles: Array.isArray(value.viewerTitles) ? value.viewerTitles.map(String) : [],
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
  };
}

function normalizePageAnimation(value: any) {
  if (!value || typeof value !== "object") return undefined;
  const steps = Array.isArray(value.steps) ? value.steps : [];
  return {
    steps,
    stepCount: Number.isFinite(Number(value.stepCount)) ? Number(value.stepCount) : steps.length,
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
    autoplay: !!value.autoplay,
    viewerTitles: Array.isArray(value.viewerTitles) ? value.viewerTitles.map(String) : [],
  };
}

function normalizeElement(value: any, pageId: string, index: number): QuestionnaireElement {
  const allowed: QuestionnaireElement["kind"][] = ["text","textarea","number","email","date","tel","url","select","multiselect","checkbox","radio","toggle","content","rating","file","repeat","matrix"];
  const kind = allowed.includes(value?.kind) ? value.kind : "text";
  const base: QuestionnaireBaseElement = {
    id: typeof value?.id === "string" ? value.id : `${pageId}_element_${index + 1}`,
    kind,
    name: sanitizeName(typeof value?.name === "string" ? value.name : `${kind}_${index + 1}`),
    label: typeof value?.label === "string" ? value.label : titleCase(kind),
    description: typeof value?.description === "string" ? value.description : "",
    readOnly: !!value?.readOnly,
    placeholder: typeof value?.placeholder === "string" ? value.placeholder : "",
    defaultValue: value?.defaultValue,
    visibleWhen: value?.visibleWhen,
    width: value?.width === "1/2" ? "1/2" : "full",
    validation: typeof value?.validation === "object" && value.validation ? value.validation : {},
  };
  if (kind === "select" || kind === "multiselect" || kind === "radio") {
    return { ...base, kind, options: Array.isArray(value?.options) ? value.options.filter(Boolean).map((option: any, optionIndex: number) => ({ value: String(option?.value ?? `option_${optionIndex + 1}`), label: String(option?.label ?? option?.value ?? `Option ${optionIndex + 1}`) })) : [] };
  }
  if (kind === "content") return { ...base, kind, html: typeof value?.html === "string" ? value.html : "" } as QuestionnaireContentElement;
  if (kind === "rating") return { ...base, kind, maxRating: Math.max(1, Number(value?.maxRating || 5)) } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, accept: typeof value?.accept === "string" ? value.accept : "", multiple: !!value?.multiple } as QuestionnaireElement;
  if (kind === "repeat") {
    return {
      ...base,
      kind,
      addLabel: typeof value?.addLabel === "string" ? value.addLabel : "Add item",
      minItems: Number.isFinite(Number(value?.minItems)) ? Number(value.minItems) : 0,
      maxItems: Number.isFinite(Number(value?.maxItems)) ? Number(value.maxItems) : 10,
      elements: Array.isArray(value?.elements) ? value.elements.filter(Boolean).map((child: any, childIndex: number) => {
        const normalized = normalizeElement(child, `${base.id}_repeat`, childIndex);
        return normalized.kind === "repeat" || normalized.kind === "matrix" ? makeElement("text") : normalized;
      }) : [makeElement("text")],
    } as QuestionnaireRepeatElement;
  }
  if (kind === "matrix") {
    return { ...base, kind, rows: Array.isArray(value?.rows) ? value.rows.filter(Boolean).map((row: any, rowIndex: number) => ({ value: String(row?.value ?? `row_${rowIndex + 1}`), label: String(row?.label ?? row?.value ?? `Row ${rowIndex + 1}`) })) : [{ value: "row_1", label: "Row 1" }], columns: Array.isArray(value?.columns) ? value.columns.filter(Boolean).map((col: any, colIndex: number) => ({ value: String(col?.value ?? `col_${colIndex + 1}`), label: String(col?.label ?? col?.value ?? `Column ${colIndex + 1}`) })) : [{ value: "col_1", label: "Column 1" }] } as QuestionnaireMatrixElement;
  }
  return base;
}
