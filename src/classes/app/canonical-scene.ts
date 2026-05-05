/**
 * Canonical scene serialize / deserialize.
 *
 * One JSON shape that fully describes a viewer session, plus a round-trip
 * pair (`serialize` ↔ `deserialize`) used by playground Apply, session
 * sync's heavy-apply path, scripting, and draft persistence. Replaces the
 * earlier ad-hoc helpers (each of which knew only part of the surface and
 * disagreed on the structural form of bg shaders).
 *
 * Key invariant: bg shader configs are an ordered ARRAY in the structural
 * cfg form (`cfg.background[i].shaders[j]`), but the renderer keys them
 * by derived ids — `bgRef.id` for index 0, `${bgRef.id}-N` for subsequent
 * entries (mirrors `assemble-render-output.ts:149-150`). This module is
 * the single source of truth for that mapping; all callers go through
 * `backgroundShaderRendererIds` instead of recomputing it.
 *
 * Implicit-identity rule: when `bg.shaders` is unset, the renderer
 * synthesizes `[{ type: "identity" }]` keyed under `bg.id`
 * (`assemble-render-output.ts:117-119`). Edits to that implicit shader
 * survive the round-trip only if `mergeBackgroundFromLive` materializes
 * a structural entry; otherwise the new bg is byte-for-byte equal to the
 * old one and `openViewerWith`'s diff-detector skips the rebuild. The
 * materialization path lives here — keep it in lockstep with the
 * defaulting in `assemble-render-output.ts`.
 *
 * Structural append: when the renderer holds layers past
 * `bg.shaders.length` (user added shader entries via UI), the merger
 * appends fresh structural entries so the new shape persists.
 *
 * Round-trip: serialize merges per-shader runtime cache/state from
 * `UTILITIES.exportLiveVisualization` back into a deep-clone of the
 * structural cfg. deserialize hands the result to
 * `APPLICATION_CONTEXT.openViewerWith` — `assembleBackgroundShaders`
 * inlines the cache into renderOutput, so the renderer initializes from
 * it on rebuild without any second per-layer apply pass.
 */

export interface CanonicalShader {
    type: string;
    id?: string;
    cache?: any;
    params?: any;
    visible?: number;
    dataReferences?: number[];
    shaders?: Record<string, CanonicalShader>;
    [k: string]: any;
}

export interface CanonicalBackground {
    id: string;
    dataReference: number | string;
    protocol?: string;
    name?: string;
    options?: any;
    goalIndex?: number;
    /** Ordered array; renderer ids are derived (see backgroundShaderRendererIds). */
    shaders: CanonicalShader[];
    [k: string]: any;
}

export interface CanonicalVisualization {
    id?: string;
    name?: string;
    /** Object keyed by explicit shader id. */
    shaders: Record<string, CanonicalShader>;
    order?: string[];
    [k: string]: any;
}

export interface CanonicalViewerOverlay {
    uniqueId: string;
    viewport?: { zoom: number; point: { x: number; y: number }; rotation: number };
}

export interface CanonicalScene {
    version: 1;
    data: any[];
    background: CanonicalBackground[];
    visualizations: CanonicalVisualization[];
    activeBackgroundIndex?: Array<number | undefined>;
    activeVisualizationIndex?: Array<number | undefined>;
    viewers?: CanonicalViewerOverlay[];
}

type LivePayload = {
    layerOrder?: string[];
    layers?: Record<string, { id?: string; type?: string; cache?: any; state?: any }>;
};

// ---------------------------------------------------------------------------
// Renderer-id derivation — the single source of truth.
// MUST mirror src/classes/app/assemble-render-output.ts:149-150 exactly.

export function backgroundShaderRendererIds(bg: { id: string; shaders?: any }): string[] {
    const out: string[] = [];
    const shaders = bg?.shaders;
    if (!Array.isArray(shaders) || !bg?.id) return out;
    for (let i = 0; i < shaders.length; i++) {
        out.push(i === 0 ? bg.id : `${bg.id}-${i}`);
    }
    return out;
}

export function visualizationShaderRendererIds(viz: { shaders?: Record<string, any> } | undefined): string[] {
    if (!viz?.shaders || typeof viz.shaders !== "object") return [];
    return Object.keys(viz.shaders);
}

// ---------------------------------------------------------------------------
// Helpers

function deepClone<T>(v: T): T {
    if (v === undefined || v === null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
}

function isObject(v: any): boolean {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function exportLive(viewer: any): LivePayload | null {
    const U: any = (window as any).UTILITIES;
    if (typeof U?.exportLiveVisualization !== "function") return null;
    try { return U.exportLiveVisualization(viewer); } catch (e) { return null; }
}

function applyState(target: any, state: any): void {
    const U: any = (window as any).UTILITIES;
    if (typeof U?.applySnapshotState === "function") {
        U.applySnapshotState(target, state);
        return;
    }
    // Fallback: same convention as src/layers.js:125 applySnapshotState.
    if (!isObject(target) || !isObject(state)) return;
    target.params = isObject(target.params) ? target.params : {};
    if (state.visible !== undefined) target.visible = state.visible ? 1 : 0;
    if (state.use_mode !== undefined) target.params.use_mode = state.use_mode;
    if (state.use_blend !== undefined) target.params.use_blend = state.use_blend;
}

function mergeRuntimeIntoStructuralShader(
    structuralEntry: any,
    liveLayer: { id?: string; type?: string; cache?: any; state?: any } | undefined,
): void {
    if (!isObject(structuralEntry) || !liveLayer) return;
    if (typeof liveLayer.type === "string" && liveLayer.type) {
        structuralEntry.type = liveLayer.type;
    }
    if (liveLayer.cache !== undefined) {
        structuralEntry.cache = deepClone(liveLayer.cache);
    }
    if (liveLayer.state !== undefined) {
        applyState(structuralEntry, liveLayer.state);
    }
}

function liveLayerIsTrivialIdentity(liveLayer: { type?: string; cache?: any; state?: any } | undefined): boolean {
    if (!liveLayer) return true;
    if (liveLayer.type && liveLayer.type !== "identity") return false;
    if (liveLayer.cache && Object.keys(liveLayer.cache).length > 0) return false;
    if (liveLayer.state && Object.keys(liveLayer.state).length > 0) return false;
    return true;
}

/**
 * Build an index of live layers keyed by their original (un-sanitized) id.
 * The renderer keys its `live.layers` map by a SANITIZED pathString (hyphens
 * stripped, double-underscores collapsed, etc. — see FlexRenderer.sanitizeKey),
 * so direct `live.layers[bg.id]` lookups silently miss when bg.id contains
 * any of those characters. Each layer's `.id` field carries the original
 * un-sanitized id, so indexing by `.id` is sanitize-agnostic.
 */
function indexLiveLayersById(live: LivePayload | null): Map<string, any> {
    const out = new Map<string, any>();
    if (!live?.layers) return out;
    for (const key in live.layers) {
        if (!Object.prototype.hasOwnProperty.call(live.layers, key)) continue;
        const layer = live.layers[key];
        if (!layer) continue;
        const id = (typeof layer.id === "string" && layer.id) ? layer.id : key;
        out.set(id, layer);
    }
    return out;
}

function mergeBackgroundFromLive(
    bg: CanonicalBackground,
    byId: Map<string, any>,
): void {
    if (byId.size === 0 || !bg?.id) return;

    // (a) Implicit-identity materialization. assemble-render-output.ts:117-119
    // synthesizes `[{ type: "identity" }]` when bg.shaders is unset, keyed
    // under bg.id. If the user edited that implicit shader (different type,
    // cache, or state), we have to materialize a structural entry — otherwise
    // the round-trip silently drops the edit and openViewerWith sees no diff.
    if (!Array.isArray(bg.shaders) || bg.shaders.length === 0) {
        const implicitLive = byId.get(bg.id);
        if (liveLayerIsTrivialIdentity(implicitLive)) {
            // Truly default — leave bg.shaders unset so cfg stays minimal.
            return;
        }
        bg.shaders = [{ type: implicitLive!.type || "identity" }];
    }

    // Per-existing-entry merge.
    const ids = backgroundShaderRendererIds(bg);
    for (let i = 0; i < bg.shaders.length; i++) {
        const liveLayer = byId.get(ids[i]!);
        if (liveLayer) mergeRuntimeIntoStructuralShader(bg.shaders[i], liveLayer);
    }

    // (b) Structural append. If the renderer carries layers past the
    // current bg.shaders.length (user added a shader to the bg via the
    // playground UI, e.g. `bg.id-1`, `bg.id-2`…), persist them.
    let next = bg.shaders.length;
    while (true) {
        const id = next === 0 ? bg.id : `${bg.id}-${next}`;
        const liveLayer = byId.get(id);
        if (!liveLayer) break;
        const entry: any = { type: liveLayer.type || "identity" };
        mergeRuntimeIntoStructuralShader(entry, liveLayer);
        bg.shaders.push(entry);
        next++;
    }
}

function mergeVisualizationFromLive(
    viz: CanonicalVisualization,
    byId: Map<string, any>,
): void {
    if (byId.size === 0 || !viz?.shaders) return;
    const walk = (map: Record<string, any>) => {
        for (const id in map) {
            if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
            const node = map[id];
            if (!isObject(node)) continue;
            mergeRuntimeIntoStructuralShader(node, byId.get(id));
            if (isObject(node.shaders)) walk(node.shaders);
        }
    };
    walk(viz.shaders);
}

function normalizeActiveIndex(raw: any): Array<number | undefined> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (Array.isArray(raw)) {
        return raw.map((entry: any) => Number.isInteger(entry) ? entry : undefined);
    }
    return Number.isInteger(raw) ? [raw] : undefined;
}

// ---------------------------------------------------------------------------
// Public surface

/**
 * Capture the FULL app scene: cfg (data, background, visualizations,
 * active indices) deep-cloned, with each viewer's runtime cache/state
 * merged back into the structural shaders.
 *
 * For multi-viewport setups, runtime state from EVERY viewer is merged
 * into the (shared) cfg structures by renderer id — so if two viewers
 * share a bg index, the most-recently-walked viewer's state wins. This
 * matches what session sync's polling already does.
 */
export function serializeScene(_opts: { includeViewport?: boolean } = {}): CanonicalScene {
    const APP: any = (window as any).APPLICATION_CONTEXT;
    const cfg = APP?.config || {};

    const scene: CanonicalScene = {
        version: 1,
        data: Array.isArray(cfg.data) ? deepClone(cfg.data) : [],
        background: Array.isArray(cfg.background) ? deepClone(cfg.background) : [],
        visualizations: Array.isArray(cfg.visualizations) ? deepClone(cfg.visualizations) : [],
        activeBackgroundIndex: normalizeActiveIndex(
            APP?.getOption?.("activeBackgroundIndex", undefined, true, true),
        ),
        activeVisualizationIndex: normalizeActiveIndex(
            APP?.getOption?.("activeVisualizationIndex", undefined, true, true),
        ),
    };

    const VM: any = (window as any).VIEWER_MANAGER;
    const viewers: any[] = Array.isArray(VM?.viewers) ? VM.viewers.filter(Boolean) : [];

    for (const viewer of viewers) {
        const live = exportLive(viewer);
        if (!live) continue;
        const byId = indexLiveLayersById(live);
        for (const bg of scene.background) mergeBackgroundFromLive(bg, byId);
        for (const viz of scene.visualizations) mergeVisualizationFromLive(viz, byId);
    }

    return scene;
}

/**
 * Capture the slice that a single viewer is currently rendering. Used by
 * the playground page to extract its edited state for Apply. Returns the
 * edited background array (mirrors source bg ids 1:1) and the active
 * visualization with runtime cache/state merged in.
 *
 * `live` is the renderer's per-layer payload (shape from
 * `UTILITIES.exportLiveVisualization`). When omitted, it is captured from
 * the supplied viewer. Callers that namespace renderer ids (e.g. the
 * playground page) must strip the namespace before passing `live`, so
 * keys match the structural shader ids in `init.background[i]` /
 * `init.visualization`.
 *
 * The caller is responsible for slotting the result back into the source
 * scene (replace `cfg.background` and `cfg.visualizations[activeIdx]`).
 */
export function serializeSceneFromViewer(
    viewer: any,
    init: { background?: any[]; visualization?: any } = {},
    live?: LivePayload | null,
): { background: CanonicalBackground[]; visualization: CanonicalVisualization | undefined } {
    const liveState = live === undefined ? exportLive(viewer) : live;
    const byId = indexLiveLayersById(liveState);
    const background: CanonicalBackground[] = Array.isArray(init.background)
        ? deepClone(init.background)
        : [];
    for (const bg of background) mergeBackgroundFromLive(bg, byId);

    let visualization: CanonicalVisualization | undefined;
    if (init.visualization) {
        visualization = deepClone(init.visualization);
        if (visualization) mergeVisualizationFromLive(visualization, byId);
    }

    return { background, visualization };
}

/**
 * Apply a scene back via the canonical open pipeline. The pipeline rebuilds
 * the renderer from the inlined cfg (cache / state survive because they
 * live on the structural shader entries that `assembleBackgroundShaders`
 * clones into renderOutput) and pushes a single history entry per the
 * `historyMode` option.
 */
export async function deserializeScene(
    scene: CanonicalScene,
    opts: {
        historyMode?: "auto" | "skip" | "content-switch" | "visualization-step" | "reset-history";
        historyLabel?: string;
    } = {},
): Promise<void> {
    const APP: any = (window as any).APPLICATION_CONTEXT;
    if (typeof APP?.openViewerWith !== "function") {
        throw new Error("[canonical-scene] APPLICATION_CONTEXT.openViewerWith unavailable");
    }
    await APP.openViewerWith(
        scene.data,
        scene.background,
        scene.visualizations,
        undefined,
        undefined,
        {
            historyMode: opts.historyMode ?? "visualization-step",
            historyLabel: opts.historyLabel,
        },
    );
}

// Devtools convenience.
(window as any).__SCENE = {
    serialize: serializeScene,
    serializeFromViewer: serializeSceneFromViewer,
    deserialize: deserializeScene,
    backgroundShaderRendererIds,
    visualizationShaderRendererIds,
};
