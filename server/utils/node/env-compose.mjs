/**
 * Deployment ENV composition — the single merge authority.
 *
 * ## Why this exists
 *
 * The server takes exactly one deployment configuration: `XOPAT_ENV` names a
 * file (or carries inline JSON), it is parsed, and `ENV.core` is deep-merged
 * over `src/config.json` — see `objectMergeRecursiveDistinct` and the
 * three-way resolution in `server/templates/javascript/core.js`. There is no
 * inheritance and no composition, so "IDC DICOM **with** SAML auth" has
 * historically meant hand-copying blocks into yet another whole-file variant.
 * That is how `env/` grew ~35 near-identical files differing by a handful of
 * lines each, with nothing recording *which* lines.
 *
 * This module makes a deployment an ordered list of **layers** instead: small
 * secret-free fragments (`env/parts/**`), named presets (`env/presets.json`),
 * and — because a custom configuration must stay first-class — any whole ENV
 * file, all in the same selector list. The composed result is a plain ENV
 * object the server already understands, so nothing downstream changes.
 *
 * ## What it refuses to do
 *
 * Composition without conflict detection would reproduce the original bug with
 * extra steps: a silent winner is exactly what makes today's 35 files
 * untrustworthy. So every leaf write is recorded with its provenance, and two
 * layers writing the same leaf to different values is an error, not a
 * last-wins merge. Layers that *exist* to be overridden (a `$base`, an explicit
 * `--set`) are exempt by role, so only genuine ambiguity blocks.
 *
 * It also never substitutes `<% VAR %>` placeholders. Those are resolved by the
 * server at read time against `process.env` (`core.js`, mirrored in
 * `server/php/inc/core.php`), which keeps the composed artifact secret-free and
 * safe to paste into a bug report. This module only *reports* which names a
 * composition needs.
 *
 * Consumers: `server/utils/node/env-cli.mjs` (the `npm run up` runner) and
 * `test/harness/env-scratch.mjs` (the Playwright deployment matrix).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "comment-json";

/* ------------------------------------------------------------------ paths */

function findRepoRoot(start) {
    let dir = start;
    for (;;) {
        const manifest = path.join(dir, "package.json");
        if (existsSync(manifest)) {
            try {
                const pkg = JSON.parse(readFileSync(manifest, "utf8"));
                if (pkg.name === "xopat" && existsSync(path.join(dir, "src", "config.json"))) return dir;
            } catch { /* unreadable manifest — keep walking */ }
        }
        const parent = path.dirname(dir);
        if (parent === dir) throw new Error(`[env-compose] could not locate the repository root above ${start}`);
        dir = parent;
    }
}

/** Absolute path of the xOpat checkout this module belongs to. */
export const repoRoot = findRepoRoot(import.meta.dirname);

/** Resolve a repo-relative path. */
export const fromRoot = (...parts) => path.resolve(repoRoot, ...parts);

/** Where the tracked fragment library lives. */
export const PARTS_DIR = "env/parts";
/** Where the tracked preset catalogue lives. */
export const PRESETS_FILE = "env/presets.json";

/* ------------------------------------------------------------- primitives */

/**
 * Parse a JSONC file the way the server does (comments stripped, so the result
 * is plain data with no `comment-json` symbols attached). Missing file → `{}`.
 */
export function readJsonc(file) {
    const abs = path.isAbsolute(file) ? file : fromRoot(file);
    if (!existsSync(abs)) return {};
    return parse(readFileSync(abs, "utf8"), undefined, true) ?? {};
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Structural equality for JSON data. */
export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (typeof a !== "object") return false;
    if (Array.isArray(a)) {
        return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

const clone = (v) => (v === undefined ? v : structuredClone(v));

/**
 * Deep merge, arrays replaced wholesale — the server's ENV-over-config overlay
 * (`core.js` `objectMergeRecursiveDistinct`). Copied values are cloned so the
 * result never aliases (and cannot later mutate) a cached layer.
 *
 * One deliberate divergence: the server recurses when an *array* overlays a
 * plain object, merging indices into it. That is incoherent, so here an array
 * always replaces — and the conflict detector reports the case as a type
 * change rather than letting the two implementations disagree silently.
 */
export function mergeDeep(base, overlay) {
    if (!isPlainObject(overlay)) return overlay === undefined ? clone(base) : clone(overlay);
    // Clone rather than spread: a shallow copy would leave every subtree the
    // overlay does not touch aliasing the source layer, and a later in-place
    // edit of the result (the test harness patches its scratch ENV) would
    // silently rewrite a cached fragment.
    const out = isPlainObject(base) ? clone(base) : {};
    for (const [key, value] of Object.entries(overlay)) {
        out[key] = isPlainObject(value) ? mergeDeep(out[key], value) : clone(value);
    }
    return out;
}

/* ------------------------------------------------------------------ layers */

const META_KEY = "$meta";
const BASE_KEY = "$base";
const LAYERS_KEY = "$layers";
const STRUCTURAL_KEYS = new Set([META_KEY, BASE_KEY, LAYERS_KEY, "$schema"]);

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Split a raw file body into its composition metadata and its ENV payload. */
function splitBody(body) {
    const meta = isPlainObject(body?.[META_KEY]) ? body[META_KEY] : {};
    const bases = [...asList(body?.[BASE_KEY]), ...asList(body?.[LAYERS_KEY])].filter(
        (s) => typeof s === "string" && s.trim());
    const data = {};
    for (const [k, v] of Object.entries(body ?? {})) {
        if (!STRUCTURAL_KEYS.has(k)) data[k] = v;
    }
    return { meta, bases, data };
}

/** Every fragment id available in `env/parts/**` (posix-style, no extension). */
export function listFragments() {
    const root = fromRoot(PARTS_DIR);
    const out = [];
    const walk = (dir, prefix) => {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir).sort()) {
            const abs = path.join(dir, entry);
            if (statSync(abs).isDirectory()) walk(abs, prefix ? `${prefix}/${entry}` : entry);
            else if (entry.endsWith(".json")) {
                const id = `${prefix ? `${prefix}/` : ""}${entry.slice(0, -5)}`;
                const { meta } = splitBody(readJsonc(abs));
                out.push({ id, file: path.relative(repoRoot, abs).split(path.sep).join("/"), meta });
            }
        }
    };
    walk(root, "");
    return out;
}

/** The preset catalogue, or `{}` when the file is absent. */
export function loadPresets() {
    const body = readJsonc(PRESETS_FILE);
    return isPlainObject(body?.presets) ? body.presets : {};
}

function fragmentFile(selector) {
    const rel = selector.endsWith(".json") ? selector : `${selector}.json`;
    const abs = fromRoot(PARTS_DIR, rel);
    return existsSync(abs) ? abs : null;
}

function fileFor(selector) {
    const abs = path.isAbsolute(selector) ? selector : fromRoot(selector);
    return existsSync(abs) && statSync(abs).isFile() ? abs : null;
}

function suggestions(selector, presets) {
    const needle = selector.toLowerCase().replace(/[^a-z0-9]/g, "");
    const pool = [...Object.keys(presets), ...listFragments().map((f) => f.id)];
    const near = pool.filter((c) => {
        const hay = c.toLowerCase().replace(/[^a-z0-9]/g, "");
        return hay.includes(needle) || needle.includes(hay.split("/").pop() ?? "");
    });
    return near.slice(0, 6);
}

/**
 * Resolve an ordered selector list into a flat, deduplicated layer list.
 *
 * A selector is, in order of precedence: a preset name, a fragment id under
 * `env/parts/`, or a path to any ENV file. That last rule is what keeps a
 * hand-written deployment first-class — `up -- env/env.mine.json logging/chat`
 * layers a fragment over a whole custom ENV.
 *
 * @returns {{layers: Layer[], defaults: object, env: object}}
 *   `defaults` are `$meta.defaults` from fragments (lowest precedence process
 *   env), `env` are preset `env` blocks (values the server reads *before* any
 *   config, so they cannot live in the ENV file itself).
 */
export function expandSelectors(selectors, opts = {}) {
    const presets = opts.presets ?? loadPresets();
    const layers = [];
    const byId = new Map();
    const defaults = {};
    const env = {};
    const seen = new Set();

    const push = (layer) => {
        const existing = byId.get(layer.id);
        if (existing) {
            // A shared base pulled in by two selectors is not two layers.
            if (existing.role !== "base" && layer.role === "base") existing.role = "base";
            return;
        }
        byId.set(layer.id, layer);
        layers.push(layer);
    };

    const addFile = (absFile, { id, kind, role, allowMissing = false }) => {
        if (seen.has(absFile)) {
            throw new Error(`[env-compose] circular layer chain at ${id}`);
        }
        seen.add(absFile);
        if (!allowMissing && !existsSync(absFile)) {
            throw new Error(`[env-compose] layer file not found: ${id}`);
        }
        const { meta, bases, data } = splitBody(readJsonc(absFile));
        // A layer reached as somebody's base exists to be overridden, whatever
        // role it declares for itself.
        for (const base of bases) resolve(base, "base");
        seen.delete(absFile);
        Object.assign(defaults, meta.defaults ?? {});
        push({
            id,
            kind,
            file: path.relative(repoRoot, absFile).split(path.sep).join("/"),
            role: role ?? (meta.role || "layer"),
            dimension: typeof meta.dimension === "string" ? meta.dimension : null,
            meta,
            data,
        });
    };

    const addPreset = (name, role) => {
        if (seen.has(`preset:${name}`)) throw new Error(`[env-compose] circular preset chain at ${name}`);
        seen.add(`preset:${name}`);
        const preset = presets[name];
        for (const parent of asList(preset.extends)) {
            if (!presets[parent]) throw new Error(`[env-compose] preset "${name}" extends unknown preset "${parent}"`);
            addPreset(parent, role);
        }
        for (const sel of asList(preset.layers)) resolve(sel, role);
        Object.assign(env, preset.env ?? {});
        if (isPlainObject(preset.override) && Object.keys(preset.override).length) {
            push({
                id: `preset:${name}#override`,
                kind: "override",
                file: PRESETS_FILE,
                role: "override",
                dimension: null,
                meta: {},
                data: preset.override,
            });
        }
        seen.delete(`preset:${name}`);
    };

    const resolve = (selector, role) => {
        if (typeof selector !== "string" || !selector.trim()) {
            throw new Error(`[env-compose] invalid selector: ${JSON.stringify(selector)}`);
        }
        const sel = selector.trim();
        if (presets[sel]) return addPreset(sel, role);
        const frag = fragmentFile(sel);
        if (frag) return addFile(frag, { id: sel, kind: "fragment", role });
        const file = fileFor(sel);
        if (file) {
            const id = path.isAbsolute(sel) ? sel : path.relative(repoRoot, file).split(path.sep).join("/");
            return addFile(file, { id, kind: "file", role });
        }
        const near = suggestions(sel, presets);
        throw new Error(
            `[env-compose] unknown selector "${sel}" — not a preset, not env/parts/${sel}.json, not a file.` +
            (near.length ? `\n  did you mean: ${near.join(", ")}` : "") +
            `\n  run \`npm run up -- --list\` to see everything available.`);
    };

    for (const selector of selectors) {
        if (opts.allowMissingFile && typeof selector === "string" && !presets[selector] &&
            !fragmentFile(selector) && !fileFor(selector)) {
            // Back-compat with the harness default (`env/env.json` may not exist).
            const abs = path.isAbsolute(selector) ? selector : fromRoot(selector);
            addFile(abs, { id: selector, kind: "file", allowMissing: true });
            continue;
        }
        resolve(selector, undefined);
    }
    return { layers, defaults, env };
}

/* -------------------------------------------------------------- composition */

/**
 * A layer that exists to be overridden is never a conflict party: a `$base`
 * states the starting point, an `--set`/preset override states the last word.
 * Only two peers disagreeing is ambiguous.
 */
const exempt = (current, previous) =>
    previous.role === "base" || current.role === "base" || current.role === "override";

/**
 * Merge layers, recording per-leaf provenance and every ambiguity found.
 *
 * A *leaf* is any value that is not a plain object — scalars, `null`, and
 * **arrays**, because arrays are replaced wholesale by the server's merge and
 * a silent whole-array replacement is precisely the failure mode being
 * designed out.
 *
 * Always returns a merged `env` (last-wins) so callers can report conflicts and
 * still honour `--force`.
 */
export function composeLayers(layers) {
    const leaves = new Map();       // path → {layer, value}
    const containers = new Map();   // path → layer id that first descended
    const conflicts = [];
    const warnings = [];

    const record = (layer, node, prefix) => {
        for (const [key, value] of Object.entries(node)) {
            const p = prefix ? `${prefix}.${key}` : key;
            const prev = leaves.get(p);
            if (isPlainObject(value)) {
                if (prev && !exempt(layer, prev.layer)) {
                    conflicts.push({
                        kind: "object-over-leaf", path: p,
                        parties: [{ layer: prev.layer.id, value: prev.value }, { layer: layer.id, value: "{…}" }],
                    });
                }
                leaves.delete(p);
                if (!containers.has(p)) containers.set(p, layer.id);
                record(layer, value, p);
                continue;
            }
            if (containers.has(p)) {
                if (!exempt(layer, { role: "layer", id: containers.get(p) })) {
                    conflicts.push({
                        kind: "leaf-over-subtree", path: p,
                        parties: [{ layer: containers.get(p), value: "{…}" }, { layer: layer.id, value }],
                    });
                }
            } else if (prev && !deepEqual(prev.value, value) && !exempt(layer, prev.layer)) {
                conflicts.push({
                    kind: Array.isArray(prev.value) && Array.isArray(value) ? "array-replacement" : "differing-leaf",
                    path: p,
                    parties: [{ layer: prev.layer.id, value: prev.value }, { layer: layer.id, value }],
                });
            }
            leaves.set(p, { layer, value });
        }
    };

    let env = {};
    for (const layer of layers) {
        record(layer, layer.data, "");
        env = mergeDeep(env, layer.data);
    }

    // Dimension exclusivity: two data sources or two auth brokers conflict even
    // when their key paths never touch.
    const byDimension = new Map();
    for (const layer of layers) {
        if (!layer.dimension || layer.role === "base" || layer.role === "override") continue;
        if (!byDimension.has(layer.dimension)) byDimension.set(layer.dimension, []);
        byDimension.get(layer.dimension).push(layer.id);
    }
    for (const [dimension, ids] of byDimension) {
        if (ids.length > 1) conflicts.push({ kind: "dimension", dimension, parties: ids.map((id) => ({ layer: id })) });
    }

    // Declared incompatibilities, symmetric.
    const present = new Set(layers.map((l) => l.id));
    for (const layer of layers) {
        for (const other of asList(layer.meta?.conflictsWith)) {
            if (present.has(other) && layer.id < other) {
                conflicts.push({ kind: "declared", parties: [{ layer: layer.id }, { layer: other }] });
            }
        }
    }

    // The server flattens `core.client` down to `client[active_client]` and
    // silently drops the rest, so a fragment writing under the wrong client key
    // produces no conflict yet no effect either.
    const active = env?.core?.active_client;
    const clients = Object.keys(env?.core?.client ?? {});
    if (active && clients.length > 1) {
        warnings.push({
            kind: "inactive-client",
            message: `core.active_client is "${active}" but core.client also defines ${
                clients.filter((c) => c !== active).map((c) => `"${c}"`).join(", ")
            } — the server discards those.`,
        });
    }
    if (active) {
        for (const [p, { layer }] of leaves) {
            const m = /^core\.client\.([^.]+)\./.exec(p);
            if (m && m[1] !== active) {
                warnings.push({
                    kind: "inactive-client-write",
                    message: `${layer.id} writes ${p}, but core.active_client is "${active}" — it has no effect.`,
                });
                break;
            }
        }
    }

    const provenance = {};
    for (const [p, { layer }] of [...leaves].sort(([a], [b]) => a.localeCompare(b))) provenance[p] = layer.id;

    return { env, provenance, conflicts, warnings, layers };
}

/** Selector list → composed ENV, in one call. */
export function composeEnv(selectors, opts = {}) {
    const { layers, defaults, env: presetEnv } = expandSelectors(selectors, opts);
    const extra = [];
    for (const [p, value] of Object.entries(opts.set ?? {})) extra.push({ path: p, value });
    if (extra.length) {
        const data = {};
        for (const { path: p, value } of extra) {
            const parts = p.split(".");
            let node = data;
            for (const key of parts.slice(0, -1)) node = node[key] ??= {};
            node[parts[parts.length - 1]] = value;
        }
        layers.push({ id: "--set", kind: "override", file: null, role: "override", dimension: null, meta: {}, data });
    }
    const result = composeLayers(layers);
    return { ...result, defaults, presetEnv };
}

/**
 * Back-compat entry point for the test harness: load one ENV file, following
 * its `$base` chain (string **or** array), with no conflict enforcement.
 * Missing top-level file → `{}`, as before.
 */
export function loadEnvFile(repoRelativePath, seen) {
    if (seen instanceof Set && seen.size) {
        // Legacy callers passed a `seen` set to guard recursion; expansion owns
        // that now, but honour an already-visited path the same way.
        const abs = path.isAbsolute(repoRelativePath) ? repoRelativePath : fromRoot(repoRelativePath);
        if (seen.has(abs)) throw new Error(`[env-compose] circular $base chain at ${repoRelativePath}`);
    }
    const { layers } = expandSelectors([repoRelativePath], { allowMissingFile: true });
    let env = {};
    for (const layer of layers) env = mergeDeep(env, layer.data);
    return env;
}

/* ---------------------------------------------------------------- scanning */

// Same grammar as the server's substitution (`core.js`), global rather than
// sticky: `<% NAME %>`, `<% NAME:-default %>`, `<% NAME-default %>`.
const PLACEHOLDER_RE = /<%\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*(:?-)\s*((?:(?!%>).)*?))?\s*%>/g;

const walkStrings = (node, prefix, visit) => {
    if (typeof node === "string") return visit(node, prefix);
    if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, `${prefix}[${i}]`, visit));
    if (isPlainObject(node)) {
        for (const [k, v] of Object.entries(node)) walkStrings(v, prefix ? `${prefix}.${k}` : k, visit);
    }
};

/**
 * Every `<% VAR %>` a composition needs.
 * @returns {Map<string, {name: string, hasDefault: boolean, paths: string[]}>}
 */
export function collectPlaceholders(env) {
    const found = new Map();
    walkStrings(env, "", (str, p) => {
        for (const m of str.matchAll(PLACEHOLDER_RE)) {
            const name = m[1];
            const entry = found.get(name) ?? { name, hasDefault: false, paths: [] };
            if (m[2]) entry.hasDefault = true;
            entry.paths.push(p);
            found.set(name, entry);
        }
    });
    return found;
}

const SECRET_PATTERNS = [
    ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{16,}/],
    ["openai-style-key", /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}/],
    ["github-token", /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
    ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}/],
    ["google-client-secret", /\bGOCSPX-[A-Za-z0-9_-]{10,}/],
    ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
    ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ["bearer-literal", /\bBearer\s+[A-Za-z0-9_.-]{24,}/],
];

/**
 * Literal credentials in an ENV tree. `env/parts/**` is tracked, so this is the
 * gate that keeps a copy-pasted key from becoming a committed one; `<% VAR %>`
 * placeholders never match.
 * @returns {{path: string, kind: string}[]}
 */
export function scanForLiteralSecrets(env) {
    const hits = [];
    walkStrings(env, "", (str, p) => {
        for (const [kind, re] of SECRET_PATTERNS) {
            if (re.test(str)) hits.push({ path: p, kind });
        }
    });
    return hits;
}

/* --------------------------------------------------------------- reporting */

const brief = (v) => {
    if (v === "{…}") return v;
    const s = JSON.stringify(v);
    return s !== undefined && s.length > 60 ? `${s.slice(0, 57)}…` : String(s);
};

export function formatConflicts(conflicts) {
    return conflicts.map((c) => {
        if (c.kind === "dimension") {
            return `CONFLICT  dimension "${c.dimension}"\n  ${
                c.parties.map((p) => p.layer).join(", ")} — pick one, or pass --force`;
        }
        if (c.kind === "declared") {
            return `CONFLICT  declared incompatible\n  ${c.parties.map((p) => p.layer).join(" ↔ ")}`;
        }
        const width = Math.max(...c.parties.map((p) => p.layer.length));
        return `CONFLICT  ${c.path}  (${c.kind})\n${
            c.parties.map((p) => `  ${p.layer.padEnd(width)}  ${brief(p.value)}`).join("\n")}`;
    }).join("\n");
}

export function formatProvenance(provenance) {
    const paths = Object.keys(provenance);
    if (!paths.length) return "";
    const width = Math.min(60, Math.max(...paths.map((p) => p.length)));
    return paths.map((p) => `${p.padEnd(width)}  ${provenance[p]}`).join("\n");
}
