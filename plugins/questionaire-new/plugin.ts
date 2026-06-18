import { button, el, numberInput, toggleInput } from "./dom";
import { defaultSchema, makeElement, makePage, normalizeSchema } from "./schema";
import type {
  PluginEventMap,
  QuestionnaireAnswers,
  QuestionnaireAnimationApplyMode,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireFileElement,
  QuestionnaireMatrixElement,
  QuestionnaireMeasurementElement,
  QuestionnairePage,
  QuestionnaireRepeatElement,
  QuestionnaireRoiElement,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
  QuestionnaireValue,
  ViewerLikeRecord,
} from "./types";
import {
  answerFor,
  clone,
  conditionMatches,
  sanitizeName,
  toBgLabel,
  uid,
} from "./utils";
import { GRADING_PRESETS, gradingPreset } from "./grading-presets";
import { captureSelectedRegion, describeRegion, isAnnotationsAvailable, showRegion } from "./roi";
import type { CapturedRegion } from "./roi";
import { validatePage } from "./validation";
import {
  applyPageAnimationToRecorder,
  applyPageScene,
  captureCurrentPageScene,
  captureRecorderSession,
  describePageAnimation,
  describePageScene,
  getRecorderModule,
} from "./page-scene";

declare const LAYOUT: any;
declare const Dialogs: any;

export class QuestionnairePlugin extends XOpatPlugin {
  private readonly DRAFT_KEY = "questionnaire_draft";
  private _schema: QuestionnaireSchema = clone(defaultSchema());
  private _answers: QuestionnaireAnswers = {};
  private _currentPage = 0;
  private _designerActive = false;
  private _isExported = false;
  private _enableEditor = true;
  /** Runtime editing gate, driven by the `questionaire.edit` capability. */
  private _canEdit = true;
  /** Disposer for the capability subscription. */
  private _disposeCanEdit?: () => void;
  private _autoOpenBackground = true;
  private _viewerMap = new Map<string, ViewerLikeRecord>();
  private _toolbarEl: HTMLElement | null = null;
  private _designerEl: HTMLElement | null = null;
  private _runtimeEl: HTMLElement | null = null;
  private _previewEl: HTMLElement | null = null;
  /** Coarse undo snapshot of the schema for designer edits. */
  private _persistedSchemaSerialized: string = "";
  /** Debounce timer coalescing inline text edits into one undo snapshot. */
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** CRUD façade for per-field answer sync; inert until `crud:answer` bound. */
  private answerResource?: any;

  constructor(id: string) {
    super(id);
    this._enableEditor = this.getOption("enableEditor", true);
    this._autoOpenBackground = this.getOption("autoOpenBackground", true);
    this._isExported = this.getOption("isExported", false);

    this._initIOPipeline().catch(e => console.error("[questionaire] IO pipeline init failed:", e));
  }

  /**
   * Generic IO pipeline integration.
   *  - Schema → `bundle-export` / `bundle-import` (global scope).
   *  - Per-field answers → `crud:answer` resource with `persistOutbox: true`
   *    so unsynced answers survive a reload.
   * The local AppCache draft (saveDraft/loadDraft) is kept for offline-first
   * resume even when no upstream sink is bound; the resource opts in to
   * upstream dispatch only when an admin binds it.
   */
  private async _initIOPipeline(): Promise<void> {
    await (this as any).initIO({
      bundleScope: "global",
      exportBundle: async (_ctx: any) => JSON.stringify(this._schema),
      importBundle: async (_ctx: any, data: any) => {
        if (data === undefined || data === null) return;
        try {
          const parsed = typeof data === "string" ? JSON.parse(data) : data;
          // Bundle loads are not user-undoable, so don't record history.
          this._applySchema(parsed, "import", { recordHistory: false, imported: true });
        } catch (e: any) {
          const reason = e?.message ?? String(e);
          console.warn("[questionaire] importBundle failed:", e);
          const wrapped = new Error(`Failed to load questionaire schema: ${reason}`);
          (wrapped as any).userMessage = `Could not load questionaire schema. ${reason}`;
          throw wrapped;
        }
      },
    });

    this.answerResource = (this as any).defineResource({
      name: "answer",
      identityOf: (a: any) => String(a?.fieldKey ?? ""),
      coalesce: true,
      merge: (prev: any, next: any) => ({ ...(prev || {}), ...(next || {}) }),
      persistOutbox: true,
      persistMaxEntries: 1000,
      persistMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
      validate: (a: any) => {
        if (!a || typeof a !== "object" || !a.fieldKey) {
          return { ok: false, refused: true, reason: "answer must have a fieldKey" };
        }
        return { ok: true };
      },
    });
  }

  pluginReady(): void {
    this.ensureTab();
    this.hookViewerLifecycle();
    this._schema = normalizeSchema(this._schema);
    this._persistedSchemaSerialized = JSON.stringify(this._schema);
    this._answers = this.loadDraft() || {};
    // Gate designer/editing on the `questionaire.edit` capability. The handler
    // fires synchronously on subscribe (so `_canEdit` is correct before the
    // first paint) and again whenever a rights-resolver flips the capability —
    // editing turns on/off live, no reload. A revoke collapses any open designer.
    this._disposeCanEdit = this.onCapabilityChange("questionaire.edit", (enabled: boolean) => {
      this._canEdit = enabled;
      if (!enabled) this._designerActive = false;
      this.renderAll();
    });
  }

  /* ===========================================================================
   * Public programmatic API
   *
   * Stable surface for host code and the `questionnaire` scripting namespace
   * (see scripting/api.ts → LLM integration). Every mutation funnels through
   * `_applySchema` / `persistSchema` so it shares the designer's
   * normalize → undo-snapshot → event → render path. Inputs are treated as
   * hostile: `normalizeSchema` sanitizes them on the way in. All methods return
   * plain (cloned) data so they are safe to serialize across the script worker.
   * ========================================================================= */

  /** Snapshot of the current schema. */
  getSchema(): QuestionnaireSchema {
    return clone(this._schema);
  }

  /** Current answer state (field key → value). */
  getAnswers(): QuestionnaireAnswers {
    return clone(this._answers);
  }

  /** Lightweight runtime/result summary for read-only inspection. */
  getResultState(): { exported: boolean; pageCount: number; currentPage: number; answeredKeys: string[] } {
    const answeredKeys = Object.keys(this._answers).filter((key) => {
      const v = this._answers[key];
      return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
    });
    return {
      exported: this._isExported,
      pageCount: this._schema.pages.length,
      currentPage: this._currentPage,
      answeredKeys,
    };
  }

  /** Replace the entire questionnaire schema. Returns the normalized result. */
  setSchema(schema: QuestionnaireSchema): QuestionnaireSchema {
    return this._applySchema(schema, "script-set-schema", { imported: true });
  }

  /** Append a page (optionally seeded with caller fields). Returns the created page. */
  addPage(page?: Partial<QuestionnairePage>): QuestionnairePage {
    const created = { ...makePage(this._schema.pages.length), ...(page || {}) } as QuestionnairePage;
    const id = created.id;
    this._schema.pages.push(created);
    this.raiseTypedEvent("questionnaire-page-added", { page: clone(created), index: this._schema.pages.length - 1 });
    this._applySchema(this._schema, "script-page-add");
    const result = this._findPageById(id);
    if (!result) throw new Error("Failed to add the questionnaire page.");
    return clone(result);
  }

  /** Remove a page by id or index. Returns true when a page was removed. */
  removePage(ref: string | number): boolean {
    const index = this._resolvePageIndex(ref);
    if (index < 0 || index >= this._schema.pages.length || this._schema.pages.length <= 1) return false;
    this._removePageAt(index);
    return true;
  }

  /** Append an element to a page (by id or index). Returns the created element. */
  addElement(
    pageRef: string | number,
    element: Partial<QuestionnaireElement> & { kind?: QuestionnaireElement["kind"] },
  ): QuestionnaireElement {
    const page = this._schema.pages[this._resolvePageIndex(pageRef)];
    if (!page) throw new Error(`Questionnaire page '${pageRef}' was not found.`);
    const kind = (element?.kind || "text") as QuestionnaireElement["kind"];
    const created = { ...makeElement(kind), ...(element || {}), kind } as QuestionnaireElement;
    const id = created.id;
    page.elements.push(created);
    this.raiseTypedEvent("questionnaire-element-added", { pageId: page.id, element: clone(created), index: page.elements.length - 1 });
    this._applySchema(this._schema, "script-element-add");
    const result = this._findElementById(id);
    return clone(result?.element ?? created);
  }

  /** Shallow-merge a patch into an existing element (id stays fixed). Returns the updated element. */
  updateElement(pageRef: string | number, elementId: string, patch: Partial<QuestionnaireElement>): QuestionnaireElement {
    const page = this._schema.pages[this._resolvePageIndex(pageRef)];
    if (!page) throw new Error(`Questionnaire page '${pageRef}' was not found.`);
    const elementIndex = page.elements.findIndex((e) => e.id === elementId);
    if (elementIndex < 0) throw new Error(`Questionnaire element '${elementId}' was not found on page '${page.id}'.`);
    const current = page.elements[elementIndex];
    if (!current) throw new Error(`Questionnaire element '${elementId}' was not found on page '${page.id}'.`);
    page.elements[elementIndex] = { ...current, ...(patch || {}), id: current.id } as QuestionnaireElement;
    this._applySchema(this._schema, "script-element-update");
    const result = this._findElementById(elementId);
    return clone(result?.element ?? current);
  }

  /** Remove an element by id from a page (by id or index). Returns true when removed. */
  removeElement(pageRef: string | number, elementId: string): boolean {
    const page = this._schema.pages[this._resolvePageIndex(pageRef)];
    if (!page) return false;
    const elementIndex = page.elements.findIndex((e) => e.id === elementId);
    if (elementIndex < 0) return false;
    this._removeElementAt(page.id, elementIndex);
    return true;
  }

  /**
   * Apply a full schema value: normalize (hostile input is sanitized here),
   * refresh the undo baseline, fire events, repaint. `recordHistory` true pushes
   * one undo entry (programmatic edits); imports pass false. `imported` raises
   * the `schema-imported` event for wholesale replacements.
   */
  private _applySchema(
    next: any,
    reason: string,
    opts: { recordHistory?: boolean; imported?: boolean } = {},
  ): QuestionnaireSchema {
    const { recordHistory = true, imported = false } = opts;
    const normalized = normalizeSchema(next);
    if (recordHistory) {
      this._schema = normalized;
      this._clampCurrentPage();
      if (imported) this.raiseTypedEvent("questionnaire-schema-imported", { schema: clone(this._schema) });
      this.persistSchema(reason);
    } else {
      APPLICATION_CONTEXT.history.withoutRecording(() => {
        this._schema = normalized;
        this._persistedSchemaSerialized = JSON.stringify(this._schema);
        this._clampCurrentPage();
        if (imported) this.raiseTypedEvent("questionnaire-schema-imported", { schema: clone(this._schema) });
        this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
        this.renderAll();
      });
    }
    return clone(this._schema);
  }

  private _clampCurrentPage(): void {
    if (this._currentPage >= this._schema.pages.length) this._currentPage = Math.max(0, this._schema.pages.length - 1);
    if (this._currentPage < 0) this._currentPage = 0;
  }

  private _resolvePageIndex(ref: string | number): number {
    if (typeof ref === "number") return Number.isInteger(ref) ? ref : -1;
    return this._schema.pages.findIndex((p) => p.id === ref);
  }

  private _findPageById(id: string): QuestionnairePage | undefined {
    return this._schema.pages.find((p) => p.id === id);
  }

  private _findElementById(id: string): { page: QuestionnairePage; element: QuestionnaireElement } | undefined {
    for (const page of this._schema.pages) {
      const element = page.elements.find((e) => e.id === id);
      if (element) return { page, element };
    }
    return undefined;
  }

  private ensureTab(): void {
    LAYOUT.addTab({
      id: "questionaire",
      title: "Questionnaire",
      icon: "fa-question-circle",
      body: [new UI.RawHtml(`
        <main class="questionnaire-root mx-auto max-w-7xl p-2">
          <div class="card bg-base-100 shadow-md">
            <div class="card-body p-3">
              <div id="questionnaire-toolbar"></div>
              <div id="questionnaire-designer" class="mt-3 hidden"></div>
              <div id="questionnaire-runtime" class="mt-3"></div>
            </div>
          </div>
        </main>
      `)],
    });
    this._toolbarEl = document.getElementById("questionnaire-toolbar");
    this._designerEl = document.getElementById("questionnaire-designer");
    this._runtimeEl = document.getElementById("questionnaire-runtime");
  }

  private hookViewerLifecycle(): void {
    const add = (payload: any) => {
      const viewer = payload?.viewer;
      if (!viewer) return;
      const record = { viewer, uniqueId: viewer.uniqueId, index: payload?.index ?? -1 };
      this._viewerMap.set(record.uniqueId, record);
      this.raiseTypedEvent("questionnaire-viewer-added", record);
    };
    const remove = (payload: any) => {
      const viewer = payload?.viewer;
      if (!viewer) return;
      const record = this._viewerMap.get(viewer.uniqueId) || { viewer, uniqueId: viewer.uniqueId, index: payload?.index ?? -1 };
      this._viewerMap.delete(record.uniqueId);
      this.raiseTypedEvent("questionnaire-viewer-removed", record);
    };
    const reset = (payload: any) => {
      const viewer = payload?.viewer;
      if (!viewer) return;
      const record = { viewer, uniqueId: viewer.uniqueId, index: payload?.index ?? -1 };
      this._viewerMap.set(record.uniqueId, record);
      this.raiseTypedEvent("questionnaire-viewer-reset", record);
    };
    if (VIEWER_MANAGER?.addHandler) {
      VIEWER_MANAGER.addHandler("viewer-create", add);
      VIEWER_MANAGER.addHandler("viewer-destroy", remove);
      VIEWER_MANAGER.addHandler("viewer-reset", reset);
    }
    const viewers = VIEWER_MANAGER?.viewers;
    if (Array.isArray(viewers)) {
      viewers.forEach((viewer: OpenSeadragon.Viewer, index: number) => {
        if (viewer) this._viewerMap.set(viewer.uniqueId, { viewer, uniqueId: viewer.uniqueId, index });
      });
    }
  }

  private renderAll(): void {
    this.renderToolbar();
    this.renderDesigner();
    this.renderRuntime();
  }

  private renderToolbar(): void {
    if (!this._toolbarEl) return;
    this._toolbarEl.innerHTML = "";
    const wrap = el("div", "flex flex-wrap items-center justify-between gap-3");
    const left = el("div", "min-w-0 flex-1 space-y-1");
    const canManage = this._canEdit && !this._isExported;
    // In designer mode the title/description ARE the editable form header — the
    // single place both live (the defaults become placeholders). Outside the
    // designer they render as static text. A read-only viewer sees just the
    // title; a real custom description is always shown.
    if (this._designerActive) {
      left.append(this.inlineInput(this._schema.title || "", "Questionnaire", (v) => { this._schema.title = v; this.commitFormMeta("form-title"); }, "input input-ghost text-xl font-semibold px-0 w-full focus:outline-none"));
      left.append(this.inlineInput(this._schema.description || "", "Custom questionnaire runtime and designer", (v) => { this._schema.description = v; this.commitFormMeta("form-description"); }, "input input-ghost input-sm px-0 w-full text-base-content/70 focus:outline-none"));
    } else {
      left.append(el("h2", "text-xl font-semibold", this._schema.title || "Questionnaire"));
      const subtitle = this._schema.description || (canManage ? "Custom questionnaire runtime and designer" : "");
      if (subtitle) left.append(el("div", "text-sm text-base-content/70", subtitle));
    }
    const right = el("div", "flex flex-wrap items-center gap-2");
    if (this._enableEditor && canManage) {
      right.append(button(this._designerActive ? "Hide designer" : "Show designer", "btn btn-outline btn-sm", () => {
        this._designerActive = !this._designerActive;
        this.raiseTypedEvent("questionnaire-designer-toggle", { active: this._designerActive });
        this.renderAll();
      }));
    }
    if (canManage) {
      right.append(button("Clear draft", "btn btn-outline btn-sm", () => {
        this._answers = {};
        this.saveDraft();
        this.renderRuntime();
        if (this._previewEl) this.renderPreviewInto(this._previewEl);
      }));
    }
    if (this._isExported) right.append(el("span", "badge badge-warning", "Read-only"));
    wrap.append(left, right);
    this._toolbarEl.append(wrap);
  }

  // ── Designer: Google-Forms-like single column ────────────────────────────

  /** Lean question-type palette (Google-Forms-style names). */
  private static readonly QUESTION_TYPES: Array<{ kind: QuestionnaireElement["kind"]; label: string }> = [
    { kind: "text", label: "Short answer" },
    { kind: "textarea", label: "Paragraph" },
    { kind: "radio", label: "Multiple choice" },
    { kind: "multiselect", label: "Checkboxes" },
    { kind: "select", label: "Dropdown" },
    { kind: "checkbox", label: "Single checkbox" },
    { kind: "number", label: "Number" },
    { kind: "measurement", label: "Measurement + unit" },
    { kind: "file", label: "File upload" },
    { kind: "matrix", label: "Grid" },
    { kind: "roi", label: "Region of interest" },
  ];

  private renderDesigner(): void {
    if (!this._designerEl) return;
    this._designerEl.innerHTML = "";
    this._designerEl.classList.toggle("hidden", !this._designerActive);
    if (!this._designerActive) return;

    if (this._currentPage >= this._schema.pages.length) this._currentPage = Math.max(0, this._schema.pages.length - 1);
    const col = el("div", "questionnaire-designer-col mx-auto w-full max-w-3xl space-y-4");
    const page = this._schema.pages[this._currentPage] || this._schema.pages[0];
    // The header (section selector + the active page's metadata + viewer setup)
    // reads as one block; the question items live in a separate content region
    // below so the structural controls are clearly set apart from the content.
    col.append(this.renderSectionHeader(page));
    if (page) {
      const items = el("div", "questionnaire-designer-content space-y-3");
      // Clear "Questions" divider so the content region is unmistakably separate
      // from the page-setup header above it.
      items.append(el("div", "divider divider-start text-xs font-semibold uppercase tracking-wide text-base-content/50", "Questions"));
      page.elements.forEach((element, index) => items.append(this.renderItemCard(page, element, index)));
      items.append(this.renderAddToolbar(page));
      col.append(items);
    }
    this._designerEl.append(col);
  }

  // ── small inline-control builders (keep the focused input alive) ──────────

  private inlineInput(value: string, placeholder: string, onInput: (v: string) => void, className = "input input-bordered input-sm w-full"): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = className;
    input.value = value;
    input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  private inlineTextarea(value: string, placeholder: string, onInput: (v: string) => void, rows = 2): HTMLTextAreaElement {
    const ta = document.createElement("textarea");
    ta.className = "textarea textarea-bordered textarea-sm w-full";
    ta.rows = rows;
    ta.value = value;
    ta.placeholder = placeholder;
    ta.addEventListener("input", () => onInput(ta.value));
    return ta;
  }

  private buildSelect(options: Array<{ value: string; label: string }>, value: string, onChange: (v: string) => void, className = "select select-bordered select-sm"): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = className;
    options.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = o.value === value;
      sel.append(opt);
    });
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  /**
   * Unified designer header: the section selector (page tabs + "+ Section") and
   * the active page's metadata (title/description, reorder/delete, viewer setup)
   * live inside one card, so the page picker and the page it edits read as a
   * single header block — visually distinct (tinted card) from the question
   * content rendered below it.
   */
  private renderSectionHeader(page: QuestionnairePage | undefined): HTMLElement {
    // Strong, unmistakable visual treatment so the page-setup header never reads
    // like a question card: filled base-200 surface + a primary accent left edge.
    const wrap = el("div", "card bg-base-200 border border-base-300 border-l-4 border-l-primary shadow-sm");
    const body = el("div", "card-body p-4 gap-3");

    body.append(el("div", "text-xs font-semibold uppercase tracking-wide text-primary", "Page setup"));

    // Section selector row.
    const bar = el("div", "flex items-center justify-between gap-2 flex-wrap");
    const tabs = el("div", "tabs tabs-boxed flex-wrap");
    this._schema.pages.forEach((p, i) => tabs.append(button(p.title || `Section ${i + 1}`, "tab" + (i === this._currentPage ? " tab-active" : ""), () => { this._currentPage = i; this.renderDesigner(); })));
    bar.append(tabs);
    bar.append(button("+ Section", "btn btn-ghost btn-sm", () => {
      const np = makePage(this._schema.pages.length);
      this._schema.pages.push(np);
      this._currentPage = this._schema.pages.length - 1;
      this.raiseTypedEvent("questionnaire-page-added", { page: clone(np), index: this._schema.pages.length - 1 });
      this.persistSchema("page-add");
    }));
    body.append(bar);

    if (!page) { wrap.append(body); return wrap; }

    body.append(el("div", "divider my-0"));

    // Active page metadata row.
    const header = el("div", "flex items-start justify-between gap-2");
    const titles = el("div", "flex-1 space-y-1");
    titles.append(this.inlineInput(page.title || "", "Section title", (v) => { page.title = v; this.commitInline("page-title"); }, "input input-ghost text-lg font-semibold px-0 w-full focus:outline-none"));
    titles.append(this.inlineTextarea(page.description || "", "Section description (optional)", (v) => { page.description = v; this.commitInline("page-description"); }));
    header.append(titles);
    const ctl = el("div", "flex gap-1");
    ctl.append(button("↑", "btn btn-ghost btn-xs", () => this.movePage(this._currentPage, this._currentPage - 1)));
    ctl.append(button("↓", "btn btn-ghost btn-xs", () => this.movePage(this._currentPage, this._currentPage + 1)));
    if (this._schema.pages.length > 1) ctl.append(button("✕", "btn btn-ghost btn-xs text-error", () => this._removePageAt(this._currentPage)));
    header.append(ctl);
    body.append(header);

    const details = document.createElement("details");
    details.className = "collapse collapse-arrow border border-base-300 bg-base-100 rounded-box";
    const summary = document.createElement("summary");
    summary.className = "collapse-title text-sm font-medium";
    summary.textContent = "Viewer setup & animation";
    const content = el("div", "collapse-content space-y-3");
    content.append(numberInput("Fallback background index", page.xBgSpec ?? 0, (v) => { page.xBgSpec = v; this.persistSchema("page-background"); }));
    content.append(this.renderViewerSetupEditor(page), this.renderPageAnimationEditor(page));
    details.append(summary, content);
    body.append(details);

    wrap.append(body);
    return wrap;
  }

  private renderItemCard(page: QuestionnairePage, element: QuestionnaireElement, index: number): HTMLElement {
    const wrap = el("div", "card bg-base-100 border border-base-300 shadow-sm");
    const body = el("div", "card-body p-4 gap-3");

    const top = el("div", "flex items-center justify-end gap-1");
    top.append(
      button("↑", "btn btn-ghost btn-xs", () => this.moveElement(page.id, index, index - 1)),
      button("↓", "btn btn-ghost btn-xs", () => this.moveElement(page.id, index, index + 1)),
      button("⧉", "btn btn-ghost btn-xs", () => this.duplicateElement(page.id, index)),
      button("✕", "btn btn-ghost btn-xs text-error", () => this._removeElementAt(page.id, index)),
    );
    body.append(top);

    if (element.kind === "content") {
      body.append(this.renderContentEditor(element as QuestionnaireContentElement));
      wrap.append(body);
      return wrap;
    }

    const headRow = el("div", "flex flex-col gap-2 md:flex-row md:items-center");
    headRow.append(this.inlineInput(element.label || "", "Question", (v) => { element.label = v; this.commitInline("element-label"); }, "input input-bordered input-sm w-full font-medium"));
    headRow.append(this.buildSelect(
      QuestionnairePlugin.QUESTION_TYPES.filter((t) => t.kind !== "roi" || isAnnotationsAvailable()).map((t) => ({ value: t.kind, label: t.label })),
      element.kind,
      (v) => this.convertElementKind(page, index, v as QuestionnaireElement["kind"]),
      "select select-bordered select-sm md:w-48",
    ));
    body.append(headRow);

    const typeEditor = this.renderItemTypeEditor(element);
    if (typeEditor) body.append(typeEditor);

    const footer = el("div", "flex items-center justify-between gap-2 border-t border-base-200 pt-2");
    footer.append(this.renderAdvanced(element));
    const req = el("label", "label cursor-pointer gap-2 py-0");
    const reqInput = document.createElement("input");
    reqInput.type = "checkbox";
    reqInput.className = "toggle toggle-sm";
    reqInput.checked = !!element.validation?.required;
    reqInput.addEventListener("change", () => { (element.validation ||= {}).required = reqInput.checked; this.persistSchema("element-required"); });
    req.append(el("span", "label-text text-sm", "Required"), reqInput);
    footer.append(req);
    body.append(footer);

    wrap.append(body);
    return wrap;
  }

  private renderItemTypeEditor(element: QuestionnaireElement): HTMLElement | null {
    if (element.kind === "select" || element.kind === "multiselect" || element.kind === "radio") {
      return this.renderOptionsEditor(element as QuestionnaireSelectElement);
    }
    if (element.kind === "matrix") return this.renderGridEditor(element as QuestionnaireMatrixElement);
    if (element.kind === "measurement") return this.renderMeasurementEditor(element as QuestionnaireMeasurementElement);
    if (element.kind === "roi") return this.renderRoiEditor(element as QuestionnaireRoiElement);
    if (element.kind === "text" || element.kind === "textarea" || element.kind === "number") {
      return this.inlineInput(element.placeholder || "", "Placeholder (optional)", (v) => { element.placeholder = v; this.commitInline("element-placeholder"); });
    }
    return null;
  }

  private renderOptionsEditor(element: QuestionnaireSelectElement): HTMLElement {
    const wrap = el("div", "space-y-2");
    element.options ||= [];
    element.options.forEach((opt, i) => {
      const row = el("div", "flex items-center gap-2");
      const mark = element.kind === "multiselect" ? "☐" : element.kind === "select" ? `${i + 1}.` : "○";
      row.append(el("span", "text-base-content/40 w-5 text-center", mark));
      row.append(this.inlineInput(opt.label, `Option ${i + 1}`, (v) => { opt.label = v; this.commitInline("element-option"); }));
      row.append(button("✕", "btn btn-ghost btn-xs", () => { element.options!.splice(i, 1); this.persistSchema("element-option-remove"); }));
      wrap.append(row);
    });
    const tools = el("div", "flex items-center gap-2 flex-wrap");
    tools.append(button("Add option", "btn btn-ghost btn-xs", () => {
      const n = element.options!.length + 1;
      element.options!.push({ value: `option_${n}`, label: `Option ${n}` });
      this.persistSchema("element-option-add");
    }));
    tools.append(this.buildSelect(
      [{ value: "", label: "Load preset…" }, ...GRADING_PRESETS.map((p) => ({ value: p.id, label: p.label }))],
      "",
      (v) => { const preset = gradingPreset(v); if (!preset) return; element.options = clone(preset.options); this.persistSchema("element-options-preset"); },
      "select select-bordered select-xs",
    ));
    wrap.append(tools);
    return wrap;
  }

  private renderGridEditor(element: QuestionnaireMatrixElement): HTMLElement {
    const wrap = el("div", "grid gap-2 md:grid-cols-2");
    const mk = (title: string, list: Array<{ value: string; label: string }>, reason: string, prefix: string) => {
      const box = el("div", "space-y-1");
      box.append(el("div", "text-xs font-medium text-base-content/70", `${title}s`));
      list.forEach((item, i) => {
        const row = el("div", "flex items-center gap-1");
        row.append(this.inlineInput(item.label, `${title} ${i + 1}`, (v) => { item.label = v; this.commitInline(reason); }));
        row.append(button("✕", "btn btn-ghost btn-xs", () => { list.splice(i, 1); this.persistSchema(reason + "-remove"); }));
        box.append(row);
      });
      box.append(button("Add", "btn btn-ghost btn-xs", () => { const n = list.length + 1; list.push({ value: `${prefix}_${n}`, label: `${title} ${n}` }); this.persistSchema(reason + "-add"); }));
      return box;
    };
    element.rows ||= [];
    element.columns ||= [];
    wrap.append(mk("Row", element.rows, "matrix-rows", "row"), mk("Column", element.columns, "matrix-cols", "col"));
    return wrap;
  }

  private renderMeasurementEditor(element: QuestionnaireMeasurementElement): HTMLElement {
    const wrap = el("div", "space-y-1");
    wrap.append(el("div", "text-xs font-medium text-base-content/70", "Units (comma-separated; first is default)"));
    const units = (element.units && element.units.length ? element.units : ["mm"]).join(", ");
    wrap.append(this.inlineInput(units, "mm, µm, %, count", (v) => { element.units = v.split(",").map((s) => s.trim()).filter(Boolean); this.commitInline("element-units"); }));
    return wrap;
  }

  private renderRoiEditor(element: QuestionnaireRoiElement): HTMLElement {
    const wrap = el("div", "space-y-1");
    if (!isAnnotationsAvailable()) {
      wrap.append(el("div", "text-xs text-warning", "Annotations module not loaded — region capture will be unavailable at runtime."));
    }
    wrap.append(el("div", "text-xs font-medium text-base-content/70", "Region shape"));
    wrap.append(this.buildSelect([{ value: "rect", label: "Rectangle" }, { value: "polygon", label: "Polygon" }], element.shape || "rect", (v) => { element.shape = v as "rect" | "polygon"; this.persistSchema("element-roi-shape"); }, "select select-bordered select-sm"));
    return wrap;
  }

  private renderContentEditor(element: QuestionnaireContentElement): HTMLElement {
    const wrap = el("div", "space-y-2");
    const variant = element.variant === "header" ? "header" : "text";
    wrap.append(this.buildSelect([{ value: "header", label: "Title block" }, { value: "text", label: "Text block" }], variant, (v) => { element.variant = v as "header" | "text"; this.persistSchema("content-variant"); }, "select select-bordered select-xs"));
    wrap.append(this.inlineTextarea(element.text || "", variant === "header" ? "Heading text" : "Descriptive text", (v) => { element.text = v; this.commitInline("content-text"); }, variant === "header" ? 1 : 3));
    return wrap;
  }

  private renderAdvanced(element: QuestionnaireElement): HTMLElement {
    const d = document.createElement("details");
    d.className = "text-sm";
    const s = document.createElement("summary");
    s.className = "cursor-pointer text-xs text-base-content/60";
    s.textContent = "Advanced";
    const box = el("div", "mt-2 space-y-2 rounded-box border border-base-300 p-2");
    box.append(this.inlineInput(element.description || "", "Help text", (v) => { element.description = v; this.commitInline("element-help"); }));
    if (element.kind === "number" || element.kind === "measurement") {
      const validation = (element.validation ||= {});
      const row = el("div", "flex gap-2");
      row.append(numberInput("Min", Number(validation.min ?? 0), (v) => { validation.min = v; this.commitInline("element-min"); }));
      row.append(numberInput("Max", Number(validation.max ?? 0), (v) => { validation.max = v; this.commitInline("element-max"); }));
      box.append(row);
    }
    d.append(s, box);
    return d;
  }

  private renderAddToolbar(page: QuestionnairePage): HTMLElement {
    const wrap = el("div", "flex items-center gap-2 flex-wrap rounded-box border border-dashed border-base-300 p-2");
    wrap.append(el("span", "text-xs text-base-content/60", "Add:"));
    const add = (element: QuestionnaireElement, reason: string) => {
      page.elements.push(element);
      this.raiseTypedEvent("questionnaire-element-added", { pageId: page.id, element: clone(element), index: page.elements.length - 1 });
      this.persistSchema(reason);
    };
    wrap.append(button("Question", "btn btn-primary btn-sm", () => add(makeElement("text"), "element-add")));
    wrap.append(button("Title", "btn btn-outline btn-sm", () => { const e = makeElement("content") as QuestionnaireContentElement; e.variant = "header"; e.text = "Section title"; add(e, "content-add"); }));
    wrap.append(button("Text", "btn btn-outline btn-sm", () => { const e = makeElement("content") as QuestionnaireContentElement; e.variant = "text"; e.text = "Description text"; add(e, "content-add"); }));
    return wrap;
  }

  private convertElementKind(page: QuestionnairePage, index: number, newKind: QuestionnaireElement["kind"]): void {
    const element = page.elements[index];
    if (!element || element.kind === newKind) return;
    const fresh = makeElement(newKind);
    fresh.id = element.id;
    fresh.name = element.name;
    if (element.label) fresh.label = element.label;
    if (element.description) fresh.description = element.description;
    fresh.validation = { ...(fresh.validation || {}), required: !!element.validation?.required };
    const isChoice = (k: string) => k === "radio" || k === "multiselect" || k === "select";
    if (isChoice(element.kind) && isChoice(newKind) && (element as QuestionnaireSelectElement).options) {
      (fresh as QuestionnaireSelectElement).options = clone((element as QuestionnaireSelectElement).options);
    }
    page.elements[index] = fresh;
    this.persistSchema("element-type");
  }

  private duplicateElement(pageId: string, index: number): void {
    const page = this._schema.pages.find((p) => p.id === pageId);
    if (!page) return;
    const src = page.elements[index];
    if (!src) return;
    const copy = clone(src);
    copy.id = uid(copy.kind);
    copy.name = sanitizeName(uid(copy.kind));
    page.elements.splice(index + 1, 0, copy);
    this.raiseTypedEvent("questionnaire-element-added", { pageId, element: clone(copy), index: index + 1 });
    this.persistSchema("element-duplicate");
  }



  private renderViewerSetupEditor(page: QuestionnairePage): HTMLElement {
    const box = el("div", "questionnaire-page-setup-box rounded-box border border-base-300 p-3 mb-3");
    box.append(el("div", "font-medium mb-1", "Viewer setup"));
    box.append(el("div", "text-xs text-base-content/70 mb-3", "Capture the current opened slides and active background selections from the live viewer session. This is what will be restored whenever this page is opened later."));
    const actions = el("div", "flex flex-wrap gap-2");
    actions.append(
      button("Capture current viewer setup", "btn btn-primary btn-sm", () => {
        page.scene = captureCurrentPageScene(Array.from(this._viewerMap.values()));
        this.raiseTypedEvent("questionnaire-page-scene-captured", { pageId: page.id, scene: clone(page.scene) });
        this.persistSchema("page-scene-capture");
      }),
      button("Apply saved setup now", "btn btn-outline btn-sm", () => { void this.applyStoredPageScene(page, "manual"); }),
      button("Clear saved setup", "btn btn-outline btn-sm", () => {
        page.scene = undefined;
        this.persistSchema("page-scene-clear");
      }),
    );
    box.append(actions);
    if (page.scene) box.append(el("div", "mt-3 rounded-box bg-base-200/60 p-2 text-sm", describePageScene(page.scene)));
    else box.append(el("div", "mt-3 rounded-box bg-base-200/60 p-2 text-sm", `No saved viewer setup yet. The fallback background index ${toBgLabel(page.xBgSpec)} will be used.`));
    return box;
  }

  private renderPageAnimationEditor(page: QuestionnairePage): HTMLElement {
    const box = el("div", "questionnaire-page-setup-box rounded-box border border-base-300 p-3 mb-3");
    box.append(el("div", "font-medium mb-1", "Page animation"));
    box.append(el("div", "text-xs text-base-content/70 mb-3", "If the recorder module is available, you can take over its current recorded session and attach it to this page. Once confirmed, the recorder is cleared so there is no ambiguity about what belongs to the page."));
    const recorder = getRecorderModule();
    const recorderCount = recorder?.snapshotCount?.() || 0;
    box.append(el("div", "text-xs text-base-content/60 mb-2", recorder ? `Recorder available • ${recorderCount} step(s) currently in recorder` : "Recorder module not available"));
    const actions = el("div", "flex flex-wrap gap-2");
    actions.append(
      button("Consume current recorder session", "btn btn-primary btn-sm", () => {
        if (!recorder) return this.showInfo("Recorder module is not available.");
        const captured = captureRecorderSession(recorder);
        if (!captured || !captured.steps.length) return this.showInfo("There is no recorder session to consume.");
        const ok = window.confirm(`Attach ${captured.steps.length} recorded step(s) to page "${page.title}" and clear the recorder session?`);
        if (!ok) return;
        page.pageAnimation = captured;
        recorder.importJSON([]);
        this.raiseTypedEvent("questionnaire-page-animation-consumed", { pageId: page.id, animation: clone(captured), clearedRecorder: true });
        this.persistSchema("page-animation-consume");
      }),
      button("Load saved animation into recorder", "btn btn-outline btn-sm", () => {
        if (!page.pageAnimation?.steps?.length) return this.showInfo("This page has no saved animation.");
        void this.applyStoredPageAnimation(page, "manual");
      }),
      button("Clear saved animation", "btn btn-outline btn-sm", () => {
        page.pageAnimation = undefined;
        this.persistSchema("page-animation-clear");
      }),
    );
    box.append(actions);
    if (page.pageAnimation) {
      box.append(toggleInput("Autoplay when page opens", !!page.pageAnimation.autoplay, (checked) => {
        if (!page.pageAnimation) return;
        page.pageAnimation.autoplay = checked;
        this.persistSchema("page-animation-autoplay");
      }));
      box.append(el("div", "rounded-box bg-base-200/60 p-2 text-sm", describePageAnimation(page.pageAnimation)));
    } else {
      box.append(el("div", "rounded-box bg-base-200/60 p-2 text-sm", "No animation attached to this page."));
    }
    return box;
  }


  private renderRuntime(): void {
    if (!this._runtimeEl) return;
    this._runtimeEl.innerHTML = "";
    // The designer and the runtime (output) are mutually exclusive views: while
    // the designer is open we hide the output entirely so only one is ever shown.
    this._runtimeEl.classList.toggle("hidden", this._designerActive);
    if (this._designerActive) return;
    const root = el("div", "questionnaire-runtime space-y-3");
    this._runtimeEl.append(root);
    this.renderPreviewInto(root, true);
  }

  private renderPreviewInto(target: HTMLElement, isMainRuntime = false): void {
    target.innerHTML = "";
    const pages = this.visiblePages();
    if (this._currentPage >= pages.length) this._currentPage = Math.max(0, pages.length - 1);
    const page = pages[this._currentPage] || pages[0];
    // The toolbar already renders the (custom) schema title + description as the
    // single panel header, so the main runtime skips them to avoid a duplicate.
    // The standalone designer "Live preview" card keeps its own header.
    if (!isMainRuntime) {
      target.append(el("div", "text-lg font-semibold", this._schema.title || "Questionnaire"));
      if (this._schema.description) target.append(el("div", "mb-3 text-sm text-base-content/70", this._schema.description));
    }
    const nav = el("div", "mb-3 tabs tabs-boxed flex-wrap");
    pages.forEach((p, index) => nav.append(button(p.title || `Page ${index + 1}`, "tab" + (index === this._currentPage ? " tab-active" : ""), () => { void this.goToPage(index); })));
    target.append(nav);
    if (!page) {
      target.append(el("div", "text-sm text-base-content/70", "No visible pages."));
      return;
    }
    if (page.scene || page.pageAnimation?.steps?.length) {
      target.append(el("div", "alert alert-info text-sm", undefined, [el("span", "", `${page.scene ? "Saved viewer setup will be restored." : ""}${page.scene && page.pageAnimation?.steps?.length ? " " : ""}${page.pageAnimation?.steps?.length ? "Saved page animation will be loaded." : ""}`)]));
    }
    target.append(el("div", "text-base font-semibold", page.title));
    if (page.description) target.append(el("div", "mb-4 text-sm text-base-content/70", page.description));
    const grid = el("div", "grid grid-cols-1 gap-4 md:grid-cols-2");
    page.elements.filter((e) => conditionMatches(e.visibleWhen, this._answers)).forEach((element) => grid.append(this.renderElement(element, page)));
    target.append(grid);
    const actions = el("div", "mt-4 flex flex-wrap items-center justify-between gap-2");
    const prev = button("Previous", "btn btn-outline btn-sm", () => { void this.goToPage(this._currentPage - 1); });
    prev.disabled = this._currentPage <= 0;
    const next = button(this._currentPage < pages.length - 1 ? "Next" : "Submit", "btn btn-primary btn-sm", () => {
      const errors = validatePage(page, this._answers);
      if (Object.keys(errors).length) {
        this.raiseTypedEvent("questionnaire-validation-failed", { pageIndex: this._currentPage, errors });
        this.renderPreviewInto(target, isMainRuntime);
        return;
      }
      if (this._currentPage < pages.length - 1) void this.goToPage(this._currentPage + 1);
      else this.raiseTypedEvent("questionnaire-submit", { answers: clone(this._answers), schema: clone(this._schema) });
    });
    actions.append(prev, next);
    target.append(actions);
  }

  private renderElement(element: QuestionnaireElement, page: QuestionnairePage, parentAnswers?: QuestionnaireAnswers, parentKey = ""): HTMLElement {
    const widthClass = element.width === "1/2" ? "md:col-span-1" : "md:col-span-2";
    const wrap = el("div", `form-control ${widthClass}`);
    const errors = validatePage(page, this._answers);
    const key = parentKey ? `${parentKey}.${element.name}` : element.name;
    if (element.kind === "content") {
      const content = element as QuestionnaireContentElement;
      // Plain text only — rendered via textContent, never innerHTML (XSS-safe).
      const text = content.text ?? (content.html ? content.html.replace(/<[^>]*>/g, "") : "");
      if (content.variant === "header") {
        wrap.append(el("div", "text-lg font-semibold text-base-content", text));
      } else {
        wrap.append(el("div", "whitespace-pre-wrap text-sm text-base-content/80", text));
      }
      return wrap;
    }
    if (element.label && element.kind !== "toggle" && element.kind !== "checkbox") wrap.append(el("label", "label", undefined, [el("span", "label-text font-medium", `${element.label}${(element.validation?.required || element.validation?.requiredWhen) ? " *" : ""}`)]));
    if (element.description) wrap.append(el("div", "mb-1 text-xs text-base-content/60", element.description));
    const readOnly = !!element.readOnly || this._isExported;
    const currentValue = parentAnswers ? answerFor(element, parentAnswers) : answerFor(element, this._answers);
    let input: HTMLElement;

    const setValue = (value: QuestionnaireValue) => {
      if (parentAnswers) {
        parentAnswers[element.name] = value;
        this.renderRuntime();
        if (this._previewEl) this.renderPreviewInto(this._previewEl);
      } else {
        this.setAnswer(element.name, value, element.name);
      }
    };

    switch (element.kind) {
      case "textarea": {
        const node = document.createElement("textarea");
        node.className = "textarea textarea-bordered min-h-24 w-full";
        node.placeholder = element.placeholder || "";
        node.value = String(currentValue ?? "");
        node.disabled = readOnly;
        node.addEventListener("input", () => setValue(node.value));
        input = node;
        break;
      }
      case "number": {
        const node = document.createElement("input");
        node.type = "number";
        node.className = "input input-bordered w-full";
        node.value = currentValue == null ? "" : String(currentValue);
        node.disabled = readOnly;
        node.addEventListener("input", () => setValue(node.value === "" ? null : Number(node.value)));
        input = node;
        break;
      }
      case "email":
      case "date":
      case "tel":
      case "url":
      case "text": {
        const node = document.createElement("input");
        node.type = element.kind === "text" ? "text" : element.kind;
        node.className = "input input-bordered w-full";
        node.placeholder = element.placeholder || "";
        node.value = String(currentValue ?? "");
        node.disabled = readOnly;
        node.addEventListener("input", () => setValue(node.value));
        input = node;
        break;
      }
      case "checkbox":
      case "toggle": {
        const row = el("label", "flex items-center gap-2 cursor-pointer py-1");
        const node = document.createElement("input");
        node.type = "checkbox";
        node.className = element.kind === "toggle" ? "toggle toggle-sm" : "checkbox checkbox-sm";
        node.checked = !!currentValue;
        node.disabled = readOnly;
        node.addEventListener("change", () => setValue(node.checked));
        row.append(node, el("span", "label-text", element.label || element.name));
        input = row;
        break;
      }
      case "select": {
        const node = document.createElement("select");
        node.className = "select select-bordered w-full";
        node.disabled = readOnly;
        node.append(new Option("Select…", ""));
        (element as QuestionnaireSelectElement).options?.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          if (String(currentValue ?? "") === option.value) opt.selected = true;
          node.append(opt);
        });
        node.addEventListener("change", () => setValue(node.value || null));
        input = node;
        break;
      }
      case "multiselect": {
        const group = el("div", "space-y-2");
        const selected = Array.isArray(currentValue) ? currentValue.map(String) : [];
        (element as QuestionnaireSelectElement).options?.forEach((option) => {
          const row = el("label", "flex items-center gap-2 cursor-pointer py-1");
          const node = document.createElement("input");
          node.type = "checkbox";
          node.className = "checkbox checkbox-sm";
          node.checked = selected.includes(option.value);
          node.disabled = readOnly;
          node.addEventListener("change", () => {
            const set = new Set(selected);
            if (node.checked) set.add(option.value); else set.delete(option.value);
            setValue(Array.from(set));
          });
          row.append(node, el("span", "label-text", option.label));
          group.append(row);
        });
        input = group;
        break;
      }
      case "measurement": {
        const meas = element as QuestionnaireMeasurementElement;
        const units = meas.units && meas.units.length ? meas.units : ["mm"];
        const cur = (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) ? currentValue as { value?: unknown; unit?: string } : {};
        const row = el("div", "flex gap-2");
        const num = document.createElement("input");
        num.type = "number";
        num.className = "input input-bordered w-full";
        num.value = cur.value == null ? "" : String(cur.value);
        num.disabled = readOnly;
        const unitSel = document.createElement("select");
        unitSel.className = "select select-bordered";
        unitSel.disabled = readOnly;
        units.forEach((u) => { const o = document.createElement("option"); o.value = u; o.textContent = u; o.selected = (cur.unit ?? units[0]) === u; unitSel.append(o); });
        const push = () => setValue({ value: num.value === "" ? null : Number(num.value), unit: unitSel.value } as unknown as QuestionnaireValue);
        num.addEventListener("input", push);
        unitSel.addEventListener("change", push);
        row.append(num, unitSel);
        input = row;
        break;
      }
      case "radio": {
        const group = el("div", "space-y-2");
        (element as QuestionnaireSelectElement).options?.forEach((option) => {
          const row = el("label", "flex items-center gap-2 cursor-pointer py-1");
          const node = document.createElement("input");
          node.type = "radio";
          node.className = "radio radio-sm";
          node.name = `radio_${element.id}_${parentKey}`;
          node.checked = String(currentValue ?? "") === option.value;
          node.disabled = readOnly;
          node.addEventListener("change", () => { if (node.checked) setValue(option.value); });
          row.append(node, el("span", "label-text", option.label));
          group.append(row);
        });
        input = group;
        break;
      }
      case "rating": {
        const maxRating = Math.max(1, Number((element as any).maxRating || 5));
        const row = el("div", "rating gap-1");
        for (let i = 1; i <= maxRating; i += 1) {
          const node = document.createElement("input");
          node.type = "radio";
          node.className = "mask mask-star-2 bg-orange-400";
          node.name = `rating_${element.id}_${parentKey}`;
          node.checked = Number(currentValue || 0) === i;
          node.disabled = readOnly;
          node.addEventListener("change", () => { if (node.checked) setValue(i); });
          row.append(node);
        }
        input = row;
        break;
      }
      case "file": {
        const fileElement = element as QuestionnaireFileElement;
        const node = document.createElement("input");
        node.type = "file";
        node.className = "file-input file-input-bordered w-full";
        node.accept = fileElement.accept || "";
        node.multiple = !!fileElement.multiple;
        node.disabled = readOnly;
        node.addEventListener("change", () => {
          const values = Array.from(node.files || []).map((file) => file.name);
          setValue(fileElement.multiple ? values : (values[0] || null));
        });
        input = node;
        break;
      }
      case "repeat":
        input = this.renderRepeatElement(element as QuestionnaireRepeatElement, page, parentAnswers, parentKey);
        break;
      case "matrix":
        input = this.renderMatrixElement(element as QuestionnaireMatrixElement, parentAnswers);
        break;
      case "roi": {
        const box = el("div", "space-y-2 rounded-box border border-base-300 p-2");
        const region = (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) ? currentValue as CapturedRegion : undefined;
        if (!isAnnotationsAvailable()) {
          box.append(el("div", "text-sm text-warning", "Annotations module not available — cannot capture a region."));
          input = box;
          break;
        }
        box.append(el("div", "text-xs text-base-content/60", "Draw a region with the annotation tools and select it, then capture."));
        const actions = el("div", "flex flex-wrap gap-2");
        if (!readOnly) actions.append(button("Capture selected region", "btn btn-primary btn-sm", () => {
          const captured = captureSelectedRegion(Array.from(this._viewerMap.values()));
          if (!captured) { this.showInfo("Select a single annotation in the viewer first."); return; }
          setValue(captured as unknown as QuestionnaireValue);
        }));
        actions.append(button("Show region", "btn btn-outline btn-sm", () => {
          if (!region) { this.showInfo("No region captured yet."); return; }
          showRegion(Array.from(this._viewerMap.values()), region);
        }));
        if (region && !readOnly) actions.append(button("Clear", "btn btn-ghost btn-sm", () => setValue(null)));
        box.append(actions, el("div", "text-xs text-base-content/70", describeRegion(region)));
        input = box;
        break;
      }
      default: {
        const node = document.createElement("input");
        node.type = "text";
        node.className = "input input-bordered w-full";
        node.placeholder = element.placeholder || "";
        node.value = String(currentValue ?? "");
        node.disabled = readOnly;
        node.addEventListener("input", () => setValue(node.value));
        input = node;
      }
    }
    wrap.append(input);
    if (errors[key]) wrap.append(el("div", "mt-1 text-sm text-error", errors[key]));
    return wrap;
  }

  private renderRepeatElement(element: QuestionnaireRepeatElement, page: QuestionnairePage, parentAnswers?: QuestionnaireAnswers, parentKey = ""): HTMLElement {
    const values = (parentAnswers ? parentAnswers[element.name] : this._answers[element.name]) as QuestionnaireAnswers[] | undefined;
    const rows = Array.isArray(values) ? values : [];
    const readOnly = !!element.readOnly || this._isExported;
    const wrap = el("div", "space-y-3");
    rows.forEach((rowAnswers, rowIndex) => {
      const row = el("div", "rounded-box border border-base-300 p-3");
      const header = el("div", "mb-2 flex items-center justify-between gap-2");
      header.append(el("div", "font-medium", `${element.label || element.name} #${rowIndex + 1}`));
      if (!readOnly) header.append(button("Remove", "btn btn-outline btn-xs", () => { rows.splice(rowIndex, 1); this.setScopedAnswer(element.name, rows, parentAnswers); }));
      row.append(header);
      const grid = el("div", "grid grid-cols-1 gap-4 md:grid-cols-2");
      element.elements.filter((child) => conditionMatches(child.visibleWhen, rowAnswers)).forEach((child) => {
        grid.append(this.renderElement(child, page, rowAnswers, `${parentKey}${element.name}[${rowIndex}]`));
      });
      row.append(grid);
      wrap.append(row);
    });
    if (!readOnly && rows.length < (element.maxItems ?? 10)) {
      wrap.append(button(element.addLabel || "Add item", "btn btn-outline btn-sm", () => {
        rows.push({});
        this.setScopedAnswer(element.name, rows, parentAnswers);
      }));
    }
    return wrap;
  }

  private renderMatrixElement(element: QuestionnaireMatrixElement, parentAnswers?: QuestionnaireAnswers): HTMLElement {
    const current = ((parentAnswers ? parentAnswers[element.name] : this._answers[element.name]) || {}) as Record<string, string>;
    const readOnly = !!element.readOnly || this._isExported;
    const tableWrap = el("div", "overflow-x-auto");
    const table = el("table", "table table-sm");
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", "", ""));
    element.columns.forEach((column) => headRow.append(el("th", "", column.label)));
    head.append(headRow);
    table.append(head);
    const body = el("tbody");
    element.rows.forEach((rowDef) => {
      const row = el("tr");
      row.append(el("th", "", rowDef.label));
      element.columns.forEach((colDef) => {
        const cell = el("td");
        const input = document.createElement("input");
        input.type = "radio";
        input.className = "radio";
        input.name = `matrix_${element.id}_${rowDef.value}`;
        input.checked = current[rowDef.value] === colDef.value;
        input.disabled = readOnly;
        input.addEventListener("change", () => {
          const next = clone(current);
          next[rowDef.value] = colDef.value;
          this.setScopedAnswer(element.name, next, parentAnswers);
        });
        cell.append(input);
        row.append(cell);
      });
      body.append(row);
    });
    table.append(body);
    tableWrap.append(table);
    return tableWrap;
  }

  private async goToPage(index: number): Promise<void> {
    const pages = this.visiblePages();
    const next = Math.max(0, Math.min(index, pages.length - 1));
    this._currentPage = next;
    const page = pages[next];
    if (!page) return;
    const viewerIds = Array.from(this._viewerMap.keys());
    this.raiseTypedEvent("questionnaire-page-change", { pageIndex: next, page: clone(page), viewerIds });
    await this.applyPageVisit(next, page, "runtime");
    this.renderRuntime();
    if (this._previewEl) this.renderPreviewInto(this._previewEl);
  }

  private async applyPageVisit(pageIndex: number, page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode): Promise<void> {
    await this.applyStoredPageScene(page, mode, pageIndex);
    await this.applyStoredPageAnimation(page, mode, pageIndex);
  }

  private async applyStoredPageScene(page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode, pageIndex = this._currentPage): Promise<void> {
    if (page.scene) {
      try {
        await applyPageScene(page.scene);
        this.raiseTypedEvent("questionnaire-page-scene-applied", { pageId: page.id, scene: clone(page.scene), mode, pageIndex });
      } catch (error) {
        this.raiseTypedEvent("questionnaire-background-apply-failed", { pageIndex, page: clone(page), bgSpec: page.scene.activeBackgroundIndex as any ?? null, viewerIds: Array.from(this._viewerMap.keys()), error });
      }
      return;
    }
    if (!this._autoOpenBackground) return;
    const bgSpec = Number.isFinite(Number(page.xBgSpec)) ? Number(page.xBgSpec) : null;
    const beforePayload = { pageIndex, page: clone(page), bgSpec, viewerIds: Array.from(this._viewerMap.keys()), cancel: false };
    this.raiseTypedEvent("questionnaire-before-apply-background", beforePayload);
    if (beforePayload.cancel) return;
    try {
      await APPLICATION_CONTEXT.openViewerWith(undefined, undefined, undefined, bgSpec, undefined, { deriveOverlayFromBackgroundGoals: true });
      this.raiseTypedEvent("questionnaire-background-applied", { pageIndex, page: clone(page), bgSpec, viewerIds: Array.from(this._viewerMap.keys()) });
    } catch (error) {
      this.raiseTypedEvent("questionnaire-background-apply-failed", { pageIndex, page: clone(page), bgSpec, viewerIds: Array.from(this._viewerMap.keys()), error });
    }
  }

  private async applyStoredPageAnimation(page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode, pageIndex = this._currentPage): Promise<void> {
    if (!page.pageAnimation?.steps?.length) return;
    const recorder = getRecorderModule();
    if (!recorder) return;
    applyPageAnimationToRecorder(recorder, page.pageAnimation, mode === "manual" ? false : !!page.pageAnimation.autoplay);
    this.raiseTypedEvent("questionnaire-page-animation-applied", { pageId: page.id, animation: clone(page.pageAnimation), mode, pageIndex });
  }

  private setAnswer(key: string, value: QuestionnaireValue, changedKey?: string): void {
    this._answers[key] = value;
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey });
    this.saveDraft();
    // Dispatch the per-field change to the CRUD resource. Inert when
    // `crud:answer` is unbound; when bound, admins get coalesced upstream
    // sync with offline outbox replay (configured in `_initIOPipeline`).
    const dispatchKey = changedKey || key;
    if (dispatchKey) this.answerResource?.update(dispatchKey, { fieldKey: dispatchKey, value });
    this.renderRuntime();
    if (this._previewEl) this.renderPreviewInto(this._previewEl);
  }

  private setScopedAnswer(key: string, value: QuestionnaireValue, parentAnswers?: QuestionnaireAnswers): void {
    if (parentAnswers) {
      parentAnswers[key] = value;
      this.renderRuntime();
      if (this._previewEl) this.renderPreviewInto(this._previewEl);
      return;
    }
    this.setAnswer(key, value, key);
  }


  private saveDraft(): void {
    if (this._isExported) return;
    APPLICATION_CONTEXT.AppCache.set(this.DRAFT_KEY, JSON.stringify(this._answers || {}));
    this.raiseTypedEvent("questionnaire-draft-saved", { answers: clone(this._answers) });
  }

  private loadDraft(): QuestionnaireAnswers | null {
    if (this._isExported) return null;
    try {
      const raw = APPLICATION_CONTEXT.AppCache.get(this.DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private persistSchema(reason: string): void {
    this.flushPendingPersist();
    this.pushSchemaHistory(reason);
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
    this.renderAll();
  }

  /**
   * Push one undo/redo snapshot of the current schema vs the last persisted
   * serialization. No re-render — callers decide what to repaint. Forward
   * restores the post-edit snapshot, backward the pre-edit one.
   */
  private pushSchemaHistory(reason: string): void {
    const next = JSON.stringify(this._schema);
    const prev = this._persistedSchemaSerialized || next;
    this._persistedSchemaSerialized = next;
    if (prev === next) return;
    const apply = (snapshot: string, why: string) => () => APPLICATION_CONTEXT.history.withoutRecording(() => {
      this._schema = normalizeSchema(JSON.parse(snapshot));
      this._persistedSchemaSerialized = snapshot;
      this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason: why });
      this.renderAll();
    });
    APPLICATION_CONTEXT.history.pushExecuted(
      apply(next, "redo:" + reason),
      apply(prev, "undo:" + reason),
      { name: "Questionaire: " + reason, type: "questionaire.designerEdit" } as any,
    );
  }

  /**
   * Live inline-text edit: update the runtime + toolbar immediately WITHOUT
   * rebuilding the designer (so the focused input survives), and debounce the
   * undo snapshot so a burst of keystrokes collapses into one history entry.
   */
  private commitInline(reason: string): void {
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
    this.renderToolbar();
    this.renderRuntime();
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => { this._persistTimer = null; this.pushSchemaHistory(reason); }, 500);
  }

  /**
   * Commit a form title/description edit made from the toolbar header. The
   * toolbar input itself is the live view, so NO re-render is needed (rebuilding
   * the toolbar would kill the focused input); just raise the change event and
   * debounce the undo snapshot.
   */
  private commitFormMeta(reason: string): void {
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => { this._persistTimer = null; this.pushSchemaHistory(reason); }, 500);
  }

  private flushPendingPersist(): void {
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
  }

  private visiblePages(): QuestionnairePage[] {
    return this._schema.pages.filter((page) => conditionMatches(page.visibleWhen, this._answers));
  }

  private movePage(oldIndex: number, newIndex: number): void {
    if (newIndex < 0 || newIndex >= this._schema.pages.length || oldIndex === newIndex) return;
    const [page] = this._schema.pages.splice(oldIndex, 1);
    this._schema.pages.splice(newIndex, 0, page);
    if (this._currentPage === oldIndex) this._currentPage = newIndex;
    this.raiseTypedEvent("questionnaire-page-moved", { pageId: page.id, oldIndex, newIndex });
    this.persistSchema("page-move");
  }

  private _removePageAt(index: number): void {
    if (this._schema.pages.length <= 1) return;
    const [page] = this._schema.pages.splice(index, 1);
    this.raiseTypedEvent("questionnaire-page-removed", { pageId: page.id, index });
    this._currentPage = Math.max(0, Math.min(this._currentPage, this._schema.pages.length - 1));
    this.persistSchema("page-remove");
  }

  private moveElement(pageId: string, oldIndex: number, newIndex: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    if (newIndex < 0 || newIndex >= page.elements.length || oldIndex === newIndex) return;
    const [element] = page.elements.splice(oldIndex, 1);
    page.elements.splice(newIndex, 0, element);
    this.raiseTypedEvent("questionnaire-element-moved", { pageId, elementId: element.id, oldIndex, newIndex });
    this.persistSchema("element-move");
  }

  private _removeElementAt(pageId: string, index: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    const [element] = page.elements.splice(index, 1);
    this.raiseTypedEvent("questionnaire-element-removed", { pageId, elementId: element.id, index });
    this.persistSchema("element-remove");
  }

  private raiseTypedEvent<K extends keyof PluginEventMap>(name: K, payload: PluginEventMap[K]): void {
    this.raiseEvent(name, payload as any);
  }

  private showInfo(message: string): void {
    try {
      if (typeof Dialogs !== "undefined" && Dialogs?.show) {
        Dialogs.show(message, 2000, Dialogs.MSG_INFO || undefined);
        return;
      }
    } catch {}
    window.alert(message);
  }
}
