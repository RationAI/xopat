const { div, button, span } = (globalThis as any).van.tags;

export type SessionPickerSession = Pick<ChatSession, "id" | "title" | "updatedAt">;

export interface ChatSessionPickerOptions {
    onSelect?: (sessionId: string | null) => void;
    onRename?: (sessionId: string | null) => void;
    onDelete?: (sessionId: string | null) => void;
}

export class ChatSessionPicker {
    options: ChatSessionPickerOptions;
    _root: HTMLElement | null;
    _listEl: HTMLElement | null;
    _sessions: SessionPickerSession[];
    _activeSessionId: string | null;
    _disabled: boolean;

    constructor(options: ChatSessionPickerOptions = {}) {
        this.options = options;
        this._root = null;
        this._listEl = null;
        this._sessions = [];
        this._activeSessionId = null;
        this._disabled = false;
    }

    create(): HTMLElement {
        this._listEl = div({ class: "flex flex-col w-full gap-1" }) as HTMLElement;

        this._root = div(
            { class: "flex flex-col gap-2 min-w-0 w-full" },
            this._listEl,
        ) as HTMLElement;

        this.setSessions([], null);
        this.setDisabled(false);
        return this._root;
    }

    setSessions(sessions: SessionPickerSession[], activeSessionId?: string | null): void {
        this._sessions = Array.isArray(sessions) ? [...sessions] : [];
        this._activeSessionId = activeSessionId ?? this._activeSessionId ?? null;
        this._renderList();
    }

    setActiveSession(sessionId: string | null): void {
        this._activeSessionId = sessionId && this._sessions.some((s) => s.id === sessionId) ? sessionId : null;
        this._renderList();
    }

    getActiveSessionId(): string | null {
        return this._activeSessionId;
    }

    setDisabled(disabled: boolean): void {
        this._disabled = !!disabled;
        this._renderList();
    }

    _renderList(): void {
        if (!this._listEl) return;

        this._listEl.innerHTML = "";

        if (!this._sessions.length) {
            this._listEl.appendChild(
                div(
                    { class: "px-3 py-2 text-sm text-base-content/60 italic" },
                    "No sessions yet"
                )
            );
            return;
        }

        for (const session of this._sessions) {
            const isActive = session.id === this._activeSessionId;
            const updated = session.updatedAt ? new Date(session.updatedAt) : null;
            const timestamp = updated && !Number.isNaN(updated.getTime())
                ? `${updated.toLocaleDateString()} ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "";

            const row = div(
                {
                    class: [
                        "flex items-center gap-2 w-full rounded-box border px-2 py-1",
                        isActive
                            ? "bg-base-200 border-base-300"
                            : "bg-base-100 border-base-200 hover:bg-base-200/60",
                        this._disabled ? "opacity-60 pointer-events-none" : "",
                    ].join(" "),
                },
                div(
                    { class: "flex flex-col min-w-0 w-full text-base-content",
                        onclick: () => {
                            if (this._disabled) return;
                            this._activeSessionId = session.id;
                            this._renderList();
                            this.options.onSelect?.(session.id);
                        },
                        ondblclick: () => {
                            if (this._disabled) return;
                            this.options.onRename?.(session.id);
                        },
                        title: session.title || "Untitled chat",},
                    span(
                        { class: `block truncate text-sm text-base-content ${isActive ? "font-semibold" : "font-medium"}` },
                        session.title || "Untitled chat"
                    ),
                    timestamp
                        ? span({ class: "block text-xs text-base-content/60 truncate" }, timestamp)
                        : null
                ),
                button(
                    {
                        type: "button",
                        class: "btn btn-ghost btn-xs btn-square shrink-0 text-base-content/60 hover:text-error",
                        onclick: (e: Event) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (this._disabled) return;
                            this.options.onDelete?.(session.id);
                        },
                        title: "Delete session",
                        "aria-label": `Delete ${session.title || "session"}`,
                    },
                    "✕"
                )
            ) as HTMLElement;

            this._listEl.appendChild(row);
        }
    }
}