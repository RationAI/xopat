/**
 * `{slideHash}` / `{slideName}` address data by the slide, not by the session's
 * background id. They are resolved from `UTILITIES.slideIdentityFor` only when
 * the template asks for them, sanitized like every other value, and fall back
 * the way `{backgroundId}` does when the slide is unknown — never to a value
 * that would merge unrelated slides silently into a slot that looks specific.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? class {
    addHandler() {} removeHandler() {} raiseEvent() {}
};
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { formatContextTemplate, IOPipeline } = await import("../../../src/classes/io/io-pipeline.ts");

const ctx = {
    direction: "export", capabilityId: "bundle-export", ownerId: "annotations",
    ownerUid: "module.annotations", xoType: "module", key: "", viewerId: "v1",
    backgroundId: "5cOMu29LyTVk", meta: {},
};

test("slide tokens substitute the resolved identity, sanitized @unit", () => {
    const slide = { hash: "0123456789abcdef", name: "FNB-766-24 3/2 AE-0.czi" };
    expect(formatContextTemplate("xopat-{slideHash}", ctx, { mode: "name" }, slide)).toBe("xopat-0123456789abcdef");
    expect(formatContextTemplate("{slideName}", ctx, { mode: "name" }, slide)).toBe("FNB-766-24_3_2_AE-0.czi");
});

test("an unknown slide falls back like {backgroundId}, not to a shared literal @unit", () => {
    expect(formatContextTemplate("run-{slideHash}", ctx)).toBe("run-_any");
    expect(formatContextTemplate("{slideName}", ctx, { empty: "" })).toBe("");
});

test("formatPath resolves the slide only when the template asks @unit", () => {
    const calls = [];
    globalThis.UTILITIES = {
        slideIdentityFor: (id) => { calls.push(id); return { hash: "feedfacecafebeef", name: "a.tif" }; },
    };
    try {
        const pipeline = Object.create(IOPipeline.prototype);
        expect(pipeline.formatPath("x/{viewerId}", ctx)).toBe("x/v1");
        expect(calls).toEqual([]);
        expect(pipeline.formatPath("x/{slideHash}/{slideName}", ctx)).toBe("x/feedfacecafebeef/a.tif");
        expect(calls).toEqual(["5cOMu29LyTVk"]);
    } finally {
        delete globalThis.UTILITIES;
    }
});
