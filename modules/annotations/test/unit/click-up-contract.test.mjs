/**
 * The `handleClickUp` contract between annotation modes and the canvas.
 *
 * `FabricWrapper.handleLeftClickUp` only performs its default handling — select the
 * annotation under the cursor, or clear the selection — when the active mode reports
 * the release as NOT consumed. A creation mode that starts a gesture and then throws
 * it away (click too short, no drag) leaves no trace, so from the user's point of view
 * the release was a plain click and must select. Modes used to return `true` on that
 * path, which is why clicking an existing annotation in "manual" mode did nothing.
 *
 * These are pure mode-level assertions: the modes are driven against a hand-rolled
 * `context` and fake factories, no canvas and no browser. The user-visible half of the
 * fix (and the stale-helper-target hardening) lives in the integration suite next door.
 */
import { test, expect, fromRoot, installBrowserGlobals, loadBrowserScript } from "@xopat/test-harness";

let shim;
let A;

/** A factory stub shaped like `OSDAnnotations.AnnotationObjectFactory`. */
function fakeFactory(options = {}) {
    const { threshold = 100, finishes = true } = options;
    // `undefined` is a meaningful value here (the Group factory never assigns one),
    // so it must not fall back to the default.
    const current = "current" in options ? options.current : { id: "helper" };
    return {
        threshold,
        deleted: [],
        discarded: 0,
        initCalls: 0,
        getCreationRequiredMouseDragDurationMS() { return this.threshold; },
        getCurrentObject() { return current; },
        initCreate() { this.initCalls++; },
        updateCreate() {},
        finishDirect() { return finishes; },
        discardCreate() { this.discarded++; },
    };
}

/** The slice of `OSDAnnotations` the two creation modes actually touch. */
function fakeContext(factory) {
    const deleted = [];
    return {
        deleted,
        cursor: { mouseTime: Date.now(), isDown: true, abortedTime: -1 },
        snapEnabled: false,
        snapRadiusPx: 0,
        fabric: {
            deleteHelperAnnotation: (o) => deleted.push(o),
            rerender: () => {},
            findSnapTarget: () => null,
        },
        isMouseOSDInteractive: () => true,
        getAnnotationObjectFactory: () => factory,
        presets: { left: factory ? { objectFactory: factory } : undefined, right: undefined },
    };
}

/** Press now, release after `heldMs` of virtual time. */
function releaseAfter(mode, ctx, factory, heldMs) {
    ctx.cursor.mouseTime = Date.now() - heldMs;
    return mode.handleClickUp({}, { x: 0, y: 0 }, true, factory);
}

test.beforeAll(async () => {
    shim = installBrowserGlobals({
        extra: {
            // `annotations.js` opens with `window.OSDAnnotations = class extends
            // XOpatModuleSingleton` and closes with `addModule(...)`; nothing else on the
            // top level is evaluated at load time.
            XOpatModuleSingleton: class {},
            XOpatHistory: { XOpatHistoryProvider: class {} },
            addModule: () => {},
        },
    });
    A = await loadBrowserScript(fromRoot("modules", "annotations", "annotations.js"), "OSDAnnotations");
    await loadBrowserScript(fromRoot("modules", "annotations", "fixed-area-mode.js"), "OSDAnnotations");
});

test.afterAll(() => shim?.restore());

test("the contract constants are the canvas's two branches", { tag: ["@unit"] }, () => {
    expect(A.AnnotationState.CLICK_CONSUMED).toBe(true);
    expect(A.AnnotationState.CLICK_NOT_CONSUMED).toBe(false);
    // the base mode never consumes, which is why `auto` selects
    expect(new A.StateAuto(fakeContext()).handleClickUp({}, { x: 0, y: 0 }, true, undefined)).toBe(false);
});

test("custom mode: a too-short click is discarded AND falls through to selection", { tag: ["@unit"] }, () => {
    const factory = fakeFactory({ threshold: 100 });
    const ctx = fakeContext(factory);
    const mode = new A.StateCustomCreate(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    expect(factory.initCalls, "the gesture did start").toBe(1);

    expect(releaseAfter(mode, ctx, factory, 10)).toBe(A.AnnotationState.CLICK_NOT_CONSUMED);
    expect(ctx.deleted, "the helper must be removed from the canvas").toEqual([{ id: "helper" }]);
    expect(mode._lastUsed).toBe(null);
});

test("custom mode: a long-enough click creates and consumes the release", { tag: ["@unit"] }, () => {
    const factory = fakeFactory({ threshold: 100, finishes: true });
    const ctx = fakeContext(factory);
    const mode = new A.StateCustomCreate(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    expect(releaseAfter(mode, ctx, factory, 500)).toBe(A.AnnotationState.CLICK_CONSUMED);
    expect(ctx.deleted, "nothing was discarded").toEqual([]);
    expect(mode._lastUsed).toBe(null);
});

test("custom mode: a multi-point shape in progress still consumes the release", { tag: ["@unit"] }, () => {
    // polygon/polyline/text/angle report -1, so the discard branch is unreachable for them;
    // `finishDirect() === false` means "still building". Falling through here would deselect
    // the shape the user is drawing on every vertex click.
    const factory = fakeFactory({ threshold: -1, finishes: false });
    const ctx = fakeContext(factory);
    const mode = new A.StateCustomCreate(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    expect(releaseAfter(mode, ctx, factory, 5)).toBe(A.AnnotationState.CLICK_CONSUMED);
    expect(ctx.deleted).toEqual([]);
    expect(mode._lastUsed, "the in-progress factory is kept").toBe(factory);
});

test("custom mode: a factory with no creation gesture falls through instead of deadlocking the canvas", { tag: ["@unit"] }, () => {
    // The Group factory returns Infinity and never assigns a current object: it cannot be
    // drawn at all, so every click must reach selection rather than being swallowed.
    const factory = fakeFactory({ threshold: Infinity, current: undefined });
    const ctx = fakeContext(factory);
    const mode = new A.StateCustomCreate(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    expect(releaseAfter(mode, ctx, factory, 500)).toBe(A.AnnotationState.CLICK_NOT_CONSUMED);
    expect(ctx.deleted, "deleting `undefined` is the documented no-op").toEqual([undefined]);
});

test("custom mode: no bound factory never consumes", { tag: ["@unit"] }, () => {
    const ctx = fakeContext();
    const mode = new A.StateCustomCreate(ctx);
    expect(mode.handleClickUp({}, { x: 0, y: 0 }, true, undefined)).toBe(A.AnnotationState.CLICK_NOT_CONSUMED);
});

test("fixed-area mode: a click without a drag falls through to selection", { tag: ["@unit"] }, () => {
    const factory = fakeFactory({ threshold: 100 });
    factory.supportsFixedArea = () => true;
    const ctx = fakeContext(factory);
    const mode = new A.FixedAreaMode(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    // no handleMouseMove -> _dragged stays false
    expect(releaseAfter(mode, ctx, factory, 500)).toBe(A.AnnotationState.CLICK_NOT_CONSUMED);
    expect(factory.discarded, "the un-sized shape is discarded").toBe(1);
    expect(mode._lastUsed).toBe(null);
});

test("fixed-area mode: a real drag consumes the release", { tag: ["@unit"] }, () => {
    const factory = fakeFactory({ threshold: 100, finishes: true });
    factory.supportsFixedArea = () => true;
    factory.updateCreateFixedArea = () => true;
    const ctx = fakeContext(factory);
    const mode = new A.FixedAreaMode(ctx);

    mode.handleClickDown({}, { x: 1, y: 2 }, true, factory);
    mode.handleMouseMove({}, { x: 60, y: 60 });
    expect(mode._dragged, "the drag was registered").toBe(true);

    expect(releaseAfter(mode, ctx, factory, 500)).toBe(A.AnnotationState.CLICK_CONSUMED);
    expect(factory.discarded).toBe(0);
});
