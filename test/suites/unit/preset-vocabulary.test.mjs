/**
 * A destination whose class vocabulary is closed (EMPAIA's EAD namespaces) used
 * to be enforced nowhere: the preset editor let anyone type a class, and the
 * integration dropped the unknown value on the way out. The annotation stored,
 * its classification did not, and nothing said so — a lossy session.
 *
 * These vectors pin the constraint at the `crud:preset` checkpoint, where it
 * covers the editor, scripting and anything added later at once, and pin the two
 * things that must NOT be refused: an unclassified preset (drawing without
 * deciding on a class is the default), and a class that arrived from the
 * destination itself but that this session may not author.
 */
import { test, expect } from "@xopat/test-harness";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

globalThis.window = globalThis.window ?? globalThis;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

// `presets.js` is a browser script that assigns onto a global namespace object.
class AnnotationObjectFactory {}
const OSDAnnotations = { AnnotationObjectFactory };
globalThis.OSDAnnotations = OSDAnnotations;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };
globalThis.Dialogs = globalThis.Dialogs ?? { show() {}, MSG_WARN: "warn" };

new Function(readFileSync(path.join(repoRoot, "modules/annotations/presets.js"), "utf8"))();

/** Guards registered by the manager, run the way the pipeline runs them. */
function makePipelineStub() {
    const guards = [];
    return {
        guards,
        registerGuard(spec) {
            guards.push(spec);
            return () => {
                const i = guards.indexOf(spec);
                if (i >= 0) guards.splice(i, 1);
            };
        },
        run(direction, item) {
            for (const g of guards) {
                const r = g.handler({ direction, resourceName: "preset" }, item);
                if (r && !r.ok) return r;
            }
            return { ok: true };
        },
    };
}

function makeManager() {
    const pipeline = makePipelineStub();
    globalThis.IO_PIPELINE = pipeline;

    const events = [];
    const context = {
        uid: "module.annotations",
        cache: { get: () => undefined },
        polygonFactory: new AnnotationObjectFactory(),
        addHandler: () => {},
        raiseEvent: (name, payload) => events.push({ name, payload }),
        // No presetResource: `_mutate` then applies locally, which is exactly the
        // pre-IO path and keeps this test about the vocabulary, not the queue.
        presetResource: undefined,
    };
    const manager = new OSDAnnotations.PresetManager("presets", context);
    return { manager, pipeline, events };
}

const VALUES = [
    { value: "org.empaia.my.app.v1.classes.tumor", label: "Tumor" },
    { value: "org.empaia.my.app.v1.classes.stroma", label: "Stroma", color: "#00ff00" },
];

test("a class outside the vocabulary is refused at the checkpoint", { tag: ["@unit"] }, async () => {
    const { manager, pipeline } = makeManager();
    manager.setVocabulary({
        ownerUid: "module.empaia-workbench",
        metaKey: "empaiaClass",
        values: VALUES,
    });

    // The shape `addVocabularyPreset` / a create dispatch produces.
    const refused = pipeline.run("pre-create", {
        presetID: "invented",
        meta: { empaiaClass: { name: "Class", value: "something.the.user.typed" } },
    });
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("W_ANNOTATION_CLASS_UNKNOWN");

    const allowed = pipeline.run("pre-create", {
        presetID: "ok",
        meta: { empaiaClass: { name: "Class", value: VALUES[0].value } },
    });
    expect(allowed.ok).toBe(true);
});

test("an unclassified preset stays allowed — drawing without a class is the default",
    { tag: ["@unit"] }, async () => {
        const { manager, pipeline } = makeManager();
        manager.setVocabulary({ ownerUid: "o", metaKey: "empaiaClass", values: VALUES });

        const noMeta = pipeline.run("pre-create", { presetID: "scratch", meta: { category: { name: "Name", value: "Scratch" } } });
        expect(noMeta.ok).toBe(true);

        // `updatePreset` addresses meta keys as flat patch entries; an empty value
        // is "remove the classification", not "set an unknown one".
        const cleared = pipeline.run("pre-update", { empaiaClass: "" });
        expect(cleared.ok).toBe(true);
    });

test("a class the destination reported is accepted but never offered", { tag: ["@unit"] }, async () => {
    const { manager, pipeline } = makeManager();
    manager.setVocabulary({ ownerUid: "o", metaKey: "empaiaClass", values: VALUES });

    const jobClass = "org.empaia.my.app.v1.classes.job_only";
    expect(pipeline.run("pre-create", { meta: { empaiaClass: { name: "Class", value: jobClass } } }).ok).toBe(false);

    // Import path: the value exists server-side, so refusing it would lose data
    // that is already stored. It must not become a user-pickable class, though.
    expect(manager.extendVocabulary([{ value: jobClass, label: "Job only" }])).toBe(true);
    expect(pipeline.run("pre-create", { meta: { empaiaClass: { name: "Class", value: jobClass } } }).ok).toBe(true);
    expect(manager.unusedVocabularyEntries().map(e => e.value)).toEqual(VALUES.map(v => v.value));
});

test("addVocabularyPreset carries the class in one dispatch", { tag: ["@unit"] }, async () => {
    const { manager, events } = makeManager();
    manager.setVocabulary({ ownerUid: "o", metaKey: "empaiaClass", values: VALUES });

    const preset = manager.addVocabularyPreset(VALUES[1].value);
    expect(preset).toBeTruthy();
    expect(preset.getMetaValue("empaiaClass")).toBe(VALUES[1].value);
    expect(preset.meta.category.value).toBe("Stroma");
    expect(preset.color).toBe("#00ff00");
    expect(manager.classValueOf(preset)).toBe(VALUES[1].value);

    // Exactly one create — the create-then-addCustomMeta pair it replaces was two
    // guard runs and two outbox entries for one user gesture, with a window in
    // which the preset existed without its class.
    expect(events.filter(e => e.name === "preset-create").length).toBe(1);
    expect(events.filter(e => e.name === "preset-update").length).toBe(0);

    // Now taken, so no longer offered.
    expect(manager.unusedVocabularyEntries().map(e => e.value)).toEqual([VALUES[0].value]);

    // Freeform is closed: a value that is not in the vocabulary yields nothing
    // rather than a preset the destination would reject.
    expect(manager.addVocabularyPreset("not.in.the.list")).toBe(undefined);
});

test("disposing the vocabulary removes the constraint", { tag: ["@unit"] }, async () => {
    const { manager, pipeline, events } = makeManager();
    const dispose = manager.setVocabulary({ ownerUid: "o", metaKey: "empaiaClass", values: VALUES });

    expect(pipeline.guards.length).toBe(1);
    expect(events.some(e => e.name === "preset-vocabulary-changed")).toBe(true);

    dispose();
    expect(pipeline.guards.length).toBe(0);
    expect(manager.vocabulary).toBe(undefined);
    expect(pipeline.run("pre-create", { meta: { empaiaClass: { name: "Class", value: "anything" } } }).ok).toBe(true);
});
