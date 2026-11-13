/**
 * A visualization review is about ONE visualization, and with several viewers open it is
 * not the first one selected.
 *
 * The proposal's `activeVisualizationIndex` is per viewer. The playground reads "the active
 * visualization" as the first integer in it, so a change to the third viewer's
 * visualization was previewed as the FIRST viewer's visualization drawn over the third
 * viewer's slide — and on accept that object was written back over the reviewed index.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

const { reviewVisualizationProposal } =
    await import("../../../src/classes/scripting/visualization-review.ts");

const viz = (name) => ({ name, shaders: { layer: { type: "identity" } } });

/** Three viewers showing visualizations 1, 2 and 4; the change is to #4. */
const proposal = () => ({
    data: [],
    visualizations: [viz("zero"), viz("fluorescence"), viz("two"), viz("three"), viz("dicom overlays")],
    activeVisualizationIndex: [1, 2, 4],
});

test("the playground is shown the visualization under review, not the first viewer's @unit", async () => {
    let seen;
    globalThis.window.PLAYGROUND = {
        open: async (init) => {
            seen = init.source;
            // What the page hands back: the visualization it was told is active.
            const active = init.source.snapshot.visualizations[init.source.snapshot.activeVisualizationIndex[0]];
            init.actions.find(a => a.id === "accept").onClick({
                activePage: { getVisualization: () => ({ ...active, edited: true }) },
                closeModal() {},
            });
            return { actionId: "accept" };
        },
    };

    const decision = await reviewVisualizationProposal(
        { world: { getItemCount: () => 0 } }, proposal(), async () => true, { targetIndex: 4 });

    expect(seen.visualization.name).toBe("dicom overlays");
    expect(seen.snapshot.activeVisualizationIndex).toEqual([4]);

    expect(decision.decision).toBe("accept");
    const applied = decision.appliedSnapshot;
    // The edit lands on the reviewed index...
    expect(applied.visualizations[4].name).toBe("dicom overlays");
    expect(applied.visualizations[4].edited).toBe(true);
    // ...the first viewer's visualization is untouched, and so is everyone's selection.
    expect(applied.visualizations[1]).toEqual(viz("fluorescence"));
    expect(applied.activeVisualizationIndex).toEqual([1, 2, 4]);

    delete globalThis.window.PLAYGROUND;
});
