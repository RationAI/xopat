import { BaseComponent } from "../baseComponent.mjs";

/**
 * SidePanel: small reusable fixed-position panel that plugins can show near an anchor.
 * Simple API: constructor(options), attachToBody(), setBody(node|string), showAt({left,top}), hide(), remove().
 */
class SidePanel extends BaseComponent {
    constructor(options = {}) {
        options = super(options).options;
        this.id = options.id || `side-panel-${Math.random().toString(36).slice(2,8)}`;
        // width can be a number (px) or 'auto'
        this.width = (options.width === undefined) ? 'auto' : options.width;
        this.minWidth = options.minWidth || 120;
        this.maxWidth = options.maxWidth || 420;
        this.maxHeight = options.maxHeight || '70vh';
        this._el = null;
        this._hideTimer = null;
        this.hoverDelay = options.hoverDelay || 250;
    }

    create() {
        if (this._el) return this._el;
    const el = document.createElement('div');
        el.id = this.id;
        el.className = ['dropdown-content','bg-base-200','text-base-content','rounded-box','shadow-xl','border','border-base-300'].join(' ');
        el.style.position = 'fixed';
    // let the panel size to its content by default, but constrain widths
    if (typeof this.width === 'number') el.style.width = `${this.width}px`;
    else el.style.width = 'auto';
    el.style.minWidth = `${this.minWidth}px`;
    el.style.maxWidth = (typeof this.maxWidth === 'number') ? `${this.maxWidth}px` : this.maxWidth;
    el.style.maxHeight = this.maxHeight;
    el.style.overflow = 'auto';
        el.style.zIndex = '9999';
        // ensure it doesn't capture pointer events unexpectedly
        return (this._el = el);
    }

    attachToBody() {
        const el = this.create();
        if (!document.body.contains(el)) document.body.appendChild(el);
    }

    // convenience: build a simple vertical menu from an array of labels or objects
    // items: array of strings or { label, value }
    // onClick: function(item, index)
    setMenu(items = [], onClick) {
        const node = document.createElement('div');
        node.className = 'p-2';
        const ul = document.createElement('ul'); ul.className = 'menu bg-transparent p-0'; ul.setAttribute('role','menu');
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const label = (typeof it === 'string') ? it : (it && it.label) || String(it);
            const li = document.createElement('li'); li.setAttribute('role','none');
            const a = document.createElement('a');
            a.className = 'flex items-center gap-3 rounded-md px-3 py-2 hover:bg-base-300 focus:bg-base-300';
            a.setAttribute('role','menuitem'); a.setAttribute('tabindex','-1');
            a.textContent = label;
            // capture index/value for the click handler
            a.addEventListener('click', (ev) => {
                try { ev.stopPropagation(); if (typeof onClick === 'function') onClick(it, i); } catch(_){}
            });
            li.appendChild(a); ul.appendChild(li);
        }
        node.appendChild(ul);
        this.setBody(node);
    }

    cancelHide() { if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; } }
    scheduleHide(delay) { this.cancelHide(); this._hideTimer = setTimeout(()=>{ try{ this.hide(); } catch(_){}; this._hideTimer = null; }, (typeof delay === 'number') ? delay : this.hoverDelay); }

    // Position the panel adjacent to an anchor element or rect and show it.
    // anchor: Element or DOMRect-like { left, right, top }
    // opts: { nudge: number, offsetY: number }
    showNear(anchor, opts = {}) {
        try {
            const el = this.create();
            this.attachToBody();
            const rect = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : (anchor || { left: 0, right: 0, top: 0 });
            const nudge = (opts.nudge === undefined) ? 1 : opts.nudge;
            const offsetY = opts.offsetY || 0;
            requestAnimationFrame(() => {
                try {
                    const panelEl = document.getElementById(this.id);
                    const panelW = panelEl && panelEl.offsetWidth ? panelEl.offsetWidth : (typeof this.width === 'number' ? this.width : this.minWidth);
                    const panelH = panelEl && panelEl.offsetHeight ? panelEl.offsetHeight : 0;
                    let left = rect.right;
                    if (left + panelW > window.innerWidth - 8) {
                        left = Math.max(8, rect.left - panelW);
                    } else {
                        left = Math.max(8, left - nudge);
                    }
                    let top = Math.max(8, rect.top + offsetY);
                    // clamp vertically so the panel stays within viewport when possible
                    if (panelH && (top + panelH > window.innerHeight - 8)) {
                        top = Math.max(8, window.innerHeight - panelH - 8);
                    }
                    panelEl.style.left = `${left}px`;
                    panelEl.style.top = `${top}px`;
                    panelEl.style.display = '';
                    // ensure hover keeps it open
                    panelEl.addEventListener('mouseenter', () => { this.cancelHide(); });
                    panelEl.addEventListener('mouseleave', () => { this.scheduleHide(); });
                } catch (e) { /* swallow layout issues */ }
            });
        } catch (e) { /* ignore */ }
    }

    setBody(content) {
        const el = this.create();
        el.innerHTML = '';
        if (typeof content === 'string') {
            el.innerHTML = content;
        } else if (content instanceof Node) {
            el.appendChild(content);
        } else if (content && typeof content.create === 'function') {
            el.appendChild(content.create());
        }
        // allow layout to settle then ensure width fits content within min/max
        try {
            requestAnimationFrame(() => {
                try {
                    // if width is 'auto' let the browser size it naturally; enforce min/max via CSS
                    if (this.width === 'auto') {
                        el.style.width = 'auto';
                        // no further action; CSS min/max will constrain
                    } else if (typeof this.width === 'number') {
                        el.style.width = `${this.width}px`;
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    showAt({ left = 0, top = 0 } = {}) {
        const el = this.create();
        this.attachToBody();
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.display = '';
    }

    hide() {
        const el = this._el; if (!el) return;
        try { el.remove(); } catch(_) { el.style.display = 'none'; }
    }

    remove() {
        if (!this._el) return;
        try { this._el.parentNode && this._el.parentNode.removeChild(this._el); } catch(_) {}
        this._el = null;
    }
}

export { SidePanel };
