/**
 * The `#xopat-<kind>` registry, and the built-in `region` kind.
 *
 * Two behaviours are easy to regress and expensive when they do:
 *  - a malformed or unknown link must render as an ORDINARY link, not as a dead
 *    action. `parse` returning null is what the renderer keys off;
 *  - the viewer reference resolves through a chain (real uniqueId → registered
 *    resolvers → active → sole viewer). The chat module's anonymization handles
 *    (`viewer-1`) reach the viewer only through the registered-resolver step, so a
 *    reordering here silently breaks every assistant-authored region link.
 */
import { test, expect } from "@xopat/test-harness";
import { fromRoot } from "@xopat/test-harness/paths";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(tmpdir(), "xopat-markdown-links-"));

const outfile = path.join(tmp, "links.mjs");
await esbuild.build({
    entryPoints: [path.join(fromRoot(), "modules", "markdown", "links.ts")],
    outfile,
    bundle: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
});
const { XOpatLinks } = await import(pathToFileURL(outfile).href);

test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const links = () => new XOpatLinks((key) => key);

/** A viewer stub recording what the region handler did to it. */
const fakeViewer = (uniqueId) => {
    const calls = [];
    return {
        uniqueId,
        calls,
        world: { getItemCount: () => 1, getItemAt: () => ({
            source: {},
            imageToViewportCoordinates: (point) => ({ x: point.x / 1000, y: point.y / 1000 }),
        }) },
        viewport: {
            fitBounds: (rect) => calls.push(["fitBounds", rect]),
            panTo: (point) => calls.push(["panTo", point]),
            applyConstraints: () => calls.push(["applyConstraints"]),
        },
    };
};

const withViewers = (viewers, activeId, run) => {
    const previousManager = globalThis.VIEWER_MANAGER;
    const previousOSD = globalThis.OpenSeadragon;
    globalThis.VIEWER_MANAGER = { viewers, getActiveUniqueId: () => activeId };
    globalThis.OpenSeadragon = {
        Point: class { constructor(x, y) { this.x = x; this.y = y; } },
        Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
    };
    try { return run(); }
    finally {
        globalThis.VIEWER_MANAGER = previousManager;
        globalThis.OpenSeadragon = previousOSD;
    }
};

test("only registered kinds parse; everything else is an ordinary link", () => {
    const registry = links();
    expect(registry.parse("#xopat-region?x=1&y=2")).not.toBe(null);
    expect(registry.parse("#xopat-nosuchkind?x=1")).toBe(null);
    expect(registry.parse("https://example.org")).toBe(null);
    expect(registry.parse("#section-2")).toBe(null);
});

test("a region link without a position is malformed, not an action", () => {
    const registry = links();
    expect(registry.parse("#xopat-region?viewer=viewer-1")).toBe(null);
    expect(registry.parse("#xopat-region?x=abc&y=2")).toBe(null);
    expect(registry.parse("#xopat-region?x=10&y=20").payload)
        .toEqual({ viewer: null, x: 10, y: 20, w: null, h: null, z: null });
});

test("a custom kind round-trips through register / parse / open", () => {
    const registry = links();
    const opened = [];
    registry.register("note", {
        parse: (params) => (params.get("id") ? { id: params.get("id") } : null),
        activate: (payload) => { opened.push(payload.id); return true; },
    });
    expect(registry.open("#xopat-note?id=42")).toBe(true);
    expect(opened).toEqual(["42"]);
    expect(registry.open("#xopat-note")).toBe(false);
});

test("a handler that throws is contained, not propagated", () => {
    const registry = links();
    registry.register("boom", { parse: () => ({}), activate: () => { throw new Error("nope"); } });
    expect(registry.open("#xopat-boom?a=1")).toBe(false);
});

test("viewer resolution prefers a real uniqueId over a registered resolver", () => {
    const a = fakeViewer("slide-a");
    const b = fakeViewer("slide-b");
    withViewers([a, b], "slide-b", () => {
        const registry = links();
        registry.registerViewerResolver(() => "slide-b");
        expect(registry.resolveViewer("slide-a")).toBe(a);
    });
});

test("an alias only resolves through the registered resolver", () => {
    const a = fakeViewer("slide-a");
    const b = fakeViewer("slide-b");
    withViewers([a, b], "slide-a", () => {
        const registry = links();
        expect(registry.resolveViewer("viewer-2")).toBe(a); // falls back to active
        registry.registerViewerResolver((ref) => (ref === "viewer-2" ? "slide-b" : null));
        expect(registry.resolveViewer("viewer-2")).toBe(b);
    });
});

test("a sized region fits bounds; a point pans without zooming", () => {
    const viewer = fakeViewer("slide-a");
    withViewers([viewer], "slide-a", () => {
        const registry = links();
        expect(registry.open("#xopat-region?x=1000&y=2000&w=1000&h=1000")).toBe(true);
        expect(viewer.calls[0][0]).toBe("fitBounds");

        viewer.calls.length = 0;
        expect(registry.open("#xopat-region?x=1000&y=2000&w=0&h=0")).toBe(true);
        expect(viewer.calls[0][0]).toBe("panTo");
    });
});
