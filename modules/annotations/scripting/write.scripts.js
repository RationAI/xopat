ScriptingManager.registerExternalApi(
    /**
     * @implements AnnotationsWriteScriptApi
     */
    async manager => manager.ingestApi(new class XOpatAnnotationsWriteScriptApi extends ScriptingManager.XOpatScriptingApi {
        static ScriptApiMetadata = {
            dtypesSource: {
                kind: "url",
                value: APPLICATION_CONTEXT.url + "modules/annotations/scripting/common-types.d.ts"
            }
        };

        constructor(namespace) {
            super(
                namespace,
                "Write Annotations",
                "Create and modify annotations, comments, presets, and preset visuals for the viewer bound to the current script context. Usually the viewer should be first selected for this script context by application.setActiveViewer(contextId)."
            );
            this.MAX_SCRIPT_ANNOTATIONS_PER_CALL = 10;
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

        _setContextPresetId(presetId, isLeftClick = true) {
            const state = this._getContextState();

            if (isLeftClick === false) {
                state.rightPresetId = presetId ?? null;
                return;
            }

            state.leftPresetId = presetId ?? null;
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
            return this._getModule().getFabric(this.activeViewer);
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

        _ensurePresetSnapshot() {
            try {
                const module = this._getModule();
                const maybePromise = module.createPresetsCookieSnapshot?.();
                if (maybePromise && typeof maybePromise.then === "function") {
                    void maybePromise.catch(() => {});
                }
            } catch (e) {
                // non-fatal
            }
        }

        _touchAnnotation(object) {
            const fabric = this._getFabric();
            fabric.canvas?.requestRenderAll?.();
            fabric.raiseEvent?.("annotation-edit", { object });
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

        _getAnnotationOrThrow(ref) {
            const object = this._findAnnotation(ref);
            if (!object) {
                throw new Error(`Annotation '${String(ref)}' was not found in the active viewer.`);
            }
            return object;
        }

        _getFactory(factoryId) {
            const factory = this._getModule().getAnnotationObjectFactory?.(factoryId);
            if (!factory) {
                throw new Error(`Unknown annotation factory '${String(factoryId)}'.`);
            }
            return factory;
        }

        _resolvePreset(presetId, isLeftClick = true) {
            const module = this._getModule();
            const presets = module.presets;

            if (presetId !== undefined && presetId !== null && presetId !== "") {
                const preset = presets.get?.(String(presetId));
                if (!preset) {
                    throw new Error(`Preset '${String(presetId)}' was not found.`);
                }
                return preset;
            }

            const active = this._getContextPreset(!!isLeftClick);
            if (active) return active;

            const ids = presets.getExistingIds?.() || [];
            if (ids.length > 0) {
                return presets.get?.(ids[0]);
            }

            throw new Error(
                "No preset is available for this script context. Create or select a preset first, or pass presetID explicitly."
            );
        }

        async _assertCreateBudget(incomingCount) {
            if (incomingCount > this.MAX_SCRIPT_ANNOTATIONS_PER_CALL) {
                await this.requireActionConsent({
                    title: "Allow annotations?",
                    description: `The script wants to add more than ${this.MAX_SCRIPT_ANNOTATIONS_PER_CALL} annotations at once.`,
                    details: [
                        "Allowing this script to add more than one annotation at once may pollute the workspace or cause performance issues.",
                    ],
                    mode: "warning",
                    confirmLabel: "Add",
                    cancelLabel: "Block",
                    rejectedMessage: `Adding ${incomingCount} annotations was blocked by the user.`,
                });
            }
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

        _normalizeCommentInput(comment) {
            const module = this._getModule();
            const now = new Date().toISOString();

            if (typeof comment === "string") {
                return {
                    id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    content: comment,
                    createdAt: now,
                    author: module.user
                        ? {
                            id: module.user.id,
                            name: module.user.name
                        }
                        : undefined
                };
            }

            const clone = this._clone(comment) || {};
            return {
                id: clone.id || `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                content: String(clone.content ?? ""),
                createdAt: clone.createdAt ?? now,
                author: clone.author ?? (module.user
                    ? {
                        id: module.user.id,
                        name: module.user.name
                    }
                    : undefined),
                replyTo: clone.replyTo ?? null,
                removed: !!clone.removed
            };
        }

        _normalizePresetMetaEntry(key, raw) {
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
                return {
                    name: raw.name ?? (key === "category" ? "Name" : key),
                    value: raw.value === undefined || raw.value === null ? "" : String(raw.value)
                };
            }

            return {
                name: key === "category" ? "Name" : key,
                value: raw === undefined || raw === null ? "" : String(raw)
            };
        }

        _buildAnnotationFromInput(input) {
            const module = this._getModule();
            const raw = this._clone(input) || {};
            const preset = this._resolvePreset(raw.presetID, raw.isLeftClick !== false);

            let factoryId = raw.factoryID || raw.type || preset?.objectFactory?.factoryID;
            if (!factoryId) {
                throw new Error("Annotation creation requires factoryID, type, or a preset with an associated factory.");
            }

            const factory = this._getFactory(factoryId);

            if (raw.parameters === undefined) {
                throw new Error("Annotation creation requires 'parameters'.");
            }

            const options = module.presets.getAnnotationOptionsFromInstance?.(preset, raw.isLeftClick !== false) || {};
            const annotation = factory.create?.(this._clone(raw.parameters), options);

            if (!annotation) {
                throw new Error(`Factory '${String(factory.factoryID)}' did not create an annotation.`);
            }

            if (raw.meta !== undefined) annotation.meta = this._clone(raw.meta);
            if (raw.private !== undefined) annotation.private = !!raw.private;
            if (raw.label !== undefined) annotation.label = raw.label;
            if (raw.author !== undefined) annotation.author = this._clone(raw.author);
            if (raw.created !== undefined) annotation.created = this._clone(raw.created);
            if (raw.comments !== undefined) {
                annotation.comments = Array.isArray(raw.comments)
                    ? raw.comments.map((comment) => this._normalizeCommentInput(comment))
                    : [];
            }

            // Creation-time only; safe before addAnnotation() assigns identity and board position.
            if (raw.layerID !== undefined && raw.layerID !== null && raw.layerID !== "") {
                annotation.layerID = String(raw.layerID);
            }

            return annotation;
        }

        async createAnnotation(input) {
            await this._assertCreateBudget(1);

            const fabric = this._getFabric();
            const annotation = this._buildAnnotationFromInput(input);
            const ok = fabric.addAnnotation?.(annotation);

            if (ok === false) {
                throw new Error("The annotation could not be created.");
            }

            return this._serializeAnnotation(annotation);
        }

        async createAnnotations(inputs) {
            const items = Array.isArray(inputs) ? inputs : [];
            if (items.length === 0) return [];

            await this._assertCreateBudget(items.length);

            const fabric = this._getFabric();
            const annotations = items.map((input) => this._buildAnnotationFromInput(input));

            for (const annotation of annotations) {
                const ok = fabric.addAnnotation?.(annotation);
                if (ok === false) {
                    throw new Error("One of the annotations could not be created.");
                }
            }

            return annotations.map((annotation) => this._serializeAnnotation(annotation));
        }

        deleteAnnotation(ref) {
            const object = this._findAnnotation(ref);
            if (!object) return false;

            this._getFabric().deleteObject?.(object);
            return true;
        }

        deleteAnnotations(refs) {
            const objects = (Array.isArray(refs) ? refs : [])
                .map((ref) => this._findAnnotation(ref))
                .filter(Boolean);

            if (!objects.length) return 0;

            this._getFabric().deleteObject?.(objects);
            return objects.length;
        }

        setAnnotationPrivate(ref, value) {
            const object = this._getAnnotationOrThrow(ref);
            this._getFabric().setAnnotationPrivate?.(object, !!value);
            this._touchAnnotation(object);
            return this._serializeAnnotation(object);
        }

        setAnnotationPreset(ref, presetId) {
            const object = this._getAnnotationOrThrow(ref);
            const preset = this._resolvePreset(presetId, true);
            const ok = this._getFabric().changeAnnotationPreset?.(object, String(preset.presetID));

            if (ok === false) {
                throw new Error(`Preset '${String(presetId)}' could not be applied to the annotation.`);
            }

            this._touchAnnotation(object);
            return this._serializeAnnotation(object);
        }

        updateAnnotation(ref, patch = {}) {
            const object = this._getAnnotationOrThrow(ref);
            const raw = this._clone(patch) || {};
            let touched = false;

            if (raw.presetID !== undefined) {
                this.setAnnotationPreset(ref, raw.presetID);
                touched = true;
            }

            if (raw.private !== undefined) {
                this._getFabric().setAnnotationPrivate?.(object, !!raw.private);
                touched = true;
            }

            if (raw.label !== undefined) {
                object.label = raw.label;
                touched = true;
            }

            if (raw.meta !== undefined) {
                object.meta = this._clone(raw.meta);
                touched = true;
            }

            if (raw.author !== undefined) {
                object.author = this._clone(raw.author);
                touched = true;
            }

            if (raw.created !== undefined) {
                object.created = this._clone(raw.created);
                touched = true;
            }

            if (touched) {
                this._touchAnnotation(object);
            }

            return this._serializeAnnotation(object);
        }

        addComment(annotationRef, comment) {
            const module = this._getModule();

            if (!module.getCommentsEnabled?.()) {
                throw new Error("Comments are disabled in the annotations module.");
            }

            const object = this._getAnnotationOrThrow(annotationRef);
            const normalized = this._normalizeCommentInput(comment);

            this._getFabric().addComment?.(object, normalized);
            this._touchAnnotation(object);

            return {
                ...this._clone(normalized),
                annotationId: object.id,
                annotationIncrementId: Number(object.incrementId),
            };
        }

        deleteComment(annotationRef, commentId) {
            const object = this._getAnnotationOrThrow(annotationRef);
            const ok = this._getFabric().deleteComment?.(object, String(commentId));

            if (ok) {
                this._touchAnnotation(object);
            }

            return !!ok;
        }

        createPreset(input = {}) {
            const module = this._getModule();
            const presets = module.presets;
            const raw = this._clone(input) || {};

            if (raw.presetID && presets.exists?.(String(raw.presetID))) {
                throw new Error(`Preset '${String(raw.presetID)}' already exists.`);
            }

            const category = raw.category ?? raw.meta?.category?.value ?? raw.meta?.category ?? "";
            const preset = presets.addPreset?.(
                raw.presetID !== undefined ? String(raw.presetID) : undefined,
                String(category ?? "")
            );

            if (!preset) {
                throw new Error("Preset could not be created.");
            }

            let changedAfterCreate = false;

            if (raw.factoryID !== undefined) {
                preset.objectFactory = this._getFactory(String(raw.factoryID));
                changedAfterCreate = true;
            }

            if (raw.color !== undefined) {
                preset.color = String(raw.color);
                changedAfterCreate = true;
            }

            if (raw.meta && typeof raw.meta === "object") {
                preset.meta = preset.meta || {};
                for (const [key, value] of Object.entries(raw.meta)) {
                    if (value === null) continue;
                    preset.meta[key] = this._normalizePresetMetaEntry(key, value);
                }
                changedAfterCreate = true;
            }

            if (changedAfterCreate) {
                module.raiseEvent?.("preset-update", { preset });
            }

            if (raw.activateLeft) {
                this._setContextPresetId(preset.presetID, true);
            }
            if (raw.activateRight) {
                this._setContextPresetId(preset.presetID, false);
            }

            this._ensurePresetSnapshot();
            return this._serializePreset(preset);
        }

        updatePreset(id, patch = {}) {
            const module = this._getModule();
            const presets = module.presets;
            const preset = presets.get?.(String(id));

            if (!preset) {
                throw new Error(`Preset '${String(id)}' was not found.`);
            }

            const raw = this._clone(patch) || {};
            let changed = false;

            if (raw.color !== undefined) {
                if (preset.color !== String(raw.color)) {
                    preset.color = String(raw.color);
                    changed = true;
                }
            }

            if (raw.factoryID !== undefined) {
                const factory = this._getFactory(String(raw.factoryID));
                if (preset.objectFactory !== factory) {
                    preset.objectFactory = factory;
                    changed = true;
                }
            }

            if (raw.meta && typeof raw.meta === "object") {
                preset.meta = preset.meta || {};
                for (const [key, value] of Object.entries(raw.meta)) {
                    if (value === null) {
                        if (key === "category") {
                            preset.meta.category = { name: "Name", value: "" };
                            changed = true;
                        } else if (preset.meta[key]) {
                            presets.deleteCustomMeta?.(String(id), key);
                            changed = true;
                        }
                        continue;
                    }

                    const normalized = this._normalizePresetMetaEntry(key, value);
                    const current = preset.meta[key];

                    if (!current || current.name !== normalized.name || current.value !== normalized.value) {
                        preset.meta[key] = normalized;
                        changed = true;
                    }
                }
            }

            if (changed) {
                module.raiseEvent?.("preset-update", { preset });
            }

            this._ensurePresetSnapshot();
            return this._serializePreset(preset);
        }

        deletePreset(id) {
            const presetId = String(id);
            const result = this._getModule().presets.removePreset?.(presetId);

            if (result === false) {
                throw new Error(`Preset '${presetId}' was not found.`);
            }

            if (result === null) {
                throw new Error(
                    `Preset '${presetId}' is still used by existing annotations and cannot be removed.`
                );
            }

            if (this._getContextPresetId(true) === presetId) {
                this._setContextPresetId(null, true);
            }
            if (this._getContextPresetId(false) === presetId) {
                this._setContextPresetId(null, false);
            }

            this._ensurePresetSnapshot();
            return true;
        }

        selectPreset(id, isLeftClick = true) {
            const presets = this._getModule().presets;
            const presetId = String(id);

            if (!presets.get?.(presetId)) {
                throw new Error(`Preset '${presetId}' was not found.`);
            }

            this._setContextPresetId(presetId, !!isLeftClick);

            const preset = presets.get?.(presetId);
            return preset ? this._serializePreset(preset) : null;
        }

        clearSelectedPreset(isLeftClick = true) {
            this._setContextPresetId(null, !!isLeftClick);
            return null;
        }

        setCommonVisualProperty(propertyName, propertyValue) {
            const module = this._getModule();
            module.setAnnotationCommonVisualProperty?.(String(propertyName), propertyValue);
            this._ensurePresetSnapshot();
            return module.getAnnotationCommonVisualProperty?.(String(propertyName));
        }
    }("annotationsWrite")),
    { label: "annotationsWrite" }
);