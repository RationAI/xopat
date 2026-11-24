/**
 * Two source-level guards for AGENTS.md §0 rule 2 / §7 ("no innerHTML with
 * caller strings", "no inline handlers"):
 *
 *  1. `ui/classes` + `ui/services` may assign markup to the DOM only at the
 *     sites listed in ALLOWED below, each with the reason it is safe. A new
 *     assignment fails here until it is either rewritten (textContent, van.js,
 *     `BaseComponent.toNode`) or justified in the list.
 *  2. `modules/` and `plugins/` sources may not build markup carrying inline
 *     `on*="..."` handlers. Those need a global to call, break under every
 *     sanitizer, and are how mode-option panels used to be wired — controls are
 *     nodes with real listeners (`AnnotationState.customControls()`).
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function walk(dir, accept, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "test" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        let stat;
        // Follow symlinks: elements can be linked in from their own repository.
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.isDirectory()) walk(full, accept, out);
        else if (accept(entry.name)) out.push(full);
    }
    return out;
}

const rel = file => path.relative(ROOT, file).split(path.sep).join("/");

// file -> [substring of the allowed line, why it is safe]
const ALLOWED = {
    "ui/classes/baseComponent.mjs": [
        ["wrap.innerHTML = sanitize(s, HTML_ALLOWLIST)", "sanitized through the vetted allowlist"],
        ["holder.innerHTML = value", "inert <template> parse (parseDomNodes); known raw path, see xss_report"],
    ],
    "ui/classes/components/toast.mjs": [
        ["el.innerHTML = sanitize(raw, TOAST_ALLOWLIST)", "sanitized"],
        ["iconEl.innerHTML = this._importance.icon || ICONS.info", "module-constant SVG"],
        ["span({ innerHTML: ICONS.close })", "module-constant SVG"],
    ],
    "ui/classes/components/explorer.mjs": [
        ["el.innerHTML = `", "static loader template; interpolates only the component id"],
    ],
    "ui/classes/components/floatingWindow.mjs": [
        ["header.innerHTML = `", "title goes through escapeHtml"],
        ["this._externalBodyEl.innerHTML = this._getExternalContentHtml()", "strings sanitized in serializeDomLike"],
        ["this._externalBodyEl.innerHTML = `", "title goes through escapeHtml"],
    ],
    "ui/classes/elements/rawHtml.mjs": [
        ["el.innerHTML = html", "RawHtml is the explicit trusted-markup element; never feed it caller strings"],
        ["el.innerHTML = this._html", "same"],
    ],
};

// Assignment (or van `innerHTML:` prop); clearing with an empty literal is fine.
const HTML_SINK = /\b(?:innerHTML|outerHTML)\s*[:=](?!=)|\binsertAdjacentHTML\s*\(/;
const CLEAR = /\b(?:innerHTML|outerHTML)\s*[:=]\s*(?:""|''|``)\s*(?:[;,)}]|$)/;

test("ui/ assigns markup only at the justified sites", () => {
    const files = [
        ...walk(path.join(ROOT, "ui", "classes"), name => name.endsWith(".mjs")),
        ...walk(path.join(ROOT, "ui", "services"), name => name.endsWith(".mjs")),
    ];
    expect(files.length).toBeGreaterThan(0);

    const found = [];
    for (const file of files) {
        const allowed = ALLOWED[rel(file)] || [];
        fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
            const code = line.trim();
            if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
            if (!HTML_SINK.test(code) || CLEAR.test(code)) return;
            if (allowed.some(([snippet]) => code.includes(snippet))) return;
            found.push(`${rel(file)}:${index + 1}: ${code}`);
        });
    }
    expect(found).toEqual([]);
});

// A handler attribute inside a string/template: ` onchange="` / ` onclick='` / ` oninput=${`.
const INLINE_HANDLER = /\son[a-z]+\s*=\s*\\?["'`$]/;
const SOURCE = /\.(?:js|mjs|ts|mts)$/;
const BUILT = /(?:^index\.workspace\.|\.min\.|\.bak\.|\.d\.ts$)/;

test("modules/ and plugins/ build no markup with inline event handlers", () => {
    const files = ["modules", "plugins"].flatMap(kind =>
        walk(path.join(ROOT, kind), name => SOURCE.test(name) && !BUILT.test(name)));
    expect(files.length).toBeGreaterThan(0);

    const found = [];
    for (const file of files) {
        fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
            const code = line.trim();
            if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
            if (INLINE_HANDLER.test(line)) found.push(`${rel(file)}:${index + 1}: ${code.slice(0, 160)}`);
        });
    }
    expect(found).toEqual([]);
});
