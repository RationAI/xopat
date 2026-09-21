(function (global) {
    'use strict';

    /**
     * Module entry. Owns the whole measurements feature: the compute engine, the
     * scripting namespace, and the UI (workspace + popover) — the UI used to live
     * in the annotations plugin, which made measurements unavailable to any
     * deployment that did not ship that plugin, even though the engine only ever
     * needed the annotations *module*.
     */
    class AnnotationMeasurementsModule extends XOpatModuleSingleton {
        constructor() {
            super();
            this._workspace = null;
            this._popover = null;

            // Keep the handle: anything that renders a label must await this. i18next is
            // already initialised by now, so a `t()` before the bundle registers returns
            // the raw dotted key — and a string captured into `AppBar.Tools.register` or
            // into a built DOM node never self-heals, even though later `t()` calls do.
            // (Production bakes every module locale at boot, so this only bites in dev —
            // which is exactly where it is most confusing.) Same pattern as
            // `modules/speech-to-text` and `modules/markdown`.
            this._localeReady = this.loadLocale().catch(() =>
                // Only `en` is shipped; register it so i18next's fallbackLng
                // resolves our keys instead of printing the dotted key.
                this.loadLocale('en')).catch((e) =>
                    console.warn('[annotation-measurements] locale load failed:', e));

            // Modules have no `pluginReady`; `before-app-init` is the sanctioned
            // early hook and fires once USER_INTERFACE exists but before the first
            // slide opens. A module pulled in later (a plugin loaded mid-session)
            // has already missed that event, so register straight away when the
            // app bar is standing.
            this._uiRegistered = false;
            VIEWER_MANAGER.addHandler('before-app-init', () => this._registerUiEntries());
            if (global.USER_INTERFACE?.AppBar?.Tools) this._registerUiEntries();
        }

        /**
         * Resolves once the locale bundle is registered. Await before rendering any
         * label; `t()` before this returns the raw key.
         */
        whenLocaleReady() {
            return this._localeReady || Promise.resolve();
        }

        /**
         * i18next escapes interpolated values by default, and its table maps `/` to
         * `&#x2F;`. Everything here is written with `textContent`, so that entity is
         * shown literally — "0.25 µm&#x2F;px". Escaping is the caller's job only when the
         * result reaches HTML, and it never does in this module.
         *
         * Only the with-variables path is overridden; the no-args path stays on the base
         * implementation so its memoisation still applies.
         */
        t(key, options) {
            if (!options) return super.t(key);
            return super.t(key, { ...options, interpolation: { escapeValue: false } });
        }

        /**
         * Lazy: created on first use because module load order may precede
         * OSDAnnotations.instance() being available.
         */
        getEngine() {
            if (!this._engine) {
                this._engine = new global.AnnotationMeasurements.MeasurementEngine({});
            }
            return this._engine;
        }

        /**
         * Resets the cached engine so it picks up a freshly-bound annotations
         * singleton on the next access. Mostly useful for tests.
         */
        resetEngine() {
            this._engine = null;
        }

        /**
         * The sampling configuration every surface shares — a user preference
         * persisted through the module option map (kv:cache), never a security
         * decision, so `getOption` is the right home for it (AGENTS.md §7).
         */
        samplingConfig() {
            const auto = this.getOption('autoThreshold', true) !== false;
            return {
                source: this.getOption('source', 'rendered'),
                channel: this.getOption('channel', 'V'),
                threshold: auto ? 'auto' : (Number(this.getOption('threshold', 128)) || 128),
                targetMpp: Number(this.getOption('targetMpp', 1)) || 1,
            };
        }

        get annotations() {
            return global.OSDAnnotations?.instance?.() || null;
        }

        /**
         * The optional pathology module, or null. Never hard-required:
         * `singletonModule` throws when the module is not loaded.
         */
        pathology() {
            try {
                return (typeof singletonModule === 'function') ? singletonModule('pathology-foundation') : null;
            } catch (e) {
                return null;
            }
        }

        /**
         * How far from the subject a tissue island may sit, as a fraction of the
         * current viewport width — so the rule follows the zoom. User preference.
         */
        tissueFactor() {
            return Number(this.getOption('tissueFactor', 0.25)) || 0.25;
        }

        /** Width of the current viewport in image px — the unit proximity is quoted in. */
        _viewportWidthImagePx(viewer) {
            const image = viewer?.scalebar?.getReferencedTiledImage?.() || viewer?.world?.getItemAt?.(0);
            const bounds = viewer?.viewport?.getBounds?.();
            if (!image || !bounds) return NaN;
            const tl = image.viewportToImageCoordinates(bounds.x, bounds.y);
            const br = image.viewportToImageCoordinates(bounds.x + bounds.width, bounds.y + bounds.height);
            return Math.abs(br.x - tl.x);
        }

        /**
         * Decide which islands of a fresh derivation belong to the subject.
         *
         * Islands are ranked by proximity to the subject — the island it sits ON
         * first (distance 0), then by boundary distance. The nearest one is ALWAYS
         * kept: a mask derived for a region must contain that region's tissue,
         * whatever the reach says. The others survive only within `reach`, a
         * fraction of the CURRENT viewport width, so the rule moves with the zoom:
         * framed on one gland it keeps that gland's tissue, zoomed out to the whole
         * section it keeps the section. Rejected polygons are deleted — this action
         * created them a moment ago, and pruning them is the point rather than a
         * side effect. With no subject there is nothing to be near, so all stay.
         *
         * @return {fabric.Object[]} kept islands, nearest first
         */
        _keepIslands(viewer, fabric, subject, created, factor) {
            if (!subject) return created;
            const ranked = global.AnnotationMeasurements.geometry.rankByProximity(this.annotations, subject, created);
            // Nothing measurable: keep the derivation rather than silently delete it.
            if (!ranked.length) return created;

            const reach = factor > 0 ? factor * this._viewportWidthImagePx(viewer) : 0;
            const limit = Number.isFinite(reach) ? reach : Infinity;
            const kept = ranked
                .filter((r, i) => i === 0 || r.distancePx <= limit)
                .map((r) => r.object);

            const keep = new Set(kept);
            for (const island of created) {
                if (!keep.has(island)) fabric.deleteAnnotation(island);
            }
            return kept;
        }

        /**
         * Derive the tissue mask of the current view and keep the part that belongs
         * to `subject`; when a subject is given, also compute and cache its tissue
         * ratio (annotation area ÷ kept tissue area). The one code path behind the
         * panel's "Derive tissue mask", the popover / canvas-menu shortcut and the
         * scripting `tissueRatio()`.
         *
         * The mask polygons remain on the slide, in the active preset unless
         * `presetID` says otherwise — the user can delete unwanted parts.
         *
         * Two facts about the annotations module shape this method. Every annotation
         * it adds becomes the canvas selection (`fromCanvas: true`), so the selection
         * in place before the call is put back afterwards; callers that follow the
         * selection (the panel) suspend their sync for the duration. And a freshly
         * added polygon is topmost and, while selected, wins every hit-test inside
         * it, so it would swallow clicks meant for the annotation drawn on it: kept
         * islands are sent to the back.
         *
         * @param {OpenSeadragon.Viewer} viewer
         * @param {object} [opts]
         * @param {fabric.Object|null} [opts.subject] the annotation the mask is for
         * @param {number} [opts.factor] reach as a fraction of the viewport width
         * @param {*} [opts.presetID] move kept islands into this class
         * @param {string} [opts.driver] pathology tissue driver
         * @return {Promise<{islands: fabric.Object[], ratio: number, annotationAreaPx: number,
         *   tissueAreaPx: number, reason: string|null}>} `reason` is a `reason.*` key
         *   (`no-pathology`, `no-image`, `tissue-empty`, or the error message) when
         *   nothing was derived.
         */
        async deriveTissueMask(viewer, opts = {}) {
            const NS = global.AnnotationMeasurements;
            const none = (reason) => ({ islands: [], ratio: NaN, annotationAreaPx: NaN, tissueAreaPx: NaN, reason });
            const pathology = this.pathology();
            if (!pathology) return none('no-pathology');
            const annotations = this.annotations;
            const fabric = viewer ? annotations?.getFabric?.(viewer) : null;
            if (!fabric) return none('no-image');

            const subject = opts.subject || null;
            const factor = Number.isFinite(opts.factor) ? opts.factor : this.tissueFactor();
            const previousSelection = (fabric.getSelectedAnnotations?.() || []).filter(Boolean);
            const list = () => NS.ui.format.annotationsIn(annotations, viewer);
            const before = new Set(list().map((o) => o.incrementId));

            let islands = [];
            try {
                await pathology.annotateTissue(viewer, { driver: opts.driver });
                const created = list().filter((o) => !before.has(o.incrementId));
                if (!created.length) return none('tissue-empty');

                islands = this._keepIslands(viewer, fabric, subject, created, factor);

                // Fabric draws (and hit-tests) the active object on top regardless of
                // stacking order, so drop the selection before reordering — the same
                // dance the annotations plugin's "Send to back" does.
                fabric.canvas.discardActiveObject?.();
                for (const island of islands) fabric.canvas.sendToBack?.(island);
                fabric.canvas.requestRenderAll?.();

                if (opts.presetID != null) {
                    for (const island of islands) fabric.changeAnnotationPreset(island, opts.presetID);
                }
            } catch (err) {
                APPLICATION_CONTEXT.log(`module.${this.id}`).warn('tissue derivation failed', err);
                return none(err?.message || String(err));
            } finally {
                NS.ui.picker.applySelection(fabric, previousSelection);
            }

            let ratio = NaN, annotationAreaPx = NaN, tissueAreaPx = NaN;
            if (subject) {
                const r = this.getEngine().areaRatioAgainstSet(viewer, subject, islands) || {};
                ratio = r.ratio;
                annotationAreaPx = r.numeratorAreaPx;
                tissueAreaPx = r.denominatorAreaPx;
                this.getEngine().setTissueRatio(subject, {
                    ratio, annotationAreaPx, tissueAreaPx,
                    islandIds: islands.map((o) => o.incrementId),
                    islandCount: islands.length,
                });
            }
            return { islands, ratio, annotationAreaPx, tissueAreaPx, reason: null };
        }

        /**
         * Opens the measurements panel, optionally on a given annotation. Async because
         * the panel builds its static labels once, in `create()`.
         */
        async openWorkspace(annotation = undefined) {
            await this.whenLocaleReady();
            const annotations = this.annotations;
            if (!annotations) return null;
            if (!this._workspace) {
                this._workspace = global.AnnotationMeasurements.ui.createWorkspace({ module: this, annotations });
            }
            this._workspace.open(annotation);
            return this._workspace;
        }

        /** Opens the lightweight per-annotation popover. */
        async openPopover(annotation) {
            await this.whenLocaleReady();
            const annotations = this.annotations;
            if (!annotations || !annotation) return null;
            if (!this._popover) {
                this._popover = global.AnnotationMeasurements.ui.createPopover({ module: this, annotations });
            }
            this._popover.showFor(annotation);
            return this._popover;
        }

        _registerUiEntries() {
            if (this._uiRegistered) return;
            // Claim synchronously: the `before-app-init` handler and the mid-session
            // immediate call must not both get past this, and the await below yields.
            this._uiRegistered = true;

            // `AppBar.Tools.register` captures `label`/`sectionTitle` as plain strings,
            // and only `label` has a setter — so the labels have to be right the first
            // time. Wait for the bundle rather than registering raw keys.
            this.whenLocaleReady().then(() => {
                try {
                    USER_INTERFACE.AppBar.Tools.register(this.id, {
                        section: 'annotations',
                        sectionTitle: this.t('sectionTitle'),
                        icon: 'ph-chart-bar-horizontal',
                        label: this.t('workspaceTitle'),
                        onClick: () => this.openWorkspace(),
                    });
                } catch (e) {
                    console.warn('[annotation-measurements] tools entry registration failed:', e);
                }
            });

            // Registered synchronously so a right-click right after load already offers
            // the entry: its title is evaluated per open, so it picks up the bundle
            // whenever that lands.
            // Priority below the annotations plugin's own provider (20) so its entries
            // stay first, above the playground (10).
            global.CanvasContextMenu?.register?.(this.id, (ctx) => {
                const annotations = this.annotations;
                const fabric = ctx?.viewer ? annotations?.getFabric?.(ctx.viewer) : null;
                if (!fabric) return null;
                const active = ctx.active ?? fabric.canvas?.findTarget?.(ctx.event);
                if (!active || !fabric.isAnnotation?.(active)) return null;
                // One nested entry: the quick read, the two one-click computations
                // (each opens the popover, which shows progress, the result or the
                // reason), and the full panel. The tissue entry is listed even when
                // the pathology module is missing — dimmed, saying why — so the
                // feature is discoverable rather than silently absent.
                const pathology = this.pathology();
                return [{
                    title: this.t('menuRoot'),
                    icon: 'ph-chart-bar-horizontal',
                    children: [
                        {
                            title: this.t('viewMeasurements'),
                            icon: 'ph-list-numbers',
                            action: () => this.openPopover(active),
                        },
                        {
                            title: this.t('menuMeasurePixels'),
                            icon: 'ph-scan',
                            action: async () => (await this.openPopover(active))?.measure(),
                        },
                        pathology ? {
                            title: this.t('menuTissueRatio'),
                            icon: 'ph-circles-three',
                            action: async () => (await this.openPopover(active))?.deriveTissue(),
                        } : {
                            title: this.t('tissueUnavailable'),
                            icon: 'ph-circles-three',
                            containerCss: 'opacity-50',
                            action: () => {},
                        },
                        {
                            title: this.t('openWorkspace'),
                            icon: 'ph-arrows-left-right',
                            action: () => this.openWorkspace(active),
                        },
                    ],
                }];
            }, 15);
        }
    }

    // Eager: nothing calls `singletonModule('annotation-measurements')` during
    // boot any more, so a lazy singleton would never construct and the Tools
    // entry would never appear.
    addModule('annotation-measurements', AnnotationMeasurementsModule, true);

    // Convenience: also expose the namespace on globalThis so non-module code
    // (scripting tools, tests) can reach the helpers without resolving the module.
    global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    global.AnnotationMeasurements.Module = AnnotationMeasurementsModule;
})(typeof window !== 'undefined' ? window : globalThis);
