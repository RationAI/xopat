/**
 * Cross-viewport sync session (`ViewportSyncAPI`) — what survives a clear and a
 * layout change.
 *
 * What these vectors pin:
 *  - sync turns a follower by its registration angle. Clearing the alignment
 *    must take that angle (and mirror) back out, and the persisted viewport
 *    must never include it: the session is memory-only, so a stored angle
 *    reopens the slide tilted with nothing left to explain it;
 *  - the session outlives the viewers it was built with. When the reference
 *    viewer is no longer open, an open calibrated viewer is promoted and the
 *    relative alignment of the others is unchanged; with none open the session
 *    is dropped instead of pointing at a viewer that does not exist;
 *  - a viewer has one alignment, made by one mode. Replacing it is
 *    transactional — a cancelled re-calibration changes nothing — and a result
 *    computed against state that was cleared meanwhile is never stored;
 *  - pausing a viewer to nudge it and resuming keeps exactly the pose it was
 *    left in as the synced one.
 */
import { test, expect, stubDocument } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const linkContexts = {};
globalThis.OpenSeadragon = {
    Tools: { _linkContexts: linkContexts },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
    Rect: class { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } },
    Placement: { CENTER: "center" },
};
globalThis.VIEWER_MANAGER = { viewers: [] };
// What the picker and its markers touch outside the viewer.
globalThis.$ = { t: (key) => key };
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
// Assigned, not defaulted: a suite earlier in this worker may have left a `document`
// that cannot create elements. Handed back afterwards for the same reason.
const hadDocument = "document" in globalThis, previousDocument = globalThis.document;
globalThis.document = stubDocument();
test.afterAll(() => {
    if (hadDocument) globalThis.document = previousDocument; else delete globalThis.document;
});

const { ViewportSyncAPI } = await import("../../../src/classes/osd/scalebar/viewport-sync-api.ts");

function makeViewer(uniqueId, rotation = 0, flip = false) {
    const viewer = {
        uniqueId,
        viewport: {
            getRotation: () => rotation,
            setRotation: (deg) => { rotation = deg; },
            getFlip: () => flip,
            setFlip: (value) => { flip = !!value; },
        },
        // No world item: the mapper bails out, which keeps these tests about
        // session bookkeeping rather than about OSD coordinate conversion.
        world: { getItemAt: () => null },
        tools: {
            link(context) {
                const ctx = (linkContexts[context] ||= { subscribed: [] });
                if (!ctx.subscribed.includes(viewer)) ctx.subscribed.push(viewer);
            },
            unlink(context) {
                const list = linkContexts[context]?.subscribed || [];
                const index = list.indexOf(viewer);
                if (index >= 0) list.splice(index, 1);
            },
            readViewportState: () => null,
            applyViewportState: () => {},
        },
    };
    viewer.scalebar = { ViewportSyncAPI: new ViewportSyncAPI(viewer) };
    return viewer;
}

/**
 * A viewer with a world: one image `imageWidth` pixels wide spanning viewport
 * width 1, real viewport state, and OSD-style event handlers — enough for the
 * mapper, the three-point picker and the adjust path to run for real.
 */
function makeLiveViewer(uniqueId, imageWidth = 1000) {
    const state = { zoom: 1, center: { x: 0.5, y: 0.5 }, rotation: 0, flip: false };
    const handlers = {};
    const viewer = makeViewer(uniqueId);
    Object.assign(viewer, {
        state,
        handlers,
        world: {
            getItemAt: () => ({
                imageToViewportCoordinates: (p) => ({ x: p.x / imageWidth, y: p.y / imageWidth }),
                viewportToImageCoordinates: (p) => ({ x: p.x * imageWidth, y: p.y * imageWidth }),
            }),
        },
        viewport: {
            getRotation: () => state.rotation,
            setRotation: (deg) => { state.rotation = deg; },
            getFlip: () => state.flip,
            setFlip: (value) => { state.flip = !!value; },
            getContainerSize: () => ({ x: 800, y: 600 }),
            pointFromPixel: (position) => ({ x: position.x, y: position.y }),
            fitBounds() {},
            panTo() {},
        },
        addHandler(name, fn) { (handlers[name] ||= []).push(fn); },
        removeHandler(name, fn) { handlers[name] = (handlers[name] || []).filter(h => h !== fn); },
        addOverlay() {},
        removeOverlay() {},
        /** A stationary click at an IMAGE-space point. */
        clickImage(point) {
            const position = { x: point.x / imageWidth, y: point.y / imageWidth };
            for (const name of ["canvas-press", "canvas-click"]) {
                for (const fn of [...(handlers[name] || [])]) fn({ position });
            }
        },
        /**
         * A double-click as OSD delivers it: two clicks, then
         * `canvas-double-click` synchronously after the second one.
         */
        doubleClickImage(point) {
            const position = { x: point.x / imageWidth, y: point.y / imageWidth };
            this.clickImage(point);
            this.clickImage(point);
            const event = { position, preventDefaultAction: false };
            for (const fn of [...(handlers["canvas-double-click"] || [])]) fn(event);
            return event;
        },
    });
    viewer.tools.readViewportState = () => ({ ...state, center: { ...state.center } });
    viewer.tools.applyViewportState = (next) => Object.assign(state, {
        zoom: next.zoom, center: { ...next.center }, rotation: next.rotation, flip: !!next.flip,
    });
    return viewer;
}

/** A registration provider chain that answers whatever the test hands it. */
function stubRegistration(estimate) {
    const calls = { estimate: [], evicted: [] };
    globalThis.OpenSeadragon.ViewportRegistration = {
        estimate: (ref, target, opts) => { calls.estimate.push(opts); return estimate(ref, target, opts); },
        clearCacheFor: (viewer) => { calls.evicted.push(viewer.uniqueId); },
        clearCache() {},
    };
    return calls;
}

function rotationTransform(deg, b = { x: 0, y: 0 }, scale = 1) {
    const r = deg * Math.PI / 180;
    return {
        A: [scale * Math.cos(r), -scale * Math.sin(r), scale * Math.sin(r), scale * Math.cos(r)],
        b,
        scale,
        rotDeg: deg,
    };
}

function seedSession(leaderId, transforms, flipParity = {}) {
    ViewportSyncAPI._session = { context: 0, leaderId, leaderPts: null, transforms, flipParity };
}

function open(...viewers) {
    for (const key of Object.keys(linkContexts)) delete linkContexts[key];
    ViewportSyncAPI._manualPending = {};
    ViewportSyncAPI._session = null;
    delete globalThis.OpenSeadragon.ViewportRegistration;
    globalThis.VIEWER_MANAGER.viewers = viewers;
}

const api = (viewer) => viewer.scalebar.ViewportSyncAPI;
const apply = (t, p) => ({
    x: t.A[0] * p.x + t.A[1] * p.y + t.b.x,
    y: t.A[2] * p.x + t.A[3] * p.y + t.b.y,
});

test("sync: a follower reports its registration angle, the reference and an unposed viewer report none @unit", async () => {
    const ref = makeViewer("ref"), follower = makeViewer("follower");
    open(ref, follower);
    seedSession("ref", { ref: rotationTransform(0), follower: rotationTransform(30) });

    expect(api(follower).getRotationOffset()).toBe(0); // calibrated, never linked
    await api(ref).enable({ allowManual: false });
    await api(follower).enable({ allowManual: false });

    expect(api(ref).getRotationOffset()).toBe(0);
    expect(api(follower).getRotationOffset()).toBe(-30);
});

test("sync: clearing the session takes rotation and mirror back out of every follower @unit", async () => {
    const ref = makeViewer("ref", 10), follower = makeViewer("follower");
    open(ref, follower);
    seedSession("ref", { ref: rotationTransform(0), follower: rotationTransform(30) }, { follower: true });
    await api(ref).enable({ allowManual: false });
    await api(follower).enable({ allowManual: false });

    // What the mapper leaves a follower at: reference rotation minus its angle, mirrored.
    follower.viewport.setRotation(10 - 30);
    follower.viewport.setFlip(true);

    api(ref).resetSession();

    expect(follower.viewport.getRotation()).toBe(10);
    expect(follower.viewport.getFlip()).toBe(false);
    expect(ref.viewport.getRotation()).toBe(10);
    expect(api(follower).getRotationOffset()).toBe(0);
    expect(ViewportSyncAPI._session).toBe(null);
});

test("sync: a clear aborts a point pick in flight on any viewer @unit", async () => {
    const ref = makeViewer("ref"), a = makeViewer("a");
    open(ref, a);
    seedSession("ref", { ref: rotationTransform(0), a: rotationTransform(30) });

    let aborted = 0;
    api(a)._activeCalibrationCancel = () => { aborted++; };
    api(ref).resetSession();
    expect(aborted).toBe(1);
    expect(api(a)._activeCalibrationCancel).toBe(null);

    seedSession("ref", { ref: rotationTransform(0), a: rotationTransform(30) });
    api(a)._activeCalibrationCancel = () => { aborted++; };
    api(ref).resetViewer();
    expect(aborted).toBe(2);
});

test("sync: auto-align all replaces an existing hand-made alignment @unit", async () => {
    const ref = makeViewer("ref"), follower = makeViewer("follower", -30);
    open(follower, ref);
    seedSession("follower", { follower: rotationTransform(0), ref: rotationTransform(30) });
    ViewportSyncAPI._session.leaderPts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    await api(follower).enable({ allowManual: false });
    await api(ref).enable({ allowManual: false });

    // These stubs cannot be registered, so the follower fails to re-join —
    // which is exactly when a kept manual transform would have gone unnoticed.
    const result = await ViewportSyncAPI.autoSyncAll(ref);

    const S = ViewportSyncAPI._session;
    expect(S.leaderId).toBe("ref");
    expect(S.leaderPts).toBe(null);
    expect(Object.keys(S.transforms)).toEqual(["ref"]);
    expect(result.aligned).toBe(1);
    expect(result.failed).toBe(1);
});

test("sync: clearing one viewer releases only that viewer, also after it was unlinked @unit", async () => {
    const ref = makeViewer("ref"), a = makeViewer("a", -30), b = makeViewer("b", -45);
    open(ref, a, b);
    seedSession("ref", {
        ref: rotationTransform(0), a: rotationTransform(30), b: rotationTransform(45),
    });
    for (const v of [ref, a, b]) await api(v).enable({ allowManual: false });

    api(a).disable(); // unlinking alone keeps the pose
    expect(a.viewport.getRotation()).toBe(-30);

    api(a).resetViewer();

    expect(a.viewport.getRotation()).toBe(0);
    expect(b.viewport.getRotation()).toBe(-45);
    expect(api(b).isEnabled()).toBe(true);
    expect(ViewportSyncAPI._session.transforms.a).toBe(undefined);
});

test("sync: a closed reference is replaced by an open viewer without changing relative alignment @unit", async () => {
    const tA = rotationTransform(20, { x: 100, y: -50 }, 2);
    const tB = rotationTransform(-35, { x: -10, y: 70 }, 0.5);
    const a = makeViewer("a"), b = makeViewer("b");
    open(a, b); // "gone" is not open any more
    seedSession("gone", { gone: rotationTransform(0), a: tA, b: tB });

    await api(a).enable({ allowManual: false });

    const S = ViewportSyncAPI._session;
    expect(S.leaderId).toBe("a");
    expect(S.transforms.a.A).toEqual([1, 0, 0, 1]);
    // The closed viewer's alignment is remembered, re-based like the others.
    expect(Object.keys(S.transforms).sort()).toEqual(["a", "b", "gone"]);

    // Same physical point: through the old reference vs. through the new one.
    const p = { x: 321, y: -123 };
    const viaNewLeader = apply(S.transforms.b, apply(tA, p));
    const direct = apply(tB, p);
    expect(viaNewLeader.x).toBeCloseTo(direct.x, 6);
    expect(viaNewLeader.y).toBeCloseTo(direct.y, 6);
    expect(S.transforms.b.rotDeg).toBeCloseTo(-55, 6);
});

test("sync: with no open calibrated viewer the stale session is dropped @unit", async () => {
    const fresh = makeViewer("fresh");
    open(fresh);
    seedSession("gone", { gone: rotationTransform(0), other: rotationTransform(15) });

    await api(fresh).enable({ allowManual: false });

    const S = ViewportSyncAPI._session;
    expect(S.leaderId).toBe("fresh");
    expect(Object.keys(S.transforms)).toEqual(["fresh"]);
});

const REF_POINTS = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }];
/** REF_POINTS turned by 90 degrees and shifted by (100, 200). */
const MATCHING_POINTS = [{ x: 100, y: 200 }, { x: 100, y: 1200 }, { x: -900, y: 200 }];

async function manuallyAlignedPair() {
    const ref = makeLiveViewer("ref"), a = makeLiveViewer("a", 2000);
    open(ref, a);
    seedSession("ref", {
        ref: rotationTransform(0),
        a: { ...rotationTransform(30, { x: 5, y: 7 }), source: "manual" },
    });
    ViewportSyncAPI._session.leaderPts = REF_POINTS;
    await api(ref).enable({ allowManual: false });
    await api(a).enable({ allowManual: false });
    return { ref, a };
}

test("sync: cancelling a manual re-calibration changes nothing @unit", async () => {
    const { a } = await manuallyAlignedPair();
    const before = JSON.stringify(ViewportSyncAPI._session.transforms.a);
    const rotation = a.viewport.getRotation();

    const pending = api(a).enable({ mode: "manual", replace: true });
    expect(api(a).isBusy()).toBe(true);
    // Suspended while picking, so navigating to a landmark cannot drag peers.
    expect(api(a).isEnabled()).toBe(false);
    a.clickImage(MATCHING_POINTS[0]);
    expect(api(a).getProgress()).toBe("1/3");

    expect(api(a).cancelCalibration()).toBe(true);
    await expect(pending).rejects.toThrow(/cancel/i);

    expect(JSON.stringify(ViewportSyncAPI._session.transforms.a)).toBe(before);
    expect(api(a).isEnabled()).toBe(true);
    expect(api(a).isBusy()).toBe(false);
    expect(linkContexts[0].subscribed).toContain(a);
    expect(a.viewport.getRotation()).toBe(rotation);
    expect(a.handlers["canvas-click"]).toEqual([]);
});

test("sync: a finished manual re-calibration replaces the alignment and evicts the memoized one @unit", async () => {
    const { a } = await manuallyAlignedPair();
    const registration = stubRegistration(async () => null);

    const pending = api(a).enable({ mode: "manual", replace: true });
    for (const point of MATCHING_POINTS) a.clickImage(point);
    const result = await pending;

    const t = ViewportSyncAPI._session.transforms.a;
    expect(result.mode).toBe("manual");
    expect(result.poorFit).toBe(false);
    expect(t.source).toBe("manual");
    expect(t.rotDeg).toBeCloseTo(90, 6);
    expect(t.b.x).toBeCloseTo(100, 6);
    expect(t.b.y).toBeCloseTo(200, 6);
    expect(ViewportSyncAPI._session.points.a).toEqual(MATCHING_POINTS);
    expect(registration.evicted).toContain("a");
    expect(api(a).isEnabled()).toBe(true);
});

test("sync: an explicit automatic run replaces a hand-made alignment @unit", async () => {
    const { a } = await manuallyAlignedPair();
    ViewportSyncAPI._session.points.a = MATCHING_POINTS;
    const registration = stubRegistration(async () => ({
        A: [1, 0, 0, 1], b: { x: 9, y: -4 }, flip: false, confidence: 1,
    }));

    const result = await api(a).autoCalibrate();

    const t = ViewportSyncAPI._session.transforms.a;
    expect(result.mode).toBe("auto");
    expect(registration.estimate[0].force).toBe(true);
    expect(t.source).toBe("auto");
    expect(t.b).toEqual({ x: 9, y: -4 });
    expect(t.rotDeg).toBe(0);
    // The points described the manual alignment, not this one.
    expect(ViewportSyncAPI._session.points.a).toBe(undefined);
    expect(api(a).isEnabled()).toBe(true);
});

test("sync: a registration that lands after the session was cleared is not stored @unit", async () => {
    const ref = makeLiveViewer("ref"), a = makeLiveViewer("a");
    open(ref, a);
    let land;
    stubRegistration(() => new Promise((resolve) => { land = resolve; }));
    await api(ref).enable({ allowManual: false });

    const pending = api(a).enable({ mode: "auto", allowManual: false });
    api(ref).resetSession();
    land({ A: [1, 0, 0, 1], b: { x: 0, y: 0 }, confidence: 1 });

    await expect(pending).rejects.toThrow(/cancel/i);
    expect(ViewportSyncAPI._session).toBe(null);
    expect(api(a).isEnabled()).toBe(false);
    expect(linkContexts[0].subscribed).toEqual([]);
});

test("sync: a second request during a pick joins it instead of opening another picker @unit", async () => {
    const ref = makeLiveViewer("ref"), a = makeLiveViewer("a");
    open(ref, a);

    const first = api(a).enable({ mode: "manual" });
    const second = api(a).enable({ mode: "manual" });
    expect(second).toBe(first);
    expect(a.handlers["canvas-click"].length).toBe(1);

    api(a).cancelCalibration();
    await expect(first).rejects.toThrow(/cancel/i);
    expect(ViewportSyncAPI._session.leaderId).toBe(null);
});

test("sync: resuming an adjustment keeps the pose the viewer was left in @unit", async () => {
    const ref = makeLiveViewer("ref"), a = makeLiveViewer("a", 2000);
    open(ref, a);
    seedSession("ref", { ref: rotationTransform(0), a: rotationTransform(30, { x: 50, y: -20 }, 2) });
    await api(ref).enable({ allowManual: false });
    await api(a).enable({ allowManual: false });
    Object.assign(ref.state, { zoom: 2, center: { x: 0.4, y: 0.3 }, rotation: 10 });

    expect(api(a).beginAdjust()).toBe(true);
    expect(api(a).isAdjusting()).toBe(true);
    expect(api(a).isEnabled()).toBe(false);
    // The nudge: somewhere the old transform would never have put it.
    Object.assign(a.state, { zoom: 3.3, center: { x: 0.7, y: 0.1 }, rotation: -35 });

    expect(api(a).commitAdjust()).toBe(true);

    expect(api(a).isAdjusting()).toBe(false);
    expect(api(a).isEnabled()).toBe(true);
    expect(ViewportSyncAPI._session.transforms.a.source).toBe("adjusted");
    const mapped = api(a)._mapStateBetweenViewers(ref, a, ref.tools.readViewportState());
    expect(mapped.center.x).toBeCloseTo(0.7, 9);
    expect(mapped.center.y).toBeCloseTo(0.1, 9);
    expect(mapped.zoom).toBeCloseTo(3.3, 9);
    expect(mapped.rotation).toBeCloseTo(-35, 9);
    // ... and it still follows: a different reference pose maps elsewhere.
    Object.assign(ref.state, { center: { x: 0.5, y: 0.3 } });
    expect(api(a)._mapStateBetweenViewers(ref, a, ref.tools.readViewportState()).center.x)
        .not.toBeCloseTo(0.7, 3);
});

test("sync: discarding an adjustment restores the alignment and snaps back @unit", async () => {
    const ref = makeLiveViewer("ref"), a = makeLiveViewer("a");
    open(ref, a);
    seedSession("ref", { ref: rotationTransform(0), a: rotationTransform(30, { x: 50, y: -20 }) });
    await api(ref).enable({ allowManual: false });
    await api(a).enable({ allowManual: false });
    const before = JSON.stringify(ViewportSyncAPI._session.transforms.a);
    const synced = a.tools.readViewportState();

    api(a).beginAdjust();
    Object.assign(a.state, { zoom: 7, center: { x: 0.9, y: 0.9 }, rotation: 80 });
    expect(api(a).cancelAdjust()).toBe(true);

    expect(JSON.stringify(ViewportSyncAPI._session.transforms.a)).toBe(before);
    expect(api(a).isEnabled()).toBe(true);
    expect(a.state.zoom).toBeCloseTo(synced.zoom, 9);
    expect(a.state.rotation).toBeCloseTo(synced.rotation, 9);
    expect(a.state.center.x).toBeCloseTo(synced.center.x, 9);
});

test("sync: a viewer that opens another slide leaves the link @unit", async () => {
    const { ref, a } = await manuallyAlignedPair();

    a.uniqueId = "another-slide";
    api(a)._onSlideOpened();

    expect(api(a).isEnabled()).toBe(false);
    expect(linkContexts[0].subscribed).toEqual([ref]);
    expect(api(a).getRotationOffset()).toBe(0);
    // The alignment of the slide that left is remembered for when it returns.
    expect(ViewportSyncAPI._session.transforms.a).toBeTruthy();
});

test("sync: a double-click places one point, also when it would have been the last @unit", async () => {
    const { a } = await manuallyAlignedPair();

    const pending = api(a).enable({ mode: "manual", replace: true });
    const first = a.doubleClickImage(MATCHING_POINTS[0]);
    expect(api(a).getProgress()).toBe("1/3");
    expect(first.preventDefaultAction).toBe(true); // no zoom while placing landmarks

    a.clickImage(MATCHING_POINTS[1]);
    // Both clicks of this pair land before OSD reports the double: the pick
    // must not have finished on the duplicate.
    a.doubleClickImage(MATCHING_POINTS[2]);
    const result = await pending;

    expect(ViewportSyncAPI._session.points.a).toEqual(MATCHING_POINTS);
    expect(ViewportSyncAPI._session.transforms.a.rotDeg).toBeCloseTo(90, 6);
    expect(result.poorFit).toBe(false);
    expect(a.handlers["canvas-double-click"]).toEqual([]);
});

test("sync: points that do not agree are reported as a poor fit, and still link @unit", async () => {
    const { a } = await manuallyAlignedPair();

    const pending = api(a).enable({ mode: "manual", replace: true });
    // Second and third landmark swapped: no similarity fits that.
    for (const point of [MATCHING_POINTS[0], MATCHING_POINTS[2], MATCHING_POINTS[1]]) a.clickImage(point);
    const result = await pending;

    expect(result.poorFit).toBe(true);
    expect(api(a).isEnabled()).toBe(true);

    // A click a little off is ordinary and stays quiet.
    const again = api(a).enable({ mode: "manual", replace: true });
    const nearby = { x: MATCHING_POINTS[2].x + 15, y: MATCHING_POINTS[2].y - 10 };
    for (const point of [MATCHING_POINTS[0], MATCHING_POINTS[1], nearby]) a.clickImage(point);
    expect((await again).poorFit).toBe(false);
});
