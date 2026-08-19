// noinspection JSUnresolvedVariable

OSDAnnotations.Preset = class {
    /**
     * @typedef OSDAnnotations.PresetMeta
     * @type {Object<string,OSDAnnotations.PresetMetaItem>}
     */

    /**
     * @typedef OSDAnnotations.PresetMetaItem
     * @property {string} name
     * @property {string} value
     */

    /**
     * Preset: object that pre-defines the type of annotation to be created, along with its parameters
     * @param {string} id
     * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory
     * @param {string} category default category meta data
     * @param {string} color fill color
     */
    constructor(id, objectFactory = null, category = "", color = "") {
        if (!(objectFactory instanceof OSDAnnotations.AnnotationObjectFactory)) throw "Invalid preset constructor!";
        this.color = color;
        this.objectFactory = objectFactory;
        this.presetID = id;
        /**
         * @type {OSDAnnotations.PresetMeta}
         */
        this.meta = {};
        this.meta.category = {
            name: 'Name',
            value: category
        };
        this._used = false;
        this._tmp = {};
    }

    /**
     * Create the object from JSON representation
     * @param {object} parsedObject serialized object, output of toJSONFriendlyObject()
     * @param {string} parsedObject.color
     * @param {string} parsedObject.factoryID
     * @param {string} parsedObject.presetID
     * @param {OSDAnnotations.PresetMeta} [parsedObject.meta]
     * @param {Object<string,any>} [parsedObject.temporary] temporary data to attach, optional
     * @param {OSDAnnotations} context function able to get object factory from id
     * @return {OSDAnnotations.Preset} instantiated preset
     */
    static fromJSONFriendlyObject(parsedObject, context) {
        // Presets written by an older xOpat may name a retired factory.
        const factoryID = OSDAnnotations.resolveFactoryID(parsedObject.factoryID);
        let factory = context.getAnnotationObjectFactory(factoryID);
        let factoryIDOverride = undefined;
        if (factory === undefined) {
            // Unknown factory (e.g. a shape registered only in another
            // deployment): keep the preset instead of dropping it, so
            // annotations referencing it keep their class/color binding.
            // Render with the polygon factory as a stand-in, but preserve
            // the original factory id so re-export round-trips the data
            // unchanged (no silent misrepresentation on the wire).
            factory = context.getAnnotationObjectFactory("polygon");
            if (factory === undefined) {
                throw new Error(`[OSDAnnotations.Preset] unknown factory "${parsedObject.factoryID}" and no polygon stand-in available`);
            }
            factoryIDOverride = parsedObject.factoryID;
            const Dialogs = (globalThis).Dialogs;
            Dialogs?.show?.(
                $.t('presets.unknownFactory', { ns: 'annotations', factory: parsedObject.factoryID }),
                5000, Dialogs.MSG_WARN);
        }

        const id = typeof parsedObject.presetID === "string" ? parsedObject.presetID : `${parsedObject.presetID}`;
        let preset = new this(id, factory, "", parsedObject.color);
        if (parsedObject.meta) {
            preset.meta = parsedObject.meta;
        }
        if (factoryIDOverride) {
            preset._factoryIDOverride = factoryIDOverride;
        }
        preset._used = true; //keep imported
        preset._tmp = parsedObject.temporary || {};
        return preset;
    }

    /**
     * Convert the preset to JSON-friendly object
     * @return {{color: string, factoryID: string, meta: OSDAnnotations.PresetMeta, presetID: string}}
     */
    toJSONFriendlyObject() {
        return {
            color: this.color,
            // A stand-in factory (unknown shape at import time) must not
            // leak its own id into exports — round-trip the original.
            factoryID: this._factoryIDOverride ?? this.objectFactory.factoryID,
            presetID: this.presetID,
            meta: this.meta
        };
    }

    /**
     * Read name of a meta value
     * @param {string} key meta key
     * @return {string} meta name
     */
    getMetaName(key) {
        return this.meta[key] ? this.meta[key].name : undefined;
    }

    /**
     * Read value of a metadata
     * @param {string} key meta key
     * @return {string} meta value
     */
    getMetaValue(key) {
        return this.meta[key] ? this.meta[key].value : undefined;
    }

    /**
     * Temporary Metadata, not exported
     * @param {string} key
     * @param {any} value
     */
    setTemporaryMeta(key, value) {
        this._tmp[key] = value;
    }

    /**
     * Temporary Metadata, not exported
     * @param {string} key
     * @param {any} defaultValue
     */
    getTemporaryMeta(key, defaultValue) {
        const value = this._tmp[key];
        return value === undefined ? defaultValue : value;
    }
}; // end of namespace Preset

/**
 * Preset manager, takes care of GUI and management of presets.
 * Provides API to objects to obtain object options. Has left and right
 * attributes that specify what preset is being active for the left or right button respectively.
 */
OSDAnnotations.PresetManager = class {

    /**
     * Shared options, set to each annotation object.
     * @typedef {Object} OSDAnnotations.CommonAnnotationVisuals
     * @property {boolean} [selectable] - Whether the annotation is selectable.
     * @property {number} [originalStrokeWidth] - The original width of the stroke.
     * @property {string} [borderColor] - The color of the border.
     * @property {string} [cornerColor] - The color of the corners.
     * @property {string} [stroke] - The color of the stroke.
     * @property {string} [strokeSide] - Position of the stroke (center, inside, outside).
     * @property {number} [borderScaleFactor] - The factor by which the border is scaled.
     * @property {boolean} [hasControls] - Whether the annotation has controls.
     * @property {boolean} [lockMovementY] - Whether movement along the Y-axis is locked.
     * @property {boolean} [lockMovementX] - Whether movement along the X-axis is locked.
     * @property {boolean} [hasRotatingPoint] - Whether the annotation has a rotating point.
     * @property {boolean} [modeOutline] - Whether the annotation is in outline mode.
     * @property {number} [opacity]
     */

    /**
     * Default visual settings for annotations.
     * todo make this cache-loaded, parametrized
     * @type {OSDAnnotations.CommonAnnotationVisuals}
     */
    static commonAnnotationVisuals = {
        selectable: true,
        originalStrokeWidth: 3,
        borderColor: 'rgba(251,184,2,0.35)',
        cornerColor: 'rgba(251, 185, 2, 1)',
        stroke: 'black',
        borderScaleFactor: 3,
        strokeSide: 'center',
        hasControls: true,
        hasBorders: false,
        lockMovementY: true,
        lockMovementX: true,
        hasRotatingPoint: false,
        modeOutline: false,
        opacity: 0.4
    };

    /**
     * Create Preset Manager
     * @param {string} selfName name of the property 'self' in parent (not used)
     * @param {OSDAnnotations} context parent context
     */
    constructor(selfName, context) {
        this._context = context;
        this._presets = new Map();
        //active presets for mouse buttons, default state create one
        this.left = undefined;
        this.right = undefined;
        this._colorSteps = 8;
        this._colorStep = 0;
        this._presetsImported = false;  // todo remove this prop

        const cache = this._context.cache;
        this.commonAnnotationVisuals = { ... this.constructor.commonAnnotationVisuals };

        //todo: consider cache api that supports type conversions
        const _parseCachedProps = (convertor, ...names) => {
            for (let name of names) {
                const value = cache.get('visuals.' + name);
                if (value !== undefined && value !== null) {
                    this.commonAnnotationVisuals[name] = convertor ? convertor(value) : value;
                }
            }
        };
        _parseCachedProps(x => !!x, 'modeOutline');
        _parseCachedProps(x => Number.parseFloat(x), 'opacity');
        _parseCachedProps(x => Number.parseInt(x), 'originalStrokeWidth');
        _parseCachedProps(undefined, 'borderColor', 'cornerColor', 'stroke');

        this._context.addHandler('preset-delete', e => {
            if (e.preset === this.left) this.selectPreset(undefined, true);
            else if (e.preset === this.right) this.selectPreset(undefined, false);
        });
    }

    /**
     * Get default unknown preset: this preset is used when annotation references unknown preset ID
     * @type {OSDAnnotations.Preset}
     */
    get unknownPreset() {
        if (!this._unknownPreset) {
            this._unknownPreset = new OSDAnnotations.Preset("__unknown__", this._context.polygonFactory, "Unknown", "#adadad");
        }
        return this._unknownPreset;
    }

    getActivePreset(isLeftClick) {
        return isLeftClick ? this.left : this.right;
    }

    /**
     * Ensure a preset is bound to the given mouse button, auto-selecting one
     * on demand so click-down handlers never fall through into the "no preset"
     * warning dialog. Prefers an already-existing preset; only fabricates a
     * default "unknown" preset when the deployment opts in
     * (provideDefaultPresets) and no presets exist yet.
     * @param {boolean} [isLeftClick=true] mouse-button binding to fill
     * @return {OSDAnnotations.Preset|undefined} the now-active preset, or
     *   undefined if none exists and default creation is disabled
     */
    ensureActivePreset(isLeftClick = true) {
        let preset = this.getActivePreset(isLeftClick);
        if (preset) return preset;

        if (this._presets.size > 0) {
            preset = this._presets.values().next().value;
        } else if (this._context._provideDefaultPresets) {
            preset = this.addPreset('unknown', 'Unknown', '#898989');
        } else {
            return undefined;
        }
        this.selectPreset(preset.presetID, isLeftClick);
        return preset;
    }

    getAnnotationOptionsFromInstance(preset, asLeftClick=true) {
        let result = this._populateObjectOptions(preset);
        result.isLeftClick = asLeftClick;
        return this._withDynamicOptions(result);
    }

    /**
     * Get data to set as annotation properties (look, metadata...)
     * @param {boolean} isLeftClick true if the data should be with preset data bound to the left mouse button
     * @returns {object} data to populate fabric object with (parameter 'options'
     * in AnnotationObjectFactory::create(..))
     */
    getAnnotationOptions(isLeftClick) {
        let preset = this.getActivePreset(isLeftClick);
        return this.getAnnotationOptionsFromInstance(preset, isLeftClick);
    }

    /**
     * Add new preset with default values
     * @param {string} [id] to create, generates random otherwise
     * @param {string} [categoryName=""] custom name
     * @param {string} [color] hex color
     * @param {OSDAnnotations.AnnotationObjectFactory} [factory] optional factory binding;
     *      defaults to the module's polygonFactory so existing callers are unchanged
     * @event preset-create
     * @returns {OSDAnnotations.Preset} newly created preset
     */
    addPreset(id=undefined, categoryName="", color=undefined, factory=undefined) {
        const objFactory = factory || this._context.polygonFactory;
        let preset = new OSDAnnotations.Preset(id || Date.now().toString(), objFactory, categoryName, color || this.randomColorHexString());
        const ok = this._mutate('create', preset.presetID, preset.toJSONFriendlyObject(),
            () => {
                this._presets.set(preset.presetID, preset);
                this._context.raiseEvent('preset-create', {preset: preset});
            },
            () => {
                this._presets.delete(preset.presetID);
                this._context.raiseEvent('preset-delete', {preset: preset});
            });
        return ok ? preset : undefined;
    }

    /**
     * Route a preset mutation through the `crud:preset` resource so guards run
     * BEFORE the local change lands, and so a server refusal can put it back.
     *
     * Previously the module mirrored `preset-*` events into the resource
     * (`annotations.js`), which dispatched *after* the palette had already
     * changed — a rights guard could only produce a toast about a preset that
     * was already gone.
     *
     * `skipHistory: true` on purpose: presets are configuration, not user
     * drawing steps, and putting them on the undo stack would interleave with
     * the annotations that reference them. `inverseApply` exists solely for
     * revert-on-refusal.
     *
     * @param {"create"|"update"|"delete"} direction
     * @param {string} presetID
     * @param {object|undefined} payload wire payload (full item on create, patch on update)
     * @param {function} apply local mutation + its event
     * @param {function} inverseApply undo of `apply`, used only if a sink refuses
     * @param {object} [inversePayload] wire payload the inverse op carries
     * @return {boolean} whether the mutation was applied locally
     * @private
     */
    _mutate(direction, presetID, payload, apply, inverseApply, inversePayload=undefined) {
        const resource = this._context.presetResource;
        if (!resource) {
            // Pre-IO boot (or a host that never called initIO): behave as before.
            apply();
            return true;
        }
        const options = {
            apply, inverseApply, inversePayload,
            skipHistory: true,
            meta: { kind: `preset-${direction}`, presetID },
        };
        const result = direction === 'create' ? resource.create(payload, options)
            : direction === 'delete' ? resource.delete(presetID, options)
            : resource.update(presetID, payload, options);
        return !!result.ok;
    }

    /**
     * Check whether preset has been modified or whether it is a default-valued item
     * so that it can be e.g. removed automatically
     * @param {OSDAnnotations.Preset} p
     * @return {boolean}
     */
    isUnusedPreset(p) {
        return !p._used && p.objectFactory == this._context.polygonFactory
            && !p.meta.category?.value
            && Object.keys(p.meta).length === 1;
    }

    /**
     * Alias for static commonAnnotationVisuals
     * @param {OSDAnnotations.Preset} withPreset
     */
    getCommonProperties(withPreset=undefined) {
        if (withPreset) {
            withPreset._used = true;
            return this._withDynamicOptions(this._populateObjectOptions(withPreset));
        }
        return this._withDynamicOptions(this.commonAnnotationVisuals);
    }

    get length() {
        return this._presets.size;
    }

    /**
     * Check if preset exists
     * @param {string} id preset id
     * @returns true if exists
     */
    exists(id) {
        if (this._unknownPreset && id === this._unknownPreset.presetID) return true;
        return this._presets.has(id);
    }

    /**
     * Presets getter
     * @param {string} [id=undefined] preset id, if not set get the first preset
     * @returns {OSDAnnotations.Preset} preset instance
     */
    get(id = undefined) {
        // `unknownPreset` is a lazy fallback object that lives outside the
        // `_presets` Map. `checkAnnotation` stamps its sentinel `__unknown__`
        // id onto imported objects when no real presets exist, and downstream
        // `presets.get(id)` lookups must resolve it back — otherwise every
        // render path early-returns and selection/delete appear broken.
        if (this._unknownPreset && id === this._unknownPreset.presetID) {
            return this._unknownPreset;
        }
        if (!id && this._presets.size > 0) {
            if (this._presets.size > 1) {
                return this._presets.values().next().value;
            }
            return this.unknownPreset;
        }
        return this._presets.get(id);
    }

    /**
     * Presets getter
     * @returns {MapIterator<any>} preset ids
     */
    getExistingIds() {
        return this._presets.keys();
    }

    /**
     * Presets getter, creates if it does not exist
     * @param {string} id preset id
     * @param {string?} categoryName name to set
     * @returns {OSDAnnotations.Preset} preset instance
     */
    getOrCreate(id, categoryName="") {
        return this.get(id) || this.addPreset(id, categoryName);
    }

    // ── class vocabulary ────────────────────────────────────────────────────

    /**
     * @typedef {Object} OSDAnnotations.PresetVocabularyEntry
     * @property {string} value the class value stored on the preset and sent upstream
     * @property {string} [label] human-readable name; defaults to `value`
     * @property {string} [color] hex color to seed the preset with
     * @property {string} [description]
     * @property {boolean} [creatable=true] whether the USER may pick this class.
     *   `false` marks a value that legitimately exists upstream but that this
     *   session may not author — a class produced by an analysis, say. Such a value
     *   must still be accepted (otherwise importing the data that carries it would
     *   fail), it simply is not offered in the picker.
     */

    /**
     * Constrain which annotation classes may exist.
     *
     * A destination whose class vocabulary is closed (EMPAIA's EAD namespaces are
     * the motivating case: `POST /classes` answers 400 for anything outside
     * `GET /class-namespaces`) declares it here instead of letting the user mint
     * values that are then dropped on the way out. A dropped class is worse than a
     * refused one — the geometry is stored, the classification silently is not, and
     * the session is lossy in a way nothing in the UI reveals.
     *
     * Enforcement is at the IO checkpoint, not in the UI: presets already route
     * every create/update/delete through `crud:preset` ({@link _mutate}), so one
     * guard covers the preset editor, scripting, and any future entry point, and a
     * refusal surfaces through the pipeline's normal toast path.
     *
     * "Unclassified" is not a special preset kind — it is simply a preset carrying
     * no `metaKey` meta, which every convertor already exports as a classless
     * annotation. Keeping it available (the default) is what lets a user draw
     * without first deciding on a class.
     *
     * @param {Object} spec
     * @param {string} spec.ownerUid uid of the element declaring the constraint;
     *   also the guard owner, so an operator can disable it through `io.disabled`
     * @param {string} spec.metaKey preset meta key carrying the class value
     * @param {OSDAnnotations.PresetVocabularyEntry[]} spec.values allowed classes
     * @param {boolean} [spec.allowFreeform=false] when false, a class value outside
     *   `values` is refused; when true the vocabulary is a suggestion list only
     * @param {boolean} [spec.allowUnclassified=true] whether a preset may carry no
     *   class at all
     * @event preset-vocabulary-changed
     * @return {function} disposer restoring the previous (usually absent) vocabulary
     */
    setVocabulary(spec) {
        if (!spec || typeof spec.metaKey !== "string" || !spec.metaKey) {
            throw new Error("[OSDAnnotations.PresetManager] setVocabulary requires a metaKey.");
        }
        const values = Array.isArray(spec.values) ? spec.values : [];
        const vocabulary = {
            ownerUid: String(spec.ownerUid ?? this._context.uid),
            metaKey: spec.metaKey,
            allowFreeform: spec.allowFreeform === true,
            allowUnclassified: spec.allowUnclassified !== false,
            values: values
                .map(v => (typeof v === "string" ? { value: v } : v))
                .filter(v => v && typeof v.value === "string" && v.value)
                .map(v => this._normalizeVocabularyEntry(v)),
        };
        vocabulary.index = new Map(vocabulary.values.map(v => [v.value, v]));

        const previous = this._vocabulary;
        this._disposeVocabularyGuard?.();
        this._disposeVocabularyGuard = undefined;
        this._vocabulary = vocabulary;
        if (!vocabulary.allowFreeform) this._installVocabularyGuard(vocabulary);
        this._context.raiseEvent('preset-vocabulary-changed', {vocabulary});

        let disposed = false;
        return () => {
            // Only the current vocabulary may be torn down by its own disposer;
            // a later declaration has already replaced the guard.
            if (disposed || this._vocabulary !== vocabulary) return;
            disposed = true;
            this._disposeVocabularyGuard?.();
            this._disposeVocabularyGuard = undefined;
            this._vocabulary = previous;
            if (previous && !previous.allowFreeform) this._installVocabularyGuard(previous);
            this._context.raiseEvent('preset-vocabulary-changed', {vocabulary: previous});
        };
    }

    /** @private */
    _normalizeVocabularyEntry(v) {
        return {
            value: v.value,
            label: typeof v.label === "string" && v.label ? v.label : v.value,
            color: typeof v.color === "string" ? v.color : undefined,
            description: typeof v.description === "string" ? v.description : undefined,
            creatable: v.creatable !== false,
        };
    }

    /**
     * Teach the vocabulary about a class value that arrived from the destination.
     *
     * Import is the case this exists for: a closed vocabulary describes what the
     * user may *author*, but the data coming back may legitimately carry classes
     * this session could never post (an analysis's own output classes). Refusing
     * those on the way in would lose them; offering them in the picker would let
     * the user author something the destination rejects. So they are admitted as
     * `creatable: false` — accepted everywhere, offered nowhere.
     *
     * @param {Array<OSDAnnotations.PresetVocabularyEntry|string>} entries
     * @event preset-vocabulary-changed
     * @return {boolean} whether anything was actually new
     */
    extendVocabulary(entries) {
        const vocabulary = this._vocabulary;
        if (!vocabulary || !Array.isArray(entries)) return false;
        let changed = false;
        for (const raw of entries) {
            const candidate = typeof raw === "string" ? { value: raw } : raw;
            if (!candidate || typeof candidate.value !== "string" || !candidate.value) continue;
            if (vocabulary.index.has(candidate.value)) continue;
            const entry = this._normalizeVocabularyEntry({ creatable: false, ...candidate });
            vocabulary.values.push(entry);
            vocabulary.index.set(entry.value, entry);
            changed = true;
        }
        if (changed) this._context.raiseEvent('preset-vocabulary-changed', {vocabulary});
        return changed;
    }

    /**
     * The active class vocabulary, or undefined when classes are unconstrained.
     * @return {Object|undefined}
     */
    get vocabulary() {
        return this._vocabulary;
    }

    /**
     * Class value a preset carries under the active vocabulary.
     * @param {OSDAnnotations.Preset|string} presetOrId
     * @return {string|undefined} undefined when unclassified or no vocabulary
     */
    classValueOf(presetOrId) {
        const vocabulary = this._vocabulary;
        if (!vocabulary) return undefined;
        const preset = typeof presetOrId === "object" ? presetOrId : this._presets.get(presetOrId);
        const value = preset?.getMetaValue?.(vocabulary.metaKey);
        return typeof value === "string" && value ? value : undefined;
    }

    /**
     * Vocabulary entries not yet represented by a preset — what a "new class"
     * picker should offer. Excludes values admitted for import only
     * (`creatable: false`).
     * @return {OSDAnnotations.PresetVocabularyEntry[]}
     */
    unusedVocabularyEntries() {
        const vocabulary = this._vocabulary;
        if (!vocabulary) return [];
        const taken = new Set();
        for (const preset of this._presets.values()) {
            const value = this.classValueOf(preset);
            if (value) taken.add(value);
        }
        return vocabulary.values.filter(v => v.creatable && !taken.has(v.value));
    }

    /**
     * Create a preset for one vocabulary entry in a SINGLE dispatch.
     *
     * `addPreset` + `addCustomMeta` would be two `crud:preset` operations for one
     * user gesture — two guard runs, two outbox entries, and a window in which the
     * preset exists without its class.
     * @param {string} classValue must be in the vocabulary unless it allows freeform
     * @param {string} [id] preset id, defaults to the class value
     * @param {OSDAnnotations.AnnotationObjectFactory} [factory]
     * @return {OSDAnnotations.Preset|undefined}
     */
    addVocabularyPreset(classValue, id=undefined, factory=undefined) {
        const vocabulary = this._vocabulary;
        if (!vocabulary) return undefined;
        const entry = vocabulary.index.get(classValue);
        if (!entry && !vocabulary.allowFreeform) return undefined;

        const label = entry?.label ?? classValue;
        const objFactory = factory || this._context.polygonFactory;
        const preset = new OSDAnnotations.Preset(
            id || classValue, objFactory, label, entry?.color || this.randomColorHexString());
        preset.meta[vocabulary.metaKey] = {
            name: $.t('presets.classMetaName', { ns: 'annotations' }),
            value: classValue,
        };
        const ok = this._mutate('create', preset.presetID, preset.toJSONFriendlyObject(),
            () => {
                this._presets.set(preset.presetID, preset);
                this._context.raiseEvent('preset-create', {preset: preset});
            },
            () => {
                this._presets.delete(preset.presetID);
                this._context.raiseEvent('preset-delete', {preset: preset});
            });
        return ok ? preset : undefined;
    }

    /**
     * Refuse any preset mutation whose resulting class value is outside the
     * vocabulary. Runs below the read-only guard (priority 1000) — "you may not
     * touch this at all" is the stronger statement and should be heard first.
     * @private
     */
    _installVocabularyGuard(vocabulary) {
        const pipeline = globalThis.IO_PIPELINE;
        if (!pipeline?.registerGuard) return;

        const resultingClass = (ctx, item) => {
            // A delete removes a class, never introduces one.
            if (ctx?.direction === 'pre-delete') return { checked: false };
            const meta = item?.meta;
            if (meta && typeof meta === "object") {
                // Whole-map patch (addCustomMeta / deleteCustomMeta) and create.
                const value = meta[vocabulary.metaKey]?.value;
                return { checked: true, value: typeof value === "string" && value ? value : undefined };
            }
            // updatePreset shorthand: a meta key may appear as a flat patch entry.
            if (item && Object.prototype.hasOwnProperty.call(item, vocabulary.metaKey)) {
                const value = item[vocabulary.metaKey];
                return { checked: true, value: typeof value === "string" && value ? value : undefined };
            }
            return { checked: false };
        };

        this._disposeVocabularyGuard = pipeline.registerGuard({
            ownerId: vocabulary.ownerUid,
            resource: "preset",
            direction: "*",
            priority: 900,
            handler: (ctx, item) => {
                if (ctx?.direction !== 'pre-create' && ctx?.direction !== 'pre-update') return { ok: true };
                const { checked, value } = resultingClass(ctx, item);
                if (!checked) return { ok: true };
                if (value === undefined) {
                    if (vocabulary.allowUnclassified) return { ok: true };
                    return {
                        ok: false, refused: true,
                        reason: "a class value is required by the active vocabulary",
                        userMessage: $.t('presets.vocabularyRequiresClass', { ns: 'annotations' }),
                        code: "W_ANNOTATION_CLASS_REQUIRED",
                    };
                }
                if (vocabulary.index.has(value)) return { ok: true };
                return {
                    ok: false, refused: true,
                    reason: `class "${value}" is not in the active vocabulary`,
                    userMessage: $.t('presets.vocabularyUnknownClass', { ns: 'annotations', value }),
                    code: "W_ANNOTATION_CLASS_UNKNOWN",
                };
            },
        });
    }

    /**
     * Safely remove preset
     * @event preset-delete
     * @param {string} id preset id
     * @returns {OSDAnnotations.Preset|false|null} deleted preset or false if deletion failed or null if
     *   deletion was not possible (e.g. preset is used by existing annotations)
     */
    removePreset(id) {
        let toDelete = this._presets.get(id);
        if (!toDelete) return false;

        if (this._context.fabric.canvas._objects.some(o => {
            return o.presetID === id;
        })) {
            Dialogs.show($.t('presets.inUseCannotDelete', { ns: 'annotations' }), 8000, Dialogs.MSG_WARN);
            return null;
        }
        const ok = this._mutate('delete', id, undefined,
            () => {
                this._presets.delete(id);
                this._context.raiseEvent('preset-delete', {preset: toDelete});
            },
            () => {
                this._presets.set(id, toDelete);
                this._context.raiseEvent('preset-create', {preset: toDelete});
            },
            toDelete.toJSONFriendlyObject());
        // `null` is this method's established "could not delete" outcome.
        return ok ? toDelete : null;
    }

    /**
     * Update preset properties
     * @event preset-update
     * @param {string} id preset id
     * @param {object} properties to update in the preset (keys must match)
     * @return updated preset in case any value changed, undefined otherwise
     */
    updatePreset(id, properties) {
        let preset = this._presets.get(id);
        if (!preset) return undefined;

        // Collect the effective patch and its inverse BEFORE mutating, so the
        // dispatch (and any guard) sees what is about to change rather than
        // what already did.
        const patch = {}, inverse = {};
        for (let key in properties) {
            let value = properties[key];

            if (preset.hasOwnProperty(key)) {
                if (preset[key] !== value) {
                    patch[key] = value;
                    inverse[key] = preset[key];
                }
            } else if (preset.meta[key] && preset.meta[key].value !== value) {
                patch[key] = value;
                inverse[key] = preset.meta[key].value;
            }
        }
        if (!Object.keys(patch).length) return undefined;

        const write = (values) => {
            for (let key in values) {
                if (preset.hasOwnProperty(key)) preset[key] = values[key];
                else if (preset.meta[key]) preset.meta[key].value = values[key];
            }
            this._context.raiseEvent('preset-update', {preset: preset});
        };
        const ok = this._mutate('update', id, patch,
            () => write(patch), () => write(inverse), inverse);
        return ok ? preset : undefined;
    }

    /**
     * Add or update a metadata field of a preset.
     *
     * Program-owned fields (a mapping the code re-reads later) should pass their
     * own stable `key` and read back with {@link OSDAnnotations.Preset#getMetaValue}:
     * keys round-trip through export/import verbatim, and a repeated write updates
     * the field in place instead of piling up duplicates. Omit `key` for user-typed
     * rows, where the UI keeps the returned key alive with the row it renders.
     *
     * @event preset-meta-add
     * @event preset-update
     * @param {string} id preset id
     * @param {string} name new meta field name
     * @param {string} value default value
     * @param {string} [key] stable caller-chosen meta key; generated when omitted
     * @return {string|undefined} the meta key, undefined if no preset found
     */
    addCustomMeta(id, name, value, key=undefined) {
        let preset = this._presets.get(id);
        if (!preset) return undefined;
        // Two fields added within the same millisecond would otherwise share a
        // key and silently overwrite each other.
        if (key === undefined) {
            key = "k" + Date.now() + "_" + (this._metaKeySeq = (this._metaKeySeq || 0) + 1);
        }
        const existing = preset.meta[key];
        // Re-writing an unchanged field is a no-op: hydration paths call this on
        // every restore and must not churn the guard/outbox with empty updates.
        if (existing && existing.name === name && existing.value === value) return key;
        const prevMeta = {...preset.meta};
        const nextMeta = {...preset.meta, [key]: { name: name, value: value }};
        // The wire payload is the whole meta map in both branches: a flat
        // {[key]: value} patch cannot express a rename of `name`, which would
        // leave a guard/sink describing a different change than the one applied.
        const ok = this._mutate('update', id, {meta: nextMeta},
            () => {
                preset.meta[key] = { name: name, value: value };
                if (existing) this._context.raiseEvent('preset-update', {preset: preset});
                else this._context.raiseEvent('preset-meta-add', {preset: preset, key: key});
            },
            () => {
                if (existing) {
                    preset.meta[key] = existing;
                    this._context.raiseEvent('preset-update', {preset: preset});
                } else {
                    delete preset.meta[key];
                    this._context.raiseEvent('preset-meta-remove', {preset: preset, key: key});
                }
            },
            {meta: prevMeta});
        return ok ? key : undefined;
    }

    /**
     * Add new metadata field to preset
     * @event preset-meta-remove
     * @param {string} id preset id
     * @param {string} key meta key
     */
    deleteCustomMeta(id, key) {
        let preset = this._presets.get(id);
        if (!preset || !preset.meta[key]) return false;

        const removed = preset.meta[key];
        const nextMeta = {...preset.meta};
        delete nextMeta[key];
        return this._mutate('update', id, {meta: nextMeta},
            () => {
                delete preset.meta[key];
                this._context.raiseEvent('preset-meta-remove', {preset: preset, key: key});
            },
            () => {
                preset.meta[key] = removed;
                this._context.raiseEvent('preset-meta-add', {preset: preset, key: key});
            },
            {meta: {...preset.meta}});
    }

    /**
     * Set common rendering visual property (stroke, opacity...)
     * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
     * @param {any} propertyValue value for the property
     * @return {boolean} true if value changed, false if invalid key
     */
    setCommonVisualProp(propertyName, propertyValue) {
        if (this.commonAnnotationVisuals[propertyName] === undefined) {
            console.error("[setCommonVisualProp] property name not one of", this.constructor.commonAnnotationVisuals, propertyName);
            return false;
        }
        this._context.cache.set('visuals.' + propertyName, propertyValue);
        this.commonAnnotationVisuals[propertyName] = propertyValue;
        return true;
    }

    /**
     * Get annotations visual property
     * @param {string} propertyName one of OSDAnnotations.CommonAnnotationVisuals keys
     * @return {*}
     */
    getCommonVisualProp(propertyName) {
        return this.commonAnnotationVisuals[propertyName];
    }

    /**
     * Iterate call for each preset
     * @param {function} call
     */
    foreach(call) {
        for (const [key, value] of this._presets) {
            call(value);
        }
    }

    /**
     * Export presets
     * @param usedOnly whether to return only subset for which exist annotations
     * @returns {string|[object]} JSON-friendly representation
     */
    toObject(usedOnly=false) {
        let exported = [];
        for (const [key, preset] of this._presets) {
            if (!usedOnly || this._context.fabric.canvas._objects.some(x => x.presetID === preset.presetID)) {
                exported.push(preset.toJSONFriendlyObject());
            }
        }
        return exported;
    }

    /**
     * Import presets.
     *
     * Modes:
     *  - 'merge' (default): upsert by presetID — existing presets are updated
     *    in place, new ones created, nothing is ever deleted. This is the
     *    slide-hydration semantics: the preset palette is session-global and
     *    per-slide storage snapshots may only add to it, otherwise hydrating
     *    slide B destroys presets still referenced by annotations of slide A
     *    (multi-viewport) or presets the user just created.
     *  - 'replace': delete all current presets, then import — exact-restore
     *    semantics for user-driven file imports and history undo. When
     *    replacing, the canvas objects should be cleared too (either manually
     *    or with the same parameter via export/import options).
     *
     * @param {string|[object]} presets (possibly serialized) array of presets to import
     * @param {boolean|{mode: ('merge'|'replace')}} options mode object; boolean
     *   kept for back-compat (true → 'replace', false/undefined → 'merge')
     * @return {OSDAnnotations.Preset|undefined} preset
     */
    async import(presets, options=undefined) {
        const _this = this;
        const mode = typeof options === 'object' && options !== null
            ? (options.mode || 'merge')
            : (options ? 'replace' : 'merge');

        if (mode === 'replace') {
            for (const [pid, preset] of this._presets) {
                this._context.raiseEvent('preset-delete', {preset});
                this._presets.delete(pid);
            }
        }

        if (typeof presets === 'string') {
            presets = JSON.parse(presets);
        }

        let first;
        if (Array.isArray(presets)) {
            for (let raw of presets) {
                const p = OSDAnnotations.Preset.fromJSONFriendlyObject(raw, _this._context);
                const existing = this._presets.get(p.presetID);
                if (existing) {
                    // Merge upsert: refresh the stored preset in place so
                    // live references (annotations, toolbars) stay valid.
                    existing.color = p.color;
                    existing.meta = p.meta;
                    existing.objectFactory = p.objectFactory;
                    if (p._factoryIDOverride) existing._factoryIDOverride = p._factoryIDOverride;
                    else delete existing._factoryIDOverride;
                    this._context.raiseEvent('preset-update', {preset: existing});
                    if (!first) first = existing;
                } else {
                    this._context.raiseEvent('preset-create', {preset: p});
                    this._presets.set(p.presetID, p);
                    this._presetsImported = true;
                    this._colorStep++; //generate new colors
                    if (!first) first = p;
                }
            }
        } else {
            throw "Invalid presets data provided as an input for import.";
        }

        const leftPresetId = await this._context.cache.get('presets.left.id', undefined, false);
        const rightPresetId = await this._context.cache.get('presets.right.id', undefined, false);
        if (leftPresetId && (leftPresetId === "__unset__" || this._presets.get(leftPresetId))) {
            this.selectPreset(leftPresetId, true, false);
        }
        if (rightPresetId && (rightPresetId === "__unset__" || this._presets.get(rightPresetId))) {
            this.selectPreset(rightPresetId, false, false);
        }

        if (!this.left && first) {
            this.selectPreset(first.presetID, true, false);
        }
        return first;
    }

    /**
     * Select preset as active.
     * @param {string} id preset id
     * @param {boolean} isLeftClick if true, the preset is set as 'left' property, 'right' otherwise
     * @param {boolean} cached
     */
    selectPreset(id, isLeftClick= true, cached= true) {
        let preset = undefined, cachedId = "__unset__";
        if (id) {
            if (!this._presets.has(id)) return;
            preset = this._presets.get(id);
            cachedId = preset.presetID;
        }
        if (isLeftClick) {
            this.left = preset;
            if (cached) this._context.cache.set('presets.left.id', cachedId);
        } else {
            this.right = preset;
            if (cached) this._context.cache.set('presets.right.id', cachedId);
        }
        this._context.raiseEvent('preset-select', {preset, isLeftClick});
    }

    _withDynamicOptions(options) {
        const canvas = this._context.fabric.canvas,
            zoom = canvas.getZoom(),
            gZoom = canvas.computeGraphicZoom(zoom);

        //const layerID = this._context.fabric.getActiveLayer()?.id;
        return $.extend(options, {
            layerID: undefined,
            zoomAtCreation: zoom,
            strokeWidth: this.commonAnnotationVisuals.originalStrokeWidth / gZoom
        });
    }

    _populateObjectOptions(withPreset) {
        if (!withPreset) {
            console.warn("Attempt to retrieve metadata without a preset!");
            return {};
        }
        if (this.commonAnnotationVisuals.modeOutline) {
            return $.extend({fill: ""},
                this.commonAnnotationVisuals,
                {
                    presetID: withPreset.presetID,
                    stroke: withPreset.color,
                    color: withPreset.color,
                }
            );
        } else {
            //fill is copied as a color and can be potentially changed to more complicated stuff (Pattern...)
            return $.extend({fill: withPreset.color},
                this.commonAnnotationVisuals,
                {
                    presetID: withPreset.presetID,
                    color: withPreset.color,
                }
            );
        }
    }

    randomColorHexString() {
        // from https://stackoverflow.com/questions/1484506/random-color-generator/7419630#7419630
        let r, g, b;
        let h = (this._colorStep++ % this._colorSteps) / this._colorSteps;
        let i = ~~(h * 6);
        let f = h * 6 - i;
        let q = 1 - f;
        switch(i % 6){
            case 0: r = 1; g = f; b = 0; break;
            case 1: r = q; g = 1; b = 0; break;
            case 2: r = 0; g = 1; b = f; break;
            case 3: r = 0; g = q; b = 1; break;
            case 4: r = f; g = 0; b = 1; break;
            case 5: r = 1; g = 0; b = q; break;
        }
        let c = "#" + ("00" + (~ ~(r * 255)).toString(16)).slice(-2)
            + ("00" + (~ ~(g * 255)).toString(16)).slice(-2)
            + ("00" + (~ ~(b * 255)).toString(16)).slice(-2);
        return (c);
    }
};

/**
 * A bit new feature, not really used (still)
 * @type {OSDAnnotations.Layer}
 */
OSDAnnotations.Layer = class {

    static _counter = 0;

    /**
     * Constructor
     * @param {OSDAnnotations} context Annotation Plugin Context
     * @param {string} id
     */
    constructor(context, id=String(Date.now())) {
        this._context = context;
        this.id = id;
        this._objects = [];
        this.type = "layer";
        this.visible = true;
        this.name = `Layer ${++OSDAnnotations.Layer._counter}`;
        this._name = undefined;
    }

    /**
     * Set elements of this layer selectable/active
     * not optimal if called for each layer
     * @param {boolean} active
     */
    setActive(active) {
        this.iterate((self, object) => object.selectable = active);
    }

    /**
     * Iterate over all object of this layer
     * @param {function} callback
     */
    iterate(callback) {
        const _this = this;
        this._context.fabric.canvas.getObjects().forEach(o => {
            if (o.layerID === _this.id) callback(_this, o);
        });
    }

    /**
     * Returns a plain shallow copy of this layer for serialization.
     * @returns {Object} Plain object copy without the internal context.
     */
    toObject() {
        const copy = { ...this, _objects: [...this._objects] };
	    delete copy._context;
        return copy;
    }

    /**
     * Get the number of annotations in this layer
     * @returns {number} number of objects in this layer
     */
    getAnnotationCount() {
        return this._objects.length;
    }

    /**
    * Add a fabric object to this layer
    * @param {fabric.Object} object
    * @param {number} index index at which to add the object
    */
    addObject(object, index = undefined) {
        if (!object || object.internalID === undefined || object.internalID === null) return;

        if (!this.contains(object)) {
            if (typeof index === "number" && index >= 0 && index <= this._objects.length) {
                this._objects.splice(index, 0, object);
            } else {
                this._objects.push(object);
            }

            object.layerID = this.id;
            this._context.fabric._applyAnnotationVisibilityState?.(object);
            this._context.fabric.rerender();
        }
    }

    /**
    * Remove a fabric object from this layer
    * @param {fabric.Object} object
    */
    removeObject(object) {
        if (!object || object.internalID === undefined || object.internalID === null) return;

        object.visible = true;
        this._objects = this._objects.filter(obj => obj.internalID !== object.internalID);

        this._context.fabric.rerender();
    }

    /**
     * Swap (move) an annotation up or down within this layer.
     * @param {fabric.Object} annotation
     * @param {"up"|"down"} direction "up" or "down"
     * @returns {boolean} true if swapped, false if at edge or not found
     */
    swapAnnotation(annotation, direction) {
        const idx = this._objects.findIndex(obj => obj.internalID === annotation.internalID);
        if (idx === -1) return false;
        const newIdx = direction === "up" ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= this._objects.length) return false;
        [this._objects[idx], this._objects[newIdx]] = [this._objects[newIdx], this._objects[idx]];
        return true;
    }

    /**
     * Return array of all objects assigned to this layer
     * @returns {fabric.Object[]}
     */
    getObjects() {
        return [...this._objects];
    }

    /**
     * Set objects for this layer
     * @param {fabric.Object[]} objects array of objects
     */
    setObjects(objects, changeLayerID = false) {
        this._objects.forEach(object => {
            object.visible = true;
            object.evented = true;
            object.selectable = true;
        });

        this._objects = objects;

        if (changeLayerID) {
            this._objects.forEach(obj => {
                obj.layerID = this.id;
            });
        }

        this._objects.forEach(object => {
            this._context.fabric._applyAnnotationVisibilityState?.(object);
        });

        this._context.fabric.rerender();
    }

    /**
    * Clear all objects from this layer (does not delete them from canvas)
    */
    clear() {
       this._objects.forEach(object => {
           if (object.layerID === this.id) {
                object.layerID = undefined;
                object.visible = true;
           }
       });
       this._objects = [];
    }

    /**
     * Check if this layer contains the object
     * @param {*} object object to check
     * @returns {boolean} true if the object is in this layer
     */
    contains(object) {
        return this._objects.some(obj => obj.internalID === object.internalID);
    }

    setVisibility(visible) {
        this.visible = !!visible;
        this._objects.forEach(obj => {
            this._context.fabric._applyAnnotationVisibilityState?.(obj);
        });
        this._context.fabric.rerender();
    }

    /**
     * Toggle the visibility of all objects in the layer
     */
    toggleVisibility() {
        this.setVisibility(!this.visible);
    }

    /**
     * Get the index of an annotation within this layer
     * @param {fabric.Object} annotation annotation to find
     * @returns {number} index of the annotation, -1 if not found
     */
    getAnnotationIndex(annotation) {
        return this._objects.findIndex(obj => obj.incrementId === annotation.incrementId);
    }
};
