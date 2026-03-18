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
    _menuEl: HTMLElement | null;
    _attachFileBtn: HTMLButtonElement | null;
    _screenshotBtn: HTMLButtonElement | null;
    _disabled: boolean;
    _filesEnabled: boolean;
    _screenshotEnabled: boolean;
    _outsideClickHandler: ((e: MouseEvent) => void) | null;

    constructor(options: ChatAttachmentBarOptions = {}) {
        this.options = options;
        this._root = null;
        this._fileInputEl = null;
        this._attachBtn = null;
        this._menuEl = null;
        this._attachFileBtn = null;
        this._screenshotBtn = null;
        this._disabled = false;
        this._filesEnabled = true;
        this._screenshotEnabled = true;
        this._outsideClickHandler = null;
    }

    create(): HTMLElement {
        this._fileInputEl = input({
            type: "file",
            class: "hidden",
            multiple: true,
            onchange: (e: Event) => {
                if (this._disabled || !this._filesEnabled) return;

                const target = e.target as HTMLInputElement;
                const files = target?.files;
                if (files && files.length) {
                    this.options.onFilesSelected?.(files);
                }
                if (target) target.value = "";
                this._closeMenu();
            },
        }) as HTMLInputElement;

        this._attachFileBtn = button({
            type: "button",
            class: "btn btn-sm btn-ghost justify-start w-full normal-case",
            onclick: (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._disabled || !this._filesEnabled) return;
                this._fileInputEl?.click();
            },
            title: "Attach files or images",
        }, "Attach file") as HTMLButtonElement;

        this._screenshotBtn = button({
            type: "button",
            class: "btn btn-sm btn-ghost justify-start w-full normal-case",
            onclick: (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._disabled || !this._screenshotEnabled) return;
                this._closeMenu();
                this.options.onScreenshot?.();
            },
            title: "Attach a screenshot of the current viewer viewport",
        }, "Take screenshot") as HTMLButtonElement;

        this._menuEl = div(
            {
                class: "hidden absolute right-0 top-9 z-20 min-w-40 rounded-box border border-base-300 bg-base-100 shadow-lg p-1",
                onclick: (e: Event) => e.stopPropagation(),
            },
            this._attachFileBtn,
            this._screenshotBtn,
        ) as HTMLElement;

        this._attachBtn = button({
            type: "button",
            class: "btn btn-xs btn-circle",
            onclick: (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._disabled) return;
                this._toggleMenu();
            },
            title: "Add attachment or screenshot",
        }, "+") as HTMLButtonElement;

        this._root = div(
            {
                class: "relative inline-flex",
                onclick: (e: Event) => e.stopPropagation(),
            },
            this._fileInputEl,
            this._attachBtn,
            this._menuEl,
        ) as HTMLElement;

        this._outsideClickHandler = () => this._closeMenu();
        document.addEventListener("click", this._outsideClickHandler);

        this.setDisabled(false);
        this.setAvailability({ files: true, screenshot: true });
        return this._root;
    }

    _toggleMenu(): void {
        if (!this._menuEl) return;
        this._menuEl.classList.toggle("hidden");
    }

    _closeMenu(): void {
        if (this._menuEl) this._menuEl.classList.add("hidden");
    }

    setDisabled(disabled: boolean): void {
        this._disabled = !!disabled;
        if (this._attachBtn) this._attachBtn.disabled = this._disabled;
        if (this._fileInputEl) this._fileInputEl.disabled = this._disabled || !this._filesEnabled;
        if (this._disabled) this._closeMenu();
        this._syncAvailabilityUi();
    }

    setAvailability(options: { files?: boolean; screenshot?: boolean }): void {
        if (typeof options.files === "boolean") {
            this._filesEnabled = options.files;
        }
        if (typeof options.screenshot === "boolean") {
            this._screenshotEnabled = options.screenshot;
        }

        if (this._fileInputEl) {
            this._fileInputEl.disabled = this._disabled || !this._filesEnabled;
        }

        this._syncAvailabilityUi();
    }

    _syncAvailabilityUi(): void {
        if (this._attachFileBtn) {
            this._attachFileBtn.disabled = this._disabled || !this._filesEnabled;
            this._attachFileBtn.classList.toggle("opacity-50", this._disabled || !this._filesEnabled);
            this._attachFileBtn.classList.toggle("cursor-not-allowed", this._disabled || !this._filesEnabled);
            this._attachFileBtn.title = this._filesEnabled
                ? "Attach files or images"
                : "File upload unavailable for this model";
        }

        if (this._screenshotBtn) {
            this._screenshotBtn.disabled = this._disabled || !this._screenshotEnabled;
            this._screenshotBtn.classList.toggle("opacity-50", this._disabled || !this._screenshotEnabled);
            this._screenshotBtn.classList.toggle("cursor-not-allowed", this._disabled || !this._screenshotEnabled);
            this._screenshotBtn.title = this._screenshotEnabled
                ? "Attach a screenshot of the current viewer viewport"
                : "Screenshot unavailable for this model";
        }

        const anyAvailable = this._filesEnabled || this._screenshotEnabled;
        if (this._attachBtn) {
            this._attachBtn.disabled = this._disabled || !anyAvailable;
            this._root!.title = !anyAvailable
                ? "Attachments unavailable for this model"
                : "Add attachment or screenshot";
        }

        if ((!this._filesEnabled && !this._screenshotEnabled) || this._disabled) {
            this._closeMenu();
        }
    }
}