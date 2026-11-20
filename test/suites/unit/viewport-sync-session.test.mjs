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
 *    is dropped instead of pointing at a viewer that does not exist.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const linkContexts = {};
globalThis.OpenSeadragon = {
    Tools: { _linkContexts: linkContexts },
};
globalThis.VIEWER_MANAGER = { viewers: [] };

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
