const { div, button, span } = (globalThis as any).van.tags;

export type SessionPickerSession = Pick<ChatSession, "id" | "title" | "updatedAt"> & { summary?: string };

export interface ChatSessionPickerOptions {
    onSelect?: (sessionId: string | null) => void;
    onRename?: (sessionId: string | null) => void;
    onDelete?: (sessionId: string | null) => void;
}

/** Day buckets, coarsest last — a chat history reads by recency, not by date stamp. */
type SessionGroupKey = "today" | "yesterday" | "previous7Days" | "older";

const GROUP_LABEL_KEYS: Record<SessionGroupKey, string> = {
    today: "chat.groupToday",
    yesterday: "chat.groupYesterday",
    previous7Days: "chat.groupPrevious7Days",
    older: "chat.groupOlder",
};

export class ChatSessionPicker {
    options: ChatSessionPickerOptions;
    _root: HTMLElement | null;
    _listEl: HTMLElement | null;
    _sessions: SessionPickerSession[];
    _activeSessionId: string | null;
    _disabled: boolean;
    _loading: boolean;
    /** The session being hydrated right now — its row carries the spinner. */
    _busySessionId: string | null;
    /** Local, case-insensitive filter over title + summary. */
    _query: string;
    /** How many rows the last render produced — the panel reports it as "N of M". */
    _visibleCount: number;

    constructor(options: ChatSessionPickerOptions = {}) {
        this.options = options;
        this._root = null;
        this._listEl = null;
        this._sessions = [];
        this._activeSessionId = null;
        this._disabled = false;
        this._loading = false;
        this._busySessionId = null;
        this._query = "";
        this._visibleCount = 0;
    }

    create(): HTMLElement {
        this._listEl = div({
            class: "flex flex-col w-full gap-1",
            role: "listbox",
            "aria-label": $.t('chat.sessions'),
        }) as HTMLElement;

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

    /** Sessions are still being fetched — an empty list means "not known yet", not "none exist". */
    setLoading(loading: boolean): void {
        this._loading = !!loading;
        this._renderList();
    }

    /** Marks one row as being opened, so the click has a visible effect while hydration runs. */
    setBusySession(sessionId: string | null): void {
        const next = sessionId || null;
        if (next === this._busySessionId) return;
        this._busySessionId = next;
        this._renderList();
    }

    setQuery(query: string): void {
        const next = String(query || "").trim().toLowerCase();
        if (next === this._query) return;
        this._query = next;
        this._renderList();
    }

    getVisibleCount(): number {
        return this._visibleCount;
    }

    _matches(session: SessionPickerSession): boolean {
        if (!this._query) return true;
        const haystack = `${session.title || ""} ${session.summary || ""}`.toLowerCase();
        return haystack.includes(this._query);
    }

    _updatedAt(session: SessionPickerSession): Date | null {
        const parsed = session.updatedAt ? new Date(session.updatedAt) : null;
        return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }

    _groupOf(date: Date | null): SessionGroupKey {
        if (!date) return "older";
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        // Measured against today's midnight, so the buckets are calendar days, not 24h windows.
        const days = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000);
        if (days < 0) return "today";        // after midnight today (or a stamp in the future)
        if (days === 0) return "yesterday";  // within the day before midnight
        return days < 7 ? "previous7Days" : "older";
    }

    /**
     * "2 h ago" instead of a raw stamp — a session list is read by recency. `Intl` carries the
     * wording per language, so nothing here needs a locale key; the absolute time stays on the
     * element's tooltip for when the exact moment matters.
     */
    _relativeTime(date: Date): string {
        const seconds = Math.round((date.getTime() - Date.now()) / 1000);
        const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
            ["year", 31_536_000], ["month", 2_592_000], ["week", 604_800],
            ["day", 86_400], ["hour", 3600], ["minute", 60],
        ];
        try {
            const fmt = new Intl.RelativeTimeFormat((globalThis as any).$?.i18n?.language || undefined, { numeric: "auto" });
            for (const [unit, size] of units) {
                if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
            }
            return fmt.format(seconds, "second");   // numeric:"auto" renders 0 as "now"
        } catch {
            return date.toLocaleString();
        }
    }

    _actionButton(iconName: string, label: string, hoverClass: string, onClick: () => void): HTMLElement {
        return button(
            {
                type: "button",
                class: "btn btn-ghost btn-xs btn-square shrink-0 text-base-content/60 "
                    + `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ${hoverClass}`,
                title: label,
                "aria-label": label,
                onclick: (e: Event) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this._disabled) return;
                    onClick();
                },
            },
            span({ class: `ph-light ${iconName}` })
        ) as HTMLElement;
    }

    /** Roving focus across rows, so the list is usable without a pointer. */
    _moveFocus(from: HTMLElement, delta: number): void {
        const rows = Array.from(this._listEl?.querySelectorAll<HTMLElement>('[role="option"]') || []);
        const index = rows.indexOf(from);
        const next = rows[index + delta];
        next?.focus();
    }

    _renderList(): void {
        if (!this._listEl) return;

        this._listEl.innerHTML = "";

        const visible = this._sessions.filter((s) => this._matches(s));
        this._visibleCount = visible.length;

        if (!visible.length) {
            const message = this._loading
                ? $.t('chat.loadingSessions')
                : (this._query && this._sessions.length ? $.t('chat.noSessionsMatch') : $.t('chat.noSessionsYet'));
            this._listEl.appendChild(
                div({ class: "px-3 py-2 text-sm text-base-content/60 italic" }, message)
            );
            return;
        }

        // A refresh over an already-populated list used to be completely silent.
        if (this._loading) {
            this._listEl.appendChild(
                div(
                    { class: "flex items-center gap-2 px-3 py-1 text-xs text-base-content/60 italic" },
                    span({ class: "loading loading-spinner loading-xs shrink-0" }),
                    span($.t('chat.refreshingSessions')),
                )
            );
        }

        let currentGroup: SessionGroupKey | null = null;

        for (const session of visible) {
            const isActive = session.id === this._activeSessionId;
            const isBusy = session.id === this._busySessionId;
            const updated = this._updatedAt(session);
            const title = session.title || $.t('chat.untitledChat');

            // Sessions arrive newest-first, so a group header is due whenever the bucket changes.
            const group = this._groupOf(updated);
            if (group !== currentGroup) {
                currentGroup = group;
                this._listEl.appendChild(
                    div(
                        { class: "px-1 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-base-content/50" },
                        $.t(GROUP_LABEL_KEYS[group])
                    )
                );
            }

            const row = div(
                {
                    class: [
                        "group flex items-center gap-2 w-full rounded-box border px-2 py-1 cursor-pointer",
                        isActive
                            ? "bg-base-200 border-base-300"
                            : "bg-base-100 border-base-200 hover:bg-base-200/60",
                        this._disabled || isBusy ? "opacity-60 pointer-events-none" : "",
                    ].join(" "),
                    role: "option",
                    tabindex: 0,
                    "aria-selected": isActive ? "true" : "false",
                    title,
                    onclick: () => {
                        if (this._disabled) return;
                        this._activeSessionId = session.id;
                        this._renderList();
                        this.options.onSelect?.(session.id);
                    },
                    onkeydown: (e: KeyboardEvent) => {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            this._moveFocus(e.currentTarget as HTMLElement, e.key === "ArrowDown" ? 1 : -1);
                            return;
                        }
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        if (this._disabled) return;
                        this._activeSessionId = session.id;
                        this._renderList();
                        this.options.onSelect?.(session.id);
                    },
                },
                isBusy
                    ? span({ class: "loading loading-spinner loading-xs shrink-0" })
                    : null,
                div(
                    { class: "flex flex-col min-w-0 flex-1 text-base-content" },
                    span(
                        { class: `block truncate text-sm text-base-content ${isActive ? "font-semibold" : "font-medium"}` },
                        title
                    ),
                    updated
                        ? span(
                            { class: "block text-xs text-base-content/60 truncate", title: updated.toLocaleString() },
                            this._relativeTime(updated)
                        )
                        : null
                ),
                this.options.onRename
                    ? this._actionButton("ph-pencil-simple", $.t('chat.renameSessionNamed', { name: title }),
                        "hover:text-base-content", () => this.options.onRename?.(session.id))
                    : null,
                this.options.onDelete
                    ? this._actionButton("ph-trash", $.t('chat.deleteSessionNamed', { name: title }),
                        "hover:text-error", () => this.options.onDelete?.(session.id))
                    : null,
            ) as HTMLElement;

            this._listEl.appendChild(row);
        }
    }
}
