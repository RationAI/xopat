import type {ScriptApiObject} from "../scripting-manager";

/**
 * Identifying / patient-sensitive metadata for the active viewer's slide, read from
 * `TileSource.getSensitiveMetadata()`. Shape is source-defined and may be nested; all
 * values are plain serializable data. Empty object when the source exposes nothing.
 */
export type PatientMetadata = Record<string, unknown>;

/**
 * Identifying path / filename information for the active viewer's slide. These fields are
 * intentionally excluded from the general `application` namespace because raw paths and
 * filenames routinely embed patient ids / case numbers.
 */
export interface SlidePaths {
    /** Raw server path of the primary background image, or null. */
    serverPath: string | null;
    /** Raw data path bound to the active background (config.data[dataReference]), or null. */
    backgroundDataPath: string | null;
    /** Raw data paths for every world item, in world order (null where unknown). */
    worldDataPaths: (string | null)[];
    /** Filename derived from the primary server path (may embed identifiers), or null. */
    fileName: string | null;
    /** Application session name (may be named after a patient / case), or null. */
    sessionName: string | null;
}

/**
 * Isolated namespace exposing identifying / patient-sensitive slide information that is kept
 * out of the general `viewer` / `application` namespaces and the default assistant context.
 * All methods operate on the viewer bound to the current script context (select it first with
 * `application.setActiveViewer()`), and degrade to null / empty values rather than throwing.
 */
export interface PatientScriptApi extends ScriptApiObject {
    /**
     * Returns identifying / patient metadata for the active viewer's slide
     * (`TileSource.getSensitiveMetadata()`), or an empty object when none is available.
     */
    getPatientMetadata(): PatientMetadata;

    /**
     * Returns the slide's physical label / macro image as a PNG data-URL string, or null when
     * the source has no label. Physical slide labels frequently have patient name / id /
     * accession printed on them, so this is treated as identifying.
     */
    getSlideLabelImage(): Promise<string | null>;

    /**
     * Returns the slide's overview / thumbnail image as a PNG data-URL string, or null when the
     * source has no thumbnail.
     */
    getSlideThumbnail(): Promise<string | null>;

    /**
     * Returns identifying path / filename / session information for the active viewer's slide.
     */
    getSlidePaths(): SlidePaths;
}
