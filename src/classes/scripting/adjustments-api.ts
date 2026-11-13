import type {ScriptApiAssistantHints, ScriptApiMetadata} from "./abstract-types";
import type {
    AdjustmentDataItemInfo,
    AdjustmentSamplingMode,
    AdjustmentsScriptApi,
    AdjustmentType,
    AdjustmentValueMap,
} from "./adjustments-api.scripts";

import {XOpatScriptingApi} from "./abstract-api";
import {fetchDtsCached} from "./dts-fetch";

const ADJUSTMENTS_ASSISTANT_HINTS: ScriptApiAssistantHints = {
    intentPatterns: [
        /\b(bright(er|ness)?|dark(er|en)?|contrast|saturat\w*|desaturat\w*|gamma|levels?|white balance|warm(er)?|cool(er)?|hue|invert|washed out|too (dim|faint|pale|bright|dark)|fluorescen\w*|pixelat\w*|interpolat\w*)\b/i,
    ],
    framing: `### Display adjustments — use \`adjustments\`, not a new visualization
- "Brighter / darker / more contrast / less saturated / warmer / invert / auto levels" are adjustments of the existing layers: \`adjustments.setBackgroundAdjustments({...})\` for the slide itself, \`adjustments.setAdjustments(layerId, {...})\` for one overlay. Never rebuild a visualization for them.
- Read first: \`adjustments.listData()\` gives layers, current values and ids; \`adjustments.listAdjustmentTypes()\` the ranges. Change in small steps (brightness/contrast ±0.1–0.2) and only the keys asked for.
- "Auto" / "fix the exposure" → \`adjustments.autoLevels()\`. "Undo my changes" → \`adjustments.resetAdjustments()\`.
- If \`adjustments.isSupported()\` is false, say the renderer does not support adjustments yet; \`setSampling\` still works.`,
    examples: [
        "adjustments.setBackgroundAdjustments({ brightness: 0.15, contrast: 0.1 })",
        "await adjustments.autoLevels()",
        "adjustments.setSampling(adjustments.listData()[0].dataReference, \"fluorescence\")",
    ],
};

/**
 * The `adjustments` namespace: per-layer display adjustments and per-data-item sampling of
 * the context-bound viewer, over `APPLICATION_CONTEXT.adjustments`. Never `window.VIEWER`.
 */
export class XOpatAdjustmentsScriptApi extends XOpatScriptingApi implements AdjustmentsScriptApi {

    static ScriptApiMetadata: ScriptApiMetadata<XOpatAdjustmentsScriptApi> = {
        dtypesSource: {
            kind: "resolve",
            value: () => fetchDtsCached(APPLICATION_CONTEXT.url + "src/classes/scripting/adjustments-api.scripts.d.ts")
        },
        assistant: ADJUSTMENTS_ASSISTANT_HINTS,
    };

    constructor(namespace: string) {
        super(
            namespace,
            "Display Adjustments",
            "Live, undoable display adjustments of the active viewer: levels, brightness, contrast, saturation, hue, white balance and invert per shader layer (background or overlay), and how each data item is sampled (brightfield / fluorescence / pixelated). Select the viewer for this script context first with application.setActiveViewer()."
        );
    }

    protected get broker() {
        return APPLICATION_CONTEXT.adjustments;
    }

    protected requireLayer(layerId: string): string {
        const viewer = this.activeViewer;
        if (typeof layerId !== "string" || !this.broker.listLayers(viewer).some(l => l.id === layerId)) {
            throw new Error(`Unknown layer '${String(layerId)}'. Use adjustments.listData() for valid layer ids.`);
        }
        return layerId;
    }

    isSupported(): boolean {
        return this.broker.isSupported();
    }

    listAdjustmentTypes(): AdjustmentType[] {
        return this.broker.getDescriptors().map(d => ({
            key: d.key,
            label: $.t(d.labelKey),
            min: d.min,
            max: d.max,
            step: d.step,
            identity: d.identity,
            toggle: !!d.toggle,
        }));
    }

    listData(): AdjustmentDataItemInfo[] {
        const items = this.broker.list(this.activeViewer);
        // Layer names and data labels are usually the slide's file name — withheld data
        // unless the sensitive grant is present.
        const expose = this.mayExposeSensitive;
        return items.map((item, i) => ({
            dataReference: item.dataReference,
            role: item.role,
            label: expose ? item.label : `${item.role} ${i + 1}`,
            sampling: item.sampling,
            layers: item.layers.map((layer, j) => ({
                id: layer.id,
                title: expose ? layer.title : `${layer.role} layer ${j + 1}`,
                type: layer.type,
                role: layer.role,
                values: layer.values,
                adjusted: layer.adjusted,
            })),
        }));
    }

    getAdjustments(layerId: string): AdjustmentValueMap {
        return this.broker.get(this.activeViewer, this.requireLayer(layerId));
    }

    setAdjustments(layerId: string, values: AdjustmentValueMap): boolean {
        return this.broker.set(this.activeViewer, this.requireLayer(layerId), values || {});
    }

    setBackgroundAdjustments(values: AdjustmentValueMap): boolean {
        return this.broker.setBackground(this.activeViewer, values || {});
    }

    resetAdjustments(layerId?: string): void {
        const viewer = this.activeViewer;
        this.broker.reset(viewer, layerId === undefined ? undefined : this.requireLayer(layerId));
    }

    async autoLevels(layerId?: string): Promise<{ black: number; white: number } | null> {
        const viewer = this.activeViewer;
        if (layerId !== undefined) return this.broker.autoLevels(viewer, this.requireLayer(layerId));
        const background = this.broker.backgroundLayerIds(viewer);
        if (!background.length) return null;
        const range = await this.broker.autoLevels(viewer, background[0]!);
        if (range) this.broker.setBackground(viewer, range);
        return range;
    }

    setSampling(dataReference: number, mode: AdjustmentSamplingMode): boolean {
        const viewer = this.activeViewer;
        // Only data the bound viewer actually draws — a script must not reach other slides by index.
        const known = this.broker.list(viewer).some(item => item.dataReference === dataReference);
        if (!known) {
            throw new Error(`Data item ${String(dataReference)} is not shown in this viewer. Use adjustments.listData().`);
        }
        return this.broker.setSampling(dataReference, mode);
    }
}
