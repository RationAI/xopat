import type {ScriptApiAssistantHints} from "./abstract-types";

/**
 * What the `visualization` namespace tells an assistant about itself
 * (`ScriptApiMetadata.assistant`). Consumers render it generically.
 */
export const VISUALIZATION_ASSISTANT_HINTS: ScriptApiAssistantHints = {
    // Appearance vocabulary counts as visualization intent: "the overlay is ugly",
    // "too dark", "hard to see" are shader-configuration requests, not analysis ones.
    intentPatterns: [
        /heat\s*map|overlay|colou?r\s*map|visuali[sz]|shader|layer|channel|opacity|render|palette|contrast|brightness|threshold|ugly|nicer?|prettier|washed|too (?:dark|bright|faint)|hard to see/i,
    ],
    /**
     * The ALWAYS-ON half: what a "visualization" IS in xOpat, and how to act on a request
     * about it. Unconditional because it fixes a misrouting, not a syntax problem: the
     * namespace is compact-by-default while the pathology playbook is always present and
     * tells the agent to establish stain and organ up front — so "the visualization is not
     * nice, improve it" was being answered with "what stain does it contain?". Kept short
     * so the ~19 KB demotion of the visualization declarations still pays for itself.
     */
    framing: `### What a "visualization" is here (read before answering anything about appearance)
- Each slide renders as a STACK: the **background** — the scan itself, passed through unchanged by an implicit \`identity\` shader unless configured otherwise — plus an optional **visualization**: a set of shader layers drawn over the data.
- "the visualization is not nice", "improve how the data is shown", "the overlay is washed out / too dark / unreadable", "use better colours" are **shader-configuration** requests. They are NOT image analysis. They do NOT require the stain, the marker, the specimen site, or any clinical context — do not ask for those here, and do not call \`pathology.setSlideContext\` on their account.
- Work it out in this order, stopping as soon as you can decide:
  1. What is rendered NOW — read it from the current-viewer-state block. It already lists every open viewer's active visualization and its layer types. Do not spend a script on it.
  2. What the data IS — \`visualization.describeData()\` for the sources and their metadata, \`visualization.probeData(dataReference)\` for the actual value range and distribution. Those two decide the shader type, the palette and the thresholds.
  3. Only if that is inconclusive — no channel information, no usable value range, or you need to judge how the current rendering LOOKS — call \`visualization.critiqueCurrentRendering()\`. It captures what the user sees and returns a short written critique. Treat its wording as evidence, not as your answer.
  4. Only if all of the above still leave a choice the data cannot settle, ask the user ONE bundled question.
- If the request names no viewer, apply to every open viewer that has data to show rather than asking which one. Say afterwards what you changed and where.
- Act, then report: apply the change and state in one line what was applied and how to adjust it. Do not describe a visualization you have not applied.`,
    /**
     * Workflow block: how to discover the shader-type vocabulary (so the model does not
     * invent names like `color-mapping`), one worked `colormap` example (the
     * most-attempted shader in past sessions), and the validation contract.
     */
    guidance: `### Visualization namespace — required workflow
- To choose a shader \`type\`, read \`visualization.getSchema()["x-shaderCatalog"]\` — a compact index of every type the renderer currently offers, each with a \`name\`, an \`intent\` ("pick this when…") and what it \`expects\` from the data. It is derived from the live renderer registry, so it is the authoritative list; conform to the schema exactly and never invent a type name.
- \`identity\` is the pass-through type: it shows the data as-is and is what the background already uses. Choosing it for an overlay means "render this source raw" — pick a mapping type (\`colormap\`, \`heatmap\`, \`gridheatmap\`, …) when the point is to make VALUES readable.
- Shader layer fields: \`id\`, \`type\`, a per-type \`params\` object, and ONE OF \`dataReferences: number[]\` (preferred — persisted form, indexes into \`config.data\`; the host resolves them at render time and can bind sources that are not yet loaded into the viewer world) or \`tiledImages: number[]\` (renderer form, concrete OSD world indices; only use after inspecting \`viewer.world\`). Prefer \`dataReferences\` so the visualization survives across sessions and works for not-yet-loaded data. Do NOT invent names like \`blendMode\`, \`color-mapping\`, \`colorMapping\`, \`source\`, etc. — they are not in the schema.
- For the canonical minimal layer for any type, read \`visualization.getSchema().$defs.shaderLayers.<type>.examples[0]\`. For cross-field invariants (e.g. colormap palette size vs threshold breaks), read \`.x-controlCouplings\` on that schema entry.
- The host validates every \`addVisualization\` / \`updateVisualizationAt\` / \`replaceVisualizations\` input against the schema and coupling rules BEFORE applying it, and a rejected input fails with precise JSON-pointer schema errors and coupling violations in the failure feedback. Call the mutating method directly and correct from the returned errors. \`visualization.validateProposedVisualization(viz)\` remains available when you want to iterate on a draft without triggering the user review dialog — and when you do use it, pass its \`normalized\` result to the mutating call instead of writing the config out a second time.
- Inside a layer's \`params\`, each control envelope is discriminated by its own \`type\` field (the SAME field name as the shader layer's \`type\`, just one nesting level deeper — context disambiguates). Do NOT use \`uiType\`.
- For the colormap envelope: \`default\` is the SELECTED palette name and \`mode\` constrains which palettes are valid. Pick \`mode\` to match the palette family — \`singlehue\` for single-colour ramps (Blues, Greens, Greys, Purples, Reds); \`sequential\` for perceptual ramps (Viridis, Plasma, Magma, Inferno, Turbo, Hot, YlGnBu, etc.); \`diverging\` for two-ended ramps (RdBu, BrBG, PiYG, Spectral, etc.); \`qualitative\` for categorical sets (Set1, Set2, Paired, Dark2, Accent, etc.). A \`default\` not in the chosen \`mode\`'s group is silently substituted with that mode's default and the user sees the wrong colour. Read \`visualization.getSchema()\` if unsure which group a palette belongs to.
- If the user declines the visualization review without sending feedback (the script error contains "declined the proposal without giving feedback"), do NOT silently retry with a different shader or palette. Ask the user one short clarifying question — what they wanted different — and only re-propose after they answer.
- Worked example (colormap rendering channel-0 intensity in Blues with two breaks → three steps):
  \`\`\`
  return await visualization.addVisualization({
    name: "Blue intensity overlay",
    shaders: { L1: {
      id: "L1", type: "colormap", dataReferences: [0],
      params: {
        color:     { type: "colormap", default: "Blues", steps: 3, mode: "singlehue" },
        threshold: { type: "advanced_slider", breaks: [0.33, 0.66] },
        connect: true,
      },
    } },
  }, { makeActive: true });
  \`\`\``,
};
