/**
 * Layers survive persistence by riding on the annotations they hold.
 *
 * A layer has no IO resource and no sink role. In memory an annotation points at
 * its layer with `layerID`; every record that leaves the module carries
 * `layer: {id, name, position}` instead, and the import side rebuilds the layers
 * from those descriptors. The native file additionally lists the layers, which
 * is the only way an empty one can exist in a file.
 *
 * Pinned here:
 *   - the swap happens at the boundary, both ways, and nowhere else;
 *   - names and order come back through native, GeoJSON and QuPath;
 *   - a record written before this (bare `layerID`) still lands in its layer;
 *   - a descriptor is outside data: only checked fields reach a Layer;
 *   - a history state that files members under their layer loses none of them;
 *   - layer moves, renames and reorders are reported as `{layer}` patches.
 *
 * Real wrapper methods, real whitelist trim, real formats — stubbed canvas.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

const { IOFormatRegistry } = await import(fromRoot("src/classes/io/io-formats.ts"));

let A;
let history;
let registry;

globalThis.window = globalThis.window ?? globalThis;

test.beforeAll(async () => {
    registry = new IOFormatRegistry();
    installBrowserGlobals({
        extra: {
            XOpatModuleSingleton: class {},
            XOpatViewerSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            XOpatUser: { instance: () => ({ id: "user-1" }) },
            addModule: () => {},
            requireViewerSingletonPresence: () => {},
            IO_PIPELINE: { formats: registry },
            // The one OSD helper on this path: deep (true, target, ...sources) or shallow merge.
            OpenSeadragon: { extend: (...args) => {
                const deep = args[0] === true;
                const [target, ...sources] = deep ? args.slice(1) : args;
                for (const source of sources) {
                    if (source === undefined || source === null) continue;
                    Object.assign(target, deep ? structuredClone(source) : source);
                }
                return target;
            } },
            fabric: {
                Object: FabricObject, Rect: class {}, Ellipse: class {}, Polygon: class {}, Polyline: class {}, Line: class {},
                // Enlivening is fabric's business; a plain copy is enough to
                // observe what the import does with the layer properties.
                util: { enlivenObjects: (list, done) => done(list.map(o => Object.assign(new FabricObject(), o))) },
            },
            APPLICATION_CONTEXT: {
                history: {
                    push(forward, backward) {
                        history.push({ forward, backward });
                        return forward();
                    },
                    withoutRecording: (fn) => fn(),
                },
            },
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    for (const file of ["presets.js", "objects.js", "annotations-canvas.js",
        "convert/convertor.js", "convert/native.js", "convert/geoJSON.js", "convert/qupath.js"]) {
        await loadBrowserScript(fromRoot("modules", "annotations", ...file.split("/")), "OSDAnnotations");
    }
});

// Suites sharing this worker install their own OpenSeadragon only when none is
// there, so the stub above must not outlive this file.
test.afterAll(() => {
    delete globalThis.OpenSeadragon;
    if (globalThis.window) delete globalThis.window.OpenSeadragon;
});

test.beforeEach(() => { history = []; });

let nextId = 1;
const PRESET = { presetID: "tumor", color: "#c80000", factoryID: "polygon", meta: { category: { name: "Name", value: "Tumor" } } };

/** Serializes the way fabric does: its own geometry, plus the asked-for props it has. */
class FabricObject {
    toObject(keys = []) {
        const out = { type: this.type, points: structuredClone(this.points) };
        for (const key of keys) if (this[key] !== undefined) out[key] = structuredClone(this[key]);
        return out;
    }
}

/** A committed polygon. */
function annotation(props = {}) {
    const id = nextId++;
    return Object.assign(new FabricObject(), {
        incrementId: id, internalID: `a${id}`, id: `id-${id}`, sessionID: "s", visible: true,
        factoryID: "polygon", type: "polygon", presetID: "tumor",
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        ...props,
    });
}

/** The real whitelist trim, on a factory that owns `points`. */
function polygonFactory() {
    const factory = Object.create(A.AnnotationObjectFactory.prototype);
    factory.factoryID = "polygon";
    factory.exportsGeometry = () => ["points"];
    factory.toPointArray = (object, converter) => (object.points || []).map(p => converter(p.x, p.y));
    factory.create = (points, props) => ({ ...props, factoryID: "polygon", type: "polygon", points });
    const trim = factory.copyNecessaryProperties;
    factory.copyNecessaryProperties = (object, keeps = []) => trim.call(factory, object, keeps, false);
    return factory;
}

function wrapper(objects = []) {
    const w = Object.create(A.FabricWrapper.prototype);
    let active = null;
    const factory = polygonFactory();
    Object.assign(w, {
        events: [],
        patches: [],
        objects,
        __selectionSnapshot: [],
        _layers: {},
        _layer: undefined,
        _selectedLayers: new Set(),
        _boardOrder: [],
        _byIncrementId: new Map(),
        viewer: { uniqueId: "v1" },
        overlay: { fabric: {
            version: "test",
            getObjects: () => w.objects,
            getActiveObject: () => active,
            setActiveObject: (o) => { active = o; },
            discardActiveObject: () => { active = null; },
            requestRenderAll: () => {},
            add: (o) => { if (!w.objects.includes(o)) w.objects.push(o); },
            remove: (o) => { w.objects = w.objects.filter(x => x !== o); },
            insertAt: (o) => { if (!o.incrementId) o.incrementId = nextId++; w.objects.push(o); },
            clear: () => { w.objects = []; },
            getZoom: () => 1,
            computeGraphicZoom: () => 1,
        } },
        raiseEvent: (name, payload) => w.events.push({ name, payload }),
        removeHighlight: () => {},
        highlightAnnotation: () => {},
        requestEndSelectionEdit: () => {},
        _applyAnnotationVisibilityState: () => {},
        addAnnotationsBulk: async (list, { addOne }) => { list.forEach(addOne); },
    });
    w.module = {
        // Deployment default (`include.json` `layers: true`).
        layersEnabled: true,
        fabric: w,
        session: "s",
        version: "test",
        defaultFormat: "native",
        objectFactories: { polygon: factory },
        _extraProps: [],
        _forcedProps: [],
        presets: {
            toObject: () => [structuredClone(PRESET)],
            import: async () => {},
            getCommonProperties: () => ({}),
            randomColorHexString: () => "#123456",
        },
        raiseEvent: () => {},
        getExportOptions: () => ({}),
        getFormatOptions: () => ({}),
        getPrivacyExcludesExport: () => false,
        isAnnotationFilteredOut: () => false,
        assignAnnotationIds: () => {},
        // The part of the real one a layer needs: membership is keyed by internalID.
        checkAnnotation: (o) => { o.internalID ??= `gen${nextId++}`; },
        getAnnotationObjectFactory: (id) => (id === "polygon" ? factory : undefined),
        _exportedProps: A.prototype._exportedProps,
        _importSerializationProps: A.prototype._importSerializationProps,
        externalizeLayer: A.prototype.externalizeLayer,
        sanitizeLayerDescriptor: A.prototype.sanitizeLayerDescriptor,
        annotationResource: {
            update: (itemId, patch, options) => {
                w.patches.push({ itemId, patch: structuredClone(patch), kind: options?.meta?.kind });
                return { ok: true };
            },
        },
    };
    A.instance = () => w.module;
    for (const o of objects) w._boardOrder.push({ type: "annotation", id: String(o.incrementId) });
    return w;
}

/** Two named layers with one member each, one empty layer, one root annotation. */
function scene() {
    const [inTumor, inStroma, root] = [annotation(), annotation(), annotation()];
    const w = wrapper([inTumor, inStroma, root]);
    w._createLayer({ id: "L1", name: "Tumor", _objects: [] });
    w._createLayer({ id: "L2", name: "Stroma", _objects: [] });
    w._createLayer({ id: "L3", name: "Empty", _objects: [] });
    w.setAnnotationsLayer([inTumor], "L1");
    w.setAnnotationsLayer([inStroma], "L2");
    w.patches.length = 0;
    return { w, inTumor, inStroma, root };
}

const layerNames = (w) => w.getBoardOrder().filter(e => e.type === "layer").map(e => w.getLayer(e.id).name);
const layerOf = (w, id) => w.objects.find(o => o.id === id)?.layerID;

async function roundTrip(format) {
    const { w, inTumor, inStroma, root } = scene();
    w.moveLayer(w.getLayer("L2"), "up");            // Stroma, Tumor, Empty
    w.setActiveLayer("L1");
    const data = await w.export({ format });

    const target = wrapper();
    expect(await target.import(data, { format, history: false }, true)).toBe(true);
    return { data, target, inTumor, inStroma, root };
}

// ── the boundary ───────────────────────────────────────────────────────────

test("an exported object names its layer in one property", { tag: ["@unit"] }, () => {
    const { w, inTumor, root } = scene();
    const model = w.toModel({ format: "native" });

    const tumor = model.objects.find(o => o.id === inTumor.id);
    expect(tumor.layer).toEqual({ id: "L1", name: "Tumor", position: w.getBoardItemIndex("layer", "L1") });
    expect("layerID" in tumor, "the runtime pointer does not leave the module").toBe(false);
    expect("layer" in model.objects.find(o => o.id === root.id)).toBe(false);

    expect(model.layers.map(l => l.name).sort()).toEqual(["Empty", "Stroma", "Tumor"]);
    // Nothing was added to the live object.
    expect(inTumor.layerID).toBe("L1");
    expect(inTumor.layer).toBeUndefined();
});

test("a selection export lists only the layers it touches", { tag: ["@unit"] }, () => {
    const { w, inTumor } = scene();
    w.selectAnnotations([inTumor]);
    const model = w.toModel({ format: "native", scopeSelected: true });
    expect(model.objects).toHaveLength(1);
    expect(model.layers.map(l => l.id)).toEqual(["L1"]);
});

// ── round trips ────────────────────────────────────────────────────────────

test("the native file restores names, order, the empty layer and the active one", { tag: ["@unit"] }, async () => {
    const { data, target, inTumor, inStroma, root } = await roundTrip("native");
    expect(JSON.parse(data).layers.map(l => l.name)).toEqual(["Stroma", "Tumor", "Empty"]);

    expect(layerNames(target)).toEqual(["Stroma", "Tumor", "Empty"]);
    expect(layerOf(target, inTumor.id)).toBe("L1");
    expect(layerOf(target, inStroma.id)).toBe("L2");
    expect(layerOf(target, root.id)).toBeUndefined();
    expect(target.getLayer("L3").getObjects()).toEqual([]);
    expect(target.getActiveLayer().id).toBe("L1");
    expect(target.objects.every(o => !("layer" in o)), "live objects carry layerID only").toBe(true);
});

for (const format of ["geo-json", "qupath"]) {
    test(`${format} restores names and order from the objects alone`, { tag: ["@unit"] }, async () => {
        const { target } = await roundTrip(format);
        // No layer list in these formats: the empty layer has nothing to ride on.
        expect(layerNames(target)).toEqual(["Stroma", "Tumor"]);
        expect(target.getLayer("L1").getObjects()).toHaveLength(1);
        expect(target.getLayer("L2").getObjects()).toHaveLength(1);
        expect(target.objects.filter(o => !o.layerID)).toHaveLength(1);
    });
}

test("a record with a bare layerID still lands in its layer", { tag: ["@unit"] }, async () => {
    const target = wrapper();
    const legacy = JSON.stringify({ metadata: { version: "old" }, presets: [],
        objects: [{ factoryID: "polygon", type: "polygon", presetID: "tumor", id: "x", layerID: 1700000000000 }] });
    await target.import(legacy, { format: "native", history: false }, true);
    expect(target.getLayer("1700000000000").getObjects()).toHaveLength(1);
});

// ── outside data ───────────────────────────────────────────────────────────

test("only checked descriptor fields reach a layer", { tag: ["@unit"] }, async () => {
    const target = wrapper();
    const object = (id, layer) => ({ factoryID: "polygon", type: "polygon", presetID: "tumor", id, layer });
    const hostile = JSON.stringify({ metadata: {}, presets: [], objects: [
        object("a", { id: "ok", name: "  Named  ", position: "first", _objects: [1], _context: {}, toObject: "x" }),
        object("b", { id: "long", name: "n".repeat(5000) }),
        object("c", { id: { toString: "x" }, name: "no id" }),
        object("d", { id: "", name: "empty id" }),
        object("e", "not an object"),
    ] });
    await target.import(hostile, { format: "native", history: false }, true);

    expect(Object.keys(target._layers).sort()).toEqual(["long", "ok"]);
    const ok = target.getLayer("ok");
    expect(ok.name).toBe("Named");
    expect(ok.position).toBeUndefined();
    expect(typeof ok.toObject, "a method was not overwritten").toBe("function");
    expect(ok.getObjects()).toHaveLength(1);
    expect(target.getLayer("long").name).toHaveLength(200);
    // Unusable descriptors: the annotation comes in, in no layer.
    expect(target.objects.filter(o => !o.layerID).map(o => o.id).sort()).toEqual(["c", "d", "e"]);
});

test("the explicit layer list wins over what an object says", { tag: ["@unit"] }, async () => {
    const target = wrapper();
    const data = JSON.stringify({ metadata: {}, presets: [],
        layers: [{ id: "L", name: "From list", position: 0 }],
        objects: [{ factoryID: "polygon", type: "polygon", presetID: "tumor", id: "a", layer: { id: "L", name: "From object" } }] });
    await target.import(data, { format: "native", history: false }, true);
    expect(target.getLayer("L").name).toBe("From list");
});

// ── history ────────────────────────────────────────────────────────────────

test("undoing an import brings back the annotations that were in layers", { tag: ["@unit"] }, async () => {
    const { w, inTumor, inStroma, root } = scene();
    const incoming = JSON.stringify({ metadata: {}, presets: [],
        objects: [{ factoryID: "polygon", type: "polygon", presetID: "tumor", id: "new" }] });
    await w.import(incoming, { format: "native" }, true);
    expect(w.objects.map(o => o.id)).toEqual(["new"]);

    await history.at(-1).backward();
    expect(w.objects.map(o => o.id).sort()).toEqual([inTumor.id, inStroma.id, root.id].sort());
    expect(layerNames(w)).toEqual(["Tumor", "Stroma", "Empty"]);
    expect(layerOf(w, inTumor.id)).toBe("L1");
    expect(layerOf(w, inStroma.id)).toBe("L2");
});

// ── CRUD ───────────────────────────────────────────────────────────────────

test("a move reports the new layer, and its undo the old one", { tag: ["@unit"] }, () => {
    const { w, inTumor, root } = scene();

    w.setAnnotationLayer(root, "L1");
    expect(w.patches).toEqual([{ itemId: root.incrementId, kind: "layer-change",
        patch: { layer: { id: "L1", name: "Tumor", position: w.getBoardItemIndex("layer", "L1") } } }]);

    w.patches.length = 0;
    history.at(-1).backward();
    expect(w.patches.map(p => p.patch)).toEqual([{ layer: null }]);

    w.patches.length = 0;
    w.setAnnotationsLayer([inTumor, root], "L2");
    expect(w.patches.map(p => p.patch.layer.name)).toEqual(["Stroma", "Stroma"]);
});

test("a rename and a reorder are reported on every member", { tag: ["@unit"] }, () => {
    const { w, inTumor, inStroma } = scene();

    w.renameLayer("L1", "Carcinoma");
    expect(w.patches.map(p => [p.itemId, p.patch.layer.name])).toEqual([[inTumor.incrementId, "Carcinoma"]]);

    w.patches.length = 0;
    w.moveLayer(w.getLayer("L2"), "up");
    expect(w.patches.map(p => p.itemId).sort()).toEqual([inTumor.incrementId, inStroma.incrementId].sort());
    for (const { patch } of w.patches) {
        expect(patch.layer.position).toBe(w.getBoardItemIndex("layer", patch.layer.id));
    }
});
