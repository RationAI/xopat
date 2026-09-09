/**
 * Example sessions published by a deployment.
 *
 * A composed deployment knows exactly which data source it was built with, but
 * used to publish nothing runnable: the knowledge of "what can I actually open
 * here" lived in `env/parts/*` comments, plugin READMEs and `test/fixtures/sessions/`.
 * An ENV fragment that configures a data source can now ship the sessions that
 * exercise it, and the server prints them as ready-to-open URLs at startup.
 *
 * The catalogue lives at `core.server.secure.examples` — a **keyed object**, for
 * two reasons:
 *
 *  - `server.secure` is the one block stripped before the browser-bound page
 *    payload (`server/templates/javascript/core.js`), so an example naming a
 *    private study UID never becomes an anonymous discovery endpoint. There is
 *    deliberately no client consumer and no `/scheme` exposure.
 *  - the ENV composer replaces arrays wholesale and treats a cross-layer array
 *    replacement as a *fatal* conflict, so two fragments each contributing
 *    `examples: [...]` could not compose at all. An object deep-merges, while
 *    two layers claiming the same id with different content still fail loudly.
 *
 * Each record carries the session inline (`session`), by repo-relative path
 * (`sessionFile`, which lets the existing `test/fixtures/sessions/*.json` fixtures be
 * referenced rather than duplicated), or by *index* (`sessionIndex` + an optional
 * `deployment`/`group` filter), which expands to one entry per matching session.
 *
 * The index form exists because there were two catalogues of "what can I open
 * here" and they disagreed: this block fed the startup banner, while
 * `test/fixtures/sessions/index.json` — which already records `title`,
 * `deployment`, `group`, `requires` and `demonstrates` per session — fed
 * `npm run fixtures:urls`, the docs generator and `test/MANUAL_TESTING.md`. A
 * fragment that hand-copied records restated the titles and dropped the
 * descriptions; a fragment that copied nothing published nothing, so the
 * `webtiff` deployment's banner was empty while the index knew twelve sessions.
 * One record naming the index fixes both directions at once.
 *
 * The session travels in the URL **hash**: `src/parse-input.js` parses `#<json>`
 * locally, so the address bar keeps it and refresh/share stay stable — unlike
 * `?visualization=`, which self-POSTs and then drops out of the URL.
 */
const fs = require("fs");
const path = require("path");

/** Records without an explicit `order` sort after those that have one. */
const DEFAULT_ORDER = 1000;

/**
 * Practical ceiling for a hash URL. Browsers differ and none of them tell you
 * they truncated, so an over-long session gets the `/dev_setup` route instead of
 * a link that silently opens the wrong thing.
 */
const DEFAULT_MAX_URL_LENGTH = 6000;

/**
 * Resolve a repo-relative session file, refusing anything outside the repo root.
 * Same containment rule as the static-file allowlist: a path that exists but sits
 * outside the root is not readable, regardless of how it was spelled.
 */
function resolveSessionFile(absPath, relative) {
    const root = path.resolve(absPath);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    return target;
}

function readSessionFile(absPath, relative) {
    const target = resolveSessionFile(absPath, relative);
    if (!target) throw new Error(`sessionFile "${relative}" resolves outside the repository root`);
    if (!fs.existsSync(target)) throw new Error(`sessionFile "${relative}" does not exist`);
    const parsed = JSON.parse(fs.readFileSync(target, { encoding: "utf8", flag: "r" }));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`sessionFile "${relative}" is not a session object`);
    }
    return parsed;
}

/**
 * Prerequisite hints, keyed by the index's `requires` vocabulary. Same wording as
 * `test/harness/data/session-urls.mjs` prints, deliberately — a reader who sees
 * one of them in the banner and the other in the CLI must not wonder whether
 * they mean different things.
 */
const REQUIREMENT_HINTS = {
    fixtures: "npm run fixtures:fetch",
    derived: "npm run fixtures:derive",
};

function requirementNote(requires) {
    if (!Array.isArray(requires) || !requires.length) return null;
    const parts = requires.map(r => REQUIREMENT_HINTS[r] || `env ${r}`);
    return `needs: ${parts.join(", ")}`;
}

/**
 * Expand a `sessionIndex` record into one pseudo-record per matching session.
 *
 * The index is the tracked catalogue (`test/fixtures/sessions/index.json`); this
 * only re-shapes its rows into the record form the normal path already handles,
 * so the session itself is still read through `readSessionFile` and still
 * containment-checked. Filters are `deployment` and `group`, matched exactly
 * against the index's own fields — the *values in the index*, not the name of
 * the preset doing the publishing, because two decoders (`webtiff`, `geotiff`)
 * legitimately publish the same set.
 *
 * Ordering: the declaring record's `order` applies to the whole expansion, with
 * index position breaking ties, so a block stays stable as sessions are added.
 *
 * Throws only on an unusable index; a single unusable row degrades to a record
 * carrying its own `warning`, exactly like a hand-written one.
 */
function expandSessionIndex(absPath, id, record) {
    const relative = String(record.sessionIndex).trim();
    const target = resolveSessionFile(absPath, relative);
    if (!target) throw new Error(`sessionIndex "${relative}" resolves outside the repository root`);
    if (!fs.existsSync(target)) throw new Error(`sessionIndex "${relative}" does not exist`);

    const parsed = JSON.parse(fs.readFileSync(target, { encoding: "utf8", flag: "r" }));
    const sessions = parsed && typeof parsed === "object" ? parsed.sessions : null;
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) {
        throw new Error(`sessionIndex "${relative}" has no \`sessions\` object`);
    }

    const dir = path.posix.dirname(relative.replace(/\\/g, "/"));
    const wantDeployment = typeof record.deployment === "string" ? record.deployment.trim() : null;
    const wantGroup = typeof record.group === "string" ? record.group.trim() : null;
    const baseOrder = Number.isFinite(Number(record.order)) ? Number(record.order) : DEFAULT_ORDER;

    const out = [];
    let position = 0;
    for (const key of Object.keys(sessions)) {
        const row = sessions[key];
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        if (wantDeployment && row.deployment !== wantDeployment) continue;
        if (wantGroup && row.group !== wantGroup) continue;
        out.push({
            id: key,
            record: {
                name: typeof row.title === "string" && row.title.trim() ? row.title.trim() : key,
                description: typeof row.demonstrates === "string" ? row.demonstrates : undefined,
                sessionFile: `${dir}/${key}.json`,
                note: requirementNote(row.requires),
                order: baseOrder + (position++) / 1000,
            },
        });
    }
    if (!out.length) {
        const filter = wantDeployment ? `deployment "${wantDeployment}"`
            : wantGroup ? `group "${wantGroup}"` : "no filter";
        throw new Error(`sessionIndex "${relative}" matched no session for ${filter}`);
    }
    return out;
}

/**
 * Normalize the declared catalogue into printable entries.
 *
 * Never throws: a malformed record yields an entry carrying `warning` instead of
 * `url`, because a bad example must not be able to affect server startup.
 *
 * @param {string} absPath repository root (`constants.ABSPATH`)
 * @param {object} examples the `core.server.secure.examples` block
 * @param {string} baseUrl viewer origin, no trailing slash (e.g. `http://localhost:9000`)
 * @param {{maxUrlLength?: number}} [options]
 * @returns {Array<{id: string, name: string, description: string|null,
 *                  url: string|null, source: string|null, warning: string|null}>}
 */
function buildExampleEntries(absPath, examples, baseUrl, options = {}) {
    if (!examples || typeof examples !== "object" || Array.isArray(examples)) return [];
    const maxUrlLength = Number.isFinite(Number(options.maxUrlLength))
        ? Number(options.maxUrlLength) : DEFAULT_MAX_URL_LENGTH;
    const root = String(baseUrl || "").replace(/\/+$/, "");

    // Expand index-backed records first, so everything below sees one uniform
    // record shape. An unusable index yields a single warning entry rather than
    // silently publishing nothing — an empty banner is what this feature exists
    // to prevent.
    const flattened = [];
    for (const id of Object.keys(examples)) {
        const record = examples[id];
        const usesIndex = record && typeof record === "object" && !Array.isArray(record)
            && typeof record.sessionIndex === "string" && record.sessionIndex.trim();
        if (!usesIndex) {
            flattened.push({ id, record });
            continue;
        }
        try {
            flattened.push(...expandSessionIndex(absPath, id, record));
        } catch (e) {
            flattened.push({ id, record: { __error: e?.message || String(e) } });
        }
    }

    const entries = [];
    for (const { id, record } of flattened) {
        const entry = {
            id,
            name: id,
            description: null,
            url: null,
            source: null,
            note: null,
            warning: null,
            order: DEFAULT_ORDER,
        };
        entries.push(entry);

        if (!record || typeof record !== "object" || Array.isArray(record)) {
            entry.warning = "not an example object";
            continue;
        }
        if (record.__error) {
            entry.warning = record.__error;
            continue;
        }
        if (typeof record.note === "string" && record.note.trim()) entry.note = record.note.trim();
        if (typeof record.name === "string" && record.name.trim()) entry.name = record.name.trim();
        if (typeof record.description === "string" && record.description.trim()) {
            entry.description = record.description.trim();
        }
        if (Number.isFinite(Number(record.order))) entry.order = Number(record.order);
        if (typeof record.sessionFile === "string") entry.source = record.sessionFile;

        const hasInline = record.session !== undefined;
        const hasFile = typeof record.sessionFile === "string" && record.sessionFile.trim();
        if (hasInline && hasFile) {
            entry.warning = "declares both `session` and `sessionFile` — pick one";
            continue;
        }
        if (!hasInline && !hasFile) {
            entry.warning = "declares neither `session` nor `sessionFile`";
            continue;
        }

        let session;
        try {
            session = hasInline ? record.session : readSessionFile(absPath, record.sessionFile.trim());
        } catch (e) {
            entry.warning = e?.message || String(e);
            continue;
        }
        if (!session || typeof session !== "object" || Array.isArray(session)) {
            entry.warning = "`session` is not a session object";
            continue;
        }

        let encoded;
        try {
            encoded = encodeURIComponent(JSON.stringify(session));
        } catch (e) {
            entry.warning = `session is not serializable: ${e?.message || e}`;
            continue;
        }
        const url = `${root}/#${encoded}`;
        if (url.length > maxUrlLength) {
            // Too long to link. The session is still perfectly openable — say how.
            entry.warning = `session is ${url.length} characters as a URL (limit ${maxUrlLength}); `
                + `paste it into /dev_setup instead`;
            continue;
        }
        entry.url = url;
    }

    entries.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    return entries.map(({ order, ...rest }) => rest);
}

module.exports = { buildExampleEntries, DEFAULT_MAX_URL_LENGTH };
