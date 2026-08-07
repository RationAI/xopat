import {SlideSwitcherMenu} from "./slideSwitcherMenu.mjs";
addPlugin('slide-info', class extends XOpatPlugin {
    constructor(id) {
        super(id);

        // Kick the locale fetch off immediately — constructors cannot await,
        // and early UI (demo page, viewer menus) reads from this namespace.
        // pluginReady() awaits this promise before building the switcher.
        this._localeReady = this.loadLocale().catch(() =>
            // Language file missing (only `en` is shipped) — register the
            // English bundle so i18next's fallbackLng resolves our keys.
            this.loadLocale('en').catch(e => console.warn("slide-info: failed to load locale", e)));

        // Render with `renderUIFromJson` (the strict, schema-driven strategy)
        // instead of `guessUIFromJson` — the slide-info panel now consumes the
        // typed `TileSource.getDisplayMetadata()` contract (see src/tile-source.ts)
        // so it never has to introspect raw TileSource instances.
        this.infoMenuBuilder = new AdvancedMenuPages(this.id, 'renderUIFromJson');
        this.hasCustomBrowser = false;

        this.slideSwitching = this.getOptionOrConfiguration('slideSwitching', 'slideSwitching', true);
        this.slideBrowser = this.getOptionOrConfiguration('slideBrowser', 'slideBrowser', true);

        this.infoMenuBuilder.buildViewerMenu(viewer => {

            // Stable id (not viewer-scoped) — registerViewerMenu already
            // prefixes with the plugin id, and each viewer's MultiPanelMenu is
            // its own instance, so an id collision across viewers is fine.
            // Using a viewer-specific id here would produce a *different*
            // AppBar.View tab entry per viewer, defeating the dropdown's
            // group-by-id fan-out (it shows two "Slide Information" rows).
            let result = {
                id: 'slide-info',
                title: this.t('info.title'),
                icon: 'ph-info',
                page: undefined
            };

            try {
                const mainTiledImage = viewer.world.getItemAt(0);
                const source = mainTiledImage?.source;
                const raw = source?.getDisplayMetadata?.();
                const sections = Array.isArray(raw) ? raw : [];
                const technical = sections.map(section => this._displaySectionToSpec(section));

                // Human-facing opt-in: the slide-info panel is a legitimate consumer of the
                // identifying/clinical data kept out of the general (LLM/scripting) surface.
                // Render it as a dedicated "Clinical information" card, sourced from the generic
                // TileSource.getSensitiveMetadata() contract (see src/tile-source.ts).
                const clinical = this._clinicalSection(source);

                // Order: physical slide label (top), then clinical info, then the
                // technical metadata behind a collapse (collapsed by default).
                const labelId = `slide-info-label-${viewer.id}`;
                const page = [
                    // Placeholder revealed by the async label fetch below; stays
                    // hidden when the slide exposes no label image.
                    { type: "div", id: labelId, extraClasses: "hidden mb-3 flex justify-center" },
                ];
                if (clinical) page.push(this._displaySectionToSpec(clinical));
                // Technical block is a placeholder filled post-render with a real
                // <details> node — the menu-pages string→innerHTML path runs a
                // sanitizer that strips <details>/<summary> (only div-like tags
                // survive), so a declarative {type:"collapse"} loses its wrapper.
                const techId = `slide-info-tech-${viewer.id}`;
                if (technical.length) {
                    page.push({ type: "div", id: techId, extraClasses: "hidden" });
                }
                if (!clinical && !technical.length) page.push(this._noMetadataSpec());

                result.page = page;

                // Fire-and-forget fills (once the page is in the DOM).
                const bg = mainTiledImage?.getConfig?.("background")
                    || viewer?.scalebar?.getReferencedTiledImage?.()?.getConfig?.("background")
                    || null;
                if (bg?.id) this._fillSlideLabel(viewer, bg, labelId);
                if (technical.length) this._fillTechnical(techId, technical);
            } catch (e) {
                console.error('Failed to load slide meta for slide viewer', viewer, e);
                result.page = [{
                    type: "div", extraClasses: "p-3 text-sm text-error",
                    children: [this.t('info.loadFailed')]
                }];
            }

            return result;
        });

        VIEWER_MANAGER.addHandler('after-open', e => {
            // Light path: an open/close never changes the external listing, so
            // only re-sync the open-state (header, badges, catalog levels when
            // the background catalog itself grew). Full refresh() would clear
            // the explorer store and re-fetch the whole directory level.
            if (this.slideBrowser) this.menu?.syncOpenState?.();
        });

        // --- Visited-slides tracking -----------------------------------------
        // "Visited" = a slide has been shown in some viewer at least once. The
        // flag is USER HISTORY, not slide config — it must NOT live on the
        // background config (that is a session/POST_DATA snapshot, gets
        // serialized into exported sessions and reset on load). It is persisted
        // via the IO pipeline KV namespace `kv:visited`: local-storage by
        // default, but an operator can rebind it to a server driver.
        //
        // Keyed by the stable background id via UTILITIES.currentBackgroundIdFor
        // (virtual-region children fold to their parent, matching how the IO
        // pipeline keys per-(viewer,background) bundles). The background id is derived
        // deterministically from the slide locator when not author-supplied, so
        // it is stable across sessions and available for closed slides too
        // (tileSourceId is not — it only exists once a source has loaded).
        this._visited = new Map();
        this._visitedReady = new Promise(res => { this._resolveVisitedReady = res; });
        // Per-viewer open event: derive the viewer from the event source, never
        // window.VIEWER (multi-viewport correctness).
        VIEWER_MANAGER.broadcastHandler('open', e => this._markVisited(e.eventSource));

        VIEWER_MANAGER.broadcastHandler('show-demo-page', e => {
            // Only show our custom UI if there isn't a specific loading error
            if (e.htmlError) return;

            const showExplorer = () => {
                this.menu?.visibilityManager.on();
            };

            // TODO: does not work, OSD overlays are hidden behind another canvas - either annotations
            // const openBtn = new UI.Button({
            //     onClick: showExplorer,
            //     extraClasses: "btn-primary btn-lg shadow-lg",
            // }, "Open Slide Manager").create();
            //
            // new OpenSeadragon.MouseTracker({
            //     element: openBtn,
            //     handler: (event) => {
            //         // This prevents OSD from panning the viewer when you click the button
            //         event.preventDefaultAction = true;
            //     }
            // });

            const demoUI = van.tags.div({
                    id: e.id,
                    class: "flex flex-col items-center justify-center h-full p-4 text-center m-8"
                },
                van.tags.div({ class: "mb-6 opacity-20" },
                    new UI.FAIcon({ name: "fa-images", extraClasses: "text-9xl" }).create()
                ),
                van.tags.h2({ class: "text-2xl font-bold mb-2" }, this.t('demo.title')),
                van.tags.p({ class: "max-w-md mb-6 opacity-70" }, this.t('demo.hint')),
                // openBtn
            );

            e.show(demoUI);
        });

        this._customControlButtons = undefined;
        this._customControlsInitialized = false;
        if (this.slideSwitching) {
            this.setupSlideSwitching();
        }
    }

    /**
     * Render a single `TileSourceDisplaySection` into the UI-JSON spec consumed
     * by `AdvancedMenuPages.renderUIFromJson`. Defensive against malformed input:
     * non-primitive `value`s are coerced to JSON; missing labels/values are
     * skipped silently.
     * @private
     */
    _displaySectionToSpec(section) {
        const children = [];
        if (section.title) {
            children.push({ type: "div", extraClasses: "text-base font-semibold mb-2", children: [String(section.title)] });
        }
        if (section.description) {
            children.push({
                type: "div",
                extraClasses: "text-sm whitespace-pre-wrap break-words leading-relaxed opacity-90",
                children: [String(section.description)]
            });
        }
        if (Array.isArray(section.fields) && section.fields.length) {
            const rows = [];
            for (const f of section.fields) {
                if (!f || f.label == null) continue;
                const v = f.value;
                const text = v == null ? "—"
                    : typeof v === "string" ? v
                        : typeof v === "number" || typeof v === "boolean" ? String(v)
                            : JSON.stringify(v);
                rows.push({ type: "div", extraClasses: "text-xs opacity-70 col-span-1", children: [String(f.label)] });
                rows.push({ type: "div", extraClasses: "text-sm font-mono col-span-1 break-words", children: [text] });
            }
            if (rows.length) {
                children.push({ type: "div", extraClasses: "grid grid-cols-2 gap-x-3 gap-y-1 mt-2", children: rows });
            }
        }
        return { type: "div", extraClasses: "card bg-base-100 shadow-sm p-3 mb-3 rounded-md border border-base-300", children };
    }

    /**
     * Build a `TileSourceDisplaySection` from the source's identifying/clinical metadata
     * (`TileSource.getSensitiveMetadata()`), or null when the source exposes nothing. The
     * sensitive metadata is a free-form (possibly one-level nested) object; it is flattened into
     * label/value field rows with humanized labels. Returns a section reusing the same rendering
     * path as the technical slide sections (`_displaySectionToSpec`).
     * @private
     */
    _clinicalSection(source) {
        let meta;
        try {
            meta = source?.getSensitiveMetadata?.();
        } catch (e) {
            return null;
        }
        if (!meta || typeof meta !== "object") return null;

        const fields = [];
        const push = (label, value, prefix) => {
            if (value == null || value === "") return;
            if (typeof value === "object" && !Array.isArray(value)) {
                // One level of nesting (e.g. { patient: {...} }) — flatten with a label prefix.
                for (const [k, v] of Object.entries(value)) push(this._humanizeKey(k), v, prefix);
                return;
            }
            const text = Array.isArray(value) ? value.filter(v => v != null).join(", ") : String(value);
            if (text === "") return;
            fields.push({ label: prefix ? `${prefix} · ${label}` : label, value: text });
        };
        for (const [k, v] of Object.entries(meta)) push(this._humanizeKey(k), v);

        if (!fields.length) return null;
        return { title: this.t('info.clinicalTitle'), fields };
    }

    /**
     * Turn a metadata key (camelCase / snake_case / UID-ish) into a human label, e.g.
     * `biopsyHistory` → "Biopsy History", `patientID` → "Patient ID".
     * @private
     */
    _humanizeKey(key) {
        return String(key)
            .replace(/UID\b/g, " UID")
            .replace(/ID\b/g, " ID")
            .replace(/[_-]+/g, " ")
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/^./, c => c.toUpperCase());
    }

    /**
     * Inject the collapsible "Technical details" block into its placeholder as a
     * real `UI.Collapse` (native `<details>`) node — appended to the DOM directly
     * so it never passes back through the menu-pages sanitizer that would strip
     * the `<details>`/`<summary>` wrapper. Sections are pre-rendered via the same
     * `renderUIFromJson` (safe div structure) and become the collapse content.
     * @private
     */
    _fillTechnical(containerId, technicalSpecs) {
        let tries = 0;
        const attempt = () => {
            const host = document.getElementById(containerId);
            if (!host) {
                if (tries++ < 5) requestAnimationFrame(attempt);
                return;
            }
            const contentNodes = technicalSpecs.map(spec => {
                const wrap = document.createElement("div");
                wrap.innerHTML = this.infoMenuBuilder.renderUIFromJson(spec);
                return wrap;
            });
            const collapse = new UI.Collapse(
                { title: this.t('info.technicalTitle'), open: false },
                ...contentNodes
            );
            host.innerHTML = "";
            host.appendChild(UI.BaseComponent.toNode(collapse));
            host.classList.remove("hidden");
        };
        requestAnimationFrame(attempt);
    }

    /** @private */
    _noMetadataSpec() {
        return {
            type: "div",
            extraClasses: "p-3 text-sm opacity-70",
            children: [this.t('info.noMetadata')]
        };
    }

    setupSlideSwitching() {
        VIEWER_MANAGER.addHandler('viewer-create', e => {
            this._createControlButtons(e.viewer);
        });
        VIEWER_MANAGER.addHandler('viewer-destroy', e => {
            // todo this needs to be fixed in some api-level way
            document.getElementById("slide-info-control-bar-"+e.viewer.id)?.remove();
        });
        this._customControlsInitialized = true;
    }

    /**
     * Register the prev/next slide keyboard shortcuts. Idempotent; owner is the
     * plugin id so the manager can bulk-unregister on teardown. Handler receives
     * the focus-derived viewer (multi-viewport correct).
     * @private
     */
    _registerShortcuts() {
        const shortcuts = APPLICATION_CONTEXT?.shortcuts;
        if (!shortcuts || this._shortcutsRegistered || !this.slideSwitching) return;

        const NAV = ["keymap.cat.core", "keymap.cat.navigation"];
        const mk = (id, combo, forward, titleKey, descKey) => shortcuts.register({
            id,
            titleKey: `${this.id}:${titleKey}`,
            descriptionKey: `${this.id}:${descKey}`,
            categoryPath: NAV,
            defaultCombos: [combo],
            owner: this.id,
            type: "press",
            trigger: "down",
            scope: { requiresCanvasFocus: true, allowInInputs: false },
            handler: ({ viewer }) => this._navigateSlide(forward, viewer || VIEWER_MANAGER.get?.()),
        });
        mk("slide-info.nav.prevSlide", "BracketLeft", false, "keymap.prevSlide", "keymap.prevSlideDesc");
        mk("slide-info.nav.nextSlide", "BracketRight", true, "keymap.nextSlide", "keymap.nextSlideDesc");
        this._shortcutsRegistered = true;
    }

    /**
     * Prev/next dispatcher. Prefers hierarchy-aware navigation via the slide
     * switcher (siblings within the currently-browsed level); falls back to a
     * linear walk of the flat catalog when the browser is disabled.
     * @private
     */
    _navigateSlide(forward, viewer) {
        if (!viewer) return;
        if (this.slideBrowser && this.menu) {
            this.menu.navigateSibling(forward, viewer)
                .catch(e => console.warn("slide-info: navigateSibling failed", e));
            return;
        }
        this._navigateSlideLinear(forward, viewer);
    }

    /**
     * Linear fallback over `config.background[]`, operating on the given viewer's
     * OWN slot index (not the focus-global scalar) so it is multi-viewport safe.
     * @private
     */
    _navigateSlideLinear(forward, viewer) {
        const backgrounds = APPLICATION_CONTEXT.config.background;
        if (!Array.isArray(backgrounds) || !backgrounds.length) return;

        const slot = Math.max(0, (VIEWER_MANAGER.viewers || []).indexOf(viewer));
        const sel = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, true, true);
        const arr = Array.isArray(sel) ? sel.slice() : (Number.isInteger(sel) ? [sel] : [0]);
        const current = Number.isInteger(arr[slot]) ? arr[slot] : 0;
        const next = current + (forward ? 1 : -1);
        if (next < 0) return Dialogs.show(this.t('firstSlide'), 3000, Dialogs.MSG_INFO);
        if (next >= backgrounds.length) return Dialogs.show(this.t('lastSlide'), 3000, Dialogs.MSG_INFO);

        arr[slot] = next;
        APPLICATION_CONTEXT.openViewerWith(
            APPLICATION_CONTEXT.config.data,
            APPLICATION_CONTEXT.config.background,
            APPLICATION_CONTEXT.config.visualizations,
            arr
        );
    }

    // ---------- Visited-slides store ----------

    /**
     * Resolve the visited-store key for a background config. Folds virtual-region
     * children onto their parent (mirrors UTILITIES.currentBackgroundIdFor) so all
     * split modes of one slide share a single visited record.
     * @private
     */
    _visitedKeyForBackground(bg) {
        if (!bg) return undefined;
        const id = typeof bg.virtualOf === "string" ? bg.virtualOf : bg.id;
        return typeof id === "string" ? id : undefined;
    }

    /**
     * The visited-store key for the slide currently shown in a viewer: the stable
     * background id (UTILITIES.currentBackgroundIdFor, folding virtual regions to
     * their parent) — the same convention _visitedKeyForBackground uses.
     * @private
     */
    _visitedKeyForViewer(viewer) {
        return UTILITIES.currentBackgroundIdFor(viewer);
    }

    /**
     * Hydrate the in-memory visited map from the KV store. Called once from
     * pluginReady; resolves `_visitedReady` so marks queued during boot proceed.
     * @private
     */
    async _hydrateVisited() {
        try {
            // Async handle: works whether the bound driver is sync (local-storage)
            // or an async server driver, without a sync/async mismatch throw.
            this._visitedKv = IO_PIPELINE.kv(this.uid, "kv:visited", { sync: false });
            const raw = await this._visitedKv.getItem("map");
            if (raw) {
                const obj = JSON.parse(raw);
                if (obj && typeof obj === "object") {
                    for (const [k, v] of Object.entries(obj)) {
                        if (k && v && typeof v === "object") this._visited.set(k, v);
                    }
                }
            }
        } catch (e) {
            console.warn("slide-info: failed to hydrate visited store", e);
        } finally {
            this._resolveVisitedReady();
            // A server-bound visited store (kv:visited -> a server driver) hydrates
            // asynchronously, so slides marked seen elsewhere (e.g. MIXTURE's
            // per-user flag) aren't known until now — repaint the switcher so their
            // badge shows without waiting for the next refresh.
            if (!this.hasCustomBrowser && this.slideBrowser) this.menu?.refresh();
        }
    }

    /** Persist the whole visited map (fire-and-forget). @private */
    _persistVisited() {
        if (!this._visitedKv) return;
        try {
            const obj = Object.fromEntries(this._visited);
            Promise.resolve(this._visitedKv.setItem("map", JSON.stringify(obj)))
                .catch(e => console.warn("slide-info: failed to persist visited store", e));
        } catch (e) {
            console.warn("slide-info: failed to serialize visited store", e);
        }
    }

    /**
     * Mark the slide currently shown in a viewer as visited. Idempotent for the
     * persisted flag (updates lastOpenedAt/count on repeat opens); fires
     * `slide-visited` only on the first-ever visit of a background.
     * @private
     */
    async _markVisited(viewer) {
        if (!viewer) return;
        await this._visitedReady;
        const id = this._visitedKeyForViewer(viewer);
        if (!id) return;

        const now = Date.now();
        const existing = this._visited.get(id);
        const firstVisit = !existing;
        const record = existing || { firstOpenedAt: now, lastOpenedAt: now, count: 0 };
        record.lastOpenedAt = now;
        record.count = (record.count || 0) + 1;
        this._visited.set(id, record);
        this._persistVisited();

        if (firstVisit) {
            /**
             * A background was shown in a viewer for the first time.
             * @event slide-visited
             * @property {string} backgroundId stable visited-store key
             * @property {string} viewerId owning viewer uniqueId
             * @property {object} record { firstOpenedAt, lastOpenedAt, count }
             */
            this.raiseEvent('slide-visited', { backgroundId: id, viewerId: viewer.uniqueId, record });
            // Reflect the new badge in the switcher.
            if (!this.hasCustomBrowser && this.slideBrowser) this.menu?.refresh();
        }
    }

    /**
     * Whether a slide has been visited. Accepts a background config object, a
     * background id string, or a viewer.
     * @param {object|string} ref background config / id / viewer
     * @returns {boolean}
     */
    isVisited(ref) {
        const id = typeof ref === "string" ? ref
            : ref?.world ? UTILITIES.currentBackgroundIdFor(ref)   // viewer
                : this._visitedKeyForBackground(ref);                  // background config
        return !!(id && this._visited.has(id));
    }

    /**
     * The visited record for a slide, or null.
     * @param {object|string} ref background config / id / viewer
     * @returns {{firstOpenedAt:number,lastOpenedAt:number,count:number}|null}
     */
    getVisited(ref) {
        const id = typeof ref === "string" ? ref
            : ref?.world ? UTILITIES.currentBackgroundIdFor(ref)
                : this._visitedKeyForBackground(ref);
        return (id && this._visited.get(id)) || null;
    }

    /**
     * Clear visited state for one slide, or all when no argument is given.
     * Fires no `slide-visited` event (that is emit-on-first-visit only).
     * @param {object|string} [ref] background config / id; omit to clear all
     */
    clearVisited(ref) {
        if (ref === undefined) {
            this._visited.clear();
        } else {
            const id = typeof ref === "string" ? ref : this._visitedKeyForBackground(ref);
            if (id) this._visited.delete(id);
        }
        this._persistVisited();
        if (!this.hasCustomBrowser && this.slideBrowser) this.menu?.refresh();
    }

    /**
     * Fetch the physical slide label for a viewer's background and inject it into
     * the placeholder container (by id) once the info page is in the DOM. Hidden
     * when the slide exposes no label. Cached per background id.
     * @private
     */
    _fillSlideLabel(viewer, bg, containerId) {
        if (!bg?.id || typeof viewer?.tools?.retrieveLabel !== "function") return;
        const cache = (this._infoLabelCache ||= {});

        const reveal = (imgNode) => {
            if (!(imgNode instanceof HTMLElement)) return;
            let tries = 0;
            const attempt = () => {
                const host = document.getElementById(containerId);
                if (!host) {
                    // The menu tab may not have materialized yet — retry a few frames.
                    if (tries++ < 5) requestAnimationFrame(attempt);
                    return;
                }
                const clone = imgNode.cloneNode(true);
                clone.removeAttribute("id");
                // Inline sizing: the shipped tailwind build is purged, so avoid
                // relying on max-h-* / object-* utilities being present.
                clone.className = "block rounded border border-base-300 select-none";
                clone.style.cssText = "max-height:160px;max-width:100%;object-fit:contain;";
                clone.draggable = false;
                host.innerHTML = "";
                host.appendChild(clone);
                host.classList.remove("hidden");
            };
            requestAnimationFrame(attempt);
        };

        if (cache[bg.id] instanceof HTMLElement) return reveal(cache[bg.id]);
        if (cache[bg.id] instanceof Promise) {
            cache[bg.id].then(n => { if (n) reveal(n); }).catch(() => {});
            return;
        }
        cache[bg.id] = viewer.tools.retrieveLabel(bg).then(node => {
            if (node) { cache[bg.id] = node; reveal(node); }
            return node;
        }).catch(err => {
            // Missing labels are expected for many tile sources — keep quiet.
            console.debug("slide-info: label load failed", err);
            delete cache[bg.id];
        });
    }

    async pluginReady() {
        await this._localeReady;
        // Load visited history before first render so already-seen slides show
        // the badge immediately (and resolve the gate for early open events).
        await this._hydrateVisited();
        if (this.slideBrowser) {
            this.menu = new SlideSwitcherMenu({
                id: `${this.id}-slide-switcher`,
                title: this.t('switcher.title'),
                layout: globalThis.LAYOUT,
                ownerPluginId: this.id,
            });
            this.menu.attachToMainLayout();
            if (!this.hasCustomBrowser) this.menu.refresh();
        }
        // Register after locale load so the Keymap panel shows resolved titles.
        this._registerShortcuts();
    }

    /**
     * @callback customItemToBackground
     * @param {object} item item that is being browsed: a generic object that you returned from the hierarchy getter
     * @returns {StandaloneBackgroundItem}
     * The return value should include optional ID property.
     */

    /**
     * @callback backgroundToCustomItem
     * @param {StandaloneBackgroundItem} item item that is being browsed: a generic object that you returned from the hierarchy getter
     * @returns {object}
     * The return value should include optional ID property.
     */

    /**
     * Set custom browser hierarchy for the slide item browser.
     * Note that you should do this before the viewer is opened. If you cannot do it, you can use setWillInitCustomBrowser instead,
     * and initialize the UI later on.
     * @param {UI.Explorer.Options|undefined|false} config if falsey value, customization is disabled
     * @param {customItemToBackground} config.customItemToBackground a function that from explorer leaf item returns BG configuration,
     *  the configuration must be of a type StandaloneBackgroundItem as the browsing is not dependent on the active session.
     *  May return null/undefined to refuse opening a malformed item (surface the reason to the user yourself).
     * @param {backgroundToCustomItem} config.backgroundToCustomItem a function that does the opposite of customItemToBackground,
     *  since the viewer can open a cached session and needs to know the original item to open.
     * @param {(item: object) => Promise<Blob|null>} [config.getItemPreview] optional lazy thumbnail
     *  provider for leaf items whose slide is not open in any viewer — return an image Blob or
     *  null to keep the placeholder. Results are cached per background id.
     */
    setCustomBrowser(config) {
        if (!this.slideBrowser) {
            console.warn("Slide browser is disabled, skipping setCustomBrowser call.");
            return;
        }
        if (this.hasCustomBrowser && this.menu.orgConfig?.id && this.menu.orgConfig?.id !== config?.id) {
            console.warn(`Slide browser is already configured with different ID ${this.menu.orgConfig.id}, consider keeping only one browsing configuration. Overwriting with ${config.id}.`);
        }
        this.menu.refresh(config);
        this.hasCustomBrowser = !!config;
    }

    /**
     * In case you cannot set the browser hierarchy before the viewer is opened, you can use this method to set the configuration
     * and initialize the UI later on.
     */
    setWillInitCustomBrowser() {
        this.menu.refresh({});
        this.hasCustomBrowser = true;
    }

    /**
     * Add custom control buttons to the viewer.
     * TODO redesign this
     * @param children
     */
    addCustomViewerButtons(...children) {
        if (!children.length) return;

        if (this._customControlButtons === undefined) {
            // todo consider using JOIN, or better yet, use toolbar view once ready (with nested items strategy)
            this._customControlButtons = van.tags.div({class: "mx-2 my-0 px-2 py-1 bg-base-100 flex flex-row rounded-md"});
        }
        for (let ch of children) this._customControlButtons.appendChild(UI.BaseComponent.toNode(ch));

        if (this._customControlsInitialized) {
            for (let viewer of VIEWER_MANAGER.viewers) {
                this._createControlButtons(viewer);
            }
        }
    }

    _createControlButtons(viewer) {
        // todo consider supporting switching between slides, need to work reasonably with multiple viewers
        // const active = APPLICATION_CONTEXT.config.background.length <= 1 ? {"active": "disabled"} : undefined;
        // USER_INTERFACE.addViewerHtml(
        //     van.tags.div({class: "absolute bottom-0 left-[50%] flex flex-row", id: "slide-info-control-bar-"+viewer.id, style: "transform: translate(-50%, 0);"},
        //         new UI.Button({onClick: this.changeSlide.bind(this, false), extraClasses: active}, '❮❮').create(),
        //         this._customControlButtons,
        //         new UI.Button({onClick: this.changeSlide.bind(this, true), extraClasses: active}, '❯❯').create()
        //     ), this.id, viewer.id);
    }
});