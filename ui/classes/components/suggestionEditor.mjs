import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";

const { div, span, button } = van.tags;

/**
 * Cap on the diff DP table (cells). Beyond this the component skips the word-diff
 * and renders a plain editable surface — the review chips would be too many to be
 * useful and the O(n·m) table too large. ~16M Uint16 cells ≈ 32 MB, transient.
 */
const MAX_DIFF_CELLS = 16_000_000;

/**
 * SuggestionEditor — a reusable inline change-review surface.
 *
 * Given an `original` text and a `suggested` rewrite, it renders the two as a single
 * editable region: unchanged runs are plain (freely editable) text, and each
 * difference is an inline **chip** showing `original → suggested`. Every chip is
 * ACCEPTED by default; one click **declines** it (reverts to the original). The
 * suggested side of a chip is itself editable, so the user can type their own value,
 * and they can edit anywhere in the plain regions too.
 *
 * `getValue()` resolves the surface back to a plain string honouring every decision
 * and edit. Generic — the diff is computed from text, no domain knowledge. Typical
 * use: reviewing an LLM spelling/terminology correction before adopting it.
 *
 * @example
 *   const ed = new UI.SuggestionEditor({ original, suggested });
 *   modalBody.append(ed.create());
 *   // ... later
 *   const finalText = ed.getValue();
 */
export class SuggestionEditor extends BaseComponent {
    /**
     * @param {object} options
     * @param {string} options.original the baseline text
     * @param {string} options.suggested the proposed rewrite (diffed against original)
     * @param {Array<{type:"equal"|"change", text?:string, original?:string, suggested?:string}>} [options.segments]
     *   precomputed diff segments; when given, `original`/`suggested` are not diffed
     * @param {boolean} [options.acceptedByDefault=true] initial chip state
     * @param {boolean} [options.spellcheck=true] native spellcheck on the editable surface
     * @param {(value:string)=>void} [options.onChange] called after any accept/decline/edit
     */
    constructor(options = undefined, ...children) {
        options = super(options, ...children).options;
        this._original = String(options.original ?? "");
        this._suggested = options.suggested === undefined || options.suggested === null
            ? this._original : String(options.suggested);
        this._acceptedByDefault = options.acceptedByDefault !== false;
        this._spellcheck = options.spellcheck !== false;
        this._onChange = typeof options.onChange === "function" ? options.onChange : null;
        this._segments = Array.isArray(options.segments)
            ? options.segments
            : SuggestionEditor.diffWords(this._original, this._suggested);
        /** @type {Array<{el:HTMLElement, suggSpan:HTMLElement, original:string, accepted:boolean, set:(on:boolean)=>void}>} */
        this._chips = [];
        this.root = null;
    }

    // ---- diff -------------------------------------------------------------

    /** Split into word + whitespace tokens, keeping separators so text reconstructs exactly. */
    static tokenize(s) {
        return String(s ?? "").split(/(\s+)/).filter((t) => t.length > 0);
    }

    /**
     * Word-level LCS diff. Returns ordered segments of `{type:"equal", text}` and
     * `{type:"change", original, suggested}`. Returns `null` when the inputs are
     * identical or too large to diff (caller then renders a plain surface).
     * @param {string} a
     * @param {string} b
     * @returns {Array|null}
     */
    static diffWords(a, b) {
        if (a === b) return null;
        const A = SuggestionEditor.tokenize(a);
        const B = SuggestionEditor.tokenize(b);
        const n = A.length, m = B.length;
        if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;

        // LCS length table (values ≤ min(n,m) ≤ 65535 for the capped size → Uint16).
        const w = m + 1;
        const dp = new Uint16Array((n + 1) * w);
        for (let i = n - 1; i >= 0; i--) {
            const rowi = i * w, rown = (i + 1) * w;
            for (let j = m - 1; j >= 0; j--) {
                dp[rowi + j] = A[i] === B[j]
                    ? dp[rown + (j + 1)] + 1
                    : Math.max(dp[rown + j], dp[rowi + (j + 1)]);
            }
        }

        // Backtrack into raw ops, then coalesce runs into segments.
        const segments = [];
        let eqBuf = "", delBuf = "", insBuf = "";
        const flushChange = () => {
            if (delBuf || insBuf) segments.push({ type: "change", original: delBuf, suggested: insBuf });
            delBuf = ""; insBuf = "";
        };
        const flushEqual = () => {
            if (eqBuf) segments.push({ type: "equal", text: eqBuf });
            eqBuf = "";
        };
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (A[i] === B[j]) {
                flushChange();
                eqBuf += A[i]; i++; j++;
            } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
                flushEqual();
                delBuf += A[i]; i++;
            } else {
                flushEqual();
                insBuf += B[j]; j++;
            }
        }
        while (i < n) { flushEqual(); delBuf += A[i]; i++; }
        while (j < m) { flushEqual(); insBuf += B[j]; j++; }
        flushEqual(); flushChange();

        // Whitespace-only changes are noise (STT/LLM reflow spacing, not a correction):
        // a change whose two sides are equal ignoring whitespace is demoted to an equal
        // segment (keeping the ORIGINAL spacing). Adjacent equals are then coalesced so
        // the surface stays continuous text rather than fragmented runs.
        const norm = (s) => String(s).replace(/\s+/g, " ").trim();
        const merged = [];
        for (const seg of segments) {
            let s = seg;
            if (s.type === "change" && norm(s.original) === norm(s.suggested)) {
                s = { type: "equal", text: s.original || s.suggested };
            }
            const prev = merged[merged.length - 1];
            if (s.type === "equal" && prev && prev.type === "equal") prev.text += s.text;
            else merged.push(s);
        }
        return merged.some((s) => s.type === "change") ? merged : null;
    }

    // ---- render -----------------------------------------------------------

    create() {
        if (this.root) return this.root;

        const surface = div({
            class: "textarea textarea-bordered w-full",
            contenteditable: "true",
            spellcheck: this._spellcheck ? "true" : "false",
            style: "min-height:40vh;max-height:50vh;overflow:auto;font-size:13px;line-height:1.7;"
                + "white-space:pre-wrap;word-break:break-word;",
            oninput: () => this._emitChange(),
        });

        if (!this._segments) {
            // No diff (identical, or too large): a plain editable surface seeded with
            // the suggested text (falls back to original when there was no suggestion).
            surface.append(document.createTextNode(this._suggested || this._original));
        } else {
            for (const seg of this._segments) {
                if (seg.type === "equal") {
                    surface.append(document.createTextNode(seg.text));
                } else {
                    surface.append(this._buildChip(seg.original || "", seg.suggested || ""));
                }
            }
        }

        this.root = surface;
        return this.root;
    }

    /** One inline accept/decline chip. All text via textContent — never innerHTML. */
    _buildChip(original, suggested) {
        // Editable suggested side (user can retype their own value).
        const suggSpan = span({
            class: "se-sugg",
            contenteditable: "true",
            style: "outline:none;padding:0 2px;border-radius:3px;background:rgba(34,197,94,0.18);",
            oninput: () => this._emitChange(),
        }, suggested);
        // Original side, shown struck through while the suggestion is accepted.
        const origSpan = span({
            style: "padding:0 2px;text-decoration:line-through;opacity:0.6;",
        }, original);
        const toggle = button({
            type: "button",
            class: "btn btn-ghost btn-xs btn-square",
            contenteditable: "false",
            style: "min-height:0;height:1.2rem;width:1.2rem;padding:0;margin-left:2px;opacity:0.7;",
        }, span({ class: "ph-light ph-x text-xs" }));

        const chip = span({
            class: "suggestion-chip",
            contenteditable: "false",
            // Keep the original as data so decline resolves it without re-reading DOM order.
            style: "display:inline-flex;align-items:center;gap:2px;padding:0 3px;margin:0 1px;"
                + "border:1px solid rgba(128,128,128,0.35);border-radius:5px;vertical-align:baseline;"
                + "white-space:normal;",
        }, origSpan, suggSpan, toggle);
        chip.dataset.suggestionChip = "1";
        chip.dataset.original = original;

        const rec = { el: chip, suggSpan, original, accepted: this._acceptedByDefault };
        rec.set = (on) => {
            rec.accepted = !!on;
            chip.dataset.accepted = rec.accepted ? "1" : "0";
            // Accepted → suggested is the live/highlighted side, original struck.
            // Declined → original is chosen (plain), suggested struck.
            origSpan.style.textDecoration = rec.accepted ? "line-through" : "none";
            origSpan.style.opacity = rec.accepted ? "0.6" : "1";
            suggSpan.style.textDecoration = rec.accepted ? "none" : "line-through";
            suggSpan.style.opacity = rec.accepted ? "1" : "0.6";
            suggSpan.style.background = rec.accepted ? "rgba(34,197,94,0.18)" : "transparent";
            suggSpan.setAttribute("contenteditable", rec.accepted ? "true" : "false");
            toggle.firstChild.className = rec.accepted ? "ph-light ph-x text-xs" : "ph-light ph-arrow-counter-clockwise text-xs";
            toggle.title = rec.accepted ? $.t("common.declineSuggestion") : $.t("common.acceptSuggestion");
        };
        toggle.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            rec.set(!rec.accepted);
            this._emitChange();
        };
        rec.set(rec.accepted);   // initial paint
        this._chips.push(rec);
        return chip;
    }

    // ---- API --------------------------------------------------------------

    /** Accept every suggestion. */
    acceptAll() { this._chips.forEach((c) => c.set(true)); this._emitChange(); }
    /** Decline every suggestion (revert to originals). */
    rejectAll() { this._chips.forEach((c) => c.set(false)); this._emitChange(); }

    /**
     * The resolved text: plain regions verbatim, each chip contributing its accepted
     * side (its possibly-edited suggested text) or its original when declined.
     * @returns {string}
     */
    getValue() {
        if (!this.root) return this._suggested || this._original;
        return this._serialize(this.root);
    }

    /** DOM-order walk honouring chips and block/line breaks. @private */
    _serialize(node) {
        let out = "";
        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                out += child.nodeValue;
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue;
            if (child.dataset && child.dataset.suggestionChip) {
                out += this._chipValue(child);
                continue;
            }
            const tag = child.tagName;
            if (tag === "BR") { out += "\n"; continue; }
            // contenteditable wraps new lines in block elements — treat as a newline.
            const block = tag === "DIV" || tag === "P";
            if (block && out && !out.endsWith("\n")) out += "\n";
            out += this._serialize(child);
        }
        return out;
    }

    /** Resolve one chip element to its chosen text. @private */
    _chipValue(chip) {
        const accepted = chip.dataset.accepted !== "0";
        if (!accepted) return chip.dataset.original || "";
        const sugg = chip.querySelector(".se-sugg");
        return sugg ? sugg.textContent : (chip.dataset.original || "");
    }

    /** @private */
    _emitChange() {
        if (!this._onChange) return;   // no consumer — skip the DOM serialization
        try { this._onChange(this.getValue()); }
        catch (e) { console.warn("[SuggestionEditor] onChange failed", e); }
    }
}
