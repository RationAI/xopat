addPlugin('questionaire', class extends XOpatPlugin {
    constructor(id, opts = {}) {
        super(id);
        this.enableEditor = opts.enableEditor ?? true;
        this.autoOpenBackground = opts.autoOpenBackground ?? true;

        this.SCHEMA_KEY = `xopat_questionnaire_schema_${this.id}`;
        this.DRAFT_KEY  = `xopat_questionnaire_draft_${this.id}`;

        this.DEFAULT_SCHEMA = {
            display: "wizard",
            components: [
                { type:"panel", key:"p1", title:"Page 1",
                    components:[{ type:"textfield", key:"name", label:"Name", input:true, validate:{ required:true } }]},
                { type:"panel", key:"p2", title:"Page 2",
                    components:[{ type:"email", key:"email", label:"Email", input:true }]}
            ]
        };

        this._form = null;
        this._formEl = null;
        this._schema = null;

        this._builderWin = null;      // FloatingWindow instance
        this._builderDom = null;      // window of the external builder
        this._builderActivePage = 0;  // page highlighted in the builder
        this._currentPage = 0;        // active page in runtime form
    }

    // ================== lifecycle ==================
    pluginReady() {
        const editBtnHtml = this.enableEditor
            ? `<button id="q-edit-btn" class="btn btn-default" style="margin-bottom:12px">Edit form…</button>`
            : ``;

        LAYOUT.addTab({
            id: 'questionaire',
            title: 'Questionnaire',
            icon: 'fa-question-circle',
            body: [
                new UI.RawHtml(`
      <style>
        /* minimal styles if Tailwind isn't present */
        .qx-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;}
        .qx-title{font-weight:600;font-size:18px;margin:0 0 8px;}
        .qx-actions{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:12px}
        .qx-edit{border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:6px 10px;cursor:pointer}
        .qx-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
        .qx-tab{padding:6px 12px;border:1px solid #e5e7eb;border-radius:9999px;background:#f3f4f6;cursor:pointer}
        .qx-tab.active{background:#2563eb;color:#fff;border-color:#1d4ed8}
        .qx-progress{height:6px;background:#e5e7eb;border-radius:9999px;overflow:hidden}
        .qx-progress > div{height:100%;background:#2563eb;width:0%}
      </style>

      <main class="max-w-4xl mx-auto">
        <div class="qx-card">
          <div class="qx-actions">
            <h1 class="qx-title">Questionnaire</h1>
            ${this.enableEditor ? '<button id="q-edit-btn" class="qx-edit">Edit form…</button>' : ''}
          </div>

          <!-- custom header (page pills + progress) -->
          <div id="qn-header">
            <div class="qx-tabs" id="qn-tabs"></div>
            <div style="display:flex;align-items:center;gap:8px;margin:6px 0 12px">
              <span id="qn-counter" style="font-size:12px;color:#6b7280">1 / 1</span>
              <div class="qx-progress" style="flex:1"><div id="qn-progress"></div></div>
            </div>
          </div>

          <!-- runtime form here -->
          <div id="questionaire-form"></div>
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

            // schema updated (editedPageIndex tells us if it’s the active page)
            if (msg.type === 'formio-schema-updated' && msg.schema) {
                this._schema = this._ensurePerPageBg(msg.schema);
                this._saveSchema(this._schema);
                const keep = (this._form && this._form.data) ? { ...this._form.data } : null;
                this._renderForm(this._schema, keep, {
                    restorePage: this._currentPage,
                    applyBg: (msg.editedPageIndex === this._currentPage)
                });
            }

            // builder focused page i (user clicked a page row there)
            if (msg.type === 'formio-builder-activate' && Number.isInteger(msg.pageIndex)) {
                this._builderActivePage = msg.pageIndex;
                // move the viewer to that page’s background
                this._applyBackgroundForPage(this._builderActivePage, this._schema);
            }
        });

        if (this.enableEditor) {
            const btn = document.getElementById('q-edit-btn');
            if (btn) btn.addEventListener('click', () => this._openBuilderWindow());
        }

        // load & render
        this._schema = this._ensurePerPageBg(this._loadSchema() || this.DEFAULT_SCHEMA);
        this._saveSchema(this._schema);
        const draft = this._loadDraft();
        this._renderForm(this._schema, draft, { restorePage: 0, applyBg: true });
    }

    _buildPrettyHeader(form) {
        const header = document.getElementById('qn-header');
        const tabsEl = document.getElementById('qn-tabs');
        const panels = this._panelList(this._schema);

        if (!header || !tabsEl) return;
        tabsEl.innerHTML = '';

        panels.forEach((p, i) => {
            const btn = document.createElement('button');
            btn.className = 'qx-tab' + (i === this._currentPage ? ' active' : '');
            btn.textContent = p.title || p.key || `Page ${i+1}`;
            btn.addEventListener('click', () => {
                if (this._currentPage === i) return;
                this._currentPage = i;
                if (typeof form.setPage === 'function') form.setPage(i);
                // update viewer + builder
                this._applyBackgroundForPage(i, this._schema);
                if (this._builderDom) {
                    try { this._builderDom.postMessage({ type:'formio-set-page', pageIndex: i }, '*'); } catch {}
                }
                this._updateHeaderActive(i, panels.length);
            });
            tabsEl.appendChild(btn);
        });

        this._updateHeaderActive(this._currentPage, panels.length);
    }

    _updateHeaderActive(i, total) {
        const tabs = [...document.querySelectorAll('#qn-tabs .qx-tab')];
        tabs.forEach((b, k) => b.classList.toggle('active', k === i));
        const bar = document.getElementById('qn-progress');
        const counter = document.getElementById('qn-counter');
        if (bar) bar.style.width = (total ? ((i + 1) / total) * 100 : 0) + '%';
        if (counter) counter.textContent = `${Math.min(i + 1, total)} / ${Math.max(total, 1)}`;
    }


    // ================== runtime render ==================
    async _renderForm(schemaObj, preserveData, { restorePage = 0, applyBg = true } = {}) {
        if (this._formEl) this._formEl.innerHTML = '';

        // hide Form.io’s breadcrumb (header) and keep your per-page backgrounds
        const cloned = JSON.parse(JSON.stringify(this._ensurePerPageBg(schemaObj)));
        cloned.breadcrumb = 'none';              // <- important to remove the default header
        this._schema = cloned;

        try {
            const form = await Formio.createForm(this._formEl, this._schema);
            this._form = form;

            // restore data
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

            // Save draft every change
            form.on('change', () => this._saveDraft(form.data));

            // build the pretty header once the form exists
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
                `<pre style="color:#b91c1c;white-space:pre-wrap">${err?.stack || err}</pre>`);
        }
    }

    // ================== background logic ==================
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

    // ================== persistence ==================
    _loadSchema() {
        try { return JSON.parse(localStorage.getItem(this.SCHEMA_KEY) || 'null'); } catch { return null; }
    }
    _saveSchema(schemaObj) {
        localStorage.setItem(this.SCHEMA_KEY, JSON.stringify(schemaObj));
    }
    _loadDraft() {
        try { return JSON.parse(localStorage.getItem(this.DRAFT_KEY) || 'null'); } catch { return null; }
    }
    _saveDraft(data) {
        localStorage.setItem(this.DRAFT_KEY, JSON.stringify(data || {}));
    }

    // ================== builder (no preview) ==================
    _openBuilderWindow() {
        if (this._builderWin) return;

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
            renderPagesUI(s); // refresh left panel (active row, titles, selects)
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

                // background select
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
                    sync(i); // only update viewer if editing the active page (parent decides)
                });

                // delete button
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
                        sync(null); // parent won't move viewer unless user activates a page explicitly
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
        // default active is current parent page if any:
        activatePage(this._builderActivePage, builder.schema);

        // add page — inherits previous page’s xBgSpec
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

        // export / reset
        // win.document.getElementById('exportBtn').onclick = () => {
        //     const blob = new Blob([JSON.stringify(this._ensurePerPageBg(builder.schema), null, 2)], { type: "application/json" });
        //     const url = URL.createObjectURL(blob);
        //     const a = Object.assign(win.document.createElement("a"), { href: url, download: "form-schema.json" });
        //     a.click(); URL.revokeObjectURL(url);
        // };
        win.document.getElementById('resetBtn').onclick = () => {
            builder.setForm(this._ensurePerPageBg(this.DEFAULT_SCHEMA));
            this._builderActivePage = 0;
            activatePage(0, builder.schema);
            sync(0);
        };

        // keep in sync with normal builder edits too
        builder.on('saveComponent', () => sync(null));
        builder.on('deleteComponent', () => sync(null));

        // messages FROM parent → builder (set page)
        win.addEventListener('message', (e) => {
            const m = e.data;
            if (m && m.type === 'formio-set-page' && Number.isInteger(m.pageIndex)) {
                activatePage(m.pageIndex, builder.schema);
            }
        });
    }
});
