import {Div} from "../classes/elements/div.mjs";

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
        this._canvasTapBound = (e) => this._handleCanvasTap(e);
    }

    init() {
        this._breakpoint = APPLICATION_CONTEXT.getOption("maxMobileWidthPx", undefined, false, true);
        this.context = document.getElementById("bottom-container");
        if (!this.context) {
            console.warn("MobileBottomBar: #bottom-container not found.");
            return;
        }

        this.root = this._build();
        this.context.appendChild(this.root);
        this.context.style.height = "auto";

        window.addEventListener("app:layout-change", (e) => {
            this.onLayoutChange(e.detail || { width: window.innerWidth });
        });

        window.addEventListener("pointerdown", this._syncBound, true);
        window.addEventListener("focusin", this._syncBound, true);
        // Tap-the-canvas-to-collapse-menu handler (mobile + Viewer-Menu only).
        // Capture phase so OSD's MouseTracker can't consume the gesture first.
        window.addEventListener("pointerdown", this._canvasTapBound, true);

        if (window.VIEWER_MANAGER?.addHandler) {
            VIEWER_MANAGER.addHandler("viewer-create", this._syncBound);
            VIEWER_MANAGER.addHandler("viewer-remove", this._syncBound);
        }

        this.sync();
        this.onLayoutChange({ width: window.innerWidth });
    }

    destroy() {
        window.removeEventListener("pointerdown", this._syncBound, true);
        window.removeEventListener("focusin", this._syncBound, true);
        window.removeEventListener("pointerdown", this._canvasTapBound, true);
        this._closeViewerPicker();
        this.root?.remove();
        this.root = null;
    }

    /**
     * Host an embedded toolbar host bar in the mobile bottom bar. MainLayout
     * owns the node and re-parents it here while a phone-width layout is active;
     * `unmountToolbarHost` removes it when returning to desktop.
     * @param {HTMLElement} node
     */
    mountToolbarHost(node) {
        // #bottom-container is a flex column. Put the toolbar on its OWN row
        // above the nav buttons (this.root) so it never crowds the nav row.
        if (!node || !this.context) return false;
        if (node.parentNode !== this.context) {
            this.context.insertBefore(node, this.root || null);
        }
        return true;
    }

    unmountToolbarHost(node) {
        if (node && this.context && node.parentNode === this.context) {
            this.context.removeChild(node);
        }
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

        const isMobile = this._isMobileWidth(width);

        if (isMobile) {
            this.context.style.height = "auto";
            this.context.style.overflow = "visible";

            // Mobile embedded mode should not rely on the old floating toolbar container.
            this._setToolbarsVisible(false);
        } else {
            this.context.style.height = "0px";
            this.context.style.overflow = "hidden";
            this._closeViewerPicker();
            this._setActivePanel(null);

            // Desktop floating mode still uses the floating container.
            this._setToolbarsVisible(true);

            // Mobile show/hide stamps inline display/visibility/pointerEvents
            // on each menu.context; class-based resets in RightSideViewerMenu
            // can't beat an inline `display:none`, so menus that were hidden
            // in mobile would stay invisible on desktop. Clear here.
            for (const menu of this.getViewerMenus()) {
                if (menu?.context) {
                    menu.context.style.display = "";
                    menu.context.style.visibility = "";
                    menu.context.style.pointerEvents = "";
                }
            }
        }

        this.sync();
    }

    _hideGlobalMenu() {
        const isMobile = this._isMobileWidth();

        if (isMobile) {
            window.LAYOUT?.closeGlobalMenuMobile();
            return;
        }

        const toolbars = document.getElementById("toolbars-container");
        if (toolbars) toolbars.style.display = "none";
        this._setToolbarsVisible(true);

        if (window.LAYOUT?.isOpened()) {
            window.LAYOUT.hideGlobalMenu();
        }
    }

    showGlobalMenu() {
        if (this._activePanel === "globalMenu") return;

        this._closeViewerPicker();
        this._hideViewerMenus();

        const isMobile = this._isMobileWidth();

        if (isMobile) {
            this._setToolbarsVisible(false);
            window.LAYOUT?.openGlobalMenuMobile?.();
        } else {
            this._setToolbarsVisible(true);
            window.LAYOUT?.closeFullscreen?.();
            window.LAYOUT?.showGlobalMenu?.();
        }

        this._setActivePanel("globalMenu");
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
            window.LAYOUT.syncActiveViewerMobile?.();
        }

        if (this.viewerButton) {
            this._setButtonLabel(this.viewerButton, this.getViewerLabel(activeViewer));
            this.viewerButton.disabled = false;
        }

        if (this.viewerMenuButton) {
            this.viewerMenuButton.disabled = this.getViewerMenus().length === 0;
        }

        // Keep the visible menu in lock-step with the active viewer while the
        // Viewer-Menu panel is open (mobile renders only the active viewer's
        // canvas, so only its menu should overlay).
        if (this._activePanel === "viewerMenu") {
            const activeMenu = this._getViewerMenu();
            for (const menu of this.getViewerMenus()) {
                if (menu === activeMenu) this._showViewerMenu(menu);
                else this._hideViewerMenu(menu);
            }
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
            "z-index: 980",
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
                window.LAYOUT?.syncActiveViewerMobile?.();
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

    _isMobileWidth(width = window.innerWidth) {
        return width < this._breakpoint;
    }

    _getToolbarsContainer() {
        return document.getElementById("toolbars-container");
    }

    _setToolbarsVisible(visible) {
        const toolbars = this._getToolbarsContainer();
        if (!toolbars) return;

        toolbars.style.display = visible ? "" : "none";
        toolbars.style.visibility = visible ? "visible" : "hidden";
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

    showViewerMenus() {
        const menus = this.getViewerMenus();
        if (!menus.length) return;
        if (this._activePanel === "viewerMenu") return;

        this._closeViewerPicker();
        this._hideGlobalMenu();
        window.LAYOUT?.closeFullscreen?.();

        // Show only the active viewer's menu; hide the rest. Mobile renders a
        // single viewer's canvas at a time, so stacking inactive viewers' menus
        // would only obscure the tissue.
        const activeMenu = this._getViewerMenu();
        for (const menu of menus) {
            if (menu === activeMenu) this._showViewerMenu(menu);
            else this._hideViewerMenu(menu);
        }
        this._setActivePanel("viewerMenu");
        this.sync();
    }

    /**
     * Capture-phase pointerdown handler: when the Viewer-Menu panel is open in
     * mobile mode, tapping the visible tissue collapses the menu (back to the
     * Viewer panel) and focuses the tapped viewer. Inside the menu / bottom bar
     * / AppBar the tap is left alone.
     * @private
     */
    _handleCanvasTap(e) {
        if (this._activePanel !== "viewerMenu") return;
        if (!this._isMobileWidth()) return;
        if (e.button !== undefined && e.button !== 0) return;

        const target = e.target;
        if (!target) return;

        // Ignore taps inside any visible viewer menu, the bottom bar itself, or
        // the AppBar/top container — those are not "the tissue".
        const insideMenu = this.getViewerMenus().some(m => m?.context?.contains?.(target));
        if (insideMenu) return;
        if (this.root?.contains?.(target)) return;
        if (document.getElementById("top-container")?.contains?.(target)) return;

        // Identify which viewer's cell was tapped (multi-viewport-safe).
        const tappedViewer = this.getViewers().find(v => v?.element?.contains?.(target));
        if (tappedViewer && tappedViewer !== this.getActiveViewer()) {
            window.VIEWER_MANAGER?.setActive?.(tappedViewer);
            window.LAYOUT?.syncActiveViewerMobile?.();
        }

        // Collapse the menu, switch back to the Viewer panel, and swallow the
        // gesture so OSD doesn't start a pan from this same pointerdown.
        this._hideViewerMenus();
        this._setActivePanel("viewer");
        this.sync();

        e.preventDefault();
        e.stopPropagation();
    }
}
