import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";

const { div, span, button } = van.tags;

const ICONS = {
    info:    '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/></svg>',
    success: '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/></svg>',
    warn:    '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" /></svg>',
    error:   '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" /></svg>',
    close:   '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 5.3 10 9l3.7-3.7 1.4 1.4L11.4 10l3.7 3.7-1.4 1.4L10 11.4l-3.7 3.7-1.4-1.4L8.6 10 4.9 6.7l1.4-1.4Z"/></svg>'
};

// we keep neutral bg/border; only the thin accent bar & progress color change
const SKINS = {
    info:    { accent: "bg-info",    progress: "bg-info/70"    },
    success: { accent: "bg-success", progress: "bg-success/70" },
    warning: { accent: "bg-warning", progress: "bg-warning/70" },
    error:   { accent: "bg-error",   progress: "bg-error/70"   }
};

// importance levels - skipping
const LEVELS = {
    info:    0,
    success: 1,
    warning: 2,
    error:   3
}

export class Toast extends BaseComponent {
    constructor() {
        super({ id: "dialogs-container" });
        this._durationMs = 5000;
        this._importance = { key: "info", icon: ICONS.info };
        this._buttons = [];
        this._onClosed = null;
        this._onPendingClick = null;
        this._hideT = null;
    }

    /**
     * Scheduler can hook this so user can cycle pending toasts.
     * @param {Function} cb
     */
    setOnPendingClick(cb) {
        this._onPendingClick = cb;
    }

    /**
     * @param {{
     *  html:string,
     *  importance?:{key:string,icon?:string},
     *  durationMs?:number,
     *  buttons?:Record<string,Function>|Array<{label:string,onClick?:Function,class?:string}>,
     *  count?:number,
     *  pending?:number
     * }} p
     */
    setContent({ html, importance, durationMs, buttons, count = 1, pending = 0 }) {
        if (typeof durationMs === "number") this._durationMs = durationMs;

        if (importance) {
            this._importance = { key: importance.key, icon: importance.icon || ICONS[importance.key] || ICONS.info };
        } else {
            this._importance = { key: "info", icon: ICONS.info };
        }

        this._buttons = normalizeButtons(buttons || []);

        if (!this.root) return;
        const card     = this.root.querySelector("[data-toast-card]");
        const iconEl   = this.root.querySelector("[data-icon]");
        const msgEl    = this.root.querySelector("[data-msg]");
        const btnBar   = this.root.querySelector("[data-buttons]");
        const progress = this.root.querySelector("[data-progress]");
        const accent   = this.root.querySelector("[data-accent]");
        const countEl  = this.root.querySelector("[data-count]");
        const pendEl   = this.root.querySelector("[data-pending]");

        card.className =
            "relative isolate flex items-center gap-2 " +
            "rounded-md border border-base-300 bg-base-200/95 text-base-content shadow-sm " +
            "px-3 py-2 " +
            "min-w-[320px] w-[min(520px,calc(100vw-2rem))]";

        const skin = SKINS[this._importance.key] || SKINS.info;
        accent.className = `absolute left-0 top-0 h-full w-[3px] rounded-l-xl ${skin.accent}`;

        // FIX: Reset progress bar animation to ensure it restarts from 0%
        progress.style.animation = 'none';
        void progress.offsetWidth; // Force reflow
        progress.style.animation = null;
        progress.className = `pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 ${skin.progress} animate-toastbar`;
        progress.style.animationDuration = `${this._durationMs}ms`;

        iconEl.innerHTML = this._importance.icon || ICONS.info;
        msgEl.innerHTML = html ?? "";

        // count badge for duplicates
        if (countEl) {
            const c = Math.max(1, Number(count) || 1);
            countEl.textContent = c > 1 ? `×${c}` : "";
            countEl.className =
                c > 1
                    ? "badge badge-ghost badge-sm ml-1 text-[11px]"
                    : "hidden";
            if (c > 1) countEl.classList.remove("hidden");
        }

        // pending badge for “many dialogs”
        if (pendEl) {
            const p = Math.max(0, Number(pending) || 0);
            if (p > 0) {
                pendEl.textContent = `+${p}`;
                pendEl.className = "badge badge-neutral badge-sm cursor-pointer select-none";
                pendEl.classList.remove("hidden");
            } else {
                pendEl.textContent = "";
                pendEl.className = "hidden";
            }
        }

        // buttons
        btnBar.innerHTML = "";
        for (const b of this._buttons) {
            const el = document.createElement("button");
            el.type = "button";
            el.className = `btn btn-ghost btn-xs h-6 min-h-0 ${b.class || ""}`;
            el.textContent = b.label;
            el.addEventListener("click", (ev) => b.onClick?.(ev, window.Dialogs));
            btnBar.appendChild(el);
        }

        // progress timing
        progress.style.animationDuration = `${this._durationMs}ms`;
    }

    show() {
        if (!this.root) return;

        if (this._hideT) {
            clearTimeout(this._hideT);
            this._hideT = null;
        }

        this.root.classList.remove("hidden");
        // force layout so transition runs
        void this.root.offsetWidth;
        this.root.classList.remove("opacity-0");
        this.root.classList.add("opacity-100");
    }

    hide() {
        if (!this.root) return;
        this.root.classList.remove("opacity-100");
        this.root.classList.add("opacity-0");

        const ms = 150;
        clearTimeout(this._hideT);
        this._hideT = setTimeout(() => {
            this.root.classList.add("hidden");
            this._hideT = null;
        }, 150);
    }

    setOnUserClose(callback) {
        this._onClosed = callback;
    }

    isHidden() {
        return !this.root || this.root.classList.contains("hidden");
    }

    create() {
        this.root = div(
            {
                id: this.id,
                class:
                    "hidden opacity-0 transition-opacity duration-150 " +
                    "fixed left-1/2 bottom-4 -translate-x-1/2 z-[5050] " +
                    "toast toast-bottom toast-center"
            },
            div(
                { "data-toast-card": "", class: "relative" },
                div({ "data-accent": "", class: "absolute left-0 top-0 h-full w-[3px] rounded-l-md bg-info" }),

                div(
                    { class: "flex items-center gap-2 pl-[10px] w-full" },

                    div({ class: "shrink-0 flex items-center gap-1 pl-2 text-base-content/80" },
                        div({ "data-icon": "", class: "shrink-0" }),
                        // duplicate counter
                        span({ "data-count": "", class: "hidden" })
                    ),

                    // message expands, keeps layout stable
                    span({ "data-msg": "", class: "flex-1 text-[13px] leading-snug whitespace-normal break-words" }),

                    // pending indicator (click to cycle next)
                    button(
                        {
                            type: "button",
                            class: "hidden",
                            "data-pending": "",
                            onclick: () => this._onPendingClick && this._onPendingClick(),
                            "aria-label": "Show next notification"
                        },
                        ""
                    ),

                    div({ "data-buttons": "", class: "ml-1 inline-flex gap-1" }),

                    button(
                        {
                            type: "button",
                            class: "btn btn-ghost btn-xs h-6 w-6 min-h-0 p-0 ml-1 text-base-content/70 hover:text-base-content",
                            onclick: () => {
                                this.hide();
                                this._onClosed && this._onClosed();
                            },
                            "aria-label": "Close"
                        },
                        span({ innerHTML: ICONS.close })
                    )
                ),

                div({ "data-progress": "", class: "pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 bg-info/70 animate-toastbar" })
            )
        );

        this.root.addEventListener("mouseenter", () => this._onHover?.(true));
        this.root.addEventListener("mouseleave", () => this._onHover?.(false));
        return this.root;
    }
}

Toast.MSG_INFO = { key: "info", icon: ICONS.info };
Toast.MSG_SUCCESS = { key: "success", icon: ICONS.success };
Toast.MSG_WARN = { key: "warning", icon: ICONS.warn };
Toast.MSG_ERROR = { key: "error", icon: ICONS.error };

/**
 * Minimal view contract expected:
 *  - setContent({ html, importance, durationMs, buttons })
 *  - show()
 *  - hide()
 *  - isHidden(): boolean
 */
Toast.Scheduler = class {
    /**
     * @param {Toast|undefined} view
     */
    constructor(view) {
        if (view) this.mount(view);
    }

    /**
     * @param {Toast} view
     */
    mount(view) {
        this._view = view;

        /** @type {Array<any>} */
        this._queue = [];

        /** @type {Map<string, any>} */
        this._groups = new Map();

        this._timer = null;
        this._opts = null;
        this._locked = false;

        /** @type {null|any} */
        this._current = null;

        this._deadline = 0;
        this._remaining = 0;
        this._paused = false;

        view.setOnUserClose(() => {
            this._hideImpl(false, false);
        });

        view.setOnPendingClick(() => {
            // cycle immediately to next pending toast
            if (this._queue.length > 0) {
                this._hideImpl(true, false);
            }
        });
    }

    /**
     * Add/show a toast.
     * @param {string} text HTML allowed
     * @param {number} [delayMS=5000]
     * @param {object} [importance=Toast.MSG_INFO]
     * @param {object} [props={}] { queued=true, mode='default'|'replace', buttons, onShow, onHide }
     */
    show(text, delayMS = 5000, importance = Toast.MSG_INFO, props = {}) {
        if (this._locked) return false;

        const mode = props?.mode || "default";
        const jobKey = this._makeKey(text, importance, props);
        const now = Date.now();

        if (mode === "replace") {
            const job = {
                key: jobKey, text, delayMS, importance, props,
                count: 1, createdAt: now, lastAt: now,
            };
            this._hideImpl(true, false, true); // Use 'immediate' flag to avoid blink
            this._showJob(job);
            return true;
        }

        const queued = props.queued !== false;

        // SCENARIO A: Update currently visible toast
        if (this._current && this._current.key === jobKey) {
            this._current.count = (this._current.count || 1) + 1;
            this._current.lastAt = now;

            // FIX: The badge needs the most current queue length
            this._renderCurrent();

            // FIX: Timer "Soft Bump"
            // Instead of resetting to 5s, we just ensure it has at least 3s left.
            const remaining = this._deadline - Date.now();
            if (remaining < 2500) {
                this._restartTimer(3000);
            }
            return true;
        }

        // SCENARIO B: Update a job already waiting in the queue
        const existing = this._groups.get(jobKey);
        if (existing && existing !== this._current) {
            existing.count = (existing.count || 1) + 1;
            existing.lastAt = now;
            // No need to requeue/move; keeping FIFO within importance is usually better for stability
            this._renderCurrent();
            return true;
        }

        // SCENARIO C: New Job
        const job = { key: jobKey, text, delayMS, importance, props, count: 1, createdAt: now, lastAt: now };

        if (!this._timer && (!this._view || this._view.isHidden())) {
            this._showJob(job);
            return true;
        }

        if (queued) {
            if (this._current && LEVELS[importance.key] > LEVELS[this._current.importance.key]) {
                this._requeue(this._current);
                this._hideImpl(true, false, true); // Immediate swap for higher importance
                this._showJob(job);
            } else {
                this._requeue(job);
                this._renderCurrent();
            }
            return true;
        }

        return false;
    }

    setHoverHandlers(onEnter, onLeave) {
        this._onHover = (isEnter) => (isEnter ? onEnter?.() : onLeave?.());
    }

    hide(withCallback = true) {
        this._hideImpl(false, withCallback);
    }

    pause() {
        if (!this._timer || this._paused) return;
        clearTimeout(this._timer);
        this._timer = null;
        this._remaining = Math.max(0, this._deadline - Date.now());
        this._paused = true;
    }

    resume() {
        if (!this._paused) return;
        this._paused = false;
        if (this._remaining > 0) {
            this._deadline = Date.now() + this._remaining;
            this._timer = setTimeout(() => this._hideImpl(true), this._remaining);
        }
    }

    async awaitHidden() {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const idle =
                    this._queue.length === 0 &&
                    this._timer === null &&
                    (!this._view || this._view.isHidden());
                if (idle) {
                    clearInterval(interval);
                    resolve();
                }
            }, 250);
        });
    }

    lock() { this._locked = true; }
    unlock() { this._locked = false; }
    isLocked() { return this._locked; }

    clearQueue() {
        for (const j of this._queue) this._groups.delete(j.key);
        this._queue.length = 0;
        this._renderCurrent();
    }

    // ---------------- internals ----------------

    _makeKey(text, importance, props) {
        // normalize just enough to group “same message”
        const msg = String(text ?? "").trim().replace(/\s+/g, " ");
        const imp = importance?.key || "info";

        // include buttons in the signature so “same text but different actions” doesn't merge incorrectly
        const btnSig = JSON.stringify(normalizeButtons(props?.buttons || []).map(b => ({
            label: b.label,
            class: b.class || ""
        })));

        return `${imp}::${msg}::${btnSig}`;
    }

    _removeFromQueue(job) {
        const idx = this._queue.indexOf(job);
        if (idx >= 0) this._queue.splice(idx, 1);
    }

    _restartTimer(delayMS) {
        if (this._timer) clearTimeout(this._timer);
        this._remaining = delayMS;
        this._deadline = Date.now() + delayMS;
        this._timer = setTimeout(() => this._hideImpl(true), delayMS);
    }

    _renderCurrent() {
        if (!this._view || !this._current) return;
        this._view.setContent({
            html: this._current.text,
            importance: this._current.importance,
            durationMs: this._current.delayMS,
            buttons: this._current.props?.buttons,
            count: this._current.count || 1,
            pending: this._queue.length
        });
    }

    _showJob(job) {
        this._ensureView();
        this._current = job;
        this._opts = job.props || null;

        this._groups.delete(job.key);
        this._removeFromQueue(job);

        this._renderCurrent(); // Use the helper to keep logic DRY
        this._view.show();

        if (job.delayMS >= 1000) {
            this._restartTimer(job.delayMS);
        } else {
            this._timer = null;
        }

        if (this._opts?.onShow) {
            try { this._opts.onShow(); } catch {}
        }
    }

    /**
     * @param {boolean} timeoutCleaned
     * @param {boolean} callOnHide
     * @param {boolean} immediate - New flag to skip animation for rapid swaps
     */
    _hideImpl(timeoutCleaned, callOnHide = true, immediate = false) {
        if (this._view) {
            if (immediate) {
                // Instantly hide to prevent animation overlap during preemption
                this._view.root.classList.add("hidden");
                this._view.root.classList.replace("opacity-100", "opacity-0");
            } else {
                this._view.hide();
            }
        }

        if (!timeoutCleaned && this._timer) {
            clearTimeout(this._timer);
            if (callOnHide && this._opts?.onHide) {
                try { this._opts.onHide(); } catch {}
            }
        }

        this._timer = null;
        this._opts = null;
        this._current = null;

        const next = this._dequeue();
        if (next) {
            // When showing the next item from the queue,
            // the view.show() will handle the fade-in.
            this._showJob(next);
        }
    }

    _ensureView() {
        if (!this._view || typeof this._view.setContent !== "function") {
            throw new Error("Toast: view is not initialized or invalid.");
        }
    }

    // Higher importance first; FIFO within same importance.
    _requeue(job) {
        if (!job) return;

        // store as a group for dedupe lookups
        this._groups.set(job.key, job);

        if (this._queue.length === 0) {
            this._queue.push(job);
            return;
        }

        let i = 0;
        while (i < this._queue.length && LEVELS[this._queue[i].importance.key] >= LEVELS[job.importance.key]) i++;
        this._queue.splice(i, 0, job);
    }

    _dequeue() {
        const j = this._queue.shift() || null;
        if (j) this._groups.delete(j.key);
        return j;
    }
};


function normalizeButtons(buttons) {
    if (Array.isArray(buttons)) {
        return buttons.filter(Boolean).map(b => ({
            label: String(b.label ?? ""),
            onClick: b.onClick,
            class: b.class
        })).filter(b => b.label);
    }
    if (buttons && typeof buttons === "object") {
        return Object.entries(buttons).map(([label, onClick]) => ({
            label: String(label),
            onClick: typeof onClick === "function" ? onClick : undefined
        }));
    }
    return [];
}
