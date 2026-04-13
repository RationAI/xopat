import van from "../../vanjs.mjs";
import {BaseComponent} from "../baseComponent.mjs";
import {Div} from "../elements/div.mjs";
import {Button} from "../elements/buttons.mjs";
import {FAIcon} from "../elements/fa-icon.mjs";

const { div, span } = van.tags;

const registeredWindows = {};
const registeredInstances = {};

globalThis.window.addEventListener("beforeunload", () => {
    FloatingWindow.closeAllExternal();
});

function destroyWindow(key, win) {
    if (isWindowOpened(win)) {
        try {
            win.document.body.innerHTML = "";
        } catch {}
        win.close();
    }
    delete registeredWindows[key];
}

function isWindowOpened(win) {
    return !!(win && !win.closed && win.self);
}

function registerWindow(key, win) {
    const existing = registeredWindows[key];
    if (existing && existing !== win) {
        destroyWindow(key, existing);
    }
    registeredWindows[key] = win;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function serializeDomLike(value) {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(item => serializeDomLike(item)).join("");
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value.jquery?.length) return value[0]?.outerHTML || "";
    if (value.outerHTML) return value.outerHTML;
    if (value.nodeType) {
        const wrapper = document.createElement("div");
        wrapper.appendChild(value.cloneNode(true));
        return wrapper.innerHTML;
    }
    if (value?.create) {
        const rendered = value.create();
        return rendered?.outerHTML || "";
    }
    return String(value);
}

function parseDimension(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

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
 *  - closable?: boolean (default true)
 *  - external?: boolean (default false)
 *  - externalProps?: {
 *      - headTags?: string[]
 *      - onRender?: (childWindow: Window) => void
 *      - content?: any
 *      - mode?: "content" | "editor"
 *      - editor?: { value?: string, language?: string, theme?: string }
 *      - onSave?: (value: string) => void
 *  }
 */
export class FloatingWindow extends BaseComponent {
    static getExternal(id) {
        const instance = registeredInstances[id];
        if (!instance) return null;
        if (!instance.isOpened()) {
            delete registeredInstances[id];
            delete registeredWindows[id];
            return null;
        }
        return instance;
    }

    static closeAllExternal() {
        for (const id of Object.keys(registeredInstances)) {
            try {
                registeredInstances[id]?.close();
            } catch (error) {
                console.warn(`Failed to close external window "${id}".`, error);
            }
        }
    }

    static openExternal(options = undefined, ...bodyChildren) {
        const id = options?.id;
        if (id) {
            const existing = this.getExternal(id);
            if (existing) {
                existing.options = {
                    ...existing.options,
                    ...(options || {}),
                    external: true,
                };
                if (options?.title !== undefined) existing.title = options.title;
                if (options?.width !== undefined) existing._w = parseDimension(options.width, existing._w);
                if (options?.height !== undefined) existing._h = parseDimension(options.height, existing._h);
                if (options?.startLeft !== undefined) existing._l = parseDimension(options.startLeft, existing._l);
                if (options?.startTop !== undefined) existing._t = parseDimension(options.startTop, existing._t);
                if (options?.resizable !== undefined) existing.resizable = options.resizable !== false;
                if (options?.closable !== undefined) existing.closable = options.closable;
                existing._applyExternalOptions(options);
                if (bodyChildren.length) {
                    existing._children = bodyChildren;
                    existing._renderedChildren = null;
                }
                if (existing.context?.window) {
                    existing._mountExternalWindow(existing.context.window);
                }
                existing.focus();
                return existing;
            }
        }

        const instance = new FloatingWindow({
            ...(options || {}),
            external: true,
        }, ...bodyChildren);
        instance.open();
        return instance;
    }

    constructor(options = undefined, ...bodyChildren) {
        options = super(options, ...bodyChildren).options;

        this.classMap.base = "card bg-base-200 shadow-xl border border-base-300";
        this.classMap.positioning = "fixed";
        this.classMap.rounded = "rounded-box";
        this.classMap.flex = "flex flex-col";
        this.classMap.z = "z-50";

        this.title = options.title ?? "Window";
        this.resizable = options.resizable !== false;
        this.closable = options.closable ?? true;

        this._cacheKey = (k) => `${this.id}:${k}`;

        this._w = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("w"), options.width ?? 360);
        this._h = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("h"), options.height ?? 240);
        this._l = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("l"), options.startLeft ?? 64);
        this._t = APPLICATION_CONTEXT.AppCache.get(this._cacheKey("t"), options.startTop ?? 64);

        this._external = options.external === true;
        this._childWindow = null;
        this._externalBodyEl = null;
        this._externalEditor = null;
        this._externalEditorInitialValue = "";
        this._externalEditorSaveHandler = null;

        this._rootEl = null;
        this._bodyEl = null;
        this._dragging = false;
        this._dragOffX = 0;
        this._dragOffY = 0;

        this._applyExternalOptions(options);

        const btnClose = this.closable || options.onClose ? [
            (this._btnClose = new Button({
                size: Button.SIZE.TINY,
                type: Button.TYPE.NONE,
                extraClasses: { btn: "btn btn-ghost btn-xs btn-square" },
                extraProperties: { "data-no-drag": "true" },
                onClick: () => this.close(),
            }, new FAIcon({ name: "fa-close" }))).create()
        ] : [];

        this._header = new Div({
                extraClasses: {
                    layout: "navbar min-h-0 h-9 bg-base-300/70 rounded-t-box px-2 cursor-move select-none",
                }
            },
            div({ class: "flex items-center gap-2" },
                new FAIcon({ name: "fa-up-down-left-right" }).create(),
                span({ class: "font-semibold truncate" }, this.title),
            ),
            div({ class: "ml-auto flex items-center gap-1" }, ...btnClose)
        );

        this._content = new Div({
            extraClasses: {
                wrap: "card-body p-2 gap-2 overflow-auto flex-1 min-h-0",
            },
            extraProperties: { style: "width:100%; height:100%;" }
        }, ...this._children);

        this._resizeHandle = this.resizable ? div({
            class: "absolute right-1 bottom-1 w-3 h-3 cursor-se-resize opacity-50 " +
                "border-r-2 border-b-2 border-base-content/50"
        }) : null;

        if (this._external) {
            this._openExternalWindow();
        }
    }

    get context() {
        return this._childWindow ? {
            window: this._childWindow,
            opener: window,
            self: this._childWindow,
        } : null;
    }

    _applyExternalOptions(options = {}) {
        const externalProps = options.externalProps || {};
        this._externalProps = externalProps;
        this._externalMode = externalProps.mode || "content";
        this._externalHeadTags = externalProps.headTags || [];
        this._externalRenderCallback = externalProps.onRender;
        this._externalContent = externalProps.content;
        this._externalSaveCallback = externalProps.onSave;
        this._externalEditorOptions = {
            value: externalProps.editor?.value ?? "",
            language: externalProps.editor?.language || "javascript",
            theme: externalProps.editor?.theme || "hc-black",
        };
    }

    focus() {
        if (this._external) {
            if (!isWindowOpened(this._childWindow)) {
                this._openExternalWindow();
            } else {
                this._childWindow.focus();
            }
            return;
        }

        if (!this._rootEl) return;
        this._rootEl.style.zIndex = "10000";
        this._rootEl.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-base-100");
        setTimeout(() => this._rootEl?.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-base-100"), 200);
    }

    getBodyEl() {
        return this._bodyEl || this._externalBodyEl || null;
    }

    setBody(content) {
        if (this._external) {
            this._externalContent = content;
            this._renderExternalBody();
            return;
        }

        if (!this._bodyEl) return;
        let newNode = null;
        if (content instanceof Node) {
            newNode = content;
        } else if (typeof content === "string") {
            const wrap = document.createElement("div");
            wrap.innerHTML = content;
            newNode = wrap.firstElementChild || wrap;
        } else if (content?.create) {
            newNode = content.create();
        } else {
            newNode = document.createElement("div");
        }
        this._bodyEl.replaceWith(newNode);
        this._bodyEl = newNode;
    }

    clearBody() {
        if (this._external && this._externalBodyEl) {
            this._externalBodyEl.innerHTML = "";
            return;
        }
        if (this._bodyEl) this._bodyEl.innerHTML = "";
    }

    isOpened() {
        if (this._external) {
            return isWindowOpened(this._childWindow);
        }
        return !!document.getElementById(this.id);
    }

    open() {
        if (this._external) {
            this._openExternalWindow();
            return;
        }

        if (!this._bodyEl) {
            this.attachTo(document.body);
        } else {
            this.focus();
        }
    }

    close() {
        if (!this.closable) {
            this.options.onClose?.();
            return;
        }

        if (this._external) {
            this._saveExternalEditor();
            this._teardownExternalEditor();
            if (isWindowOpened(this._childWindow)) {
                destroyWindow(this.id, this._childWindow);
            }
            this._childWindow = null;
            this._externalBodyEl = null;
            delete registeredInstances[this.id];
            delete registeredWindows[this.id];
            this.options.onClose?.();
            return;
        }

        this.options.onClose?.();
        this.remove();
    }

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
        if (this._external) return;
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

    _buildExternalFeatures() {
        return [
            "popup=yes",
            "menubar=no",
            "toolbar=no",
            "location=no",
            "status=no",
            `resizable=${this.resizable ? "yes" : "no"}`,
            "scrollbars=yes",
            `width=${this._w}`,
            `height=${this._h}`,
            `left=${this._l}`,
            `top=${this._t}`,
        ].join(",");
    }

    _openExternalWindow() {
        if (isWindowOpened(this._childWindow)) {
            this._childWindow.focus();
            return this._childWindow;
        }

        const child = window.open("", `${this.id}-popup`, this._buildExternalFeatures());
        if (!child) {
            Dialogs.show($.t("messages.windowBlocked", { title: this.title }), 15000, Dialogs.MSG_WARN, {
                buttons: {
                    Open: () => this._openExternalWindow()
                }
            });
            return null;
        }

        this._childWindow = child;
        this._external = true;
        registerWindow(this.id, child);
        registeredInstances[this.id] = this;

        this._renderExternalDocument(child);
        child.focus();
        return child;
    }

    _toggleExternal() {
        return this._openExternalWindow();
    }

    _collectExternalStyles() {
        const nodes = document.head?.querySelectorAll?.('link[rel="stylesheet"], style') || [];
        return Array.from(nodes).map(node => node.outerHTML).join("\n");
    }

    _serializeHtmlAttributes(element) {
        if (!element) return 'lang="en"';
        const parts = [];
        for (const attr of Array.from(element.attributes || [])) {
            parts.push(`${attr.name}="${escapeHtml(attr.value)}"`);
        }
        if (!parts.some(part => part.startsWith("lang="))) {
            parts.push('lang="en"');
        }
        return parts.join(" ");
    }

    _buildExternalBootstrap() {
        return `
(() => {
    const openerRef = window.opener;
    if (!openerRef) return;

    window.UI = openerRef.UI;
    window.UTILITIES = openerRef.UTILITIES;
    window.APPLICATION_CONTEXT = openerRef.APPLICATION_CONTEXT;
    window.USER_INTERFACE = openerRef.USER_INTERFACE;
    window.VIEWER = openerRef.VIEWER;
    window.VIEWER_MANAGER = openerRef.VIEWER_MANAGER;
    window.OpenSeadragon = openerRef.OpenSeadragon;
    window.XOpatUser = openerRef.XOpatUser;

    window.confirm = function(message) {
        openerRef.focus?.();
        return openerRef.confirm(message);
    };

    if (openerRef.$) {
        window.$ = openerRef.$;
        window.jQuery = openerRef.jQuery || openerRef.$;
        window.$.t = openerRef.$.t;
        window.$.i18n = openerRef.$.i18n;
        if (window.$.prototype) {
            window.$.prototype.localize = () => console.error("localize() not supported in child window!");
        }
    }

    window.Dialogs = {
        show: (...args) => openerRef.Dialogs?.show?.(...args),
        hide: (...args) => openerRef.Dialogs?.hide?.(...args),
        awaitHidden: (...args) => openerRef.Dialogs?.awaitHidden?.(...args),
        MSG_INFO: openerRef.Dialogs?.MSG_INFO,
        MSG_WARN: openerRef.Dialogs?.MSG_WARN,
        MSG_ERR: openerRef.Dialogs?.MSG_ERR,
        MSG_SUCCESS: openerRef.Dialogs?.MSG_SUCCESS,
    };
})();
        `.trim();
    }

    _renderExternalDocument(child) {
        const doc = child.document;
        const htmlAttrs = this._serializeHtmlAttributes(document.documentElement);
        const bodyClass = document.body?.className || "";
        const styles = this._collectExternalStyles();

        doc.open();
        doc.write(`<!DOCTYPE html>
<html ${htmlAttrs}>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base href="${escapeHtml(document.baseURI)}">
    <title>${escapeHtml(this.title)}</title>
    ${styles}
    ${this._externalHeadTags.join("\n")}
    <script>${this._buildExternalBootstrap()}<\/script>
    <style>
        html, body { min-height: 100vh; height: 100%; }
        body { margin: 0; overflow: hidden; }
        #xopat-external-window-root { height: 100vh; width: 100vw; overflow: hidden; }
        #xopat-external-window-shell { height: 100%; width: 100%; display: flex; flex-direction: column; }
    </style>
</head>
<body class="${escapeHtml(bodyClass)}">
    <div id="xopat-external-window-root"></div>
</body>
</html>`);
        doc.close();

        const render = () => {
            if (!isWindowOpened(child)) return;
            this._mountExternalWindow(child);
        };

        if (doc.readyState === "complete" || doc.readyState === "interactive") {
            setTimeout(render, 0);
        } else {
            child.addEventListener("load", render, { once: true });
        }

        child.addEventListener("resize", () => {
            try {
                this._w = child.outerWidth || child.innerWidth || this._w;
                this._h = child.outerHeight || child.innerHeight || this._h;
                this._persist();
            } catch {}
        });

        child.addEventListener("beforeunload", () => {
            this._saveExternalEditor();
            this._teardownExternalEditor();
            this._childWindow = null;
            this._externalBodyEl = null;
            delete registeredInstances[this.id];
            delete registeredWindows[this.id];
        }, { once: true });
    }

    _mountExternalWindow(child) {
        const doc = child.document;
        doc.title = this.title;

        const mount = doc.getElementById("xopat-external-window-root");
        if (!mount) return;

        mount.innerHTML = "";

        const shell = doc.createElement("div");
        shell.id = "xopat-external-window-shell";
        shell.className = "card bg-base-200 shadow-xl border border-base-300 rounded-none flex flex-col h-full w-full";

        const header = doc.createElement("div");
        header.className = "navbar min-h-0 h-9 bg-base-300/70 px-2 select-none";
        header.innerHTML = `
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-up-down-left-right"></i>
                <span class="font-semibold truncate">${escapeHtml(this.title)}</span>
            </div>
            <div class="ml-auto flex items-center gap-1">
                ${this.closable ? `<button type="button" class="btn btn-ghost btn-xs btn-square" data-window-close="true"><i class="fa-solid fa-close"></i></button>` : ""}
            </div>
        `;

        const body = doc.createElement("div");
        body.className = "card-body p-2 gap-2 overflow-auto flex-1 min-h-0";
        body.style.width = "100%";
        body.style.height = "100%";
        body.id = `${this.id}-external-body`;
        this._externalBodyEl = body;

        shell.appendChild(header);
        shell.appendChild(body);
        mount.appendChild(shell);

        const closeButton = header.querySelector("[data-window-close='true']");
        if (closeButton) {
            closeButton.addEventListener("click", () => this.close());
        }

        this._renderExternalBody();
        this._externalRenderCallback?.(child);
    }

    _getExternalContentHtml() {
        if (this._externalContent != null) {
            return serializeDomLike(this._externalContent);
        }
        if (this._bodyEl) {
            return this._bodyEl.innerHTML;
        }
        return this._children.map(child => serializeDomLike(child)).join("");
    }

    _renderExternalBody() {
        if (!this._externalBodyEl || !isWindowOpened(this._childWindow)) return;

        this._teardownExternalEditor();
        this._externalBodyEl.innerHTML = "";

        if (this._externalMode === "editor") {
            this._renderExternalEditor();
            return;
        }

        this._externalBodyEl.classList.add("overflow-auto");
        this._externalBodyEl.innerHTML = this._getExternalContentHtml();
    }

    _renderExternalEditor() {
        if (!this._externalBodyEl || !isWindowOpened(this._childWindow)) return;

        const doc = this._childWindow.document;
        this._externalBodyEl.classList.remove("overflow-auto");
        this._externalBodyEl.classList.add("overflow-hidden");
        this._externalBodyEl.innerHTML = `
            <div class="flex h-full min-h-0 flex-col bg-base-200">
                <div class="flex items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-4 py-3">
                    <h1 class="m-0 flex-1 text-lg font-semibold">${escapeHtml(this.title)}</h1>
                    <button type="button" class="btn btn-sm" data-editor-save="true">Save</button>
                </div>
                <div id="${this.id}-external-editor" class="min-h-0 flex-1"></div>
            </div>
        `;

        const saveButton = this._externalBodyEl.querySelector("[data-editor-save='true']");
        saveButton?.addEventListener("click", () => this._saveExternalEditor());

        this._externalEditorInitialValue = this._externalEditorOptions.value ?? "";
        this._externalEditorSaveHandler = (event) => {
            if ((event.ctrlKey || event.metaKey) && String(event.code || event.key) === "KeyS") {
                event.preventDefault();
                this._saveExternalEditor();
            }
        };
        doc.addEventListener("keydown", this._externalEditorSaveHandler);

        this._ensureMonacoLoader(doc).then(() => {
            if (!isWindowOpened(this._childWindow)) return;
            const monacoBase = `${APPLICATION_CONTEXT.url}${APPLICATION_CONTEXT.env.monaco}`;
            const editorHost = doc.getElementById(`${this.id}-external-editor`);
            if (!editorHost || !doc.defaultView?.require) return;

            doc.defaultView.require.config({ paths: { vs: monacoBase } });
            doc.defaultView.require(["vs/editor/editor.main"], () => {
                if (!editorHost || !doc.defaultView?.monaco) return;
                this._externalEditor = doc.defaultView.monaco.editor.create(editorHost, {
                    value: this._externalEditorInitialValue,
                    lineNumbers: "on",
                    roundedSelection: false,
                    ariaLabel: this.title,
                    readOnly: false,
                    theme: this._externalEditorOptions.theme,
                    language: this._externalEditorOptions.language,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                });
            });
        }).catch(error => {
            console.error(`Failed to initialize editor window "${this.id}".`, error);
            Dialogs.show($.t?.("monaco.saveError") || "Failed to initialize editor.", 3500, Dialogs.MSG_ERR);
        });
    }

    _ensureMonacoLoader(doc) {
        const childWindow = doc.defaultView;
        if (childWindow?.require) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const loaderId = "xopat-external-monaco-loader";
            const existing = doc.getElementById(loaderId);
            if (existing) {
                existing.addEventListener("load", () => resolve(), { once: true });
                existing.addEventListener("error", reject, { once: true });
                return;
            }

            const script = doc.createElement("script");
            script.id = loaderId;
            script.src = `${APPLICATION_CONTEXT.url}${APPLICATION_CONTEXT.env.monaco}loader.js`;
            script.onload = () => resolve();
            script.onerror = reject;
            doc.head.appendChild(script);
        });
    }

    _saveExternalEditor() {
        if (this._externalMode !== "editor") return;
        const value = this._externalEditor?.getValue?.() ?? this._externalEditorInitialValue;
        if (!this._externalSaveCallback) return;

        try {
            this._externalSaveCallback(value);
        } catch (error) {
            console.error(`External editor save callback failed for "${this.id}".`, error);
            Dialogs.show(
                $.t?.("monaco.saveError") || "Failed to save editor contents.",
                3500,
                Dialogs.MSG_ERR
            );
        }
    }

    _teardownExternalEditor() {
        if (this._childWindow?.document && this._externalEditorSaveHandler) {
            this._childWindow.document.removeEventListener("keydown", this._externalEditorSaveHandler);
        }
        this._externalEditorSaveHandler = null;

        try {
            this._externalEditor?.dispose?.();
        } catch {}
        this._externalEditor = null;
    }

    create() {
        const root = div({
                ...this.commonProperties,
                style: `
        position: fixed;
        width:${this._w}px; height:${this._h}px;
        left:${this._l}px; top:${this._t}px;
      `,
                onmousedown: () => this.focus()
            },
            this._header.create(),
            (this._bodyEl = this._content.create()),
            this._resizeHandle
        );

        queueMicrotask(() => {
            this._rootEl = document.getElementById(this.id);
            const headerEl = document.getElementById(this._header.id) || this._rootEl.firstChild;
            if (headerEl && headerEl.style) headerEl.style.touchAction = "none";
            const resizeEl = this._resizeHandle || null;

            this._fmToken = UI.Services.FloatingManager.register({
                el: this._rootEl,
                owner: this,
                onOutsideClick: () => this.focus(),
                onEscape: "close",
                clamp: {
                    margin: 6,
                    topBarId: "top-side",
                    cache: {
                        leftKey: this._cacheKey("l"),
                        topKey:  this._cacheKey("t")
                    }
                }
            });

            UI.Services.FloatingManager.enableDrag(this._fmToken, {
                handle: headerEl,
                persist: {
                    leftKey: this._cacheKey("l"),
                    topKey:  this._cacheKey("t")
                }
            });

            if (resizeEl) {
                UI.Services.FloatingManager.enableResize(this._fmToken, {
                    handle: resizeEl,
                    minW: 220,
                    minH: 140,
                    persist: {
                        widthKey:  this._cacheKey("w"),
                        heightKey: this._cacheKey("h")
                    }
                });
            }

            UI.Services.FloatingManager.clampNow(this._fmToken);
        });

        return root;
    }

    remove() {
        try { this._rootEl?.__fw_cleanup?.(); } catch {}
        super.remove();
    }
}
