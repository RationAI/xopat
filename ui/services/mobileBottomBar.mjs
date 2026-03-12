export class MobileBottomBar {
    constructor() {
        this.context = null;
        this.root = null;
        this.viewerButton = null;
        this.viewerMenuButton = null;
        this.globalMenuButton = null;
        this.viewerPicker = null;
        this._outsideHandler = null;
        this._activeViewerId = null;
        this._activePanel = null;
        this._syncBound = () => this.sync();
    }

    init() {
        this.context = document.getElementById("bottom-container");
        if (!this.context) {
            console.warn("MobileBottomBar: #bottom-container not found.");
            return;
        }

        this.root = this._build();
        this.context.innerHTML = "";
        this.context.appendChild(this.root);
        this.context.style.height = "auto";

        window.addEventListener("app:layout-change", (e) => {
            this.onLayoutChange?.(e.detail || { width: window.innerWidth });
        });

        window.addEventListener("pointerdown", this._syncBound, true);
        window.addEventListener("focusin", this._syncBound, true);

        if (window.VIEWER_MANAGER?.addHandler) {
            VIEWER_MANAGER.addHandler("viewer-create", this._syncBound);
            VIEWER_MANAGER.addHandler("viewer-remove", this._syncBound);
        }

        this.sync();
        window.dispatchEvent(new CustomEvent("app:layout-change", {
            detail: { width: window.innerWidth }
        }));
    }

    destroy() {
        window.removeEventListener("pointerdown", this._syncBound, true);
        window.removeEventListener("focusin", this._syncBound, true);
        this._closeViewerPicker();
        this.root?.remove();
        this.root = null;
    }

    _build() {
        const root = document.createElement("div");
        root.id = "mobile-bottom-bar";
        root.className = "flex gap-1 items-center px-1 py-1";
        root.style.cssText = [
            "position: relative",
            "width: 100%",
            "box-sizing: border-box",
            "pointer-events: auto"
        ].join(";");

        this.viewerButton = this._createButton(
            "mobile-bottom-bar-viewer",
            "Viewer",
            "fa-solid fa-panorama",
            () => this.showViewerPicker()
        );
        this.viewerMenuButton = this._createButton(
            "mobile-bottom-bar-viewer-menu",
            "Viewer Menu",
            "fa-solid fa-sliders",
            () => this.showViewerMenus()
        );
        this.globalMenuButton = this._createButton(
            "mobile-bottom-bar-global-menu",
            "Global Menu",
            "fa-brands fa-readme",
            () => this.showGlobalMenu()
        );

        this.viewerButton.style.flex = "1 1 0";
        this.viewerMenuButton.style.flex = "1 1 0";
        this.globalMenuButton.style.flex = "1 1 0";

        root.append(this.viewerButton, this.viewerMenuButton, this.globalMenuButton);
        return root;
    }

    _createButton(id, label, iconClass, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.id = id;
        button.className = "btn";
        button.style.cssText = [
            "min-height: 40px",
            "padding: 0.2rem 0.35rem",
            "border-radius: 0.5rem",
            "white-space: normal",
            "display: inline-flex",
            "flex-direction: column",
            "align-items: center",
            "justify-content: center",
            "gap: 0.1rem",
            "line-height: 1.05",
            "text-align: center"
        ].join(";");

        const icon = document.createElement("i");
        icon.className = iconClass;
        icon.setAttribute("aria-hidden", "true");
        icon.style.cssText = [
            "font-size: 1.05rem",
            "line-height: 1",
            "flex: 0 0 auto"
        ].join(";");

        const text = document.createElement("span");
        text.textContent = label;
        text.style.cssText = [
            "overflow: hidden",
            "text-overflow: ellipsis",
            "font-size: 0.68rem",
            "max-width: 100%"
        ].join(";");

        button.append(icon, text);
        button._iconEl = icon;
        button._labelEl = text;
        button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick?.(e);
        });
        return button;
    }

    _setButtonLabel(button, label) {
        if (!button) return;
        if (button._labelEl) {
            button._labelEl.textContent = label;
        } else {
            button.textContent = label;
        }
    }

    _setButtonActive(button, active) {
        if (!button) return;
        button.classList.toggle("active", !!active);
        button.classList.toggle("pressed", !!active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
        button.style.fontWeight = active ? "600" : "";
        button.style.background = active ? "rgba(255,255,255,0.95)" : "";
        button.style.color = active ? "#111" : "";
        button.style.borderColor = active ? "rgba(0,0,0,0.25)" : "";
        button.style.boxShadow = active ? "inset 0 0 0 2px rgba(0,0,0,0.12)" : "";
        if (button._iconEl) {
            button._iconEl.style.opacity = active ? "1" : "0.85";
        }
    }

    _setActivePanel(panel) {
        this._activePanel = panel || null;
        this._setButtonActive(this.viewerButton, this._activePanel === "viewer");
        this._setButtonActive(this.viewerMenuButton, this._activePanel === "viewerMenu");
        this._setButtonActive(this.globalMenuButton, this._activePanel === "globalMenu");
    }

    onLayoutChange(details) {
        const width = details?.width ?? window.innerWidth;
        if (!this.context) return;
        this.context.style.height = width < 600 ? "auto" : "0px";
        this.context.style.overflow = width < 600 ? "visible" : "hidden";
        if (width >= 600) {
            this._closeViewerPicker();
            this._setActivePanel(null);
        }
        this.sync();
    }

    getActiveViewer() {
        return window.VIEWER_MANAGER?.get?.() || window.VIEWER || null;
    }

    getViewers() {
        return Array.isArray(window.VIEWER_MANAGER?.viewers)
            ? VIEWER_MANAGER.viewers.filter(Boolean)
            : (window.VIEWER ? [window.VIEWER] : []);
    }

    getViewerLabel(viewer) {
        const viewers = this.getViewers();
        const index = viewers.findIndex(v => v === viewer);
        if (index < 0) return viewers.length === 1 ? "Viewer 1" : "Viewer";
        return `Viewer ${index + 1}`;
    }

    sync() {
        const activeViewer = this.getActiveViewer();
        const nextId = activeViewer?.id || null;
        if (nextId !== this._activeViewerId) {
            this._activeViewerId = nextId;
        }

        if (this.viewerButton) {
            this._setButtonLabel(this.viewerButton, this.getViewerLabel(activeViewer));
            this.viewerButton.disabled = false;
        }

        if (this.viewerMenuButton) {
            this.viewerMenuButton.disabled = this.getViewerMenus().length === 0;
        }

        this._setActivePanel(this._activePanel);
    }

    showViewerPicker() {
        if (!this.viewerButton) return;
        if (this._activePanel === "viewer" && this.viewerPicker) return;

        this._hideViewerMenus();
        this._hideGlobalMenu();
        this._openViewerPicker();
        if (this.viewerPicker) this._setActivePanel("viewer");
    }

    _openViewerPicker() {
        const viewers = this.getViewers();
        if (!viewers.length || !this.viewerButton) return;

        this._closeViewerPicker();

        const picker = document.createElement("div");
        picker.id = "mobile-bottom-bar-viewer-picker";
        picker.className = "position-absolute rounded-2 shadow-2 bg-white";
        picker.style.cssText = [
            "left: 0",
            "bottom: calc(100% + 8px)",
            "min-width: max(180px, 40vw)",
            "max-width: min(320px, calc(100vw - 16px))",
            "z-index: 1200",
            "padding: 0.25rem",
            "display: flex",
            "flex-direction: column",
            "gap: 0.25rem"
        ].join(";");

        const activeViewer = this.getActiveViewer();
        viewers.forEach((viewer, index) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "btn text-left";
            item.style.cssText = [
                "display: inline-flex",
                "align-items: center",
                "gap: 0.5rem",
                "width: 100%",
                "text-align: left",
                "padding: 0.55rem 0.75rem",
                "border-radius: 0.5rem"
            ].join(";");

            const icon = document.createElement("i");
            icon.className = "fa-regular fa-square";
            icon.setAttribute("aria-hidden", "true");
            icon.style.fontSize = "0.9em";

            const text = document.createElement("span");
            text.textContent = `Viewer ${index + 1}`;

            item.append(icon, text);
            if (viewer === activeViewer) {
                item.classList.add("pressed");
                item.setAttribute("aria-current", "true");
            }
            item.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.VIEWER_MANAGER?.setActive?.(viewer);
                this.sync();
                this._closeViewerPicker();
                this._setActivePanel("viewer");
            });
            picker.appendChild(item);
        });

        this.root.appendChild(picker);
        this.viewerPicker = picker;

        const pickerRect = picker.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const margin = 8;
        let left = 0;
        if (pickerRect.right > viewportWidth - margin) {
            left -= pickerRect.right - (viewportWidth - margin);
        }
        if (pickerRect.left + left < margin) {
            left += margin - (pickerRect.left + left);
        }
        picker.style.left = `${left}px`;

        this._outsideHandler = (event) => {
            if (!this.viewerPicker) return;
            const target = event.target;
            if (target instanceof Node && (this.viewerPicker.contains(target) || this.viewerButton.contains(target))) {
                return;
            }
            this._closeViewerPicker();
        };
        window.addEventListener("pointerdown", this._outsideHandler, true);
    }

    _closeViewerPicker() {
        if (this._outsideHandler) {
            window.removeEventListener("pointerdown", this._outsideHandler, true);
            this._outsideHandler = null;
        }
        this.viewerPicker?.remove();
        this.viewerPicker = null;
    }

    _getViewerMenu(viewer = undefined) {
        const target = viewer || this.getActiveViewer();
        if (!target || !window.VIEWER_MANAGER?.getMenu) return null;
        return VIEWER_MANAGER.getMenu(target) || null;
    }

    getViewerMenus() {
        return this.getViewers()
            .map((viewer) => this._getViewerMenu(viewer))
            .filter(Boolean);
    }

    _showViewerMenu(menu) {
        if (!menu) return;

        menu.setClass?.("mobile", "mobile");
        menu.setClass?.("display", "");

        if (menu.context) {
            menu.context.style.display = "";
            menu.context.style.visibility = "visible";
            menu.context.style.pointerEvents = "auto";
        }

        const tabs = menu.menu?.tabs ? Object.values(menu.menu.tabs) : [];
        tabs.forEach((tab) => {
            tab?.mainDiv?.setClass?.("display", "");
            tab?.openDiv?.setClass?.("display", "");
            tab?.pin?.setClass?.("display", "");
            tab?._setFocus?.();
        });
    }

    _hideViewerMenu(menu) {
        if (!menu) return;
        if (menu.context) {
            menu.context.style.display = "none";
            menu.context.style.visibility = "hidden";
            menu.context.style.pointerEvents = "none";
        }
        menu.setClass?.("display", "hidden");
    }

    _hideViewerMenus() {
        this.getViewerMenus().forEach((menu) => this._hideViewerMenu(menu));
    }

    _hideGlobalMenu() {
        const toolbars = document.getElementById("toolbars-container");
        if (toolbars) toolbars.style.display = "none";
        if (window.LAYOUT?.isOpened?.()) {
            window.LAYOUT.toggle?.();
        }
    }

    showViewerMenus() {
        const menus = this.getViewerMenus();
        if (!menus.length) return;
        if (this._activePanel === "viewerMenu") return;

        this._closeViewerPicker();
        this._hideGlobalMenu();
        window.LAYOUT?.closeFullscreen?.();

        menus.forEach((menu) => this._showViewerMenu(menu));
        this._setActivePanel("viewerMenu");
        this.sync();
    }

    showGlobalMenu() {
        if (this._activePanel === "globalMenu") return;

        this._closeViewerPicker();
        this._hideViewerMenus();

        const toolbars = document.getElementById("toolbars-container");
        if (toolbars) {
            toolbars.style.display = "";
        }

        window.LAYOUT?.closeFullscreen?.();
        window.LAYOUT?.toggle?.();
        if (!window.LAYOUT?.isOpened?.()) {
            window.LAYOUT?.show?.();
        }

        this._setActivePanel("globalMenu");
        this.sync();
    }
}
