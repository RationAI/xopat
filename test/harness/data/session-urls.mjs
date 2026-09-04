#!/usr/bin/env node
/**
 * Print ready-to-open viewer URLs for the session fixtures.
 *
 *     npm run fixtures:urls
 *     npm run fixtures:urls -- --group viz-flex
 *     npm run fixtures:urls -- --deployment webtiff --port 9000
 *
 * The session travels in the URL **hash**. `src/parse-input.js` parses `#<json>`
 * locally, so the address bar keeps it and refresh/share stay stable — unlike
 * `?visualization=`, which self-POSTs and then drops out of the URL.
 *
 * Each URL is printed with what the session needs first, read from
 * `test/fixtures/sessions/index.json`. A link that cannot work yet is still
 * printed — annotated, not hidden — because "why is this one missing" costs more
 * than a line of output.
 *
 * The alternative, for editing a session by hand, is the server's own
 * `/dev_setup` page: paste the JSON into its `visualization` field and submit.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SESSIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "sessions");
const INDEX = path.join(SESSIONS, "index.json");

const REQUIREMENT_HELP = {
    fixtures: "npm run fixtures:fetch",
    derived: "npm run fixtures:derive",
};

let port = process.env.XOPAT_NODE_PORT || "9000";
let host = "localhost";
let group = null;
let deployment = null;
let filter = null;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = argv[++i];
    else if (argv[i] === "--host") host = argv[++i];
    else if (argv[i] === "--group") group = argv[++i];
    else if (argv[i] === "--deployment") deployment = argv[++i];
    else if (argv[i] === "--filter") filter = argv[++i];
    else throw new Error(`unknown argument "${argv[i]}"`);
}

const index = JSON.parse(fs.readFileSync(INDEX, "utf8")).sessions;
const ids = Object.keys(index)
    .filter(id => !group || index[id].group === group)
    .filter(id => !deployment || index[id].deployment === deployment)
    .filter(id => !filter || id.includes(filter))
    .sort();

if (!ids.length) {
    console.error(`no matching sessions in ${INDEX}`);
    process.exit(1);
}

const base = `http://${host}:${port}`;
console.log(`viewer: ${base}    (fixture data served separately by \`npm run fixtures:serve\`)\n`);

for (const id of ids) {
    const meta = index[id];
    const file = path.join(SESSIONS, `${id}.json`);
    if (!fs.existsSync(file)) {
        console.log(`# ${id}\n! indexed but absent: ${file}\n`);
        continue;
    }
    const session = JSON.parse(fs.readFileSync(file, "utf8"));
    const needs = (meta.requires || []).map(r => REQUIREMENT_HELP[r] || `env ${r}`);
    console.log(`# ${id} — ${meta.title}`);
    console.log(`  deployment: npm run up:dev -- ${meta.deployment}`);
    if (needs.length) console.log(`  needs:      ${needs.join(", ")}`);
    console.log(`${base}/#${encodeURIComponent(JSON.stringify(session))}\n`);
}
