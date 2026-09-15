/**
 * Series/slide LABEL formatting.
 *
 * Three things reached the UI that should never have: a `SeriesDescription`
 * whose components an anonymiser had blanked (`",,Axial,5.0,,,"`), the grouping
 * sentinels (`UNKNOWN_CONTAINER`, `DEFAULT_PATH`) read as if they were names,
 * and an optical-path chip (`[Image #1]`) appended to a series that has exactly
 * one optical path and therefore nothing to tell apart.
 *
 * None of it is a rendering bug: the label is computed once and frozen into
 * `background[].name`, from which it is copied into the shader-layer title and
 * the navigator tab. So these tests pin the formatter, not the view.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.OpenSeadragon = globalThis.OpenSeadragon || { TileSource: class {} };
globalThis.HTTPError = globalThis.HTTPError || class HTTPError extends Error {};

const DicomTools = (await import("../../dicom-query.mjs")).default;

const TILE = 256;
const STUDY = "1.2.study";
const SERIES = "1.2.series.abc123";

/** A minimal tiled WSI instance: enough for `isWSIInstance` + the grouping. */
const wsiInstance = ({ uid, container = null, pathId = null, tiles = 8 }) => {
    const attrs = {
        "00080016": { Value: ["1.2.840.10008.5.1.4.1.1.77.1.6"] }, // VL WSI Storage
        "00080018": { Value: [uid] },
        "00080060": { Value: ["SM"] },
        "00080008": { Value: ["ORIGINAL", "PRIMARY", "VOLUME"] },
        "00280008": { Value: [tiles * tiles] },
        "00280010": { Value: [TILE] },
        "00280011": { Value: [TILE] },
        "00480006": { Value: [tiles * TILE] },
        "00480007": { Value: [tiles * TILE] },
        "00280002": { Value: [3] },
        "00280004": { Value: ["RGB"] },
        "00280100": { Value: [8] },
        "00280101": { Value: [8] },
    };
    if (container) attrs["00400512"] = { Value: [container] };
    if (pathId) attrs["00480106"] = { Value: [pathId] };
    return attrs;
};

/** Translator stand-in: the app supplies the plugin's namespaced `this.t`. */
const t = (key, opts = {}) => `${key}(${opts.number ?? ""}|${opts.tail ?? ""})`;

test("cleanText drops blanked components instead of rendering their separators",
    { tag: ["@unit"] }, () => {
        // The reported label, verbatim.
        expect(DicomTools.cleanText(",,Axial,5.0,,,")).toBe("Axial, 5.0");
        // A VM>1 attribute arrives as an array and must clean identically —
        // `String(array)` is what produced the commas in the first place.
        expect(DicomTools.cleanText(["", "", "Axial", "5.0", "", "", ""])).toBe("Axial, 5.0");
        expect(DicomTools.cleanText("  Lung window  ")).toBe("Lung window");
        // DICOM's own value delimiter, from a store that did not split it.
        expect(DicomTools.cleanText("ORIGINAL\\PRIMARY\\\\AXIAL")).toBe("ORIGINAL, PRIMARY, AXIAL");
        // `/` and `;` occur inside real protocol names — splitting there would
        // change what the label says, so they are left alone.
        expect(DicomTools.cleanText("T2 TSE/FS")).toBe("T2 TSE/FS");
        // Nothing informative left is `null`, not "" and not ",,," — so the
        // caller's `desc || fallback` chain reaches the fallback.
        expect(DicomTools.cleanText(",,,")).toBe(null);
        expect(DicomTools.cleanText("   ")).toBe(null);
        expect(DicomTools.cleanText(null)).toBe(null);
        expect(DicomTools.cleanText(undefined)).toBe(null);
    });

test("text() cleans a tag while v() keeps the raw first component",
    { tag: ["@unit"] }, () => {
        const ds = { "0008103E": { Value: [",,Axial,5.0,,,"] } };
        expect(DicomTools.text(ds, "0008103E")).toBe("Axial, 5.0");
        expect(DicomTools.v(ds, "0008103E")).toBe(",,Axial,5.0,,,");
        expect(DicomTools.text({}, "0008103E")).toBe(null);
    });

test("the grouping sentinels never become the label", { tag: ["@unit"] }, async () => {
    // No ContainerIdentifier and no OpticalPathIdentifier: the group still needs
    // a key, so it gets the sentinels — but "UNKNOWN_CONTAINER" is a diagnostic,
    // not a specimen name, and used to be shown as one.
    const [group] = await DicomTools.groupSeriesInstances(
        [wsiInstance({ uid: "a.1" })],
        { studyUID: STUDY, seriesUID: SERIES, seriesNumber: 3 },
        { t });

    expect(group.label).not.toContain("UNKNOWN_CONTAINER");
    expect(group.label).not.toContain("DEFAULT_PATH");
    // Falls through to the translated "Series #N …tail" instead.
    expect(group.label).toContain("series.fallbackNumbered(3|abc123)");
});

test("the optical-path chip appears only when it tells groups apart",
    { tag: ["@unit"] }, async () => {
        const single = await DicomTools.groupSeriesInstances(
            [wsiInstance({ uid: "a.1", container: "SPECIMEN-1", pathId: "Image #1" })],
            { studyUID: STUDY, seriesUID: SERIES }, { t });

        expect(single.length).toBe(1);
        // One optical path: the chip carried no information and read as markup.
        // The dimensions chip is unrelated and stays.
        expect(single[0].label).toBe("SPECIMEN-1 • 2048×2048");

        const multi = await DicomTools.groupSeriesInstances(
            [
                wsiInstance({ uid: "a.1", container: "SPECIMEN-1", pathId: "Image #1" }),
                wsiInstance({ uid: "b.1", container: "SPECIMEN-1", pathId: "Image #2" }),
            ],
            { studyUID: STUDY, seriesUID: SERIES }, { t });

        expect(multi.length).toBe(2);
        expect(multi.map(g => g.label).sort()).toEqual([
            "SPECIMEN-1 [Image #1] • 2048×2048",
            "SPECIMEN-1 [Image #2] • 2048×2048",
        ]);
    });

test("the label goes through the injected translator, not the global one",
    { tag: ["@unit"] }, async () => {
        // The static query path has no plugin instance to await `_localeReady`
        // on, so a caller that has one passes its namespaced `t`. Without that
        // the global `$.t` answers with the raw dotted key once i18next is up
        // but the `dicom` bundle is not — and the key is then frozen into the
        // session's background name.
        const seen = [];
        const spy = (key, opts) => { seen.push(key); return "TRANSLATED"; };

        const [group] = await DicomTools.groupSeriesInstances(
            [wsiInstance({ uid: "a.1" })],
            { studyUID: STUDY, seriesUID: SERIES }, { t: spy });

        expect(seen).toEqual(["series.fallbackTail"]);
        expect(group.label).toBe("TRANSLATED • 2048×2048");
    });
