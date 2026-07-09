const _CONF_GUARD = Symbol('guard');
const _CONF_REGISTRY = new Map();

/**
 * The BackgroundConfig class is used to represent the background configuration object.
 * Unlike the BackgroundItem, which is serialized JSON representation of the background item,
 * this class is the actual background item object used in the viewer with same properties as
 * BackgroundConfig.
 */
export class BackgroundConfig implements BackgroundItem {
    _raw: any;
    _rawValue: DataID | undefined;
    // TS Fails to infer from BackgroundItem and the Object.assign(...) call below.
    declare dataReference: number | DataID;
    declare id: string;
    shaders?: VisualizationShaderGroupOrLayer[];
    protocol?: string;
    name?: string;
    visualizationIndex?: number | null;
    options?: SlideSourceOptions;
    [key: string]: any;

    constructor(data: BackgroundItem, guard: symbol) {
        if (guard !== _CONF_GUARD) {
            throw new Error('Use BackgroundConfig.from(...) to create your background!');
        }

        this._raw = { ...data };
        this._rawValue = undefined;

        const ref = data.dataReference;

        const globalData = APPLICATION_CONTEXT.config.data || [];

        if (typeof ref === "number") {
            this._rawValue = globalData[ref] ?? undefined;
        } else {
            this._rawValue = ref !== undefined ? (ref as DataID) : undefined;
        }

        delete this._raw.dataReference;
        // legacy field, just in case
        delete this._raw.dataReferences;
        Object.assign(this, this._raw);

        // --- Single dataReference property only --------------------------------
        Object.defineProperty(this, 'dataReference', {
            get: () => {
                const currentGlobalData = APPLICATION_CONTEXT.config.data || [];
                const idx = this._rawValue ? currentGlobalData.indexOf(this._rawValue) : -1;
                // If the raw value lives in the data array, expose its index
                return idx !== -1 ? idx : this._rawValue;
            },
            set: (val) => {
                const currentGlobalData = APPLICATION_CONTEXT.config.data || [];
                if (typeof val === 'number') {
                    this._rawValue = currentGlobalData[val];
                } else {
                    this._rawValue = val ?? undefined;
                }
            },
            enumerable: true
        });
    }

    static from(config: BackgroundItem, registerAsSource = true, reuseExisting = true): BackgroundConfig {
        if (!config) throw new Error('config must be defined');

        function fixRef(ref: any) {
            if (typeof ref === "string") {
                const pref = Number.parseInt(ref, 10);
                if (!Number.isNaN(pref) && String(pref) === ref) {
                    return pref;
                }
            }
            return ref;
        }

        if (config.dataReference !== undefined) {
            config.dataReference = fixRef(config.dataReference);
        } else {
            console.error("BackgroundConfig.from: dataReference is required!");
        }

        // Legacy fold: old configs / sessions use `goalIndex` on the background entry
        // for the same purpose as `visualizationIndex`. Honor it once and warn so old
        // session JSONs round-trip cleanly until they are re-saved.
        if ((config as any).goalIndex !== undefined && config.visualizationIndex === undefined) {
            config.visualizationIndex = (config as any).goalIndex as number;
            BackgroundConfig._warnLegacyGoalIndex();
        }
        delete (config as any).goalIndex;

        config.id = BackgroundConfig.processId(config.id, config);
        const exists = _CONF_REGISTRY.has(config.id);
        const instance = reuseExisting && exists
            ? _CONF_REGISTRY.get(config.id)
            : new BackgroundConfig(config, _CONF_GUARD);

        // If this background uses a literal DataID (StandaloneBackgroundItem),
        // push it into the global data list so it can be reused.
        if (registerAsSource) {
            const cfg = APPLICATION_CONTEXT._dangerouslyAccessConfig();
            cfg.data = cfg.data || [];
            const globalData = cfg.data;
            const ref = instance.dataReference;

            // dataReference is index OR DataID
            if (typeof ref !== 'number' && ref !== null && ref !== undefined) {
                if (!globalData.includes(instance._rawValue)) {
                    globalData.push(instance._rawValue);
                }
            }
        }

        if (reuseExisting && !exists) _CONF_REGISTRY.set(instance.id, instance);
        return instance;
    }

    /**
     * Get data reference ID from the configuration.
     * @param {BackgroundItem} item
     * @returns {DataID|undefined}
     */
    static data(item: BackgroundItem): DataID | undefined {
        return this.dataFromSpec(this.dataSpecification(item));
    }

    /**
     * Get data reference ID from the configuration.
     * @param {BackgroundItem} item
     * @returns {DataSpecification|undefined}
     */
    static dataSpecification(item: BackgroundItem): DataSpecification | undefined {
        return this.dataFromDataId(item.dataReference as number | DataID);
    }

    /**
     * todo: consider this exposing elsewhere, it works for viz objects too
     * @param {DataSpecification} spec
     * @return {DataID|undefined}
     */
    static dataFromSpec(spec: DataSpecification | null | undefined): DataID | undefined {
        if (spec == null) return undefined;
        return spec && typeof spec === "object" && (spec as DataOverride).dataID ? (spec as DataOverride).dataID : spec as DataID;
    }

    /**
     * Get data reference from a field that can carry both the data item or the index to data array
     * @param {DataID|number} dataId
     * @return {*|string}
     */
    static dataFromDataId(dataId: number | DataID): DataID | undefined {
        if (typeof dataId === "number") {
            const data = APPLICATION_CONTEXT.config.data;
            return data[dataId];
        }
        return dataId;
    }

    static processId(id: string | undefined, context: BackgroundItem): string {
        if (id) return UTILITIES.sanitizeID(id);

        const ref = context.dataReference;

        if (typeof ref === 'string') {
            return UTILITIES.sanitizeID(ref);
        }
        if (typeof ref === 'number') {
            const path = APPLICATION_CONTEXT.config.data[ref];
            if (path && typeof path !== "object") return UTILITIES.sanitizeID(String(path));
            if (path) return UTILITIES.generateID(JSON.stringify(path));
        }
        if (ref && typeof ref === 'object') {
            return UTILITIES.generateID(JSON.stringify(ref));
        }

        return UTILITIES.generateID("bg-" + Math.random());
    }

    toJSON() {
        const out: any = { ...this };

        // serialize a single dataReference, index-or-value exactly as getter exposes
        out.dataReference = this.dataReference;

        delete out._raw;
        delete out._rawValue;
        // Never emit the deprecated alias on write.
        delete out.goalIndex;

        return out;
    }

    private static _legacyWarned = { goalIndex: false, activeVisualizationIndex: false };

    private static _warnLegacyGoalIndex() {
        if (BackgroundConfig._legacyWarned.goalIndex) return;
        BackgroundConfig._legacyWarned.goalIndex = true;
        console.warn(
            "[BackgroundConfig] `background[i].goalIndex` is deprecated; use `visualizationIndex` instead. "
            + "The legacy field has been folded for this run; re-save your config/session to migrate."
        );
    }

    private static _warnLegacyActiveVisualizationIndex() {
        if (BackgroundConfig._legacyWarned.activeVisualizationIndex) return;
        BackgroundConfig._legacyWarned.activeVisualizationIndex = true;
        console.warn(
            "[BackgroundConfig] top-level `activeVisualizationIndex` is deprecated; visualization is now stored "
            + "per background entry as `background[i].visualizationIndex`. The legacy value has been distributed "
            + "onto bg entries for this run; re-save your config/session to migrate."
        );
    }

    /**
     * Fold legacy shape into the current model. Run at config-parse / session-restore
     * before any code reads visualization state:
     *   1. `background[i].goalIndex` → `background[i].visualizationIndex`
     *   2. top-level `activeVisualizationIndex` (number | number[]) → distributed onto
     *      `background[activeBackgroundIndex[k]].visualizationIndex` for slots that
     *      don't already carry an explicit `visualizationIndex`.
     *   3. default selection: an UNSET (`undefined`) `visualizationIndex` defaults
     *      to the first visualization when the session defines any. Explicit
     *      `null` means "no visualization" and is preserved — so a user's
     *      [no overlays] choice survives re-runs, while fresh sessions render
     *      their first visualization out of the box.
     *
     * Mutates the passed config in place. Idempotent — running twice is safe.
     */
    /**
     * Expand any *virtualized parent* background (one carrying a stored
     * `virtualization` decomposition) into first-class **child** background
     * entries — one per region. Each child gets:
     *   - a distinct explicit `id` (`<parentId>::<regionId>`) ⇒ distinct
     *     `viewer.uniqueId` ⇒ independent per-(viewer, background) overlay scope;
     *   - a `croppingContext` (region + alignment transform);
     *   - a `dataReference` that is a `virtual-region` {@link DataOverride}
     *     wrapping the parent's data id (so the child's background *image*
     *     resolves through the cropping protocol);
     *   - the parent's `visualizationIndex` / pixel-size, inherited.
     *
     * Children are appended (never inserted) so existing `background[]` indices
     * — and therefore `activeBackgroundIndex` — stay valid. Idempotent: a parent
     * that already has children (detected via `virtualOf`) is skipped, so
     * re-running on a reloaded session does not duplicate them.
     *
     * The render mode (`none` / `sidebyside` / `overlaid`) is NOT decided here —
     * it is a runtime selection transform applied by the open pipeline. Expansion
     * only materializes the children so the modes have something to select.
     *
     * Mutates the passed config in place. Run before backgrounds are wrapped via
     * {@link BackgroundConfig.from}.
     */
    static expandVirtualBackgrounds(config: any): void {
        if (!config || typeof config !== "object") return;
        const backgrounds: any[] = Array.isArray(config.background) ? config.background : [];
        if (backgrounds.length === 0) return;

        // Parents that already have expanded children present in the array.
        const expandedParents = new Set<string>();
        for (const bg of backgrounds) {
            if (bg && typeof bg === "object" && typeof bg.virtualOf === "string") {
                expandedParents.add(bg.virtualOf);
            }
        }

        // Rule: only ONE background may carry a `virtualization` split per session.
        // Mixing multiple splittable backgrounds makes child indices unpredictable
        // and the render-mode selection ambiguous. We still expand them, but warn.
        const splittable = backgrounds.filter(
            (b) => b && typeof b === "object" && b.virtualization
                && Array.isArray(b.virtualization.regions) && b.virtualization.regions.length >= 1
                && typeof b.virtualOf !== "string"
        );
        if (splittable.length > 1) {
            console.warn(
                "[BackgroundConfig] Only one background should carry a `virtualization` split per session; "
                + `found ${splittable.length}. Region-split behavior is only supported for a single parent.`
            );
        }

        const newChildren: BackgroundItem[] = [];
        for (const parent of backgrounds) {
            if (!parent || typeof parent !== "object") continue;
            const decomp: VirtualDecomposition | undefined = parent.virtualization;
            if (!decomp || !Array.isArray(decomp.regions) || decomp.regions.length < 1) continue;

            // Ensure the parent has a stable id so children can reference it.
            const parentId = parent.id = BackgroundConfig.processId(parent.id, parent);
            if (expandedParents.has(parentId)) continue; // already expanded

            const parentDataId = BackgroundConfig.data(parent);
            if (parentDataId === undefined) {
                console.warn("[BackgroundConfig] cannot expand virtual background without a resolvable data id.", parent);
                continue;
            }

            // Reference the parent the standard way: prefer the index into
            // config.data (cross-ref friendly), else the DataID value. Default
            // it from the owning background's own dataReference when unset.
            if (decomp.dataReference === undefined) {
                decomp.dataReference = parent.dataReference;
            }
            // Migrate the obsolete `parentTileSourceId` field (renamed to
            // `dataReference`): it is no longer read, so drop it so it doesn't
            // linger in re-exported sessions.
            if ((decomp as any).parentTileSourceId !== undefined) {
                delete (decomp as any).parentTileSourceId;
            }

            for (const region of decomp.regions) {
                if (!region || !region.region || !region.transform) {
                    console.warn("[BackgroundConfig] skipping malformed virtual region.", region);
                    continue;
                }
                // Region is a crop rect in RELATIVE fractions (0..1) of the slide.
                // It must lie within the slide: x+w<=1 and y+h<=1. Out-of-bounds
                // regions are CLAMPED to the slide edge at render time (you can't
                // crop pixels that don't exist), which silently shrinks w/h — warn.
                const rr = region.region as VirtualRegionRect;
                const eps = 1e-6;
                if (rr.x < -eps || rr.y < -eps || rr.w <= 0 || rr.h <= 0
                    || rr.x + rr.w > 1 + eps || rr.y + rr.h > 1 + eps) {
                    console.warn(
                        `[BackgroundConfig] virtual region "${region.id}" is out of bounds `
                        + `(x+w=${(rr.x + rr.w).toFixed(3)}, y+h=${(rr.y + rr.h).toFixed(3)}; must be <= 1). `
                        + "It will be clamped to the slide edge, shrinking its width/height."
                    );
                }
                const croppingContext: VirtualCroppingContext = {
                    region: region.region,
                    transform: region.transform,
                };
                const childId = UTILITIES.sanitizeID(`${parentId}::${region.id}`);
                const child: BackgroundItem = {
                    id: childId,
                    virtualOf: parentId,
                    visualizationIndex: parent.visualizationIndex,
                    name: parent.name ? `${parent.name} — ${region.id}` : childId,
                    croppingContext,
                    // The child's background IMAGE resolves through the
                    // virtual-region protocol; the cropping context rides on the
                    // DataOverride so the factory can wrap the parent source.
                    dataReference: {
                        dataID: parentDataId,
                        protocol: "virtual-region",
                        croppingContext,
                    } as DataOverride,
                };
                // Pixel size is unchanged by cropping — inherit so the scalebar
                // stays correct in the child viewer.
                if (parent.microns !== undefined) child.microns = parent.microns;
                if (parent.micronsX !== undefined) child.micronsX = parent.micronsX;
                if (parent.micronsY !== undefined) child.micronsY = parent.micronsY;
                newChildren.push(child);
            }
        }

        if (newChildren.length) backgrounds.push(...newChildren);
        config.background = backgrounds;
    }

    static migrateLegacyConfig(config: any): void {
        if (!config || typeof config !== "object") return;

        const backgrounds: any[] = Array.isArray(config.background) ? config.background : [];
        for (const bg of backgrounds) {
            if (!bg || typeof bg !== "object") continue;
            if (bg.goalIndex !== undefined && bg.visualizationIndex === undefined) {
                bg.visualizationIndex = bg.goalIndex;
                BackgroundConfig._warnLegacyGoalIndex();
            }
            delete bg.goalIndex;
        }

        const params: any = config.params || {};
        const legacy = params.activeVisualizationIndex !== undefined
            ? params.activeVisualizationIndex
            : config.activeVisualizationIndex;
        if (legacy === undefined || legacy === null) {
            // No legacy distribution to fold — apply the default selection
            // (step 3) and finish.
            BackgroundConfig._applyDefaultVisualizationIndex(config, backgrounds);
            return;
        }

        const activeBg = Array.isArray(params.activeBackgroundIndex)
            ? params.activeBackgroundIndex
            : (Number.isInteger(params.activeBackgroundIndex) ? [params.activeBackgroundIndex] : []);

        const asArray = Array.isArray(legacy) ? legacy : [legacy];
        const broadcast = Number.isInteger(asArray[0]) ? asArray[0] : undefined;

        const targetBgIndices = activeBg.length > 0
            ? activeBg
            : backgrounds.map((_, i) => i);

        for (let slot = 0; slot < targetBgIndices.length; slot++) {
            const bgIdx = targetBgIndices[slot];
            if (!Number.isInteger(bgIdx)) continue;
            const bg = backgrounds[bgIdx];
            if (!bg || typeof bg !== "object") continue;
            if (bg.visualizationIndex !== undefined) continue;
            const slotValue = slot < asArray.length ? asArray[slot] : broadcast;
            if (Number.isInteger(slotValue)) {
                bg.visualizationIndex = slotValue;
            } else if (slotValue === null) {
                bg.visualizationIndex = null;
            } else if (broadcast !== undefined) {
                bg.visualizationIndex = broadcast;
            }
        }

        BackgroundConfig._warnLegacyActiveVisualizationIndex();

        // Consume — never re-emit. The pipeline / readers now go via bg entries.
        if (params.activeVisualizationIndex !== undefined) delete params.activeVisualizationIndex;
        if (config.activeVisualizationIndex !== undefined) delete config.activeVisualizationIndex;

        // Slots the legacy distribution left untouched still get the default.
        BackgroundConfig._applyDefaultVisualizationIndex(config, backgrounds);
    }

    /**
     * Step 3 of {@link migrateLegacyConfig}: sessions that define
     * visualizations but leave a bg entry's `visualizationIndex` UNSET
     * render the first visualization by default. Explicit `null`
     * ("no visualization", written by the UI's [no overlays] selection)
     * is preserved. Runs after legacy folding so distributed legacy
     * values win over the default.
     */
    private static _applyDefaultVisualizationIndex(config: any, backgrounds: any[]): void {
        const visualizations = config?.visualizations;
        if (!Array.isArray(visualizations) || visualizations.length === 0) return;
        for (const bg of backgrounds) {
            if (!bg || typeof bg !== "object") continue;
            if (bg.visualizationIndex === undefined) {
                bg.visualizationIndex = 0;
            }
        }
    }
}
(window as any).BackgroundConfig = BackgroundConfig;
