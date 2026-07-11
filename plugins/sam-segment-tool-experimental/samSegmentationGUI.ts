/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

import { SAMInference } from "./samInference";
// Side-effect: defines and attaches OSDAnnotations.SegmentAnythingState.
import "./samState";

/**
 * Host plugin for the Segment Anything annotation tool.
 *
 * It owns the SAM inference engine (composition) and registers the SAM
 * annotation mode with the annotations module. The gui_annotations toolbar
 * auto-discovers any registered custom mode and renders its button +
 * mode-options panel, so there is no toolbar/DOM code here. Shared viewport
 * capture + mask→polygon tracing live in the pathology-foundation module, which
 * SAM delegates to and also registers a local segmentation driver with.
 *
 * @class SAMSegmentationPlugin
 * @extends XOpatPlugin
 */
class SAMSegmentationPlugin extends (XOpatPlugin as any) {
    private context: any;
    // Public: the annotation mode + the mode-options inline handlers resolve the
    // engine via `plugin('sam-segment-tool-experimental').sam`.
    sam: any;

    constructor(id: string) {
        super(id);
    }

    async pluginReady(): Promise<void> {
        const OSDAnnotationsRef: any = (window as any).OSDAnnotations;
        this.context = OSDAnnotationsRef?.instance?.();

        if (!this.context) {
            console.error("SAM: OSDAnnotations module not available.");
            return;
        }

        // Build the inference engine before registering the mode/driver — both
        // read it back via `plugin('sam-segment-tool-experimental').sam`.
        this.sam = new SAMInference(this);

        // Register only once the annotations GUI plugin is present — it hosts
        // the toolbar that surfaces the mode. Without it there is no way to
        // activate the mode anyway.
        this.integrateWithPlugin("gui_annotations", () => {
            if (!this.context.Modes["SAM_SEGMENTATION"]) {
                this.context.setCustomModeUsed("SAM_SEGMENTATION", OSDAnnotationsRef.SegmentAnythingState);
            }
        });

        // Expose in-browser SAM as a local driver implementing the `segment`
        // feature, so an agent can request a prompt/point-driven mask offline.
        // SAM is point-prompted; the foundation passes a seed point (defaulting
        // to the view centre when the caller gives none).
        this._registerPathologyDriver();
    }

    private _registerPathologyDriver(): void {
        const pathology = (window as any).singletonModule?.("pathology-foundation");
        if (!pathology?.registerDriver) return;

        const sam = this.sam;
        pathology.registerDriver({
            id: "sam-local",
            label: "Segment Anything (in-browser)",
            local: true,
            features: {
                "segment": async (input: any) => {
                    if (sam.selectedComputationDevice === "Client") {
                        await sam.loadSelectedModel();
                    } else {
                        await sam.probeServer(sam.selectedComputationDevice);
                    }
                    // The foundation supplies background pixels + a lazy PNG blob and,
                    // when the caller gave one, a seed point already in render pixels;
                    // otherwise segment the view centre.
                    const click = input.point || { x: Math.round(input.width / 2), y: Math.round(input.height / 2) };
                    const blob = await input.toBlob();
                    return await sam.runInference(blob, click);
                },
            },
        });
    }
}

addPlugin("sam-segment-tool-experimental", SAMSegmentationPlugin as any);

export {};
