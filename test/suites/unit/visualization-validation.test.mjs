/**
 * Validating a visualization config is the RENDERER's job. xOpat only calls the two
 * published entry points — `ShaderConfigurator.compileConfigSchemaModel()` and
 * `getShaderCouplingValidators(type)` — and reports what comes back.
 *
 * That boundary used to exist only inside the scripting API, so a visualization from a
 * session or a URL hash reached `overrideConfigureAll` with nothing checking it: an
 * unknown control type, a params key no control declares, or a violated coupling all
 * passed silently and surfaced much later (worst case, as a fragment-shader compile
 * failure that costs the whole configuration — see UPSTREAM.md).
 *
 * These vectors pin the shared boundary:
 *  - couplings are evaluated even when schema validation is unavailable, and "no AJV"
 *    reports `skipped`, never "valid",
 *  - findings from both channels are collected in ONE pass — the caller sees the whole
 *    list, not just the first problem,
 *  - the input config is never mutated and no layer is ever dropped here (deciding what
 *    to do with a finding belongs to the caller),
 *  - group children are walked,
 *  - AJV `oneOf` branch noise is filtered by the layer's declared type, so one typo does
 *    not print once per registered shader type.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const mod = await import("../../../src/classes/app/visualization-validation.ts");
const {
    validateVisualizations,
    invalidateVisualizationSchemaCache,
    filterOneOfErrorsByDiscriminator,
    formatCouplingCorrective,
} = mod;

/**
 * Install a fake FlexRenderer exposing only what the boundary is allowed to touch.
 * `couplings` maps a shader type to the validator list the renderer would publish.
 */
function installRenderer({ couplings = {}, schema = { type: "object" }, throwOnUnknownType = true } = {}) {
    globalThis.OpenSeadragon = {
        FlexRenderer: {
            ShaderConfigurator: {
                compileConfigSchemaModel: () => schema,
                getShaderCouplingValidators: (type) => {
                    if (!(type in couplings)) {
                        if (throwOnUnknownType) throw new Error(`Unknown shader type '${type}'`);
                        return [];
                    }
                    return couplings[type];
                },
            },
        },
    };
}

/** Fake AJV whose compiled validator delegates to `verdict(value)`. */
function installAjv(verdict) {
    globalThis.Ajv2020 = class {
        compile() {
            const fn = (value) => {
                const errors = verdict(value);
                fn.errors = errors && errors.length ? errors : null;
                return !fn.errors;
            };
            return fn;
        }
    };
}

function uninstallAjv() {
    delete globalThis.Ajv2020;
}

function reset() {
    invalidateVisualizationSchemaCache();
    uninstallAjv();
    delete globalThis.OpenSeadragon;
}

const failingCoupling = {
    name: "colormap_class_count",
    summary: "Class count must match the break count.",
    controls: ["color", "threshold"],
    validate: () => ({ ok: false, expected: { "color.steps": 4 }, actual: { "color.steps": 3 } }),
};

test("couplings still run when schema validation is unavailable, and the report says skipped @visualization", async () => {
    reset();
    installRenderer({ couplings: { colormap: [failingCoupling] } });

    const report = validateVisualizations([
        { name: "v", shaders: { classes: { type: "colormap", params: {} } } },
    ]);

    // No AJV on globalThis -> the schema half could not run.
    expect(report.skipped).toBe(true);
    // ...but the renderer's own coupling rules did, and they are what found the problem.
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBe(1);
    expect(report.issues[0].kind).toBe("coupling");
    expect(report.issues[0].shaderId).toBe("classes");
    expect(report.issues[0].coupling).toBe("colormap_class_count");
    // The corrective travels with the failure so the fix needs no second round trip.
    expect(report.issues[0].message).toContain("`color.steps` = 4");

    reset();
});

test("skipped is not valid: a clean config with no AJV still reports skipped @visualization", async () => {
    reset();
    installRenderer({ couplings: { identity: [] } });

    const report = validateVisualizations([{ shaders: { bg: { type: "identity" } } }]);
    expect(report.ok).toBe(true);
    expect(report.skipped).toBe(true);      // caller must read this as "unknown", not "valid"
    expect(report.issues.length).toBe(0);

    reset();
});

test("schema and coupling findings are collected in one pass @visualization", async () => {
    reset();
    installRenderer({ couplings: { colormap: [failingCoupling] } });
    installAjv(() => ([
        {
            instancePath: "/shaders/classes/params/color",
            schemaPath: "#/$defs/shaderLayers/colormap/properties/params",
            message: "must NOT have additional properties",
            params: { additionalProperty: "classifier" },
        },
    ]));

    const report = validateVisualizations([
        { shaders: { classes: { type: "colormap", params: { classifier: {} } } } },
    ]);

    expect(report.skipped).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBe(2);   // both channels, one call

    const kinds = report.issues.map(i => i.kind).sort();
    expect(kinds).toEqual(["coupling", "schema"]);

    const schemaIssue = report.issues.find(i => i.kind === "schema");
    expect(schemaIssue.shaderId).toBe("classes");
    expect(schemaIssue.path).toBe("viz[0]/shaders/classes/params/color");
    expect(schemaIssue.message).toContain("classifier");
    // Raw AJV errors stay available for structured consumers.
    expect(Array.isArray(report.ajvErrors[0])).toBe(true);

    reset();
});

test("the input config is never mutated and no layer is dropped @visualization", async () => {
    reset();
    installRenderer({ couplings: { colormap: [failingCoupling] } });

    const viz = { shaders: { classes: { type: "colormap", params: { classifier: { type: "classifier" } } } } };
    const before = JSON.stringify(viz);

    const report = validateVisualizations([viz]);

    expect(report.ok).toBe(false);
    expect(JSON.stringify(viz)).toBe(before);
    expect(Object.keys(viz.shaders)).toEqual(["classes"]);

    reset();
});

test("group children are walked @visualization", async () => {
    reset();
    installRenderer({ couplings: { colormap: [failingCoupling], group: [] } });

    const report = validateVisualizations([{
        shaders: {
            stack: {
                type: "group",
                shaders: { inner: { type: "colormap", params: {} } },
            },
        },
    }]);

    expect(report.ok).toBe(false);
    expect(report.issues.length).toBe(1);
    // The finding is attributed to the top-level map key, with the nested path in `path`.
    expect(report.issues[0].shaderId).toBe("stack");
    expect(report.issues[0].path).toContain("inner");

    reset();
});

test("an unknown shader type is left for the schema to report, not inferred here @visualization", async () => {
    reset();
    // getShaderCouplingValidators throws for a type the renderer does not know. That is
    // not our verdict to convert into a finding — the structural sanitizer drops unknown
    // types, and the schema reports them.
    installRenderer({ couplings: {} });

    const report = validateVisualizations([{ shaders: { x: { type: "not-a-shader" } } }]);
    expect(report.issues.length).toBe(0);

    reset();
});

test("oneOf branch noise is filtered by the layer's declared type @visualization", () => {
    const viz = { shaders: { classes: { type: "colormap" } } };
    const errors = [
        { instancePath: "/shaders/classes", schemaPath: "#/$defs/shaderLayers/colormap/x", message: "real" },
        { instancePath: "/shaders/classes", schemaPath: "#/$defs/shaderLayers/heatmap/x", message: "noise" },
        { instancePath: "/shaders/classes", schemaPath: "#/$defs/shaderLayers/patternmap/x", message: "noise" },
        { instancePath: "", schemaPath: "#/properties/order", message: "envelope kept" },
    ];

    const filtered = filterOneOfErrorsByDiscriminator(errors, viz);
    const messages = filtered.map(e => e.message);
    expect(messages).toContain("real");
    expect(messages).toContain("envelope kept");
    expect(messages).not.toContain("noise");
});

test("identical findings surviving the filter are deduped @visualization", () => {
    const viz = { shaders: { a: { type: "colormap" } } };
    const dup = { instancePath: "/shaders/a", schemaPath: "#/x", message: "same", params: { p: 1 } };
    const filtered = filterOneOfErrorsByDiscriminator([dup, { ...dup }], viz);
    expect(filtered.length).toBe(1);
});

test("formatCouplingCorrective renders the literal fix @visualization", () => {
    expect(formatCouplingCorrective({ "color.steps": 4, mode: "qualitative" }))
        .toBe('To satisfy: set `color.steps` = 4, `mode` = "qualitative".');
    expect(formatCouplingCorrective(undefined)).toBe("");
    expect(formatCouplingCorrective({})).toBe("");
});
