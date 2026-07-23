import { button, el, numberInput, tabStrip, toggleInput } from "./dom";
import { defaultSchema, makeElement, makePage, normalizeSchema } from "./schema";
import type {
  PluginEventMap,
  QuestionnaireAnswers,
  QuestionnaireAnimationApplyMode,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireFileElement,
  QuestionnaireFileValue,
  QuestionnaireMatrixElement,
  QuestionnaireMeasurementElement,
  QuestionnairePage,
  QuestionnairePageRecordingBinding,
  QuestionnairePageScene,
  QuestionnaireRepeatElement,
  QuestionnaireRoiElement,
  QuestionnaireSceneApplyMode,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
  QuestionnaireValue,
  ViewerLikeRecord,
} from "./types";
import {
  answerFor,
  clone,
  conditionMatches,
  formatBytes,
  readFileAsDataURL,
  sanitizeName,
  tRaw,
  uid,
} from "./utils";
import { GRADING_PRESETS, gradingPreset } from "./grading-presets";
import { captureSelectedRegion, describeRegion, isAnnotationsAvailable, showRegion } from "./roi";
import type { CapturedRegion } from "./roi";
import { validatePage } from "./validation";
import {
  applyPageSceneFull,
  applySceneViewports,
  bindingByteSize,
  captureCurrentPageScene,
  currentSceneMatches,
  describePageScene,
  describeRecordingBinding,
  formatByteSize,
  getRecorderModule,
  listViewerRecordings,
  loadBindingIntoRecorder,
  resolveBindingViewer,
  snapshotRecordingBinding,
} from "./page-scene";

declare const LAYOUT: any;
declare const Dialogs: any;

export class QuestionnairePlugin extends XOpatPlugin {
  private readonly DRAFT_KEY = "questionnaire_draft";
  private _schema: QuestionnaireSchema = clone(defaultSchema());
  private _answers: QuestionnaireAnswers = {};
  /** Index into `_schema.pages` — the designer AND the runtime share this meaning. */
  private _currentPage = 0;
  private _designerActive = false;
  private _isExported = false;
  private _enableEditor = true;
  /** Runtime editing gate, driven by the `questionaire.edit` capability. */
  private _canEdit = true;
  /** Disposer for the capability subscription. */
  private _disposeCanEdit?: () => void;
  private _viewerMap = new Map<string, ViewerLikeRecord>();
  private _toolbarEl: HTMLElement | null = null;
  private _designerEl: HTMLElement | null = null;
  private _runtimeEl: HTMLElement | null = null;
  /** Coarse undo snapshot of the schema for designer edits. */
  private _persistedSchemaSerialized: string = "";
  /** Debounce timer coalescing inline text edits into one undo snapshot. */
  private _persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce timer coalescing answer keystrokes into one draft save. */
  private _draftTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pages (by id) whose validation errors are shown — set on a failed Next/Submit. */
  private _showErrors = new Set<string>();
  /** Conditional-visibility fingerprint of the last runtime render (see refreshRuntime). */
  private _lastVisibilityFp = "";
  /** Per-field error nodes of the current runtime render, for in-place updates. */
  private _errorNodes = new Map<string, HTMLElement>();
  /** CRUD façade for per-field answer sync; inert until `crud:answer` bound. */
  private answerResource?: any;
  /** Page whose saved viewer setup awaits the respondent's confirmation (prompt banner). */
  private _pendingScenePageId: string | null = null;
  /** Disposers for the recorder-event subscriptions refreshing the designer. */
  private _recorderDisposers: Array<() => void> = [];
  /** Disposers for the playback subscriptions of the runtime tour-control bar. */
  private _tourControlDisposers: Array<() => void> = [];

  constructor(id: string) {
    super(id);
    this._enableEditor = this.getOption("enableEditor", true);
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
          (wrapped as any).userMessage = $.t("questionaire:messages.importFailed", { reason });
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

  async pluginReady(): Promise<void> {
    // UI strings resolve through the plugin locale namespace ($.t("questionaire:…")).
    await this.loadLocale().catch(() =>
      this.loadLocale("en").catch((e: any) => console.warn("[questionaire] failed to load locale:", e)));
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
    // Draft writes are debounced (~300 ms). Page-change/submit/blur flush the
    // pending write, but a tab close/reload/crash within the debounce window
    // would otherwise drop the last keystrokes. Flush on hide/unload too —
    // `visibilitychange → hidden` is the reliable close/switch signal, `pagehide`
    // covers bfcache + navigation. flushDraftSave() is a no-op when nothing is
    // pending, so these are cheap.
    const flushOnHide = () => { if (document.visibilityState === "hidden") this.flushDraftSave(); };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", () => this.flushDraftSave());
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

  // ---------------------------------------------------------------------
  // Page presentation: viewer setup (scene) + recorder tours.
  //
  // The runtime already replays these on page visit (applyPageVisit ->
  // loadPageRecordings); until now only the designer UI could author them.
  // These are the same operations the designer performs, reachable
  // programmatically (scripting API, host integrations).
  // ---------------------------------------------------------------------

  /**
   * Shallow-merge a patch into a page's own fields. Elements, recordings and
   * the id are owned by their dedicated methods and are never patched here.
   */
  updatePage(pageRef: string | number, patch: Partial<QuestionnairePage>): QuestionnairePage {
    const page = this._requirePage(pageRef);
    const { id, elements, recordings, scene, ...rest } = patch || {};
    Object.assign(page, rest);
    this._applySchema(this._schema, "script-page-update");
    return clone(this._findPageById(page.id) ?? page);
  }

  /** Store the current slide/grid/viewport layout on a page. Replaces any stored scene. */
  capturePageScene(pageRef: string | number): QuestionnairePageScene {
    const page = this._requirePage(pageRef);
    page.scene = captureCurrentPageScene(Array.from(this._viewerMap.values()));
    this.raiseTypedEvent("questionnaire-page-scene-captured", { pageId: page.id, scene: clone(page.scene) });
    this.persistSchema("page-scene-capture");
    return clone(page.scene);
  }

  /** Drop a page's stored viewer setup. Returns true when there was one. */
  clearPageScene(pageRef: string | number): boolean {
    const page = this._requirePage(pageRef);
    if (!page.scene) return false;
    page.scene = undefined;
    this.persistSchema("page-scene-clear");
    return true;
  }

  /** The viewer slots this page's recordings can bind to (scene-defined, else the live grid). */
  listPageViewerSlots(pageRef: string | number): Array<{ index: number; title: string; viewerId?: string; backgroundId?: string }> {
    return this.pageViewerSlots(this._requirePage(pageRef));
  }

  /**
   * Attach a recorder recording to one viewer slot of a page. The binding
   * embeds a copy of the recording's steps and assets, so it keeps working
   * after the author edits or deletes the original — and needs a re-bind to
   * pick such edits up.
   */
  bindPageRecording(
    pageRef: string | number,
    slotIndex: number,
    recordingId: string,
    opts?: { autoplay?: boolean },
  ): QuestionnairePageRecordingBinding {
    const page = this._requirePage(pageRef);
    const recorder = getRecorderModule();
    if (!recorder) throw new Error("The recorder module is not available.");
    const slot = this.pageViewerSlots(page).find((s) => s.index === slotIndex);
    if (!slot) throw new Error(`Page '${page.id}' has no viewer slot ${slotIndex}.`);
    if (!slot.viewerId) throw new Error(`Viewer slot ${slotIndex} has no open viewer to read a recording from.`);
    const recording = listViewerRecordings(recorder, slot.viewerId as UniqueViewerId).find((r) => r.id === recordingId);
    if (!recording) {
      throw new Error(`Viewer slot ${slotIndex} has no recording '${recordingId}'. Only non-empty recordings of that slot's viewer can be bound.`);
    }
    this.bindRecording(page, slot, recording, recorder);
    const binding = page.recordings?.find((b) => b.slotIndex === slotIndex);
    if (!binding) throw new Error(`Failed to bind recording '${recordingId}' to slot ${slotIndex}.`);
    if (opts?.autoplay !== undefined) {
      binding.autoplay = !!opts.autoplay;
      this.persistSchema("page-recording-autoplay");
    }
    return clone(binding);
  }

  /** Whether a page's bound recording starts by itself when a respondent opens the page. */
  setPageRecordingAutoplay(pageRef: string | number, slotIndex: number, value: boolean): QuestionnairePageRecordingBinding {
    const page = this._requirePage(pageRef);
    const binding = page.recordings?.find((b) => b.slotIndex === slotIndex);
    if (!binding) throw new Error(`Page '${page.id}' has no recording bound to slot ${slotIndex}.`);
    binding.autoplay = !!value;
    this.persistSchema("page-recording-autoplay");
    return clone(binding);
  }

  /** Detach a page's bound recording. Returns true when there was one. */
  removePageRecording(pageRef: string | number, slotIndex: number): boolean {
    const page = this._requirePage(pageRef);
    const binding = page.recordings?.find((b) => b.slotIndex === slotIndex);
    if (!binding) return false;
    this.removeRecordingBinding(page, binding);
    return true;
  }

  /**
   * One-call page setup: capture the current viewer layout, then bind each
   * viewer's active recording to its slot. The common case — the author built
   * a tour per viewer and wants the page to present exactly that.
   *
   * Slots whose viewer has no usable recording are reported in `skipped`
   * rather than silently dropped.
   */
  bindPageTour(pageRef: string | number, opts?: { autoplay?: boolean }): {
    scene: QuestionnairePageScene;
    bound: QuestionnairePageRecordingBinding[];
    skipped: Array<{ slotIndex: number; title: string; reason: string }>;
  } {
    const page = this._requirePage(pageRef);
    const recorder = getRecorderModule();
    if (!recorder) throw new Error("The recorder module is not available.");
    const scene = this.capturePageScene(page.id);
    const bound: QuestionnairePageRecordingBinding[] = [];
    const skipped: Array<{ slotIndex: number; title: string; reason: string }> = [];

    for (const slot of this.pageViewerSlots(page)) {
      if (!slot.viewerId) {
        skipped.push({ slotIndex: slot.index, title: slot.title, reason: "no open viewer for this slot" });
        continue;
      }
      // The active recording is what the author last worked on — the same one
      // the recorder timeline shows for that viewer.
      const active = recorder.getActiveRecording(slot.viewerId as UniqueViewerId);
      const usable = active && listViewerRecordings(recorder, slot.viewerId as UniqueViewerId).some((r) => r.id === active.id);
      if (!active || !usable) {
        skipped.push({ slotIndex: slot.index, title: slot.title, reason: "the viewer has no recording with steps" });
        continue;
      }
      bound.push(this.bindPageRecording(page.id, slot.index, active.id, { autoplay: opts?.autoplay ?? false }));
    }
    return { scene, bound, skipped };
  }

  private _requirePage(ref: string | number): QuestionnairePage {
    const page = this._schema.pages[this._resolvePageIndex(ref)];
    if (!page) throw new Error(`Questionnaire page '${ref}' was not found.`);
    return page;
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
      title: $.t("questionaire:tab.title"),
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

  /**
   * Full repaint, preserving the scroll position of the surrounding container
   * so structural designer edits (reorder, toggle, remove) don't jump the view.
   */
  private renderAll(): void {
    const scroller = this.findScrollContainer();
    const top = scroller?.scrollTop ?? 0;
    this.renderToolbar();
    this.renderDesigner();
    this.renderRuntime();
    if (scroller) scroller.scrollTop = top;
  }

  private findScrollContainer(): HTMLElement | null {
    let node: HTMLElement | null = this._toolbarEl?.parentElement ?? null;
    while (node) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    const scrolling = document.scrollingElement as HTMLElement | null;
    return scrolling && scrolling.scrollHeight > scrolling.clientHeight ? scrolling : null;
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
      left.append(this.inlineInput(this._schema.title || "", $.t("questionaire:tab.title"), (v) => { this._schema.title = v; this.commitInline("form-title"); }, "input input-ghost text-lg font-semibold px-0 w-full focus:outline-none"));
      left.append(this.inlineInput(this._schema.description || "", $.t("questionaire:toolbar.defaultDescription"), (v) => { this._schema.description = v; this.commitInline("form-description"); }, "input input-ghost input-sm px-0 w-full text-base-content/70 focus:outline-none"));
    } else {
      left.append(el("h2", "text-lg font-semibold", this._schema.title || $.t("questionaire:tab.title")));
      const subtitle = this._schema.description || (canManage ? $.t("questionaire:toolbar.defaultDescription") : "");
      if (subtitle) left.append(el("div", "text-sm text-base-content/70", subtitle));
    }
    const right = el("div", "flex flex-wrap items-center gap-2");
    if (this._enableEditor && canManage) {
      right.append(button(this._designerActive ? $.t("questionaire:toolbar.hideDesigner") : $.t("questionaire:toolbar.showDesigner"), "btn btn-outline btn-sm", () => {
        this._designerActive = !this._designerActive;
        this.raiseTypedEvent("questionnaire-designer-toggle", { active: this._designerActive });
        this.renderAll();
      }));
    }
    if (canManage) {
      right.append(button($.t("questionaire:toolbar.clearDraft"), "btn btn-outline btn-sm", () => {
        this.flushDraftSave();
        this._answers = {};
        this._showErrors.clear();
        this.saveDraft();
        this.renderRuntime();
      }));
    }
    right.append(this.renderPrefsDropdown());
    if (this._isExported) right.append(el("span", "badge badge-warning", $.t("questionaire:toolbar.readOnly")));
    wrap.append(left, right);
    this._toolbarEl.append(wrap);
  }

  /**
   * Respondent preferences (UX-only, persisted in the plugin cache kv):
   * whether saved viewer setups apply without asking, and whether bound page
   * recordings autoplay. Flipping auto-apply while a prompt is pending applies
   * that scene right away.
   */
  private renderPrefsDropdown(): HTMLElement {
    const dropdown = el("div", "dropdown dropdown-end");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.tabIndex = 0;
    trigger.className = "btn btn-ghost btn-sm btn-square";
    trigger.title = $.t("questionaire:prefs.title");
    trigger.setAttribute("aria-label", $.t("questionaire:prefs.title"));
    const icon = document.createElement("i");
    icon.className = "ph-light ph-gear-six";
    trigger.append(icon);
    const panel = el("div", "dropdown-content z-30 mt-1 w-72 rounded-box border border-base-300 bg-base-100 p-3 shadow space-y-2");
    panel.tabIndex = 0;
    panel.append(el("div", "text-xs font-semibold uppercase tracking-wide text-base-content/60", $.t("questionaire:prefs.title")));
    panel.append(toggleInput($.t("questionaire:prefs.autoApplyScenes"), this.prefAutoApplyScenes(), (checked) => {
      this.cache.set("prefs.autoApplyScenes", checked);
      if (checked && this._pendingScenePageId) {
        const page = this._schema.pages.find((p) => p.id === this._pendingScenePageId);
        if (page) void this.confirmPendingScene(page).catch((e) => console.warn("[questionaire] scene apply failed:", e));
      }
    }));
    panel.append(toggleInput($.t("questionaire:prefs.autoplayRecordings"), this.prefAutoplayRecordings(), (checked) => {
      this.cache.set("prefs.autoplayRecordings", checked);
    }));
    dropdown.append(trigger, panel);
    return dropdown;
  }

  // ── Designer: Google-Forms-like single column ────────────────────────────

  /**
   * Lean question-type palette (Google-Forms-style names). Locale KEYS — never
   * call $.t in statics, it may run before i18n init (see AGENTS.md §3).
   */
  private static readonly QUESTION_TYPES: Array<{ kind: QuestionnaireElement["kind"]; labelKey: string }> = [
    { kind: "text", labelKey: "questionaire:types.text" },
    { kind: "textarea", labelKey: "questionaire:types.textarea" },
    { kind: "radio", labelKey: "questionaire:types.radio" },
    { kind: "multiselect", labelKey: "questionaire:types.multiselect" },
    { kind: "select", labelKey: "questionaire:types.select" },
    { kind: "checkbox", labelKey: "questionaire:types.checkbox" },
    { kind: "number", labelKey: "questionaire:types.number" },
    { kind: "measurement", labelKey: "questionaire:types.measurement" },
    { kind: "file", labelKey: "questionaire:types.file" },
    { kind: "matrix", labelKey: "questionaire:types.matrix" },
    { kind: "roi", labelKey: "questionaire:types.roi" },
  ];

  private renderDesigner(): void {
    if (!this._designerEl) return;
    this._designerEl.innerHTML = "";
    this._designerEl.classList.toggle("hidden", !this._designerActive);
    if (!this._designerActive) return;

    this._clampCurrentPage();
    const col = el("div", "questionnaire-designer-col mx-auto w-full max-w-3xl space-y-3");
    const page = this._schema.pages[this._currentPage] || this._schema.pages[0];
    // The header (section selector + the active page's metadata + viewer setup)
    // reads as one block; the question items live in a separate content region
    // below so the structural controls are clearly set apart from the content.
    col.append(this.renderSectionHeader(page));
    if (page) {
      const items = el("div", "questionnaire-designer-content space-y-3");
      // Clear "Questions" divider so the content region is unmistakably separate
      // from the page-setup header above it.
      items.append(el("div", "divider divider-start text-xs font-semibold uppercase tracking-wide text-base-content/50", $.t("questionaire:designer.questions")));
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
    const body = el("div", "card-body p-3 gap-2");

    body.append(el("div", "text-xs font-semibold uppercase tracking-wide text-primary", $.t("questionaire:designer.pageSetup")));

    // Section selector row.
    const bar = el("div", "flex items-center justify-between gap-2");
    const tabs = tabStrip(this._schema.pages.map((p, i) => ({
      label: p.title || $.t("questionaire:designer.sectionN", { n: i + 1 }),
      active: i === this._currentPage,
      onClick: () => { this._currentPage = i; this.renderDesigner(); },
    })), "min-w-0 flex-1");
    bar.append(tabs);
    bar.append(button($.t("questionaire:designer.addSection"), "btn btn-ghost btn-sm", () => {
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
    titles.append(this.inlineInput(page.title || "", $.t("questionaire:designer.sectionTitle"), (v) => { page.title = v; this.commitInline("page-title"); }, "input input-ghost input-sm text-base font-semibold px-0 w-full focus:outline-none"));
    titles.append(this.inlineTextarea(page.description || "", $.t("questionaire:designer.sectionDescription"), (v) => { page.description = v; this.commitInline("page-description"); }, 1));
    header.append(titles);
    const ctl = el("div", "flex gap-1");
    ctl.append(button("↑", "btn btn-ghost btn-xs", () => this.movePage(this._currentPage, this._currentPage - 1)));
    ctl.append(button("↓", "btn btn-ghost btn-xs", () => this.movePage(this._currentPage, this._currentPage + 1)));
    if (this._schema.pages.length > 1) ctl.append(button("✕", "btn btn-ghost btn-xs text-error", () => this._removePageAt(this._currentPage)));
    header.append(ctl);
    body.append(header);

    const details = document.createElement("details");
    details.className = "collapse collapse-arrow border border-base-300 bg-base-100 rounded-box";
    // Auto-expand when the page already carries a setup/recordings, so the
    // saved state is visible without hunting for it.
    if (page.scene || page.recordings?.length) details.setAttribute("open", "");
    const summary = document.createElement("summary");
    summary.className = "collapse-title min-h-0 py-2 text-sm font-medium";
    summary.textContent = $.t("questionaire:designer.viewerSetupAndRecordings");
    const content = el("div", "collapse-content space-y-2");
    content.append(this.renderViewerSetupEditor(page), this.renderPageRecordingsEditor(page));
    details.append(summary, content);
    body.append(details);

    wrap.append(body);
    return wrap;
  }

  private renderItemCard(page: QuestionnairePage, element: QuestionnaireElement, index: number): HTMLElement {
    const wrap = el("div", "card bg-base-100 border border-base-300 shadow-sm");
    const body = el("div", "card-body p-3 gap-2");

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
    headRow.append(this.inlineInput(element.label || "", $.t("questionaire:designer.question"), (v) => { element.label = v; this.commitInline("element-label"); }, "input input-bordered input-sm w-full font-medium"));
    headRow.append(this.buildSelect(
      QuestionnairePlugin.QUESTION_TYPES.filter((t) => t.kind !== "roi" || isAnnotationsAvailable()).map((t) => ({ value: t.kind, label: $.t(t.labelKey) })),
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
    req.append(el("span", "label-text text-sm", $.t("questionaire:designer.required")), reqInput);
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
      return this.inlineInput(element.placeholder || "", $.t("questionaire:designer.placeholderOptional"), (v) => { element.placeholder = v; this.commitInline("element-placeholder"); });
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
      row.append(this.inlineInput(opt.label, $.t("questionaire:designer.optionN", { n: i + 1 }), (v) => { opt.label = v; this.commitInline("element-option"); }));
      row.append(button("✕", "btn btn-ghost btn-xs", () => { element.options!.splice(i, 1); this.persistSchema("element-option-remove"); }));
      wrap.append(row);
    });
    const tools = el("div", "flex items-center gap-2 flex-wrap");
    tools.append(button($.t("questionaire:designer.addOption"), "btn btn-ghost btn-xs", () => {
      const n = element.options!.length + 1;
      element.options!.push({ value: `option_${n}`, label: $.t("questionaire:designer.optionValue", { n }) });
      this.persistSchema("element-option-add");
    }));
    tools.append(this.buildSelect(
      [{ value: "", label: $.t("questionaire:designer.loadPreset") }, ...GRADING_PRESETS.map((p) => ({ value: p.id, label: p.label }))],
      "",
      (v) => { const preset = gradingPreset(v); if (!preset) return; element.options = clone(preset.options); this.persistSchema("element-options-preset"); },
      "select select-bordered select-xs",
    ));
    wrap.append(tools);
    return wrap;
  }

  private renderGridEditor(element: QuestionnaireMatrixElement): HTMLElement {
    const wrap = el("div", "grid gap-2 md:grid-cols-2");
    const mk = (kindKey: "row" | "column", list: Array<{ value: string; label: string }>, reason: string, prefix: string) => {
      const single = $.t(`questionaire:designer.${kindKey}`);
      const box = el("div", "space-y-1");
      box.append(el("div", "text-xs font-medium text-base-content/70", $.t(`questionaire:designer.${kindKey}s`)));
      list.forEach((item, i) => {
        const row = el("div", "flex items-center gap-1");
        row.append(this.inlineInput(item.label, `${single} ${i + 1}`, (v) => { item.label = v; this.commitInline(reason); }));
        row.append(button("✕", "btn btn-ghost btn-xs", () => { list.splice(i, 1); this.persistSchema(reason + "-remove"); }));
        box.append(row);
      });
      box.append(button($.t("questionaire:designer.add"), "btn btn-ghost btn-xs", () => { const n = list.length + 1; list.push({ value: `${prefix}_${n}`, label: `${single} ${n}` }); this.persistSchema(reason + "-add"); }));
      return box;
    };
    element.rows ||= [];
    element.columns ||= [];
    wrap.append(mk("row", element.rows, "matrix-rows", "row"), mk("column", element.columns, "matrix-cols", "col"));
    return wrap;
  }

  private renderMeasurementEditor(element: QuestionnaireMeasurementElement): HTMLElement {
    const wrap = el("div", "space-y-1");
    wrap.append(el("div", "text-xs font-medium text-base-content/70", $.t("questionaire:designer.unitsLabel")));
    const units = (element.units && element.units.length ? element.units : ["mm"]).join(", ");
    wrap.append(this.inlineInput(units, "mm, µm, %, count", (v) => { element.units = v.split(",").map((s) => s.trim()).filter(Boolean); this.commitInline("element-units"); }));
    return wrap;
  }

  private renderRoiEditor(element: QuestionnaireRoiElement): HTMLElement {
    const wrap = el("div", "space-y-1");
    if (!isAnnotationsAvailable()) {
      wrap.append(el("div", "text-xs text-warning", $.t("questionaire:roi.moduleMissingDesigner")));
    }
    wrap.append(el("div", "text-xs font-medium text-base-content/70", $.t("questionaire:roi.shape")));
    wrap.append(this.buildSelect([{ value: "rect", label: $.t("questionaire:roi.rectangle") }, { value: "polygon", label: $.t("questionaire:roi.polygon") }], element.shape || "rect", (v) => { element.shape = v as "rect" | "polygon"; this.persistSchema("element-roi-shape"); }, "select select-bordered select-sm"));
    return wrap;
  }

  private renderContentEditor(element: QuestionnaireContentElement): HTMLElement {
    const wrap = el("div", "space-y-2");
    const variant = element.variant === "header" ? "header" : "text";
    wrap.append(this.buildSelect([{ value: "header", label: $.t("questionaire:designer.titleBlock") }, { value: "text", label: $.t("questionaire:designer.textBlock") }], variant, (v) => { element.variant = v as "header" | "text"; this.persistSchema("content-variant"); }, "select select-bordered select-xs"));
    wrap.append(this.inlineTextarea(element.text || "", variant === "header" ? $.t("questionaire:designer.headingText") : $.t("questionaire:designer.descriptiveText"), (v) => { element.text = v; this.commitInline("content-text"); }, variant === "header" ? 1 : 3));
    return wrap;
  }

  private renderAdvanced(element: QuestionnaireElement): HTMLElement {
    const d = document.createElement("details");
    d.className = "text-sm";
    const s = document.createElement("summary");
    s.className = "cursor-pointer text-xs text-base-content/60";
    s.textContent = $.t("questionaire:designer.advanced");
    const box = el("div", "mt-2 space-y-2 rounded-box border border-base-300 p-2");
    box.append(this.inlineInput(element.description || "", $.t("questionaire:designer.helpText"), (v) => { element.description = v; this.commitInline("element-help"); }));
    if (element.kind === "number" || element.kind === "measurement") {
      const validation = (element.validation ||= {});
      const row = el("div", "flex gap-2");
      row.append(numberInput($.t("questionaire:designer.min"), Number(validation.min ?? 0), (v) => { validation.min = v; this.commitInline("element-min"); }));
      row.append(numberInput($.t("questionaire:designer.max"), Number(validation.max ?? 0), (v) => { validation.max = v; this.commitInline("element-max"); }));
      box.append(row);
    }
    d.append(s, box);
    return d;
  }

  private renderAddToolbar(page: QuestionnairePage): HTMLElement {
    const wrap = el("div", "flex items-center gap-2 flex-wrap rounded-box border border-dashed border-base-300 p-2");
    wrap.append(el("span", "text-xs text-base-content/60", $.t("questionaire:designer.addLabel")));
    const add = (element: QuestionnaireElement, reason: string) => {
      page.elements.push(element);
      this.raiseTypedEvent("questionnaire-element-added", { pageId: page.id, element: clone(element), index: page.elements.length - 1 });
      this.persistSchema(reason);
    };
    wrap.append(button($.t("questionaire:designer.addQuestion"), "btn btn-primary btn-sm", () => add(makeElement("text"), "element-add")));
    wrap.append(button($.t("questionaire:designer.addTitle"), "btn btn-outline btn-sm", () => { const e = makeElement("content") as QuestionnaireContentElement; e.variant = "header"; e.text = $.t("questionaire:designer.defaultTitleText"); add(e, "content-add"); }));
    wrap.append(button($.t("questionaire:designer.addText"), "btn btn-outline btn-sm", () => { const e = makeElement("content") as QuestionnaireContentElement; e.variant = "text"; e.text = $.t("questionaire:designer.defaultBodyText"); add(e, "content-add"); }));
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

  /**
   * Viewer-setup block: capture/restore goes through the core canonical-scene
   * API (page-scene.ts). Shows a clear saved-state summary + a live indicator
   * of whether the current viewer already matches the saved setup.
   */
  private renderViewerSetupEditor(page: QuestionnairePage): HTMLElement {
    const box = el("div", "questionnaire-page-setup-box rounded-box border border-base-300 p-2");
    box.append(el("div", "text-sm font-medium mb-1", $.t("questionaire:viewerSetup.title")));
    box.append(el("div", "text-xs text-base-content/70 mb-2", $.t("questionaire:viewerSetup.help")));

    const status = el("div", "mb-2 rounded-box bg-base-200/60 p-2 text-sm space-y-1");
    if (page.scene) {
      const badges = el("div", "flex items-center gap-2 flex-wrap");
      badges.append(el("span", "badge badge-success badge-sm", $.t("questionaire:viewerSetup.saved")));
      const matches = currentSceneMatches(page.scene);
      badges.append(el("span", `badge badge-sm ${matches ? "badge-success badge-outline" : "badge-warning"}`,
        matches ? $.t("questionaire:viewerSetup.matchesCurrent") : $.t("questionaire:viewerSetup.differsFromCurrent")));
      status.append(badges);
      status.append(el("div", "", describePageScene(page.scene)));
    } else {
      status.append(el("div", "text-base-content/70", $.t("questionaire:viewerSetup.noneSaved")));
    }
    box.append(status);

    const actions = el("div", "flex flex-wrap gap-2");
    actions.append(button($.t("questionaire:viewerSetup.capture"), "btn btn-primary btn-sm", () => {
      page.scene = captureCurrentPageScene(Array.from(this._viewerMap.values()));
      this.raiseTypedEvent("questionnaire-page-scene-captured", { pageId: page.id, scene: clone(page.scene) });
      this.showInfo($.t("questionaire:viewerSetup.capturedToast"));
      this.persistSchema("page-scene-capture");
    }));
    if (page.scene) {
      actions.append(button($.t("questionaire:viewerSetup.preview"), "btn btn-outline btn-sm", () => { void this.applyStoredPageScene(page, "manual"); }));
      actions.append(button($.t("questionaire:viewerSetup.clear"), "btn btn-outline btn-sm", () => {
        page.scene = undefined;
        this.persistSchema("page-scene-clear");
      }));
    }
    box.append(actions);

    if (page.scene) {
      // How the respondent gets this setup: reload immediately, or ask first.
      const deploymentDefault = this.deploymentDefaultSceneApplyMode();
      const modeRow = el("div", "mt-2 flex items-center gap-2 flex-wrap");
      modeRow.append(el("span", "text-xs text-base-content/70", $.t("questionaire:viewerSetup.applyMode")));
      modeRow.append(this.buildSelect([
        { value: "", label: $.t("questionaire:viewerSetup.applyModeDefault", { mode: $.t(deploymentDefault === "auto" ? "questionaire:viewerSetup.applyModeAuto" : "questionaire:viewerSetup.applyModePrompt") }) },
        { value: "auto", label: $.t("questionaire:viewerSetup.applyModeAuto") },
        { value: "prompt", label: $.t("questionaire:viewerSetup.applyModePrompt") },
      ], page.sceneApplyMode ?? "", (value) => {
        page.sceneApplyMode = value === "auto" || value === "prompt" ? value : undefined;
        this.persistSchema("page-scene-apply-mode");
      }));
      box.append(modeRow);
    }
    return box;
  }

  /**
   * Per-viewer-slot recording picker. Binding a recording snapshots its steps
   * + referenced overlay assets into the page (self-contained bundle) while
   * keeping a reference to the source recording for staleness/Refresh. The
   * recorder is never wiped — this replaced the destructive "consume" flow.
   */
  private renderPageRecordingsEditor(page: QuestionnairePage): HTMLElement {
    const box = el("div", "questionnaire-page-setup-box rounded-box border border-base-300 p-2");
    box.append(el("div", "text-sm font-medium mb-1", $.t("questionaire:recordings.title")));
    box.append(el("div", "text-xs text-base-content/70 mb-2", $.t("questionaire:recordings.help")));
    const recorder = getRecorderModule();
    if (recorder) this._wireRecorderEvents(recorder);
    else box.append(el("div", "text-xs text-warning mb-2", $.t("questionaire:recordings.recorderUnavailable")));

    const slots = this.pageViewerSlots(page);
    const rows = el("div", "space-y-2");
    slots.forEach((slot) => rows.append(this.renderRecordingSlotRow(page, slot, recorder)));
    // Bindings pointing beyond the known slots (e.g. captured with more
    // viewers than are listed now) must stay visible and removable.
    for (const binding of page.recordings ?? []) {
      if (!slots.some((slot) => slot.index === binding.slotIndex)) {
        rows.append(this.renderRecordingSlotRow(page, { index: binding.slotIndex, title: binding.viewerTitle || `#${binding.slotIndex + 1}`, viewerId: undefined, backgroundId: undefined }, recorder));
      }
    }
    box.append(rows);
    return box;
  }

  /**
   * The viewer slots a page's recordings can bind to. With a captured scene
   * the scene defines them (titles included); otherwise the live grid does.
   */
  private pageViewerSlots(page: QuestionnairePage): Array<{ index: number; title: string; viewerId?: string; backgroundId?: string }> {
    const liveViewers = ((VIEWER_MANAGER?.viewers || []) as OpenSeadragon.Viewer[]).filter(Boolean);
    const scene = page.scene;
    const sceneSlotBg = (slot: number): string | undefined => {
      if (!scene) return undefined;
      const active = Array.isArray(scene.activeBackgroundIndex) ? scene.activeBackgroundIndex[slot] : scene.activeBackgroundIndex;
      const bg: any = Number.isInteger(active) ? scene.background?.[active as number] : undefined;
      return typeof bg?.id === "string" ? bg.id : undefined;
    };
    const count = scene
      ? Math.max(scene.viewers?.length ?? 0, scene.viewerCount ?? 0, Array.isArray(scene.activeBackgroundIndex) ? scene.activeBackgroundIndex.length : 0) || liveViewers.length
      : liveViewers.length;
    const slots: Array<{ index: number; title: string; viewerId?: string; backgroundId?: string }> = [];
    for (let i = 0; i < count; i++) {
      // Live viewer for the slot: match the scene's capture-time uniqueId
      // first, else positional (same fallback the scene apply uses).
      const sceneUid = scene?.viewers?.[i]?.uniqueId;
      const live = (sceneUid && liveViewers.find((v: any) => v?.uniqueId === sceneUid)) || liveViewers[i];
      slots.push({
        index: i,
        title: scene?.viewerTitles?.[i] || (live as any)?.uniqueId || `#${i + 1}`,
        viewerId: (live as any)?.uniqueId,
        backgroundId: sceneSlotBg(i),
      });
    }
    return slots;
  }

  private renderRecordingSlotRow(
    page: QuestionnairePage,
    slot: { index: number; title: string; viewerId?: string; backgroundId?: string },
    recorder: RecorderModule | undefined,
  ): HTMLElement {
    const row = el("div", "rounded-box bg-base-200/60 p-2 space-y-2");
    const binding = page.recordings?.find((b) => b.slotIndex === slot.index);
    const available = recorder && slot.viewerId ? listViewerRecordings(recorder, slot.viewerId) : [];

    const head = el("div", "flex items-center gap-2 flex-wrap");
    head.append(el("span", "text-xs font-medium min-w-0 truncate", slot.title));

    if (recorder && slot.viewerId) {
      head.append(this.buildSelect(
        [{ value: "", label: $.t("questionaire:recordings.nonePicked") },
          ...available.map((r) => ({ value: r.id, label: tRaw("questionaire:recordings.option", { name: r.name, count: r.steps.length }) }))],
        binding && available.some((r) => r.id === binding.recordingId) ? binding.recordingId : "",
        (value) => {
          if (!value) {
            if (binding) this.removeRecordingBinding(page, binding);
            return;
          }
          const recording = available.find((r) => r.id === value);
          if (!recording) return;
          this.bindRecording(page, slot, recording, recorder);
        },
        "select select-bordered select-xs max-w-52",
      ));
    }
    row.append(head);
    if (!binding) return row;

    // Status: is the embedded snapshot still what the recorder has?
    const source = recorder && slot.viewerId
      ? recorder.listRecordings(slot.viewerId).find((r) => r.id === binding.recordingId)
      : undefined;
    const stale = !!source && (source.updatedAt ?? source.createdAt) > (binding.recordingUpdatedAt ?? 0);
    const badges = el("div", "flex items-center gap-2 flex-wrap text-xs");
    if (!recorder || !source) badges.append(el("span", "badge badge-ghost badge-sm", $.t("questionaire:recordings.missing")));
    else if (stale) badges.append(el("span", "badge badge-warning badge-sm", $.t("questionaire:recordings.stale")));
    else badges.append(el("span", "badge badge-success badge-outline badge-sm", $.t("questionaire:recordings.inSync")));
    if (binding.backgroundId && slot.backgroundId && binding.backgroundId !== slot.backgroundId) {
      badges.append(el("span", "badge badge-warning badge-sm", $.t("questionaire:recordings.slideMismatch")));
    }
    const size = bindingByteSize(binding);
    badges.append(el("span", size > 2 * 1024 * 1024 ? "text-warning" : "text-base-content/60",
      $.t("questionaire:recordings.embeddedSize", { size: formatByteSize(size) })));
    row.append(badges);
    row.append(el("div", "text-xs text-base-content/70", describeRecordingBinding(binding)));

    const actions = el("div", "flex items-center gap-2 flex-wrap");
    actions.append(toggleInput($.t("questionaire:recordings.autoplay"), !!binding.autoplay, (checked) => {
      binding.autoplay = checked;
      this.persistSchema("page-recording-autoplay");
    }));
    if (recorder) {
      actions.append(button($.t("questionaire:recordings.preview"), "btn btn-outline btn-xs", () => {
        const viewerId = loadBindingIntoRecorder(recorder, binding, page.id);
        if (viewerId) recorder.playFromIndex(0, viewerId);
      }));
      if (source && slot.viewerId) {
        const refresh = button($.t("questionaire:recordings.refresh"), "btn btn-outline btn-xs", () => {
          this.bindRecording(page, slot, source, recorder, binding);
          this.showInfo($.t("questionaire:recordings.refreshed"));
        });
        if (!stale) refresh.classList.add("btn-ghost");
        actions.append(refresh);
      } else if (slot.viewerId) {
        // Source id gone — offer a name-based re-link, confirmed by the author.
        const byName = listViewerRecordings(recorder, slot.viewerId).find((r) => r.name === binding.recordingName);
        if (byName) {
          actions.append(button($.t("questionaire:recordings.refresh"), "btn btn-outline btn-xs", () => {
            if (!window.confirm(tRaw("questionaire:recordings.refreshByNameConfirm", { name: binding.recordingName }))) return;
            this.bindRecording(page, slot, byName, recorder, binding);
            this.showInfo($.t("questionaire:recordings.refreshed"));
          }));
        }
      }
    }
    actions.append(button($.t("questionaire:recordings.remove"), "btn btn-ghost btn-xs text-error", () => {
      this.removeRecordingBinding(page, binding);
    }));
    row.append(actions);
    return row;
  }

  private bindRecording(
    page: QuestionnairePage,
    slot: { index: number; viewerId?: string },
    recording: RecorderRecording,
    recorder: RecorderModule,
    previous?: QuestionnairePageRecordingBinding,
  ): void {
    if (!slot.viewerId) return;
    const existing = previous ?? page.recordings?.find((b) => b.slotIndex === slot.index);
    const binding = snapshotRecordingBinding(recorder, slot.viewerId, recording, slot.index, existing);
    page.recordings = [...(page.recordings ?? []).filter((b) => b.slotIndex !== slot.index), binding]
      .sort((a, b) => a.slotIndex - b.slotIndex);
    this.raiseTypedEvent("questionnaire-page-recording-bound", { pageId: page.id, binding: clone(binding) });
    this.persistSchema("page-recording-bind");
  }

  private removeRecordingBinding(page: QuestionnairePage, binding: QuestionnairePageRecordingBinding): void {
    page.recordings = (page.recordings ?? []).filter((b) => b !== binding);
    if (!page.recordings.length) page.recordings = undefined;
    this.persistSchema("page-recording-unbind");
  }

  /** Keep the open designer in sync with recorder changes (rename/delete/…). */
  private _wireRecorderEvents(recorder: RecorderModule): void {
    if (this._recorderDisposers.length) return;
    const refresh = () => { if (this._designerActive) this.renderDesigner(); };
    for (const event of ["recording-create", "recording-rename", "recording-delete", "recording-active", "update"]) {
      (recorder as any).addHandler?.(event, refresh);
      this._recorderDisposers.push(() => (recorder as any).removeHandler?.(event, refresh));
    }
  }

  /** Tear down the playback subscriptions of a previously rendered control bar. */
  private _disposeTourControls(): void {
    this._tourControlDisposers.forEach((dispose) => dispose());
    this._tourControlDisposers = [];
  }

  /**
   * Runtime playback controls for the page's bound recordings: one play/stop
   * toggle plus previous/next step. Respondents drive the page's tour from the
   * questionnaire itself, without the recorder toolbar.
   *
   * Playback goes per bound viewer (`play(viewerId)`), never the no-arg
   * fan-out, so recordings the respondent has on unbound viewers stay idle —
   * same contract as `loadPageRecordings`. Viewer ids are re-resolved on every
   * click because a scene restore replaces viewers (and their uniqueIds).
   * Returns null when nothing is bound or no bound viewer is live.
   */
  private renderPageTourControls(page: QuestionnairePage): HTMLElement | null {
    const bindings = page.recordings;
    if (!bindings?.length) return null;
    const recorder = getRecorderModule();
    if (!recorder) return null;

    const targets = (): UniqueViewerId[] => bindings
      .map((binding) => resolveBindingViewer(binding)?.uniqueId as UniqueViewerId | undefined)
      .filter((id): id is UniqueViewerId => !!id);
    if (!targets().length) return null;

    const bar = el("div", "flex items-center gap-2 rounded-box bg-base-200 px-2 py-1");
    const playIcon = el("i", "ph-light ph-play");
    const playBtn = button("", "btn btn-primary btn-sm btn-square", () => {
      const ids = targets();
      if (ids.some((id) => recorder.isPlaying(id))) ids.forEach((id) => recorder.stop(id));
      else ids.forEach((id) => recorder.play(id));
      update();
    });
    playBtn.append(playIcon);
    const prevBtn = button("", "btn btn-outline btn-sm btn-square", () => {
      targets().forEach((id) => recorder.previous(id));
      update();
    });
    prevBtn.append(el("i", "ph-light ph-skip-back"));
    prevBtn.title = $.t("questionaire:tour.previousStep");
    prevBtn.setAttribute("aria-label", prevBtn.title);
    const nextBtn = button("", "btn btn-outline btn-sm btn-square", () => {
      targets().forEach((id) => recorder.next(id));
      update();
    });
    nextBtn.append(el("i", "ph-light ph-skip-forward"));
    nextBtn.title = $.t("questionaire:tour.nextStep");
    nextBtn.setAttribute("aria-label", nextBtn.title);

    const title = el("div", "text-sm font-medium truncate", bindings.length > 1
      ? $.t("questionaire:tour.multiple", { count: bindings.length })
      : bindings[0]!.recordingName);
    const status = el("div", "text-xs text-base-content/70");
    const label = el("div", "min-w-0 flex-1", undefined, [title, status]);

    const update = () => {
      const ids = targets();
      const playing = ids.some((id) => recorder.isPlaying(id));
      playIcon.className = `ph-light ph-${playing ? "stop" : "play"}`;
      playBtn.title = $.t(playing ? "questionaire:tour.stop" : "questionaire:tour.play");
      playBtn.setAttribute("aria-label", playBtn.title);
      // Step position tracks the first bound viewer: with several bound
      // recordings they play in lockstep, so one lane is representative.
      const lead = ids[0];
      const count = lead ? recorder.snapshotCount(lead) : 0;
      status.textContent = count
        ? tRaw("questionaire:tour.step", { current: Math.max(0, recorder.currentStepIndex(lead!)) + 1, count })
        : "";
      const usable = !!ids.length && count > 0;
      playBtn.disabled = !usable;
      prevBtn.disabled = nextBtn.disabled = !usable || count < 2;
    };
    update();

    // Playback advances on its own timers and the recorder toolbar can drive it
    // too — mirror both instead of assuming our buttons are the only source.
    for (const event of ["play", "stop", "enter", "recording-active", "update"]) {
      (recorder as any).addHandler?.(event, update);
      this._tourControlDisposers.push(() => (recorder as any).removeHandler?.(event, update));
    }

    bar.append(playBtn, prevBtn, nextBtn, label);
    return bar;
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

  /** Visible pages with their schema indices, so `_currentPage` keeps one meaning. */
  private visiblePages(): Array<{ page: QuestionnairePage; index: number }> {
    return this._schema.pages
      .map((page, index) => ({ page, index }))
      .filter(({ page }) => conditionMatches(page.visibleWhen, this._answers));
  }

  private renderPreviewInto(target: HTMLElement, isMainRuntime = false): void {
    target.innerHTML = "";
    this._errorNodes.clear();
    this._disposeTourControls();
    const pages = this.visiblePages();
    // The toolbar already renders the (custom) schema title + description as the
    // single panel header, so the main runtime skips them to avoid a duplicate.
    if (!isMainRuntime) {
      target.append(el("div", "text-lg font-semibold", this._schema.title || $.t("questionaire:tab.title")));
      if (this._schema.description) target.append(el("div", "mb-3 text-sm text-base-content/70", this._schema.description));
    }
    if (!pages.length) {
      target.append(el("div", "text-sm text-base-content/70", $.t("questionaire:runtime.noVisiblePages")));
      return;
    }
    let pos = pages.findIndex((entry) => entry.index === this._currentPage);
    if (pos < 0) { pos = 0; this._currentPage = pages[0]!.index; }
    const page = pages[pos]!.page;
    this._lastVisibilityFp = this.visibilityFingerprint();

    target.append(tabStrip(pages.map((entry, index) => ({
      label: entry.page.title || $.t("questionaire:runtime.pageN", { n: index + 1 }),
      active: index === pos,
      onClick: () => this.goToPage(index),
    })), "mb-3"));

    if (this._pendingScenePageId === page.id) {
      // Non-blocking scene prompt: the saved viewer setup differs from what is
      // open — the form below stays fully usable, the respondent decides when
      // (whether) to reload the viewers.
      const banner = el("div", "alert alert-warning text-sm flex-wrap items-center gap-2");
      const text = el("div", "min-w-0 flex-1 space-y-0.5");
      text.append(el("div", "font-medium", $.t("questionaire:runtime.scenePromptTitle")));
      text.append(el("div", "text-xs opacity-80", describePageScene(page.scene)));
      banner.append(text);
      const bannerActions = el("div", "flex items-center gap-2 flex-wrap");
      bannerActions.append(button($.t("questionaire:runtime.scenePromptApply"), "btn btn-primary btn-sm", () => {
        void this.confirmPendingScene(page, pos).catch((e) => console.warn("[questionaire] scene apply failed:", e));
      }));
      const always = document.createElement("label");
      always.className = "label cursor-pointer gap-2 p-0";
      const alwaysToggle = document.createElement("input");
      alwaysToggle.type = "checkbox";
      alwaysToggle.className = "checkbox checkbox-xs";
      alwaysToggle.addEventListener("change", () => {
        if (!alwaysToggle.checked) return;
        this.cache.set("prefs.autoApplyScenes", true);
        void this.confirmPendingScene(page, pos).catch((e) => console.warn("[questionaire] scene apply failed:", e));
      });
      always.append(alwaysToggle, el("span", "label-text text-xs", $.t("questionaire:runtime.scenePromptAlways")));
      bannerActions.append(always);
      banner.append(bannerActions);
      target.append(banner);
    } else {
      const notes: string[] = [];
      if (page.scene) notes.push($.t("questionaire:runtime.sceneWillRestore"));
      if (page.recordings?.length) notes.push($.t("questionaire:runtime.recordingsWillLoad", { count: page.recordings.length }));
      if (notes.length) target.append(el("div", "alert alert-info text-sm", undefined, [el("span", "", notes.join(" "))]));
      // Only once the page's recordings are actually loaded — while a scene
      // prompt is pending nothing is in the recorder yet, so there is nothing
      // to drive.
      const tour = this.renderPageTourControls(page);
      if (tour) target.append(tour);
    }

    target.append(el("div", "text-base font-semibold", page.title));
    if (page.description) target.append(el("div", "mb-4 text-sm text-base-content/70", page.description));

    // Validation is computed ONCE per render, and only surfaces after a failed
    // Next/Submit on this page (no red "required" wall before any interaction).
    const errors = this._showErrors.has(page.id) ? validatePage(page, this._answers) : {};
    const grid = el("div", "grid grid-cols-1 gap-4 md:grid-cols-2");
    page.elements.filter((e) => conditionMatches(e.visibleWhen, this._answers)).forEach((element) => grid.append(this.renderElement(element, page, errors)));
    target.append(grid);

    const actions = el("div", "mt-4 flex flex-wrap items-center justify-between gap-2");
    const prev = button($.t("questionaire:runtime.previous"), "btn btn-outline btn-sm", () => this.goToPage(pos - 1));
    prev.disabled = pos <= 0;
    const next = button(pos < pages.length - 1 ? $.t("questionaire:runtime.next") : $.t("questionaire:runtime.submit"), "btn btn-primary btn-sm", () => {
      this.flushDraftSave();
      const pageErrors = validatePage(page, this._answers);
      if (Object.keys(pageErrors).length) {
        this._showErrors.add(page.id);
        this.raiseTypedEvent("questionnaire-validation-failed", { pageIndex: pos, errors: pageErrors });
        this.renderPreviewInto(target, isMainRuntime);
        return;
      }
      this._showErrors.delete(page.id);
      if (pos < pages.length - 1) this.goToPage(pos + 1);
      else this.raiseTypedEvent("questionnaire-submit", { answers: clone(this._answers), schema: clone(this._schema) });
    });
    actions.append(prev, next);
    target.append(actions);
  }

  private renderElement(element: QuestionnaireElement, page: QuestionnairePage, errors: Record<string, string>, parentAnswers?: QuestionnaireAnswers, parentKey = ""): HTMLElement {
    const widthClass = element.width === "1/2" ? "md:col-span-1" : "md:col-span-2";
    const wrap = el("div", `form-control ${widthClass}`);
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

    /** Live answer read — closures must not capture render-time snapshots (no re-render per change). */
    const liveValue = () => (parentAnswers ? answerFor(element, parentAnswers) : answerFor(element, this._answers));
    /**
     * Commit a value. `structural: true` forces a repaint (the control's DOM
     * shape depends on the answer — repeat rows, file chips, ROI status);
     * plain inputs skip it so the focused control survives (see refreshRuntime).
     */
    const setValue = (value: QuestionnaireValue, structural = false) => {
      if (parentAnswers) {
        parentAnswers[element.name] = value;
        this.onNestedAnswerChanged(parentKey || element.name, structural);
      } else {
        this.setAnswer(element.name, value, element.name, structural);
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
        node.append(new Option($.t("questionaire:runtime.selectPlaceholder"), ""));
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
            // Read the LIVE answer — without a re-render per change, a closure
            // over the render-time selection would drop previous toggles.
            const live = liveValue();
            const set = new Set(Array.isArray(live) ? live.map(String) : []);
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
      case "file":
        input = this.renderFileElement(element as QuestionnaireFileElement, readOnly, liveValue, setValue);
        break;
      case "repeat":
        input = this.renderRepeatElement(element as QuestionnaireRepeatElement, page, errors, parentAnswers, parentKey);
        break;
      case "matrix":
        input = this.renderMatrixElement(element as QuestionnaireMatrixElement, parentAnswers, parentKey);
        break;
      case "roi": {
        const box = el("div", "space-y-2 rounded-box border border-base-300 p-2");
        const region = (currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)) ? currentValue as CapturedRegion : undefined;
        if (!isAnnotationsAvailable()) {
          box.append(el("div", "text-sm text-warning", $.t("questionaire:roi.moduleMissingRuntime")));
          input = box;
          break;
        }
        box.append(el("div", "text-xs text-base-content/60", $.t("questionaire:roi.drawHint")));
        const actions = el("div", "flex flex-wrap gap-2");
        if (!readOnly) actions.append(button($.t("questionaire:roi.captureSelected"), "btn btn-primary btn-sm", () => {
          const captured = captureSelectedRegion(Array.from(this._viewerMap.values()));
          if (!captured) { this.showInfo($.t("questionaire:roi.selectFirst")); return; }
          setValue(captured as unknown as QuestionnaireValue, true);
        }));
        actions.append(button($.t("questionaire:roi.showRegion"), "btn btn-outline btn-sm", () => {
          if (!region) { this.showInfo($.t("questionaire:roi.noRegion")); return; }
          showRegion(Array.from(this._viewerMap.values()), region);
        }));
        if (region && !readOnly) actions.append(button($.t("questionaire:roi.clearRegion"), "btn btn-ghost btn-sm", () => setValue(null, true)));
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
    // Always mount an (initially hidden) error node so validation can update
    // in place while the user types, without rebuilding the input.
    const errorNode = el("div", `mt-1 text-sm text-error${errors[key] ? "" : " hidden"}`, errors[key] || "");
    this._errorNodes.set(key, errorNode);
    wrap.append(errorNode);
    return wrap;
  }

  /**
   * File answers embed the content: `{ name, size, type, dataUrl }` (array when
   * `multiple`). The native input is only the transient picker; the stored
   * answer renders as removable chips, so state survives re-renders and the
   * draft/CRUD/bundle pipeline carries the actual file payload.
   */
  private renderFileElement(
    element: QuestionnaireFileElement,
    readOnly: boolean,
    liveValue: () => QuestionnaireValue,
    setValue: (value: QuestionnaireValue, structural?: boolean) => void,
  ): HTMLElement {
    const box = el("div", "space-y-2");
    // Coerce one stored entry to the current object shape. Answers used to be
    // plain filename strings; a draft/bundle saved before the object migration
    // still holds those, so map a bare string to a minimal file value (payload
    // was never stored in that format) instead of dropping it — otherwise the
    // chip vanishes and a required file field wrongly blocks submit on reopen.
    const toFileValue = (entry: any): QuestionnaireFileValue | null => {
      if (typeof entry === "string" && entry) return { name: entry, size: 0, type: "" };
      if (entry && typeof entry === "object" && typeof entry.name === "string") return entry as QuestionnaireFileValue;
      return null;
    };
    const normalize = (value: QuestionnaireValue): QuestionnaireFileValue[] => {
      if (Array.isArray(value)) return (value as any[]).map(toFileValue).filter(Boolean) as QuestionnaireFileValue[];
      const single = toFileValue(value);
      return single ? [single] : [];
    };

    if (!readOnly) {
      const node = document.createElement("input");
      node.type = "file";
      node.className = "file-input file-input-bordered w-full";
      node.accept = element.accept || "";
      node.multiple = !!element.multiple;
      node.addEventListener("change", async () => {
        const picked = Array.from(node.files || []);
        node.value = "";
        if (!picked.length) return;
        const maxBytes = Number(this.getStaticMeta("maxFileBytes", 2_000_000));
        const accepted: QuestionnaireFileValue[] = [];
        for (const file of picked) {
          if (file.size > maxBytes) {
            // showInfo renders into the HTML toast sink — keep i18next's escaping here.
            this.showInfo($.t("questionaire:file.tooLarge", { name: file.name, max: formatBytes(maxBytes) }));
            continue;
          }
          try {
            accepted.push({ name: file.name, size: file.size, type: file.type, dataUrl: await readFileAsDataURL(file) });
          } catch (e) {
            console.warn("[questionaire] failed to read file:", e);
            this.showInfo($.t("questionaire:file.readFailed", { name: file.name }));
          }
        }
        if (!accepted.length) return;
        const next = element.multiple ? [...normalize(liveValue()), ...accepted] : [accepted[0]!];
        setValue((element.multiple ? next : next[0]) as unknown as QuestionnaireValue, true);
      });
      box.append(node);
    }

    const stored = normalize(liveValue());
    if (stored.length) {
      const chips = el("div", "flex flex-wrap gap-2");
      stored.forEach((file, index) => {
        const chip = el("span", "badge badge-outline gap-1 py-3");
        const name = el("span", "max-w-48 truncate", file.name);
        name.title = file.name;
        chip.append(name, el("span", "text-xs text-base-content/50", formatBytes(file.size)));
        if (!readOnly) {
          const rm = button("✕", "btn btn-ghost btn-xs px-1", () => {
            const live = normalize(liveValue());
            live.splice(index, 1);
            setValue((element.multiple ? live : (live[0] ?? null)) as unknown as QuestionnaireValue, true);
          });
          rm.title = $.t("questionaire:file.remove");
          chip.append(rm);
        }
        chips.append(chip);
      });
      box.append(chips);
    } else if (readOnly) {
      box.append(el("div", "text-sm text-base-content/60", $.t("questionaire:file.none")));
    }
    return box;
  }

  private renderRepeatElement(element: QuestionnaireRepeatElement, page: QuestionnairePage, errors: Record<string, string>, parentAnswers?: QuestionnaireAnswers, parentKey = ""): HTMLElement {
    const values = (parentAnswers ? parentAnswers[element.name] : this._answers[element.name]) as QuestionnaireAnswers[] | undefined;
    const rows = Array.isArray(values) ? values : [];
    const readOnly = !!element.readOnly || this._isExported;
    const setRows = (nextRows: QuestionnaireAnswers[]) => {
      if (parentAnswers) {
        parentAnswers[element.name] = nextRows;
        this.onNestedAnswerChanged(parentKey || element.name, true);
      } else {
        this.setAnswer(element.name, nextRows, element.name, true);
      }
    };
    // The repeat's own full key, built the SAME way renderElement/validateElement
    // do (`parentKey.name`, dot-separated). Nested-row child keys derive from
    // this — using `parentKey + name` (no separator) produced `outer[0]inner[0]`
    // for nested repeats while validation emits `outer[0].inner[0]`, so the keys
    // never matched and nested-row validation errors could not be shown/cleared.
    const selfKey = parentKey ? `${parentKey}.${element.name}` : element.name;
    const wrap = el("div", "space-y-3");
    rows.forEach((rowAnswers, rowIndex) => {
      const row = el("div", "rounded-box border border-base-300 p-3");
      const header = el("div", "mb-2 flex items-center justify-between gap-2");
      header.append(el("div", "font-medium", `${element.label || element.name} #${rowIndex + 1}`));
      if (!readOnly) header.append(button($.t("questionaire:runtime.removeItem"), "btn btn-outline btn-xs", () => { rows.splice(rowIndex, 1); setRows(rows); }));
      row.append(header);
      const grid = el("div", "grid grid-cols-1 gap-4 md:grid-cols-2");
      element.elements.filter((child) => conditionMatches(child.visibleWhen, rowAnswers)).forEach((child) => {
        grid.append(this.renderElement(child, page, errors, rowAnswers, `${selfKey}[${rowIndex}]`));
      });
      row.append(grid);
      wrap.append(row);
    });
    if (!readOnly && rows.length < (element.maxItems ?? 10)) {
      wrap.append(button(element.addLabel || $.t("questionaire:runtime.addItem"), "btn btn-outline btn-sm", () => {
        rows.push({});
        setRows(rows);
      }));
    }
    return wrap;
  }

  private renderMatrixElement(element: QuestionnaireMatrixElement, parentAnswers?: QuestionnaireAnswers, parentKey = ""): HTMLElement {
    const readOnly = !!element.readOnly || this._isExported;
    const liveRecord = () => ((parentAnswers ? parentAnswers[element.name] : this._answers[element.name]) || {}) as Record<string, string>;
    const current = liveRecord();
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
        input.name = `matrix_${element.id}_${parentKey}_${rowDef.value}`;
        input.checked = current[rowDef.value] === colDef.value;
        input.disabled = readOnly;
        input.addEventListener("change", () => {
          // Live read — a closure over the render-time record would lose the
          // other rows' picks now that changes don't force a re-render.
          const next = { ...liveRecord(), [rowDef.value]: colDef.value };
          if (parentAnswers) {
            parentAnswers[element.name] = next;
            this.onNestedAnswerChanged(parentKey || element.name, false);
          } else {
            this.setAnswer(element.name, next, element.name, false);
          }
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

  /**
   * Runtime page switch. Renders the form FIRST, then restores the page's
   * saved viewer setup / animation asynchronously — viewer reopening must not
   * block (or flicker) the form. `visibleIndex` addresses the *visible* pages.
   */
  private goToPage(visibleIndex: number): void {
    const pages = this.visiblePages();
    if (!pages.length) return;
    this.flushDraftSave();
    const pos = Math.max(0, Math.min(visibleIndex, pages.length - 1));
    const entry = pages[pos]!;
    this._currentPage = entry.index;
    // A prompt pending on the previous page is void once the user navigates on.
    this._pendingScenePageId = null;
    this.raiseTypedEvent("questionnaire-page-change", { pageIndex: pos, page: clone(entry.page), viewerIds: Array.from(this._viewerMap.keys()) });
    this.renderRuntime();
    void this.applyPageVisit(pos, entry.page, "runtime").catch((e) => console.warn("[questionaire] page visit apply failed:", e));
  }

  /** UX-only respondent preference — never a security gate. Cache drivers may
   * round-trip booleans as strings, so compare both forms. */
  private prefAutoApplyScenes(): boolean {
    const value = this.cache.get("prefs.autoApplyScenes", false);
    return value === true || value === "true";
  }

  private prefAutoplayRecordings(): boolean {
    const value = this.cache.get("prefs.autoplayRecordings", true);
    return !(value === false || value === "false");
  }

  /**
   * Deployment default for pages that don't pick their own apply mode. Read
   * from static meta (include.json / ENV `plugins.questionaire.sceneApplyMode`)
   * — deliberately NOT `getOption`, which is session/URL-forgeable.
   */
  private deploymentDefaultSceneApplyMode(): QuestionnaireSceneApplyMode {
    return this.getStaticMeta("sceneApplyMode", "prompt") === "auto" ? "auto" : "prompt";
  }

  /** Apply mode a page resolves to (pref → page → deployment default). */
  private effectiveSceneApplyMode(page: QuestionnairePage): QuestionnaireSceneApplyMode {
    if (this.prefAutoApplyScenes()) return "auto";
    return page.sceneApplyMode ?? this.deploymentDefaultSceneApplyMode();
  }

  /**
   * Page-visit contract: scene decision → scene applied → recordings loaded →
   * autoplay. When the saved setup differs from the open content, the scene is
   * NOT force-applied by default — a non-blocking banner asks the respondent
   * first (per-page/deployment "auto" or the respondent pref skip the ask).
   * The viewport-only restore for already-matching content stays automatic:
   * it is cheap and reloads nothing.
   */
  private async applyPageVisit(pageIndex: number, page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode): Promise<void> {
    if (!page.scene) {
      await this.loadPageRecordings(page, mode, pageIndex);
      return;
    }
    if (currentSceneMatches(page.scene)) {
      applySceneViewports(page.scene);
      this.raiseTypedEvent("questionnaire-page-scene-applied", { pageId: page.id, scene: clone(page.scene), mode, pageIndex });
      await this.loadPageRecordings(page, mode, pageIndex);
      return;
    }
    if (mode === "manual" || this.effectiveSceneApplyMode(page) === "auto") {
      if (await this.applyStoredPageScene(page, mode, pageIndex)) {
        await this.loadPageRecordings(page, mode, pageIndex);
      }
      return;
    }
    this._pendingScenePageId = page.id;
    this.raiseTypedEvent("questionnaire-page-scene-prompt", { pageId: page.id, pageIndex });
    this.renderRuntime();
  }

  /** Respondent confirmed the banner: full restore, then the page's recordings. */
  private async confirmPendingScene(page: QuestionnairePage, pageIndex = this._currentPage): Promise<void> {
    this._pendingScenePageId = null;
    if (await this.applyStoredPageScene(page, "runtime", pageIndex)) {
      await this.loadPageRecordings(page, "runtime", pageIndex);
    }
    this.renderRuntime();
  }

  /**
   * Restore the page's captured viewer setup (full canonical restore — the
   * fast path lives in applyPageVisit). Pages WITHOUT a captured scene leave
   * the viewer untouched — whatever the user has open stays open. (The legacy
   * `xBgSpec` fallback force-applied a background index on every page switch,
   * collapsing multi-slide grids; it is intentionally gone.)
   */
  private async applyStoredPageScene(page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode, pageIndex = this._currentPage): Promise<boolean> {
    if (!page.scene) return false;
    try {
      if (currentSceneMatches(page.scene)) applySceneViewports(page.scene);
      else await applyPageSceneFull(page.scene);
      this.raiseTypedEvent("questionnaire-page-scene-applied", { pageId: page.id, scene: clone(page.scene), mode, pageIndex });
      return true;
    } catch (error) {
      this.raiseTypedEvent("questionnaire-background-apply-failed", { pageIndex, page: clone(page), bgSpec: page.scene.activeBackgroundIndex as any ?? null, viewerIds: Array.from(this._viewerMap.keys()), error });
      this.showInfo($.t("questionaire:viewerSetup.applyFailed"));
      return false;
    }
  }

  /**
   * Push the page's bound recordings into the recorder as transient
   * per-viewer recordings and autoplay where asked. Runs strictly AFTER the
   * scene applied (bindings resolve against post-restore viewers); while a
   * scene prompt is pending this is a no-op — confirming the banner loads
   * them. Playback goes per viewer (`play(viewerId)`), never the no-arg
   * fan-out, so the respondent's own recordings on unbound viewers stay idle.
   */
  private async loadPageRecordings(page: QuestionnairePage, mode: QuestionnaireAnimationApplyMode, pageIndex = this._currentPage): Promise<void> {
    if (!page.recordings?.length || this._pendingScenePageId === page.id) return;
    const recorder = getRecorderModule();
    if (!recorder) return;
    if (recorder.isPlaying()) recorder.stop();
    const loaded: QuestionnairePageRecordingBinding[] = [];
    for (const binding of page.recordings) {
      const viewerId = loadBindingIntoRecorder(recorder, binding, page.id);
      if (!viewerId) {
        console.warn(`[questionaire] page "${page.id}": no live viewer for recording binding "${binding.recordingName}" (slot ${binding.slotIndex})`);
        continue;
      }
      loaded.push(binding);
      if (binding.autoplay && mode !== "manual" && this.prefAutoplayRecordings()) {
        recorder.play(viewerId);
      }
    }
    if (loaded.length) {
      this.raiseTypedEvent("questionnaire-page-recordings-applied", { pageId: page.id, bindings: clone(loaded), mode, pageIndex });
      // The form renders before this async load finishes, so the tour controls
      // rendered then had no recorder state to bind to — repaint now that they do.
      this.renderRuntime();
    }
  }

  /* ── answer updates: no full re-render per keystroke ─────────────────────── */

  private setAnswer(key: string, value: QuestionnaireValue, changedKey?: string, structural = false): void {
    this._answers[key] = value;
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey });
    // Dispatch the per-field change to the CRUD resource. Inert when
    // `crud:answer` is unbound; when bound, admins get coalesced upstream
    // sync with offline outbox replay (configured in `_initIOPipeline`).
    const dispatchKey = changedKey || key;
    if (dispatchKey) this.answerResource?.update(dispatchKey, { fieldKey: dispatchKey, value: clone(value) });
    this.scheduleDraftSave();
    this.refreshRuntime(structural);
  }

  /**
   * A field nested in a repeat row changed (the row object inside `_answers`
   * was mutated in place). Dispatch the repeat ROOT key so drafts/CRUD carry
   * the whole rows array.
   */
  private onNestedAnswerChanged(parentKey: string, structural = false): void {
    const rootKey = (parentKey.match(/^[^.[]+/) || [])[0] || "";
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey: rootKey || undefined });
    if (rootKey) this.answerResource?.update(rootKey, { fieldKey: rootKey, value: clone(this._answers[rootKey]) });
    this.scheduleDraftSave();
    this.refreshRuntime(structural);
  }

  /**
   * Post-answer repaint policy — THE focus fix. A full re-render per keystroke
   * used to rebuild every input and drop focus; now we only repaint when the
   * DOM must actually change:
   *  - `structural` — the control's own DOM depends on the answer (repeat rows,
   *    file chips, ROI status),
   *  - the conditional-visibility fingerprint changed (a `visibleWhen`
   *    somewhere flipped).
   * Otherwise only the current page's error texts update, in place.
   */
  private refreshRuntime(structural: boolean): void {
    if (this._designerActive) return;
    if (structural || this.visibilityFingerprint() !== this._lastVisibilityFp) {
      this.renderRuntime();
      return;
    }
    this.updateVisibleErrors();
  }

  /** Ids of everything currently visible under `visibleWhen` conditions. */
  private visibilityFingerprint(): string {
    const parts: string[] = [];
    const current = this._schema.pages[this._currentPage];
    for (const { page } of this.visiblePages()) {
      parts.push(page.id);
      if (page !== current) continue;
      for (const element of page.elements) {
        if (!conditionMatches(element.visibleWhen, this._answers)) continue;
        parts.push(element.id);
        if (element.kind === "repeat") {
          const rows = this._answers[element.name];
          if (!Array.isArray(rows)) continue;
          (rows as QuestionnaireAnswers[]).forEach((row, rowIndex) => {
            if (!row || typeof row !== "object") return;
            for (const child of (element as QuestionnaireRepeatElement).elements) {
              if (conditionMatches(child.visibleWhen, row)) parts.push(`${element.id}[${rowIndex}].${child.id}`);
            }
          });
        }
      }
    }
    return parts.join("|");
  }

  /** In-place refresh of the current page's error messages (no DOM rebuild). */
  private updateVisibleErrors(): void {
    const page = this._schema.pages[this._currentPage];
    if (!page || !this._showErrors.has(page.id)) return;
    const errors = validatePage(page, this._answers);
    for (const [key, node] of this._errorNodes) {
      const message = errors[key];
      node.textContent = message || "";
      node.classList.toggle("hidden", !message);
    }
    if (!Object.keys(errors).length) this._showErrors.delete(page.id);
  }

  /* ── persistence ──────────────────────────────────────────────────────────── */

  /** Coalesce keystrokes into one draft write (~300 ms after the last change). */
  private scheduleDraftSave(): void {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => { this._draftTimer = null; this.saveDraft(); }, 300);
  }

  private flushDraftSave(): void {
    if (this._draftTimer) {
      clearTimeout(this._draftTimer);
      this._draftTimer = null;
      this.saveDraft();
    }
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
   * Live inline-text edit from the designer or the toolbar header: the focused
   * input IS the live view, so NO re-render happens (rebuilding would kill the
   * focus — the original bug); just raise the change event and debounce the
   * undo snapshot so a burst of keystrokes collapses into one history entry.
   */
  private commitInline(reason: string): void {
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => { this._persistTimer = null; this.pushSchemaHistory(reason); }, 500);
  }

  private flushPendingPersist(): void {
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
  }

  private movePage(oldIndex: number, newIndex: number): void {
    if (newIndex < 0 || newIndex >= this._schema.pages.length || oldIndex === newIndex) return;
    const [page] = this._schema.pages.splice(oldIndex, 1);
    if (!page) return;
    this._schema.pages.splice(newIndex, 0, page);
    if (this._currentPage === oldIndex) this._currentPage = newIndex;
    this.raiseTypedEvent("questionnaire-page-moved", { pageId: page.id, oldIndex, newIndex });
    this.persistSchema("page-move");
  }

  private _removePageAt(index: number): void {
    if (this._schema.pages.length <= 1) return;
    const [page] = this._schema.pages.splice(index, 1);
    if (!page) return;
    this.raiseTypedEvent("questionnaire-page-removed", { pageId: page.id, index });
    this._currentPage = Math.max(0, Math.min(this._currentPage, this._schema.pages.length - 1));
    this.persistSchema("page-remove");
  }

  private moveElement(pageId: string, oldIndex: number, newIndex: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    if (newIndex < 0 || newIndex >= page.elements.length || oldIndex === newIndex) return;
    const [element] = page.elements.splice(oldIndex, 1);
    if (!element) return;
    page.elements.splice(newIndex, 0, element);
    this.raiseTypedEvent("questionnaire-element-moved", { pageId, elementId: element.id, oldIndex, newIndex });
    this.persistSchema("element-move");
  }

  private _removeElementAt(pageId: string, index: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    const [element] = page.elements.splice(index, 1);
    if (!element) return;
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
