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
    shaders?: VisualizationShaderLayer[];
    protocol?: string;
    name?: string;
    goalIndex?: number;
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

    static from(config: BackgroundItem, registerAsSource = true): BackgroundConfig {
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

        config.id = BackgroundConfig.processId(config.id, config);
        const exists = _CONF_REGISTRY.has(config.id);
        const instance = exists ? _CONF_REGISTRY.get(config.id) : new BackgroundConfig(config, _CONF_GUARD);

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

        if (!exists) _CONF_REGISTRY.set(instance.id, instance);
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

        return out;
    }
}
(window as any).BackgroundConfig = BackgroundConfig;