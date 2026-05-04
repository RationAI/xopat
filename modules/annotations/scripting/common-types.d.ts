export type AnnotationRef = string | number;

export type AnnotationMeta = Record<string, unknown>;

export type AnnotationCommentRecord = {
    id: string;
    author?: string | { id?: string; name?: string } | null;
    content: string;
    createdAt?: string | number | Date | null;
    replyTo?: string | null;
    removed?: boolean;
    annotationId?: string;
    annotationIncrementId?: number;
};

export type AnnotationRecord = Record<string, unknown> & {
    id?: string;
    incrementId?: number;
    internalID?: number;
    factoryID?: string;
    type?: string;
    presetID?: string;
    layerID?: string;
    label?: string | number;
    color?: string;
    author?: string | { id?: string; name?: string } | null;
    created?: string | number | Date | null;
    private?: boolean;
    comments?: AnnotationCommentRecord[];
    meta?: AnnotationMeta;
    title?: string;
    description?: string;
    editable?: boolean;
};

export type AnnotationPresetRecord = {
    presetID: string;
    factoryID?: string;
    color?: string;
    meta?: Record<string, { name?: string; value?: string }>;
    isLeftActive?: boolean;
    isRightActive?: boolean;
};

export type AnnotationFactoryRecord = {
    factoryID: string;
    type?: string;
    title?: string;
    icon?: string;
    editable: boolean;
    fabricStructure?: string | string[] | string[][];
};

export interface AnnotationsScriptApi extends ScriptApiObject {
    /**
     * Returns the number of full annotations in the viewer bound to the current script context.
     */
    getAnnotationCount(): number;

    /**
     * Returns annotation records for the viewer bound to the current script context.
     */
    getAnnotations(): AnnotationRecord[];

    /**
     * Returns annotation records that are currently selected in the viewer bound to the current script context.
     */
    getSelectedAnnotations(): AnnotationRecord[];

    /**
     * Retrieves one annotation by persistent id, increment id, or internal id.
     */
    getAnnotation(ref: AnnotationRef): AnnotationRecord | null;

    /**
     * Returns comments from all annotations in the viewer bound to the current script context.
     */
    listComments(includeRemoved?: boolean): AnnotationCommentRecord[];

    /**
     * Returns comments attached to a specific annotation.
     */
    getComments(annotationRef: AnnotationRef, includeRemoved?: boolean): AnnotationCommentRecord[];

    /**
     * Indicates whether the comments feature is enabled.
     */
    getCommentsEnabled(): boolean;

    /**
     * Returns all presets known to the annotation module.
     */
    getPresets(usedOnly?: boolean): AnnotationPresetRecord[];

    /**
     * Returns one preset by id.
     */
    getPreset(id: string): AnnotationPresetRecord | null;

    /**
     * Returns the currently selected left or right preset for this script context.
     */
    getActivePreset(isLeftClick?: boolean): AnnotationPresetRecord | null;

    /**
     * Lists available annotation factories / object types.
     */
    getAvailableFactories(): AnnotationFactoryRecord[];
}

export type AnnotationCommentInput = {
    id?: string;
    author?: string | { id?: string; name?: string } | null;
    content: string;
    createdAt?: string | number | Date | null;
    replyTo?: string | null;
};

export type AnnotationCreateInput = {
    /**
     * Factory to create, such as "rect", "polygon", "point", "line", "polyline", "ruler", ...
     * If omitted, the factory from the explicitly passed preset or from the preset selected in this script context is used.
     */
    factoryID?: string;

    /**
     * Alias for factoryID.
     */
    type?: string;

    /**
     * Preset to bind to the newly created annotation.
     * If omitted, the preset selected in the current script context is used, falling back to the first existing preset.
     */
    presetID?: string;

    /**
     * Factory-specific creation payload.
     * Examples:
     *  - rect: { left, top, width, height }
     *  - point: { x, y }
     *  - line / ruler: [x1, y1, x2, y2]
     *  - polygon / polyline: [{x, y}, ...]
     *
     * Important:
     *  - pass the geometry payload itself, not a wrapper object unless the factory explicitly requires one
     *  - for polygon / polyline use `parameters: [{ x, y }, ...]`, not `parameters: { points: [...] }`
     *  - for line / ruler use the raw coordinate array, not `{ points: [...] }`
     */
    parameters: unknown;

    /**
     * Whether preset fallback should use the left or right preset selected in this script context.
     * Default true.
     */
    isLeftClick?: boolean;

    meta?: AnnotationMeta;
    private?: boolean;
    label?: string | number;
    author?: string | { id?: string; name?: string } | null;
    created?: string | number | Date | null;
    comments?: AnnotationCommentInput[];
    layerID?: string | number | null;
};

export type AnnotationMutablePatch = {
    presetID?: string;
    private?: boolean;
    label?: string | number;
    meta?: AnnotationMeta;
    author?: string | { id?: string; name?: string } | null;
    created?: string | number | Date | null;
};

export type PresetMetaPatchValue =
    | string
    | number
    | boolean
    | { name?: string; value?: string | number | boolean }
    | null;

export type AnnotationPresetCreateInput = {
    presetID?: string;
    category?: string;
    factoryID?: string;
    color?: string;
    meta?: Record<string, PresetMetaPatchValue>;
    activateLeft?: boolean;
    activateRight?: boolean;
};

export type AnnotationPresetUpdateInput = {
    factoryID?: string;
    color?: string;
    meta?: Record<string, PresetMetaPatchValue>;
};

export type AnnotationCreateLimit = {
    maxTotalAnnotations: number;
    maxPerCall: number;
};

export interface AnnotationsWriteScriptApi extends ScriptApiObject {
    /**
     * Creates one annotation using the given factory-specific parameters.
     *
     * Example:
     * `await annotationsWrite.createAnnotation({
     *   factoryID: "polygon",
     *   presetID,
     *   parameters: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }]
     * })`
     */
    createAnnotation(input: AnnotationCreateInput): Promise<AnnotationRecord>;

    /**
     * Creates multiple annotations, subject to the interactive guard.
     * Each item follows the same factory-specific `parameters` shape as `createAnnotation()`.
     * Uses batched creation safe for large amounts of annotations.
     */
    createAnnotations(inputs: AnnotationCreateInput[]): Promise<AnnotationRecord[]>;

    /**
     * Deletes one annotation by persistent id, increment id, or internal id.
     */
    deleteAnnotation(ref: AnnotationRef): boolean;

    /**
     * Deletes all matched annotations and returns the count actually deleted.
     */
    deleteAnnotations(refs: AnnotationRef[]): number;

    /**
     * Sets the annotation private flag.
     */
    setAnnotationPrivate(ref: AnnotationRef, value: boolean): AnnotationRecord;

    /**
     * Rebinds the annotation to another preset.
     */
    setAnnotationPreset(ref: AnnotationRef, presetId: string): AnnotationRecord;

    /**
     * Updates safe non-geometry annotation fields.
     */
    updateAnnotation(ref: AnnotationRef, patch: AnnotationMutablePatch): AnnotationRecord;

    /**
     * Adds a comment to the given annotation.
     */
    addComment(annotationRef: AnnotationRef, comment: AnnotationCommentInput | string): AnnotationCommentRecord;

    /**
     * Marks one comment as removed on the given annotation.
     */
    deleteComment(annotationRef: AnnotationRef, commentId: string): boolean;

    /**
     * Creates a preset.
     */
    createPreset(input?: AnnotationPresetCreateInput): AnnotationPresetRecord;

    /**
     * Updates a preset's factory, color, and metadata.
     */
    updatePreset(id: string, patch: AnnotationPresetUpdateInput): AnnotationPresetRecord;

    /**
     * Deletes a preset if it is not used by existing annotations.
     */
    deletePreset(id: string): boolean;

    /**
     * Selects a preset as the left or right active preset for this script context.
     */
    selectPreset(id: string, isLeftClick?: boolean): AnnotationPresetRecord | null;

    /**
     * Clears the left or right active preset for this script context.
     */
    clearSelectedPreset(isLeftClick?: boolean): null;

    /**
     * Sets a common visual property such as stroke, opacity, borderColor, ...
     */
    setCommonVisualProperty(propertyName: string, propertyValue: unknown): unknown;
}
