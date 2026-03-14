const { div, button, input } = (globalThis as any).van.tags;

export interface ChatAttachmentBarOptions {
  onFilesSelected?: (files: FileList | File[]) => void;
  onScreenshot?: () => void;
}

export class ChatAttachmentBar {
  options: ChatAttachmentBarOptions;
  _root: HTMLElement | null;
  _fileInputEl: HTMLInputElement | null;
  _attachBtn: HTMLButtonElement | null;
  _screenshotBtn: HTMLButtonElement | null;
  _disabled: boolean;

  constructor(options: ChatAttachmentBarOptions = {}) {
    this.options = options;
    this._root = null;
    this._fileInputEl = null;
    this._attachBtn = null;
    this._screenshotBtn = null;
    this._disabled = false;
  }

  create(): HTMLElement {
    this._fileInputEl = input({
      type: "file",
      class: "hidden",
      multiple: true,
      onchange: (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target?.files;
        if (files && files.length) {
          this.options.onFilesSelected?.(files);
        }
        if (target) target.value = "";
      },
    }) as HTMLInputElement;

    this._attachBtn = button({
      type: "button",
      class: "btn btn-xs",
      onclick: () => this._fileInputEl?.click(),
      title: "Attach files or images",
    }, "Attach") as HTMLButtonElement;

    this._screenshotBtn = button({
      type: "button",
      class: "btn btn-xs",
      onclick: () => this.options.onScreenshot?.(),
      title: "Attach a screenshot of the current viewer viewport",
    }, "Screenshot") as HTMLButtonElement;

    this._root = div(
      { class: "flex items-center gap-2" },
      this._fileInputEl,
      this._attachBtn,
      this._screenshotBtn,
    ) as HTMLElement;

    this.setDisabled(false);
    return this._root;
  }

  setDisabled(disabled: boolean): void {
    this._disabled = !!disabled;
    if (this._attachBtn) this._attachBtn.disabled = this._disabled;
    if (this._screenshotBtn) this._screenshotBtn.disabled = this._disabled;
    if (this._fileInputEl) this._fileInputEl.disabled = this._disabled;
  }
}
