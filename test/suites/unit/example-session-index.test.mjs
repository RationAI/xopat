/**
 * Example sessions published from the session index.
 *
 * There were two catalogues of "what can I open here" and they disagreed:
 * `core.server.secure.examples` fed the startup banner, while
 * `test/fixtures/sessions/index.json` — which already records title, deployment,
 * group, prerequisites and what each session demonstrates — fed
 * `npm run fixtures:urls`, the docs generator and `test/MANUAL_TESTING.md`. The
 * `webtiff` deployment copied nothing, so its banner was empty while the index
 * knew twelve sessions; the viz-flex fragment copied six records by hand,
 * restating the titles and dropping the descriptions.
 *
 * `sessionIndex` makes the index the one source. These pin the expansion and,
 * more importantly, that the fragments actually use it — a mechanism nothing
 * declares is the state this replaced.
 */
import { test, expect } from "@xopat/test-harness";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(import.meta.url);
const { buildExampleEntries } = require_(path.join(REPO, "server/node/examples.js"));

const INDEX_REL = "test/fixtures/sessions/index.json";
const index = JSON.parse(fs.readFileSync(path.join(REPO, INDEX_REL), "utf8"));

const build = (examples) => buildExampleEntries(REPO, examples, "http://localhost:9000");

test("one record expands to every session the index labels for that deployment", { tag: ["@unit"] }, () => {
    const expected = Object.entries(index.sessions)
        .filter(([, row]) => row.deployment === "webtiff")
        .map(([id]) => id);
    expect(expected.length, "the index still labels webtiff sessions").toBeGreaterThan(0);

    const entries = build({
        webtiff: { sessionIndex: INDEX_REL, deployment: "webtiff", order: 10 },
    });

    expect(entries.map(e => e.id)).toEqual(expected);
    for (const entry of entries) {
        const row = index.sessions[entry.id];
        // The index's own wording, carried through rather than restated — that
        // the descriptions were being dropped is half of why this exists.
        expect(entry.name, `${entry.id} name`).toBe(row.title);
        if (row.demonstrates) expect(entry.description, `${entry.id} description`).toBe(row.demonstrates);
        expect(entry.url, `${entry.id} is openable`).toContain("http://localhost:9000/#");
        expect(entry.warning).toBeNull();
    }
});

test("prerequisites are stated, in the same words the CLI uses", { tag: ["@unit"] }, () => {
    const [entry] = build({
        vf: { sessionIndex: INDEX_REL, group: "viz-flex" },
    });
    // A link that opens a viewer which then cannot fetch its slides is worse
    // than no link: the failure looks like a viewer bug.
    expect(entry.note).toMatch(/npm run fixtures:(fetch|derive)/);
});

test("the group filter selects independently of the deployment filter", { tag: ["@unit"] }, () => {
    const expected = Object.entries(index.sessions)
        .filter(([, row]) => row.group === "viz-flex")
        .map(([id]) => id);
    const entries = build({ vf: { sessionIndex: INDEX_REL, group: "viz-flex" } });
    expect(entries.map(e => e.id)).toEqual(expected);
});

test("declared order survives expansion, and ties break by index position", { tag: ["@unit"] }, () => {
    const entries = build({
        late: { sessionIndex: INDEX_REL, group: "viz-flex", order: 90 },
        early: { sessionIndex: INDEX_REL, deployment: "googledicom", order: 10 },
    });
    const firstViz = entries.findIndex(e => index.sessions[e.id]?.group === "viz-flex");
    const firstDicom = entries.findIndex(e => index.sessions[e.id]?.deployment === "googledicom");
    expect(firstDicom, "the lower-ordered record's sessions come first").toBeLessThan(firstViz);
});

test("an unusable index warns instead of publishing silence", { tag: ["@unit"] }, () => {
    // An empty banner is exactly the failure this feature exists to prevent, so
    // it must not be the failure mode of the feature itself.
    for (const [id, record] of Object.entries({
        missing: { sessionIndex: "test/fixtures/sessions/does-not-exist.json" },
        outside: { sessionIndex: "../../../etc/passwd" },
        nomatch: { sessionIndex: INDEX_REL, deployment: "no-such-deployment" },
    })) {
        const [entry] = build({ [id]: record });
        expect(entry.url, `${id} publishes nothing`).toBeNull();
        expect(entry.warning, `${id} says why`).toBeTruthy();
    }
});

test("hand-written records still work beside index-backed ones", { tag: ["@unit"] }, () => {
    const entries = build({
        inline: { name: "Inline", session: { params: { sessionName: "x" } }, order: 1 },
        indexed: { sessionIndex: INDEX_REL, group: "viz-flex", order: 2 },
    });
    expect(entries[0].id).toBe("inline");
    expect(entries[0].url).toContain("#");
    expect(entries.length, "and the expansion follows").toBeGreaterThan(1);
});

test("the TIFF and viz-flex fragments publish from the index", { tag: ["@unit"] }, () => {
    // The mechanism is only worth anything if the fragments use it; a fragment
    // that copies records by hand is the state this replaced.
    for (const [rel, filter] of [
        ["env/parts/data/tiff-webtiff.json", "webtiff"],
        ["env/parts/data/tiff-geotiff.json", "webtiff"],
        ["env/parts/demo/visualization-flexibility.json", "viz-flex"],
    ]) {
        const text = fs.readFileSync(path.join(REPO, rel), "utf8");
        expect(text, `${rel} names the index`).toContain(INDEX_REL);
        expect(text, `${rel} filters on ${filter}`).toContain(`"${filter}"`);
    }
});
