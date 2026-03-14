const { div, select, option, button, span } = (globalThis as any).van.tags;

export type SessionPickerSession = Pick<ChatSession, "id" | "title" | "updatedAt">;

export interface ChatSessionPickerOptions {
  onSelect?: (sessionId: string | null) => void;
  onCreate?: () => void;
  onRename?: (sessionId: string | null) => void;
  onDelete?: (sessionId: string | null) => void;
}

export class ChatSessionPicker {
  options: ChatSessionPickerOptions;
  _root: HTMLElement | null;
  _selectEl: HTMLSelectElement | null;
  _newBtn: HTMLButtonElement | null;
  _renameBtn: HTMLButtonElement | null;
  _deleteBtn: HTMLButtonElement | null;
  _sessions: SessionPickerSession[];
  _activeSessionId: string | null;
  _disabled: boolean;

  constructor(options: ChatSessionPickerOptions = {}) {
    this.options = options;
    this._root = null;
    this._selectEl = null;
    this._newBtn = null;
    this._renameBtn = null;
    this._deleteBtn = null;
    this._sessions = [];
    this._activeSessionId = null;
    this._disabled = false;
  }

  create(): HTMLElement {
    this._selectEl = select({
      class: "select select-xs select-bordered flex-1 min-w-0",
      onchange: (e: Event) => {
        const next = ((e.target as HTMLSelectElement).value || "").trim() || null;
        this._activeSessionId = next;
        this._updateActionState();
        this.options.onSelect?.(next);
      },
    }) as HTMLSelectElement;

    this._newBtn = button({
      type: "button",
      class: "btn btn-xs",
      onclick: () => this.options.onCreate?.(),
      title: "Start a new chat session",
    }, "New") as HTMLButtonElement;

    this._renameBtn = button({
      type: "button",
      class: "btn btn-xs",
      onclick: () => this.options.onRename?.(this._activeSessionId),
      title: "Rename selected session",
    }, "Rename") as HTMLButtonElement;

    this._deleteBtn = button({
      type: "button",
      class: "btn btn-xs btn-error btn-outline",
      onclick: () => this.options.onDelete?.(this._activeSessionId),
      title: "Delete selected session",
    }, "Delete") as HTMLButtonElement;

    this._root = div(
      { class: "flex items-center gap-2 min-w-0" },
      span({ class: "text-[11px] text-base-content/70 shrink-0" }, "Session"),
      this._selectEl,
      this._newBtn,
      this._renameBtn,
      this._deleteBtn,
    ) as HTMLElement;

    this.setSessions([], null);
    this.setDisabled(false);
    return this._root;
  }

  setSessions(sessions: SessionPickerSession[], activeSessionId?: string | null): void {
    this._sessions = Array.isArray(sessions) ? [...sessions] : [];
    this._activeSessionId = activeSessionId ?? this._activeSessionId ?? null;

    if (!this._selectEl) return;
    this._selectEl.innerHTML = "";
    this._selectEl.appendChild(option({ value: "" }, this._sessions.length ? "Choose session…" : "No sessions yet"));

    for (const session of this._sessions) {
      const updated = session.updatedAt ? new Date(session.updatedAt) : null;
      const suffix = updated && !Number.isNaN(updated.getTime())
        ? ` · ${updated.toLocaleDateString()} ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
        : "";
      this._selectEl.appendChild(option({ value: session.id }, `${session.title || "Untitled chat"}${suffix}`));
    }

    if (this._activeSessionId && this._sessions.some((s) => s.id === this._activeSessionId)) {
      this._selectEl.value = this._activeSessionId;
    } else {
      this._activeSessionId = null;
      this._selectEl.value = "";
    }

    this._updateActionState();
  }

  setActiveSession(sessionId: string | null): void {
    this._activeSessionId = sessionId;
    if (this._selectEl) {
      this._selectEl.value = sessionId && this._sessions.some((s) => s.id === sessionId) ? sessionId : "";
    }
    this._updateActionState();
  }

  getActiveSessionId(): string | null {
    return this._activeSessionId;
  }

  setDisabled(disabled: boolean): void {
    this._disabled = !!disabled;
    if (this._selectEl) this._selectEl.disabled = this._disabled;
    if (this._newBtn) this._newBtn.disabled = this._disabled;
    this._updateActionState();
  }

  _updateActionState(): void {
    const hasActive = !!this._activeSessionId;
    if (this._renameBtn) this._renameBtn.disabled = this._disabled || !hasActive;
    if (this._deleteBtn) this._deleteBtn.disabled = this._disabled || !hasActive;
  }
}
