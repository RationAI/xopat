/**
 * `{slideHash}` / `{slideName}` address data by the slide, not by the session's
 * background id. They are resolved from `UTILITIES.slideIdentityFor` only when
 * the template asks for them, sanitized like every other value, and fall back
 * the way `{backgroundId}` does when the slide is unknown — never to a value
 * that would merge unrelated slides silently into a slot that looks specific.
 */
import { test, expect } from "@xopat/test-harness";
import { createHmac } from "node:crypto";

globalThis.window = globalThis.window ?? globalThis;
globalThis.OpenSeadragon = globalThis.OpenSeadragon ?? {};
globalThis.OpenSeadragon.EventSource = globalThis.OpenSeadragon.EventSource ?? class {
    addHandler() {} removeHandler() {} raiseEvent() {}
};
globalThis.$ = globalThis.$ ?? { t: (key) => String(key).split(".").pop() };

const { formatContextTemplate, IOPipeline } = await import("../../../src/classes/io/io-pipeline.ts");
const { hmacSha256Hex, slideHashOf, sha256 } = await import("../../../src/classes/io/slide-hash.ts");

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
        pipeline.getConfig = () => ({ slideHashKey: "k" });
        expect(pipeline.formatPath("x/{viewerId}", ctx)).toBe("x/v1");
        expect(calls).toEqual([]);
        expect(pipeline.formatPath("x/{slideHash}/{slideName}", ctx)).toBe("x/feedfacecafebeef/a.tif");
        expect(calls).toEqual(["5cOMu29LyTVk"]);
    } finally {
        delete globalThis.UTILITIES;
    }
});

const hex = (bytes) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

test("sha256 / HMAC-SHA256 match the published vectors @unit", () => {
    expect(hex(sha256(new TextEncoder().encode(""))))
        .toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(new TextEncoder().encode("abc"))))
        .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Two-block message (56 bytes forces a second padding block).
    expect(hex(sha256(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))))
        .toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    // RFC 4231 test case 2.
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?"))
        .toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    // Long keys (hashed first), multi-byte UTF-8 and multi-block messages, against node:crypto.
    for (const [key, msg] of [
        ["k".repeat(200), "Test Using Larger Than Block-Size Key - Hash Key First"],
        ["ključ-ž", "/data/Příliš žluťoučký kůň.czi"],
        ["secret", "x".repeat(1000)],
    ]) {
        expect(hmacSha256Hex(key, msg)).toBe(createHmac("sha256", key).update(msg, "utf8").digest("hex"));
    }
});

test("slideHashOf is 16 hex, deterministic, and depends on the key @unit", () => {
    const a = slideHashOf("k1", "/data/FNB-766-24.czi");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(slideHashOf("k1", "/data/FNB-766-24.czi")).toBe(a);
    expect(slideHashOf("k2", "/data/FNB-766-24.czi")).not.toBe(a);
    expect(slideHashOf("k1", "/data/FNB-766-25.czi")).not.toBe(a);
});

test("formatPath passes the operator key and refuses {slideHash} without one @unit", () => {
    const seen = [];
    globalThis.UTILITIES = {
        slideIdentityFor: (id, key) => { seen.push(key); return { hash: key ? `h-${key}` : undefined, name: "a.tif" }; },
    };
    try {
        const keyed = Object.create(IOPipeline.prototype);
        keyed.getConfig = () => ({ slideHashKey: "secret" });
        expect(keyed.formatPath("x/{slideHash}", ctx)).toBe("x/h-secret");

        const unkeyed = Object.create(IOPipeline.prototype);
        unkeyed.getConfig = () => ({});
        let thrown;
        try { unkeyed.formatPath("x/{slideHash}", ctx); } catch (e) { thrown = e; }
        expect(thrown?.code).toBe("W_IO_SLIDE_HASH_KEY");
        expect(typeof thrown?.userMessage).toBe("string");
        // {slideName} alone needs no key.
        expect(unkeyed.formatPath("x/{slideName}", ctx)).toBe("x/a.tif");
        expect(seen).toEqual(["secret", undefined, undefined]);
    } finally {
        delete globalThis.UTILITIES;
    }
});

test("no slide behind the context keeps the _any fallback, key or not @unit", () => {
    globalThis.UTILITIES = { slideIdentityFor: () => undefined };
    try {
        const pipeline = Object.create(IOPipeline.prototype);
        pipeline.getConfig = () => ({});
        expect(pipeline.formatPath("x/{slideHash}", { ...ctx, backgroundId: undefined })).toBe("x/_any");
    } finally {
        delete globalThis.UTILITIES;
    }
});
