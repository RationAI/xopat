/**
 * A session hands this plugin a `dataID`, and an external system rarely knows
 * more than a StudyInstanceUID — that is the whole identifier a LIS stores when
 * it pushes a study to PACS. Everything else the tile source needs (which series,
 * and whether it is a slide or a stack of slices) is a property of the data, so
 * it is completed here rather than in every integrator's backend.
 *
 * What is pinned below is the completion contract itself: what gets filled, what
 * is left alone because the author said it, and how the study listing is spent.
 * These run against the real methods — the class is captured through a stubbed
 * `addPlugin`, and the two collaborators (`seriesConfigForStudy`,
 * `makeDataReference`) are the plugin's own.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};
globalThis.XOpatPlugin = globalThis.XOpatPlugin || class {};
globalThis.VIEWER_MANAGER = globalThis.VIEWER_MANAGER || { addHandler() {} };
globalThis.APPLICATION_CONTEXT = globalThis.APPLICATION_CONTEXT || { config: {} };
globalThis.window = globalThis.window || globalThis;
globalThis.window.SLIDE_PROTOCOLS = globalThis.window.SLIDE_PROTOCOLS || { register() {} };

let Captured = null;
globalThis.addPlugin = (id, cls) => { if (id === "dicom") Captured = cls; };

await import("../../index.workspace.mjs");
const DicomTools = (await import("../../dicom-query.mjs")).default;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const STUDY = "1.2.840.999";

const series = (seriesUID, modality, seriesNumber, description = "") =>
    ({ studyUID: STUDY, seriesUID, modality, seriesNumber, description, bodyPart: "" });

/**
 * A stand-in for the plugin instance carrying only what the completion path
 * touches. `_pickPrimarySeries`, `makeDataReference` and `friendlySeriesName`
 * are the real implementations, called against it.
 */
function fakePlugin(listing, { fail = false } = {}) {
    const proto = Captured.prototype;
    const calls = { listings: 0 };
    return {
        calls,
        _pickPrimarySeries: proto._pickPrimarySeries,
        _needsCompletion: proto._needsCompletion,
        _completeDataIdInPlace: proto._completeDataIdInPlace,
        _completeSessionDataIds: proto._completeSessionDataIds,
        _dicomIdentityOf: proto._dicomIdentityOf,
        friendlySeriesName: () => "friendly",
        t: (k) => k,
        // The real, memoizing `seriesConfigForStudy` over a counted fetch, so
        // "one listing per study" is asserted against the shipped cache rather
        // than against a stub that cannot have the bug.
        state: { seriesByStudy: new Map() },
        seriesConfigForStudy: proto.seriesConfigForStudy,
        async _fetchSeriesConfigForStudy(studyUID) {
            calls.listings++;
            if (fail) throw new Error("store down");
            this.state.seriesByStudy.set(studyUID, listing);
            return listing;
        },
    };
}

/** Completion as the open path uses it: only when the dataID is short. */
async function complete(plugin, id) {
    if (!plugin._needsCompletion.call(plugin, id)) return id;
    const chosen = await plugin._completeDataIdInPlace.call(plugin, id);
    return chosen ? id : null;
}

const refresh = (plugin, event) => plugin._completeSessionDataIds.call(plugin, event);

/* ------------------------------------------------------------------ */
/* Primary-series pick                                                 */
/* ------------------------------------------------------------------ */

test("a slide wins over radiology in a mixed study", { tag: ["@unit"] }, () => {
    const pick = Captured.prototype._pickPrimarySeries.call(null, [
        series("s-ct", "CT", 1),
        series("s-sm", "SM", 4),
        series("s-mr", "MR", 2),
    ]);
    // Series number 1 is the CT: modality class is decided first, precisely so a
    // localizer numbered ahead of the slide cannot take the viewer.
    expect(pick.seriesUID).toBe("s-sm");
});

test("within one class the lowest SeriesNumber wins", { tag: ["@unit"] }, () => {
    const pick = Captured.prototype._pickPrimarySeries.call(null, [
        series("s-c", "CT", 3),
        series("s-a", "CT", 1),
        series("s-b", "CT", 2),
    ]);
    expect(pick.seriesUID).toBe("s-a");
});

test("series with no SeriesNumber sort last, not first", { tag: ["@unit"] }, () => {
    const pick = Captured.prototype._pickPrimarySeries.call(null, [
        series("s-none", "MR", undefined),
        series("s-2", "MR", 2),
    ]);
    expect(pick.seriesUID).toBe("s-2");
});

test("a listing with no numbers at all keeps the server's order", { tag: ["@unit"] }, () => {
    const pick = Captured.prototype._pickPrimarySeries.call(null, [
        series("s-first", "MR", undefined),
        series("s-second", "MR", undefined),
    ]);
    expect(pick.seriesUID).toBe("s-first");
});

test("a modality this viewer cannot read never outranks a real one", { tag: ["@unit"] }, () => {
    // seriesConfigForStudy drops SR/KO/PR/SEG/RTSTRUCT but not OT/DOC. Picking
    // one of those would open a background that renders nothing at all.
    const pick = Captured.prototype._pickPrimarySeries.call(null, [
        series("s-ot", "OT", 1),
        series("s-ct", "CT", 5),
    ]);
    expect(pick.seriesUID).toBe("s-ct");
});

test("an unreadable modality is still better than opening nothing", { tag: ["@unit"] }, () => {
    const pick = Captured.prototype._pickPrimarySeries.call(null, [series("s-ot", "OT", 1)]);
    expect(pick.seriesUID).toBe("s-ot");
});

test("an empty listing picks nothing rather than guessing", { tag: ["@unit"] }, () => {
    expect(Captured.prototype._pickPrimarySeries.call(null, [])).toBe(null);
    expect(Captured.prototype._pickPrimarySeries.call(null, null)).toBe(null);
});

/* ------------------------------------------------------------------ */
/* Completion                                                          */
/* ------------------------------------------------------------------ */

test('expand:"case" with only a study resolves a series in place', { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1, "chest"), series("s-mr", "MR", 2)]);
    const id = { studyUID: STUDY, expand: "case" };

    // In place, and the SAME object: BackgroundConfig holds the data spec by
    // identity (`_rawValue`) and derives `dataReference` from indexOf on it, so
    // replacing the object would orphan every background pointing at it.
    expect(await complete(plugin, id)).toBe(id);

    expect(id.seriesUID).toBe("s-ct");
    // Modality decides the reader; a session author never has to know the code.
    expect(id.role).toBe("radiology");
    // The author's own key rides along untouched.
    expect(id.expand).toBe("case");
});

test("a bare study+series gets its role inferred, and nothing else", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-sm", "SM", 1), series("s-ct", "CT", 2)]);
    const id = { studyUID: STUDY, seriesUID: "s-ct" };

    await complete(plugin, id);

    expect(id.role).toBe("radiology");
    expect(id.seriesUID).toBe("s-ct");
});

test("a slide series infers the wsi role", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-sm", "SM", 1)]);
    const id = { studyUID: STUDY, seriesUID: "s-sm" };
    await complete(plugin, id);
    expect(id.role).toBe("wsi");
});

test("an author-supplied role is never overwritten", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1)]);
    const id = { studyUID: STUDY, seriesUID: "s-ct", role: "wsi" };
    await complete(plugin, id);
    // Fully specified: no listing needed, and no rewrite.
    expect(id.role).toBe("wsi");
    expect(plugin.calls.listings).toBe(0);
});

test("a fully specified dataID costs no query", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1)]);
    const id = { studyUID: STUDY, seriesUID: "s-ct", role: "radiology" };
    await complete(plugin, id);
    expect(plugin.calls.listings).toBe(0);
    expect(id.seriesUID).toBe("s-ct");
});

test("author keys survive completion", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1)]);
    const id = { studyUID: STUDY, seriesUID: "s-ct", derived: "auto", subVolume: "b" };
    await complete(plugin, id);
    expect(id.derived).toBe("auto");
    expect(id.subVolume).toBe("b");
    expect(id.role).toBe("radiology");
});

test("a study with nothing renderable resolves to nothing rather than to something", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([]);
    const id = { studyUID: STUDY, expand: "case" };
    expect(await complete(plugin, id)).toBe(null);
    expect(id.seriesUID).toBe(undefined);
});

test("a series the listing does not carry keeps the protocol's own default", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-other", "CT", 1)]);
    const id = { studyUID: STUDY, seriesUID: "s-missing" };
    await complete(plugin, id);
    // No role invented for a series nobody listed — `createTileSource` falls to
    // "wsi" as it always has, rather than this guessing on thin evidence.
    expect(id.role).toBe(undefined);
});

test("a failed listing leaves the declared dataID untouched", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([], { fail: true });
    const id = { studyUID: STUDY, seriesUID: "s-ct" };
    expect(await complete(plugin, id)).toBe(null);
    expect(id.role).toBe(undefined);
});

test("a dataID with neither a series nor expand is not this pass's business", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1)]);
    // Nothing said which series was meant, so nothing may be picked. It fails at
    // createTileSource, which is where an unanswerable session should fail.
    expect(plugin._needsCompletion.call(plugin, { studyUID: STUDY })).toBe(false);
    expect(plugin.calls.listings).toBe(0);
});

/* ------------------------------------------------------------------ */
/* The whole-session pass (before-refresh)                             */
/* ------------------------------------------------------------------ */

test("every incomplete dataID in the session is completed, not just the opening one", { tag: ["@unit"] }, async () => {
    // The slide switcher builds a thumbnail for every catalog entry, resolving
    // each one with no open and no event — so completion cannot be per-open.
    const plugin = fakePlugin([series("s-ct", "CT", 1), series("s-mr", "MR", 2)]);
    const placeholder = { studyUID: STUDY, expand: "case" };
    const roleless = { studyUID: STUDY, seriesUID: "s-mr" };
    const event = {
        data: [
            "https://example.org/slide.dzi",
            { dataID: placeholder, protocol: "dicom" },
            { dataID: roleless, protocol: "dicom" },
        ],
        background: [],
    };

    await refresh(plugin, event);

    expect(placeholder.seriesUID).toBe("s-ct");
    expect(placeholder.role).toBe("radiology");
    expect(roleless.role).toBe("radiology");
    // Both are the same study, and the listing is memoized per study.
    expect(plugin.calls.listings).toBe(1);
    // Non-DICOM specs are left entirely alone.
    expect(event.data[0]).toBe("https://example.org/slide.dzi");
});

test("only a placeholder background is renamed, and never re-keyed", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1, "chest")]);
    const placeholder = { studyUID: STUDY, expand: "case" };
    const roleless = { studyUID: STUDY, seriesUID: "s-ct" };
    const bgPlaceholder = { id: "dicom:" + STUDY, name: "Radiology", dataReference: placeholder };
    const bgNamed = { id: "keep-me", name: "keep-me too", dataReference: roleless };
    const event = {
        data: [{ dataID: placeholder, protocol: "dicom" }, { dataID: roleless, protocol: "dicom" }],
        background: [bgPlaceholder, bgNamed],
    };

    await refresh(plugin, event);

    expect(bgPlaceholder.name).toBe("friendly");
    // BackgroundConfig registers itself under `id`; rewriting it desyncs that
    // registry and every id resolver reading from it.
    expect(bgPlaceholder.id).toBe("dicom:" + STUDY);
    // Filling in a role says nothing about what the background should be called.
    expect(bgNamed.name).toBe("keep-me too");
});

test("a session with nothing to complete costs no query", { tag: ["@unit"] }, async () => {
    const plugin = fakePlugin([series("s-ct", "CT", 1)]);
    await refresh(plugin, {
        data: [{ dataID: { studyUID: STUDY, seriesUID: "s-ct", role: "radiology" }, protocol: "dicom" }],
        background: [],
    });
    expect(plugin.calls.listings).toBe(0);
});

/* ------------------------------------------------------------------ */
/* The listing behind it                                               */
/* ------------------------------------------------------------------ */

/** A plugin stand-in whose underlying fetch is counted and controllable. */
function fakeListingPlugin() {
    const proto = Captured.prototype;
    const state = { seriesByStudy: new Map() };
    const calls = { fetches: 0 };
    let release;
    const gate = new Promise(r => { release = r; });
    return {
        state, calls,
        release: (value) => release(value),
        seriesConfigForStudy: proto.seriesConfigForStudy,
        async _fetchSeriesConfigForStudy(studyUID) {
            calls.fetches++;
            const value = await gate;
            if (value instanceof Error) throw value;
            state.seriesByStudy.set(studyUID, value);
            return value;
        },
    };
}

test("concurrent askers share one series listing", { tag: ["@unit"] }, async () => {
    // One open asks three times — primary pick, role inference, buildCaseSession.
    // Caching the settled value alone would let all three race past the write.
    const plugin = fakeListingPlugin();
    const all = Promise.all([
        plugin.seriesConfigForStudy.call(plugin, STUDY),
        plugin.seriesConfigForStudy.call(plugin, STUDY),
        plugin.seriesConfigForStudy.call(plugin, STUDY),
    ]);
    plugin.release([series("s-ct", "CT", 1)]);
    const [a, b, c] = await all;

    expect(plugin.calls.fetches).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    // And the settled value is what later readers get, not a promise.
    expect(Array.isArray(plugin.state.seriesByStudy.get(STUDY))).toBe(true);
    await plugin.seriesConfigForStudy.call(plugin, STUDY);
    expect(plugin.calls.fetches).toBe(1);
});

test("a failed listing is not remembered", { tag: ["@unit"] }, async () => {
    // `qidoSafe` answers `[]` on a store hiccup; remembering the failure would
    // make the study look permanently empty for the rest of the session.
    const plugin = fakeListingPlugin();
    const first = plugin.seriesConfigForStudy.call(plugin, STUDY);
    plugin.release(new Error("store down"));
    await expect(first).rejects.toThrow("store down");
    expect(plugin.state.seriesByStudy.has(STUDY)).toBe(false);
});

test("the radiology modality set is the one the completion path reads", { tag: ["@unit"] }, () => {
    // The inference is only as good as this set; SM must stay out of it.
    expect([...DicomTools.RADIOLOGY_MODALITIES].sort()).toEqual(["CR", "CT", "DX", "MR", "NM", "PT"]);
    expect(DicomTools.RADIOLOGY_MODALITIES.has("SM")).toBe(false);
});
