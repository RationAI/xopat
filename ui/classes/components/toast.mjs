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

        this._importance = {
            key: "info",
            icon: ICONS.info
        }; // { key, icon }
        this._buttons = [];
        this._onClosed = null;
    }

    /**
     * @param {{html:string, importance?:{class?:string,icon?:string}|{key:string,icon?:string}, durationMs?:number, buttons?:Record<string,Function>|Array<{label:string,onClick?:Function,class?:string}>}} p
     */
    setContent({ html, importance, durationMs, buttons }) {
        if (typeof durationMs === "number") this._durationMs = durationMs;

        if (importance) {
            this._importance = { key: importance.key, icon: importance.icon || ICONS[importance.key] || ICONS.info };
        } else {
            this._importance = {
                key: "info",
                icon: ICONS.info
            };
        }

        this._buttons = normalizeButtons(buttons || []);

        if (!this.root) return;
        const card     = this.root.querySelector("[data-toast-card]");
        const iconEl   = this.root.querySelector("[data-icon]");
        const msgEl    = this.root.querySelector("[data-msg]");
        const btnBar   = this.root.querySelector("[data-buttons]");
        const progress = this.root.querySelector("[data-progress]");
        const accent   = this.root.querySelector("[data-accent]");

        // neutral Primer-like surface (kept constant)
        card.className =
            "relative isolate flex items-center gap-2 " +
            "rounded-md border border-base-300 bg-base-200/95 text-base-content shadow-sm " +
            "pr-3 pl-1 py-2 min-w-[260px] max-w-[520px] w-max";

        // left accent + progress color by importance
        const skin = SKINS[this._importance.key] || SKINS.info;
        accent.className = `absolute left-0 top-0 h-full w-[3px] rounded-l-xl ${skin.accent}`;
        progress.className = `pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 ${skin.progress} animate-toastbar`;

        // icon + message
        iconEl.innerHTML = this._importance.icon || ICONS.info;
        msgEl.innerHTML = html ?? "";

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
        if (this._hideTimeout) {
            clearTimeout(this._hideTimeout);
            this._hideTimeout = null;
        }
        this.root.classList.remove("hidden", "opacity-0");
        this.root.classList.add("flex", "opacity-100");

        // restart progress anim
        const bar = this.root.querySelector("[data-progress]");
        bar?.classList.remove("animate-toastbar");
        void bar?.offsetWidth; // reflow
        bar?.classList.add("animate-toastbar");
    }

    hide() {
        if (!this.root) return;
        this.root.classList.add("opacity-0");
        this.root.classList.remove("opacity-100");
        this._hideTimeout = setTimeout(() => {
            this.root.classList.add("hidden");
            this.root.classList.remove("flex");
            this._hideTimeout = null;
        }, 150);
    }
    
    setOnUserClose(callback) {
        this._onClosed = callback;
    }

    isHidden() {
        return !this.root || this.root.classList.contains("hidden");
    }

    create() {
        // bottom-centered container (like original)
        this.root = div(
            {
                id: this.id,
                class:
                    "hidden opacity-0 transition-opacity duration-150 " +
                    "fixed left-1/2 bottom-4 -translate-x-1/2 z-[5050] " +
                    "toast toast-bottom toast-center"
            },
            // single toast (can be extended to stack)
            div(
                { "data-toast-card": "", class: "relative" },
                // left accent bar
                div({ "data-accent": "", class: "absolute left-0 top-0 h-full w-[3px] rounded-l-md bg-info" }),
                // content row
                div({ class: "flex items-center gap-2 pl-[10px] w-full" }, // 10px so accent + border feel like original
                    div({ "data-icon": "", class: "shrink-0 text-base-content/80 pl-2" }),
                    span({ "data-msg": "", class: "text-[13px] leading-snug whitespace-normal break-words" }),
                    div({ "data-buttons": "", class: "ml-1 inline-flex gap-1" }),
                    button(
                        {
                            type: "button",
                            class: "btn btn-ghost btn-xs h-6 w-6 min-h-0 p-0 ml-1 text-base-content/70 hover:text-base-content",
                            onclick: () => {
                                this.hide()
                                this._onClosed && this._onClosed();
                            },
                            "aria-label": "Close"
                        },
                        span({ innerHTML: ICONS.close })
                    )
                ),
                // bottom progress
                div({ "data-progress": "", class: "pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 bg-info/70 animate-toastbar" })
            )
        );
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
     *
     * @param {Toast|undefined} view
     */
    constructor(view) {
        if (view) this.mount(view)
    }

    /**
     * @param {Toast} view
     */
    mount(view) {
        this._view = view;
        this._queue = [];
        this._timer = null;
        this._opts  = null;
        this._locked = false;
        this._current = null;
        view.setOnUserClose(() => {
            this._hideImpl(false, false);
        });
    }

    /**
     * Add/show a toast.
     * @param {string} text
     * @param {number} [delayMS=5000]
     * @param {object} [importance=Toast.MSG_INFO]
     * @param {object} [props={}]  { queued=true, buttons, onShow, onHide }
     */
    show(text, delayMS, importance, props = {}) {
        if (this._locked) return false;

        const queued = props.queued !== false; // default true
        const job = { text, delayMS, importance, props };

        // Nothing showing -> display immediately
        if (!this._timer && (!this._view || this._view.isHidden())) {
            this._showImpl(text, delayMS, importance, props);
            return true;
        }

        // If we're showing something and queuing is allowed, consider preemption
        if (queued) {
            if (this._current && LEVELS[importance.key] > LEVELS[this._current.importance.key]) {
                // Preempt: push current back, then show the more important one
                this._requeue(this._current);  // put interrupted item back
                this._hideImpl(/*timeoutCleaned*/true, /*callOnHide*/false); // cancel timer, don't call onHide
                this._showImpl(text, delayMS, importance, props);
            } else {
                // Normal enqueue
                this._requeue(job);
            }
            return true;
        }

        // Not queued and something is up: try preempt; else ignore
        if (this._current && LEVELS[importance.key] > LEVELS[this._current.importance.key]) {
            this._requeue(this._current);
            this._hideImpl(true, false);
            this._showImpl(text, delayMS, importance, props);
            return true;
        }
        return false; // ignored
    }

    /**
     * Hide the current toast.
     * @param {boolean} [withCallback=true]
     */
    hide(withCallback = true) {
        this._hideImpl(false, withCallback);
    }

    /**
     * Await until queue is empty, no timer is running and the view is hidden.
     * @returns {Promise<void>}
     */
    async awaitHidden() {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const idle = this._queue.length === 0 &&
                    this._timer === null &&
                    (!this._view || this._view.isHidden());
                if (idle) {
                    clearInterval(interval);
                    resolve();
                }
            }, 250);
        });
    }

    /**
     * Prevent accepting any new toast jobs.
     */
    lock() { this._locked = true; }

    /**
     * Allow accepting new toast jobs again.
     */
    unlock() { this._locked = false; }

    /**
     * Are we locked?
     */
    isLocked() { return this._locked; }

    /**
     * Clear the queue (doesn't touch the currently displayed toast).
     */
    clearQueue() { this._queue.length = 0; }

    // -------------------- internals --------------------

    _hideImpl(timeoutCleaned, callOnHide = true) {
        if (this._view) this._view.hide();

        if (!timeoutCleaned && this._timer) {
            clearTimeout(this._timer);
            if (callOnHide && this._opts?.onHide) {
                try { this._opts.onHide(); } catch {}
            }
        }
        // Reset current
        this._timer = null;
        this._opts = null;
        this._current = null;

        // Next job: pick the highest-importance, FIFO within same importance
        const next = this._dequeue();
        if (next) {
            this._showImpl(next.text, next.delayMS, next.importance, next.props);
        }
    }

    _showImpl(text, delayMS, importance, opts) {
        this._current = { text, delayMS, importance, props: opts };
        this._ensureView();

        this._view.setContent({
            html: text,
            importance,
            durationMs: delayMS,
            buttons: opts?.buttons,
        });
        this._view.show();

        if (delayMS >= 1000) {
            if (this._timer) clearTimeout(this._timer);
            this._timer = setTimeout(() => this._hideImpl(true), delayMS);
        } else {
            this._timer = null; // no auto-hide
        }

        this._opts = opts || null;
        if (this._opts?.onShow) {
            try { this._opts.onShow(); } catch {}
        }
    }

    _ensureView() {
        if (!this._view || typeof this._view.setContent !== 'function') {
            throw new Error('Toast: view is not initialized or invalid.');
        }
    }

    // Insert into queue so that higher importance comes first, FIFO within same importance
    _requeue(job) {
        if (!job) return;
        if (this._queue.length === 0) {
            this._queue.push(job);
            return;
        }
        // Find insertion index: before first item with lower importance
        let i = 0;

        while (i < this._queue.length && LEVELS[this._queue[i].importance.key] >= LEVELS[job.importance.key]) i++;
        this._queue.splice(i, 0, job);
    }

    _dequeue() {
        return this._queue.shift() || null;
    }
}


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
