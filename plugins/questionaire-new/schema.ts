    import type {
  QuestionnaireBaseElement,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireMatrixElement,
  QuestionnairePage,
  QuestionnairePageRecordingBinding,
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
        elements: [{ id: "name", kind: "text", name: "name", label: "Name", validation: { required: true }, width: "full" }],
      },
    ],
  };
}

export function makePage(pageCount: number): QuestionnairePage {
  const n = pageCount + 1;
  return { id: uid("page"), title: `Page ${n}`, description: "", elements: [] };
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
  if (kind === "content") return { ...base, kind, variant: "text", text: "Informational content" } as QuestionnaireContentElement;
  if (kind === "checkbox" || kind === "toggle") base.defaultValue = false;
  if (kind === "rating") return { ...base, kind, maxRating: 5 } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, accept: "", multiple: false } as QuestionnaireElement;
  if (kind === "measurement") return { ...base, kind, units: ["mm", "µm", "%", "count"] } as QuestionnaireElement;
  if (kind === "roi") return { ...base, kind, shape: "rect" } as QuestionnaireElement;
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
    // Deprecated legacy field, kept round-tripping for old bundles; never applied.
    xBgSpec: Number.isFinite(Number(page.xBgSpec)) ? Number(page.xBgSpec) : undefined,
    visibleWhen: page.visibleWhen,
    scene: normalizeScene(page.scene),
    sceneApplyMode: page.sceneApplyMode === "auto" || page.sceneApplyMode === "prompt" ? page.sceneApplyMode : undefined,
    recordings: normalizePageRecordings(page.recordings, page.pageAnimation),
    elements: page.elements.map((element: any, elementIndex: number) => normalizeElement(element, page.id || `page_${index + 1}`, elementIndex)),
  }));
  if (!schema.pages.length) schema.pages = clone(fallback.pages);
  ensureUniqueElementNames(schema);
  return schema;
}

/**
 * Answers are keyed FLAT by `element.name` — duplicate names make unrelated
 * fields mirror each other's value (typical for scripting/LLM-authored schemas
 * whose elements omit `name` and collapse to a per-page `text_1`). Enforce
 * global uniqueness across pages (repeat children: within their repeat scope,
 * since their answers nest per row). Deterministic — first occurrence keeps
 * its name, later duplicates get `_2`, `_3`, … — so re-normalizing is stable.
 */
function ensureUniqueElementNames(schema: QuestionnaireSchema): void {
  const dedupe = (elements: QuestionnaireElement[], seen: Set<string>) => {
    for (const element of elements) {
      let name = element.name;
      if (seen.has(name)) {
        let n = 2;
        while (seen.has(`${name}_${n}`)) n += 1;
        name = `${name}_${n}`;
        element.name = name;
      }
      seen.add(name);
      if (element.kind === "repeat") {
        dedupe((element as QuestionnaireRepeatElement).elements || [], new Set<string>());
      }
    }
  };
  const seen = new Set<string>();
  for (const page of schema.pages) dedupe(page.elements, seen);
}

function normalizeScene(value: any) {
  if (!value || typeof value !== "object") return undefined;
  const background = Array.isArray(value.background) ? value.background : [];
  // Legacy compatibility: older captures encoded the visualization/shader
  // selection ONLY in a top-level `activeVisualizationIndex`. The canonical
  // scene now keys selection per background entry (`background[i].visualizationIndex`)
  // and deserialize passes no global vizSpec — so backfill that legacy field
  // onto any background entry lacking its own index, otherwise an old
  // questionnaire scene restores with the default (wrong) visualization.
  const legacyViz = value.activeVisualizationIndex;
  const legacyVizAt = (i: number): number | undefined => {
    const raw = Array.isArray(legacyViz) ? legacyViz[i] : legacyViz;
    return Number.isInteger(raw) ? raw : undefined;
  };
  background.forEach((bg: any, i: number) => {
    if (bg && typeof bg === "object" && !Number.isInteger(bg.visualizationIndex)) {
      const li = legacyVizAt(i);
      if (li !== undefined) bg.visualizationIndex = li;
    }
  });
  return {
    // Canonical-scene shape (pre-canonical captures lack `version`; stamp it).
    version: 1 as const,
    data: Array.isArray(value.data) ? value.data : [],
    background,
    visualizations: Array.isArray(value.visualizations) ? value.visualizations : [],
    // `undefined` = keep current selection on apply (`null` would close all viewers).
    activeBackgroundIndex: value.activeBackgroundIndex ?? undefined,
    viewers: Array.isArray(value.viewers)
      ? value.viewers.filter((v: any) => v && typeof v === "object" && typeof v.uniqueId === "string")
      : undefined,
    viewerCount: Number.isFinite(Number(value.viewerCount)) ? Number(value.viewerCount) : undefined,
    viewerTitles: Array.isArray(value.viewerTitles) ? value.viewerTitles.map(String) : [],
    capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
  };
}

/**
 * Sanitize a page's recording bindings — and migrate the legacy single
 * `pageAnimation` (flat consumed recorder steps) into one slot-0 binding so
 * old bundles keep playing. `pageAnimation` never appears in the normalized
 * output; the binding array is the only runtime shape.
 */
function normalizePageRecordings(value: any, legacyAnimation: any): QuestionnairePageRecordingBinding[] | undefined {
  const bindings: QuestionnairePageRecordingBinding[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!raw || typeof raw !== "object") continue;
      const steps = Array.isArray(raw.steps) ? raw.steps.filter(Boolean) : [];
      if (!steps.length || typeof raw.recordingId !== "string" || !raw.recordingId) continue;
      const slot = Number(raw.slotIndex);
      bindings.push({
        id: typeof raw.id === "string" && raw.id ? raw.id : uid("binding"),
        slotIndex: Number.isInteger(slot) && slot >= 0 ? slot : 0,
        viewerUniqueId: typeof raw.viewerUniqueId === "string" ? raw.viewerUniqueId : undefined,
        viewerContextKey: typeof raw.viewerContextKey === "string" ? raw.viewerContextKey : undefined,
        viewerTitle: typeof raw.viewerTitle === "string" ? raw.viewerTitle : undefined,
        recordingId: raw.recordingId,
        recordingName: typeof raw.recordingName === "string" && raw.recordingName ? raw.recordingName : "Recording",
        recordingUpdatedAt: Number.isFinite(raw.recordingUpdatedAt) ? Number(raw.recordingUpdatedAt) : undefined,
        backgroundId: typeof raw.backgroundId === "string" ? raw.backgroundId : undefined,
        steps,
        stepCount: steps.length,
        assets: Array.isArray(raw.assets)
          ? raw.assets.filter((a: any) => a && typeof a === "object" && a.id && typeof a.data === "string")
          : undefined,
        capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : undefined,
        autoplay: !!raw.autoplay,
      });
    }
  }
  if (!bindings.length && legacyAnimation && typeof legacyAnimation === "object") {
    const steps = Array.isArray(legacyAnimation.steps) ? legacyAnimation.steps.filter(Boolean) : [];
    if (steps.length) {
      const first = steps[0] || {};
      bindings.push({
        id: "binding_legacy",
        slotIndex: 0,
        viewerUniqueId: typeof first.viewerId === "string" ? first.viewerId : undefined,
        viewerContextKey: typeof first.viewerContextKey === "string" ? first.viewerContextKey : undefined,
        viewerTitle: typeof first.viewerTitle === "string" ? first.viewerTitle : undefined,
        recordingId: "legacy",
        recordingName: "Imported animation",
        steps,
        stepCount: steps.length,
        capturedAt: typeof legacyAnimation.capturedAt === "string" ? legacyAnimation.capturedAt : undefined,
        autoplay: !!legacyAnimation.autoplay,
      });
    }
  }
  return bindings.length ? bindings : undefined;
}

function normalizeElement(value: any, pageId: string, index: number): QuestionnaireElement {
  const allowed: QuestionnaireElement["kind"][] = ["text","textarea","number","email","date","tel","url","select","multiselect","checkbox","radio","toggle","content","rating","file","repeat","matrix","measurement","roi"];
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
  if (kind === "content") {
    const variant = value?.variant === "header" ? "header" : "text";
    // Migrate legacy raw `html` to plain `text` (strips tags) — content is now
    // rendered with textContent, never innerHTML. See plugin.ts renderElement.
    const text = typeof value?.text === "string"
      ? value.text
      : typeof value?.html === "string" ? value.html.replace(/<[^>]*>/g, "").trim() : "";
    return { ...base, kind, variant, text } as QuestionnaireContentElement;
  }
  if (kind === "rating") return { ...base, kind, maxRating: Math.max(1, Number(value?.maxRating || 5)) } as QuestionnaireRatingElement;
  if (kind === "file") return { ...base, kind, accept: typeof value?.accept === "string" ? value.accept : "", multiple: !!value?.multiple } as QuestionnaireElement;
  if (kind === "measurement") return { ...base, kind, units: Array.isArray(value?.units) && value.units.length ? value.units.map(String) : ["mm", "µm", "%", "count"] } as QuestionnaireElement;
  if (kind === "roi") return { ...base, kind, shape: value?.shape === "polygon" ? "polygon" : "rect" } as QuestionnaireElement;
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
