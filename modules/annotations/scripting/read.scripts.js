ScriptingManager.registerExternalApi(
    /**
     * @implements AnnotationsScriptApi
     */
    async manager => manager.ingestApi(new class XOpatAnnotationsReadScriptApi extends ScriptingManager.XOpatScriptingApi {
        /**
         *
         * @type {XOpatAnnotationsScriptApi.ScriptApiMetadata<XOpatAnnotationsScriptApi>}
         */
        static ScriptApiMetadata = {
            dtypesSource: {
                kind: "url",
                value: APPLICATION_CONTEXT.url + "modules/annotations/scripting/common-types.d.ts"
            }
        };

        constructor(namespace) {
            super(
                namespace,
                "Read Annotations",
                "Read annotations, comments, presets, and available annotation object types for the viewer bound to the current script context. Usually the viewer should be first selected for this script context by application.setActiveViewer(contextId)."
            );
        }

        _getModule() {
            const module = OSDAnnotations.instance();
            if (!module) {
                throw new Error("The annotations module is not available.");
            }
            return module;
        }

        _getContextState() {
            const metadata = this.scriptingContext.metadata || (this.scriptingContext.metadata = {});
            const state = metadata.__annotationsScriptApiContextState;

            if (state && typeof state === "object") {
                return state;
            }

            metadata.__annotationsScriptApiContextState = {};
            return metadata.__annotationsScriptApiContextState;
        }

        _getContextPresetId(isLeftClick = true) {
            const state = this._getContextState();
            return isLeftClick === false
                ? (state.rightPresetId ?? null)
                : (state.leftPresetId ?? null);
        }

        _getContextPreset(isLeftClick = true) {
            const presetId = this._getContextPresetId(isLeftClick);
            if (!presetId) return null;
            return this._getModule().presets?.get?.(String(presetId)) || null;
        }

        _getBoundViewerContextId() {
            return (
                this.scriptingContext.getActiveViewerContextId?.()
                ?? this.scriptingContext.activeViewerContextId
                ?? this.scriptingContext.id
            );
        }

        _getFabric() {
            const module = this._getModule();
            return module.getFabric(this.activeViewer);
        }

        _clone(value) {
            if (value === null || value === undefined) return value;

            try {
                if (typeof structuredClone === "function") {
                    return structuredClone(value);
                }
            } catch (e) {
                // fallback below
            }

            try {
                return JSON.parse(JSON.stringify(value));
            } catch (e) {
                return value;
            }
        }

        _isFullAnnotation(object) {
            const module = this._getModule();
            return !!object && !object.excludeFromExport && !!module.isAnnotation?.(object);
        }

        _listLiveAnnotations() {
            const fabric = this._getFabric();
            return (fabric.canvas?.getObjects?.() || []).filter((object) => this._isFullAnnotation(object));
        }

        _findAnnotation(ref) {
            const fabric = this._getFabric();

            if (typeof ref === "number" && Number.isFinite(ref)) {
                return (
                    fabric.findObjectOnCanvasByIncrementId?.(ref)
                    || this._listLiveAnnotations().find((object) => Number(object.internalID) === ref)
                    || null
                );
            }

            const needle = String(ref);
            return this._listLiveAnnotations().find((object) => (
                String(object.id ?? "") === needle
                || String(object.incrementId ?? "") === needle
                || String(object.internalID ?? "") === needle
            )) || null;
        }

        _serializeAnnotation(object) {
            const module = this._getModule();
            const fabric = this._getFabric();
            const factory = module.getAnnotationObjectFactory?.(object.factoryID || object.type);

            const base = factory?.copyNecessaryProperties
                ? factory.copyNecessaryProperties(object, ["incrementId", "internalID", "private", "comments", "label"], true)
                : this._clone(object);

            const result = this._clone(base) || {};

            result.title = factory?.title?.() ?? result.title;
            result.description = fabric.getAnnotationDescription?.(object) ?? result.description;
            result.editable = !!factory?.isEditable?.();

            if (result.color === undefined) {
                result.color = fabric.getAnnotationColor?.(object);
            }

            return result;
        }

        _serializePreset(preset) {
            const leftId = this._getContextPresetId(true);
            const rightId = this._getContextPresetId(false);
            const base = preset?.toJSONFriendlyObject?.() || {};

            return {
                ...this._clone(base),
                presetID: String(base.presetID ?? preset?.presetID ?? ""),
                factoryID: base.factoryID ?? preset?.objectFactory?.factoryID,
                color: base.color ?? preset?.color,
                meta: this._clone(base.meta ?? preset?.meta ?? {}),
                isLeftActive: String(base.presetID ?? preset?.presetID ?? "") === String(leftId ?? ""),
                isRightActive: String(base.presetID ?? preset?.presetID ?? "") === String(rightId ?? ""),
            };
        }

        _serializeFactory(factory) {
            return {
                factoryID: String(factory?.factoryID ?? ""),
                type: factory?.type,
                title: factory?.title?.(),
                icon: factory?.getIcon?.(),
                editable: !!factory?.isEditable?.(),
                fabricStructure: this._clone(factory?.fabricStructure?.()),
            };
        }

        getAnnotationCount() {
            return this._listLiveAnnotations().length;
        }

        getAnnotations() {
            return this._listLiveAnnotations().map((object) => this._serializeAnnotation(object));
        }

        getSelectedAnnotations() {
            const fabric = this._getFabric();
            return (fabric.getSelectedAnnotations?.() || [])
                .filter((object) => this._isFullAnnotation(object))
                .map((object) => this._serializeAnnotation(object));
        }

        getAnnotation(ref) {
            const object = this._findAnnotation(ref);
            return object ? this._serializeAnnotation(object) : null;
        }

        listComments(includeRemoved = false) {
            return this._listLiveAnnotations().flatMap((object) => {
                const comments = Array.isArray(object.comments) ? object.comments : [];
                return comments
                    .filter((comment) => includeRemoved || !comment?.removed)
                    .map((comment) => ({
                        ...this._clone(comment),
                        annotationId: object.id,
                        annotationIncrementId: Number(object.incrementId),
                    }));
            });
        }

        getComments(annotationRef, includeRemoved = false) {
            const object = this._findAnnotation(annotationRef);
            if (!object) return [];

            const comments = Array.isArray(object.comments) ? object.comments : [];
            return comments
                .filter((comment) => includeRemoved || !comment?.removed)
                .map((comment) => ({
                    ...this._clone(comment),
                    annotationId: object.id,
                    annotationIncrementId: Number(object.incrementId),
                }));
        }

        getCommentsEnabled() {
            return !!this._getModule().getCommentsEnabled?.();
        }

        getPresets(usedOnly = false) {
            const module = this._getModule();
            const presets = module.presets;

            const ids = usedOnly
                ? Array.from(new Set((presets.toObject?.(true) || []).map((preset) => String(preset?.presetID ?? ""))))
                : Array.from(new Set((presets.getExistingIds?.() || []).map((id) => String(id ?? ""))));

            return ids
                .filter((id) => id)
                .map((id) => presets.get?.(id))
                .filter(Boolean)
                .map((preset) => this._serializePreset(preset));
        }

        getPreset(id) {
            const preset = this._getModule().presets.get?.(id);
            return preset ? this._serializePreset(preset) : null;
        }

        getActivePreset(isLeftClick = true) {
            const preset = this._getContextPreset(!!isLeftClick);
            return preset ? this._serializePreset(preset) : null;
        }

        getAvailableFactories() {
            const factories = Object.values(this._getModule().objectFactories || {});
            return factories.map((factory) => this._serializeFactory(factory));
        }
    }("annotationsRead")),
    { label: "annotationsRead" }
);