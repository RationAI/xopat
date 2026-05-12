/**
 * Build the FlexRenderer config map (`renderOutput`) from a session's
 * background + active-visualization configs. This is the single place where
 * "config → renderer shader map" lives; both the production open-pipeline
 * (`viewer-open-pipeline.ts:openIntoViewer`) and the Visualization Playground
 * (`playground-page.ts:openSourceMirror`) call this so they can't drift.
 *
 * Lifted as-is from the inline assembly that used to live in
 * `viewer-open-pipeline.ts:1174-1266`. Behavioural parity with that code is
 * the primary correctness criterion — production rendering must be
 * pixel-identical before vs after this extraction.
 *
 * What stays OUTSIDE this helper:
 *   - Tile opening (`viewer.world.add`, `addTiledImage`, etc.). The helper
 *     produces *config*; opening is the caller's responsibility.
 *   - `shaderSourceController.registerShaderBinding(...)` — that walks the
 *     final renderOutput and is performed by the caller after this returns.
 *   - World-index allocation. The helper *resolves* dataReferences via the
 *     supplied env hooks; the production pipeline's hook side-effects to
 *     allocate, the playground's hook reads from a precomputed map.
 *
 * Mutability: the helper mutates fields on cloned shader configs (sets
 * `tiledImages`, `name`, etc.) and writes into `renderOutput`. The bg/viz
 * source configs themselves are NOT mutated — the helper clones them via
 * the supplied `cloneRuntimeState` hook before walking.
 */

import { BackgroundConfig } from "../background-config";

export interface AssembleEnv {
    /**
     * Backgrounds that the active viewer is currently displaying (the
     * `openedBase` array in production). Each entry's id is the canonical
     * shader-id under which its identity wrapper is keyed in `renderOutput`.
     */
    backgrounds: BackgroundConfig[];

    /**
     * The active visualization for this viewer, if any. Its `shaders` map is
     * walked, each shader's `tiledImages` resolved, and the map is normalized
     * via `normalizeRendererShaderMap` and merged into `renderOutput` on top
     * of the bg shaders.
     */
    activeVisualization: any | undefined;

    /**
     * Full data spec list (= `appContext.config.data`). Used for naming
     * fallbacks and for url-builder callbacks.
     */
    data: any[];

    /**
     * Deep-clone helper. Production passes its `cloneRuntimeState`; the
     * playground passes a JSON-clone equivalent. Used to avoid mutating
     * the input `backgrounds[i].shaders` and `activeVisualization.shaders`.
     */
    cloneRuntimeState<T>(value: T): T;

    /**
     * Resolve a `dataReference` (index into `data[]`) to an OSD world index.
     * Production: side-effects to allocate a new world index by appending
     * to its `toOpen` queue when the index isn't already present. Playground:
     * looks up an existing world index in the source viewer and returns -1
     * when missing (the playground never opens new tiles).
     *
     * `kind` lets the implementation pick the right url-builder (background
     * vs. visualization data); `bgRef` is supplied for background lookups
     * and may be omitted for visualization lookups.
     */
    resolveWorldIndex(
        dataIndex: number,
        kind: "background" | "visualization",
        bgRef?: BackgroundConfig,
    ): number;

    /**
     * The `expandDataSourceRef` callback handed to FlexRenderer's
     * normalizeShaderConfig / normalizeShaderMap. Used by time-series and
     * managed-source shaders to wrap `dataReferences` entries in opaque
     * tokens. Production wraps via its `buildManagedShaderSourceEntry`;
     * the playground returns the entry as-is (it doesn't manage runtime
     * source rerouting).
     */
    expandDataSourceRef(
        entry: any,
        kind: "background" | "visualization",
        bgRef: BackgroundConfig | undefined,
        meta: any,
    ): any;
}

export interface AssembleResult {
    renderOutput: Record<string, any>;
}

/**
 * Convenience: run background then visualization assembly in one call. Most
 * callers will want this. The production pipeline uses
 * {@link assembleBackgroundShaders} and {@link assembleVisualizationShaders}
 * separately so it can capture `toOpen.length` between phases (the
 * `firstVizIndex` boundary used by the open-tile loop's kind labelling).
 */
export function assembleRenderOutput(env: AssembleEnv): AssembleResult {
    const renderOutput: Record<string, any> = {};
    assembleBackgroundShaders(env, renderOutput);
    assembleVisualizationShaders(env, renderOutput);
    return { renderOutput };
}

/**
 * Walk `env.backgrounds`, build identity-or-supplied shader configs keyed by
 * `bgRef.id`, resolve `tiledImages` via `env.resolveWorldIndex`, and write
 * the entries into `renderOutput`. Mutates `renderOutput`.
 */
export function assembleBackgroundShaders(env: AssembleEnv, renderOutput: Record<string, any>): void {
    for (const bgRef of env.backgrounds) {
        let bgShaders: any[] | undefined = env.cloneRuntimeState(bgRef.shaders as any);
        if (!bgShaders) {
            // Implicit identity shader keyed under bgRef.id. Must stay in
            // lockstep with `mergeBackgroundFromLive` in canonical-scene.ts
            // (which materializes a structural entry when this implicit
            // layer is edited so the change can round-trip back to cfg).
            bgShaders = [{ type: "identity" }];
        } else if (!Array.isArray(bgShaders)) {
            console.warn("Invalid shaders for background: array required.", bgRef, bgShaders);
            bgShaders = [bgShaders as any];
        }

        let count = 0;
        const resolveBackgroundShaderLayer = (shaderCfg: any) => {
            const hasExplicitRefs = Array.isArray(shaderCfg.dataReferences) && shaderCfg.dataReferences.length > 0;

            if (!hasExplicitRefs) {
                const dataIndex = bgRef.dataReference as number;
                shaderCfg.tiledImages = [env.resolveWorldIndex(dataIndex, "background", bgRef) ?? -1];
                shaderCfg.name = shaderCfg.name || bgRef.name || BackgroundConfig.data(bgRef);
            } else {
                shaderCfg.tiledImages = [];
                shaderCfg.name = shaderCfg.name || nameFromBGOrIndex(shaderCfg.dataReferences[0]);

                for (const dataIndex of shaderCfg.dataReferences) {
                    shaderCfg.tiledImages.push(env.resolveWorldIndex(dataIndex, "background", bgRef) ?? -1);
                }
            }

            if (shaderCfg.shaders && typeof shaderCfg.shaders === "object" && !Array.isArray(shaderCfg.shaders)) {
                for (const childShaderCfg of Object.values(shaderCfg.shaders)) {
                    resolveBackgroundShaderLayer(childShaderCfg);
                }
            }
        };

        for (const shaderCfg of bgShaders) {
            shaderCfg.id = count < 1 ? bgRef.id : `${bgRef.id}-${count}`;
            resolveBackgroundShaderLayer(shaderCfg);
            normalizeRendererShaderConfig(shaderCfg, {
                rootKind: "background",
                rootConfig: bgRef,
                expandDataSourceRef: (entry: any, meta: any = {}) =>
                    env.expandDataSourceRef(entry, "background", bgRef, meta),
            });
            renderOutput[shaderCfg.id] = shaderCfg;
            count++;
        }
    }
}

/**
 * Walk `env.activeVisualization.shaders` (no-op if absent), resolve each
 * shader's `tiledImages` via `env.resolveWorldIndex`, normalize via
 * FlexRenderer.normalizeShaderMap, and merge into `renderOutput`. Mutates
 * `renderOutput`.
 */
export function assembleVisualizationShaders(env: AssembleEnv, renderOutput: Record<string, any>): void {
    if (!env.activeVisualization) return;

    const shaderConfigMap: Record<string, any> = env.cloneRuntimeState(env.activeVisualization.shaders || {});

    forEachVisualizationShader(shaderConfigMap, (vizShaderCfg, shaderId) => {
        vizShaderCfg.tiledImages = [];

        const dataRefs = vizShaderCfg.dataReferences || [];
        const firstSpec = dataRefs.length ? env.data[dataRefs[0] ?? 0] : undefined;
        const firstId = BackgroundConfig.dataFromSpec(firstSpec);
        vizShaderCfg.name = (vizShaderCfg.name || firstId || shaderId) as string;

        for (const dataIndex of dataRefs) {
            vizShaderCfg.tiledImages.push(env.resolveWorldIndex(dataIndex, "visualization") ?? -1);
        }
    });

    normalizeRendererShaderMap(shaderConfigMap, {
        rootKind: "visualization",
        rootConfig: env.activeVisualization,
        expandDataSourceRef: (entry: any, meta: any = {}) =>
            env.expandDataSourceRef(entry, "visualization", undefined, meta),
    });

    Object.assign(renderOutput, shaderConfigMap);
}

/**
 * Recursively walk every shader entry in a visualization shader map. Calls
 * `callback(shader, shaderId, path)` for each entry, including children of
 * group shaders. Mirror of the lambda used inline in viewer-open-pipeline.
 */
export function forEachVisualizationShader(
    shaderMap: Record<string, any> | undefined,
    callback: (shader: any, shaderId: string, path: string[]) => void,
    path: string[] = [],
): void {
    if (!shaderMap || typeof shaderMap !== "object") return;
    for (const [shaderId, shader] of Object.entries(shaderMap)) {
        if (!shader || typeof shader !== "object") continue;
        const nextPath = path.concat([shaderId]);
        callback(shader, shaderId, nextPath);
        if (shader.shaders && typeof shader.shaders === "object" && !Array.isArray(shader.shaders)) {
            forEachVisualizationShader(shader.shaders, callback, nextPath);
        }
    }
}

function normalizeRendererShaderConfig(shaderConfig: any, context: any = {}): any {
    const rendererClass: any = (window as any).OpenSeadragon?.FlexRenderer;
    if (rendererClass && typeof rendererClass.normalizeShaderConfig === "function") {
        return rendererClass.normalizeShaderConfig(shaderConfig, context);
    }
    return shaderConfig;
}

function normalizeRendererShaderMap(shaderMap: Record<string, any>, context: any = {}): any {
    const rendererClass: any = (window as any).OpenSeadragon?.FlexRenderer;
    if (rendererClass && typeof rendererClass.normalizeShaderMap === "function") {
        return rendererClass.normalizeShaderMap(shaderMap, context);
    }
    return shaderMap;
}

function nameFromBGOrIndex(ref: any): any {
    const utils: any = (window as any).UTILITIES;
    if (utils && typeof utils.nameFromBGOrIndex === "function") {
        try { return utils.nameFromBGOrIndex(ref); } catch (e) { /* fall through */ }
    }
    return typeof ref === "number" ? `data ${ref}` : (ref?.dataID || ref || "shader");
}
