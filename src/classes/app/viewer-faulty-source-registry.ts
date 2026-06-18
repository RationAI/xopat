/**
 * Per-viewer registry of faulty tile sources. Installed as
 * `viewer.__faultySources` next to `__shaderSourceController`.
 *
 * Why this exists: prior to this, "this slide failed" was *derived* from the
 * ephemeral world-item shape — the placeholder `EmptyTileSource.getMetadata()
 * .error` and `tiledImage.getConfig() === undefined`. Those signals are
 * recomputed on every (re)open, so a visualization-only surgical rebuild that
 * re-instantiates or reconfigures the background item silently dropped the
 * faulty marking. This registry persists the verdict keyed by *source
 * identity*, so the three consumers — navigator title, shader-menu alert, and
 * the open-pipeline "render nothing" short-circuit — read a stable answer that
 * survives rebuilds and viz switches.
 *
 * Two failure paths feed it:
 *   - instantiation failure (`openTile` couldn't build the TileSource), and
 *   - N consecutive per-tile request failures during viewing (warn-only: we
 *     keep the image in the world and keep letting OSD request tiles, we just
 *     surface the problem). A single tile success resets the consecutive
 *     counter but does NOT clear an already-raised faulty mark.
 *
 * Keys: for live sources prefer `source.tileSourceId` then `source.url`
 * (never url alone — DICOMweb shares baseUrl across slides). For placeholders
 * and pre-instantiation marks, the pipeline's `loadKey` (`item.__xopatLoadKey`)
 * is used as the key so both paths agree.
 */

export type FaultyReason = "instantiation" | "tiles";

interface FaultyEntry {
    error: string;
    reason: FaultyReason;
    consecutiveFails: number;
    faulty: boolean;
}

export class ViewerFaultySourceRegistry {
    private readonly entries = new Map<string, FaultyEntry>();

    constructor(private readonly threshold: number = 5) {}

    private ensure(key: string): FaultyEntry {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { error: "", reason: "tiles", consecutiveFails: 0, faulty: false };
            this.entries.set(key, entry);
        }
        return entry;
    }

    /**
     * Derive the canonical registry key for a live OSD tiled image / source.
     * Returns undefined when no stable identity is available.
     */
    static keyForItem(item: any): string | undefined {
        const source = item?.source;
        return source?.tileSourceId || source?.url || item?.__xopatLoadKey || undefined;
    }

    /** Mark a source faulty outright (e.g. instantiation failure). Idempotent: keeps the first error. */
    markFaulty(key: string | undefined, error: string, reason: FaultyReason = "instantiation"): void {
        if (!key) return;
        const entry = this.ensure(key);
        if (!entry.faulty) {
            entry.faulty = true;
            entry.reason = reason;
            entry.error = error || entry.error || "Source unavailable";
        }
    }

    /**
     * Record a single failed tile request for `key`. Returns true only on the
     * transition into the faulty state (so callers raise one notification).
     */
    recordTileFailure(key: string | undefined, error?: string): boolean {
        if (!key) return false;
        const entry = this.ensure(key);
        entry.consecutiveFails += 1;
        if (!entry.faulty && entry.consecutiveFails >= this.threshold) {
            entry.faulty = true;
            entry.reason = "tiles";
            entry.error = error || entry.error || "Repeated tile request failures.";
            return true;
        }
        return false;
    }

    /** Reset the consecutive-failure counter on a successful tile load. Does not un-fault. */
    recordTileSuccess(key: string | undefined): void {
        if (!key) return;
        const entry = this.entries.get(key);
        if (entry) entry.consecutiveFails = 0;
    }

    isFaulty(key: string | undefined): boolean {
        if (!key) return false;
        return !!this.entries.get(key)?.faulty;
    }

    /**
     * True when the source could not even be instantiated. Such a source can
     * never render — the open pipeline short-circuits it to a transparent
     * placeholder instead of re-hitting the dead endpoint on every rebuild.
     * Tile-level faults (warn-only) deliberately return false: those keep
     * being opened and retried.
     */
    isInstantiationFaulty(key: string | undefined): boolean {
        if (!key) return false;
        const entry = this.entries.get(key);
        return !!entry?.faulty && entry.reason === "instantiation";
    }

    getError(key: string | undefined): string | undefined {
        if (!key) return undefined;
        const entry = this.entries.get(key);
        return entry?.faulty ? entry.error : undefined;
    }

    /** Forget the given keys (e.g. when a viewer swaps to a different background). */
    clearForKeys(keys: Iterable<string | undefined>): void {
        for (const key of keys) {
            if (key) this.entries.delete(key);
        }
    }

    clear(): void {
        this.entries.clear();
    }
}
