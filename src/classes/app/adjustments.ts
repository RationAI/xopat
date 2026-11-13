/**
 * Display adjustments broker — `APPLICATION_CONTEXT.adjustments`.
 *
 * Reads and writes per-layer display adjustments (levels, brightness/contrast,
 * saturation, hue, white balance, invert) and per-data-item sampling, always for
 * an explicit viewer (never `window.VIEWER`, see src/MULTI_VIEWPORTS.md).
 *
 * Engine. Adjustments are vec4→vec4 modules in the layer's `params.pipeline.post`
 * chain — flex-renderer's per-layer module pipeline. xOpat only names module types
 * and controls; all GLSL stays in flex-renderer. Inserting a node is the one rebuild;
 * every later write is `control.set(...)`, a uniform update. On a renderer without
 * the pipeline (`typeof shaderLayer.resetPipeline !== "function"`),
 * {@link Adjustments.isSupported} is false and every adjustment write is refused.
 *
 * Ranges (min/max/step) are read from the renderer's module definitions
 * (`ShaderModuleRegistry`), so they never drift from what the shader clamps to;
 * the literals below are only a fallback. Identity values stay here: they are
 * xOpat's notion of "no adjustment" and are written into every inserted node,
 * because a module's own default need not be its identity (invert defaults to 1).
 *
 * Persistence and undo come for free: structural edits emit
 * `UTILITIES._emitShaderConfigUpdate`, value edits raise the renderer's
 * `visualization-change` through `control.set`; both reach live-config-sync,
 * visualization-history and the session provider, which snapshot
 * `params.pipeline` (layers.js `extractShaderState`) and the control cache.
 *
 * Sampling (brightfield / fluorescence / pixelated) is NOT a module: GL filtering
 * is per tiled image, set at texture upload. It is written to the data item
 * (`config.data[i].imageSmoothingEnabled` / `.minificationFilter`, the fields
 * viewer-open-pipeline.ts already applies) and pushed to the live drawers.
 */
export interface AdjustmentDescriptor {
    /** Stable key used by the API, the UI, presets and scripting. */
    key: string;
    /** Pipeline node id (GLSL-safe). Several keys may share one node. */
    node: string;
    /** flex-renderer module type of that node. */
    module: string;
    /** Control name inside the module. */
    control: string;
    min: number;
    max: number;
    step: number;
    /** Value at which the module has no visual effect. */
    identity: number;
    /** i18n key of the label. */
    labelKey: string;
    /** Position of the node in the chain (lower runs first). */
    order: number;
    /** Rendered as an on/off switch instead of a slider. */
    toggle?: boolean;
}

export type AdjustmentValues = Record<string, number>;
export type SamplingMode = "auto" | "brightfield" | "fluorescence" | "pixelated";
export type LayerRole = "background" | "visualization";

export interface AdjustableLayer {
    /** Renderer (namespaced) layer id — what every broker method takes. */
    id: string;
    title: string;
    type: string;
    role: LayerRole;
    /** Index of the layer within its role (background layers: 0..n). */
    roleIndex: number;
    dataReferences: number[];
    values: AdjustmentValues;
    /** True when at least one adjustment differs from identity. */
    adjusted: boolean;
}

export interface AdjustableDataItem {
    /** Index into `APPLICATION_CONTEXT.config.data`, or -1 when unresolved. */
    dataReference: number;
    role: LayerRole;
    /** Display label (the first layer's name). May carry a slide name — UI only. */
    label: string;
    sampling: SamplingMode;
    layers: AdjustableLayer[];
}

export interface AdjustmentHistogram {
    /** 64 bins over 0..1, summed over R+G+B of opaque pixels. */
    bins: number[];
    channels: Array<{ channel: string; min: number; max: number; mean: number; histogram: number[] }>;
    empty: boolean;
}

export interface AdjustmentChange {
    viewer: any;
    layerId?: string;
    reason: "values" | "structure" | "reset" | "bypass" | "sampling" | "link";
}

const NODE_PREFIX = "xadj_";
const PRESETS_CACHE_KEY = "adjustments.presets";

const DEFAULT_DESCRIPTORS: AdjustmentDescriptor[] = [
    { key: "black", node: "xadj_levels", module: "levels", control: "black", min: 0, max: 1, step: 0.01, identity: 0, labelKey: "adjustments.black", order: 10 },
    { key: "white", node: "xadj_levels", module: "levels", control: "white", min: 0, max: 1, step: 0.01, identity: 1, labelKey: "adjustments.white", order: 10 },
    { key: "gamma", node: "xadj_levels", module: "levels", control: "gamma", min: 0.1, max: 5, step: 0.05, identity: 1, labelKey: "adjustments.gamma", order: 10 },
    { key: "brightness", node: "xadj_bc", module: "brightness-contrast", control: "brightness", min: -1, max: 1, step: 0.01, identity: 0, labelKey: "adjustments.brightness", order: 20 },
    { key: "contrast", node: "xadj_bc", module: "brightness-contrast", control: "contrast", min: -1, max: 1, step: 0.01, identity: 0, labelKey: "adjustments.contrast", order: 20 },
    { key: "saturation", node: "xadj_saturation", module: "saturation", control: "saturation", min: 0, max: 3, step: 0.01, identity: 1, labelKey: "adjustments.saturation", order: 30 },
    { key: "hue", node: "xadj_hue", module: "hue-rotate", control: "hue", min: -180, max: 180, step: 1, identity: 0, labelKey: "adjustments.hue", order: 40 },
    { key: "temperature", node: "xadj_temperature", module: "color-temperature", control: "temperature", min: -1, max: 1, step: 0.01, identity: 0, labelKey: "adjustments.temperature", order: 50 },
    { key: "tint", node: "xadj_temperature", module: "color-temperature", control: "tint", min: -1, max: 1, step: 0.01, identity: 0, labelKey: "adjustments.tint", order: 50 },
    { key: "invert", node: "xadj_invert", module: "invert", control: "amount", min: 0, max: 1, step: 1, identity: 0, labelKey: "adjustments.invert", order: 60, toggle: true },
];

/** Keys shown by the navigator quick panel. */
export const QUICK_ADJUSTMENT_KEYS = ["brightness", "contrast", "saturation", "gamma"];

const SAMPLING_MODES: Record<Exclude<SamplingMode, "auto">, { imageSmoothingEnabled: boolean; minificationFilter: "default" | "max" }> = {
    brightfield: { imageSmoothingEnabled: true, minificationFilter: "default" },
    fluorescence: { imageSmoothingEnabled: true, minificationFilter: "max" },
    pixelated: { imageSmoothingEnabled: false, minificationFilter: "default" },
};

function isObject(value: any): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function clamp(value: number, d: AdjustmentDescriptor): number {
    return Math.min(d.max, Math.max(d.min, value));
}

export class Adjustments {
    private readonly descriptors = new Map<string, AdjustmentDescriptor>();
    private readonly listeners = new Set<(change: AdjustmentChange) => void>();
    private readonly bypassed = new WeakSet<any>();
    private linked = false;
    /** Re-entrancy guard: a linked write must not echo back to its source. */
    private propagating = false;

    constructor() {
        for (const d of DEFAULT_DESCRIPTORS) this.descriptors.set(d.key, d);
    }

    // ---------------------------------------------------------------- catalogue

    /** Every known adjustment, in chain order, with the renderer's ranges. */
    getDescriptors(): AdjustmentDescriptor[] {
        return [...this.descriptors.values()].map(d => this.resolve(d)).sort((a, b) => a.order - b.order);
    }

    getDescriptor(key: string): AdjustmentDescriptor | undefined {
        const d = this.descriptors.get(key);
        return d ? this.resolve(d) : undefined;
    }

    /** Overlay min/max/step from the module's own control definition, when the renderer has it. */
    private resolve(d: AdjustmentDescriptor): AdjustmentDescriptor {
        let spec: any;
        try {
            const Module = (window as any).OpenSeadragon?.FlexRenderer?.ShaderModuleRegistry?.get?.(d.module);
            spec = Module?.defaultControls?.[d.control]?.default;
        } catch (e) {
            spec = undefined;
        }
        if (!isObject(spec)) return d;
        const num = (v: any, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
        const min = num(spec.min, d.min);
        const max = num(spec.max, d.max);
        if (!(max > min)) return d;
        return { ...d, min, max, step: d.toggle ? d.step : num(spec.step, d.step) };
    }

    /** Keys offered by the navigator quick panel. */
    getQuickKeys(): string[] {
        return QUICK_ADJUSTMENT_KEYS.filter(key => this.descriptors.has(key));
    }

    /**
     * Add a new kind of adjustment. The UI renders descriptors generically, so a
     * new module the renderer ships needs no UI change — only a descriptor.
     */
    registerAdjustment(descriptor: AdjustmentDescriptor): void {
        if (!descriptor?.key || !descriptor.node?.startsWith(NODE_PREFIX) || !descriptor.module || !descriptor.control) {
            throw new Error(`Invalid adjustment descriptor: node ids must start with '${NODE_PREFIX}'.`);
        }
        this.descriptors.set(descriptor.key, { ...descriptor });
    }

    /** True when the vendored renderer supports per-layer module pipelines. */
    isSupported(): boolean {
        const proto = (window as any).OpenSeadragon?.FlexRenderer?.ShaderLayer?.prototype;
        return typeof proto?.resetPipeline === "function";
    }

    /**
     * True when the renderer offers a transient bypass (`setPipelineBypass`).
     * `setPipelineEnabled` is NOT a substitute: it persists into the config and
     * cache and raises `control-change`, so a before/after peek would become an
     * undo step, a session-sync message and part of the saved session.
     */
    isBypassSupported(): boolean {
        const proto = (window as any).OpenSeadragon?.FlexRenderer?.ShaderLayer?.prototype;
        return typeof proto?.setPipelineBypass === "function";
    }

    onChange(listener: (change: AdjustmentChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(change: AdjustmentChange) {
        for (const listener of this.listeners) {
            try { listener(change); } catch (e) { console.warn("[adjustments] listener failed", e); }
        }
    }

    // ---------------------------------------------------------------- reading

    /** Data items of a viewer, background first, each with its adjustable layers. */
    list(viewer: any): AdjustableDataItem[] {
        const layers = this.listLayers(viewer);
        const groups = new Map<string, AdjustableDataItem>();
        for (const layer of layers) {
            const ref = layer.dataReferences[0] ?? -1;
            const key = `${layer.role}:${ref}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    dataReference: ref,
                    role: layer.role,
                    label: layer.title,
                    sampling: ref >= 0 ? this.getSampling(ref) : "auto",
                    layers: [],
                };
                groups.set(key, group);
            }
            group.layers.push(layer);
        }
        return [...groups.values()];
    }

    /** Top-level shader layers of a viewer, background first, in render order. */
    listLayers(viewer: any): AdjustableLayer[] {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer) return [];
        const order: string[] = Array.isArray(renderer.getShaderLayerOrder?.()) ? renderer.getShaderLayerOrder() : [];
        const split = this.backgroundSplit(viewer, order.length);
        const out: AdjustableLayer[] = [];
        order.forEach((id, index) => {
            const config = this.layerConfig(viewer, id);
            if (!config) return;
            const role: LayerRole = index < split ? "background" : "visualization";
            const values = this.readValues(viewer, id);
            out.push({
                id,
                title: typeof config.name === "string" && config.name ? config.name : this.stripNamespace(viewer, id),
                type: typeof config.type === "string" ? config.type : "",
                role,
                roleIndex: role === "background" ? index : index - split,
                dataReferences: this.dataReferencesOf(viewer, config, role),
                values,
                adjusted: this.isAdjusted(values),
            });
        });
        return out;
    }

    /** Background layer ids of a viewer (the implicit identity included). */
    backgroundLayerIds(viewer: any): string[] {
        return this.listLayers(viewer).filter(l => l.role === "background").map(l => l.id);
    }

    /**
     * Controls of a shader layer that this broker owns (its `xadj_*` pipeline
     * nodes). Generic control UIs (the shader card) skip them: the data panel is
     * their one home, and renderer markup mounted twice duplicates DOM ids.
     */
    getOwnedControls(shader: any): Set<any> {
        const owned = new Set<any>();
        if (typeof shader?.getPipelineControl !== "function") return owned;
        for (const d of this.descriptors.values()) {
            const control = shader.getPipelineControl("post", d.node, d.control);
            if (control) owned.add(control);
        }
        return owned;
    }

    /** Current values of every adjustment on a layer (identity where unset). */
    get(viewer: any, layerId: string): AdjustmentValues {
        return this.readValues(viewer, layerId);
    }

    // ---------------------------------------------------------------- writing

    /**
     * Write adjustments to one layer. Unknown keys are ignored, values clamped.
     * @return false when unsupported or the layer does not exist
     */
    set(viewer: any, layerId: string, patch: AdjustmentValues): boolean {
        const ok = this.applyToLayer(viewer, layerId, patch);
        if (ok) this.propagate(viewer, layerId, patch);
        return ok;
    }

    /** Write the same adjustments to every background layer of a viewer (linked). */
    setBackground(viewer: any, patch: AdjustmentValues): boolean {
        let ok = false;
        for (const id of this.backgroundLayerIds(viewer)) ok = this.set(viewer, id, patch) || ok;
        return ok;
    }

    /** Remove the adjustments of one layer, or of every layer when `layerId` is omitted. */
    reset(viewer: any, layerId?: string): void {
        const ids = layerId ? [layerId] : this.listLayers(viewer).map(l => l.id);
        for (const id of ids) {
            this.resetLayer(viewer, id);
            this.propagate(viewer, id, null);
        }
    }

    /**
     * Before/after: render every layer of the viewer without its pipeline. A
     * uniform in the renderer (`setPipelineBypass`), so toggling never relinks,
     * and transient by design — a viewing aid, never written to config, cache,
     * history or session. A no-op when {@link isBypassSupported} is false.
     */
    setBypass(viewer: any, bypass: boolean): void {
        if (!viewer || !this.isBypassSupported()) return;
        if (bypass) this.bypassed.add(viewer); else this.bypassed.delete(viewer);
        this.applyBypass(viewer);
        viewer.forceRedraw?.();
        viewer.navigator?.forceRedraw?.();
        this.notify({ viewer, reason: "bypass" });
    }

    isBypassed(viewer: any): boolean {
        return this.bypassed.has(viewer);
    }

    toggleBypass(viewer: any): boolean {
        const next = !this.isBypassed(viewer);
        this.setBypass(viewer, next);
        return next;
    }

    // ---------------------------------------------------------------- linking

    /**
     * Mirror every adjustment write to the other viewers of the grid. Background
     * layers match by position in the background stack, visualization layers by
     * their structural (un-namespaced) id.
     */
    setLinked(enabled: boolean): void {
        this.linked = !!enabled;
        this.notify({ viewer: null, reason: "link" });
    }

    isLinked(): boolean {
        return this.linked;
    }

    /** One-off copy of a layer's adjustments (or all layers') to other viewers. */
    copyToViewers(source: any, layerId?: string, targets?: any[]): void {
        const ids = layerId ? [layerId] : this.listLayers(source).map(l => l.id);
        const viewers = (targets || this.allViewers()).filter(v => v && v !== source);
        for (const id of ids) {
            const values = this.readValues(source, id);
            for (const target of viewers) {
                const match = this.matchLayer(source, id, target);
                if (match) this.applyToLayer(target, match, values);
            }
        }
    }

    // ---------------------------------------------------------------- histogram

    /**
     * Distribution of the data a layer draws, at the current viewport, from the
     * `visualization.probeData` primitive (identity render of the layer's first
     * data reference, 8-bit, 64 bins). For an identity layer — every implicit
     * background — that is exactly the input of its adjustment chain; for other
     * shader types it is the raw data, not the shader output.
     */
    async histogram(viewer: any, layerId: string): Promise<AdjustmentHistogram | null> {
        const layer = this.listLayers(viewer).find(l => l.id === layerId);
        const ref = layer?.dataReferences[0];
        if (!layer || !Number.isInteger(ref) || (ref as number) < 0) return null;
        const api: any = this.visualizationApiFor(viewer);
        if (!api?.probeData) return null;
        const probe = await api.probeData(ref, { bins: 64 });
        if (!probe || probe.empty || !Array.isArray(probe.channels)) {
            return { bins: new Array(64).fill(0), channels: [], empty: true };
        }
        const bins = new Array(64).fill(0);
        for (const channel of probe.channels.slice(0, 3)) {
            channel.histogram.forEach((count: number, i: number) => { bins[i] += count; });
        }
        return { bins, channels: probe.channels, empty: false };
    }

    /**
     * Auto levels: black/white at the `low`/`high` percentiles of the layer's
     * histogram (defaults 0.5% / 99.5%).
     * @return the applied `{black, white}`, or null when nothing is visible
     */
    async autoLevels(viewer: any, layerId: string, low = 0.005, high = 0.995): Promise<{ black: number; white: number } | null> {
        const histogram = await this.histogram(viewer, layerId);
        if (!histogram || histogram.empty) return null;
        const range = Adjustments.percentileRange(histogram.bins, low, high);
        if (!range) return null;
        this.set(viewer, layerId, range);
        return range;
    }

    /** Percentile bounds of a 0..1 histogram, as `{black, white}`. */
    static percentileRange(bins: number[], low: number, high: number): { black: number; white: number } | null {
        const total = bins.reduce((a, b) => a + b, 0);
        if (!total) return null;
        const n = bins.length;
        let acc = 0, black = 0, white = 1;
        for (let i = 0; i < n; i++) {
            acc += bins[i]!;
            if (acc >= total * low) { black = i / n; break; }
        }
        acc = 0;
        for (let i = n - 1; i >= 0; i--) {
            acc += bins[i]!;
            if (acc >= total * (1 - high)) { white = (i + 1) / n; break; }
        }
        if (white <= black) return null;
        return { black: Math.round(black * 1000) / 1000, white: Math.round(white * 1000) / 1000 };
    }

    // ---------------------------------------------------------------- presets

    /** Named adjustment sets, per user (AppCache, i.e. `kv:cache`). */
    listPresets(): Record<string, AdjustmentValues> {
        const stored = (window as any).APPLICATION_CONTEXT?.AppCache?.get?.(PRESETS_CACHE_KEY, {});
        return isObject(stored) ? this.sanitizePresets(stored) : {};
    }

    savePreset(name: string, values: AdjustmentValues): void {
        const key = String(name || "").trim().slice(0, 64);
        if (!key) throw new Error("A preset needs a name.");
        const presets = this.listPresets();
        presets[key] = this.sanitizeValues(values);
        (window as any).APPLICATION_CONTEXT?.AppCache?.set?.(PRESETS_CACHE_KEY, presets);
    }

    deletePreset(name: string): void {
        const presets = this.listPresets();
        delete presets[name];
        (window as any).APPLICATION_CONTEXT?.AppCache?.set?.(PRESETS_CACHE_KEY, presets);
    }

    /** Apply a preset; unset keys go back to identity so a preset is a full state. */
    applyPreset(viewer: any, layerId: string, name: string): boolean {
        const preset = this.listPresets()[name];
        if (!preset) return false;
        return this.set(viewer, layerId, this.withIdentityDefaults(preset));
    }

    // ---------------------------------------------------------------- sampling

    getSampling(dataReference: number): SamplingMode {
        const spec = (window as any).APPLICATION_CONTEXT?.config?.data?.[dataReference];
        if (!isObject(spec)) return "auto";
        if (spec.imageSmoothingEnabled === false) return "pixelated";
        if (spec.minificationFilter === "max") return "fluorescence";
        if (spec.minificationFilter === "default") return "brightfield";
        return "auto";
    }

    /**
     * Set how a data item is sampled: `brightfield` (linear, single-tap
     * minification), `fluorescence` (linear, per-channel max when zoomed out, so
     * sparse bright signal survives), `pixelated` (nearest, for label maps), or
     * `auto` (inherit the deployment default). Persists on the data item and
     * applies to every viewer showing it.
     */
    setSampling(dataReference: number, mode: SamplingMode): boolean {
        const config = (window as any).APPLICATION_CONTEXT?.config;
        const data: any[] | undefined = config?.data;
        if (!Array.isArray(data) || !Number.isInteger(dataReference) || dataReference < 0 || dataReference >= data.length) {
            return false;
        }
        if (mode !== "auto" && !SAMPLING_MODES[mode]) return false;

        let spec: any = data[dataReference];
        if (typeof spec === "string") spec = { dataID: spec };
        if (!isObject(spec)) return false;
        delete spec.imageSmoothingEnabled;
        delete spec.minificationFilter;
        if (mode !== "auto") Object.assign(spec, SAMPLING_MODES[mode]);
        // Keep the minimal form: an entry that only names its data stays a string.
        const keys = Object.keys(spec);
        data[dataReference] = keys.length === 1 && keys[0] === "dataID" && typeof spec.dataID === "string" ? spec.dataID : spec;

        const setting = mode === "auto" ? null : SAMPLING_MODES[mode];
        for (const viewer of this.allViewers()) {
            const drawer = viewer?.drawer;
            if (!drawer) continue;
            for (const item of this.worldItemsOfDataReference(viewer, dataReference)) {
                drawer.setTiledImageSmoothingEnabled?.(item, setting ? setting.imageSmoothingEnabled : null);
                drawer.setTiledImageMinificationFilter?.(item, setting ? setting.minificationFilter : null);
            }
            viewer.forceRedraw?.();
            this.notify({ viewer, reason: "sampling" });
        }
        (window as any).UTILITIES?.scheduleSessionUrlSync?.();
        return true;
    }

    // ---------------------------------------------------------------- internals

    private allViewers(): any[] {
        const vm = (window as any).VIEWER_MANAGER;
        return Array.isArray(vm?.viewers) ? vm.viewers.filter(Boolean) : [];
    }

    private backgroundSplit(viewer: any, orderLength: number): number {
        const split = (window as any).UTILITIES?.getBackgroundShaderSplitIndex?.(viewer);
        return Number.isInteger(split) ? Math.min(Math.max(0, split), orderLength) : 0;
    }

    private stripNamespace(viewer: any, id: string): string {
        const ns: string = viewer?.__shaderNamespace || "";
        return ns && id.startsWith(ns) ? id.slice(ns.length) : id;
    }

    private layerConfig(viewer: any, layerId: string): any {
        try {
            return viewer?.drawer?.renderer?.getShaderLayerConfig?.(layerId) || null;
        } catch (e) {
            return null;
        }
    }

    private shaderLayer(renderer: any, layerId: string): any {
        try {
            return renderer?.getShaderLayer?.(layerId) || null;
        } catch (e) {
            return null;
        }
    }

    private dataReferencesOf(viewer: any, config: any, role: LayerRole): number[] {
        if (Array.isArray(config.dataReferences) && config.dataReferences.length) {
            return config.dataReferences.filter(Number.isInteger);
        }
        if (role !== "background") return [];
        // An implicit / reference-less background layer draws its background's data.
        const indices: number[] = Array.isArray(config.tiledImages) ? config.tiledImages : [];
        const out: number[] = [];
        for (const index of indices) {
            const ref = viewer?.world?.getItemAt?.(index)?.getConfig?.("background")?.dataReference;
            if (Number.isInteger(ref)) out.push(ref);
        }
        return out;
    }

    private worldItemsOfDataReference(viewer: any, dataReference: number): any[] {
        const items = new Set<any>();
        const world = viewer?.world;
        const count = world?.getItemCount?.() || 0;
        for (let i = 0; i < count; i++) {
            const item = world.getItemAt(i);
            if (item?.getConfig?.("background")?.dataReference === dataReference) items.add(item);
        }
        for (const layer of this.listLayers(viewer)) {
            const config = this.layerConfig(viewer, layer.id);
            const refs: number[] = Array.isArray(config?.dataReferences) ? config.dataReferences : [];
            const indices: number[] = Array.isArray(config?.tiledImages) ? config.tiledImages : [];
            refs.forEach((ref, k) => {
                if (ref !== dataReference) return;
                const item = world?.getItemAt?.(indices[k] as number);
                if (item) items.add(item);
            });
        }
        return [...items];
    }

    private pipelineNodes(config: any): any[] {
        const post = config?.params?.pipeline?.post;
        return Array.isArray(post) ? post : [];
    }

    private readValues(viewer: any, layerId: string): AdjustmentValues {
        const values: AdjustmentValues = {};
        const config = this.layerConfig(viewer, layerId);
        const shader = this.shaderLayer(viewer?.drawer?.renderer, layerId);
        const nodes = this.pipelineNodes(config);
        for (const d of this.descriptors.values()) {
            values[d.key] = d.identity;
            const node = nodes.find(n => n?.id === d.node);
            if (!node) continue;
            const control = shader?.getPipelineControl?.("post", d.node, d.control);
            const live = Number(control?.encodedValue ?? control?.value);
            const authored = Number(isObject(node.params) ? (isObject(node.params[d.control]) ? node.params[d.control].default : node.params[d.control]) : NaN);
            const value = Number.isFinite(live) ? live : authored;
            if (Number.isFinite(value)) values[d.key] = value;
        }
        return values;
    }

    private isAdjusted(values: AdjustmentValues): boolean {
        return Object.entries(values).some(([key, value]) => {
            const d = this.descriptors.get(key);
            return d ? Math.abs(value - d.identity) > 1e-6 : false;
        });
    }

    private sanitizeValues(values: any): AdjustmentValues {
        const out: AdjustmentValues = {};
        if (!isObject(values)) return out;
        for (const [key, raw] of Object.entries(values)) {
            const d = this.getDescriptor(key);
            const value = Number(raw);
            if (d && Number.isFinite(value)) out[key] = clamp(value, d);
        }
        return out;
    }

    private sanitizePresets(stored: Record<string, any>): Record<string, AdjustmentValues> {
        const out: Record<string, AdjustmentValues> = {};
        for (const [name, values] of Object.entries(stored)) {
            if (typeof name === "string" && name.length <= 64) out[name] = this.sanitizeValues(values);
        }
        return out;
    }

    private withIdentityDefaults(values: AdjustmentValues): AdjustmentValues {
        const out: AdjustmentValues = {};
        for (const d of this.descriptors.values()) out[d.key] = values[d.key] ?? d.identity;
        return out;
    }

    /** Insert the descriptor's node at its chain position. */
    private insertNode(post: any[], d: AdjustmentDescriptor) {
        // Seed every control of the node with its identity: a module's own default
        // need not be one (invert defaults to a full inversion), and the config must
        // read as "no effect" even when the control cache is lost.
        const params: Record<string, number> = {};
        for (const other of this.descriptors.values()) {
            if (other.node === d.node) params[other.control] = other.identity;
        }
        const node = { id: d.node, type: d.module, params };
        const orderOf = (n: any) => this.getDescriptors().find(x => x.node === n?.id)?.order ?? Number.POSITIVE_INFINITY;
        const at = post.findIndex(n => typeof n?.id === "string" && n.id.startsWith(NODE_PREFIX) && orderOf(n) > d.order);
        if (at < 0) post.push(node); else post.splice(at, 0, node);
    }

    /**
     * Rebuild a layer's pipeline after its node list changed, then the program.
     * Main renderer only: the drawer's navigator sync mirrors both the structure
     * (`__pipelineStructureKey`) and the control values into the navigator.
     * Silent (`evented=false`) — callers emit `shader-config-update` themselves.
     */
    private rebuildPipeline(viewer: any, shader: any, params: any) {
        shader.resetPipeline(params, false);
        this.applyBypass(viewer);
        viewer.drawer.rebuild?.(0);
    }

    private applyToLayer(viewer: any, layerId: string, patch: AdjustmentValues): boolean {
        if (!this.isSupported()) return false;
        const renderer = viewer?.drawer?.renderer;
        const config = this.layerConfig(viewer, layerId);
        const shader = this.shaderLayer(renderer, layerId);
        if (!config || !shader) return false;

        const values = this.sanitizeValues(patch);
        if (!Object.keys(values).length) return false;

        config.params = isObject(config.params) ? config.params : {};
        const pipeline = config.params.pipeline = isObject(config.params.pipeline) ? config.params.pipeline : {};
        pipeline.post = Array.isArray(pipeline.post) ? pipeline.post : [];

        let structural = false;
        for (const [key, value] of Object.entries(values)) {
            const d = this.descriptors.get(key)!;
            const present = pipeline.post.some((n: any) => n?.id === d.node);
            if (!present && Math.abs(value - d.identity) > 1e-6) {
                this.insertNode(pipeline.post, d);
                structural = true;
            }
        }
        if (!pipeline.post.length && !pipeline.pre?.length) {
            // Nothing to add and nothing there: do not leave an empty shell behind.
            delete config.params.pipeline;
        }

        if (structural) this.rebuildPipeline(viewer, shader, config.params);

        let changed = false;
        for (const [key, value] of Object.entries(values)) {
            const d = this.descriptors.get(key)!;
            const control = shader.getPipelineControl?.("post", d.node, d.control);
            if (!control || Number(control.encodedValue) === value) continue;
            control.set(value);
            changed = true;
        }
        // IControl.set uploads on the next draw but does not request one.
        if (changed) shader.invalidate?.();

        if (structural) {
            (window as any).UTILITIES?._emitShaderConfigUpdate?.(viewer, layerId, { pipeline: clone(config.params.pipeline) });
        }
        viewer.forceRedraw?.();
        viewer.navigator?.forceRedraw?.();
        this.notify({ viewer, layerId, reason: structural ? "structure" : "values" });
        return true;
    }

    private resetLayer(viewer: any, layerId: string): void {
        const renderer = viewer?.drawer?.renderer;
        const config = this.layerConfig(viewer, layerId);
        if (!config) return;
        const post = this.pipelineNodes(config);
        const kept = post.filter(n => !(typeof n?.id === "string" && n.id.startsWith(NODE_PREFIX)));
        const hadNodes = kept.length !== post.length;

        const scrub = (bucket: any) => {
            if (!isObject(bucket)) return;
            for (const key of Object.keys(bucket)) {
                if (key.startsWith(`post_${NODE_PREFIX}`)) delete bucket[key];
                else if (isObject(bucket[key])) scrub(bucket[key]);
            }
        };
        scrub(config.cache);
        if (!hadNodes) return;

        if (kept.length || config.params.pipeline?.pre?.length) config.params.pipeline.post = kept;
        else delete config.params.pipeline;

        const shader = this.shaderLayer(renderer, layerId);
        if (this.isSupported() && shader) this.rebuildPipeline(viewer, shader, config.params);
        (window as any).UTILITIES?._emitShaderConfigUpdate?.(viewer, layerId, { pipeline: clone(config.params.pipeline ?? null) });
        viewer.forceRedraw?.();
        viewer.navigator?.forceRedraw?.();
        this.notify({ viewer, layerId, reason: "reset" });
    }

    /** Push the viewer's bypass state to every layer, group children included. */
    private applyBypass(viewer: any) {
        if (!this.isBypassSupported()) return;
        const bypass = this.bypassed.has(viewer);
        // getAllShaders() is the top-level map; group children live under `shaderLayers`
        const walk = (shaders: any) => {
            for (const shader of Object.values<any>(shaders || {})) {
                shader?.setPipelineBypass?.(bypass);
                if (shader?.shaderLayers) walk(shader.shaderLayers);
            }
        };
        walk(viewer?.drawer?.renderer?.getAllShaders?.());
    }

    private matchLayer(source: any, layerId: string, target: any): string | null {
        const sourceLayer = this.listLayers(source).find(l => l.id === layerId);
        if (!sourceLayer) return null;
        const targetLayers = this.listLayers(target);
        if (sourceLayer.role === "background") {
            return targetLayers.find(l => l.role === "background" && l.roleIndex === sourceLayer.roleIndex)?.id ?? null;
        }
        const structural = this.stripNamespace(source, layerId);
        return targetLayers.find(l => l.role === "visualization" && this.stripNamespace(target, l.id) === structural)?.id ?? null;
    }

    /** Mirror a write (patch) or a reset (null) to the linked viewers. */
    private propagate(source: any, layerId: string, patch: AdjustmentValues | null) {
        if (!this.linked || this.propagating) return;
        this.propagating = true;
        try {
            for (const target of this.allViewers()) {
                if (target === source) continue;
                const match = this.matchLayer(source, layerId, target);
                if (!match) continue;
                if (patch) this.applyToLayer(target, match, patch);
                else this.resetLayer(target, match);
            }
        } finally {
            this.propagating = false;
        }
    }

    /**
     * A `visualization` scripting namespace bound to one viewer. probeData is a
     * read-only render, so no consent path is involved.
     */
    private visualizationApiFor(viewer: any): any {
        // Reached through APPLICATION_CONTEXT rather than imported: keeps this
        // broker free of the scripting stack (and unit-testable without it).
        const scripting: any = (window as any).APPLICATION_CONTEXT?.Scripting;
        const api: any = scripting?.getApi?.("visualization");
        if (!api || !viewer?.uniqueId) return null;
        const context = {
            ...(scripting.constructor?.inProcessContext?.(false) || {}),
            getActiveViewerContextId: () => viewer.uniqueId,
        };
        return api.bindInvocationContext({ scriptingContext: context });
    }
}
