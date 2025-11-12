AnnotationsGUI.PathologyMetricsWindow = class {
    constructor({ annotations, userInterface, pluginId, THIS }) {
        this.annotations = annotations;            // OSDAnnotations instance
        this.ui = userInterface;
        this.pluginId = pluginId;                  // container / plugin id for addHtml
        this.THIS = THIS;                          // global reference string to this class instance
        this.windowId = "pathology-metrics-window";

        this.results = []; // [{id, label, metric, value, count, color}]
        this.resultSeq = 1;

        // simple calculator state
        this.calc = { a: null, op: "+", b: null, out: null };
        this.closed = true;
        this.reset();
    }

    reset() {
        if (!this.closed) return;
        this._addWindow();
        this._populatePresets();
        this._renderResults();
        this._renderCalculator();
        this.closed = false;
    }

    // ---------- UI ----------
    _addWindow() {
        const html = `
      <div class="flex flex-col h-full" style="min-height:0;">
        <!-- Preset chooser -->
        <div class="p-2 border-b border-[var(--color-border-secondary)]">
          <div class="text-sm font-medium mb-1">Preset</div>
          <div class="flex gap-2 items-center">
            <select id="pmw-preset" class="flex-1 px-2 py-1 text-sm border border-[var(--color-border-secondary)] rounded-md" style="background:var(--color-bg-primary);color:var(--color-text-primary);"></select>

            <div class="flex items-center gap-2">
              <label class="text-sm flex items-center gap-1">
                <input type="radio" name="pmw-metric" value="area" checked />
                Area
              </label>
              <label class="text-sm flex items-center gap-1">
                <input type="radio" name="pmw-metric" value="length" />
                Length
              </label>
            </div>

            <button class="px-3 py-1 btn btn-pointer text-sm" onclick="${this.THIS}._computeSelected()">Compute</button>
          </div>

          <div class="text-xs opacity-70 mt-1">Area in unit², length in unit (aggregate per preset).</div>
        </div>

        <!-- Results list -->
        <div id="pmw-results" class="flex-1 overflow-y-auto p-2 space-y-2" style="min-height:0;"></div>

        <!-- Calculator -->
        <div class="p-2 border-t border-[var(--color-border-secondary)]">
          <div class="text-sm font-medium mb-2">Combine results</div>
          <div class="flex gap-2 items-center mb-2">
            <select id="pmw-calc-a" class="px-2 py-1 text-sm border rounded-md flex-1" style="background:var(--color-bg-primary);color:var(--color-text-primary);"></select>

            <select id="pmw-calc-op" class="px-2 py-1 text-sm border rounded-md" style="background:var(--color-bg-primary);color:var(--color-text-primary);">
              <option value="+">+</option>
              <option value="-">−</option>
<!--              <option value="*">×</option>-->
              <option value="/">÷</option>
            </select>

            <select id="pmw-calc-b" class="px-2 py-1 text-sm border rounded-md flex-1" style="background:var(--color-bg-primary);color:var(--color-text-primary);"></select>

            <button class="px-3 py-1 btn btn-pointer text-sm" onclick="${this.THIS}._computeCalc()">=</button>
          </div>

          <div id="pmw-calc-out" class="text-sm px-2 py-1 rounded-md border border-[var(--color-border-secondary)]" style="background:var(--color-bg-primary);">
            <span class="opacity-70">Result:</span> <span id="pmw-calc-out-val">—</span>
          </div>

          <div class="flex gap-2 mt-2">
            <button class="px-3 py-1 btn btn-pointer text-sm" onclick="${this.THIS}._saveCalcAsResult()">Save as result</button>
            <button class="px-3 py-1 btn btn-pointer text-sm" onclick="${this.THIS}._copyResults()">Copy CSV</button>
            <button class="px-3 py-1 btn btn-pointer text-sm" onclick="${this.THIS}._clearAll()">Clear</button>
          </div>
        </div>
      </div>
    `;

        this.ui.addHtml(
            new UI.FloatingWindow(
                {
                    id: this.windowId,
                    title: "Metrics",
                    closable: true,
                    onClose: () => this.closed = true,
                },
                new UI.RawHtml({}, html)
            ),
            this.pluginId
        );
    }

    _populatePresets() {
        const sel = document.getElementById("pmw-preset");
        if (!sel) return;

        // read available presets
        const ids = this.annotations.presets.getExistingIds(); // array of ids
        // best effort: show human name if present, else id
        const options = ids.map((id) => {
            const p = this.annotations.presets.get(id);
            const name = (p?.meta?.category?.value || p?.meta?.category || id || "").toString();
            return { id, name: name || id, color: p?.color || "#999" };
        });

        sel.innerHTML = options
            .map(
                (o) =>
                    `<option value="${o.id}" style="color:${o.color}">${this._escape(o.name)}</option>`
            )
            .join("");
    }

    _renderResults() {
        const root = document.getElementById("pmw-results");
        if (!root) return;

        if (this.results.length === 0) {
            root.innerHTML = `<div class="text-sm opacity-70">No computed results yet.</div>`;
            this._renderCalculator();
            return;
        }

        root.innerHTML = this.results
            .map(
                (r) => `
        <div class="border border-[var(--color-border-secondary)] rounded-md p-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium">
              ${this._escape(r.label)}
              <span class="text-xs opacity-70">(${r.metric}, ${r.count} obj)</span>
            </div>
            <button class="material-icons btn btn-pointer px-2" title="Remove" onclick="${this.THIS}._removeResult('${r.id}')">close</button>
          </div>
          <div class="text-sm mt-1">
            <div class="text-sm mt-1"><span class="opacity-70">Value:</span> ${this._format(r.value, r.metric)}</div>
          </div>
          <div class="text-xs opacity-70">Result id: ${r.id}</div>
        </div>
      `
            )
            .join("");

        this._renderCalculator();
    }

    _renderCalculator() {
        const mkOpts = () =>
            this.results
                .map(
                    (r) =>
                        `<option value="${r.id}">${this._escape(r.id)} — ${this._escape(
                            r.label
                        )} (${r.metric})</option>`
                )
                .join("");

        const a = document.getElementById("pmw-calc-a");
        const b = document.getElementById("pmw-calc-b");
        if (a) a.innerHTML = `<option value="">(pick)</option>` + mkOpts();
        if (b) b.innerHTML = `<option value="">(pick)</option>` + mkOpts();
    }

    // ---------- Compute ----------
    _computeSelected() {
        const presetId = (document.getElementById("pmw-preset") || {}).value;
        const metric = [...document.querySelectorAll(`input[name="pmw-metric"]`)]
            .find((n) => n.checked)?.value || "area";

        if (!presetId) return;

        const { total, count, label } = this._computeForPreset(presetId, metric);
        const id = `R${this.resultSeq++}`;

        this.results.push({ id, label, metric, value: total, count });
        this._renderResults();
    }

    _computeForPreset(presetId, metric) {
        // collect fabric objects that are full annotations and belong to this preset
        const objs = this.annotations.filter(
            (o) => this.annotations.isAnnotation(o) && o.presetID === presetId
        );

        const preset = this.annotations.presets.get(presetId);
        const human = (preset?.meta?.category?.value || preset?.meta?.category || presetId).toString();

        let total = 0;
        let count = 0;

        const isArea = metric === "area";

        for (const o of objs) {
            const v = isArea ? this._areaOf(o) : this._lengthOf(o);
            if (Number.isFinite(v)) {
                total += v;
                count++;
            }
        }

        const sb = VIEWER.scalebar;
        total = isArea ? sb.imageArea(total) : sb.imageLength(total);
        const label = `${human} — ${metric}`;
        return { total, count, metric, label };
    }

    _areaOf(o) {
        const factory = this.annotations.getAnnotationObjectFactory(o.factoryID);
        if (factory && typeof factory.getArea === "function") {
            try { return factory.getArea(o); } catch { /* fallthrough */ }
        }

        return undefined;
    }

    _lengthOf(o) {
        const factory = this.annotations.getAnnotationObjectFactory(o.factoryID);
        if (factory && typeof factory.getLength === "function") {
            try { return factory.getLength(o); } catch { /* fallthrough */ }
        }

        if (o.type === "polyline") {
            const pts = o.points || [];
            let sum = 0;
            for (let i = 1; i < pts.length; i++) {
                sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            }
            return sum;
        }

        return undefined;
    }

    // ---------- Calculator ----------
    _computeCalc() {
        const aSel = document.getElementById("pmw-calc-a");
        const bSel = document.getElementById("pmw-calc-b");
        const opSel = document.getElementById("pmw-calc-op");

        const aid = aSel?.value || "";
        const bid = bSel?.value || "";
        const op = opSel?.value || "+";

        const A = this.results.find((r) => r.id === aid);
        const B = this.results.find((r) => r.id === bid);

        if (!A || !B) {
            this._setCalcOut("—");
            return;
        }

        if (A.metric !== B.metric ) {
            this._setCalcOut(`Unit mismatch (${A.metric} vs ${B.metric})`);
            return;
        }

        let customMetric = false;
        let out;
        switch (op) {
            case "+": out = A.value + B.value; break;
            case "-": out = A.value - B.value; break;
            // case "*": out = A.value * B.value; break;   multiplication needs to remove double the units, not needed for now anyway
            case "/": out = B.value === 0 ? NaN : Math.round(A.value / B.value * 100) / 100; customMetric = "percent"; break;
        }

        if (!Number.isFinite(out)) {
            this._setCalcOut("NaN");
            return;
        }

        this.calc = { a: aid, op, b: bid, out, metric: customMetric || A.metric };
        this._setCalcOut(customMetric ? out : this._format(out, A.metric) );
    }

    _setCalcOut(text) {
        const el = document.getElementById("pmw-calc-out-val");
        if (el) el.textContent = text;
    }

    _saveCalcAsResult() {
        if (!this.calc?.out || !Number.isFinite(this.calc.out)) return;
        const a = this.results.find((r) => r.id === this.calc.a);
        const b = this.results.find((r) => r.id === this.calc.b);
        const label = `(${a?.id} ${this.calc.op} ${b?.id})`;
        const id = `R${this.resultSeq++}`;
        this.results.push({ id, label, metric: this.calc.metric, value: this.calc.out, count: 0 });
        this._renderResults();
        this._setCalcOut("—");
    }

    _copyResults() {
        const rows = [
            ["id", "label", "metric", "value", "count"].join(","),
            ...this.results.map((r) =>
                [r.id, r.label, r.metric, this._format(r.value, r.metric), r.count].map(this._csv).join(",")
            ),
        ].join("\n");

        UTILITIES.copyToClipboard(rows);
    }

    _clearAll() {
        this.results = [];
        this.resultSeq = 1;
        this.calc = { a: null, op: "+", b: null, out: null };
        this._renderResults();
        this._setCalcOut("—");
    }

    _removeResult(id) {
        this.results = this.results.filter((r) => r.id !== id);
        this._renderResults();
    }

    // ---------- helpers ----------
    _escape(s) {
        return (s ?? "").toString().replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])
        );
    }
    _csv(s) {
        const t = (s ?? "").toString();
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    }
    _format(n, type) {
        // compact but precise enough for pathology summaries
        if (!Number.isFinite(n)) return "NaN";

        const sb = VIEWER.scalebar;
        if (type === "area") return sb.formatArea(n);
        return sb.formatLength(n);
    }
}


