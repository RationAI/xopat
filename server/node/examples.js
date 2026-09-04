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
 * Each record carries the session inline (`session`) or by repo-relative path
 * (`sessionFile`, which lets the existing `test/fixtures/sessions/*.json` fixtures be
 * referenced rather than duplicated).
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

    const entries = [];
    for (const id of Object.keys(examples)) {
        const record = examples[id];
        const entry = {
            id,
            name: id,
            description: null,
            url: null,
            source: null,
            warning: null,
            order: DEFAULT_ORDER,
        };
        entries.push(entry);

        if (!record || typeof record !== "object" || Array.isArray(record)) {
            entry.warning = "not an example object";
            continue;
        }
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
