/**
 * Remember scopes of script action consent, and the pixel-read gate built on them.
 *
 * The dialog offers "only this time", "until reload", "this slide", "all slides for N days" and
 * "always". What matters is what each choice WRITES and what a later request ACCEPTS: a grant for
 * one slide must not open another, "once" must leave nothing behind, and persistence must not be
 * offered where it is off (secureMode, or an action that opted out).
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;
globalThis.$ = globalThis.$ ?? { t: (key) => String(key) };

const scope = await import("../../../src/classes/scripting/consent-scope.ts");
const { XOpatScriptingApi } = await import("../../../src/classes/scripting/abstract-api.ts");

const choice = (id) => scope.findConsentRememberChoice(id);

test("persistence and slide choices are offered only where they apply @unit", () => {
    const ids = (o) => scope.consentRememberChoices(o).map(c => c.id);
    expect(ids({ hasCacheKey: false, hasSlide: true, persistAllowed: true })).toEqual(["once"]);
    expect(ids({ hasCacheKey: true, hasSlide: false, persistAllowed: false })).toEqual(["once", "session"]);
    expect(ids({ hasCacheKey: true, hasSlide: true, persistAllowed: false }))
        .toEqual(["once", "session", "slide-session"]);
    expect(ids({ hasCacheKey: true, hasSlide: true, persistAllowed: true }))
        .toEqual(["once", "session", "slide-session", "slide-7d", "all-1d", "all-7d", "all-30d", "always"]);
});

test("each choice writes the key and lifetime it names @unit", () => {
    expect(scope.consentGrantWrite("core:pixel-read", "s1", choice("once"))).toBe(null);
    expect(scope.consentGrantWrite(undefined, "s1", choice("always"))).toBe(null);
    expect(scope.consentGrantWrite("core:pixel-read", "s1", choice("session")))
        .toEqual({ key: "core:pixel-read", ttlMs: 0 });
    expect(scope.consentGrantWrite("core:pixel-read", "s1", choice("slide-7d")))
        .toEqual({ key: "core:pixel-read@slide:s1", ttlMs: 7 * 24 * 60 * 60 * 1000 });
    // A slide choice with no known slide narrows to the session-wide grant — never widens
    // into a persistent all-slides one.
    expect(scope.consentGrantWrite("core:pixel-read", undefined, choice("slide-7d")))
        .toEqual({ key: "core:pixel-read", ttlMs: 0 });
    expect(scope.consentGrantWrite("k", null, choice("always")).ttlMs).toBeGreaterThan(50 * 365 * 24 * 60 * 60 * 1000);
});

test("a slide grant satisfies only its own slide; an all-slides grant satisfies any @unit", () => {
    const write = scope.consentGrantWrite("k", "slideA", choice("slide-session"));
    expect(scope.consentGrantKeys("k", "slideA")).toContain(write.key);
    expect(scope.consentGrantKeys("k", "slideB")).not.toContain(write.key);
    expect(scope.consentGrantKeys("k", "slideB")).toContain("k");
});

test("the slide key is opaque and stable @unit", () => {
    const path = "/data/patients/PID-9981_lung_HE.tiff";
    const key = scope.slideConsentKeyOf(path);
    expect(key).toBe(scope.slideConsentKeyOf(path));
    expect(key).not.toContain("PID");
    expect(key).toMatch(/^[0-9a-f]{24}$/);
    expect(scope.slideConsentKeyOf("")).toBe(undefined);
});

// ---- the pixel-read gate on a real XOpatScriptingApi ----

class TestApi extends XOpatScriptingApi {
    constructor() { super("test", "Test", "test api"); }
    read(viewer) { return this.requirePixelReadConsent(viewer, "a test read"); }
    slideKeyFor(viewer) { return this.slideConsentKey(viewer); }
}

function viewerShowing(tileSourceId) {
    return { scalebar: { getReferencedTiledImage: () => ({ source: { tileSourceId } }) } };
}

function contextWith(extra = {}) {
    const grants = new Set();
    return {
        grants,
        context: {
            id: "ctx",
            getActiveViewerContextId: () => null,
            isConsentDialogBypassed: () => false,
            rememberActionConsent: (key) => grants.add(key),
            isActionConsented: (key) => grants.has(key),
            ...extra,
        },
    };
}

/** No document in this runtime → the window.confirm fallback, which remembers "until reload". */
function withConfirm(answer, fn) {
    const prior = globalThis.confirm;
    let asked = 0;
    globalThis.confirm = () => { asked++; return answer; };
    return Promise.resolve(fn()).finally(() => { globalThis.confirm = prior; }).then(() => asked);
}

test("a pixel read asks once, then the session grant answers @unit", async () => {
    const { context } = contextWith();
    const api = new TestApi().bindInvocationContext({ scriptingContext: context });
    const viewer = viewerShowing("slide-1");
    const asked = await withConfirm(true, async () => {
        await api.read(viewer);
        await api.read(viewer);
    });
    expect(asked).toBe(1);
});

test("a declined pixel read throws a message the model can act on @unit", async () => {
    const { context } = contextWith();
    const api = new TestApi().bindInvocationContext({ scriptingContext: context });
    let error = null;
    await withConfirm(false, async () => {
        try { await api.read(viewerShowing("slide-1")); } catch (e) { error = e; }
    });
    expect(String(error?.message)).toContain("pixelReadRejected");
});

test("a slide-scoped grant does not open another slide @unit", async () => {
    const { context, grants } = contextWith();
    const api = new TestApi().bindInvocationContext({ scriptingContext: context });
    const slideA = viewerShowing("slide-A");
    grants.add(scope.slideScopedConsentKey("core:pixel-read", api.slideKeyFor(slideA)));
    const asked = await withConfirm(false, async () => {
        await api.read(slideA);
        await api.read(viewerShowing("slide-B")).catch(() => {});
    });
    expect(asked).toBe(1);
});

test("a preapproved in-process context is never prompted @unit", async () => {
    const { context } = contextWith({ pixelReadPreapproved: true });
    const api = new TestApi().bindInvocationContext({ scriptingContext: context });
    const asked = await withConfirm(false, () => api.read(viewerShowing("slide-1")));
    expect(asked).toBe(0);
});
