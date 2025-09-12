addPlugin('questionaire', class extends XOpatPlugin {
    constructor(id, opts = {}) {
        super(id);
        this.enableEditor = opts.enableEditor ?? true;

        // shared storage keys
        this.SCHEMA_KEY = `xopat_questionnaire_schema_${this.id}`;
        this.DRAFT_KEY  = `xopat_questionnaire_draft_${this.id}`;

        // default starter schema (wizard, 2 pages)
        this.DEFAULT_SCHEMA = {
            display: "wizard",
            components: [
                { type:"panel", key:"p1", title:"Page 1",
                    components:[{ type:"textfield", key:"name", label:"Name", input:true, validate:{ required:true } }] },
                { type:"panel", key:"p2", title:"Page 2",
                    components:[{ type:"email", key:"email", label:"Email", input:true }] }
            ]
        };

        this._form = null;
        this._formEl = null;
        this._schema = null;
        this._builderWin = null; // UI.FloatingWindow instance
    }

    pluginReady() {
        // --- TAB UI ---
        const editBtnHtml = this.enableEditor
            ? `<button id="q-edit-btn" class="btn btn-default" style="margin-bottom:12px">Edit form…</button>`
            : ``;

        LAYOUT.addTab({
            id: 'questionaire',
            title: 'Questionnaire',
            icon: 'fa-question-circle',
            body: [
                new UI.RawHtml(`
          <main class="max-w-3xl mx-auto">
            <h1 class="text-2xl font-semibold mb-2">Questionnaire</h1>
            ${editBtnHtml}
            <div id="questionaire-form"></div>
          </main>
        `)
            ]
        });

        this._formEl = document.getElementById('questionaire-form');

        // Listen for schema updates coming from the builder window
        window.addEventListener('message', (e) => {
            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'formio-schema-updated' && msg.schema) {
                this._saveSchema(msg.schema);
                // Re-render while preserving current data
                const keepData = (this._form && this._form.data) ? { ...this._form.data } : null;
                this._renderForm(msg.schema, keepData);
            }
        });

        // Also react to storage updates (e.g., user edits in another tab)
        window.addEventListener('storage', (e) => {
            if (e.key === this.SCHEMA_KEY && e.newValue) {
                try {
                    const newSchema = JSON.parse(e.newValue);
                    const keepData = (this._form && this._form.data) ? { ...this._form.data } : null;
                    this._renderForm(newSchema, keepData);
                } catch {}
            }
        });

        // Wire Edit button
        if (this.enableEditor) {
            const btn = document.getElementById('q-edit-btn');
            if (btn) btn.addEventListener('click', () => this._openBuilderWindow());
        }

        // Load schema & render
        this._schema = this._loadSchema() || this.DEFAULT_SCHEMA;
        // Try to restore draft answers on first render
        const draft = this._loadDraft();
        this._renderForm(this._schema, draft);
    }

    // -------- Rendering & persistence --------

    async _renderForm(schemaObj, preserveData /* object|null */) {
        // Clear previous instance
        if (this._formEl) this._formEl.innerHTML = '';

        // Create fresh form
        try {
            const form = await Formio.createForm(this._formEl, schemaObj);
            this._form = form;

            // Restore preserved data (keys not present in the new schema are ignored by Form.io)
            if (preserveData && Object.keys(preserveData).length) {
                form.submission = { data: preserveData };
            } else {
                // Or restore draft if present
                const draft = this._loadDraft();
                if (draft) form.submission = { data: draft };
            }

            // Save draft on change
            form.on('change', () => {
                this._saveDraft(form.data);
            });

            // Submit handler – replace with your API if needed
            form.on('submit', ({ data }) => {
                console.log('[questionnaire] submit:', data);
                alert('Submitted! (see console)');
            });

            // UX: scroll to top on page nav (wizards)
            form.on('nextPage', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
            form.on('prevPage', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        } catch (err) {
            console.error('Form render failed:', err);
            this._formEl.insertAdjacentHTML('beforebegin',
                `<pre style="color:#b91c1c;white-space:pre-wrap">${err?.stack || err}</pre>`);
        }
    }

    _loadSchema() {
        try { return JSON.parse(localStorage.getItem(this.SCHEMA_KEY) || 'null'); } catch { return null; }
    }
    _saveSchema(schemaObj) {
        this._schema = schemaObj;
        localStorage.setItem(this.SCHEMA_KEY, JSON.stringify(schemaObj));
    }
    _loadDraft() {
        try { return JSON.parse(localStorage.getItem(this.DRAFT_KEY) || 'null'); } catch { return null; }
    }
    _saveDraft(data) {
        localStorage.setItem(this.DRAFT_KEY, JSON.stringify(data || {}));
    }

    // -------- Builder window (only if enableEditor=true) --------

    _openBuilderWindow() {
        if (this._builderWin) return; // prevent duplicates

        const head = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css">
<link rel="stylesheet" href="${this.PLUGIN_ROOT}/formio.full.min.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .panel { border:1px solid #ddd; border-radius:8px; padding:12px; background:#fff; }
  #builder, #preview { height:70vh; overflow:auto; }
</style>
<script src="${this.PLUGIN_ROOT}/formio.full.min.js"></script>
    `.trim();

        const html = `
<div class="grid">
  <div class="panel">
    <h3>Builder</h3>
    <div id="builder"></div>
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button id="saveSchemaBtn">Export schema (JSON)</button>
      <button id="clearSchemaBtn">Reset to default</button>
    </div>
  </div>
  <div class="panel">
    <h3>Preview</h3>
    <div id="preview"></div>
  </div>
</div>
    `.trim();

        this._builderWin = new UI.FloatingWindow({
            id: "questionaire-creator",
            title: "Questionnaire Builder",
            width: 980,
            height: 720,
            position: { x: 100, y: 90 },
            externalProps: {
                headTags: [ head ],
                withTailwind: false,
                onRender: (win) => this._initBuilderWindow(win)
            },
            external: true
        }, html);
    }

    async _initBuilderWindow(win) {
        const SCHEMA = this._loadSchema() || this.DEFAULT_SCHEMA;
        const builderEl = win.document.getElementById('builder');
        const previewEl = win.document.getElementById('preview');

        // Build
        const builder = await win.Formio.builder(builderEl, SCHEMA, { builder: { premium: false } });

        const renderPreview = async (schema) => {
            previewEl.innerHTML = '';
            const f = await win.Formio.createForm(previewEl, schema);
            // use parent draft for preview, if any
            try {
                const draft = this._loadDraft();
                if (draft) f.submission = { data: draft };
            } catch {}
        };

        const sync = () => {
            const schema = builder.schema;
            // persist
            this._saveSchema(schema);
            // update preview inside the builder
            renderPreview(schema);
            // notify parent (main plugin) to re-render and preserve answers
            try { window.postMessage({ type: 'formio-schema-updated', schema }, '*'); } catch {}
        };

        builder.on('saveComponent', sync);
        builder.on('deleteComponent', sync);

        // initial preview
        renderPreview(builder.schema);

        // Buttons
        win.document.getElementById('saveSchemaBtn').onclick = () => {
            const blob = new Blob([JSON.stringify(builder.schema, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = Object.assign(win.document.createElement("a"), { href: url, download: "form-schema.json" });
            a.click(); URL.revokeObjectURL(url);
        };
        win.document.getElementById('clearSchemaBtn').onclick = () => {
            // reset to default skeleton
            builder.setForm(this.DEFAULT_SCHEMA);
            sync();
        };
    }
});