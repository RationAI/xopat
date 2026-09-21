/**
 * Per-viewer shader-id namespacing helpers.
 *
 * FlexRenderer derives HTML control DOM ids from the shader id
 * (`${shader.id}_${controlName}`, see `src/libs/flex-renderer/flex-renderer.js`
 * line 4064). When two viewers render the same shader id, the ids collide
 * globally: `document.getElementById(this.id)` in `AdvancedSlider.init`
 * resolves to the FIRST viewer's element, and the second viewer's
 * `noUiSlider.create(...)` throws "Slider was already initialized".
 *
 * Fix: prefix every shader id with a per-viewer (or per-page) namespace
 * before handing the config to `overrideConfigureAll`. Strip the prefix
 * when reading state back out so APPLICATION_CONTEXT.config /
 * session-collab payloads stay un-namespaced and round-trip cleanly.
 *
 * The playground already used this pattern locally
 * (`src/classes/playground/playground-page.ts`); these helpers are the
 * extraction so the broker (the open pipeline) and the playground share
 * one implementation.
 */

/**
 * Build the per-owner id prefix. FlexRenderer's `idPattern` rejects ids
 * that start with `_` or contain `__`, so the prefix is `<tag><id>_` and
 * we rely on the original shader id (also pattern-conformant) as the
 * suffix.
 *
 * @param ownerId   Stable id of the namespace owner (viewer.id, playground page id, …).
 * @param tag       Short letter cluster identifying the namespace family
 *                  (`"v"` for viewer, `"pg"` for playground page). Default `"v"`.
 */
export function buildShaderIdNamespace(ownerId: string | number, tag: string = "v"): string {
    const safeTag = String(tag).replace(/[^A-Za-z]/g, "") || "v";
    const safeId = String(ownerId == null ? "0" : ownerId).replace(/[^A-Za-z0-9]/g, "");
    return `${safeTag}${safeId || "0"}_`;
}

/**
 * Recursively rename shader-map keys, each shader's `.id`, group children's
 * `shaders` keys + ids, and `order` arrays. Returns a NEW map; the input
 * is not mutated.
 */
export function renameShaderIds(map: Record<string, any>, namespace: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [origId, value] of Object.entries(map)) {
        const newId = namespace + origId;
        out[newId] = renameShaderConfigInPlace(value, namespace, newId);
    }
    return out;
}

function renameShaderConfigInPlace(config: any, namespace: string, newId: string): any {
    if (!config || typeof config !== "object") return config;
    config.id = newId;
    if (config.shaders && typeof config.shaders === "object" && !Array.isArray(config.shaders)) {
        config.shaders = renameShaderIds(config.shaders, namespace);
    }
    if (Array.isArray(config.order)) {
        config.order = config.order.map((id: string) => namespace + id);
    }
    return config;
}

/**
 * Inverse of {@link renameShaderIds}: recursively strip a leading `namespace`
 * from each top-level key, each shader config's `.id`, group children's
 * `shaders` keys + ids, and `order` arrays. Ids that don't carry the prefix
 * are left untouched. Returns a NEW map; the input is not mutated.
 */
export function stripShaderIdNamespace(map: Record<string, any>, namespace: string): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [id, value] of Object.entries(map)) {
        const strippedId = id.startsWith(namespace) ? id.slice(namespace.length) : id;
        out[strippedId] = stripShaderConfigInPlace(value, namespace, strippedId);
    }
    return out;
}

function stripShaderConfigInPlace(config: any, namespace: string, strippedId: string): any {
    if (!config || typeof config !== "object") return config;
    config.id = strippedId;
    if (config.shaders && typeof config.shaders === "object" && !Array.isArray(config.shaders)) {
        config.shaders = stripShaderIdNamespace(config.shaders, namespace);
    }
    if (Array.isArray(config.order)) {
        config.order = config.order.map((id: string) =>
            (typeof id === "string" && id.startsWith(namespace)) ? id.slice(namespace.length) : id);
    }
    return config;
}

/**
 * Strip the namespace prefix from every shader-path segment. Renderer
 * paths can be nested (e.g. `groupA/leafB`) so we split on `/` and strip
 * each segment individually.
 */
export function stripNamespaceFromPath(path: string, namespace: string): string {
    if (typeof path !== "string" || !path) return path;
    return path.split("/").map(seg => seg.startsWith(namespace) ? seg.slice(namespace.length) : seg).join("/");
}

/** Inverse of {@link stripNamespaceFromPath}. */
export function addNamespaceToPath(path: string, namespace: string): string {
    if (typeof path !== "string" || !path) return path;
    return path.split("/").map(seg => namespace + seg).join("/");
}

/**
 * Strip the namespace prefix from a live-visualization payload produced
 * by `UTILITIES.exportLiveVisualization`. Used by session-save / collab
 * broadcast paths so peers see un-namespaced ids matching the structural
 * shader ids in `APPLICATION_CONTEXT.config`.
 *
 * Shape contract (see `src/layers.js`):
 *   { layerOrder: string[], layers: { [pathString]: { id, type, cache, state } } }
 */
export function stripNamespaceFromLiveState(live: any, namespace: string): any {
    if (!live || typeof live !== "object" || !live.layers || typeof live.layers !== "object") return live;
    const out: any = { ...live, layers: {} };
    for (const key in live.layers) {
        if (!Object.prototype.hasOwnProperty.call(live.layers, key)) continue;
        const strippedKey = stripNamespaceFromPath(key, namespace);
        const layer = live.layers[key];
        const cleanLayer = layer && typeof layer === "object" && typeof layer.id === "string"
            ? { ...layer, id: stripNamespaceFromPath(layer.id, namespace) }
            : layer;
        out.layers[strippedKey] = cleanLayer;
    }
    if (Array.isArray(live.layerOrder)) {
        out.layerOrder = live.layerOrder.map((id: string) =>
            typeof id === "string" ? stripNamespaceFromPath(id, namespace) : id);
    }
    return out;
}

/**
 * Inverse of {@link stripNamespaceFromLiveState}. Used by session-restore
 * / source-state seeding paths so the renderer's prefixed lookup keys
 * match the incoming un-namespaced payload.
 */
export function addNamespaceToLiveState(live: any, namespace: string): any {
    if (!live || typeof live !== "object" || !live.layers || typeof live.layers !== "object") return live;
    const out: any = { ...live, layers: {} };
    for (const key in live.layers) {
        if (!Object.prototype.hasOwnProperty.call(live.layers, key)) continue;
        const namespacedKey = addNamespaceToPath(key, namespace);
        const layer = live.layers[key];
        const namespacedLayer = layer && typeof layer === "object" && typeof layer.id === "string"
            ? { ...layer, id: addNamespaceToPath(layer.id, namespace) }
            : layer;
        out.layers[namespacedKey] = namespacedLayer;
    }
    if (Array.isArray(live.layerOrder)) {
        out.layerOrder = live.layerOrder.map((id: string) =>
            typeof id === "string" ? addNamespaceToPath(id, namespace) : id);
    }
    return out;
}
