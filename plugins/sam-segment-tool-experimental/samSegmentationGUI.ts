/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />

/**
 * Thin host plugin for the Segment Anything annotation tool.
 *
 * All it does is register the SAM annotation mode with the annotations module.
 * The gui_annotations toolbar auto-discovers any registered custom mode and
 * renders its button + mode-options panel, so there is no toolbar/DOM code
 * here. Inference + UI live in the `sam-segmentation-experimental` module.
 *
 * @class SAMSegmentationPlugin
 * @extends XOpatPlugin
 */
class SAMSegmentationPlugin extends (XOpatPlugin as any) {
    private context: any;
    private sam: any;

    constructor(id: string) {
        super(id);
    }

    async pluginReady(): Promise<void> {
        const OSDAnnotationsRef: any = (window as any).OSDAnnotations;
        this.context = OSDAnnotationsRef?.instance?.();
        this.sam = (window as any).SAMInference?.instance?.();

        if (!this.context || !this.sam) {
            console.error("SAM: OSDAnnotations or SAMInference module not available.");
            return;
        }

        // Register only once the annotations GUI plugin is present — it hosts
        // the toolbar that surfaces the mode. Without it there is no way to
        // activate the mode anyway.
        this.integrateWithPlugin("gui_annotations", () => {
            if (!this.context.Modes["SAM_SEGMENTATION"]) {
                this.context.setCustomModeUsed("SAM_SEGMENTATION", OSDAnnotationsRef.SegmentAnythingState);
            }
        });
    }
}

addPlugin("sam-segment-tool-experimental", SAMSegmentationPlugin as any);

export {};
