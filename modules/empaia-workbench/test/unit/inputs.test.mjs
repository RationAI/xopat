/**
 * What every EMPAIA tutorial app needs, and whether this viewer can supply it.
 *
 * The fixtures in `../fixtures/ead/` are the 14 apps from the EMPAIA sample-apps
 * repository, trimmed to the blocks the reader consumes. They exist because the
 * integration was built against TA01 and TA02 and silently mishandled most of the
 * rest: TA09's slide *collection* had a bare slide id written into it and produced
 * a job that could only fail server-side, with nothing in the UI to say so.
 *
 * This suite is the matrix. A new app shape either resolves to sources this
 * viewer can fill, or it names a blocker — never neither.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { resolveModeInputs, modeBlockers, wsiInputKey, roiInputs, fromJobInputs, orderedModes } =
    await import("../../inputs.ts");

const ead = (id) => JSON.parse(readFileSync(
    fileURLToPath(new URL(`../fixtures/ead/${id}.json`, import.meta.url)), "utf8"));

/** `{key: source}` for a mode, which is the whole answer in one readable shape. */
const sources = (id, mode) =>
    Object.fromEntries(resolveModeInputs(ead(id), mode).map(i => [i.key, i.source]));

const blockerKeys = (id, mode) => modeBlockers(ead(id), mode).map(b => b.key);

// ── the apps that already worked ────────────────────────────────────────────

test("TA01 — one slide, one rectangle", () => {
    expect(sources("ta01", "standalone")).toEqual({ my_wsi: "wsi", my_rectangle: "roi" });
    expect(blockerKeys("ta01", "standalone")).toEqual([]);
    expect(wsiInputKey(ead("ta01"), "standalone")).toBe("my_wsi");
});

test("TA02 — a collection of rectangles", () => {
    expect(sources("ta02", "standalone"))
        .toEqual({ my_wsi: "wsi", my_rectangles: "roi-collection" });
    expect(blockerKeys("ta02", "standalone")).toEqual([]);
});

test("TA07 and TA08 are TA01's shape — configuration and failure are not io", () => {
    for (const id of ["ta07", "ta08"]) {
        expect(sources(id, "standalone")).toEqual({ my_wsi: "wsi", my_rectangle: "roi" });
        expect(blockerKeys(id, "standalone")).toEqual([]);
    }
});

test("TA03, TA04, TA05, TA06 all take the same inputs — only their outputs differ", () => {
    for (const id of ["ta03", "ta04", "ta05", "ta06"]) {
        expect(sources(id, "standalone"))
            .toEqual({ my_wsi: "wsi", my_rectangles: "roi-collection" });
        expect(blockerKeys(id, "standalone")).toEqual([]);
    }
});

test("TA10 — differently named keys resolve by type, not by name", () => {
    expect(sources("ta10", "standalone")).toEqual({ slide: "wsi", region_of_interest: "roi" });
    expect(blockerKeys("ta10", "standalone")).toEqual([]);
    expect(roiInputs(ead("ta10"), "standalone").map(i => i.type)).toEqual(["rectangle"]);
});

// ── the apps that were silently broken ──────────────────────────────────────

test("TA09 — a slide collection is refused, and refused by name", () => {
    const inputs = resolveModeInputs(ead("ta09"), "standalone");
    expect(sources("ta09", "standalone")).toEqual({
        my_wsis: "unsupported",        // collection of wsi — a multi-slide job
        my_rectangles: "unsupported",  // collection of collection of rectangle
        my_thresholds: "unsupported",  // float input nothing here can supply
    });

    // The depth is the whole point: it used to be computed and thrown away, so
    // `my_wsis` looked like an ordinary slide key.
    expect(inputs.find(i => i.key === "my_wsis")).toMatchObject({ type: "wsi", depth: 1 });
    expect(inputs.find(i => i.key === "my_rectangles")).toMatchObject({ type: "rectangle", depth: 2 });

    expect(wsiInputKey(ead("ta09"), "standalone")).toBe(undefined);

    const keys = blockerKeys("ta09", "standalone");
    expect(keys).toContain("ead.blocked.wsiCollection");
    expect(keys).toContain("ead.blocked.nestedRoiCollection");
    expect(keys).toContain("ead.blocked.inputType");
    // The app DOES name a slide, it just names too many. Adding "declares no
    // slide input" on top would be describing our own refusal back at the user.
    expect(keys).not.toContain("ead.blocked.noWsi");
});

test("TA14 — an io type outside this viewer's vocabulary is named, not ignored", () => {
    expect(sources("ta14", "preprocessing"))
        .toEqual({ my_wsi: "wsi", my_questionnaire: "unsupported" });
    const questionnaire = resolveModeInputs(ead("ta14"), "preprocessing")
        .find(i => i.key === "my_questionnaire");
    expect(questionnaire.reasonArgs).toMatchObject({ type: "fhir_questionnaire" });
    expect(blockerKeys("ta14", "preprocessing")).toContain("ead.blocked.inputType");
});

// ── preprocessing / postprocessing ──────────────────────────────────────────

test("TA13 — preprocessing is platform-run, which is a reason, not a fault", () => {
    expect(sources("ta13", "preprocessing")).toEqual({ input_wsi: "wsi" });
    // Its only blocker: nobody presses start. The results are still worth showing.
    expect(blockerKeys("ta13", "preprocessing")).toEqual(["ead.blocked.platformRun"]);
});

test("TA12 — postprocessing consumes the preprocessing job's outputs", () => {
    expect(sources("ta12", "postprocessing")).toEqual({
        my_wsi: "wsi",
        my_rectangle: "roi",
        my_cells: "from-job",       // declared as an output of `preprocessing`
    });
    expect(fromJobInputs(ead("ta12"), "postprocessing").map(i => i.key)).toEqual(["my_cells"]);
    // containerized: true — the platform runs it, so this viewer can start it.
    expect(blockerKeys("ta12", "postprocessing")).toEqual([]);
});

test("TA11 — non-containerized postprocessing is refused with its own reason", () => {
    expect(sources("ta11", "postprocessing")).toEqual({
        my_wsi: "wsi",
        my_rectangle: "roi",
        my_cells: "from-job",
        my_cell_classes: "from-job",
    });
    // The app computes this step in its own interface and posts the result back;
    // this module writes no primitives or collections.
    expect(blockerKeys("ta11", "postprocessing")).toEqual(["ead.blocked.nonContainerized"]);

    // Its standalone mode is ordinary and must stay runnable.
    expect(sources("ta11", "standalone")).toEqual({ my_wsi: "wsi", my_rectangle: "roi" });
    expect(blockerKeys("ta11", "standalone")).toEqual([]);
});

test("mode order is ours, not the vendor's JSON key order", () => {
    // TA11 declares preprocessing first; booting into it is how a user ended up
    // drawing regions in a mode that can never consume them.
    expect(Object.keys(ead("ta11").modes)[0]).toBe("preprocessing");
    expect(orderedModes(ead("ta11"))).toEqual(["standalone", "postprocessing", "preprocessing"]);
    expect(orderedModes(ead("ta12"))).toEqual(["postprocessing", "preprocessing"]);
    expect(orderedModes(ead("ta01"))).toEqual(["standalone"]);
});

// ── shapes no tutorial app has, but the model must still answer ─────────────

test("mixing a single region with a region collection is refused", () => {
    const mixed = {
        io: {
            w: { type: "wsi" },
            one: { type: "rectangle", reference: "io.w" },
            many: { type: "collection", items: { type: "polygon", reference: "io.w" } },
        },
        modes: { standalone: { inputs: ["w", "one", "many"], outputs: [] } },
    };
    expect(modeBlockers(mixed, "standalone").map(b => b.key))
        .toContain("ead.blocked.singleAndMulti");
});

test("two region inputs of the same type at the same depth are refused", () => {
    const twice = {
        io: {
            w: { type: "wsi" },
            a: { type: "rectangle", reference: "io.w" },
            b: { type: "rectangle", reference: "io.w" },
        },
        modes: { standalone: { inputs: ["w", "a", "b"], outputs: [] } },
    };
    expect(modeBlockers(twice, "standalone").map(b => b.key))
        .toContain("ead.blocked.sameInputTypes");
});

test("an annotation type the drawing tool cannot author is named as such", () => {
    const points = {
        io: { w: { type: "wsi" }, p: { type: "point", reference: "io.w" } },
        modes: { standalone: { inputs: ["w", "p"], outputs: [] } },
    };
    const blockers = modeBlockers(points, "standalone");
    expect(blockers.map(b => b.key)).toContain("ead.blocked.roiShape");
    expect(blockers.find(b => b.key === "ead.blocked.roiShape").args).toMatchObject({ type: "point" });
});

test("an app declaring no slide at all says so", () => {
    const noSlide = {
        io: { n: { type: "integer" } },
        modes: { standalone: { inputs: ["n"], outputs: [] } },
    };
    expect(modeBlockers(noSlide, "standalone").map(b => b.key)).toContain("ead.blocked.noWsi");
});

test("a missing or misshapen document answers rather than throwing", () => {
    expect(resolveModeInputs(undefined, "standalone")).toEqual([]);
    expect(modeBlockers(undefined, "standalone").map(b => b.key)).toEqual(["ead.blocked.noApp"]);
    expect(orderedModes(undefined)).toEqual([]);

    const broken = { io: { w: null }, modes: { standalone: { inputs: ["w"], outputs: [] } } };
    expect(resolveModeInputs(broken, "standalone")[0].source).toBe("unsupported");
    expect(modeBlockers(broken, "standalone").map(b => b.key))
        .toContain("ead.blocked.unreadableInput");
});

test("every tutorial app either resolves every input or names a blocker", () => {
    // The invariant the whole model exists for: no app may reach a run path with
    // an input this viewer cannot fill and no explanation for it.
    const ids = ["ta01", "ta02", "ta03", "ta04", "ta05", "ta06", "ta07",
        "ta08", "ta09", "ta10", "ta11", "ta12", "ta13", "ta14"];
    for (const id of ids) {
        const doc = ead(id);
        for (const mode of orderedModes(doc)) {
            const inputs = resolveModeInputs(doc, mode);
            const unsupported = inputs.filter(i => i.source === "unsupported");
            const blockers = modeBlockers(doc, mode);
            if (unsupported.length) {
                expect(blockers.length,
                    `${id}/${mode} has unsupported inputs but no blocker`).toBeGreaterThan(0);
            }
            for (const input of unsupported) {
                expect(input.reasonKey, `${id}/${mode}:${input.key} refused with no reason`)
                    .toBeTruthy();
            }
        }
    }
});
