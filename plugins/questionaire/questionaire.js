addPlugin('questionaire', class extends XOpatPlugin {
    constructor(id) { 
        super(id); 
    }

    pluginReady() {
        LAYOUT.addTab({
            id: 'questionaire',
            title: 'Questionaire',
            icon: 'fa-question-circle',
            body: [
                new UI.RawHtml(`<main class="max-w-3xl mx-auto">
    <h1 class="text-2xl font-semibold mb-4">Questionnaire</h1>
    <div id="questionaire-form"></div>
  </main>`)
            ]
        });

        // 1) Put your JSON here (or fetch it)
        const schema = /* paste your JSON */ {
            // Example wizard skeleton; replace with your real schema
            display: "wizard",
            components: [
                { type:"panel", key:"p1", title:"Page 1", components:[{ type:"textfield", key:"name", label:"Name", input:true, validate:{required:true} }]},
                { type:"panel", key:"p2", title:"Page 2", components:[{ type:"email", key:"email", label:"Email", input:true }]}
            ]
        };

        (async () => {
            const el = document.getElementById("questionaire-form");

            // Optional if you added Font Awesome above
            // Formio.icons = 'fontawesome';

            // 2) Render the form
            const form = await Formio.createForm(el, schema);

            // 4) Handle submit
            form.on("submit", ({ data }) => {
                console.log("answers:", data);
                alert("Submitted! Check the console for payload.");
                // fetch("/api/submit", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(data) });
            });

            // 5) Optional: draft save/restore (local)
            const DRAFT_KEY = "questionnaire_draft";
            const saved = localStorage.getItem(DRAFT_KEY);
            if (saved) form.submission = { data: JSON.parse(saved) };
            form.on("change", () => localStorage.setItem(DRAFT_KEY, JSON.stringify(form.data)));
        })().catch(err => {
            console.error(err);
        });

        new UI.FloatingWindow({
            id: "questionaire-creator",
            title: "Questionaire Creator",
            width: 600,
            height: 400,
            position: {
                x: 100,
                y: 100
            },
            externalProps: {
                headTags:  [
                    `
                    <!-- ... -->
    <!-- SurveyJS Form Library resources -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css">
  <script src="${this.PLUGIN_ROOT}/formio.min.js"></script>
<link rel="stylesheet" href="${this.PLUGIN_ROOT}/formio.min.css"/>
  <style>
    body { font-family: system-ui, sans-serif; margin: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .panel { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    #responses table { width: 100%; border-collapse: collapse; }
    #responses th, #responses td { border: 1px solid #ddd; padding: 6px; font-size: 12px; }
  </style>
    <!-- ... -->
`
                    ],
                    withTailwind: false,
                    onRender: (win) => {
                        const SCHEMA_KEY = "formio_demo_schema";
                        const RESPONSES_KEY = "formio_demo_responses";

                        const builderEl = win.document.getElementById("builder");
                        const previewEl = win.document.getElementById("preview");

                        const savedSchema = win.localStorage.getItem(SCHEMA_KEY);
                        const initialSchema = savedSchema ? JSON.parse(savedSchema) : {
                            display: "wizard",
                            components: [
                                { type: "panel", key: "page1", title: "Page 1", components: [] },
                                { type: "panel", key: "page2", title: "Page 2", components: [] }
                            ]
                        };

                        // 1) Builder
                        win.Formio.builder(builderEl, initialSchema, { builder: { premium: false } }).then((builder) => {
                            const sync = () => {
                                const schema = builder.schema;
                                win.localStorage.setItem(SCHEMA_KEY, JSON.stringify(schema));
                                renderPreview(schema);
                            };
                            builder.on("saveComponent", sync);
                            builder.on("deleteComponent", sync);
                            renderPreview(builder.schema);

                            // Buttons
                            win.document.getElementById("saveSchemaBtn").onclick = () => {
                                const blob = new Blob([JSON.stringify(builder.schema, null, 2)], { type: "application/json" });
                                const url = URL.createObjectURL(blob);
                                const a = Object.assign(win.document.createElement("a"), { href: url, download: "form-schema.json" });
                                a.click(); URL.revokeObjectURL(url);
                            };
                            win.document.getElementById("clearSchemaBtn").onclick = () => {
                                win.localStorage.removeItem(SCHEMA_KEY);
                                location.reload();
                            };
                        });

                        // 2) Runtime
                        async function renderPreview(schema) {
                            previewEl.innerHTML = "";
                            const form = await win.Formio.createForm(previewEl, schema);

                            // Example: compute a simple score client-side (optional)
                            // form.on("change", () => { /* derive score from form.data here */ });

                            form.on("submit", ({ data }) => {
                                const rows = JSON.parse(win.localStorage.getItem(RESPONSES_KEY) || "[]");
                                rows.push({ _submittedAt: new Date().toISOString(), ...data });
                                win.localStorage.setItem(RESPONSES_KEY, JSON.stringify(rows));
                                renderResponses();
                                alert("Saved locally ✅");
                            });
                        }

                        // 3) Responses table + CSV export (all in browser)
                        function renderResponses() {
                            const rows = JSON.parse(win.localStorage.getItem(RESPONSES_KEY) || "[]");
                            if (!rows.length) { win.document.getElementById("responsesTable").innerHTML = "<em>No responses yet.</em>"; return; }

                            const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
                            const th = headers.map(h => `<th>${h}</th>`).join("");
                            const tr = rows.map(r => `<tr>${headers.map(h => `<td>${escapeHtml(valueToText(r[h]))}</td>`).join("")}</tr>`).join("");
                            win.document.getElementById("responsesTable").innerHTML = `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
                        }
                        renderResponses();

                        win.document.getElementById("exportCsvBtn").onclick = () => {
                            const rows = JSON.parse(win.localStorage.getItem(RESPONSES_KEY) || "[]");
                            if (!rows.length) return alert("Nothing to export yet.");
                            const headers = Array.from(new Set(rows.flatMap(Object.keys)));
                            const csv = [headers.join(","), ...rows.map(r => headers.map(h => csvCell(r[h])).join(","))].join("\n");
                            const blob = new Blob([csv], { type: "text/csv" });
                            const url = URL.createObjectURL(blob);
                            const a = Object.assign(win.document.createElement("a"), { href: url, download: "responses.csv" });
                            a.click(); URL.revokeObjectURL(url);
                        };

                        win.document.getElementById("clearResponsesBtn").onclick = () => {
                            win.localStorage.removeItem(RESPONSES_KEY);
                            renderResponses();
                        };

                        // Helpers
                        function valueToText(v) {
                            if (v == null) return "";
                            if (Array.isArray(v)) return v.join("; ");
                            if (typeof v === "object") return JSON.stringify(v);
                            return String(v);
                        }
                        function csvCell(v) {
                            const s = valueToText(v).replace(/"/g, '""');
                            return `"${s}"`;
                        }
                        function escapeHtml(s) {
                            return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                        }
                    }
                },
                external: true,
            },
            `
<div class="grid">
    <div class="panel">
      <h3>Builder</h3>
      <div id="builder" style="height: 70vh; overflow:auto;"></div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button id="saveSchemaBtn">Export schema (JSON)</button>
        <button id="clearSchemaBtn">Clear schema</button>
      </div>
    </div>

    <div class="panel">
      <h3>Preview (runtime)</h3>
      <div id="preview" style="height: 70vh; overflow:auto;"></div>
    </div>
  </div>

  <div class="panel" id="responses" style="margin-top:16px;">
    <h3>Responses (stored locally)</h3>
    <div style="display:flex; gap:8px; margin-bottom:8px;">
      <button id="exportCsvBtn">Export CSV</button>
      <button id="clearResponsesBtn">Clear responses</button>
    </div>
    <div id="responsesTable"></div>
  </div>

 `);
    }
});