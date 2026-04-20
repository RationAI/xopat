import { button, card, cardBody, el, numberInput, textAreaInput, textInput, toggleInput } from "./dom";
import { defaultSchema, makeElement, makePage, normalizeSchema } from "./schema";
import type {
  PluginEventMap,
  QuestionnaireAnswers,
  QuestionnaireAnimationApplyMode,
  QuestionnaireCondition,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireFileElement,
  QuestionnaireMatrixElement,
  QuestionnairePage,
  QuestionnaireRepeatElement,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
  QuestionnaireSelection,
  QuestionnaireSimpleCondition,
  QuestionnaireValue,
  ViewerLikeRecord,
} from "./types";
import {
  answerFor,
  clone,
  conditionMatches,
  optionLinesToList,
  optionListToLines,
  sanitizeName,
  titleCase,
  toBgLabel,
} from "./utils";
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
  private _selected: QuestionnaireSelection = { kind: "form" };
  private _designerActive = false;
  private _isExported = false;
  private _enableEditor = true;
  private _autoOpenBackground = true;
  private _viewerMap = new Map<string, ViewerLikeRecord>();
  private _toolbarEl: HTMLElement | null = null;
  private _designerEl: HTMLElement | null = null;
  private _runtimeEl: HTMLElement | null = null;
  private _previewEl: HTMLElement | null = null;

  constructor(id: string) {
    super(id);
    this._enableEditor = this.getOption("enableEditor", true);
    this._autoOpenBackground = this.getOption("autoOpenBackground", true);
    this._isExported = this.getOption("isExported", false);
    void this.initPostIO({ exportKey: "scheme", inViewerContext: false });
  }

  async exportData(key: string): Promise<any> {
    if (key !== "scheme") return undefined;
    return JSON.stringify(this._schema);
  }

  async importData(key: string, data: any): Promise<void> {
    if (key !== "scheme" || !data) return;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    this._schema = normalizeSchema(parsed);
    this.raiseTypedEvent("questionnaire-schema-imported", { schema: clone(this._schema) });
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason: "import" });
    this.renderAll();
  }

  pluginReady(): void {
    this.ensureTab();
    this.hookViewerLifecycle();
    this._schema = normalizeSchema(this._schema);
    this._answers = this.loadDraft() || {};
    this.renderAll();
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
    const left = el("div", "space-y-1");
    left.append(el("h2", "text-xl font-semibold", this._schema.title || "Questionnaire"));
    left.append(el("div", "text-sm text-base-content/70", this._schema.description || "Custom questionnaire runtime and designer"));
    const right = el("div", "flex flex-wrap items-center gap-2");
    if (this._enableEditor && !this._isExported) {
      right.append(button(this._designerActive ? "Hide designer" : "Show designer", "btn btn-outline btn-sm", () => {
        this._designerActive = !this._designerActive;
        this.raiseTypedEvent("questionnaire-designer-toggle", { active: this._designerActive });
        this.renderAll();
      }));
    }
    right.append(button("Clear draft", "btn btn-outline btn-sm", () => {
      this._answers = {};
      this.saveDraft();
      this.renderRuntime();
      if (this._previewEl) this.renderPreviewInto(this._previewEl);
    }));
    if (this._isExported) right.append(el("span", "badge badge-warning", "Read-only"));
    wrap.append(left, right);
    this._toolbarEl.append(wrap);
  }

  private renderDesigner(): void {
    if (!this._designerEl) return;
    this._designerEl.innerHTML = "";
    this._designerEl.classList.toggle("hidden", !this._designerActive);
    this._previewEl = null;
    if (!this._designerActive) return;

    const shell = el("div", "questionnaire-designer-shell grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]");
    const sidebar = el("div", "questionnaire-designer-sidebar space-y-3");
    sidebar.append(this.renderPagesPanel(), this.renderInspector());
    shell.append(this.renderDesignerCanvas(), sidebar);
    this._designerEl.append(shell);
  }

  private renderPagesPanel(): HTMLElement {
    const panel = card("Pages");
    const body = cardBody(panel);
    body.append(button("Add page", "btn btn-primary btn-sm mb-3", () => {
      const page = makePage(this._schema.pages.length);
      this._schema.pages.push(page);
      this._selected = { kind: "page", pageId: page.id };
      this._currentPage = this._schema.pages.length - 1;
      this.raiseTypedEvent("questionnaire-page-added", { page: clone(page), index: this._schema.pages.length - 1 });
      this.raiseSelectionChange();
      this.persistSchema("page-add");
    }));
    const list = el("div", "space-y-2");
    this._schema.pages.forEach((page, index) => {
      const active = this._selected.kind !== "form" && this._selected.pageId === page.id;
      const row = el("div", "rounded-box border border-base-300 bg-base-100 p-2" + (active ? " ring-2 ring-primary/40" : ""));
      row.append(button(page.title || `Page ${index + 1}`, "btn btn-ghost btn-sm justify-start", () => {
        this._selected = { kind: "page", pageId: page.id };
        this._currentPage = index;
        this.raiseSelectionChange();
        void this.applyPageVisit(index, page, "designer");
        this.renderDesigner();
      }));
      row.append(el("div", "mt-1 text-xs text-base-content/60", `${page.elements.length} fields • background ${toBgLabel(page.xBgSpec)}${page.scene ? " • saved setup" : ""}${page.pageAnimation?.steps?.length ? " • animation" : ""}`));
      const actions = el("div", "mt-2 flex flex-wrap gap-2");
      actions.append(
        button("↑", "btn btn-outline btn-xs", () => this.movePage(index, index - 1)),
        button("↓", "btn btn-outline btn-xs", () => this.movePage(index, index + 1)),
        button("Delete", "btn btn-outline btn-xs", () => this.removePage(index)),
      );
      row.append(actions);
      list.append(row);
    });
    body.append(list);
    return panel;
  }

  private renderDesignerCanvas(): HTMLElement {
    const panel = card("Designer");
    const body = cardBody(panel);
    if (this._selected.kind === "form") {
      body.append(el("div", "text-sm text-base-content/70", "Select a page or field to edit it."));
      return panel;
    }
    const page = this.pageBySelection();
    if (!page) {
      body.append(el("div", "text-sm text-error", "Selected page no longer exists."));
      return panel;
    }
    body.append(el("div", "text-lg font-semibold", page.title));
    if (page.description) body.append(el("div", "mb-3 text-sm text-base-content/70", page.description));
    const palette = el("div", "mb-3 flex flex-wrap gap-2");
    [
      ["text", "Text"], ["textarea", "Textarea"], ["number", "Number"], ["email", "Email"],
      ["date", "Date"], ["tel", "Tel"], ["url", "URL"], ["select", "Select"], ["multiselect", "Multiselect"],
      ["checkbox", "Checkbox"], ["radio", "Radio"], ["toggle", "Toggle"], ["rating", "Rating"],
      ["file", "File"], ["repeat", "Repeat group"], ["matrix", "Matrix"], ["content", "Content"],
    ].forEach(([kind, label]) => {
      palette.append(button(label, "btn btn-outline btn-sm", () => {
        const element = makeElement(kind as QuestionnaireElement["kind"]);
        page.elements.push(element);
        this._selected = { kind: "element", pageId: page.id, elementId: element.id };
        this.raiseTypedEvent("questionnaire-element-added", { pageId: page.id, element: clone(element), index: page.elements.length - 1 });
        this.raiseSelectionChange();
        this.persistSchema("element-add");
      }));
    });
    body.append(palette);

    const fields = el("div", "space-y-2");
    page.elements.forEach((element, index) => {
      const active = this._selected.kind === "element" && this._selected.pageId === page.id && this._selected.elementId === element.id;
      const row = el("div", "rounded-box border border-base-300 bg-base-100 p-3" + (active ? " ring-2 ring-primary/40" : ""));
      row.append(button(`${element.label || element.name || element.kind}`, "btn btn-ghost btn-sm justify-start", () => {
        this._selected = { kind: "element", pageId: page.id, elementId: element.id };
        this.raiseSelectionChange();
        this.renderDesigner();
      }));
      row.append(el("div", "mt-1 text-xs text-base-content/60", `${element.kind} • ${element.name}`));
      const actions = el("div", "mt-2 flex flex-wrap gap-2");
      actions.append(
        button("↑", "btn btn-outline btn-xs", () => this.moveElement(page.id, index, index - 1)),
        button("↓", "btn btn-outline btn-xs", () => this.moveElement(page.id, index, index + 1)),
        button("Delete", "btn btn-outline btn-xs", () => this.removeElement(page.id, index)),
      );
      row.append(actions);
      fields.append(row);
    });
    body.append(fields);
    return panel;
  }

  private renderInspector(): HTMLElement {
    const panel = card("Inspector");
    const body = cardBody(panel);
    if (this._selected.kind === "form") {
      body.append(
        textInput("Title", this._schema.title || "", (v) => { this._schema.title = v; this.persistSchema("form-title"); }),
        textAreaInput("Description", this._schema.description || "", (v) => { this._schema.description = v; this.persistSchema("form-description"); }),
      );
      return panel;
    }
    const page = this.pageBySelection();
    if (!page) {
      body.append(el("div", "text-sm text-error", "Selection is invalid."));
      return panel;
    }
    if (this._selected.kind === "page") {
      body.append(
        textInput("Page title", page.title || "", (v) => { page.title = v; this.persistSchema("page-title"); }),
        textAreaInput("Page description", page.description || "", (v) => { page.description = v; this.persistSchema("page-description"); }),
        numberInput("Fallback background index", page.xBgSpec ?? 0, (v) => { page.xBgSpec = v; this.persistSchema("page-background"); }),
        this.renderViewerSetupEditor(page),
        this.renderPageAnimationEditor(page),
        this.renderConditionEditor("Page visibility", page.visibleWhen, (condition) => {
          page.visibleWhen = condition;
          this.persistSchema("page-visibility");
        }),
      );
      return panel;
    }
    const element = this.elementBySelection();
    if (!element) {
      body.append(el("div", "text-sm text-error", "Element no longer exists."));
      return panel;
    }
    body.append(
      textInput("Label", element.label || "", (v) => { element.label = v; this.persistSchema("element-label"); }),
      textInput("Name", element.name || "", (v) => { this.updateElementName(element, v); }),
      textAreaInput("Description", element.description || "", (v) => { element.description = v; this.persistSchema("element-description"); }),
      this.renderWidthEditor(element),
      this.renderValidationEditor(element),
      this.renderConditionEditor("Visibility rule", element.visibleWhen, (condition) => {
        element.visibleWhen = condition;
        this.persistSchema("element-visibleWhen");
      }),
    );
    if (element.kind !== "content") {
      body.append(
        textInput("Placeholder", element.placeholder || "", (v) => { element.placeholder = v; this.persistSchema("element-placeholder"); }),
        toggleInput("Read only", !!element.readOnly, (checked) => { element.readOnly = checked; this.persistSchema("element-readonly"); }),
      );
    }
    if (element.kind === "content") {
      body.append(textAreaInput("HTML", (element as QuestionnaireContentElement).html || "", (v) => {
        (element as QuestionnaireContentElement).html = v;
        this.persistSchema("element-html");
      }, 8));
    }
    if (element.kind === "select" || element.kind === "multiselect" || element.kind === "radio") {
      const selectElement = element as QuestionnaireSelectElement;
      body.append(textAreaInput("Options (value|label per line)", optionListToLines(selectElement.options), (text) => {
        selectElement.options = optionLinesToList(text);
        this.persistSchema("element-options");
      }, 6));
    }
    if (element.kind === "rating") {
      body.append(numberInput("Maximum rating", Number((element as any).maxRating || 5), (value) => {
        (element as any).maxRating = Math.max(1, value || 1);
        this.persistSchema("element-rating-max");
      }));
    }
    if (element.kind === "file") {
      const fileElement = element as QuestionnaireFileElement;
      body.append(
        textInput("Accepted types", fileElement.accept || "", (v) => { fileElement.accept = v; this.persistSchema("element-file-accept"); }),
        toggleInput("Allow multiple files", !!fileElement.multiple, (checked) => { fileElement.multiple = checked; this.persistSchema("element-file-multiple"); }),
      );
    }
    if (element.kind === "repeat") {
      const repeat = element as QuestionnaireRepeatElement;
      body.append(
        textInput("Add button label", repeat.addLabel || "Add item", (v) => { repeat.addLabel = v; this.persistSchema("element-repeat-addLabel"); }),
        numberInput("Minimum items", repeat.minItems ?? 0, (v) => { repeat.minItems = Math.max(0, v); this.persistSchema("element-repeat-min"); }),
        numberInput("Maximum items", repeat.maxItems ?? 10, (v) => { repeat.maxItems = Math.max(1, v || 1); this.persistSchema("element-repeat-max"); }),
        textAreaInput("Repeat child fields (kind:name:label per line)", repeat.elements.map((item) => `${item.kind}:${item.name}:${item.label || item.name}`).join("\n"), (text) => {
          const previousChildren = clone(repeat.elements);
          repeat.elements = text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
            const [kindRaw, nameRaw, labelRaw] = line.split(":");
            let child = makeElement((kindRaw || "text") as QuestionnaireElement["kind"]);
            if (child.kind === "repeat" || child.kind === "matrix") child = makeElement("text");
            child.name = sanitizeName(nameRaw || child.name);
            child.label = labelRaw || titleCase(child.name);
            return child;
          });
          this.migrateRepeatChildAnswers(repeat.name, previousChildren, repeat.elements);
          this.persistSchema("element-repeat-children");
        }, 5),
      );
    }
    if (element.kind === "matrix") {
      const matrix = element as QuestionnaireMatrixElement;
      body.append(
        textAreaInput("Rows (value|label per line)", optionListToLines(matrix.rows), (text) => {
          matrix.rows = optionLinesToList(text);
          this.persistSchema("element-matrix-rows");
        }, 4),
        textAreaInput("Columns (value|label per line)", optionListToLines(matrix.columns), (text) => {
          matrix.columns = optionLinesToList(text);
          this.persistSchema("element-matrix-columns");
        }, 4),
      );
    }
    return panel;
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

  private renderWidthEditor(element: QuestionnaireElement): HTMLElement {
    const wrap = el("div", "mb-3 form-control");
    wrap.append(el("label", "label", undefined, [el("span", "label-text", "Width")]));
    const select = document.createElement("select");
    select.className = "select select-bordered w-full";
    [["full", "Full width"], ["1/2", "Half width"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.selected = (element.width || "full") === value;
      select.append(opt);
    });
    select.addEventListener("change", () => {
      element.width = select.value as any;
      this.persistSchema("element-width");
    });
    wrap.append(select);
    return wrap;
  }

  private renderValidationEditor(element: QuestionnaireElement): HTMLElement {
    const validation = (element.validation ||= {});
    const panel = el("div", "rounded-box border border-base-300 p-3 mb-3");
    panel.append(el("div", "mb-2 text-sm font-medium", "Validation"));
    panel.append(
      toggleInput("Required", !!validation.required, (checked) => { validation.required = checked; this.persistSchema("element-validation-required"); }),
      numberInput("Min value / length", Number(validation.min ?? validation.minLength ?? 0), (value) => {
        if (["number", "rating"].includes(element.kind)) validation.min = value;
        else validation.minLength = value;
        this.persistSchema("element-validation-min");
      }),
      numberInput("Max value / length", Number(validation.max ?? validation.maxLength ?? 0), (value) => {
        if (["number", "rating"].includes(element.kind)) validation.max = value;
        else validation.maxLength = value;
        this.persistSchema("element-validation-max");
      }),
      textInput("Regex pattern", validation.pattern || "", (value) => { validation.pattern = value; this.persistSchema("element-validation-pattern"); }),
      textInput("Custom error message", validation.message || "", (value) => { validation.message = value; this.persistSchema("element-validation-message"); }),
      this.renderConditionEditor("Required when", validation.requiredWhen, (condition) => {
        validation.requiredWhen = condition;
        this.persistSchema("element-validation-requiredWhen");
      }),
    );
    return panel;
  }

  private renderConditionEditor(
    title: string,
    value: QuestionnaireCondition | undefined,
    onChange: (value: QuestionnaireCondition | undefined) => void,
  ): HTMLElement {
    const box = el("div", "rounded-box border border-base-300 p-3 mb-3");
    box.append(el("div", "mb-2 text-sm font-medium", title));

    const modeSelect = document.createElement("select");
    modeSelect.className = "select select-bordered w-full mb-2";

    const currentMode = !value
      ? "none"
      : value.op === "and" || value.op === "or"
        ? value.op
        : "simple";

    [["none", "No rule"], ["simple", "Single rule"], ["and", "All rules (AND)"], ["or", "Any rules (OR)"]].forEach(([v, label]) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label;
      opt.selected = currentMode === v;
      modeSelect.append(opt);
    });

    const body = el("div", "space-y-2");

    const render = () => {
      body.innerHTML = "";
      const mode = modeSelect.value;

      if (mode === "none") {
        return;
      }

      if (mode === "simple") {
        const normalized: QuestionnaireSimpleCondition =
          !value || value.op === "and" || value.op === "or"
            ? { op: "eq", field: "", value: "" }
            : clone(value) as QuestionnaireSimpleCondition;

        body.append(
          this.renderSimpleCondition(normalized, (updated) => {
            value = updated;
            onChange(updated);
          }),
        );
        return;
      }

      const args =
        value && (value.op === "and" || value.op === "or")
          ? clone(value.args)
          : [{ op: "eq", field: "", value: "" } as QuestionnaireSimpleCondition];

      const group: { op: "and" | "or"; args: QuestionnaireSimpleCondition[] } = {
        op: mode as "and" | "or",
        args: args.map((arg) =>
          (arg.op === "and" || arg.op === "or"
            ? { op: "eq", field: "", value: "" }
            : arg) as QuestionnaireSimpleCondition,
        ),
      };

      const list = el("div", "space-y-2");

      const rebuildList = () => {
        list.innerHTML = "";

        group.args.forEach((arg, index) => {
          const row = el("div", "rounded-box border border-base-300 p-2");
          row.append(
            this.renderSimpleCondition(arg, (updated) => {
              group.args[index] = updated;
              value = clone(group);
              onChange(clone(group));
            }),
          );
          row.append(
            button("Remove rule", "btn btn-outline btn-xs mt-2", () => {
              group.args.splice(index, 1);
              value = group.args.length ? clone(group) : undefined;
              onChange(value);
              rebuildList();
            }),
          );
          list.append(row);
        });
      };

      body.append(
        button("Add rule", "btn btn-outline btn-sm", () => {
          group.args.push({ op: "eq", field: "", value: "" });
          value = clone(group);
          onChange(clone(group));
          rebuildList();
        }),
      );
      body.append(list);
      rebuildList();
    };

    modeSelect.addEventListener("change", () => {
      const mode = modeSelect.value;

      if (mode === "none") {
        value = undefined;
        onChange(undefined);
      } else if (mode === "simple") {
        const next: QuestionnaireSimpleCondition = { op: "eq", field: "", value: "" };
        value = next;
        onChange(next);
      } else {
        const next = {
          op: mode as "and" | "or",
          args: [{ op: "eq", field: "", value: "" } as QuestionnaireSimpleCondition],
        };
        value = next;
        onChange(clone(next));
      }

      render();
    });

    box.append(modeSelect, body);
    render();
    return box;
  }

  private renderSimpleCondition(
    condition: QuestionnaireSimpleCondition,
    onChange: (condition: QuestionnaireSimpleCondition) => void,
  ): HTMLElement {
    const wrap = el("div", "grid gap-2 md:grid-cols-3");
    const fieldInput = document.createElement("input");
    fieldInput.type = "text";
    fieldInput.className = "input input-bordered w-full";
    fieldInput.placeholder = "Field name";
    fieldInput.value = condition.field || "";

    const opSelect = document.createElement("select");
    opSelect.className = "select select-bordered w-full";
    ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "notEmpty", "in", "notIn"].forEach((op) => {
      const opt = document.createElement("option");
      opt.value = op;
      opt.textContent = op;
      opt.selected = condition.op === op;
      opSelect.append(opt);
    });

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.className = "input input-bordered w-full";
    valueInput.placeholder = "Value";
    valueInput.value = Array.isArray((condition as any).value)
      ? ((condition as any).value || []).join(",")
      : String((condition as any).value ?? "");

    const push = () => {
      const op = opSelect.value as QuestionnaireSimpleCondition["op"];
      const next: any = { op, field: fieldInput.value.trim() };

      if (op !== "empty" && op !== "notEmpty") {
        next.value = op === "in" || op === "notIn"
          ? valueInput.value.split(",").map((item) => item.trim()).filter(Boolean)
          : valueInput.value;
      }

      valueInput.disabled = op === "empty" || op === "notEmpty";
      onChange(next);
    };

    valueInput.disabled = condition.op === "empty" || condition.op === "notEmpty";

    fieldInput.addEventListener("input", push);
    opSelect.addEventListener("change", push);
    valueInput.addEventListener("input", push);

    wrap.append(fieldInput, opSelect, valueInput);
    return wrap;
  }

  private renderPreviewCard(): HTMLElement {
    const wrap = el("div", "mt-4 rounded-box border border-dashed border-base-300 p-3");
    wrap.append(el("div", "mb-2 text-sm font-medium", "Live preview"));
    const root = el("div", "questionnaire-preview");
    this._previewEl = root;
    wrap.append(root);
    this.renderPreviewInto(root);
    return wrap;
  }

  private renderRuntime(): void {
    if (!this._runtimeEl) return;
    this._runtimeEl.innerHTML = "";
    const root = el("div", "questionnaire-runtime space-y-3");
    this._runtimeEl.append(root);
    this.renderPreviewInto(root, true);
  }

  private renderPreviewInto(target: HTMLElement, isMainRuntime = false): void {
    target.innerHTML = "";
    const pages = this.visiblePages();
    if (this._currentPage >= pages.length) this._currentPage = Math.max(0, pages.length - 1);
    const page = pages[this._currentPage] || pages[0];
    target.append(el("div", "text-lg font-semibold", this._schema.title || "Questionnaire"));
    if (this._schema.description) target.append(el("div", "mb-3 text-sm text-base-content/70", this._schema.description));
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
      const cardEl = el("div", "prose max-w-none rounded-box border border-base-300 bg-base-100 p-3");
      cardEl.innerHTML = (element as QuestionnaireContentElement).html || "";
      wrap.append(cardEl);
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
        const row = el("label", "label cursor-pointer justify-start gap-3");
        const node = document.createElement("input");
        node.type = "checkbox";
        node.className = element.kind === "toggle" ? "toggle" : "checkbox";
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
        const node = document.createElement("select");
        node.className = "select select-bordered w-full min-h-32";
        node.multiple = true;
        node.disabled = readOnly;
        const selected = Array.isArray(currentValue) ? currentValue.map(String) : [];
        (element as QuestionnaireSelectElement).options?.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          opt.selected = selected.includes(option.value);
          node.append(opt);
        });
        node.addEventListener("change", () => setValue(Array.from(node.selectedOptions).map((o) => o.value)));
        input = node;
        break;
      }
      case "radio": {
        const group = el("div", "space-y-2");
        (element as QuestionnaireSelectElement).options?.forEach((option) => {
          const row = el("label", "label cursor-pointer justify-start gap-3");
          const node = document.createElement("input");
          node.type = "radio";
          node.className = "radio";
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

  private updateElementName(element: QuestionnaireElement, rawValue: string): void {
    const previousName = element.name;
    const nextName = sanitizeName(rawValue || previousName);
    if (!nextName) return;
    element.name = nextName;
    this.migrateAnswerKey(previousName, nextName);
    this.persistSchema("element-name");
  }

  private migrateAnswerKey(previousName: string, nextName: string): void {
    if (!previousName || !nextName || previousName === nextName) return;
    if (!Object.prototype.hasOwnProperty.call(this._answers, previousName)) return;
    if (Object.prototype.hasOwnProperty.call(this._answers, nextName)) return;

    this._answers[nextName] = this._answers[previousName];
    delete this._answers[previousName];
    this.saveDraft();
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey: nextName });
  }

  private migrateRepeatChildAnswers(
    repeatName: string,
    previousChildren: QuestionnaireElement[],
    nextChildren: QuestionnaireElement[],
  ): void {
    const rows = this._answers[repeatName];
    if (!Array.isArray(rows) || !rows.length) return;

    let changed = false;
    const length = Math.min(previousChildren.length, nextChildren.length);

    rows.forEach((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      const record = row as Record<string, QuestionnaireValue>;

      for (let index = 0; index < length; index += 1) {
        const previousName = previousChildren[index]?.name;
        const nextName = nextChildren[index]?.name;
        if (!previousName || !nextName || previousName === nextName) continue;
        if (!Object.prototype.hasOwnProperty.call(record, previousName)) continue;
        if (Object.prototype.hasOwnProperty.call(record, nextName)) continue;

        record[nextName] = record[previousName];
        delete record[previousName];
        changed = true;
      }
    });

    if (!changed) return;
    this.saveDraft();
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey: repeatName });
  }

  private setAnswer(key: string, value: QuestionnaireValue, changedKey?: string): void {
    this._answers[key] = value;
    this.raiseTypedEvent("questionnaire-change", { answers: clone(this._answers), changedKey });
    this.saveDraft();
    this.renderRuntime();
    if (this._previewEl) this.renderPreviewInto(this._previewEl);
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
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason });
    this.renderAll();
  }

  private visiblePages(): QuestionnairePage[] {
    return this._schema.pages.filter((page) => conditionMatches(page.visibleWhen, this._answers));
  }

  private pageBySelection(): QuestionnairePage | undefined {
    if (this._selected.kind === "page") return this._schema.pages.find((page) => page.id === this._selected.pageId);
    if (this._selected.kind === "element") return this._schema.pages.find((page) => page.id === this._selected.pageId);
    return undefined;
  }

  private elementBySelection(): QuestionnaireElement | undefined {
    if (this._selected.kind !== "element") return undefined;
    const page = this._schema.pages.find((item) => item.id === this._selected.pageId);
    return page?.elements.find((item) => item.id === this._selected.elementId);
  }

  private raiseSelectionChange(): void {
    this.raiseTypedEvent("questionnaire-selection-change", { selection: clone(this._selected) });
  }

  private movePage(oldIndex: number, newIndex: number): void {
    if (newIndex < 0 || newIndex >= this._schema.pages.length || oldIndex === newIndex) return;
    const [page] = this._schema.pages.splice(oldIndex, 1);
    this._schema.pages.splice(newIndex, 0, page);
    this.raiseTypedEvent("questionnaire-page-moved", { pageId: page.id, oldIndex, newIndex });
    this.persistSchema("page-move");
  }

  private removePage(index: number): void {
    if (this._schema.pages.length <= 1) return;
    const [page] = this._schema.pages.splice(index, 1);
    this.raiseTypedEvent("questionnaire-page-removed", { pageId: page.id, index });
    this._selected = { kind: "form" };
    this.raiseSelectionChange();
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

  private removeElement(pageId: string, index: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    const [element] = page.elements.splice(index, 1);
    this.raiseTypedEvent("questionnaire-element-removed", { pageId, elementId: element.id, index });
    this._selected = { kind: "page", pageId };
    this.raiseSelectionChange();
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
