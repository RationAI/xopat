/// <reference path="../../src/types/globals.d.ts" />

/**
 * Wire types of the EMPAIA Workbench Service v3 "app" API, transcribed from the
 * generated client in `empaia-api-lib` (`src/lib/v3/app/models/**`).
 *
 * Only the fields xOpat actually reads or writes are declared. Everything that
 * crosses the network is treated as untrusted and re-validated at the boundary
 * (see `wbs3-client.ts`), so these types describe intent — never a guarantee.
 */

// ── enums (string unions; the wire uses exactly these literals) ──────────────

/**
 * The **normalized** creator vocabulary — not a guarantee about the wire.
 *
 * The schema documents these lowercase, but the service has been observed
 * returning `"JOB"` (its sibling {@link JobCreatorType} is uppercase throughout),
 * and the value arrives as JSON, so TypeScript cannot enforce either casing.
 * Never compare a wire value against these literals; use {@link isJobCreated}.
 */
export type DataCreatorType = "job" | "user" | "scope";
export type JobCreatorType = "USER" | "SCOPE" | "SERVICE";
export type JobMode = "STANDALONE" | "PREPROCESSING" | "POSTPROCESSING" | "REPORT";
export type JobStatus =
    | "NONE" | "ASSEMBLY" | "READY" | "SCHEDULED" | "RUNNING"
    | "COMPLETED" | "FAILED" | "TIMEOUT" | "ERROR" | "INCOMPLETE";
export type JobValidationStatus = "NONE" | "RUNNING" | "COMPLETED" | "ERROR" | "FAILED";

export type EmpaiaAnnotationType = "point" | "line" | "arrow" | "circle" | "rectangle" | "polygon";
export type PrimitiveType = "integer" | "float" | "bool" | "string";
export type PixelmapType = "continuous_pixelmap" | "discrete_pixelmap" | "nominal_pixelmap";

export type CollectionItemType =
    | "wsi" | "integer" | "float" | "bool" | "string"
    | EmpaiaAnnotationType | "class"
    | "continuous_pixelmap" | "discrete_pixelmap" | "nominal_pixelmap"
    | "collection";

/** Element types a pixelmap tile buffer may use. */
export type PixelmapElementType =
    | "uint8" | "uint16" | "uint32" | "uint64"
    | "int8" | "int16" | "int32" | "int64"
    | "float32" | "float64";

// ── scope / EAD ─────────────────────────────────────────────────────────────

export interface ExtendedScope {
    id: string;
    app_id: string;
    case_id: string;
    examination_id: string;
    examination_state?: string;
    user_id: string;
    created_at?: number;
    /** Raw EMPAIA App Description. Shape depends on the app; see `ead.ts`. */
    ead: Record<string, any>;
}

// ── slides ──────────────────────────────────────────────────────────────────

export interface TagMapping { [key: string]: any }

export interface Slide {
    id: string;
    case_id: string;
    local_id?: string | null;
    block?: string | null;
    stain?: TagMapping | null;
    tissue?: TagMapping | null;
    deleted?: boolean | null;
    created_at?: number;
    updated_at?: number;
}

export interface SlideList { item_count?: number; items: Slide[] }

export interface SlideExtent { x: number; y: number; z: number }
export interface SlidePixelSizeNm { x: number; y: number; z?: number | null }
export interface SlideLevel { downsample_factor: number; extent: SlideExtent }
export interface SlideChannel { id: number; name: string; color: Record<string, number> }

export interface SlideInfo {
    id: string;
    channel_depth?: number | null;
    channels?: SlideChannel[] | null;
    extent: SlideExtent;
    format?: string;
    levels: SlideLevel[];
    num_levels: number;
    pixel_size_nm: SlidePixelSizeNm;
    raw_download?: boolean;
    tile_extent: SlideExtent;
}

// ── annotations & classes ───────────────────────────────────────────────────

export interface EmpaiaClass {
    id?: string | null;
    type: "class";
    value: string;
    creator_id: string;
    creator_type: DataCreatorType;
    reference_id: string;
    reference_type: "annotation";
    is_locked?: boolean | null;
}

/** Fields every annotation type carries. */
export interface AnnotationBase {
    id?: string | null;
    name: string;
    description?: string | null;
    type: EmpaiaAnnotationType;
    creator_id: string;
    creator_type: DataCreatorType;
    reference_id: string;
    reference_type: "wsi";
    npp_created: number;
    npp_viewing?: number[] | null;
    centroid?: number[] | null;
    classes?: EmpaiaClass[] | null;
    is_locked?: boolean | null;
    created_at?: number | null;
    updated_at?: number | null;
}

export interface PointAnnotation extends AnnotationBase { type: "point"; coordinates: number[] }
export interface LineAnnotation extends AnnotationBase { type: "line"; coordinates: number[][] }
export interface PolygonAnnotation extends AnnotationBase { type: "polygon"; coordinates: number[][] }
export interface ArrowAnnotation extends AnnotationBase { type: "arrow"; head: number[]; tail: number[] }
export interface CircleAnnotation extends AnnotationBase { type: "circle"; center: number[]; radius: number }
export interface RectangleAnnotation extends AnnotationBase {
    type: "rectangle"; upper_left: number[]; width: number; height: number;
}

export type EmpaiaAnnotation =
    | PointAnnotation | LineAnnotation | PolygonAnnotation
    | ArrowAnnotation | CircleAnnotation | RectangleAnnotation;

export interface Viewport { x: number; y: number; width: number; height: number }

/**
 * Body of every `*\/query` route.
 *
 * Every field is optional to the *schema*, but the service additionally requires
 * a **selector**: either `creators` or `jobs` (never both — that is a 400), or a
 * body whose only field is the item id list. `references` alone is rejected.
 * `Wbs3Client` fills the default selector in, so callers normally only set the
 * filters they care about.
 */
export interface AnnotationQuery {
    annotations?: string[] | null;
    class_values?: (string | null)[] | null;
    creators?: string[] | null;
    jobs?: (string | null)[] | null;
    npp_viewing?: number[] | null;
    references?: string[] | null;
    types?: EmpaiaAnnotationType[] | null;
    viewport?: Viewport | null;
}

export interface AnnotationList {
    item_count: number;
    items: EmpaiaAnnotation[];
    low_npp_centroids?: number[][] | null;
}

// ── primitives ──────────────────────────────────────────────────────────────

export interface Primitive {
    id?: string | null;
    name: string;
    description?: string | null;
    type: PrimitiveType;
    value: number | boolean | string;
    creator_id: string;
    creator_type: DataCreatorType;
    reference_id?: string | null;
    reference_type?: string | null;
}

export interface PrimitiveList { item_count: number; items: Primitive[] }

// ── collections ─────────────────────────────────────────────────────────────

export interface EmpaiaCollection {
    id?: string | null;
    type: "collection";
    name?: string | null;
    description?: string | null;
    item_type: CollectionItemType;
    item_count?: number | null;
    item_ids?: string[] | null;
    items?: any[] | null;
    creator_id: string;
    creator_type: DataCreatorType;
    reference_id?: string | null;
    reference_type?: string | null;
}

// ── pixelmaps ───────────────────────────────────────────────────────────────

export interface NumberClassMapping { class_value: string; number_value: number }

export interface PixelmapLevel {
    slide_level: number;
    position_min_x?: number | null;
    position_min_y?: number | null;
    position_max_x?: number | null;
    position_max_y?: number | null;
}

export interface Pixelmap {
    id?: string | null;
    name: string;
    description?: string | null;
    type: PixelmapType;
    element_type: PixelmapElementType;
    channel_count: number;
    channel_class_mapping?: NumberClassMapping[] | null;
    /** Nominal maps only — value → class name. */
    element_class_mapping?: NumberClassMapping[] | null;
    /** Continuous / discrete maps only. */
    min_value?: number;
    max_value?: number;
    neutral_value?: number | null;
    levels: PixelmapLevel[];
    tilesize: number;
    reference_id: string;
    reference_type: "wsi";
    creator_id: string;
    creator_type: DataCreatorType;
}

export interface PixelmapList { item_count: number; items: Pixelmap[] }

// ── jobs ────────────────────────────────────────────────────────────────────

export interface Job {
    id: string;
    app_id: string;
    mode?: JobMode;
    status: JobStatus;
    creator_id: string;
    creator_type: JobCreatorType;
    containerized?: boolean;
    inputs: Record<string, string>;
    outputs: Record<string, string>;
    progress?: number | null;
    runtime?: number | null;
    created_at?: number;
    started_at?: number | null;
    ended_at?: number | null;
    error_message?: string | null;
    input_validation_status?: JobValidationStatus;
    input_validation_error_message?: string | null;
    output_validation_status?: JobValidationStatus;
    output_validation_error_message?: string | null;
}

export interface JobList { item_count?: number; items: Job[] }

// ── app-ui storage ──────────────────────────────────────────────────────────

export interface AppUiStorage {
    content: Record<string, string | number | boolean>;
}

// ── module-internal ─────────────────────────────────────────────────────────

/** `dataID` shape our slide protocol understands. */
export interface EmpaiaDataId {
    slideId: string;
    /** `"wsi"` (default) opens the slide; `"pixelmap"` opens a result overlay. */
    role?: "wsi" | "pixelmap";
    pixelmapId?: string;
    channel?: number;
}

/**
 * Was this record produced by an analysis?
 *
 * The one place the wire's `creator_type` is interpreted. It is compared
 * case-insensitively because the service does not send the casing its schema
 * documents — an exact `=== "job"` silently answered `false` for every record,
 * which turned off annotation attribution, the read-only flag, the hydration
 * filter and pixel-map attribution all at once, with no error anywhere.
 *
 * Applies to annotations, primitives and pixel maps alike: for a job-created
 * record, `creator_id` **is** the producing job's id.
 */
export function isJobCreated(record: { creator_type?: unknown } | null | undefined): boolean {
    return String(record?.creator_type ?? "").toLowerCase() === "job";
}

/** A job status that will not change without user action. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
    "COMPLETED", "FAILED", "TIMEOUT", "ERROR", "INCOMPLETE", "ASSEMBLY", "NONE",
]);

export function isJobTerminal(job: Pick<Job, "status">): boolean {
    return TERMINAL_JOB_STATUSES.has(job.status);
}

/** Validation finished (or never ran) — used to decide when polling may stop. */
export function isJobValidationTerminal(job: Job): boolean {
    const done = (s?: JobValidationStatus) => !s || s === "COMPLETED" || s === "ERROR" || s === "FAILED";
    return done(job.input_validation_status) && done(job.output_validation_status);
}

/**
 * Does this job belong to `mode`?
 *
 * The wire enum is uppercase (`"STANDALONE"`) and the EAD names are not. Now
 * that one list carries every mode's jobs, this comparison is what keeps a
 * standalone draft from being adopted as a postprocessing one.
 */
export function isJobOfMode(job: { mode?: string } | undefined, mode: string): boolean {
    return String(job?.mode ?? "").toLowerCase() === String(mode ?? "").toLowerCase();
}
