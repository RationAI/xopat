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
     *
     * Mutates the passed config in place. Idempotent — running twice is safe.
     */
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
        if (legacy === undefined || legacy === null) return;

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
    }
}
(window as any).BackgroundConfig = BackgroundConfig;
