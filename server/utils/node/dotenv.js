/**
 * Minimal `.env` reader for the local dev runner.
 *
 * ## Why not the `dotenv` package
 *
 * This needs to parse `KEY=value` and nothing else. Adding a dependency for
 * that would put a third-party module on the path of every developer's server
 * launch, for ~40 lines of behaviour.
 *
 * ## Why there is no `${VAR}` expansion
 *
 * xOpat already has an expansion mechanism: the ENV file's `<% VAR %>`
 * placeholders, resolved by the server against `process.env`
 * (`server/templates/javascript/core.js`, mirrored in PHP). A second
 * interpolation syntax operating on the same values would fight it — a value
 * meant for the server's substituter would be rewritten before it ever got
 * there. So `.env` carries literal values only.
 *
 * The server itself never reads this file. Secrets enter through the process
 * environment, which is what containers and systemd already supply; teaching
 * `getCore` to read a file would add per-request I/O, diverge from the PHP
 * backend, and make production behaviour depend on an untracked file.
 */
const fs = require("node:fs");

/**
 * Parse `.env` text. Supports `KEY=value`, a leading `export`, `#` comments,
 * and single/double-quoted values (with `\n` escapes inside double quotes).
 * @returns {Record<string, string>}
 */
function parseDotEnv(text) {
    const out = {};
    for (const rawLine of String(text ?? "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        let key = line.slice(0, eq).trim();
        if (key.startsWith("export ")) key = key.slice(7).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
            (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
            const quote = value[0];
            value = value.slice(1, -1);
            if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
        } else {
            // Unquoted: an inline comment ends the value, as in every other
            // .env implementation. Quoted values keep their `#`.
            const hash = value.indexOf(" #");
            if (hash >= 0) value = value.slice(0, hash).trim();
        }
        out[key] = value;
    }
    return out;
}

/**
 * Values that parsed, but cannot have been meant.
 *
 * One shape, because one shape actually happens: appending `KEY=value` to a file
 * whose last line has no trailing newline concatenates the two, producing
 * `WSI_PORT=9002"WSI_PORT=9002"`. That parses fine — the key is valid and the
 * value is a non-empty string — and then travels through `<% WSI_PORT %>` into
 * whatever consumed it. In the case that prompted this, it surfaced as
 * `TypeError: Failed to construct 'URL': Invalid URL` from inside a plugin,
 * three debugging rounds away from the file that caused it.
 *
 * Deliberately narrow, and **data-driven rather than shape-guessing**: the
 * embedded assignment counts only when its name is a key *this same file
 * declares*, which is what an append collision always produces. A generic
 * `\w+=` pattern is not usable here — it fires on base64 padding
 * (`…d29ybGQ=`) and on any URL carrying an uppercase query parameter, and a
 * lint with false positives gets switched off.
 *
 * @param {Record<string, string>} parsed output of {@link parseDotEnv}
 * @returns {Array<{key: string, value: string, reason: string}>}
 */
function findSuspectValues(parsed) {
    const entries = Object.entries(parsed ?? {});
    const known = entries.map(([key]) => key).filter(k => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
    const out = [];
    for (const [key, value] of entries) {
        if (typeof value !== "string" || !value) continue;

        // Anywhere in the value, with no word-boundary requirement: an append
        // concatenates directly onto the previous line, so the collision usually
        // has an identifier character in front of it
        // (`MEDGEMMA_MODEL=medgemma-4b-itWSI_PORT=9002`). Requiring a boundary
        // would miss the common case and keep only the one that happens to be
        // preceded by a quote. Precision comes from `name` being a key this file
        // declares, not from the surrounding characters.
        const collided = known.find(name => value.includes(`${name}=`));
        if (collided) {
            out.push({
                key, value,
                reason: `contains a second assignment to ${collided} — usually a line appended `
                    + "to a file with no trailing newline",
            });
            continue;
        }
        // Surviving quotes mean the value was not quoted as a whole (the parser
        // strips those), so they are inside it — the other half of the same
        // append artifact.
        if (value.includes('"') || value.includes("'")) {
            out.push({ key, value, reason: "contains a quote character inside the value" });
        }
    }
    return out;
}

/** Read and parse a `.env` file. Missing file → `{}`. */
function readDotEnv(file) {
    try {
        if (!file || !fs.existsSync(file)) return {};
        return parseDotEnv(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

/**
 * Fill `target` with keys it does not already define, from `sources` in order.
 *
 * Absent-only on purpose: a variable exported in the shell must win over a
 * checked-in preset default or a stale `.env`, so that
 * `WSI_PORT=9999 npm run up -- default` does what it says.
 *
 * @returns {Record<string, string>} `target` (mutated)
 */
function layerEnv(target, ...sources) {
    for (const source of sources) {
        for (const [key, value] of Object.entries(source ?? {})) {
            if (target[key] === undefined) target[key] = String(value);
        }
    }
    return target;
}

module.exports = { parseDotEnv, readDotEnv, layerEnv, findSuspectValues };
