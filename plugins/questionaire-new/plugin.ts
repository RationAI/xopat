import { button, card, cardBody, el, numberInput, textAreaInput, textInput, toggleInput } from "./dom";
import { createDefaultSchema, makeElement, makePage, normalizeSchema } from "./schema";
import type {
  PluginEventMap,
  QuestionnaireAnswers,
  QuestionnaireContentElement,
  QuestionnaireElement,
  QuestionnaireFileElement,
  QuestionnaireFileValue,
  QuestionnairePage,
  QuestionnaireRatingElement,
  QuestionnaireSchema,
  QuestionnaireSelectElement,
  QuestionnaireSelection,
  QuestionnaireValue,
  ViewerLikeRecord,
} from "./types";
import { answerFor, validatePage } from "./validation";
import { clone, conditionToText, isConditionVisible, parseCondition, sanitizeName, toBgLabel, titleCase } from "./utils";

declare const LAYOUT: any;

export class QuestionnairePlugin extends XOpatPlugin {
  private readonly DRAFT_KEY = "questionnaire_draft";
  private readonly DEFAULT_SCHEMA: QuestionnaireSchema = createDefaultSchema();

  private _schema: QuestionnaireSchema = clone(this.DEFAULT_SCHEMA);
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
    this.initPostIO({ exportKey: "scheme", inViewerContext: false });
  }

  async exportData(key: string): Promise<any> {
    if (key !== "scheme") return undefined;
    return JSON.stringify(this._schema);
  }

  async importData(key: string, data: any): Promise<void> {
    if (key !== "scheme" || !data) return;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    this._schema = normalizeSchema(parsed, this.DEFAULT_SCHEMA);
    this.raiseTypedEvent("questionnaire-schema-imported", { schema: clone(this._schema) });
    this.raiseTypedEvent("questionnaire-schema-change", { schema: clone(this._schema), reason: "import" });
    this.renderAll();
  }

  pluginReady(): void {
    this.ensureTab();
    this.hookViewerLifecycle();
    this._schema = normalizeSchema(this._schema || this.DEFAULT_SCHEMA, this.DEFAULT_SCHEMA);
    this._answers = this.loadDraft() || {};
    this.renderAll();
  }

  private ensureTab(): void {
    LAYOUT.addTab({
      id: "questionaire",
      title: "Questionnaire",
      icon: "fa-question-circle",
      body: [
        new UI.RawHtml(`
        <main class="questionnaire-root mx-auto max-w-7xl p-2">
          <div class="card bg-base-100 shadow-md">
            <div class="card-body p-3">
              <div id="questionnaire-toolbar"></div>
              <div id="questionnaire-designer" class="mt-3 hidden"></div>
              <div id="questionnaire-runtime" class="mt-3"></div>
            </div>
          </div>
        </main>
      `),
      ],
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
      right.append(
        button(this._designerActive ? "Hide designer" : "Show designer", "btn btn-outline btn-sm", () => {
          this._designerActive = !this._designerActive;
          this.raiseTypedEvent("questionnaire-designer-toggle", { active: this._designerActive });
          this.renderAll();
        })
      );
    }
    right.append(
      button("Clear draft", "btn btn-outline btn-sm", () => {
        this._answers = {};
        this.saveDraft();
        this.renderRuntime();
      })
    );
    if (this._isExported) right.append(el("span", "badge badge-warning", "Read-only"));
    wrap.append(left, right);
    this._toolbarEl.append(wrap);
  }

  private renderDesigner(): void {
    if (!this._designerEl) return;
    this._designerEl.innerHTML = "";
    this._designerEl.classList.toggle("hidden", !this._designerActive);
    if (!this._designerActive) return;

    const shell = el("div", "grid gap-3 xl:grid-cols-[18rem_minmax(0,1fr)_24rem]");
    shell.append(this.renderPagesPanel(), this.renderDesignerCanvas(), this.renderInspector());
    this._designerEl.append(shell);
  }

  private renderPagesPanel(): HTMLElement {
    const panel = card("Pages");
    const body = cardBody(panel);
    body.append(
      button("Add page", "btn btn-primary btn-sm mb-3", () => {
        const page = makePage(this._schema.pages.length + 1);
        this._schema.pages.push(page);
        this._selected = { kind: "page", pageId: page.id };
        this.raiseTypedEvent("questionnaire-page-added", { page: clone(page), index: this._schema.pages.length - 1 });
        this.raiseSelectionChange();
        this.persistSchema("page-add");
      })
    );

    const list = el("div", "space-y-2");
    this._schema.pages.forEach((page, index) => {
      const active = this._selected.kind !== "form" && this._selected.pageId === page.id;
      const row = el(
        "div",
        "rounded-box border border-base-300 bg-base-100 p-2" + (active ? " ring-2 ring-primary/40" : "")
      );
      row.append(
        button(page.title || `Page ${index + 1}`, "btn btn-ghost btn-sm justify-start", () => {
          this._selected = { kind: "page", pageId: page.id };
          this.raiseSelectionChange();
          this.renderDesigner();
        })
      );
      row.append(el("div", "mt-1 text-xs text-base-content/60", `${page.elements.length} fields • background ${toBgLabel(page.xBgSpec)}`));
      const actions = el("div", "mt-2 flex flex-wrap gap-2");
      actions.append(
        button("↑", "btn btn-outline btn-xs", () => this.movePage(index, index - 1)),
        button("↓", "btn btn-outline btn-xs", () => this.movePage(index, index + 1)),
        button("Delete", "btn btn-outline btn-xs", () => this.removePage(index))
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
      body.append(this.renderPreviewCard());
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
    const paletteKinds: QuestionnaireElement["kind"][] = [
      "text","textarea","number","email","date","tel","url","select","multiselect","checkbox","radio","toggle","rating","file","content"
    ];
    paletteKinds.forEach((kind) => {
      palette.append(
        button(titleCase(kind), "btn btn-outline btn-sm", () => {
          const element = makeElement(kind);
          page.elements.push(element);
          this._selected = { kind: "element", pageId: page.id, elementId: element.id };
          this.raiseTypedEvent("questionnaire-element-added", {
            pageId: page.id,
            element: clone(element),
            index: page.elements.length - 1,
          });
          this.raiseSelectionChange();
          this.persistSchema("element-add");
        })
      );
    });
    body.append(palette);

    const fields = el("div", "space-y-2");
    page.elements.forEach((elementItem, index) => {
      const active =
        this._selected.kind === "element" &&
        this._selected.pageId === page.id &&
        this._selected.elementId === elementItem.id;
      const row = el(
        "div",
        "rounded-box border border-base-300 bg-base-100 p-3" + (active ? " ring-2 ring-primary/40" : "")
      );
      row.append(
        button(`${elementItem.label || elementItem.name || elementItem.kind}`, "btn btn-ghost btn-sm justify-start", () => {
          this._selected = { kind: "element", pageId: page.id, elementId: elementItem.id };
          this.raiseSelectionChange();
          this.renderDesigner();
        }),
        el("div", "mt-1 text-xs text-base-content/60", `${elementItem.kind} • ${elementItem.name}`)
      );
      const actions = el("div", "mt-2 flex flex-wrap gap-2");
      actions.append(
        button("↑", "btn btn-outline btn-xs", () => this.moveElement(page.id, index, index - 1)),
        button("↓", "btn btn-outline btn-xs", () => this.moveElement(page.id, index, index + 1)),
        button("Delete", "btn btn-outline btn-xs", () => this.removeElement(page.id, index))
      );
      row.append(actions);
      fields.append(row);
    });

    body.append(fields, this.renderPreviewCard());
    return panel;
  }

  private renderInspector(): HTMLElement {
    const panel = card("Inspector");
    const body = cardBody(panel);

    if (this._selected.kind === "form") {
      body.append(
        textInput("Title", this._schema.title || "", (v) => {
          this._schema.title = v;
          this.persistSchema("form-title");
        }),
        textAreaInput("Description", this._schema.description || "", (v) => {
          this._schema.description = v;
          this.persistSchema("form-description");
        })
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
        textInput("Page title", page.title || "", (v) => {
          page.title = v;
          this.persistSchema("page-title");
        }),
        textAreaInput("Page description", page.description || "", (v) => {
          page.description = v;
          this.persistSchema("page-description");
        }),
        numberInput("Background index", page.xBgSpec, (v) => {
          page.xBgSpec = v ?? 0;
          this.persistSchema("page-background");
        }),
        textAreaInput("Visible when (JSON)", conditionToText(page.visibleWhen), (v) => {
          page.visibleWhen = parseCondition(v);
          this.persistSchema("page-visible-when");
        }, 7)
      );
      return panel;
    }

    const elementItem = this.elementBySelection();
    if (!elementItem) {
      body.append(el("div", "text-sm text-error", "Element no longer exists."));
      return panel;
    }

    body.append(
      textInput("Label", elementItem.label || "", (v) => {
        elementItem.label = v;
        this.persistSchema("element-label");
      }),
      textInput("Name", elementItem.name || "", (v) => {
        elementItem.name = sanitizeName(v || elementItem.name);
        this.persistSchema("element-name");
      }),
      textAreaInput("Description", elementItem.description || "", (v) => {
        elementItem.description = v;
        this.persistSchema("element-description");
      })
    );

    if (elementItem.kind !== "content") {
      body.append(
        textInput("Placeholder", elementItem.placeholder || "", (v) => {
          elementItem.placeholder = v;
          this.persistSchema("element-placeholder");
        }),
        toggleInput("Required", !!elementItem.required, (checked) => {
          elementItem.required = checked;
          this.persistSchema("element-required");
        }),
        toggleInput("Read only", !!elementItem.readOnly, (checked) => {
          elementItem.readOnly = checked;
          this.persistSchema("element-readonly");
        }),
        toggleInput("Half width", elementItem.width === "1/2", (checked) => {
          elementItem.width = checked ? "1/2" : "full";
          this.persistSchema("element-width");
        }),
        textAreaInput("Visible when (JSON)", conditionToText(elementItem.visibleWhen), (v) => {
          elementItem.visibleWhen = parseCondition(v);
          this.persistSchema("element-visible-when");
        }, 7),
        textAreaInput("Required when (JSON)", conditionToText(elementItem.requiredWhen), (v) => {
          elementItem.requiredWhen = parseCondition(v);
          this.persistSchema("element-required-when");
        }, 7),
        numberInput("Validation: min", elementItem.validation?.min, (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), min: v };
          this.persistSchema("element-validation-min");
        }),
        numberInput("Validation: max", elementItem.validation?.max, (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), max: v };
          this.persistSchema("element-validation-max");
        }),
        numberInput("Validation: minLength", elementItem.validation?.minLength, (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), minLength: v };
          this.persistSchema("element-validation-minlength");
        }),
        numberInput("Validation: maxLength", elementItem.validation?.maxLength, (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), maxLength: v };
          this.persistSchema("element-validation-maxlength");
        }),
        textInput("Validation: regex pattern", elementItem.validation?.pattern || "", (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), pattern: v || undefined };
          this.persistSchema("element-validation-pattern");
        }),
        textInput("Validation: custom message", elementItem.validation?.message || "", (v) => {
          elementItem.validation = { ...(elementItem.validation || {}), message: v || undefined };
          this.persistSchema("element-validation-message");
        })
      );
    }

    if (elementItem.kind === "content") {
      body.append(
        textAreaInput("HTML", (elementItem as QuestionnaireContentElement).html || "", (v) => {
          (elementItem as QuestionnaireContentElement).html = v;
          this.persistSchema("element-html");
        }, 8)
      );
    }

    if (elementItem.kind === "select" || elementItem.kind === "multiselect" || elementItem.kind === "radio") {
      const selectElement = elementItem as QuestionnaireSelectElement;
      const value = (selectElement.options || []).map((o) => `${o.value}|${o.label}`).join("\n");
      body.append(
        textAreaInput("Options (value|label per line)", value, (text) => {
          selectElement.options = text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
              const parts = line.split("|");
              const v = (parts[0] || "").trim();
              const l = (parts[1] || parts[0] || "").trim();
              return { value: v, label: l };
            });
          this.persistSchema("element-options");
        }, 6)
      );
    }

    if (elementItem.kind === "rating") {
      const ratingElement = elementItem as QuestionnaireRatingElement;
      body.append(
        numberInput("Max rating", ratingElement.maxRating ?? 5, (v) => {
          ratingElement.maxRating = v ?? 5;
          this.persistSchema("element-rating-max");
        })
      );
    }

    if (elementItem.kind === "file") {
      const fileElement = elementItem as QuestionnaireFileElement;
      body.append(
        toggleInput("Allow multiple files", !!fileElement.multiple, (checked) => {
          fileElement.multiple = checked;
          this.persistSchema("element-file-multiple");
        }),
        textInput("Accept", fileElement.accept || "", (v) => {
          fileElement.accept = v;
          this.persistSchema("element-file-accept");
        })
      );
    }

    return panel;
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

    const nav = el("div", "mb-3 flex flex-wrap gap-1");
    pages.forEach((p, index) => {
      nav.append(button(p.title || `Page ${index + 1}`, "tab tab-bordered" + (index === this._currentPage ? " tab-active" : ""), () => this.goToPage(index)));
    });
    target.append(nav);

    if (!page) {
      target.append(el("div", "text-sm text-base-content/70", "No visible pages."));
      return;
    }

    const errors = validatePage(page, this._answers, this._schema);

    target.append(el("div", "text-base font-semibold", page.title));
    if (page.description) target.append(el("div", "mb-4 text-sm text-base-content/70", page.description));

    const grid = el("div", "grid grid-cols-1 gap-4 md:grid-cols-2");
    page.elements
      .filter((item) => isConditionVisible(item.visibleWhen, (name) => this._answers[name]))
      .forEach((elementItem) => grid.append(this.renderElement(elementItem, errors)));
    target.append(grid);

    const actions = el("div", "mt-4 flex flex-wrap items-center justify-between gap-2");
    const prev = button("Previous", "btn btn-outline btn-sm", () => this.goToPage(this._currentPage - 1));
    prev.disabled = this._currentPage <= 0;
    const next = button("Next", "btn btn-primary btn-sm", () => {
      const currentErrors = validatePage(page, this._answers, this._schema);
      if (Object.keys(currentErrors).length) {
        this.raiseTypedEvent("questionnaire-validation-failed", { pageIndex: this._currentPage, errors: currentErrors });
        this.renderPreviewInto(target, isMainRuntime);
        return;
      }
      if (this._currentPage < pages.length - 1) {
        this.goToPage(this._currentPage + 1);
      } else {
        this.raiseTypedEvent("questionnaire-submit", {
          answers: clone(this._answers),
          schema: clone(this._schema),
        });
      }
    });
    next.textContent = this._currentPage < pages.length - 1 ? "Next" : "Submit";
    actions.append(prev, next);
    target.append(actions);
  }

  private renderElement(elementItem: QuestionnaireElement, errors: Record<string, string>): HTMLElement {
    const widthClass = elementItem.width === "1/2" ? "md:col-span-1" : "md:col-span-2";
    const wrap = el("div", `form-control ${widthClass}`);

    if (elementItem.kind === "content") {
      const cardEl = el("div", "prose max-w-none rounded-box border border-base-300 bg-base-100 p-3");
      cardEl.innerHTML = (elementItem as QuestionnaireContentElement).html || "";
      wrap.append(cardEl);
      return wrap;
    }

    if (elementItem.kind !== "checkbox" && elementItem.kind !== "toggle" && elementItem.label) {
      wrap.append(el("label", "label", undefined, [el("span", "label-text font-medium", elementItem.label + (this.isRequired(elementItem) ? " *" : ""))]));
    }
    if (elementItem.description) wrap.append(el("div", "mb-1 text-xs text-base-content/60", elementItem.description));

    const value = answerFor(elementItem, this._answers);
    let input: HTMLElement;

    switch (elementItem.kind) {
      case "textarea": {
        const node = document.createElement("textarea");
        node.className = "textarea textarea-bordered min-h-24 w-full";
        node.placeholder = elementItem.placeholder || "";
        node.value = String(value ?? "");
        node.disabled = !!elementItem.readOnly || this._isExported;
        node.addEventListener("input", () => this.setAnswer(elementItem.name, node.value, elementItem.name));
        input = node;
        break;
      }
      case "number":
      case "email":
      case "date":
      case "tel":
      case "url":
      case "text": {
        const node = document.createElement("input");
        node.type = elementItem.kind === "text" ? "text" : elementItem.kind;
        node.className = "input input-bordered w-full";
        node.placeholder = elementItem.placeholder || "";
        node.value = value == null ? "" : String(value);
        node.disabled = !!elementItem.readOnly || this._isExported;
        node.addEventListener("input", () => {
          const nextValue = elementItem.kind === "number" ? (node.value === "" ? null : Number(node.value)) : node.value;
          this.setAnswer(elementItem.name, nextValue, elementItem.name);
        });
        input = node;
        break;
      }
      case "checkbox":
      case "toggle": {
        const row = el("label", "label cursor-pointer justify-start gap-3");
        const node = document.createElement("input");
        node.type = "checkbox";
        node.className = elementItem.kind === "toggle" ? "toggle" : "checkbox";
        node.checked = !!value;
        node.disabled = !!elementItem.readOnly || this._isExported;
        node.addEventListener("change", () => this.setAnswer(elementItem.name, node.checked, elementItem.name));
        row.append(node, el("span", "label-text", elementItem.label || elementItem.name));
        input = row;
        break;
      }
      case "select": {
        const node = document.createElement("select");
        node.className = "select select-bordered w-full";
        node.disabled = !!elementItem.readOnly || this._isExported;
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = elementItem.placeholder || "Select...";
        node.append(blank);
        (elementItem as QuestionnaireSelectElement).options?.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          if (String(value ?? "") === option.value) opt.selected = true;
          node.append(opt);
        });
        node.addEventListener("change", () => this.setAnswer(elementItem.name, node.value, elementItem.name));
        input = node;
        break;
      }
      case "multiselect": {
        const node = document.createElement("select");
        node.className = "select select-bordered w-full min-h-32";
        node.multiple = true;
        node.disabled = !!elementItem.readOnly || this._isExported;
        const selected = Array.isArray(value) ? value.map(String) : [];
        (elementItem as QuestionnaireSelectElement).options?.forEach((option) => {
          const opt = document.createElement("option");
          opt.value = option.value;
          opt.textContent = option.label;
          opt.selected = selected.includes(option.value);
          node.append(opt);
        });
        node.addEventListener("change", () => {
          this.setAnswer(
            elementItem.name,
            Array.from(node.selectedOptions).map((o) => o.value),
            elementItem.name
          );
        });
        input = node;
        break;
      }
      case "radio": {
        const group = el("div", "space-y-2");
        (elementItem as QuestionnaireSelectElement).options?.forEach((option) => {
          const row = el("label", "label cursor-pointer justify-start gap-3");
          const node = document.createElement("input");
          node.type = "radio";
          node.className = "radio";
          node.name = `radio_${elementItem.id}`;
          node.checked = String(value ?? "") === option.value;
          node.disabled = !!elementItem.readOnly || this._isExported;
          node.addEventListener("change", () => {
            if (node.checked) this.setAnswer(elementItem.name, option.value, elementItem.name);
          });
          row.append(node, el("span", "label-text", option.label));
          group.append(row);
        });
        input = group;
        break;
      }
      case "rating": {
        const ratingElement = elementItem as QuestionnaireRatingElement;
        const group = el("div", "rating questionnaire-rating gap-1");
        const max = Math.max(1, Number(ratingElement.maxRating || 5));
        for (let i = 1; i <= max; i += 1) {
          const btn = button(String(i), "btn btn-outline btn-sm" + (Number(value) === i ? " btn-primary" : ""), () => {
            if (!elementItem.readOnly && !this._isExported) this.setAnswer(elementItem.name, i, elementItem.name);
          });
          btn.disabled = !!elementItem.readOnly || this._isExported;
          group.append(btn);
        }
        input = group;
        break;
      }
      case "file": {
        const fileElement = elementItem as QuestionnaireFileElement;
        const group = el("div", "space-y-2");
        const node = document.createElement("input");
        node.type = "file";
        node.className = "file-input file-input-bordered w-full";
        node.multiple = !!fileElement.multiple;
        if (fileElement.accept) node.accept = fileElement.accept;
        node.disabled = !!elementItem.readOnly || this._isExported;
        node.addEventListener("change", () => {
          const files = Array.from(node.files || []).map<QuestionnaireFileValue>((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
          }));
          this.setAnswer(elementItem.name, files, elementItem.name);
        });
        group.append(node);
        const files = Array.isArray(value) ? (value as QuestionnaireFileValue[]) : [];
        if (files.length) {
          const list = el("div", "rounded-box border border-base-300 bg-base-100 p-2 text-sm");
          files.forEach((file) => list.append(el("div", "truncate", `${file.name} (${Math.ceil(file.size / 1024)} KB)`)));
          group.append(list);
        }
        input = group;
        break;
      }
      default: {
        const node = document.createElement("input");
        node.type = "text";
        node.className = "input input-bordered w-full";
        node.placeholder = elementItem.placeholder || "";
        node.value = String(value ?? "");
        node.disabled = !!elementItem.readOnly || this._isExported;
        node.addEventListener("input", () => this.setAnswer(elementItem.name, node.value, elementItem.name));
        input = node;
      }
    }

    wrap.append(input);
    if (errors[elementItem.name]) wrap.append(el("div", "mt-1 text-sm text-error", errors[elementItem.name]));
    return wrap;
  }

  private visiblePages(): QuestionnairePage[] {
    return this._schema.pages.filter((page) => isConditionVisible(page.visibleWhen, (name) => this._answers[name]));
  }

  private goToPage(index: number): void {
    const pages = this.visiblePages();
    const next = Math.max(0, Math.min(index, pages.length - 1));
    this._currentPage = next;
    const page = pages[next];
    if (!page) return;
    const viewerIds = Array.from(this._viewerMap.keys());
    this.raiseTypedEvent("questionnaire-page-change", { pageIndex: next, page: clone(page), viewerIds });
    this.applyBackgroundForPage(next, page);
    this.renderRuntime();
    if (this._previewEl) this.renderPreviewInto(this._previewEl);
  }

  private async applyBackgroundForPage(pageIndex: number, page: QuestionnairePage): Promise<void> {
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

  private isRequired(elementItem: QuestionnaireElement): boolean {
    return !!elementItem.required || isConditionVisible(elementItem.requiredWhen, (name) => this._answers[name]);
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
    const [elementItem] = page.elements.splice(oldIndex, 1);
    page.elements.splice(newIndex, 0, elementItem);
    this.raiseTypedEvent("questionnaire-element-moved", { pageId, elementId: elementItem.id, oldIndex, newIndex });
    this.persistSchema("element-move");
  }

  private removeElement(pageId: string, index: number): void {
    const page = this._schema.pages.find((item) => item.id === pageId);
    if (!page) return;
    const [elementItem] = page.elements.splice(index, 1);
    this.raiseTypedEvent("questionnaire-element-removed", { pageId, elementId: elementItem.id, index });
    this._selected = { kind: "page", pageId };
    this.raiseSelectionChange();
    this.persistSchema("element-remove");
  }

  private raiseTypedEvent<K extends keyof PluginEventMap>(name: K, payload: PluginEventMap[K]): void {
    this.raiseEvent(name, payload as any);
  }
}
