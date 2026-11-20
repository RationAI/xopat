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

/**
 * Every field type the questionnaire can render. Single source of truth for
 * both normalization and the error a rejected schema reports — a hardcoded
 * second copy in a message is how the two drift.
 */
export const QUESTIONNAIRE_ELEMENT_KINDS = [
  "text", "textarea", "number", "email", "date", "tel", "url",
  "select", "multiselect", "checkbox", "radio", "toggle",
  "content", "rating", "file", "repeat", "matrix",
  "measurement", "roi",
] as const;

/**
 * SurveyJS is what an LLM reaches for when asked to build a form, and its
 * vocabulary overlaps ours just enough to look right. Naming the equivalent
 * kind in the refusal turns a guessing game into a one-line correction.
 */
const SURVEYJS_KIND_HINTS: Record<string, QuestionnaireElement["kind"]> = {
  radiogroup: "radio",
  dropdown: "select",
  tagbox: "multiselect",
  comment: "textarea",
  html: "content",
  expression: "content",
  boolean: "toggle",
  imagepicker: "select",
  matrixdropdown: "matrix",
  paneldynamic: "repeat",
};

/** Field renames that go with the SurveyJS shape, reported alongside the kind. */
const SURVEYJS_FIELD_HINTS: Array<{ theirs: string; ours: string }> = [
  { theirs: "type", ours: "kind" },
  { theirs: "title", ours: "label" },
  { theirs: "choices", ours: "options" },
  { theirs: "html", ours: 'text (with kind: "content")' },
  { theirs: "isRequired", ours: "validation.required" },
  { theirs: "rateMax", ours: "maxRating" },
];

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

/**
 * A schema payload that could not be used. Carries `userMessage` so the IO
 * pipeline's refusal surfacing shows a translated sentence instead of the raw
 * technical reason (see `IOPipeline.failure`).
 */
export class QuestionnaireSchemaError extends Error {
  userMessage?: string;
  constructor(message: string, userMessage?: string) {
    super(message);
    this.name = "QuestionnaireSchemaError";
    this.userMessage = userMessage;
  }
}

/**
 * Sanitize an arbitrary value into a usable schema.
 *
 * By default unusable input silently degrades to `defaultSchema()` — right for
 * the designer/undo paths, where there is always *some* form to render. Pass
 * `{ strict: true }` on the IMPORT path instead: there, degrading would replace
 * the author's form with a one-field default and report success, so a payload
 * that carries no usable pages must throw and leave the current schema alone.
 *
 * `{ authored: true }` adds the completeness checks a caller writing the schema
 * right now should face but a saved file should not — see assertUsableElement.
 */
/**
 * Carry a page's opaque payloads — its captured scene and its bound tours — across a
 * whole-schema replacement.
 *
 * ## The failure this exists for
 *
 * A page's `scene` and `recordings` are BULK payloads: a canonical viewer scene, and tour
 * steps with screenshots and base64 assets. Every read path summarizes them rather than
 * handing them out — the scripting `getSchema` replaces a scene with `{captured: true, …}`
 * and each binding with a `{…, stepCount}` descriptor. That is right for a read.
 *
 * But `setSchema` accepts the same shape, and the normalizers below reject a payload-less
 * value: `normalizePageRecordings` drops any entry with no `steps`, and `normalizeScene`
 * turns a summary into a hollow scene with no backgrounds. So the most natural edit there
 * is — read the schema, append a page, write it back — silently destroyed every page's
 * tour and viewer setup, and returned successfully. That is exactly the degradation
 * `strict` exists to prevent for elements; scene and recordings were the hole in it.
 *
 * ## The rule
 *
 * For a page matched by `id`, a value that is only a SUMMARY is not an instruction to
 * clear — it is the caller echoing back what it was shown. Restore the live payload.
 * Clearing stays expressible and explicit: `recordings: []`, `scene: null`.
 *
 * Omission (`undefined`) is treated as "not stated", so it preserves too. The asymmetry is
 * deliberate: a preserved tour the caller did not want is one `unbindPageRecording` away,
 * while a dropped one is gone — the snapshot was the only copy.
 *
 * Anything that cannot be matched to a live page is reported in `dropped` so the caller
 * can say so instead of reporting success over it. Pure: `next` is not mutated.
 */
export function preservePageOpaques(
  next: any,
  currentPages: readonly QuestionnairePage[] | undefined,
): { schema: any; dropped: Array<{ pageId: string; slotIndex: number; recordingName: string }> } {
  const dropped: Array<{ pageId: string; slotIndex: number; recordingName: string }> = [];
  if (!next || typeof next !== "object" || !Array.isArray(next.pages) || !currentPages?.length) {
    return { schema: next, dropped };
  }
  const byId = new Map(currentPages.filter(p => p && typeof p.id === "string").map(p => [p.id, p]));

  const pages = next.pages.map((page: any) => {
    if (!page || typeof page !== "object" || typeof page.id !== "string") return page;
    const live = byId.get(page.id);
    if (!live) {
      // No live page to restore from, so these summaries are about to be dropped by
      // `normalizePageRecordings`. Returning early without saying so is the silence this
      // whole function exists to end — a renamed or removed page id is exactly the case
      // where a caller would otherwise report success over a tour that is now gone.
      if (Array.isArray(page.recordings)) {
        for (const entry of page.recordings) {
          if (entry && typeof entry === "object" && !hasSteps(entry)) {
            dropped.push({
              pageId: page.id,
              slotIndex: Number(entry.slotIndex) || 0,
              recordingName: typeof entry.recordingName === "string" ? entry.recordingName : "",
            });
          }
        }
      }
      return page;
    }
    const merged = { ...page };

    // A canonical scene never carries `captured` — only the read summary does.
    if (isSceneSummary(page.scene) || page.scene === undefined) {
      if (live.scene !== undefined) merged.scene = live.scene;
      else delete merged.scene;
    }

    if (page.recordings === undefined) {
      if (live.recordings !== undefined) merged.recordings = live.recordings;
    } else if (Array.isArray(page.recordings)) {
      merged.recordings = page.recordings.map((entry: any) => {
        // Exactly the guard `normalizePageRecordings` applies: no steps, no binding.
        if (entry && typeof entry === "object" && !hasSteps(entry)) {
          const restored = findLiveBinding(live.recordings, entry);
          if (restored) return restored;
          dropped.push({
            pageId: page.id,
            slotIndex: Number(entry.slotIndex) || 0,
            recordingName: typeof entry.recordingName === "string" ? entry.recordingName : "",
          });
        }
        return entry;
      });
    }
    return merged;
  });

  return { schema: { ...next, pages }, dropped };
}

function hasSteps(entry: any): boolean {
  return Array.isArray(entry?.steps) && entry.steps.filter(Boolean).length > 0;
}

function isSceneSummary(scene: any): boolean {
  return !!scene && typeof scene === "object" && (scene as any).captured === true;
}

/**
 * The live binding a summary refers to.
 *
 * By `recordingId` first, so the exact tour the caller echoed is preferred. Then by slot,
 * which matters when the slot was RE-BOUND between the read and the write: the summary names
 * a tour that is no longer there, and the two available answers are "restore whatever the
 * slot holds now" or "leave the entry payload-less and let normalization delete it". The
 * first hands back the current truth; the second destroys a binding the caller never asked to
 * remove. A summary carries no steps, so there is no stale payload to resurrect either way.
 */
function findLiveBinding(live: any, entry: any): any {
  if (!Array.isArray(live) || !live.length) return null;
  const slot = Number(entry?.slotIndex);
  if (typeof entry?.recordingId === "string" && entry.recordingId) {
    const byRecording = live.find((b: any) => b?.recordingId === entry.recordingId
      && (!Number.isInteger(slot) || b?.slotIndex === slot));
    if (byRecording) return byRecording;
  }
  if (!Number.isInteger(slot)) return null;
  return live.find((b: any) => b?.slotIndex === slot) ?? null;
}

export function normalizeSchema(value: any, opts: { strict?: boolean; authored?: boolean } = {}): QuestionnaireSchema {
  const strict = !!opts.strict;
  // `authored` only means anything under `strict`; see assertUsableElement.
  const authored = !!opts.authored;
  const fallback = defaultSchema();
  if (strict && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new QuestionnaireSchemaError("schema is not an object");
  }
  if (strict && !Array.isArray(value?.pages)) {
    throw new QuestionnaireSchemaError("schema.pages is not an array");
  }
  const schema: QuestionnaireSchema = {
    version: 1,
    // Optional stable form identity; travels with submissions. Absent stays
    // absent — a generated id would differ per browser and defeat the purpose.
    ...(typeof value?.id === "string" && value.id ? { id: value.id } : {}),
    title: typeof value?.title === "string" ? value.title : fallback.title,
    description: typeof value?.description === "string" ? value.description : fallback.description,
    pages: Array.isArray(value?.pages) ? value.pages : fallback.pages,
  };
  if (strict) {
    // The lenient path drops a malformed page silently. For an author that is a
    // whole page disappearing from a form the call said it applied.
    const bad = schema.pages.findIndex((page: any) => !page || !Array.isArray(page.elements));
    if (bad >= 0) {
      throw new QuestionnaireSchemaError(
        `page ${bad + 1} has no "elements" array. A page is { title, elements: [...] }.`,
        $.t("questionaire:messages.schemaFieldInvalid"),
      );
    }
  }
  schema.pages = schema.pages.filter((page: any) => page && Array.isArray(page.elements)).map((page: any, index: number) => {
    const pageTitle = typeof page.title === "string" ? page.title : `Page ${index + 1}`;
    return {
    id: typeof page.id === "string" ? page.id : `page_${index + 1}`,
    title: pageTitle,
    description: typeof page.description === "string" ? page.description : "",
    // Deprecated legacy field, kept round-tripping for old bundles; never applied.
    xBgSpec: Number.isFinite(Number(page.xBgSpec)) ? Number(page.xBgSpec) : undefined,
    visibleWhen: page.visibleWhen,
    scene: normalizeScene(page.scene),
    sceneApplyMode: page.sceneApplyMode === "auto" || page.sceneApplyMode === "prompt" ? page.sceneApplyMode : undefined,
    recordings: normalizePageRecordings(page.recordings, page.pageAnimation),
    elements: page.elements.map((element: any, elementIndex: number) =>
      normalizeElement(element, page.id || `page_${index + 1}`, elementIndex, { strict, authored, pageTitle })),
    };
  });
  if (!schema.pages.length) {
    if (strict) throw new QuestionnaireSchemaError("schema has no usable pages");
    schema.pages = clone(fallback.pages);
  }
  ensureUniqueElementNames(schema);
  return schema;
}

/**
 * Index of the schema's answer key space, used to validate an incoming answer
 * map against the form it claims to belong to. Top-level keys live in one flat
 * namespace (`ensureUniqueElementNames` guarantees uniqueness); a repeat's
 * children live in their own per-repeat scope because their answers nest per
 * row. Depth is bounded at 2 — `normalizeElement` replaces a nested
 * repeat/matrix with a plain text field.
 */
export function indexElementsByName(schema: QuestionnaireSchema): {
  top: Map<string, QuestionnaireElement>;
  repeatChildren: Map<string, Map<string, QuestionnaireElement>>;
} {
  const top = new Map<string, QuestionnaireElement>();
  const repeatChildren = new Map<string, Map<string, QuestionnaireElement>>();
  for (const page of schema.pages || []) {
    for (const element of page.elements || []) {
      if (!element || typeof element.name !== "string") continue;
      top.set(element.name, element);
      if (element.kind === "repeat") {
        const children = new Map<string, QuestionnaireElement>();
        for (const child of (element as QuestionnaireRepeatElement).elements || []) {
          if (child && typeof child.name === "string") children.set(child.name, child);
        }
        repeatChildren.set(element.name, children);
      }
    }
  }
  return { top, repeatChildren };
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

/**
 * Refuse a field the questionnaire cannot render as asked.
 *
 * The lenient path below coerces anything unrecognized to a plain `text` field.
 * For the designer and for undo that is right — there must always be *some*
 * form on screen. For a programmatic author (the scripting API) it is the worst
 * possible outcome: a schema of four choice questions came back as four blank
 * text boxes and the call reported success, so neither the user nor the caller
 * had anything to correct. Strict mode throws instead, and the message names
 * the exact edit to make.
 *
 * Two tiers, because the callers differ. The KIND check is structural and runs
 * on every strict path, file import included: a field whose type was not
 * understood is not that questionnaire. The completeness checks (`authored`)
 * only run for a caller writing the schema NOW — refusing to open a saved file
 * because one select ended up with an empty option list would lock an author
 * out of their own form instead of letting them fix it in the designer.
 */
export function assertUsableElement(
  value: any,
  pageTitle: string,
  index: number,
  opts: { authored?: boolean } = { authored: true },
): void {
  const where = `element ${index + 1} on page "${pageTitle}"`;
  const kinds = QUESTIONNAIRE_ELEMENT_KINDS.join(", ");
  const rawKind = value?.kind;
  const foreignKind = typeof value?.type === "string" ? value.type : undefined;

  const renames = SURVEYJS_FIELD_HINTS
    .filter(({ theirs }) => value && typeof value === "object" && theirs in value)
    .map(({ theirs, ours }) => `"${theirs}" -> "${ours}"`);
  const renameNote = renames.length
    ? ` This schema is not SurveyJS: ${renames.join(", ")}.`
    : "";

  if (typeof rawKind !== "string" || !rawKind) {
    const seen = foreignKind ? ` (it has "type": "${foreignKind}")` : "";
    const suggestion = foreignKind && SURVEYJS_KIND_HINTS[foreignKind]
      ? ` A SurveyJS "${foreignKind}" is kind: "${SURVEYJS_KIND_HINTS[foreignKind]}" here.`
      : "";
    throw new QuestionnaireSchemaError(
      `${where} has no "kind"${seen}.${renameNote}${suggestion} Valid kinds: ${kinds}.`,
      elementRefusalMessage(),
    );
  }

  if (!(QUESTIONNAIRE_ELEMENT_KINDS as readonly string[]).includes(rawKind)) {
    const suggestion = SURVEYJS_KIND_HINTS[rawKind]
      ? ` Use kind: "${SURVEYJS_KIND_HINTS[rawKind]}".`
      : "";
    throw new QuestionnaireSchemaError(
      `${where} has an unknown kind "${rawKind}".${suggestion}${renameNote} Valid kinds: ${kinds}.`,
      elementRefusalMessage(),
    );
  }

  if (!opts.authored) return;

  // A choice field with nothing to choose from and a static block with nothing
  // to read are rendered, look finished, and answer nothing. They are authoring
  // mistakes with a one-word fix, so say which word.
  if (rawKind === "select" || rawKind === "multiselect" || rawKind === "radio") {
    const options = value?.options;
    if (!Array.isArray(options) || !options.length) {
      throw new QuestionnaireSchemaError(
        `${where} is a "${rawKind}" with no "options".${renameNote} `
        + `Pass options: [{ value, label }, ...].`,
        elementRefusalMessage(),
      );
    }
  }
  if (rawKind === "content" && typeof value?.text !== "string" && typeof value?.html !== "string") {
    throw new QuestionnaireSchemaError(
      `${where} is a "content" block with no "text".${renameNote} Pass text: "…" (markdown, not HTML).`,
      elementRefusalMessage(),
    );
  }
}

/**
 * What the USER sees when a refusal surfaces through the IO pipeline. The
 * technical `message` above is written for whoever authored the schema (a
 * script, the chat model) and must not be shown verbatim.
 */
function elementRefusalMessage(): string {
  return $.t("questionaire:messages.schemaFieldInvalid");
}

function normalizeElement(
  value: any,
  pageId: string,
  index: number,
  opts: { strict?: boolean; authored?: boolean; pageTitle?: string } = {},
): QuestionnaireElement {
  const allowed = QUESTIONNAIRE_ELEMENT_KINDS as readonly string[];
  if (opts.strict) assertUsableElement(value, opts.pageTitle || pageId, index, { authored: opts.authored });
  const kind = (allowed.includes(value?.kind) ? value.kind : "text") as QuestionnaireElement["kind"];
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
    // Migrate legacy raw `html` to `text` (strips tags) — content is rendered as
    // markdown through the `markdown` module, which sanitizes; author HTML is not
    // a supported input either way. See plugin.ts renderElement.
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
        const normalized = normalizeElement(child, `${base.id}_repeat`, childIndex, opts);
        return normalized.kind === "repeat" || normalized.kind === "matrix" ? makeElement("text") : normalized;
      }) : [makeElement("text")],
    } as QuestionnaireRepeatElement;
  }
  if (kind === "matrix") {
    return { ...base, kind, rows: Array.isArray(value?.rows) ? value.rows.filter(Boolean).map((row: any, rowIndex: number) => ({ value: String(row?.value ?? `row_${rowIndex + 1}`), label: String(row?.label ?? row?.value ?? `Row ${rowIndex + 1}`) })) : [{ value: "row_1", label: "Row 1" }], columns: Array.isArray(value?.columns) ? value.columns.filter(Boolean).map((col: any, colIndex: number) => ({ value: String(col?.value ?? `col_${colIndex + 1}`), label: String(col?.label ?? col?.value ?? `Column ${colIndex + 1}`) })) : [{ value: "col_1", label: "Column 1" }] } as QuestionnaireMatrixElement;
  }
  return base;
}
