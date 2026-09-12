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
                return [{
                    title: this.t('viewMeasurements'),
                    icon: 'ph-chart-bar-horizontal',
                    action: () => this.openPopover(active),
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
