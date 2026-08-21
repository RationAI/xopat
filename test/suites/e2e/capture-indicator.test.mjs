/**
 * Off-screen pixel reads must be visible.
 *
 * Analysis features render regions through the standalone drawer without moving the
 * viewport, so before the `region-capture` event nothing on screen (and nothing in any
 * log) said that a part of the slide had been read. These tests pin the two halves of
 * that contract: the visualization API announces every capture, and the core indicator
 * turns the announcement into a marker on the viewer that was read.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const session = (params = {}) => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic" }],
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
        // Long enough that the lifecycle tests are not racing the idle sweep; the
        // sweep itself gets its own test with a short window.
        captureIndicatorIdleMs: 60_000,
        ...params,
    },
});

test("a region render announces queued → start → end on its viewer", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const seen = await xopat.page.evaluate(async () => {
        const viewer = window.VIEWER;
        const events = [];
        viewer.addHandler("region-capture", e => events.push({
            captureId: e.captureId, phase: e.phase, kind: e.kind, label: e.label,
            region: e.region && { ...e.region },
        }));

        const api = window.APPLICATION_CONTEXT.Scripting.getApi("visualization").bindInvocationContext({
            scriptingContext: {
                id: "__capture_indicator_test__",
                getActiveViewerContextId: () => viewer.uniqueId,
                activeViewerContextId: viewer.uniqueId,
                isConsentDialogBypassed: () => true,
            },
        });
        // The render itself may legitimately fail in a headless GL context; the
        // announcement contract must hold either way, so the outcome is not asserted.
        try {
            await api.renderRegionPixels({
                region: { x: 0, y: 0, width: 256, height: 256 },
                size: { width: 64 },
                layers: "background",
                label: "unit: region probe",
            });
        } catch (e) { /* see above */ }
        return events;
    });

    const phases = seen.map(e => e.phase);
    expect(phases, "the capture announces itself before and after it runs").toContain("queued");
    expect(phases).toContain("end");

    const queued = seen.find(e => e.phase === "queued");
    expect(queued.kind).toBe("region");
    expect(queued.label, "the caller's diagnostic label rides along").toBe("unit: region probe");
    expect(queued.region, "the region is echoed in level-0 image pixels").toEqual({ x: 0, y: 0, width: 256, height: 256 });
    // One capture, one id — the indicator relies on this to pair start with end.
    expect(new Set(seen.map(e => e.captureId)).size).toBe(1);
});

test("the indicator draws a marker per capture and keeps a trail", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const viewer = window.VIEWER;
        const indicator = window.APPLICATION_CONTEXT.captureIndicator;
        indicator.setMode("trail");
        indicator.clear(viewer);

        const fire = (phase, extra = {}) => viewer.raiseEvent("region-capture", {
            captureId: "test-1", phase, kind: "region", refIndex: 0,
            region: { x: 10, y: 10, width: 200, height: 120 },
            label: "unit: marker", ...extra,
        });

        fire("queued");
        const queuedMarkers = document.querySelectorAll(".xo-capture-rect.is-queued").length;
        fire("start");
        const activeMarkers = document.querySelectorAll(".xo-capture-rect.is-active").length;
        fire("end", { ok: true });
        const doneMarkers = document.querySelectorAll(".xo-capture-rect.is-done").length;

        // A repeat read of the same box must reuse the marker, not stack a second one.
        for (const phase of ["queued", "start"]) {
            viewer.raiseEvent("region-capture", {
                captureId: "test-2", phase, kind: "region", refIndex: 0,
                region: { x: 10, y: 10, width: 200, height: 120 }, label: "unit: marker",
            });
        }
        viewer.raiseEvent("region-capture", {
            captureId: "test-2", phase: "end", kind: "region", refIndex: 0,
            region: { x: 10, y: 10, width: 200, height: 120 }, label: "unit: marker", ok: true,
        });
        const afterRepeat = document.querySelectorAll(".xo-capture-rect").length;
        const log = indicator.getLog(viewer);

        indicator.setMode("off");
        const afterOff = document.querySelectorAll(".xo-capture-rect").length;
        indicator.setMode("trail");

        return { queuedMarkers, activeMarkers, doneMarkers, afterRepeat, log, afterOff };
    });


    expect(result.queuedMarkers, "a queued capture is already visible").toBe(1);
    expect(result.activeMarkers, "admission flips the marker to active").toBe(1);
    expect(result.doneMarkers, "the finished capture stays as a trail outline").toBe(1);
    expect(result.afterRepeat, "re-reading the same region reuses one marker").toBe(1);
    expect(result.log).toHaveLength(1);
    expect(result.log[0].label).toBe("unit: marker");
    expect(result.log[0].hits, "the reuse is counted, not lost").toBe(2);
    expect(result.afterOff, "switching the indicator off removes every marker").toBe(0);
});

test("markers do not survive a slide change", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const remaining = await xopat.page.evaluate(async () => {
        const viewer = window.VIEWER;
        const indicator = window.APPLICATION_CONTEXT.captureIndicator;
        indicator.setMode("trail");
        for (const phase of ["queued", "start"]) {
            viewer.raiseEvent("region-capture", {
                captureId: "stale-1", phase, kind: "region", refIndex: 0,
                region: { x: 0, y: 0, width: 128, height: 128 }, label: "unit: stale",
            });
        }
        viewer.raiseEvent("region-capture", {
            captureId: "stale-1", phase: "end", kind: "region", refIndex: 0,
            region: { x: 0, y: 0, width: 128, height: 128 }, label: "unit: stale", ok: true,
        });

        // Region coordinates belong to the source that was read; a slide swap invalidates them.
        viewer.raiseEvent("close", {});
        return {
            markers: document.querySelectorAll(".xo-capture-rect").length,
            log: indicator.getLog(viewer).length,
        };
    });

    expect(remaining.markers).toBe(0);
    expect(remaining.log).toBe(0);
});

test("markers clear themselves once capturing goes idle, the log does not", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session({ captureIndicatorIdleMs: 300 }));
    await xopat.waitForViewer();

    const drawn = await xopat.page.evaluate(() => {
        const viewer = window.VIEWER;
        window.APPLICATION_CONTEXT.captureIndicator.setMode("trail");
        for (const phase of ["queued", "start", "end"]) {
            viewer.raiseEvent("region-capture", {
                captureId: "idle-1", phase, kind: "region", refIndex: 0,
                region: { x: 5, y: 5, width: 100, height: 100 }, label: "unit: idle", ok: true,
            });
        }
        return document.querySelectorAll(".xo-capture-rect").length;
    });
    expect(drawn, "the marker is drawn while the run is fresh").toBe(1);

    // The idle sweep fades before it unmounts, so poll rather than sleeping a fixed span.
    await expect.poll(
        () => xopat.page.evaluate(() => document.querySelectorAll(".xo-capture-rect").length),
        { message: "the trail is removed once nothing is capturing" }
    ).toBe(0);

    const log = await xopat.page.evaluate(() =>
        window.APPLICATION_CONTEXT.captureIndicator.getLog(window.VIEWER));
    expect(log, "clearing the markers must not erase the audit record").toHaveLength(1);
    expect(log[0].label).toBe("unit: idle");
});

test("a whole-slide capture flashes but is never trailed", { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
    await xopat.launch(session());
    await xopat.waitForViewer();

    const result = await xopat.page.evaluate(async () => {
        const viewer = window.VIEWER;
        const indicator = window.APPLICATION_CONTEXT.captureIndicator;
        indicator.setMode("trail");
        indicator.clear(viewer);

        // Exactly what exploreSlide's orientation pass reads: the entire slide.
        const item = viewer.world.getItemAt(0);
        const size = item.getContentSize();
        const whole = { x: 0, y: 0, width: size.x, height: size.y };
        for (const phase of ["queued", "start", "end"]) {
            viewer.raiseEvent("region-capture", {
                captureId: "survey-1", phase, kind: "region", refIndex: 0,
                region: whole, label: "unit: survey", ok: true,
            });
        }
        const duringFlash = document.querySelectorAll(".xo-capture-rect").length;
        // Longer than FLASH_LINGER_MS (900ms) in capture-indicator.ts.
        await new Promise(resolve => setTimeout(resolve, 1400));
        return {
            duringFlash,
            afterFlash: document.querySelectorAll(".xo-capture-rect").length,
            log: indicator.getLog(viewer),
        };
    });

    expect(result.duringFlash, "the survey pass is still announced while it runs").toBe(1);
    expect(result.afterFlash, "a full-slide rectangle must not linger over the viewer").toBe(0);
    expect(result.log, "it is still recorded").toHaveLength(1);
    expect(result.log[0].label).toBe("unit: survey");
});
