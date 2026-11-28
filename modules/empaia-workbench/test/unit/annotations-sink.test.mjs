/**
 * The annotations sink against a fake Workbench.
 *
 * The Workbench has no annotation update route, so an edit is a delete + re-post
 * and an annotation's class is a second request. Every vector here is a way that
 * pairing lost or duplicated a record:
 *
 *   - a refused class POST on an edit withdrew the replacement, after the record
 *     it replaced had already been deleted — the annotation was gone;
 *   - an undo of an edit named the record the edit had retired, so the delete was
 *     skipped and a second copy was posted next to the live one;
 *   - a delete of a record that was already gone failed forever, restoring the
 *     annotation locally with no way to remove it;
 *   - a bundle upload posted classes once, after all annotations — a later
 *     failure dropped the classes of everything already stored.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.$ = globalThis.$ ?? {};
globalThis.$.t = globalThis.$.t ?? ((key) => key);

const { makeAnnotationsSink } = await import("../../sink.ts");

const httpError = (status) => Object.assign(new Error(`HTTP failed: ${status}`), { statusCode: status });

/** A Workbench that stores annotations and classes; failures are injected per call. */
function fakeWorkbench() {
    const annotations = new Map();
    const classes = [];
    let next = 1;
    const fail = { postAnnotations: [], postClasses: [], deleteAnnotation: [] };
    const maybeFail = (op) => { const e = fail[op].shift(); if (e) throw e; };
    const client = {
        async postAnnotations(items) {
            maybeFail("postAnnotations");
            return items.map((item) => {
                const id = `E${next++}`;
                annotations.set(id, item);
                return { ...item, id };
            });
        },
        async postClasses(items) {
            maybeFail("postClasses");
            classes.push(...items);
            return items;
        },
        async deleteAnnotation(id) {
            maybeFail("deleteAnnotation");
            if (!annotations.has(id)) throw httpError(404);
            annotations.delete(id);
            // The service drops an annotation's classes with it.
            for (let i = classes.length - 1; i >= 0; i--) if (classes[i].reference_id === id) classes.splice(i, 1);
        },
    };
    const links = new Map();
    const mapping = {
        slideId: "slide-1", scopeId: "scope-1", defaultNpp: 250,
        classValueForPreset: (presetId) => presetId === "tumor" ? "org.empaia.global.v1.classes.tumor" : undefined,
    };
    const sink = makeAnnotationsSink({
        getClient: () => client,
        getMappingContext: () => mapping,
        getMappingContextFor: () => mapping,
        linkAnnotation: (localId, empaiaId) => {
            if (localId === undefined) return;
            if (empaiaId) links.set(String(localId), empaiaId); else links.delete(String(localId));
        },
        resolveEmpaiaId: (localId) => links.get(String(localId)),
        storageKind: () => "scope",
    });
    return { sink, client, annotations, classes, fail, links };
}

const rect = (over = {}) => ({ factoryID: "rect", left: 10, top: 10, width: 20, height: 20, presetID: "tumor", ...over });
const ctxOf = (localId, meta = {}) => ({
    ownerId: "annotations", resourceName: "annotation", itemId: localId, meta: { localId, ...meta },
});
const ids = (wb) => Array.from(wb.annotations.keys());
const classified = (wb) => wb.classes.map(c => c.reference_id);

test("a refused class on an edit keeps the annotation on the server @unit", async () => {
    const wb = fakeWorkbench();
    await wb.sink.create(ctxOf("1"), rect());
    expect(ids(wb)).toEqual(["E1"]);

    const previous = { ...rect(), empaiaId: "E1" };
    wb.fail.postClasses.push(httpError(400));
    const edit = ctxOf("1", { previous });
    const refused = await wb.sink.update(edit, rect({ left: 50 }));
    expect(refused.ok).toBe(false);
    // The old record is retired, and the replacement stayed.
    expect(ids(wb)).toEqual(["E2"]);

    // The retry names the same (retired) record; it replaces the live one.
    const retried = await wb.sink.update(edit, rect({ left: 50 }));
    expect(retried.ok).toBe(true);
    expect(ids(wb)).toHaveLength(1);
    expect(classified(wb)).toEqual(ids(wb));
});

test("undoing an edit leaves one record, not two @unit", async () => {
    const wb = fakeWorkbench();
    await wb.sink.create(ctxOf("1"), rect());
    const previous = { ...rect(), empaiaId: "E1" };
    const meta = { kind: "replace", previous, next: rect({ left: 50 }) };

    expect((await wb.sink.update(ctxOf("1", meta), rect({ left: 50 }))).ok).toBe(true);
    expect(ids(wb)).toEqual(["E2"]);

    // Undo reuses the forward meta: `previous` still carries the retired id.
    expect((await wb.sink.update(ctxOf("1", { ...meta, fromUndo: true }), rect())).ok).toBe(true);
    expect(ids(wb)).toEqual(["E3"]);
    // ...and so does a redo.
    expect((await wb.sink.update(ctxOf("1", meta), rect({ left: 50 }))).ok).toBe(true);
    expect(ids(wb)).toEqual(["E4"]);
    expect(classified(wb)).toEqual(["E4"]);
});

test("deleting a record that is already gone succeeds @unit", async () => {
    const wb = fakeWorkbench();
    await wb.sink.create(ctxOf("1"), rect());
    const object = { ...rect(), empaiaId: "E1" };

    // Replaced by an edit: the delete reaches the live record.
    await wb.sink.update(ctxOf("1", { previous: object }), rect({ left: 50 }));
    expect((await wb.sink.delete(ctxOf("1", { object }))).ok).toBe(true);
    expect(ids(wb)).toEqual([]);
    // Deleted twice (a lost answer, an undo/redo pair): still done.
    expect((await wb.sink.delete(ctxOf("1", { object }))).ok).toBe(true);

    // Deleted by someone else: the server's 404 is the goal met.
    expect((await wb.sink.delete(ctxOf("9", { object: { empaiaId: "never-here" } }))).ok).toBe(true);
    // Anything else is still a failure.
    await wb.sink.create(ctxOf("2"), rect());
    wb.fail.deleteAnnotation.push(httpError(500));
    expect((await wb.sink.delete(ctxOf("2"))).ok).toBe(false);
    expect(ids(wb)).toHaveLength(1);
});

test("a bundle upload that fails midway still classifies what it stored @unit", async () => {
    const wb = fakeWorkbench();
    const item = (n) => ({ type: "rectangle", upper_left: [n, n], width: 4, height: 4 });
    const bundle = () => ({
        items: [item(1), item(2), item(3)],
        // What the module sends: a link knows its server id once it has one.
        links: ["a", "b", "c"].map(incrementId => ({
            incrementId, classValue: "tumor", empaiaId: wb.links.get(incrementId),
        })),
    });

    // The second annotation is refused.
    wb.fail.postAnnotations.push(undefined, httpError(500));
    expect((await wb.sink.writeBundle(ctxOf(undefined), bundle())).ok).toBe(false);
    expect(ids(wb)).toEqual(["E1"]);
    expect(classified(wb)).toEqual(["E1"]);

    // The class of the second one is refused; the retry owes it and nothing else.
    wb.fail.postClasses.push(httpError(500));
    expect((await wb.sink.writeBundle(ctxOf(undefined), bundle())).ok).toBe(false);
    expect(ids(wb)).toEqual(["E1", "E2"]);
    expect(classified(wb)).toEqual(["E1"]);

    const done = await wb.sink.writeBundle(ctxOf(undefined), bundle());
    expect(done.ok).toBe(true);
    expect(ids(wb)).toEqual(["E1", "E2", "E3"]);
    expect(classified(wb).sort()).toEqual(["E1", "E2", "E3"]);
});

test("a bulk create stores every record, a few at a time, one result per item @unit", async () => {
    const wb = fakeWorkbench();
    let inFlight = 0, peak = 0;
    const post = wb.sink.create;
    wb.sink.create = async function (...args) {
        peak = Math.max(peak, ++inFlight);
        await new Promise(r => setTimeout(r, 1));
        try { return await post.apply(this, args); } finally { inFlight--; }
    };

    const n = 30;
    const ctxs = Array.from({ length: n }, (_, i) => ctxOf(String(i)));
    // One shape the workbench cannot represent: refused on its own.
    const items = ctxs.map((_, i) => i === 7 ? { factoryID: "no-such-shape" } : rect({ left: i }));
    const results = await wb.sink.createMany(ctxs, items);

    expect(results).toHaveLength(n);
    expect(results.filter(r => r.ok)).toHaveLength(n - 1);
    expect(results[7].code).toBe("W_EMPAIA_UNREPRESENTABLE");
    expect(ids(wb)).toHaveLength(n - 1);
    expect(classified(wb).sort()).toEqual(ids(wb).sort());
    // Each result belongs to the item at its own position.
    expect(wb.links.get("3")).toBe(results[3].payload.id);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
});

test("a bulk delete removes every record and treats an already-gone one as done @unit", async () => {
    const wb = fakeWorkbench();
    const ctxs = Array.from({ length: 5 }, (_, i) => ctxOf(String(i)));
    await wb.sink.createMany(ctxs, ctxs.map((_, i) => rect({ left: i })));
    wb.annotations.delete(wb.links.get("2")); // deleted elsewhere

    const results = await wb.sink.deleteMany(ctxs);
    expect(results.every(r => r.ok)).toBe(true);
    expect(ids(wb)).toEqual([]);
});

test("a failed annotation query throws instead of reading as a slide with no annotations @unit", async () => {
    const wb = fakeWorkbench();
    wb.client.queryAnnotations = async () => { throw httpError(503); };

    const seen = [];
    let thrown;
    try {
        for await (const item of wb.sink.query(ctxOf(undefined), {})) seen.push(item);
    } catch (e) { thrown = e; }
    expect(seen).toEqual([]);
    expect(thrown?.statusCode).toBe(503);
});

test("an aborted annotation query ends quietly @unit", async () => {
    const wb = fakeWorkbench();
    const controller = new AbortController();
    wb.client.queryAnnotations = async () => { controller.abort(); throw httpError(503); };

    const seen = [];
    for await (const item of wb.sink.query(ctxOf(undefined, { signal: controller.signal }), {})) seen.push(item);
    expect(seen).toEqual([]);
});
