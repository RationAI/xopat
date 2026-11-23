/**
 * A lock the user places has to be felt on the canvas, and lifted again.
 *
 * The padlock used to write `private`, which only the export filter read: the lock
 * locked nothing. Now `locked` has a default meaning — the annotation drops out of
 * hit-testing so the user can draw straight over it, and every mutation is refused
 * at the IO checkpoint — while `readOnly` keeps the one thing it always meant:
 * imposed, and not liftable here.
 *
 * Two things in here are load-bearing and easy to break:
 *
 *   - `evented` must stay TRUE. fabric's `_shouldClearSelection` discards the
 *     active object whenever the pointer sits on a non-evented target, and
 *     `findTarget` consults the active object's controls first — so `evented =
 *     false` would kill the selection, and with it the toolbar carrying the
 *     padlock, on the very click meant to release the lock.
 *   - the lock toggle is the one mutation a *releasable* lock lets through. Gated
 *     on `releasable` and not on the kind alone, or anyone could clear `readOnly`.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

test.describe.configure({ timeout: 300_000 });

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    plugins: { gui_annotations: {} },
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

async function withAnnotationsReady(xopat) {
    await xopat.launch(session());
    await xopat.waitForViewer();
    await xopat.page.waitForFunction(() => {
        if (!window.OSDAnnotations?.instance?.()?.getFabric?.(window.VIEWER)) return false;
        const loader = document.getElementById("fullscreen-loader");
        return !loader || !loader.isConnected || getComputedStyle(loader).display === "none";
    }, null, { timeout: 120_000 });
}

/** One polygon on the canvas, plus the handles the assertions need. */
const setup = () => {
    const module = window.OSDAnnotations.instance();
    const fabricWrapper = module.getFabric(window.VIEWER);
    const polygon = module.getAnnotationObjectFactory("polygon");
    const preset = module.presets.addPreset(undefined, "lock-test", "#00a0ff", polygon);
    module.presets.selectPreset(preset.presetID, true);

    const viewport = window.VIEWER.viewport;
    const c = viewport.viewportToImageCoordinates(viewport.getCenter(true));
    const object = polygon.create(
        [{ x: c.x - 200, y: c.y }, { x: c.x, y: c.y - 200 }, { x: c.x + 200, y: c.y }],
        module.presets.getAnnotationOptions(true),
    );
    fabricWrapper.addAnnotation(object);
    return { module, fabricWrapper, object };
};

/** Install the two helpers above on the page, once the app is up. */
async function withLockHelpers(xopat) {
    await withAnnotationsReady(xopat);
    await xopat.page.evaluate(`window.__lockSetup = ${setup.toString()}; window.__lockFlags = ${flags.toString()};`);
}

const flags = (object) => ({
    locked: !!object.locked,
    evented: !!object.evented,
    selectable: !!object.selectable,
    hitTestBlocked: !!object.__hitTestBlocked,
    hasControls: !!object.hasControls,
});

test("locking takes the annotation out of hit-testing without dropping the selection", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withLockHelpers(xopat);

    const result = await xopat.page.evaluate(() => {
        const { module, fabricWrapper, object } = window.__lockSetup();
        const before = window.__lockFlags(object);

        const accepted = fabricWrapper.setAnnotationLocked(object, true);
        const after = window.__lockFlags(object);
        const state = module.getAnnotationLockState(object);

        return { accepted, before, after, state: { ...state, reason: state.reason } };
    });

    expect(result.accepted, "the lock was committed").toBe(true);
    expect(result.before.selectable, "it was an ordinary, selectable annotation").toBe(true);
    expect(result.before.hitTestBlocked).toBe(false);

    expect(result.after.locked).toBe(true);
    expect(result.after.hitTestBlocked, "so a press over it draws instead of grabbing it").toBe(true);
    expect(result.after.selectable, "and it cannot be picked up by a rubber band").toBe(false);
    expect(result.after.evented, "but it stays evented - see the file comment").toBe(true);
    expect(result.after.hasControls, "and keeps its controls, which carry the padlock").toBe(true);
    expect(result.state.mutable).toBe(false);
    expect(result.state.releasable, "the user placed it, so the user may lift it").toBe(true);
});

test("a click on a locked annotation selects it instead of doing nothing", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    // Out of the hit-test, a locked shape used to swallow the click silently: no
    // selection, no toolbar, no padlock — indistinguishable from a broken canvas,
    // and the lock could only be lifted from the board.
    await withLockHelpers(xopat);

    const id = await xopat.page.evaluate(() => {
        const { fabricWrapper, object } = window.__lockSetup();
        fabricWrapper.setAnnotationLocked(object, true);
        fabricWrapper.clearAnnotationSelection(true);
        window.__lockTestObject = object;
        return object.incrementId;
    });

    await xopat.page.waitForFunction(() => !window.VIEWER.isAnimating?.(), null, { timeout: 30_000 });
    const points = await xopat.page.evaluate(() => {
        const viewport = window.VIEWER.viewport;
        const c = viewport.viewportToImageCoordinates(viewport.getCenter(true));
        const toScreen = (ix, iy) => {
            const p = viewport.imageToWindowCoordinates(new window.OpenSeadragon.Point(ix, iy));
            return { x: Math.round(p.x), y: Math.round(p.y) };
        };
        // Inside the triangle `__lockSetup` draws, and well clear of it.
        return { inside: toScreen(c.x, c.y - 60), outside: toScreen(c.x, c.y + 300) };
    });

    const clickAt = async (at) => {
        await xopat.page.mouse.move(at.x, at.y);
        await xopat.page.mouse.down();
        await xopat.page.mouse.up();
        await xopat.page.waitForTimeout(200);
    };
    const read = () => xopat.page.evaluate(() => {
        const fabricWrapper = window.OSDAnnotations.instance().getFabric(window.VIEWER);
        const object = window.__lockTestObject;
        return {
            selected: (fabricWrapper.getSelectedAnnotations() || []).map((o) => o.incrementId),
            active: fabricWrapper.canvas.getActiveObject() === object,
            hitTestBlocked: !!object.__hitTestBlocked,
            locked: !!object.locked,
        };
    });

    await clickAt(points.inside);
    const onShape = await read();
    expect(onShape.selected, "the locked annotation under the click is selected").toEqual([id]);
    expect(onShape.active, "as the active object, which is what draws its toolbar and padlock").toBe(true);
    expect(onShape.hitTestBlocked, "while a press over it still passes through").toBe(true);
    expect(onShape.locked, "and selecting it released nothing").toBe(true);

    await clickAt(points.outside);
    expect((await read()).selected, "a click elsewhere lets go of it again").toEqual([]);
});

test("a locked annotation refuses mutation but accepts its own release",{ tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withLockHelpers(xopat);

    const result = await xopat.page.evaluate(() => {
        const { module, fabricWrapper, object } = window.__lockSetup();
        fabricWrapper.setAnnotationLocked(object, true);

        // How entering edit mode asks (annotations-canvas.js::beginSelectionEdit).
        const editStart = module.annotationResource.canUpdate(
            object.incrementId, object, { kind: "edit-start", object }, { surface: false },
        );
        const presetChange = module.annotationResource.canUpdate(
            object.incrementId, { presetID: "whatever" },
            { kind: "preset-change", object }, { surface: false },
        );
        const deletion = module.annotationResource.canDelete(
            object.incrementId, { kind: "delete", object }, { surface: false },
        );

        const released = fabricWrapper.setAnnotationLocked(object, false);
        return {
            editStart: { ok: !!editStart?.ok, code: editStart?.code },
            presetChange: { ok: !!presetChange?.ok },
            deletion: { ok: !!deletion?.ok },
            released,
            flagsAfterRelease: window.__lockFlags(object),
        };
    });

    expect(result.editStart.ok, "entering edit mode is refused").toBe(false);
    expect(result.editStart.code, "with the lock's own code").toBe("W_ANNOTATION_LOCKED");
    expect(result.presetChange.ok, "so is a preset change").toBe(false);
    expect(result.deletion.ok, "and deletion").toBe(false);

    expect(result.released, "yet the lock toggle itself goes through").toBe(true);
    expect(result.flagsAfterRelease.locked).toBe(false);
    expect(result.flagsAfterRelease.hitTestBlocked, "and the annotation answers the canvas again").toBe(false);
    expect(result.flagsAfterRelease.selectable).toBe(true);
});

test("an imposed read-only lock cannot be released by the user", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withLockHelpers(xopat);

    const result = await xopat.page.evaluate(() => {
        const { module, fabricWrapper, object } = window.__lockSetup();

        // What `empaia-workbench` does to a job's output while hydrating.
        fabricWrapper.setAnnotationReadOnly(object, true);
        const imposed = module.getAnnotationLockState(object);
        const flagsImposed = window.__lockFlags(object);

        // The user tries to take it over with their own lock, then to clear it.
        const lockAttempt = fabricWrapper.setAnnotationLocked(object, true);
        const unlockAttempt = fabricWrapper.setAnnotationLocked(object, false);

        return {
            imposed: { locked: imposed.locked, interactive: imposed.interactive, mutable: imposed.mutable, releasable: imposed.releasable, code: imposed.code },
            flagsImposed,
            lockAttempt,
            unlockAttempt,
            stillLocked: !!object.readOnly,
            ownLockFlag: !!object.locked,
        };
    });

    expect(result.imposed.locked).toBe(true);
    expect(result.imposed.mutable).toBe(false);
    expect(result.imposed.releasable).toBe(false);
    expect(result.imposed.code, "read-only keeps the code integrations document").toBe("W_ANNOTATION_READONLY");
    expect(result.flagsImposed.selectable, "unchanged: it is inspected and commented on").toBe(true);
    expect(result.flagsImposed.hitTestBlocked).toBe(false);

    expect(result.lockAttempt, "no lock-change passes on a non-releasable lock").toBe(false);
    expect(result.unlockAttempt).toBe(false);
    expect(result.ownLockFlag).toBe(false);
    expect(result.stillLocked, "the imposed lock is untouched").toBe(true);
});

test("a lock policy redefines the lock for the whole canvas", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    await withLockHelpers(xopat);

    const result = await xopat.page.evaluate(() => {
        const { module, fabricWrapper, object } = window.__lockSetup();
        fabricWrapper.setAnnotationLocked(object, true);
        const byDefault = window.__lockFlags(object);

        // An integration whose locked records must stay clickable, and whose locks
        // the user may not lift.
        const dispose = module.registerLockPolicy("integration-test",
            () => ({ interactive: true, releasable: false }));
        const underPolicy = window.__lockFlags(object);
        const refusedRelease = fabricWrapper.setAnnotationLocked(object, false);

        dispose();
        return { byDefault, underPolicy, refusedRelease, restored: window.__lockFlags(object) };
    });

    expect(result.byDefault.hitTestBlocked).toBe(true);
    // registerLockPolicy re-derives interactivity, so this needed no extra call.
    expect(result.underPolicy.hitTestBlocked, "the policy put it back into hit-testing").toBe(false);
    expect(result.underPolicy.selectable).toBe(true);
    expect(result.refusedRelease, "and the user can no longer release it").toBe(false);
    expect(result.restored.hitTestBlocked, "disposing restores the default meaning").toBe(true);
});

test("the toggle is measured against the resolved lock, not the raw flag", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    // `setAnnotationLocked` short-circuited on `!!annotation.locked === value`
    // while every caller computes `value` from the RESOLVED state
    // (`setAnnotationLocked(target, !lock.locked)`). So a policy that locks an
    // annotation whose own flag is clear — the whole point of the hook — made the
    // padlock and the menu entry dead: `false` returned, no event, no change.
    await withLockHelpers(xopat);

    const result = await xopat.page.evaluate(() => {
        const { module, fabricWrapper, object } = window.__lockSetup();
        const events = [];
        const onChange = (e) => events.push(!!e.locked);
        fabricWrapper.addHandler("annotation-lock-change", onChange);

        // "every annotation here is locked by the integration, and the user may lift it"
        const dispose = module.registerLockPolicy("resolved-state-test",
            () => ({ locked: true, mutable: false, releasable: true }));
        const resolved = module.getAnnotationLockState(object);
        const rawFlag = !!object.locked;

        // What the padlock does: !lock.locked → false.
        const release = fabricWrapper.setAnnotationLocked(object, false);
        // And asking for what the resolved state already says is still a no-op.
        const redundant = fabricWrapper.setAnnotationLocked(object, true);

        dispose();
        fabricWrapper.removeHandler("annotation-lock-change", onChange);
        return { resolved: { locked: resolved.locked, releasable: resolved.releasable }, rawFlag, release, redundant, events };
    });

    expect(result.rawFlag, "the annotation's own flag was never set").toBe(false);
    expect(result.resolved.locked, "but the policy says it is locked").toBe(true);
    expect(result.release, "so releasing it is real work, not a no-op").toBe(true);
    expect(result.events, "and it announced itself exactly once").toEqual([false]);
    expect(result.redundant, "while locking what is already locked still short-circuits").toBe(false);
});

test("double-clicking the padlock toggles the lock once", { tag: ["@synthetic", "@integration"] }, async ({ xopat }) => {
    // Each release of a double-click used to dispatch the slot again, so a user who
    // double-clicks out of habit locked and unlocked in one gesture: no visible change,
    // and an annotation they believed was protected.
    await withLockHelpers(xopat);
    await xopat.page.waitForFunction(() => !window.VIEWER.isAnimating?.(), null, { timeout: 30_000 });

    await xopat.page.evaluate(() => {
        const { fabricWrapper, object } = window.__lockSetup();
        window.__lockTestObject = object;
        window.__lockEvents = [];
        // While navigating, presses are pointer events with no click count, so the
        // canvas times them itself. Four CDP round-trips under a parallel run do not
        // fit the real interval; widen it so the gesture, not the transport, decides.
        fabricWrapper.constructor.DOUBLE_PRESS_MS = 60_000;
        fabricWrapper.addHandler("annotation-lock-change", (e) => window.__lockEvents.push(!!e.locked));
        fabricWrapper.selectAnnotation(object, false, true);
        fabricWrapper.canvas.renderAll();
    });

    // The pill records where it was drawn (`_lastLeft`/`_lastTop`, canvas-element space)
    // and its click zones (pill-local x); together they say where the padlock is.
    const padlock = await xopat.page.evaluate(() => {
        const fabricWrapper = window.OSDAnnotations.instance().getFabric(window.VIEWER);
        const control = window.__lockTestObject.controls.toolbar;
        const zone = (control._zones || []).find((z) => z.id === "lock");
        if (!zone || control._lastLeft == null) return null;
        const box = fabricWrapper.canvas.upperCanvasEl.getBoundingClientRect();
        return {
            x: Math.round(box.x + control._lastLeft + (zone.x0 + zone.x1) / 2),
            y: Math.round(box.y + control._lastTop),
        };
    });
    expect(padlock, "the selected annotation drew its toolbar with a padlock").not.toBeNull();

    await xopat.page.mouse.move(padlock.x, padlock.y);
    await xopat.page.mouse.down({ clickCount: 1 });
    await xopat.page.mouse.up({ clickCount: 1 });
    await xopat.page.mouse.down({ clickCount: 2 });
    await xopat.page.mouse.up({ clickCount: 2 });
    await xopat.page.waitForTimeout(250);

    const result = await xopat.page.evaluate(() => ({
        locked: !!window.__lockTestObject.locked,
        events: window.__lockEvents.slice(),
    }));
    expect(result.events, "the lock changed once, not on and off again").toEqual([true]);
    expect(result.locked, "so the annotation ends up locked").toBe(true);
});
