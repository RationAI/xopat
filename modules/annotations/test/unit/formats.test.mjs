/**
 * Annotation formats on the core format registry.
 *
 * Conversion used to live in `OSDAnnotations.Convertor`: a private registry of
 * two-stage classes (`encodePartial` + a synchronous `encodeFinalize`) whose
 * options were static properties mutated by the settings UI. Formats are now
 * plain entries of `IO_PIPELINE.formats` under the domain `"annotations"`, with
 * one `encode(model)` / `decode(data)` each, and `OSDAnnotations.Convertor` is a
 * deprecated facade over that registry.
 *
 * Pinned here:
 *   - the built-in formats round-trip a model through the registry alone;
 *   - detection tells the JSON dialects apart (native must not "accept"
 *     someone else's JSON and import nothing);
 *   - an existing two-stage convertor class still registers, and works through
 *     BOTH the old static calls and the registry;
 *   - the old calls work for a new-style format too.
 *
 * Runs the real convertor files against a stub module — no canvas, no fabric.
 */
import { test, expect, fromRoot, loadBrowserScript } from "@xopat/test-harness";

const { IOFormatRegistry } = await import(fromRoot("src/classes/io/io-formats.ts"));

const DOMAIN = "annotations";

/** The slice of a factory the formats call. */
const polygonFactory = {
    factoryID: "polygon",
    toPointArray: (object, converter) => (object.points || []).map(p => converter(p.x, p.y)),
    copyNecessaryProperties: (object) => ({ ...object }),
    create: (points, props) => ({ ...props, factoryID: "polygon", type: "polygon", points }),
};

const moduleStub = {
    version: "test",
    getAnnotationObjectFactory: (id) => (id === "polygon" ? polygonFactory : undefined),
    presets: { getCommonProperties: () => ({}), randomColorHexString: () => "#123456" },
};

let registry;
let Convertor;

test.beforeAll(async () => {
    registry = new IOFormatRegistry();
    globalThis.IO_PIPELINE = { formats: registry };
    globalThis.fabric = { Object: { NUM_FRACTION_DIGITS: 2 } };
    globalThis.OSDAnnotations = {
        instance: () => moduleStub,
        AnnotationObjectFactory: { withArrayPoint: (x, y) => [x, y] },
        Preset: { fromJSONFriendlyObject: (o) => o },
    };
    for (const file of ["convertor", "native", "geoJSON", "qupath"]) {
        await loadBrowserScript(fromRoot(`modules/annotations/convert/${file}.js`), "OSDAnnotations");
    }
    Convertor = globalThis.OSDAnnotations.Convertor;
});

const PRESET = { presetID: "tumor", color: "#c80000", factoryID: "polygon", meta: { category: { name: "Name", value: "Tumor" } } };
const UNUSED = { presetID: "unused", color: "#000000", factoryID: "polygon", meta: { category: { name: "Name", value: "Unused" } } };
const POLYGON = {
    factoryID: "polygon", type: "polygon", presetID: "tumor",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
};
const model = () => ({ objects: [structuredClone(POLYGON)], presets: [structuredClone(PRESET), structuredClone(UNUSED)] });

// ── built-in formats through the registry ──────────────────────────────────

test("the built-in formats are registered under the annotations domain @unit", () => {
    expect(registry.list(DOMAIN).map(f => f.id)).toEqual(["native", "geo-json", "qupath"]);
    expect(registry.get(DOMAIN, "geo-json").extensions[0]).toBe(".xo.geo.json");
    expect(registry.get(DOMAIN, "qupath").extensions[0]).toBe(".qu.geo.json");
});

test("native round-trips, keeping only the presets in use @unit", async () => {
    const text = await registry.encode(DOMAIN, "native", model());
    const parsed = JSON.parse(text);
    expect(parsed.metadata.version).toBe("test");
    expect(parsed.presets.map(p => p.presetID)).toEqual(["tumor"]);

    const back = await registry.decode(DOMAIN, "native", text);
    expect(back.model.objects).toEqual([POLYGON]);
});

test("geo-json writes objects and presets as features and reads them back @unit", async () => {
    const text = await registry.encode(DOMAIN, "geo-json", model());
    const collection = JSON.parse(text);
    expect(collection.type).toBe("FeatureCollection");
    const [feature, ...presetFeatures] = collection.features;
    expect(feature.geometry.type).toBe("Polygon");
    // A linear ring: nested, and closed by repeating the first vertex.
    expect(feature.geometry.coordinates).toEqual([[[0, 0], [10, 0], [10, 10], [0, 0]]]);
    expect(presetFeatures.map(f => f.geometry)).toEqual([null, null]);

    const back = (await registry.decode(DOMAIN, "geo-json", text)).model;
    expect(back.objects[0].points).toEqual(POLYGON.points);
    expect(back.presets.map(p => p.presetID).sort()).toEqual(["tumor", "unused"]);
});

test("a format honours what the export was asked to contain @unit", async () => {
    const text = await registry.encode(DOMAIN, "geo-json", model(), { options: { exportsObjects: false } });
    expect(JSON.parse(text).features.every(f => f.geometry === null)).toBe(true);
});

test("one object converts on its own @unit", () => {
    const feature = registry.encodeItem(DOMAIN, "geo-json", structuredClone(POLYGON));
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Polygon");
    // No preset, no representation.
    expect(registry.encodeItem(DOMAIN, "geo-json", { factoryID: "polygon", points: [] })).toBeUndefined();
});

test("qupath reads classifications from presets and applies the offset option @unit", async () => {
    const options = { imageCoordinatesOffset: { x: 5, y: 5 }, trimToDefaultPresets: false };
    const text = await registry.encode(DOMAIN, "qupath", model(), { options });
    const feature = JSON.parse(text).features[0];
    expect(feature.properties.classification).toEqual({ name: "Tumor", color: [200, 0, 0] });
    expect(feature.geometry.coordinates[0][0]).toEqual([-5, -5]);

    // `addOffset` defaults to true (declared default); turned off, nothing shifts.
    const plain = await registry.encode(DOMAIN, "qupath", model(), { options: { ...options, addOffset: false } });
    expect(JSON.parse(plain).features[0].geometry.coordinates[0][0]).toEqual([0, 0]);
});

// ── detection ──────────────────────────────────────────────────────────────

test("the JSON dialects are told apart by content @unit", async () => {
    const native = await registry.encode(DOMAIN, "native", model());
    const geo = await registry.encode(DOMAIN, "geo-json", model());
    const qupath = await registry.encode(DOMAIN, "qupath", model());
    expect(registry.detect(DOMAIN, native)).toBe("native");
    expect(registry.detect(DOMAIN, geo)).toBe("geo-json");
    expect(registry.detect(DOMAIN, qupath)).toBe("qupath");
});

test("native does not claim someone else's JSON, whatever the file is called @unit", async () => {
    const geo = await registry.encode(DOMAIN, "geo-json", model());
    expect(registry.detect(DOMAIN, geo, { fileName: "export.json" })).toBe("geo-json");
    expect(registry.detect(DOMAIN, '{"unrelated":true}', { fileName: "export.json" })).toBeUndefined();
});

test("a file name decides between formats the content cannot separate @unit", () => {
    expect(Convertor.detectFromFilename("slide.qu.geo.json")).toBe("qupath");
    expect(Convertor.detectFromFilename("slide.xo.geo.json")).toBe("geo-json");
    expect(Convertor.detectFromFilename("slide.geojson")).toBe("geo-json");
    expect(Convertor.detectFromFilename("slide.json")).toBe("native");
    expect(Convertor.detectFromFilename("slide.png")).toBeNull();
});

test('decode "auto" picks the format and says which @unit', async () => {
    const qupath = await registry.encode(DOMAIN, "qupath", model(), { options: { trimToDefaultPresets: false } });
    const decoded = await registry.decode(DOMAIN, "auto", qupath);
    expect(decoded.format).toBe("qupath");
    expect(decoded.model.objects[0].points).toEqual(POLYGON.points);
    expect(decoded.model.objects[0].presetID).toBe("Tumor");
});

// ── traits ─────────────────────────────────────────────────────────────────

test("traits tell the module what a format's model needs @unit", () => {
    expect(Convertor.traits("native")).toEqual({ allProps: false, props: [], objects: true, presets: true });
    expect(Convertor.traits("qupath").presets).toBe(false);
    // Unknown formats get the permissive defaults rather than throwing.
    expect(Convertor.traits("nope")).toEqual({ allProps: true, props: [], objects: true, presets: true });
});

// ── the deprecated Convertor API ───────────────────────────────────────────

test("a two-stage convertor class still registers and works both ways @unit", async () => {
    const Legacy = class extends Convertor.IConvertor {
        static title = "Legacy";
        static lossy = true;
        static lossyReason = "drops everything but the count";
        static exportsPresets = false;
        static options = { prefix: { type: "textInput", default: "n=" } };
        static getSuffix() { return ".legacy"; }
        async encodePartial(annotationsGetter) {
            return { objects: (annotationsGetter() || []).map(() => 1), prefix: this.options.prefix };
        }
        static encodeFinalize(output) { return output.prefix + output.objects.length; }
        async decode(data) { return { objects: new Array(Number(data.slice(2))).fill({ factoryID: "polygon" }) }; }
    };
    Convertor.register("legacy", Legacy);

    // Through the registry, like any other format — options default from the class.
    expect(await registry.encode(DOMAIN, "legacy", model())).toBe("n=1");
    expect(await registry.encode(DOMAIN, "legacy", model(), { options: { prefix: "c:" } })).toBe("c:1");
    expect((await registry.decode(DOMAIN, "legacy", "n=3")).model.objects.length).toBe(3);

    const registered = registry.get(DOMAIN, "legacy");
    expect(registered.extensions).toEqual([".legacy"]);
    expect(registered.lossy).toBe("drops everything but the count");
    expect(Convertor.traits("legacy").presets).toBe(false);

    // Through the old static calls.
    expect(Convertor.get("legacy")).toBe(Legacy);
    expect(Convertor.formats).toContain("legacy");
    expect(Convertor.getSuffix("legacy")).toBe(".legacy");
    expect((await Convertor.decode({ format: "legacy" }, "n=2")).objects.length).toBe(2);
});

test("the old two-stage calls work for a registry format, synchronously where it is @unit", async () => {
    const fabricWrapper = { module: moduleStub, toModel: () => model() };
    const partial = await Convertor.encodePartial({ format: "native" }, fabricWrapper);
    expect(partial.format).toBe("native");
    expect(partial.objects).toEqual([POLYGON]);

    const text = Convertor.encodeFinalize("native", partial);
    expect(typeof text).toBe("string");
    expect(JSON.parse(text).objects).toEqual([POLYGON]);
});

test("the legacy view of a registry format exposes what the old UI read @unit", () => {
    const view = Convertor.get("qupath");
    expect(view.lossy).toBe(true);
    expect(view.exportsPresets).toBe(false);
    expect(view.exportsObjects).toBe(true);
    expect(view.getSuffix()).toBe(".qu.geo.json");
    expect(Object.keys(view.options)).toContain("addOffset");
    expect(() => Convertor.get("nope")).toThrow(/Invalid format/);
});
