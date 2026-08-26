/**
 * KV handles front string-only drivers, so `set(key, value)` has to encode.
 *
 * It used to encode with `String(value)`, which wrote the literal
 * `"[object Object]"` for every object — silently destroying viewport
 * snapshots, menu tab order, unsaved-annotation snapshots and plugin sync
 * state, all of which read the value back and quietly gave up. These vectors
 * pin the envelope, and pin the historical encoding of the value shapes that
 * were never broken, because changing those would break every reader doing
 * `parseInt(cached)` or comparing against `"true"`.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { SyncKVHandle, AsyncKVHandle } = await import("../../../src/classes/io/io-kv-handle.ts");
const { makeMemoryDriver } = await import("../../../src/classes/io/kv-drivers.ts");

/** Minimal stand-in for the one pipeline method a handle actually calls. */
const pipeline = { sanitizeKey: (s) => (s ? String(s).replace(/[^A-Za-z0-9._\-]/g, "_") : "_") };

function makeHandle(Handle = SyncKVHandle) {
    const driver = makeMemoryDriver("memory");
    const handle = new Handle({
        pipeline, ownerUid: "core", ownerId: "core",
        xoType: "core", capabilityId: "kv:cache", drivers: [driver],
    });
    return { handle, driver };
}

test("objects and arrays survive the round-trip @unit", () => {
    const { handle } = makeHandle();
    const viewport = { zoomLevel: 3.5, point: { x: 0.1, y: 0.2 }, rotation: 0 };
    handle.set("viewport-cache", { "session::bg": { viewport, t: 1 } });
    expect(handle.get("viewport-cache")["session::bg"].viewport).toEqual(viewport);

    handle.set("tab-order", ["a", "b", "c"]);
    const order = handle.get("tab-order");
    // The old encoding produced "a,b,c", so `Array.isArray` was always false and
    // every reader silently fell back to its default.
    expect(Array.isArray(order)).toBe(true);
    expect(order).toEqual(["a", "b", "c"]);
});

test("strings, numbers and booleans keep their historical encoding @unit", () => {
    const { handle, driver } = makeHandle();
    handle.set("name", "plain string");
    handle.set("width", 320);
    handle.set("open", true);

    expect(driver.getItem("core::name")).toBe("plain string");
    expect(driver.getItem("core::width")).toBe("320");
    expect(driver.getItem("core::open")).toBe("true");

    expect(handle.get("name")).toBe("plain string");
    expect(parseInt(handle.get("width"), 10)).toBe(320);
    expect(handle.get("open")).toBe(true);
    handle.set("open", false);
    expect(handle.get("open")).toBe(false);
});

test("a string that merely looks like JSON stays a string @unit", () => {
    const { handle } = makeHandle();
    handle.set("template", "{{name}} literal");
    handle.set("bracketed", "[not an array]");
    expect(handle.get("template")).toBe("{{name}} literal");
    expect(handle.get("bracketed")).toBe("[not an array]");
});

test("setting undefined deletes rather than storing \"undefined\" @unit", () => {
    const { handle, driver } = makeHandle();
    handle.set("gone", { a: 1 });
    handle.set("gone", undefined);
    expect(driver.getItem("core::gone")).toBe(null);
    expect(handle.get("gone", "fallback")).toBe("fallback");
});

test("pre-existing \"[object Object]\" values read as absent and are dropped @unit", () => {
    const { handle, driver } = makeHandle();
    driver.setItem("core::legacy", "[object Object]");
    expect(handle.get("legacy", "fallback")).toBe("fallback");
    // Removed, not merely ignored: otherwise it costs a read on every boot and
    // keeps looking like state that exists.
    expect(driver.getItem("core::legacy")).toBe(null);
});

test("null round-trips as null, not as the string @unit", () => {
    const { handle } = makeHandle();
    handle.set("nothing", null);
    expect(handle.get("nothing")).toBe(null);
    expect(handle.get("nothing", "fallback")).toBe("fallback");
});

test("the async handle encodes identically @unit", async () => {
    const { handle, driver } = makeHandle(AsyncKVHandle);
    await handle.set("obj", { deep: { value: 1 } });
    expect((await handle.get("obj")).deep.value).toBe(1);

    await handle.set("flag", true);
    expect(driver.getItem("core::flag")).toBe("true");
    expect(await handle.get("flag")).toBe(true);

    await handle.set("obj", undefined);
    expect(driver.getItem("core::obj")).toBe(null);
});

test("getItem/setItem stay raw — libraries needing a real Storage see no envelope @unit", () => {
    const { handle, driver } = makeHandle();
    handle.setItem("oidc.core.state", '{"id":"1"}');
    expect(driver.getItem("core::oidc.core.state")).toBe('{"id":"1"}');
    expect(handle.getItem("oidc.core.state")).toBe('{"id":"1"}');
});
