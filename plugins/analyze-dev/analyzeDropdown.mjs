const { Dropdown } = globalThis.UI;

addPlugin('analyze-dev', class extends XOpatPlugin {
    constructor(id, params) {
        super(id);
        this.params = params || {};
        // plugin-level stored recent jobs can be configured via params or saved options
        this.recentJobs = this.getOption('recentJobs') || [];
    }

    pluginReady() {
        this._overlay = new JobResultsOverlay();
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
                id: 'run-recent',
                section: 'recent',
                label: tOr('analyze.runRecent', 'Run Recent') + ' \u2192',
                onClick: () => false,
            });

            // Use Dropdown as a standalone flyout panel — reuses its item rendering and styling
            // without wiring up a trigger button. Only _contentEl is appended to the DOM.
            const recentPanel = new Dropdown({ id: `${this.id}-recent-panel`, parentId: this.id });
            recentPanel.create();
            const panelEl = recentPanel._contentEl;
            panelEl.style.display = 'none';
            panelEl.style.maxHeight = '70vh';
            panelEl.style.overflow = 'auto';
            document.body.appendChild(panelEl);

            let _hideTimer = null;
            const cancelHide = () => { clearTimeout(_hideTimer); _hideTimer = null; };
            const scheduleHide = () => { cancelHide(); _hideTimer = setTimeout(() => { panelEl.style.display = 'none'; }, 250); };
            panelEl.addEventListener('mouseenter', cancelHide);
            panelEl.addEventListener('mouseleave', scheduleHide);

            const content = tab._contentEl;
            if (content) {
                content.addEventListener('mouseover', (e) => {
                    const hit = e.target.closest?.('[data-item-id]');
                    if (hit?.dataset?.itemId === 'run-recent') {
                        cancelHide();
                        const jobs = this.recentJobs.length ? this.recentJobs : ['Recent Job 1', 'Recent Job 2', 'Recent Job 3'];
                        recentPanel.clear();
                        jobs.forEach((job, idx) => {
                            const label = typeof job === 'string' ? job : job?.label;
                            recentPanel.addItem({
                                id: `recent-job-${idx}`,
                                label,
                                onClick: () => {
                                    if (typeof this.onJobClick === 'function') this.onJobClick({ index: idx, label });
                                }
                            });
                        });
                        panelEl.style.display = '';
                        requestAnimationFrame(() => {
                            const rect = hit.getBoundingClientRect();
                            const pw = panelEl.offsetWidth || 160;
                            const ph = panelEl.offsetHeight || 0;
                            let left = rect.right - 1;
                            if (left + pw > window.innerWidth - 8) left = Math.max(8, rect.left - pw);
                            let top = Math.max(8, rect.top);
                            if (ph && top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
                            panelEl.style.left = `${left}px`;
                            panelEl.style.top = `${top}px`;
                        });
                        tab.hideRecent = () => { cancelHide(); panelEl.style.display = 'none'; };
                    }
                });
                content.addEventListener('mouseout', (e) => {
                    if (!panelEl.contains(e.relatedTarget)) scheduleHide();
                });
            }

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
                console.log('[analyze] empaia convertor ready');
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
                console.log('[analyze] no annotation output keys in EAD for job', finalJob.id);
                return;
            }
            console.log('[analyze] annotation output keys:', annotationKeys);

            const scope = finalJob._scope;
            if (!scope) { console.warn('[analyze] no scope on finalJob'); return; }

            const job = await scope.jobs.get(finalJob.id);
            if (!job?.outputs) {
                console.warn('[analyze] job has no outputs field', job);
                return;
            }
            console.log('[analyze] job outputs:', job.outputs);

            const allShapes = [];
            for (const key of annotationKeys) {
                const collectionId = job.outputs[key];
                if (!collectionId) {
                    console.log('[analyze] no collection ID for output key', key);
                    continue;
                }
                try {
                    const result = await scope.collections.queryItems(collectionId, {});
                    if (!result?.items?.length) {
                        console.log('[analyze] empty collection for key', key);
                        continue;
                    }
                    console.log('[analyze] fetched', result.items.length, 'annotations for key', key);
                    const decoded = await this._empaiaConvertor.decode({ items: result.items, presets: [] });
                    if (decoded?.objects) allShapes.push(...decoded.objects.filter(Boolean));
                } catch (e) {
                    console.warn('[analyze] failed to fetch/decode annotations for key', key, e);
                }
            }

            if (!allShapes.length) {
                console.log('[analyze] no shapes decoded from job', finalJob.id);
                return;
            }

            console.log('[analyze] rendering', allShapes.length, 'annotations from job', finalJob.id);
            await this._overlay.addJobResults(finalJob.id, allShapes, viewerId);

        } catch (e) {
            console.error('[analyze] _fetchAndRenderResults failed', e);
        }
    }

    async _fetchOutputValues(finalJob, appId) {
        try {
            const ead = await window.EmpaiaStandaloneJobs?.getEAD?.(appId) || null;
            if (!ead?.io) {
                console.log('[analyze] _fetchOutputValues: no EAD io, skipping');
                return [];
            }

            const valueKeys = Object.entries(ead.io)
                .filter(([, spec]) => spec.type === 'collection' && !spec.items?.reference)
                .map(([key]) => key);

            if (!valueKeys.length) {
                console.log('[analyze] no value output keys in EAD for job', finalJob.id);
                return [];
            }
            console.log('[analyze] value output keys:', valueKeys);

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
                    console.log('[analyze] no collection ID for value key', key);
                    continue;
                }
                try {
                    const result = await scope.collections.queryItems(collectionId, {});
                    if (!result?.items?.length) {
                        console.log('[analyze] empty collection for value key', key);
                        continue;
                    }
                    console.log('[analyze] fetched', result.items.length, 'values for key', key);
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

        const body = document.createElement('div');
        body.className = 'p-3 space-y-4 overflow-auto';
        body.style.height = '100%';

        for (const { key, items } of valueOutputs) {
            const section = document.createElement('div');
            section.className = 'mb-3';

            const heading = document.createElement('div');
            heading.className = 'text-sm font-medium mb-1';
            heading.textContent = key;
            section.appendChild(heading);

            const pre = document.createElement('pre');
            pre.className = 'text-xs font-mono opacity-80 whitespace-pre-wrap';
            pre.textContent = items.map((item, i) => `${i}: ${Number(item.value).toFixed(4)}`).join('\n');
            section.appendChild(pre);

            body.appendChild(section);
        }

        fw.setBody(body);
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
            console.log('[analyze] posting annotation to MDS:', encoded);
            const created = await scope.annotations.create(encoded);
            console.log('[analyze] annotation created in MDS, serverId=', created.id);
            return created.id;
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

        const container = document.createElement('div');
        container.className = 'p-2 space-y-3';

        for (const [idx, app] of items.entries()) {
            const card = this._createAppCard(app, idx, tOr, fw);
            container.appendChild(card);
        }

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'p-2 text-sm opacity-70';
            empty.textContent = tOr('analyze.noApps', 'No apps available.');
            container.appendChild(empty);
        }

        fw.setBody(container);
        fw.focus();
    }

    _createAppCard(app, idx, tOr, fw) {
        const appId = app?.id || app?.app_id;
        const wrap = document.createElement('div');
        wrap.className = 'p-3 rounded-box bg-base-200 border border-base-300';

        // Header with title and configure button
        const header = document.createElement('div');
        header.className = 'flex items-center justify-between';

        const title = document.createElement('span');
        title.className = 'font-medium';
        title.textContent = app?.name_short || app?.name || `App ${idx + 1}`;
        header.appendChild(title);

        const configBtn = document.createElement('button');
        configBtn.type = 'button';
        configBtn.className = 'btn btn-xs btn-ghost';
        configBtn.textContent = 'Configure';
        header.appendChild(configBtn);
        wrap.appendChild(header);

        // Description
        if (app?.store_description) {
            const desc = document.createElement('div');
            desc.className = 'text-xs opacity-70 mt-1';
            desc.textContent = app.store_description;
            wrap.appendChild(desc);
        }

        // Inputs section (hidden by default)
        const inputsSection = document.createElement('div');
        inputsSection.className = 'mt-2 hidden';
        inputsSection.innerHTML = '<div class="text-xs opacity-50">Loading inputs...</div>';
        wrap.appendChild(inputsSection);

        let inputsForm = null;
        let inputsLoaded = false;

        configBtn.addEventListener('click', async () => {
            inputsSection.classList.toggle('hidden');
            if (!inputsLoaded && !inputsSection.classList.contains('hidden')) {
                try {
                    const api = singletonModule('empation-api')?.V3;
                    if (!api) throw new Error('EmpationAPI V3 is not available');
                    const caseId = await this._resolveCaseId();
                    if (!caseId) throw new Error('No active case found');
                    const examination = await api.examinations.create(caseId, appId);
                    const scope = await api.getScopeFrom(examination);
                    const onCapture = () => this._captureAnnotation(fw, scope);
                    inputsForm = await this._buildInputsForm(appId, scope, onCapture);
                    inputsSection.innerHTML = '';
                    inputsSection.appendChild(inputsForm.container);
                    inputsLoaded = true;
                } catch (e) {
                    inputsSection.innerHTML = `<div class="text-xs text-error">Failed to load inputs: ${e?.message || String(e)}</div>`;
                }
            }
        });

        // Actions row
        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-2 mt-2';

        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.className = 'btn btn-sm btn-primary';
        runBtn.textContent = tOr('analyze.run', 'Run');

        const status = document.createElement('span');
        status.className = 'text-xs flex-1';
        status.textContent = tOr('analyze.jobReady', 'Ready');

        runBtn.addEventListener('click', async () => {
            const viewerId = String(VIEWER.uniqueId);
            try {
                runBtn.disabled = true;
                status.textContent = tOr('analyze.jobStarting', 'Starting...');

                const inputs = inputsForm?.getInputs?.() || {};
                const ead = inputsForm?.ead || null;
                console.log('[analyze] Running job with inputs:', inputs);

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
                status.textContent = `${tOr('analyze.jobFinal', 'Status')}: ${res?.status || 'UNKNOWN'}`;
                status.className = isSuccess ? 'text-xs flex-1 text-success' : 'text-xs flex-1 text-error';
                console.log('[analyze] Job final:', res);
                if (isSuccess) {
                    await this._fetchAndRenderResults(res, appId, viewerId);
                    const valueOutputs = await this._fetchOutputValues(res, appId);
                    fw.close();
                    if (valueOutputs.length > 0) {
                        this._showOutputValuesWindow(valueOutputs);
                    }
                }
            } catch (err) {
                console.error('[analyze] Failed to run app job', err);
                status.textContent = `Error: ${err?.message || err}`;
                status.className = 'text-xs flex-1 text-error';
            } finally {
                runBtn.disabled = false;
            }
        });

        actions.appendChild(runBtn);
        actions.appendChild(status);
        wrap.appendChild(actions);

        return wrap;
    }

    async _buildInputsForm(appId, scope, onCapture, mode = 'STANDALONE') {
        const container = document.createElement('div');
        container.className = 'space-y-2 mt-2';

        try {
            const ead = await window.EmpaiaStandaloneJobs?.getEAD?.(appId, scope);
            if (!ead) {
                container.innerHTML = '<div class="text-xs opacity-50">No EAD available</div>';
                return { container, getInputs: () => ({}) };
            }

            const requiredInputs = window.EmpaiaStandaloneJobs?.getRequiredInputs?.(ead, mode) || [];
            console.log('[analyze] requiredInputs:', requiredInputs);
            if (requiredInputs.length === 0) {
                container.innerHTML = '<div class="text-xs opacity-50">No inputs required</div>';
                return { container, getInputs: () => ({}), ead };
            }

            const currentSlideId = VIEWER.scalebar?.getReferencedTiledImage()?.source?.getEmpaiaId() || '';
            const inputFields = {};

            for (const input of requiredInputs) {
                const row = this._createInputRow(input, currentSlideId, inputFields, onCapture);
                if (row) container.appendChild(row);
            }

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

            return { container, getInputs, ead };
        } catch (e) {
            console.error('[analyze] Failed to build inputs form', e);
            container.innerHTML = `<div class="text-xs text-error">Error: ${e.message}</div>`;
            return { container, getInputs: () => ({}) };
        }
    }

    _createInputRow(input, currentSlideId, inputFields, onCapture) {
        console.log("input.type:", input.type)
        if (input.type === 'wsi') {
            // Auto-fill with current slide — no UI row needed
            inputFields[input.key] = { value: currentSlideId };
            return null;
        }

        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';

        const label = document.createElement('label');
        label.className = 'text-xs font-medium min-w-20';
        label.textContent = `${input.key} (${input.type})`;
        row.appendChild(label);

        if (input.type === 'rectangle') {
            const valueHolder = { value: '' };
            inputFields[input.key] = valueHolder;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-xs btn-ghost';
            btn.textContent = 'Create annotation';

            const statusEl = document.createElement('span');
            statusEl.className = 'text-xs opacity-70 ml-1';

            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = 'Drawing\u2026';
                statusEl.textContent = '';
                try {
                    const id = await onCapture();
                    valueHolder.value = id;
                    btn.textContent = 'Redraw';
                    statusEl.textContent = id.slice(0, 8) + '\u2026';
                } catch (e) {
                    btn.textContent = 'Create annotation';
                    if (e?.message !== 'cancelled') {
                        statusEl.textContent = '\u26a0 ' + (e?.message || String(e));
                    }
                } finally {
                    btn.disabled = false;
                }
            });

            row.appendChild(btn);
            row.appendChild(statusEl);
            return row;
        }

        let fieldEl;

        if (input.type === 'bool') {
            fieldEl = document.createElement('input');
            fieldEl.type = 'checkbox';
            fieldEl.className = 'checkbox checkbox-xs';
        } else if (input.type === 'integer' || input.type === 'float') {
            fieldEl = document.createElement('input');
            fieldEl.type = 'number';
            fieldEl.className = 'input input-xs input-bordered flex-1';
            if (input.type === 'float') fieldEl.step = 'any';
        } else if (input.type === 'string') {
            fieldEl = document.createElement('textarea');
            fieldEl.className = 'textarea textarea-xs textarea-bordered flex-1 font-mono text-xs';
            fieldEl.rows = 4;
            fieldEl.placeholder = 'Enter text value\u2026';
        } else {
            fieldEl = document.createElement('input');
            fieldEl.type = 'text';
            fieldEl.className = 'input input-xs input-bordered flex-1';
            fieldEl.placeholder = `${input.type} ID`;
        }

        inputFields[input.key] = fieldEl;
        row.appendChild(fieldEl);

        return row;
    }

});