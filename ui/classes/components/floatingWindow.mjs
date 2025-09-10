// ui/classes/components/floatingWindow.mjs
import van from "../../../../../Desktop/Vis2/src/xopat/ui/vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { Div } from "../elements/div.mjs";
import { Button } from "../elements/buttons.mjs";
import { FAIcon } from "../elements/fa-icon.mjs";

const { div, span } = van.tags;

/**
 * Options:
 *  - id?: string
 *  - title?: string
 *  - width?: number (px)
 *  - height?: number (px)
 *  - resizable?: boolean (default true)
 *  - startLeft?: number (px)
 *  - startTop?: number (px)
 *  - onClose?: () => void
 *  - onPopout?: (childWindow: Window) => void
 */
export class FloatingWindow extends BaseComponent {
    constructor(options = {}, ...bodyChildren) {
        super(options, ...bodyChildren);

        // --- base CSS (similar to your other components’ style system) ---
        this.classMap.base = "card bg-base-200 shadow-xl border border-base-300";
        this.classMap.positioning = "fixed";
        this.classMap.rounded = "rounded-box";
        this.classMap.flex = "flex flex-col";
        this.classMap.z = "z-50";

        this.title = options.title ?? "Window";
        this.resizable = options.resizable !== false;

        // Persisted position/size keys
        this._cacheKey = (k) => `${this.id}:${k}`;

        // Size + position (restored with defaults)
        this._w = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("w"), options.width ?? 360);
        this._h = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("h"), options.height ?? 240);
        this._l = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("l"), options.startLeft ?? 64);
        this._t = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("t"), options.startTop ?? 64);

        // Externalization
        this._external = false;
        this._childWindow = null;

        // Internal refs
        this._rootEl = null;
        this._bodyEl = null;
        this._dragging = false;
        this._dragOffX = 0;
        this._dragOffY = 0;

        this._header = new Div({
                extraClasses: {
                    layout: "navbar min-h-0 h-9 bg-base-300/70 rounded-t-box px-2 cursor-move select-none",
                }
            },
            div({ class: "flex items-center gap-2" },
                new FAIcon({ name: "fa-up-down-left-right" }).create(),
                span({ class: "font-semibold truncate" }, this.title),
            ),
            div({ class: "ml-auto flex items-center gap-1" },
                // btns: DaisyUI ghost, tiny, square TODO: external window not tested properly, not working
                // (this._btnPop = new Button({
                //     size: Button.SIZE.TINY,
                //     type: Button.TYPE.NONE,
                //     extraClasses: { btn: "btn btn-ghost btn-xs btn-square" },
                //     onClick: () => this._toggleExternal(),
                // }, new FAIcon({ name: "fa-up-right-from-square" }))).create(),
                (this._btnClose = new Button({
                    size: Button.SIZE.TINY,
                    type: Button.TYPE.NONE,
                    extraClasses: { btn: "btn btn-ghost btn-xs btn-square" },
                    onClick: () => this.close(),
                }, new FAIcon({ name: "fa-close" }))).create(),
            )
        );

        this._content = new Div({
            extraClasses: {
                wrap: "card-body p-2 gap-2 overflow-auto flex-1 min-h-0",
            },
            extraProperties: { style: "width:100%; height:100%;" }
        }, ...this._children);

        // Resize handle
        this._resizeHandle = this.resizable ? div({
            class: "absolute right-1 bottom-1 w-3 h-3 cursor-se-resize opacity-50 " +
                "border-r-2 border-b-2 border-base-content/50"
        }) : null;
    }

    // ---------- public API ----------
    focus() {
        if (!this._rootEl) return;
        this._rootEl.style.zIndex = String(Date.now());
        this._rootEl.classList.add("ring-2","ring-primary","ring-offset-2","ring-offset-base-100");
        setTimeout(() => this._rootEl?.classList.remove("ring-2","ring-primary","ring-offset-2","ring-offset-base-100"), 200);
    }

    opened() {
        if (this._external) {
            return this._childWindow?.closed;
        }
        return !!document.getElementById(this.id);
    }

    close() {
        if (this._external && !this._childWindow?.closed) {
            this._childWindow.close();
        }
        this._external = false;
        this._childWindow = null;
        this.options.onClose?.();
        this.remove();
    }

    // ---------- internal ----------
    _applyBounds() {
        if (!this._rootEl) return;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const minW = 220;
        const minH = 140;

        let w = Math.max(minW, Math.min(this._w, vw - 16));
        let h = Math.max(minH, Math.min(this._h, vh - 16));

        let l = Math.min(Math.max(0, this._l), Math.max(0, vw - w));
        let t = Math.min(Math.max(0, this._t), Math.max(0, vh - h));

        // Save normalized values
        this._w = w; this._h = h; this._l = l; this._t = t;

        this._rootEl.style.width = `${w}px`;
        this._rootEl.style.height = `${h}px`;
        this._rootEl.style.left = `${l}px`;
        this._rootEl.style.top = `${t}px`;
    }

    _persist() {
        APPLICATION_CONTEXT.AppCache.set(this._cacheKey("w"), this._w);
        APPLICATION_CONTEXT.AppCache.set(this._cacheKey("h"), this._h);
        APPLICATION_CONTEXT.AppCache.set(this._cacheKey("l"), this._l);
        APPLICATION_CONTEXT.AppCache.set(this._cacheKey("t"), this._t);
    }

    _onDragStart = (e) => {
        if (this._external) return; // ignore when popped out
        this._dragging = true;
        const rect = this._rootEl.getBoundingClientRect();
        const startX = e.touches ? e.touches[0].clientX : e.clientX;
        const startY = e.touches ? e.touches[0].clientY : e.clientY;
        this._dragOffX = startX - rect.left;
        this._dragOffY = startY - rect.top;
        document.addEventListener("mousemove", this._onDragMove);
        document.addEventListener("mouseup", this._onDragEnd);
        document.addEventListener("touchmove", this._onDragMove, { passive: false });
        document.addEventListener("touchend", this._onDragEnd);
        this.focus();
    };

    _onDragMove = (e) => {
        if (!this._dragging) return;
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        this._l = x - this._dragOffX;
        this._t = y - this._dragOffY;
        this._applyBounds();
        this._persist();
        if (e.cancelable) e.preventDefault();
    };

    _onDragEnd = () => {
        this._dragging = false;
        document.removeEventListener("mousemove", this._onDragMove);
        document.removeEventListener("mouseup", this._onDragEnd);
        document.removeEventListener("touchmove", this._onDragMove);
        document.removeEventListener("touchend", this._onDragEnd);
    };

    _onResizeDragStart = (e) => {
        if (this._external) return;
        e.stopPropagation();
        const startX = e.touches ? e.touches[0].clientX : e.clientX;
        const startY = e.touches ? e.touches[0].clientY : e.clientY;
        const startW = this._w;
        const startH = this._h;

        const move = (ev) => {
            ev.stopPropagation();
            const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
            const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
            this._w = startW + (x - startX);
            this._h = startH + (y - startY);
            this._applyBounds();
            this._persist();
            if (ev.cancelable) ev.preventDefault();
        };
        const end = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", end);
            window.removeEventListener("touchmove", move);
            window.removeEventListener("touchend", end);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", end);
        window.addEventListener("touchmove", move, { passive: false });
        window.addEventListener("touchend", end);
    };

    _toggleExternal() {
        if (this._external) {
            // Already external; try to focus
            this._childWindow?.focus();
            return;
        }

        // Pop out: open a child window (chromeless-ish)
        const features = `popup=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes,width=${this._w},height=${this._h},left=${this._l},top=${this._t}`;
        const child = window.open("", `${this.id}-popup`, features);
        if (!child) return;

        this._external = true;
        this._childWindow = child;

        // Basic doc + style mirror; you said you'll wire libs, so here's a placeholder:
        const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
        child.document.write(`
  <!doctype html>
  <html data-theme="${currentTheme}">
    <head>
      <meta charset="utf-8"/>
      <title>${this.title}</title>
      <style>
        html,body{height:100%;margin:0}
        body{background:var(--b2);color:var(--bc);font-family:ui-sans-serif,system-ui;}
        .fw-host{position:absolute;inset:0;display:flex;flex-direction:column}
      </style>
        <!--TODO dirty hardcoded path-->
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/assets/style.css">
        <link rel="stylesheet" href="${APPLICATION_CONTEXT.url}src/libs/tailwind.min.css">
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
        <script src="https://code.jquery.com/jquery-3.5.1.min.js"
            integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
            crossorigin="anonymous"></script>
        <script type="text/javascript">
            //route to the parent context
            window.confirm = function(message) {
                window.opener.focus();
                window.opener.confirm(message);
            };
            $.t = window.opener.$.t;
            $.i18n = window.opener.$.i18n;
            $.prototype.localize = () => {console.error("localize() not supported in child window!")};
        <\/script>
    </head>
    <body>
      <div id="fw-host" class="fw-host"></div>
    </body>
  </html>
`);
        child.document.close();

        // Bridge: forward all "functionality traffic" to parent
        this._installBridge(child);

        // Render the window content into the popup – but events/actions go through the bridge.
        // We simply clone the body node; you can replace this with a proper re-mount if desired.
        const host = child.document.getElementById("fw-host");
        const placeholder = child.document.createElement("div");
        host.appendChild(placeholder);

        // We’ll send a request to parent to (re)render the content in the child.
        // Parent listens and responds with DOM HTML. You can replace with your own hydration.
        child.postMessage({ __fw: true, type: "request-render", id: this.id }, "*");

        // Keep size/position in sync if user resizes/moves the popup window
        const syncSize = () => {
            try {
                const w = child.innerWidth, h = child.innerHeight;
                this._w = w; this._h = h;
                this._persist();
            } catch {}
        };
        child.addEventListener("resize", syncSize);
        child.addEventListener("beforeunload", () => {
            this._external = false;
            this._childWindow = null;
        });
    }

    _installBridge(child) {
        // Parent side receiver for child's messages.
        // Replace internals with your app’s routing; we provide a safe default.
        const parentHandler = (ev) => {
            const msg = ev.data;
            if (!msg || !msg.__fw) return;

            if (msg.type === "request-render" && msg.id === this.id) {
                // Minimal render: dump current innerHTML of our content into the child
                // (You can replace with your proper renderer that reuses libs from parent)
                const html = (this._bodyEl?.innerHTML ?? "");
                child.postMessage({ __fw: true, type: "render-html", id: this.id, html }, "*");
            }

            if (msg.type === "event") {
                // Example event forward to parent app (placeholder)
                // routeToParentFeature(msg.payload)
                // console.log("Child->Parent event:", msg.payload);
            }
        };
        window.addEventListener("message", parentHandler);

        // Child side bootstrapping
        child.addEventListener("load", () => {
            const childHandler = (ev) => {
                const msg = ev.data;
                if (!msg || !msg.__fw) return;
                if (msg.type === "render-html" && msg.id === this.id) {
                    const host = child.document.getElementById("fw-host");
                    host.innerHTML = msg.html || "";
                    // Attach a click/mutation listener that forwards interactions to parent as needed:
                    host.addEventListener("click", (e) => {
                        const data = { path: e.composedPath().map(n => n.id || n.className || n.nodeName) };
                        child.opener?.postMessage({ __fw: true, type: "event", id: this.id, payload: { kind: "click", data } }, "*");
                    }, { capture: true });
                }
            };
            child.addEventListener("message", childHandler);
        });
    }

    create() {
        // Root element with inline position/size (persisted)
        const root = div({
                ...this.commonProperties,
                style: `
        position: fixed;
        width:${this._w}px; height:${this._h}px;
        left:${this._l}px; top:${this._t}px;
      `,
                onmousedown: () => this.focus()
            },
            // header (drag handle)
            this._header.create(),
            // body
            (this._bodyEl = this._content.create()),
            // resize corner
            this._resizeHandle
        );

        // After mount wiring
        queueMicrotask(() => {
            this._rootEl = document.getElementById(this.id);
            // Drag
            const headerEl = document.getElementById(this._header.id) || this._rootEl.firstChild;
            headerEl.addEventListener("mousedown", this._onDragStart);
            headerEl.addEventListener("touchstart", this._onDragStart, { passive: false });

            // Resize
            if (this._resizeHandle) {
                const el = this._rootEl.querySelector(".cursor-se-resize");
                el?.addEventListener("mousedown", this._onResizeDragStart);
                el?.addEventListener("touchstart", this._onResizeDragStart, { passive: false });
            }

            // Keep visible on viewport resize (only when not external)
            const onViewport = () => {
                if (this._external) return;
                this._applyBounds();
                this._persist();
            };
            window.addEventListener("resize", onViewport);

            // Store cleanup hook onto element
            this._rootEl.__fw_cleanup = () => {
                headerEl.removeEventListener("mousedown", this._onDragStart);
                headerEl.removeEventListener("touchstart", this._onDragStart);
                window.removeEventListener("resize", onViewport);
            };

            // Initial normalize
            this._applyBounds();
        });

        return root;
    }

    remove() {
        try { this._rootEl?.__fw_cleanup?.(); } catch {}
        super.remove();
    }
}
