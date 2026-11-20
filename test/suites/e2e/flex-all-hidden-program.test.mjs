/**
 * Hiding every layer must still produce a program that links.
 *
 * `visible: 0` swaps a layer's GLSL body for a placeholder. Once a hand-written
 * four-layer visualization died mid-session with `'{' : syntax error` when its
 * last visible layer was hidden; the renderer now survives a failed rebuild
 * (`shader-program-failed` + xOpat's last-good snapshot in live-config-sync), but
 * that only turns "dead viewport" into "your change was not applied". The user
 * asked for nothing on screen, and that has to be a valid program.
 *
 * Covers the three spellings that reach the hidden branch: `0`, the string
 * `"0"` a URL- or form-sourced session carries, and a group whose children are
 * all hidden while the group itself is visible.
 */
import { test, expect, ensureSyntheticSlide } from "@xopat/test-harness";

const slide = ensureSyntheticSlide();

const visibleShaders = () => ({
    base: { type: "identity", dataReferences: [0] },
    tint: { type: "colormap", dataReferences: [0] },
    nested: {
        type: "group",
        shaders: {
            inner: { type: "identity", dataReferences: [0] },
        },
        order: ["inner"],
    },
});

const session = () => ({
    data: [slide.dataId],
    background: [{ dataReference: 0, name: "Synthetic", visualizationIndex: 0 }],
    visualizations: [{ name: "Layers", shaders: visibleShaders() }],
    params: {
        bypassCookies: true,
        bypassCache: true,
        disablePluginsAutoload: true,
        debugMode: false,
    },
});

/** Count program failures on the viewer's renderer from here on. */
const watchFailures = (xopat) => xopat.page.evaluate(() => {
    window.__programFailures = [];
    window.VIEWER.drawer.renderer.addHandler("shader-program-failed", (e) => {
        window.__programFailures.push(String(e?.error?.message || e?.error || "unknown"));
    });
});

const applyShaders = (xopat, shaders) => xopat.page.evaluate(async (next) => {
    const visualizations = JSON.parse(JSON.stringify(window.APPLICATION_CONTEXT.config.visualizations));
    visualizations[0].shaders = next;
    return window.APPLICATION_CONTEXT.openViewerWith(undefined, undefined, visualizations);
}, shaders);

/** Link status and placeholder count of the second-pass program, after a settle. */
const programState = (xopat) => xopat.page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const renderer = window.VIEWER.drawer.renderer;
    const program = renderer.getProgram(renderer.backend.secondPassProgramKey);
    const gl = program.gl;
    return {
        failures: window.__programFailures.slice(),
        linked: !!gl.getProgramParameter(program.webGLProgram, gl.LINK_STATUS),
        placeholders: (program.fragmentShader.match(/Disabled, hidden, or error placeholder/g) || []).length,
    };
});

const hideAll = (visible) => {
    const shaders = visibleShaders();
    shaders.base.visible = visible;
    shaders.tint.visible = visible;
    shaders.nested.shaders.inner.visible = visible;
    return shaders;
};

for (const [label, visible] of [["0", 0], ['"0"', "0"]]) {
    test(`every layer hidden (visible: ${label}) still links`, { tag: ["@synthetic", "@e2e"] }, async ({ xopat }) => {
        await xopat.launch(session());
        await xopat.waitForViewer();
        await watchFailures(xopat);

        expect(await applyShaders(xopat, hideAll(visible))).toBe(true);
        const state = await programState(xopat);
        expect(state.failures, "no shader-program-failed").toEqual([]);
        expect(state.linked, "second-pass program links").toBe(true);
        // base + tint at the top level; the group is visible, its only child is not.
        expect(state.placeholders).toBeGreaterThanOrEqual(2);

        // And back: the visible configuration must still link after the hidden one.
        expect(await applyShaders(xopat, visibleShaders())).toBe(true);
        const restored = await programState(xopat);
        expect(restored.failures).toEqual([]);
        expect(restored.linked).toBe(true);
    });
}
