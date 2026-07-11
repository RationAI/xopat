// ── Ambient types for the virtualization-detector registry ──────────────────
// (window.VIRTUALIZATION_DETECTORS). No export{} — these types are visible in
// all files like the other src/types/*.d.ts ambients (app.d.ts, slide-protocols.d.ts).
//
// Core owns only the probe *contract* and this registry. The actual
// region-finding (auto tissue mask) lives in an OPTIONAL module that needs
// OpenCV-class deps and registers a detector at runtime. Absent that module,
// `TileSource.probeVirtualization()` returns null and nothing virtualizes.

/**
 * Context handed to a detector. `tileSource` is the (ready) source being
 * probed; `httpClient` is a per-detector client built from the detector's
 * `httpClient` options, present when the detector delegates region-finding to
 * an upstream service rather than computing client-side.
 */
interface VirtualizationDetectorContext {
    /** The OpenSeadragon.TileSource (with xOpat extensions) being probed. */
    tileSource: any;
    /** Convenience: the source's `tileSourceId`, when known. */
    tileSourceId?: string;
    /** Per-detector HttpClient (server-delegated detection); undefined for client-side detectors. */
    httpClient?: any /* HttpClient */;
    /** Caller hints (e.g. `{ maxRegions }`). */
    options?: Record<string, any>;
}

/**
 * A region-finder. Registered at runtime by a detector module via
 * `window.VIRTUALIZATION_DETECTORS.register({...})`.
 */
interface VirtualizationDetector {
    id: string;
    label?: string;
    /** Detectors run highest-priority first; first non-null result wins. Default 0. */
    priority?: number;
    /** Quick gate. When it returns false the detector is skipped without calling `detect`. */
    supports?(ctx: VirtualizationDetectorContext): boolean | Promise<boolean>;
    /** Compute the decomposition for this source, or null when there is nothing to split. */
    detect(ctx: VirtualizationDetectorContext): Promise<VirtualDecomposition | null> | VirtualDecomposition | null;
    /**
     * Optional HttpClient configuration for server-delegated detection. When
     * present the registry builds (and caches) one client per detector id and
     * exposes it via `ctx.httpClient`. Shape mirrors slide-protocol entries.
     */
    httpClient?: SlideProtocolHttpClientOptions;
}

interface VirtualizationDetectorRegistryLike {
    register(detector: VirtualizationDetector): () => void;
    unregister(id: string): boolean;
    has(id: string): boolean;
    list(): ReadonlyArray<{ id: string; label: string; priority: number }>;
    /**
     * Run the registered detectors (highest priority first) against a ready
     * TileSource and return the first non-null decomposition, or null. Called
     * by the default `TileSource.probeVirtualization()`.
     */
    detect(tileSource: any, options?: Record<string, any>): Promise<VirtualDecomposition | null>;
}
