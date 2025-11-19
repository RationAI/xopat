/**
 * @typedef {Object} FloatingToken A unique token object returned by register().
 */

/**
 * @typedef {Object} FloatingEntry
 * @property {WeakRef<HTMLElement>} elRef
 * @property {WeakRef<any>=} ownerRef
 * @property {string|function=} onOutsideClick  // method name on owner OR a function
 * @property {string|function=} onEscape        // method name on owner OR a function
 * @property {number} z
 */

export class FloatingManager {
    constructor() {
        this._byToken = new WeakMap();     // token -> entry
        this._tokens = new Set();          // strong refs to tokens only
        this._zTop = 1000;

        document.addEventListener("mousedown", (e) => { this._sweep(); this._handleOutside(e); }, true);
        VIEWER_MANAGER.broadcastHandler("canvas-press",  (e) => {
            this._sweep();
            this._handleOutside(e.originalEvent);
        });
        VIEWER_MANAGER.addHandler("key-up",   (e) => { this._sweep(); this._handleKey(e); }, true);
        window.addEventListener("resize", () => { this._sweep(); this._clampAll(); });
        window.addEventListener("scroll", () => { this._sweep(); this._clampAll(); }, { passive: true });

        this._finalize = typeof FinalizationRegistry === "function"
            ? new FinalizationRegistry((token) => this.unregister(token))
            : null;

        // --- add state ---
        this._drag = null;   // { token, offX, offY }
        this._rsz  = null;   // { token, startX, startY, startW, startH, minW, minH }

        // global pointer handlers (one-time in constructor)
        document.addEventListener("pointermove", (e) => this._onPointerMove(e), { passive: false });
        document.addEventListener("pointerup",   ()  => this._onPointerUp());
    }

    /**
     * @typedef {Object} ClampOptions
     * @property {number} [margin=6]         // viewport padding in px
     * @property {string} [topBarId]         // e.g., "top-side"; pushes below this bar
     * @property {{leftKey?:string, topKey?:string}} [cache] // AppCache keys to avoid moving "before" remembered left/top
     */

    /**
     * @typedef {Object} FloatingToken
     */

    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.el
     * @param {any=} opts.owner
     * @param {string|function=} opts.onOutsideClick
     * @param {string|function=} opts.onEscape
     * @param {ClampOptions=} opts.clamp
     * @returns {FloatingToken}
     */
    register({ el, owner, onOutsideClick, onEscape, clamp }) {
        const token = {};
        this._tokens.add(token);

        const entry = {
            elRef: new WeakRef(el),
            ownerRef: owner ? new WeakRef(owner) : undefined,
            onOutsideClick, onEscape,
            z: ++this._zTop,
            clamp: this._normClamp(clamp),
        };
        el.style.zIndex = String(entry.z);

        this._byToken.set(token, entry);
        if (this._finalize) this._finalize.register(el, token);

        // NEW: initialize position from cache if provided
        if (entry.clamp?.cache) {
            const { leftKey, topKey } = entry.clamp.cache;
            const l = leftKey ? parseInt(APPLICATION_CONTEXT.AppCache.get(leftKey), 10) : NaN;
            const t =  topKey ? parseInt(APPLICATION_CONTEXT.AppCache.get(topKey), 10)  : NaN;
            if (!Number.isNaN(l)) el.style.left = `${l}px`;
            if (!Number.isNaN(t)) el.style.top  = `${t}px`;
        }

        // first clamp (viewport only)
        this.clampNow(token);

        return token;
    }


    /** Update clamp options later if needed. */
    updateClamp(token, clampOptions) {
        const e = this._byToken.get(token); if (!e) return;
        e.clamp = this._normClamp(clampOptions);
        this.clampNow(token);
    }

    /** Manually bring to front. */
    bringToFront(token) {
        const e = this._byToken.get(token); if (!e) return;
        const el = e.elRef.deref(); if (!el) return;
        el.style.zIndex = String(e.z = ++this._zTop);
    }

    /** Manual unregistration. Safe to call multiple times. */
    unregister(token) {
        if (!this._tokens.has(token)) return;
        this._byToken.delete(token);
        this._tokens.delete(token);
    }

    /** Clamp a single entry now. */
    clampNow(token) {
        const e = this._byToken.get(token);
        if (!e || !e.clamp) return;
        const el = e.elRef.deref(); if (!el) return;

        // ensure fixed positioning so left/top are viewport relative
        if (getComputedStyle(el).position !== "fixed") el.style.position = "fixed";

        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const margin = e.clamp.margin;

        let left = rect.left;
        let top  = rect.top;

        // keep inside viewport with margin
        const maxLeft = vw - rect.width  - margin;
        const maxTop  = vh - rect.height - margin;
        left = Math.min(Math.max(margin, left), Math.max(margin, maxLeft));
        top  = Math.min(Math.max(margin, top),  Math.max(margin, maxTop));

        // respect top bar (if any)
        if (e.clamp.topBarEl) {
            const h = e.clamp.topBarEl.offsetHeight || 0;
            if (top < h + margin) top = h + margin;
        }

        el.style.left = `${Math.round(left)}px`;
        el.style.top  = `${Math.round(top)}px`;
    }


    /**
     * @param {FloatingToken} token from register()
     * @param {Object} opts
     * @param {HTMLElement|string} opts.handle   element or selector inside el
     * @param {{leftKey?:string, topKey?:string}=} opts.persist
     * @param {(el:HTMLElement, rect:DOMRect)=>void} [opts.onMove]  // <- NEW
     */
    enableDrag(token, opts) {
        const entry = this._byToken.get(token); if (!entry) return;
        const el = entry.elRef.deref(); if (!el) return;
        const handle = typeof opts.handle === "string" ? el.querySelector(opts.handle) : opts.handle;
        if (!handle) return;

        // remember for pointermove
        entry.dragOnMove = typeof opts.onMove === "function" ? opts.onMove : null;   // <- NEW

        const onDown = (e) => {
            if (e.button != null && e.button !== 0) return;

            // don't start drag if click is on, or inside, a "no-drag" element
            if (e.target && e.target.closest?.("[data-no-drag]")) return;

            const rect = el.getBoundingClientRect();
            const x = e.clientX, y = e.clientY;
            this._drag = {
                token,
                offX: x - rect.left,
                offY: y - rect.top,
                persist: opts.persist || null
            };
            this.bringToFront(token);
            handle.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        };

        handle.addEventListener("pointerdown", onDown);
        entry.dragRef = new WeakRef(handle);
    }

    /**
     * @param {FloatingToken} token
     * @param {Object} opts
     * @param {HTMLElement|string} opts.handle
     * @param {number} [opts.minW=220]
     * @param {number} [opts.minH=140]
     * @param {{widthKey?:string, heightKey?:string}=} opts.persist
     */
    enableResize(token, opts) {
        const entry = this._byToken.get(token); if (!entry) return;
        const el = entry.elRef.deref(); if (!el) return;
        const handle = typeof opts.handle === "string" ? el.querySelector(opts.handle) : opts.handle;
        if (!handle) return;

        const minW = Number.isFinite(opts.minW) ? opts.minW : 220;
        const minH = Number.isFinite(opts.minH) ? opts.minH : 140;

        const onDown = (e) => {
            const r = el.getBoundingClientRect();
            this._rsz = {
                token, startX: e.clientX, startY: e.clientY,
                startW: r.width, startH: r.height,
                minW, minH, persist: opts.persist || null
            };
            this.bringToFront(token);
            e.preventDefault();
            e.stopPropagation();
        };

        handle.addEventListener("pointerdown", onDown);
        entry.resizeRef = new WeakRef(handle);
    }

    _onPointerMove(e) {
        // dragging
        if (this._drag) {
            const entry = this._byToken.get(this._drag.token);
            const el = entry?.elRef.deref(); if (!el) { this._drag = null; return; }

            const left = e.clientX - this._drag.offX;
            const top  = e.clientY - this._drag.offY;

            el.style.left = `${left}px`;
            el.style.top  = `${top}px`;

            this.clampNow(this._drag.token);

            const p = this._drag.persist;
            if (p) {
                if (p.leftKey) APPLICATION_CONTEXT.AppCache.set(p.leftKey, parseInt(el.style.left));
                if (p.topKey)  APPLICATION_CONTEXT.AppCache.set(p.topKey,  parseInt(el.style.top));
            }

            if (entry && entry.dragOnMove) {
                const rect = el.getBoundingClientRect();
                entry.dragOnMove(el, rect);
            }

            if (e.cancelable) e.preventDefault();
        }

        // resizing
        if (this._rsz) {
            const entry = this._byToken.get(this._rsz.token);
            const el = entry?.elRef.deref(); if (!el) { this._rsz = null; return; }

            const w = Math.max(this._rsz.minW, this._rsz.startW + (e.clientX - this._rsz.startX));
            const h = Math.max(this._rsz.minH, this._rsz.startH + (e.clientY - this._rsz.startY));
            el.style.width  = `${Math.round(w)}px`;
            el.style.height = `${Math.round(h)}px`;

            this.clampNow(this._rsz.token);

            const p = this._rsz.persist;
            if (p) {
                if (p.widthKey)  APPLICATION_CONTEXT.AppCache.set(p.widthKey,  w);
                if (p.heightKey) APPLICATION_CONTEXT.AppCache.set(p.heightKey, h);
            }

            if (e.cancelable) e.preventDefault();
        }
    }

    _onPointerUp() {
        if (this._drag) {
            const el = this._byToken.get(this._drag.token)?.elRef?.deref();
            if (el) el.style.willChange = "";
        }
        this._drag = null;
        this._rsz = null;
    }

    // ---- internals ----
    _normClamp(clamp) {
        if (!clamp) return null;
        const margin = Number.isFinite(clamp.margin) ? clamp.margin : 6;
        const topBarEl = clamp.topBarId ? document.getElementById(clamp.topBarId) : null;
        const cache = clamp.cache
            ? {
                leftKey: clamp.cache.leftKey || null,
                topKey: clamp.cache.topKey || null
            }
            : null;
        return { margin, topBarEl, cache };
    }

    _invoke(ownerRef, fnOrName, event) {
        if (!fnOrName) return;
        if (typeof fnOrName === "function") { fnOrName(event); return; }
        const owner = ownerRef?.deref(); if (!owner) return;
        const fn = owner[fnOrName];
        if (typeof fn === "function") fn.call(owner, event);
    }

    _handleOutside(e) {
        for (const token of this._tokens) {
            const entry = this._byToken.get(token); if (!entry) continue;
            const el = entry.elRef.deref();
            if (!el) continue; // will be swept
            if (!el.contains(e.target)) this._invoke(entry.ownerRef, entry.onOutsideClick, e);
        }
    }

    _handleKey(e) {
        if (e.key !== "Escape") return;
        // topmost alive
        let pick = null;
        for (const token of this._tokens) {
            const entry = this._byToken.get(token); if (!entry) continue;
            if (!entry.elRef.deref()) continue;
            if (!pick || entry.z > pick.z) pick = entry;
        }
        if (pick) this._invoke(pick.ownerRef, pick.onEscape, e);
    }

    _clampAll() { for (const t of this._tokens) this.clampNow(t); }

    _sweep() {
        for (const token of Array.from(this._tokens)) {
            const e = this._byToken.get(token);
            if (!e) { this._tokens.delete(token); continue; }
            if (!e.elRef.deref()) this.unregister(token);
        }
    }
}