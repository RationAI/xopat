/**
 * Per-viewer broker between the flex-renderer's shader-source requests and
 * xOpat's tile data. Installed as `drawer.options.shaderSourceResolver`.
 *
 * Responsibilities:
 *   - deduplicate by load key (same data already in the world => cheap rebind)
 *   - decide replace-in-place vs append based on whether the current binding
 *     is shared with other shaders
 *   - keep per-binding ref counts so series frames that become unreferenced
 *     can be recognised as eviction candidates (eviction itself is deferred
 *     to avoid invalidating integer indices stored in other shader configs)
 */

type SourceFactory = () => { tileSource: any; openOptions?: Record<string, any> };

interface ResolverContext {
    request: {
        shaderId?: string;
        sourceIndex?: number;
        entry?: any;
        reason?: string;
    };
    drawer: any;
    viewer: any;
    renderer: any;
    shader: any;
    shaderConfig: any;
}

interface ResolverResult {
    worldIndex: number;
    refreshShader?: boolean;
    rebuildProgram?: boolean;
    rebuildDrawer?: boolean;
    resetItems?: boolean;
    /**
     * In-place mutation overriding the library's default (which .slice()s the
     * array and reassigns — breaking reference-sharing with e.g. the
     * time-series delegate shader's `tiledImages`).
     */
    mutation?: (config: any) => void;
}

const TOKEN_MARK = "__xopatSourceRef";

export interface XOpatSourceToken {
    [TOKEN_MARK]: true;
    loadKey: string;
    dataIndex?: number;
    shaderType?: string;
    param?: string;
    entryIndex?: number;
}

export function isXOpatSourceToken(value: any): value is XOpatSourceToken {
    return !!(value && typeof value === "object" && value[TOKEN_MARK] === true && typeof value.loadKey === "string");
}

export function makeXOpatSourceToken(loadKey: string, extras: Partial<XOpatSourceToken> = {}): XOpatSourceToken {
    return { [TOKEN_MARK]: true, loadKey, ...extras };
}

const LOG_PREFIX = "[shaderSource]";

export class ViewerShaderSourceController {
    private readonly viewer: any;
    private readonly factories = new Map<string, SourceFactory>();
    private readonly loadKeyToWorldIndex = new Map<string, number>();
    private readonly refs = new Map<number, Set<string>>();
    /** Only tiles opened by this controller; lets us drop cache entries when the world reshapes. */
    private readonly managedItems = new WeakSet<object>();

    constructor(viewer: any) {
        this.viewer = viewer;
        console.log(`${LOG_PREFIX} controller constructed`, { viewerId: (viewer as any)?.id });

        viewer.world?.addHandler?.("remove-item", (e: any) => {
            if (!e?.item || !this.managedItems.has(e.item)) return;
            const staleIndex = this.worldIndexFor(e.item);
            this.forgetWorldIndex(staleIndex);
        });
    }

    registerDataSource(loadKey: string, factory: SourceFactory) {
        if (!this.factories.has(loadKey)) {
            this.factories.set(loadKey, factory);
        }
    }

    /**
     * Ref-count a shader binding against a world index. Called for every
     * shader config's tiledImages[] slot after normalize — including bg and
     * non-series shaders — so the resolver can correctly tell "sole user"
     * from "shared".
     */
    registerShaderBinding(worldIndex: number, shaderId: string, sourceIndex: number, loadKey?: string) {
        if (!Number.isInteger(worldIndex) || worldIndex < 0) return;
        this.addRefDirect(worldIndex, `${shaderId}:${sourceIndex}`);
        if (loadKey) this.loadKeyToWorldIndex.set(loadKey, worldIndex);
    }

    /** Reset all shader-binding refs; call before a fresh normalize pass re-populates them. */
    resetBindings() {
        this.refs.clear();
    }

    /**
     * Programmatic scrub funnel — calls into the time-series shader's `scrubTo`
     * so UI, scripting API, and session replay all route through the same
     * `requestSourceBinding` → resolver path. Returns true if the call dispatched.
     */
    scrubShaderSource(shaderId: string, offset: number): boolean {
        const renderer = (this.viewer as any)?.drawer?.renderer;
        const shader = renderer?.getShaderLayer?.(shaderId);
        if (!shader || typeof shader.scrubTo !== "function") return false;
        shader.scrubTo(offset);
        return true;
    }

    resolver = (ctx: ResolverContext): Promise<ResolverResult | null> | ResolverResult | null => {
        const request = ctx.request || {};
        const entry = request.entry;

        console.log(`${LOG_PREFIX} resolver fire`, {
            shaderId: request.shaderId,
            sourceIndex: request.sourceIndex,
            reason: request.reason,
            isToken: isXOpatSourceToken(entry),
            entry,
        });

        if (!isXOpatSourceToken(entry)) {
            return null;
        }

        const sourceIndex = Number.parseInt(request.sourceIndex as any, 10) || 0;
        const shaderId = request.shaderId || "shader";
        const bindingKey = `${shaderId}:${sourceIndex}`;
        const currentIdx = this.currentBindingIndex(ctx.shaderConfig, sourceIndex);

        const cached = this.loadKeyToWorldIndex.get(entry.loadKey);
        if (Number.isInteger(cached)) {
            console.log(`${LOG_PREFIX} cache-hit`, { bindingKey, loadKey: entry.loadKey, currentIdx, targetIdx: cached });
            this.rebindRef(currentIdx, cached as number, bindingKey);
            // Pure rebind of already-loaded tile — skip the rebuild cascade.
            return this.result(cached as number, sourceIndex, { kind: "rebind" });
        }

        const factory = this.factories.get(entry.loadKey);
        if (!factory) {
            console.warn(`${LOG_PREFIX} no factory registered for token`, entry);
            return null;
        }

        const { tileSource, openOptions } = factory();
        const currentRefs = Number.isInteger(currentIdx) ? this.refs.get(currentIdx as number) : undefined;
        const refArray = currentRefs ? Array.from(currentRefs) : [];
        const isSoleUser = !!(currentRefs && currentRefs.size === 1 && currentRefs.has(bindingKey) && Number.isInteger(currentIdx));

        // Use the current binding's tile as a geometry reference when opening
        // a replacement so the new frame aligns with the existing world.
        const referenceItem = Number.isInteger(currentIdx)
            ? this.viewer?.world?.getItemAt?.(currentIdx as number)
            : null;

        if (isSoleUser) {
            console.log(`${LOG_PREFIX} swap-in-place`, { bindingKey, loadKey: entry.loadKey, worldIndex: currentIdx, refs: refArray });
            return this.openReplace(currentIdx as number, tileSource, openOptions, referenceItem).then((worldIndex) => {
                this.forgetWorldIndex(currentIdx as number);
                this.associate(worldIndex, entry.loadKey, bindingKey);
                console.log(`${LOG_PREFIX} swap-in-place DONE`, { bindingKey, worldIndex });
                return this.result(worldIndex, sourceIndex, { kind: "swap" });
            });
        }

        console.log(`${LOG_PREFIX} append`, { bindingKey, loadKey: entry.loadKey, currentIdx, refs: refArray });
        return this.openAppend(tileSource, openOptions, referenceItem).then((worldIndex) => {
            this.removeRef(currentIdx, bindingKey);
            this.associate(worldIndex, entry.loadKey, bindingKey);
            console.log(`${LOG_PREFIX} append DONE`, { bindingKey, worldIndex });
            return this.result(worldIndex, sourceIndex, { kind: "append" });
        });
    };

    // ---- internals ----

    private currentBindingIndex(shaderConfig: any, sourceIndex: number): number | null {
        const tiledImages = shaderConfig?.tiledImages;
        if (!Array.isArray(tiledImages)) return null;
        const value = tiledImages[sourceIndex];
        return Number.isInteger(value) && value >= 0 ? value : null;
    }

    private worldIndexFor(item: any): number {
        return this.viewer?.world?.getIndexOfItem?.(item) ?? -1;
    }

    private result(
        worldIndex: number,
        sourceIndex: number,
        opts: { kind: "rebind" | "swap" | "append" }
    ): ResolverResult {
        const mutation = (config: any) => {
            // Mutate in place so references captured by delegate shaders
            // (time-series delegate holds the same tiledImages array) see
            // the updated binding without a separate propagation step.
            if (!Array.isArray(config.tiledImages)) {
                config.tiledImages = [worldIndex];
                return;
            }
            config.tiledImages[sourceIndex] = worldIndex;
        };
        return {
            worldIndex,
            // Managed-source swaps don't change shader GLSL/topology — refreshing
            // the shader instance would re-run TimeSeriesShader.construct(), which
            // resets tiledImages back to the active series entry's worldIndex
            // (because construct reads config.params.timeline.default *before*
            // super.construct() syncs it from this.timeline.encoded). That
            // clobbers the in-place mutation we just applied, so first visits to
            // a non-active frame wrongly render the active frame.
            refreshShader: false,
            rebuildProgram: false,
            // Append grew the world — atlas (sized to the previous itemCount)
            // needs to be resized via setDimensions inside _requestRebuild.
            // registerProgram inside the rebuild only re-creates shaders whose
            // `type` changed (time-series → time-series is a no-op), so this
            // path does NOT re-run construct.
            rebuildDrawer: opts.kind === "append",
            resetItems: false,
            mutation,
        };
    }

    private openAppend(tileSource: any, openOptions: Record<string, any> | undefined, referenceItem: any): Promise<number> {
        return this.addTile({ ...(openOptions || {}), tileSource, ...this.geometryFromReference(referenceItem) });
    }

    private openReplace(worldIndex: number, tileSource: any, openOptions: Record<string, any> | undefined, referenceItem: any): Promise<number> {
        const existing = this.viewer?.world?.getItemAt?.(worldIndex);
        if (!existing) {
            return this.addTile({ ...(openOptions || {}), tileSource, index: worldIndex, ...this.geometryFromReference(referenceItem) });
        }
        // OSD atomic swap: inserts new, removes the replaced one.
        return this.addTile({
            ...(openOptions || {}),
            tileSource,
            index: worldIndex,
            replace: true,
            ...this.geometryFromReference(referenceItem),
        });
    }

    /**
     * Clone bounds / clip / rotation / flip from an existing world item so the
     * newly-opened frame aligns with the pyramid currently on screen. Matches
     * what the library's own `_openManagedShaderSourceAtSlot` does.
     */
    private geometryFromReference(referenceItem: any): Record<string, any> {
        if (!referenceItem) return {};
        const out: Record<string, any> = {};
        try {
            const bounds = referenceItem.getBoundsNoRotate?.(true);
            if (bounds) {
                out.x = bounds.x;
                out.y = bounds.y;
                out.width = bounds.width;
            }
        } catch (_) {}
        try {
            const clip = referenceItem.getClip?.();
            if (clip) out.clip = clip;
        } catch (_) {}
        try {
            const rotation = referenceItem.getRotation?.();
            if (rotation !== undefined) out.rotation = rotation;
        } catch (_) {}
        try {
            const flipped = referenceItem.getFlip?.();
            if (flipped !== undefined) out.flipped = flipped;
        } catch (_) {}
        return out;
    }

    private addTile(opts: Record<string, any>): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const prevSuccess = opts.success;
            const prevError = opts.error;
            const merged = {
                opacity: 0,
                preload: false,
                preserveViewport: true,
                ...opts,
                success: (event: any) => {
                    const item = event?.item;
                    if (item) this.managedItems.add(item);
                    try { prevSuccess?.(event); } catch (e) { console.warn(e); }
                    const worldIndex = item ? this.worldIndexFor(item) : -1;
                    if (worldIndex < 0) reject(new Error("shader source opened but index is unknown"));
                    else resolve(worldIndex);
                },
                error: (event: any) => {
                    try { prevError?.(event); } catch (e) { console.warn(e); }
                    reject(new Error(event?.message || "failed to open shader source"));
                },
            };
            this.viewer.addTiledImage(merged);
        });
    }

    private associate(worldIndex: number, loadKey: string, bindingKey: string) {
        this.loadKeyToWorldIndex.set(loadKey, worldIndex);
        this.addRefDirect(worldIndex, bindingKey);
    }

    private addRefDirect(worldIndex: number, bindingKey: string) {
        let set = this.refs.get(worldIndex);
        if (!set) {
            set = new Set<string>();
            this.refs.set(worldIndex, set);
        }
        set.add(bindingKey);
    }

    private removeRef(worldIndex: number | null, bindingKey: string) {
        if (!Number.isInteger(worldIndex)) return;
        const set = this.refs.get(worldIndex as number);
        if (!set) return;
        set.delete(bindingKey);
        if (set.size === 0) this.refs.delete(worldIndex as number);
    }

    private rebindRef(fromIndex: number | null, toIndex: number, bindingKey: string) {
        this.removeRef(fromIndex, bindingKey);
        this.addRefDirect(toIndex, bindingKey);
    }

    private forgetWorldIndex(worldIndex: number | null) {
        if (!Number.isInteger(worldIndex)) return;
        this.refs.delete(worldIndex as number);
        for (const [key, value] of this.loadKeyToWorldIndex) {
            if (value === worldIndex) {
                this.loadKeyToWorldIndex.delete(key);
                break;
            }
        }
    }
}
