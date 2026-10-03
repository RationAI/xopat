const { Dropdown } = globalThis.UI;
const { div, span, p, label, input, select, option, textarea, button } = globalThis.van.tags;

const STRING_SELECT_OPTIONS = {
    script: ['stardist'],
};

addPlugin('analyze-dev', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.params = params || {};
        // plugin-level stored recent jobs can be configured via params or saved options
        this.recentJobs = this.getOption('recentJobs') || [];
    }

    pluginReady() {
        this._overlay = new JobResultsOverlay();
        this._jobHistory = new JobHistory({
            plugin: this,
            overlay: this._overlay,
            onShow: async (entry) => {
                const api = singletonModule('empation-api')?.V3;
                if (!api) throw new Error('EmpationAPI not available');
                const examination = await api.examinations.create(entry.caseId, entry.appId);
                const scope = await api.getScopeFrom(examination);
                const viewerId = String(VIEWER.uniqueId);
                await this._fetchAndRenderResults(
                    { id: entry.jobId, _scope: scope },
                    entry.appId,
                    viewerId
                );
            },
            onRerun: async (entry) => {
                this._jobHistory._modal?.close();

                const api = singletonModule('empation-api')?.V3;
                if (!api) throw new Error('EmpationAPI not available');
                const examination = await api.examinations.create(entry.caseId, entry.appId);
                const scope = await api.getScopeFrom(examination);
                const onCapture = () => this._captureAnnotation({ _rootEl: null }, scope);

                const inputsForm = await this._buildInputsForm(entry.appId, scope, onCapture, 'STANDALONE', entry.inputs);
                const confirmed = await this._showRerunInputsModal(entry, inputsForm.container);
                if (!confirmed) return;

                let annotBounds = entry.bounds;

                if (inputsForm.captureAnnotation) {
                    if (!this.getOption('skipDrawROIModal')) {
                        const shouldDraw = await this._showDrawROIModal();
                        if (!shouldDraw) return;
                    }
                    try {
                        const result = await inputsForm.captureAnnotation();
                        annotBounds = result.bounds;
                    } catch (e) {
                        if (e?.message !== 'cancelled') console.error('[analyze] Annotation capture failed:', e);
                        return;
                    }
                }

                const inputs = inputsForm.getInputs();
                const appLabel = entry.appName || entry.appId || 'Job';
                const viewerId = String(VIEWER.uniqueId);
                this._setJobBanner(`${appLabel}: Pending`, 'WARNING', null);
                const res = await window.EmpaiaStandaloneJobs?.createAndRunJob?.({
                    appId: entry.appId,
                    caseId: entry.caseId,
                    mode: 'STANDALONE',
                    inputs,
                    ead: inputsForm.ead,
                });

                const status = res?.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
                if (res?.id) this._jobHistory.recordJob({
                    jobId: res.id,
                    appId: entry.appId,
                    appName: entry.appName,
                    caseId: entry.caseId,
                    name: `${entry.name} (rerun)`,
                    status,
                    timestamp: Date.now(),
                    inputs,
                    bounds: annotBounds,
                    hasRectInput: entry.hasRectInput,
                });

                if (status === 'COMPLETED') {
                    this._setJobBanner(`${appLabel}: Completed`, 'SUCCESS', annotBounds);
                    await this._fetchAndRenderResults(res, entry.appId, viewerId);
                    const valueOutputs = await this._fetchOutputValues(res, entry.appId);
                    if (valueOutputs.length > 0) this._showOutputValuesWindow(valueOutputs);
                } else {
                    this._setJobBanner(`${appLabel}: Failed`, 'ERROR', annotBounds);
                }
            },
            onFetchResults: async (entry) => {
                const api = singletonModule('empation-api')?.V3;
                if (!api) throw new Error('EmpationAPI not available');
                const examination = await api.examinations.create(entry.caseId, entry.appId);
                const scope = await api.getScopeFrom(examination);
                return await this._fetchOutputValues({ id: entry.jobId, _scope: scope }, entry.appId);
            },
        });
        this._empaiaConvertor = null;
        UTILITIES.loadPlugin('gui_annotations');

        const tOr = (key, fallback) => {
            const translated = $.t(key);
            return (translated && translated !== key) ? translated : fallback;
        };

        const title = tOr('analyze.title', 'Analyze');
        const tab = USER_INTERFACE.AppBar.addTab(
            this.id,
            title,
            'fa-magnifying-glass',
            [],
            Dropdown
        );

        if (tab) {
            const btnId = `${tab.parentId}-b-${tab.id}`;
            const btnEl = document.getElementById(btnId);
            if (btnEl) {
                let wrapper = btnEl.closest('.dropdown');
                if (!wrapper) {
                    const newWrapper = tab.create();
                    const parent = btnEl.parentElement;
                    if (parent) {
                        parent.insertBefore(newWrapper, btnEl);
                        btnEl.remove();
                        wrapper = newWrapper;
                    }
                }
                if (wrapper) {
                    const trigger = wrapper.querySelector('[tabindex]') || wrapper;
                    trigger.addEventListener('click', (e) => {
                        wrapper.classList.toggle('dropdown-open');
                        if (!wrapper.classList.contains('dropdown-open')) {
                            tab.hideRecent?.();
                        }
                        e.stopPropagation();
                    });
                }
            }
        }

        if (tab && typeof tab.addItem === 'function') {
            tab.addSection({ id: 'recent', title: '' });
            tab.widthClass = 'w-64';
            if (tab._contentEl) tab._contentEl.classList.add('w-64');

            tab.addItem({
                id: 'job-history',
                section: 'recent',
                label: 'Job History',
                onClick: () => {
                    this._collapseDropdown(tab);
                    this._jobHistory.showModal();
                    return false;
                },
            });

            tab.addItem({
                id: 'apps-list',
                label: tOr('analyze.apps', 'Apps'),
                onClick: async () => {
                    this._collapseDropdown(tab);
                    await this._showAppsWindow(tOr);
                    return false;
                }
            });
        }

        if (tab && !tab.__analyzeDocCloserAttached) {
            const btnId = `${tab.parentId}-b-${tab.id}`;
            document.addEventListener('click', (ev) => {
                const btnEl = document.getElementById(btnId);
                document.querySelectorAll('.dropdown.dropdown-open').forEach((wrapper) => {
                    if (btnEl && (btnEl === ev.target || btnEl.contains(ev.target))) return;
                    wrapper.classList.remove('dropdown-open');
                });
                tab.hideRecent?.();
            }, true);
            document.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') {
                    document.querySelectorAll('.dropdown.dropdown-open').forEach(w => w.classList.remove('dropdown-open'));
                    tab.hideRecent?.();
                }
            }, true);
            tab.__analyzeDocCloserAttached = true;
        }
    }

    // Hardcoded case ID for now - should be made configurable
    // TODO: this plugin is currently tightly coupled to the Empaia WorkBench API
    //  (EmpaiaStandaloneJobs, EmpationAPI, Empaia-specific app/case/EAD models).
    //  Future work should generalize to support other backends (DICOM, HuggingFace, generic REST)
    //  via an adapter/provider pattern, with the plugin only depending on an abstract interface.

    /**
     * Resolve the case ID for the currently open slide.
     * Priority: current slide lookup → static config → empaia active scope.
     */
    async _resolveCaseId() {
        const slideId = VIEWER.scalebar?.getReferencedTiledImage()?.source?.getEmpaiaId();
        if (slideId) {
            const api = singletonModule('empation-api')?.V3;
            if (!api) return null;
            const cases = await api.cases.list();
            for (const c of cases.items) {
                const slides = await api.cases.slides(c.id);
                if (slides.items.some(s => s.id === slideId)) return c.id;
            }
        }

        return this.getOption('caseId') || this.params.caseId || plugin('empaia')?.scopeAPI?.activeCaseId || null;
    }

    async _fetchAndRenderResults(finalJob, appId, viewerId) {
        if (!this._empaiaConvertor) {
            try {
                const annotationsModule = OSDAnnotations.instance();
                if (!OSDAnnotations.Convertor.CONVERTERS['empaia']) {
                    EmpationAPI.integrateWithAnnotations(annotationsModule);
                }
                const ConvertorClass = OSDAnnotations.Convertor.CONVERTERS['empaia'];
                this._empaiaConvertor = new ConvertorClass(annotationsModule, {});
            } catch (e) {
                console.warn('[analyze] empaia convertor not available', e);
                return;
            }
        }

        try {
            const ead = await window.EmpaiaStandaloneJobs?.getEAD?.(appId) || null;
            if (!ead?.io) {
                console.warn('[analyze] no EAD io definition — cannot identify annotation outputs');
                return;
            }

            const annotationKeys = Object.entries(ead.io)
                .filter(([, spec]) => spec.type === 'collection' && spec.items?.reference != null)
                .map(([key]) => key);

            if (!annotationKeys.length) {
                return;
            }

            const scope = finalJob._scope;
            if (!scope) { console.warn('[analyze] no scope on finalJob'); return; }

            const job = await scope.jobs.get(finalJob.id);
            if (!job?.outputs) {
                console.warn('[analyze] job has no outputs field', job);
                return;
            }

            const allShapes = [];
            for (const key of annotationKeys) {
                const collectionId = job.outputs[key];
                if (!collectionId) {
                    continue;
                }
                try {
                    const result = await scope.collections.queryItems(collectionId, {});
                    if (!result?.items?.length) {
                        continue;
                    }
                    const decoded = await this._empaiaConvertor.decode({ items: result.items, presets: [] });
                    if (decoded?.objects) allShapes.push(...decoded.objects.filter(Boolean));
                } catch (e) {
                    console.warn('[analyze] failed to fetch/decode annotations for key', key, e);
                }
            }

            if (!allShapes.length) {
                return;
            }

            await this._overlay.addJobResults(finalJob.id, allShapes, viewerId);

        } catch (e) {
            console.error('[analyze] _fetchAndRenderResults failed', e);
        }
    }

    async _fetchOutputValues(finalJob, appId) {
        try {
            const ead = await window.EmpaiaStandaloneJobs?.getEAD?.(appId) || null;
            if (!ead?.io) {
                return [];
            }

            const valueKeys = Object.entries(ead.io)
                .filter(([, spec]) => spec.type === 'collection' && !spec.items?.reference)
                .map(([key]) => key);

            if (!valueKeys.length) {
                return [];
            }

            const scope = finalJob._scope;
            if (!scope) { console.warn('[analyze] _fetchOutputValues: no scope on finalJob'); return []; }

            const job = await scope.jobs.get(finalJob.id);
            if (!job?.outputs) {
                console.warn('[analyze] _fetchOutputValues: job has no outputs field', job);
                return [];
            }

            const results = [];
            for (const key of valueKeys) {
                const collectionId = job.outputs[key];
                if (!collectionId) {
                    continue;
                }
                try {
                    const result = await scope.collections.queryItems(collectionId, {});
                    if (!result?.items?.length) {
                        continue;
                    }
                    results.push({ key, items: result.items });
                } catch (e) {
                    console.warn('[analyze] failed to fetch values for key', key, e);
                }
            }
            return results;
        } catch (e) {
            console.error('[analyze] _fetchOutputValues failed', e);
            return [];
        }
    }

    _showOutputValuesWindow(valueOutputs) {
        const { FloatingWindow } = globalThis.UI;
        const id = `${this.id}-output-values-window`;
        const width = 360;
        const height = 420;
        const startLeft = Math.max(8, Math.round((window.innerWidth - width) / 2));
        const startTop = Math.max(8, Math.round((window.innerHeight - height) / 2));

        const fw = new FloatingWindow({ id, title: 'Job Results', width, height, startLeft, startTop });
        fw.attachTo(document.body);

        fw.setBody(div({ class: 'p-3 space-y-4 overflow-auto h-full' },
            valueOutputs.map(output => window.renderJobOutputValues(output)),
        ));
        fw.focus();
    }

    _collapseDropdown(tab) {
        try {
            const btnId = `${tab.parentId}-b-${tab.id}`;
            const btnEl = document.getElementById(btnId);
            const wrapper = btnEl?.closest('.dropdown');
            wrapper?.classList.remove('dropdown-open');
            try { tab.hideRecent?.(); } catch(_) {}
        } catch(_) {}
    }

    _setJobBanner(label, colorKey, bounds) {
        const bannerId = 'banner';
        USER_INTERFACE.AppBar.addBadge(bannerId, {
            label,
            color: colorKey.toLowerCase(),
            dot: colorKey === 'WARNING',
            pulse: colorKey === 'WARNING',
            title: bounds ? 'Click to focus ROI' : 'Click to dismiss',
            onClick: () => {
                if (bounds) {
                    const tiledImage = VIEWER.scalebar.getReferencedTiledImage();
                    if (tiledImage) {
                        const rect = tiledImage.imageToViewportRectangle(bounds.left, bounds.top, bounds.width, bounds.height);
                        VIEWER.viewport.fitBounds(rect, false);
                    }
                }
                USER_INTERFACE.AppBar.removeBadge(bannerId);
            },
        });
    }

    /**
     * Hide the FloatingWindow, activate rectangle drawing mode, wait for the user
     * to draw one annotation, then restore everything and return the annotation ID.
     *
     * State restored in finally: mode, left-preset factory, enabled state, window visibility.
     * Escape key cancels and rejects with Error('cancelled').
     *
     * @param {FloatingWindow} fw the apps FloatingWindow to hide during drawing
     * @returns {Promise<string>} Empaia annotation ID
     */
    async _captureAnnotation(fw, scope) {
        const annot = singletonModule('annotations');
        if (!annot) throw new Error('Annotations module not available');

        const rectFactory = annot.getAnnotationObjectFactory('rect')
            || Object.values(annot.objectFactories).find(f => f.fabricStructure?.() === 'rect');
        if (!rectFactory) throw new Error('Rectangle annotation factory not available');

        if (!annot.presets.left) annot.setPreset(true, true);
        const prevFactory = annot.presets.left.objectFactory;
        const prevModeId = annot.mode?.getId?.();
        const wasEnabled = !annot.disabledInteraction;

        annot.presets.left.objectFactory = rectFactory;
        annot.enableInteraction(true);
        annot.setModeUsed('CUSTOM');
        try { annot.setModeById('custom'); } catch (_) {}
        if (fw._rootEl) fw._rootEl.style.display = 'none';

        const fabric = annot.fabric;
        let annotObj;
        try {
            annotObj = await new Promise((resolve, reject) => {
                const onCreate = (ev) => {
                    fabric.removeHandler('annotation-create', onCreate);
                    document.removeEventListener('keydown', onEscape, true);
                    resolve(ev.object);
                };
                const onEscape = (e) => {
                    if (e.key !== 'Escape') return;
                    fabric.removeHandler('annotation-create', onCreate);
                    document.removeEventListener('keydown', onEscape, true);
                    reject(new Error('cancelled'));
                };
                fabric.addHandler('annotation-create', onCreate);
                document.addEventListener('keydown', onEscape, true);
            });
        } finally {
            if (annot.presets.left) annot.presets.left.objectFactory = prevFactory;
            try { if (prevModeId !== undefined) annot.setModeById(prevModeId); } catch (_) {}
            if (!wasEnabled) annot.enableInteraction(false);
            if (!annotObj && fw._rootEl) fw._rootEl.style.display = '';
        }

        try {
            const tileSource = VIEWER.scalebar.getReferencedTiledImage()?.source;
            if (!tileSource) throw new Error('No active tiled image source');
            const slideId = tileSource.getEmpaiaId?.();
            if (!slideId) throw new Error('Could not get slide ID from tiled image source');
            const encoded = {
                type: 'rectangle',
                name: 'input_roi',
                description: 'rect',
                creator_type: 'scope',
                creator_id: scope.id,
                reference_type: 'wsi',
                reference_id: slideId,
                npp_created: Math.round(VIEWER.scalebar?.currentResolution?.() ?? 1),
                upper_left: [Math.max(0, Math.round(annotObj.left)), Math.max(0, Math.round(annotObj.top))],
                width: Math.round(annotObj.width),
                height: Math.round(annotObj.height),
            };
            const created = await scope.annotations.create(encoded);
            return { id: created.id, bounds: { left: annotObj.left, top: annotObj.top, width: annotObj.width, height: annotObj.height } };
        } catch (e) {
            console.error('[analyze] _captureAnnotation failed:', e);
            throw e;
        } finally {
            if (fw._rootEl) fw._rootEl.style.display = '';
        }
    }

    async _showAppsWindow(tOr) {
        let items = [];
        try {
            const resp = await window.EmpaiaStandaloneJobs?.getApps?.();
            const all = Array.isArray(resp?.items) ? resp.items : [];
            items = all.filter(app => {
                const desc = (app?.store_description || '').toUpperCase();
                return !desc.includes('NO-OP') && !desc.includes('NO_OP');
            });
        } catch (e) {
            console.warn('[analyze] failed to fetch apps, showing empty list', e);
        }

        const { FloatingWindow } = globalThis.UI;
        const fw = new FloatingWindow({
            id: `${this.id}-apps-window`,
            title: tOr('analyze.apps', 'Apps'),
            width: 520,
            height: 480
        });
        fw.attachTo(document.body);

        fw.setBody(div({ class: 'p-2 space-y-3' },
            items.length
                ? items.map((app, idx) => this._createAppCard(app, idx, tOr, fw))
                : div({ class: 'p-2 text-sm opacity-70' }, tOr('analyze.noApps', 'No apps available.')),
        ));
        fw.focus();
    }

    async _openInputsForm(appId, fw) {
        const api = singletonModule('empation-api')?.V3;
        if (!api) throw new Error('EmpationAPI V3 is not available');
        const caseId = await this._resolveCaseId();
        if (!caseId) throw new Error('No active case found');
        const examination = await api.examinations.create(caseId, appId);
        const scope = await api.getScopeFrom(examination);
        const onCapture = () => this._captureAnnotation(fw, scope);

        let jobDefaults = {};
        try {
            const eadInfo = await api.rationai?.ead?.get?.(appId);
            jobDefaults = eadInfo?.job_defaults || {};
        } catch (e) {
            console.warn('[analyze] Failed to fetch job defaults for', appId, e);
        }

        return this._buildInputsForm(appId, scope, onCapture, 'STANDALONE', jobDefaults);
    }

    _createAppCard(app, idx, tOr, fw) {
        const appId = app?.id || app?.app_id;
        const nameInput = input({
            type: 'text',
            class: 'input input-bordered input-sm w-full mb-2',
            placeholder: 'Job name (optional)',
        });

        // Inputs section (hidden by default), loaded on first open
        const settingsOpen = van.state(false);
        const inputsContent = van.state(div({ class: 'text-xs opacity-50' }, 'Loading inputs...'));
        let inputsForm = null;
        let inputsLoaded = false;

        const toggleSettings = async () => {
            settingsOpen.val = !settingsOpen.val;
            if (inputsLoaded || !settingsOpen.val) return;
            try {
                inputsForm = await this._openInputsForm(appId, fw);
                inputsContent.val = inputsForm.container;
                inputsLoaded = true;
            } catch (e) {
                inputsContent.val = div({ class: 'text-xs text-error' }, `Failed to load inputs: ${e?.message || String(e)}`);
            }
        };

        const runJob = async () => {
            const viewerId = String(VIEWER.uniqueId);
            const bannerId = 'banner';
            const appLabel = app?.name_short || app?.name || 'Job';
            const name = nameInput.value.trim() || (() => {
                const now = new Date();
                return `${appLabel} – ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
            })();
            const setJobBanner = (label, colorKey, bounds) => this._setJobBanner(label, colorKey, bounds);

            if (!inputsLoaded) {
                try {
                    inputsForm = await this._openInputsForm(appId, fw);
                    inputsLoaded = true;
                } catch (e) {
                    console.error('[analyze] Failed to load inputs for run:', e);
                }
            }

            fw.close();

            if (inputsForm?.captureAnnotation) {
                if (!this.getOption('skipDrawROIModal')) {
                    const shouldDraw = await this._showDrawROIModal();
                    if (!shouldDraw) return;
                }
                try {
                    await inputsForm.captureAnnotation();
                } catch (e) {
                    if (e?.message !== 'cancelled') console.error('[analyze] Annotation capture failed:', e);
                    return;
                }
            }

            let annotBounds = null;
            try {
                setJobBanner(`${appLabel}: Pending`, 'WARNING', null);

                const inputs = inputsForm?.getInputs?.() || {};
                const ead = inputsForm?.ead || null;
                annotBounds = inputsForm?.getAnnotBounds?.() || null;

                const caseId = await this._resolveCaseId();
                if (!caseId) throw new Error('No active case found');
                const res = await window.EmpaiaStandaloneJobs?.createAndRunJob?.({
                    appId,
                    caseId,
                    mode: 'STANDALONE',
                    inputs,
                    ead
                });

                const isSuccess = res?.status === 'COMPLETED';
                if (isSuccess) {
                    setJobBanner(`${appLabel}: Completed`, 'SUCCESS', annotBounds);
                    await this._fetchAndRenderResults(res, appId, viewerId);
                    const valueOutputs = await this._fetchOutputValues(res, appId);
                    if (valueOutputs.length > 0) {
                        this._showOutputValuesWindow(valueOutputs);
                    }
                } else {
                    setJobBanner(`${appLabel}: Failed`, 'ERROR', annotBounds);
                }
                if (res?.id) {
                    this._jobHistory.recordJob({
                        jobId: res.id,
                        appId,
                        appName: appLabel,
                        caseId,
                        name,
                        status: isSuccess ? 'COMPLETED' : 'FAILED',
                        timestamp: Date.now(),
                        inputs,
                        bounds: annotBounds,
                        hasRectInput: !!inputsForm?.captureAnnotation,
                    });
                }
            } catch (err) {
                console.error('[analyze] Failed to run app job', err);
                setJobBanner(`${appLabel}: Failed`, 'ERROR', annotBounds);
            }
        };

        return div({ class: 'p-3 rounded-box bg-base-200 border border-base-300' },
            div({ class: 'flex items-center justify-between' },
                span({ class: 'font-medium' }, app?.name_short || app?.name || `App ${idx + 1}`),
                button({ type: 'button', class: 'btn btn-xs btn-ghost', onclick: toggleSettings },
                    tOr('analyze.advancedSettings', 'Advanced settings')),
            ),
            app?.store_description ? div({ class: 'text-xs opacity-70 mt-1' }, app.store_description) : null,
            nameInput,
            div({ class: () => settingsOpen.val ? 'mt-2' : 'mt-2 hidden' }, () => inputsContent.val),
            div({ class: 'flex items-center gap-2 mt-2' },
                button({ type: 'button', class: 'btn btn-sm btn-primary', onclick: runJob }, tOr('analyze.run', 'Run')),
                span({ class: 'text-xs flex-1' }, tOr('analyze.jobReady', 'Ready')),
            ),
        );
    }

    _showDrawROIModal() {
        const { FloatingWindow } = globalThis.UI;
        return new Promise(resolve => {
            let resolved = false;
            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                resolve(result);
            };

            const width = 320, height = 190;
            const modal = new FloatingWindow({
                id: `${this.id}-draw-roi-modal`,
                title: 'Draw Region of Interest',
                width,
                height,
                startLeft: Math.round((window.innerWidth - width) / 2),
                startTop: Math.round((window.innerHeight - height) / 2),
                onClose: () => finish(false),
            });
            modal.attachTo(document.body);

            const dontShowAgain = input({ type: 'checkbox', class: 'checkbox checkbox-xs' });
            const body = div({ class: 'p-4 flex flex-col gap-3' },
                p({ class: 'text-sm' }, 'Draw a rectangular region on the slide to define the area of interest for analysis.'),
                label({ class: 'flex items-center gap-2 text-xs cursor-pointer' },
                    dontShowAgain,
                    span("Don't show again"),
                ),
                button({
                    type: 'button',
                    class: 'btn btn-sm btn-primary w-full',
                    onclick: () => {
                        if (dontShowAgain.checked) this.setOption('skipDrawROIModal', true);
                        finish(true);
                        modal.close();
                    },
                }, 'Draw ROI'),
            );

            modal.setBody(body);
            modal.focus();
        });
    }

    _showRerunInputsModal(entry, container) {
        const { FloatingWindow } = globalThis.UI;
        return new Promise(resolve => {
            let resolved = false;
            const finish = (result) => {
                if (resolved) return;
                resolved = true;
                resolve(result);
            };

            const width = 360, height = 420;
            const modal = new FloatingWindow({
                id: `${this.id}-rerun-inputs-modal`,
                title: 'Edit inputs before rerun',
                width,
                height,
                startLeft: Math.round((window.innerWidth - width) / 2),
                startTop: Math.round((window.innerHeight - height) / 2),
                onClose: () => finish(false),
            });
            modal.attachTo(document.body);

            const choose = (result) => {
                finish(result);
                modal.close();
            };
            const body = div({ class: 'p-3 flex flex-col gap-3 overflow-auto h-full' },
                container,
                div({ class: 'flex gap-2' },
                    button({ type: 'button', class: 'btn btn-sm btn-primary flex-1', onclick: () => choose(true) }, 'Rerun'),
                    button({ type: 'button', class: 'btn btn-sm btn-ghost flex-1', onclick: () => choose(false) }, 'Cancel'),
                ),
            );

            modal.setBody(body);
            modal.focus();
        });
    }

    async _buildInputsForm(appId, scope, onCapture, mode = 'STANDALONE', initialValues = {}) {
        const formContainer = (...children) => div({ class: 'space-y-2 mt-2' }, ...children);
        const note = (text) => formContainer(div({ class: 'text-xs opacity-50' }, text));

        try {
            const ead = await window.EmpaiaStandaloneJobs?.getEAD?.(appId, scope);
            if (!ead) {
                return { container: note('No EAD available'), getInputs: () => ({}) };
            }

            const requiredInputs = window.EmpaiaStandaloneJobs?.getRequiredInputs?.(ead, mode) || [];
            if (requiredInputs.length === 0) {
                return { container: note('No inputs required'), getInputs: () => ({}), ead };
            }

            const currentSlideId = VIEWER.scalebar?.getReferencedTiledImage()?.source?.getEmpaiaId() || '';
            const inputFields = {};
            const container = formContainer(requiredInputs.map(spec =>
                this._createInputRow(spec, currentSlideId, inputFields, initialValues)));

            const getInputs = () => {
                const result = {};
                for (const [key, el] of Object.entries(inputFields)) {
                    if (el.type === 'checkbox') {
                        result[key] = el.checked ? 'true' : 'false';
                    } else {
                        result[key] = el.value?.trim() ?? '';
                    }
                }
                return result;
            };

            const getAnnotBounds = () => {
                for (const el of Object.values(inputFields)) {
                    if (el.bounds) return el.bounds;
                }
                return null;
            };

            const rectInput = requiredInputs.find(i => i.type === 'rectangle');
            const captureAnnotation = rectInput ? async () => {
                const result = await onCapture();
                inputFields[rectInput.key].value = result.id;
                inputFields[rectInput.key].bounds = result.bounds;
                return result;
            } : null;

            return { container, getInputs, getAnnotBounds, captureAnnotation, ead };
        } catch (e) {
            console.error('[analyze] Failed to build inputs form', e);
            return {
                container: formContainer(div({ class: 'text-xs text-error' }, `Error: ${e.message}`)),
                getInputs: () => ({}),
            };
        }
    }

    /**
     * Build the field for one EAD input and register it in inputFields.
     * Inputs filled automatically (wsi, rectangle) get a value holder and no row.
     */
    _createInputRow(spec, currentSlideId, inputFields, initialValues = {}) {
        if (spec.type === 'wsi') {
            inputFields[spec.key] = { value: currentSlideId };
            return null;
        }
        if (spec.type === 'rectangle') {
            inputFields[spec.key] = { value: '' };
            return null;
        }

        const def = initialValues[spec.key];
        const initial = def !== undefined ? { value: def } : {};
        let fieldEl;

        if (spec.type === 'bool') {
            fieldEl = input({ type: 'checkbox', class: 'checkbox checkbox-xs', checked: def === true || def === 'true' });
        } else if (spec.type === 'integer' || spec.type === 'float') {
            fieldEl = input({
                type: 'number',
                class: 'input input-xs input-bordered flex-1',
                ...(spec.type === 'float' ? { step: 'any' } : {}),
                ...initial,
            });
        } else if (spec.type === 'string') {
            const selectOpts = STRING_SELECT_OPTIONS[spec.key];
            if (selectOpts) {
                const opts = (def !== undefined && !selectOpts.includes(def)) ? [...selectOpts, def] : selectOpts;
                fieldEl = select({ class: 'select select-xs select-bordered flex-1' },
                    opts.map(opt => option({ value: opt }, opt)));
                // options must exist before the value can select one
                if (def !== undefined) fieldEl.value = def;
            } else {
                fieldEl = textarea({
                    class: 'textarea textarea-xs textarea-bordered flex-1 font-mono text-xs',
                    rows: 4,
                    placeholder: 'Enter text value…',
                    ...initial,
                });
            }
        } else {
            fieldEl = input({ type: 'text', class: 'input input-xs input-bordered flex-1', placeholder: `${spec.type} ID` });
        }

        inputFields[spec.key] = fieldEl;
        return div({ class: 'flex items-center gap-2' },
            label({ class: 'text-xs font-medium min-w-20' }, `${spec.key} (${spec.type})`),
            fieldEl,
        );
    }

});