/**
 * The `adjustments` namespace hands out layer ids, and layer ids are derived from
 * the background id — which comes from the slide's path. Without the sensitive
 * grant they are replaced by positional handles, and because the same ids are the
 * INPUT of every other method, a handle has to resolve back to its layer.
 *
 * Also pins that the namespace exists at all: the class was written, documented
 * and never instantiated.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "node:fs";
import { fromRoot } from "@xopat/test-harness/paths";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const BG_LAYER = "PID-9981_lung_HE.tiff::background";
const OVERLAY = "PID-9981_lung_HE.tiff::heatmap";
const LAYERS = [
    { id: BG_LAYER, title: "PID-9981 lung", type: "identity", role: "background", values: {}, adjusted: false },
    { id: OVERLAY, title: "PID-9981 heatmap", type: "heatmap", role: "overlay", values: {}, adjusted: false },
];

const calls = [];
const viewer = { uniqueId: "v1" };
globalThis.VIEWER_MANAGER = globalThis.window.VIEWER_MANAGER = { viewers: [viewer] };
globalThis.APPLICATION_CONTEXT = globalThis.window.APPLICATION_CONTEXT = {
    url: "http://localhost/",
    adjustments: {
        listLayers: () => LAYERS,
        list: () => [{ dataReference: 0, role: "background", label: "PID-9981_lung_HE.tiff", sampling: "auto", layers: LAYERS }],
        get: (_viewer, id) => { calls.push(["get", id]); return { brightness: 0 }; },
        set: (_viewer, id, values) => { calls.push(["set", id, values]); return true; },
        reset: (_viewer, id) => { calls.push(["reset", id]); },
    },
};

const { XOpatAdjustmentsScriptApi } = await import("../../../src/classes/scripting/adjustments-api.ts");

const api = (sensitiveAllowed) => new XOpatAdjustmentsScriptApi("adjustments").bindInvocationContext({
    scriptingContext: {
        id: "test-context",
        getActiveViewerContextId: () => null,
        setActiveViewerContextId() {},
        mayExposeSensitiveData: () => sensitiveAllowed,
    },
});

test("the adjustments namespace is one of the builtins @unit", () => {
    const source = readFileSync(fromRoot("src", "classes", "scripting-manager.ts"), "utf8");
    expect(source).toContain('new XOpatAdjustmentsScriptApi("adjustments")');
});

test("without the sensitive grant, layer ids are handles that still work @unit @security", () => {
    const masked = api(false);
    const [item] = masked.listData();
    expect(JSON.stringify(item)).not.toContain("PID-9981");
    const ids = item.layers.map(l => l.id);
    expect(ids).toEqual(["xopat:masked-layer:0", "xopat:masked-layer:1"]);

    calls.length = 0;
    masked.getAdjustments(ids[1]);
    masked.setAdjustments(ids[0], { brightness: 0.1 });
    masked.resetAdjustments(ids[1]);
    expect(calls).toEqual([["get", OVERLAY], ["set", BG_LAYER, { brightness: 0.1 }], ["reset", OVERLAY]]);

    // A raw id is not accepted (it could be used to confirm a guessed path), and
    // the refusal does not echo it.
    let message = "";
    try { masked.getAdjustments(BG_LAYER); } catch (e) { message = e.message; }
    expect(message).not.toBe("");
    expect(message).not.toContain("PID-9981");
    expect(() => masked.getAdjustments("xopat:masked-layer:7")).toThrow();
});

test("with the grant, ids are the real ones, and handles resolve too @unit", () => {
    const open = api(true);
    const [item] = open.listData();
    expect(item.layers.map(l => l.id)).toEqual([BG_LAYER, OVERLAY]);
    expect(item.label).toBe("PID-9981_lung_HE.tiff");

    calls.length = 0;
    open.getAdjustments(OVERLAY);
    open.getAdjustments("xopat:masked-layer:0");
    expect(calls).toEqual([["get", OVERLAY], ["get", BG_LAYER]]);
    expect(() => open.getAdjustments("no-such-layer")).toThrow();
});
