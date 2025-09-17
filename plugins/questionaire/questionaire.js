addPlugin('questionaire', class extends XOpatPlugin {
    constructor(id) {
        super(id);
        this.enableEditor = this.getOption('enableEditor', true);
        this.autoOpenBackground = this.getOption('autoOpenBackground', true);

        // NEW: lock editing when exporting (for now default true; flip later during real export)
        this.isExported = this.getOption('isExported', false);
        this.DRAFT_KEY  = 'questionnaire_draft';

        this.DEFAULT_SCHEMA = {
            display: "wizard",
            components: [
                { type: "panel", key: "p1", title: "Page 1",
                    components: [{ type:"textfield", key:"name", label:"Name", input:true, validate:{ required:true } }]},
                { type: "panel", key: "p2", title: "Page 2",
                    components: [{ type:"email", key:"email", label:"Email", input:true }]}
            ]
        };

        this._form = null;
        this._formEl = null;
        this._schema = null;

        this._builderWin = null;
        this._builderDom = null;
        this._builderActivePage = 0;
        this._currentPage = 0;

        this.initPostIO({
            exportKey: "scheme",
            inViewerContext: false
        });
    }

    async exportData(key) {
        return this._savedSchema ? JSON.stringify(this._savedSchema) : undefined;
    }

    async importData(key, data) {
        // no need to test key RN, we have just single export registered
        this._savedSchema = JSON.parse(data);
    }

    pluginReady() {
        const editBtnHtml = (this.enableEditor && !this.isExported)
            ? `<button id="q-edit-btn" class="btn btn-outline">Edit form…</button>`
            : ``;

        LAYOUT.addTab({
            id: 'questionaire',
            title: 'Questionnaire',
            icon: 'fa-question-circle',
            body: [
                new UI.RawHtml(`
          <main class="mx-auto max-w-5xl p-0">
            <div class="card bg-base-100 shadow-md">
              <div class="card-body p-2">
                <div class="flex items-center justify-between mb-3">
                  <h1 class="card-title text-xl">Questionnaire</h1>
                  <div class="flex items-center gap-2">
                    ${this.isExported ? '<div class="badge badge-warning">Read-only</div>' : ''}
                    ${editBtnHtml}
                  </div>
                </div>

                <!-- custom header (DaisyUI tabs + progress) -->
                <div id="qn-header" class="space-y-3">
                  <div id="qn-tabs" class="tabs tabs-boxed"></div>
                  <div class="flex items-center gap-3">
                    <span id="qn-counter" class="text-sm text-base-content/60">1 / 1</span>
                    <progress id="qn-progress" class="progress progress-primary flex-1" value="0" max="100"></progress>
                  </div>
                </div>

                <!-- runtime form -->
                <div id="questionaire-form" class="mt-2"></div>
              </div>
            </div>
          </main>
        `)
            ]
        });

        this._formEl = document.getElementById('questionaire-form');

        // messages FROM builder → parent
        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'formio-schema-updated' && msg.schema) {
                this._schema = this._ensurePerPageBg(msg.schema);
                this._saveSchema(this._schema);
                const keep = (this._form && this._form.data) ? { ...this._form.data } : null;
                this._renderForm(this._schema, keep, {
                    restorePage: this._currentPage,
                    applyBg: (msg.editedPageIndex === this._currentPage)
                });
            }

            if (msg.type === 'formio-builder-activate' && Number.isInteger(msg.pageIndex)) {
                this._builderActivePage = msg.pageIndex;
                this._applyBackgroundForPage(this._builderActivePage, this._schema);
            }
        });

        if (this.enableEditor && !this.isExported) {
            const btn = document.getElementById('q-edit-btn');
            if (btn) btn.addEventListener('click', () => this._openBuilderWindow());
        }

        // load & render
        this._schema = this._ensurePerPageBg(this._loadSchema() || this.DEFAULT_SCHEMA);
        this._saveSchema(this._schema);
        const draft = this._loadDraft();
        // todo first page is not consistent but applyBG fires the reloading twice -> make sure we hook before viewer loaded and adjust the active state
        this._renderForm(this._schema, draft, { restorePage: 0, applyBg: false });
    }

    // ========== pretty header (DaisyUI) ==========
    _buildPrettyHeader(form) {
        const tabsEl = document.getElementById('qn-tabs');
        const panels = this._panelList(this._schema);
        if (!tabsEl) return;

        tabsEl.innerHTML = '';
        panels.forEach((p, i) => {
            const btn = document.createElement('a');
            btn.className = 'tab' + (i === this._currentPage ? ' tab-active' : '');
            btn.textContent = p.title || p.key || `Page ${i+1}`;
            btn.addEventListener('click', () => {
                if (this._currentPage === i) return;
                this._currentPage = i;
                if (typeof form.setPage === 'function') form.setPage(i);
                this._applyBackgroundForPage(i, this._schema);
                if (this._builderDom) {
                    try { this._builderDom.postMessage({ type: 'formio-set-page', pageIndex: i }, '*'); } catch {}
                }
                this._updateHeaderActive(i, panels.length);
            });
            tabsEl.appendChild(btn);
        });

        this._updateHeaderActive(this._currentPage, panels.length);
    }

    _updateHeaderActive(i, total) {
        const tabs = [...document.querySelectorAll('#qn-tabs .tab')];
        tabs.forEach((b, k) => b.classList.toggle('tab-active', k === i));
        const bar = document.getElementById('qn-progress');
        const counter = document.getElementById('qn-counter');
        if (bar) bar.value = total ? Math.round(((i + 1) / total) * 100) : 0;
        if (counter) counter.textContent = `${Math.min(i + 1, total)} / ${Math.max(total, 1)}`;
    }

    // ========== runtime render ==========
    async _renderForm(schemaObj, preserveData, { restorePage = 0, applyBg = true } = {}) {
        if (this._formEl) this._formEl.innerHTML = '';

        const cloned = JSON.parse(JSON.stringify(this._ensurePerPageBg(schemaObj)));
        cloned.breadcrumb = 'none';
        this._schema = cloned;

        try {
            // NEW: pass readOnly flag (locks editing while "exported")
            const form = await Formio.createForm(this._formEl, this._schema, { readOnly: this.isExported });
            this._form = form;

            if (preserveData && Object.keys(preserveData).length) {
                form.submission = { data: preserveData };
            } else {
                const draft = this._loadDraft();
                if (draft) form.submission = { data: draft };
            }

            const panelsCount = this._panelList(this._schema).length;
            this._currentPage = Math.min(Math.max(restorePage, 0), Math.max(panelsCount - 1, 0));
            if (typeof form.setPage === 'function') { try { form.setPage(this._currentPage); } catch {} }
            if (applyBg) this._applyBackgroundForPage(this._currentPage, this._schema);

            // Save draft on change (only if editable)
            if (!this.isExported) form.on('change', () => this._saveDraft(form.data));

            // header
            this._buildPrettyHeader(form);

            const syncBuilderTo = (i) => {
                if (this._builderDom) { try { this._builderDom.postMessage({ type:'formio-set-page', pageIndex: i }, '*'); } catch {} }
            };

            form.on('nextPage', () => {
                this._currentPage = Math.min(this._currentPage + 1, this._panelList(this._schema).length - 1);
                this._applyBackgroundForPage(this._currentPage, this._schema);
                this._updateHeaderActive(this._currentPage, this._panelList(this._schema).length);
                syncBuilderTo(this._currentPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            form.on('prevPage', () => {
                this._currentPage = Math.max(this._currentPage - 1, 0);
                this._applyBackgroundForPage(this._currentPage, this._schema);
                this._updateHeaderActive(this._currentPage, this._panelList(this._schema).length);
                syncBuilderTo(this._currentPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            form.on('submit', ({ data }) => {
                console.log('[questionnaire] submit:', data);
                alert('Submitted! (see console)');
            });

        } catch (err) {
            console.error('Form render failed:', err);
            this._formEl.insertAdjacentHTML('beforebegin',
                `<pre class="text-error whitespace-pre-wrap">${err?.stack || err}</pre>`);
        }
    }

    // ========== background helpers ==========
    _panelList(schema) {
        return Array.isArray(schema?.components)
            ? schema.components.filter(c => c && c.type === 'panel')
            : [];
    }
    _activeBgDefault() {
        let idx = APPLICATION_CONTEXT.getOption("activeBackgroundIndex", undefined, false);
        if (Array.isArray(idx)) idx = idx[0];
        if (!Number.isInteger(idx)) idx = 0;
        return idx;
    }
    _ensurePerPageBg(schema) {
        if (!schema || !Array.isArray(schema.components)) return schema;
        let last = this._activeBgDefault();
        schema.components.forEach((c) => {
            if (c?.type !== 'panel') return;
            const prop = c.properties || (c.properties = {});
            const val = prop.xBgSpec;
            if (val === undefined || val === null || val === '') {
                prop.xBgSpec = last;
            } else {
                const n = Number(val);
                prop.xBgSpec = Number.isFinite(n) ? n : last;
            }
            last = prop.xBgSpec;
        });
        return schema;
    }
    _resolveBgForPage(index, schema) {
        const panels = this._panelList(schema);
        const p = panels[index];
        const n = Number(p?.properties?.xBgSpec);
        return Number.isFinite(n) ? n : this._activeBgDefault();
    }
    _applyBackgroundForPage(index, schema) {
        if (!this.autoOpenBackground) return;
        try {
            const bgIdx = this._resolveBgForPage(index, schema);
            APPLICATION_CONTEXT.openViewerWith(
                undefined, undefined, undefined,
                bgIdx, undefined,
                { deriveOverlayFromBackgroundGoals: true }
            );
        } catch (e) {
            console.warn('openViewerWith failed', e);
        }
    }

    // ========== persistence ==========
    _loadSchema() {
        return this._savedSchema;
    }
    _saveSchema(schemaObj) {
        this._savedSchema = schemaObj;
    }
    _loadDraft() {
        if (this.isExported) return;
        try { return JSON.parse( APPLICATION_CONTEXT.AppCache.get(this.DRAFT_KEY) || 'null'); } catch { return null; }
    }
    _saveDraft(data) {
        if (this.isExported) return;
        APPLICATION_CONTEXT.AppCache.set(this.DRAFT_KEY, JSON.stringify(data || {}));
    }

    // ========== builder (no preview) ==========
    _openBuilderWindow() {
        if (this._builderWin) {
            if (!this._builderWin.opened()) {
                this._builderWin.focus();
            }
            return;
        }

        const head = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css">
<link rel="stylesheet" href="${this.PLUGIN_ROOT}/formio.full.min.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; background:#fafafa; }
  .grid { display:grid; grid-template-columns:300px 1fr; gap:16px; }
  .panel { border:1px solid #ddd; border-radius:8px; padding:12px; background:#fff; }

  /* CONSTRAIN the builder column height and make the palette scroll */
  #builder { height:70vh; overflow:hidden; } 
  #builder .formio-builder .formcomponents,
  #builder .formcomponents,
  #builder .builder-sidebar {
    max-height: 55vh; overflow:auto;
  }
  .wizard-pages: {display:none !important;}
  .pages-list { display:flex; flex-direction:column; gap:8px; }
  .page-row { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:center; cursor:pointer; }
  .page-row:hover { background:#f7f7ff; }
  .page-row .title { font-weight:500; }
  .page-row.active { outline:2px solid #88a; background:#eef2ff; }
  .muted { color:#666; font-size:12px; }
</style>
<script src="${this.PLUGIN_ROOT}/formio.full.min.js"></script>
    `.trim();

        const html = `
<div class="grid">
  <div class="panel">
    <h3 style="margin-top:0">Pages</h3>
    <div class="muted">Click a page to activate it. Every page has an explicit background. New pages inherit the previous.</div>
    <div id="pages" class="pages-list" style="margin-top:8px"></div>
    <div style="margin-top:8px; display:flex; gap:8px">
      <button id="addPageBtn" class="btn btn-default">Add page</button>
<!--      <button id="exportBtn" class="btn btn-default">Export JSON</button>-->
      <button id="resetBtn" class="btn btn-danger">Reset to default</button>
    </div>
  </div>

  <div class="panel">
    <h3 style="margin-top:0">Builder</h3>
    <div id="builder"></div>
  </div>
</div>
    `.trim();

        this._builderWin = new UI.FloatingWindow({
            id: "questionaire-creator",
            title: "Questionnaire Builder",
            width: 1100,
            height: 720,
            position: { x: 100, y: 80 },
            externalProps: {
                headTags: [ head ],
                withTailwind: false,
                onRender: (win) => this._initBuilderWindow(win)
            },
            external: true
        }, html);
    }

    async _initBuilderWindow(win) {
        this._builderDom = win;

        const cfg = (parent && parent.APPLICATION_CONTEXT && parent.APPLICATION_CONTEXT.config) || {};
        const backgrounds = Array.isArray(cfg.background) ? cfg.background : [];

        const schema = this._ensurePerPageBg(this._loadSchema() || this.DEFAULT_SCHEMA);

        const builderEl = win.document.getElementById('builder');
        const pagesEl = win.document.getElementById('pages');

        const builder = await win.Formio.builder(builderEl, schema, { builder: { premium: false } });

        const panelList = (s) => Array.isArray(s.components) ? s.components.filter(c => c.type === 'panel') : [];
        const findPanelIndexByKey = (s, key) =>
            Array.isArray(s.components) ? s.components.findIndex(c => c.type === 'panel' && c.key === key) : -1;

        // Programmatically switch builder’s internal page (even though tabs are hidden)
        const setBuilderPage = (i) => {
            try {
                const inst = builder.instance || builder.webform || builder.formio;
                if (inst && typeof inst.setPage === 'function') inst.setPage(i);
                else {
                    // fallback: click hidden nav tab if present
                    const tabs = builderEl.querySelectorAll('.nav.nav-tabs li a');
                    if (tabs[i]) tabs[i].click();
                }
            } catch {}
        };

        const sync = (editedPageIndex = null) => {
            const s = this._ensurePerPageBg(builder.schema);
            this._saveSchema(s);
            try { window.postMessage({ type: 'formio-schema-updated', schema: s, editedPageIndex }, '*'); } catch {}
            renderPagesUI(s);
        };

        const activatePage = (i, s) => {
            const max = Math.max(panelList(s).length - 1, 0);
            this._builderActivePage = Math.min(Math.max(i, 0), max);
            setBuilderPage(this._builderActivePage);
            try { window.postMessage({ type: 'formio-builder-activate', pageIndex: this._builderActivePage }, '*'); } catch {}
            renderPagesUI(s);
        };

        const renderPagesUI = (s) => {
            const panels = panelList(s);
            pagesEl.innerHTML = '';
            panels.forEach((p, i) => {
                const row = win.document.createElement('div');
                row.className = 'page-row' + (i === this._builderActivePage ? ' active' : '');

                // title (click → activate)
                const title = win.document.createElement('div');
                title.className = 'title';
                title.textContent = p.title || p.key || `Page ${i+1}`;
                title.addEventListener('click', () => activatePage(i, builder.schema));

                const sel = win.document.createElement('select');
                sel.className = 'form-control';
                backgrounds.forEach((bg, idx) => {
                    const o = win.document.createElement('option');
                    o.value = String(idx);
                    o.textContent = bg.name || cfg.data?.[bg.dataReference] || `Background ${idx}`;
                    sel.appendChild(o);
                });
                const current = Number(p.properties?.xBgSpec);
                sel.value = Number.isFinite(current) ? String(current) : String(this._activeBgDefault());
                sel.addEventListener('click', (ev) => ev.stopPropagation()); // don’t activate row when opening select
                sel.addEventListener('change', () => {
                    const n = Number(sel.value);
                    p.properties = p.properties || {};
                    p.properties.xBgSpec = Number.isFinite(n) ? n : this._activeBgDefault();
                    sync(i);
                });

                const del = win.document.createElement('button');
                del.className = 'btn btn-danger';
                del.textContent = 'Delete';
                del.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const s0 = builder.schema;
                    const idxInSchema = findPanelIndexByKey(s0, p.key);
                    if (idxInSchema >= 0) {
                        s0.components.splice(idxInSchema, 1);
                        builder.setForm(s0); // rebuild builder UI
                        // adjust active page if needed
                        const count = panelList(s0).length;
                        if (this._builderActivePage >= count) this._builderActivePage = Math.max(0, count - 1);
                        sync(null);
                        renderPagesUI(s0);
                    }
                });

                row.appendChild(title);
                row.appendChild(sel);
                row.appendChild(del);
                row.addEventListener('click', () => activatePage(i, builder.schema));
                pagesEl.appendChild(row);
            });
        };

        // initial UI
        renderPagesUI(builder.schema);
        activatePage(this._builderActivePage, builder.schema);

        // add page (inherits previous background)
        win.document.getElementById('addPageBtn').onclick = () => {
            const s = builder.schema;
            const panels = panelList(s);
            const n = panels.length + 1;
            const inherit = panels.length
                ? Number(panels[panels.length - 1].properties?.xBgSpec)
                : this._activeBgDefault();
            const panel = { type: 'panel', key: `p${n}`, title: `Page ${n}`, components: [], properties: { xBgSpec: inherit } };
            s.components = s.components || [];
            s.components.push(panel);
            builder.setForm(s);
            activatePage(panels.length, s); // make the new page active
            sync(panels.length);
        };

        win.document.getElementById('resetBtn').onclick = () => {
            builder.setForm(this._ensurePerPageBg(this.DEFAULT_SCHEMA));
            this._builderActivePage = 0;
            activatePage(0, builder.schema);
            sync(0);
        };

        builder.on('saveComponent', () => sync(null));
        builder.on('deleteComponent', () => sync(null));

        // parent → builder (sync page)
        win.addEventListener('message', (e) => {
            const m = e.data;
            if (m && m.type === 'formio-set-page' && Number.isInteger(m.pageIndex)) {
                activatePage(m.pageIndex, builder.schema);
            }
        });
    }
});
