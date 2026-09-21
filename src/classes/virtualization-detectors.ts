// Virtualization-detector registry. Owns the runtime list of region-finders
// that turn one slide into a `VirtualDecomposition` (a slide-wide spatial
// partition). Core ships ONLY this registry + the probe contract on
// `OpenSeadragon.TileSource` (src/tile-source.ts). The actual auto tissue-mask
// detection lives in an OPTIONAL module that registers a detector here at
// runtime — it can either compute client-side (OpenCV-class deps) or delegate
// to an upstream server via a per-detector HttpClient.
//
// Singleton, exposed as `window.VIRTUALIZATION_DETECTORS`. Bootstrapped from
// `src/app.ts` adjacent to `bootstrapSlideProtocols(...)`.
//
// See src/types/virtualization-detectors.d.ts for the public type surface and
// the virtual-viewports plan for the full design.

import { HttpClient } from "./http-client";

export class VirtualizationDetectorRegistry implements VirtualizationDetectorRegistryLike {
    private detectors = new Map<string, VirtualizationDetector>();
    /** Per-detector HttpClient cache, keyed by detector id (server-delegated detection). */
    private clients = new Map<string, HttpClient>();

    register(detector: VirtualizationDetector): () => void {
        if (!detector?.id) throw new Error("[VIRTUALIZATION_DETECTORS] register: missing id");
        if (this.detectors.has(detector.id)) {
            throw new Error(`[VIRTUALIZATION_DETECTORS] duplicate detector id "${detector.id}"`);
        }
        this.detectors.set(detector.id, detector);
        return () => this.unregister(detector.id);
    }

    unregister(id: string): boolean {
        this.clients.delete(id);
        return this.detectors.delete(id);
    }

    has(id: string): boolean {
        return this.detectors.has(id);
    }

    list() {
        return Array.from(this.detectors.values()).map((d) => ({
            id: d.id,
            label: d.label ?? d.id,
            priority: d.priority ?? 0,
        }));
    }

    /**
     * Lazily construct + cache the HttpClient for a detector that declares
     * `httpClient` options. Returns undefined for client-side-only detectors.
     */
    private _clientFor(detector: VirtualizationDetector): HttpClient | undefined {
        const cached = this.clients.get(detector.id);
        if (cached) return cached;
        const opts = detector.httpClient;
        if (!opts || (!opts.proxy && !opts.baseURL)) return undefined;
        try {
            const client = new HttpClient({ ...opts });
            this.clients.set(detector.id, client);
            return client;
        } catch (e) {
            console.warn(`[VIRTUALIZATION_DETECTORS] failed to construct HttpClient for detector "${detector.id}":`, e);
            return undefined;
        }
    }

    async detect(tileSource: any, options?: Record<string, any>): Promise<VirtualDecomposition | null> {
        if (!tileSource) return null;
        // Highest priority first; first non-null (with >=1 region) result wins.
        const ordered = Array.from(this.detectors.values())
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        const tileSourceId = tileSource.tileSourceId;
        for (const detector of ordered) {
            const ctx: VirtualizationDetectorContext = {
                tileSource,
                tileSourceId,
                httpClient: this._clientFor(detector),
                options,
            };
            try {
                if (detector.supports && !(await detector.supports(ctx))) continue;
                const result = await detector.detect(ctx);
                if (result && Array.isArray(result.regions) && result.regions.length >= 1) {
                    // Stamp provenance the detector may have omitted. The parent
                    // `dataReference` is filled later (at expand time) from the
                    // owning background — the registry has no config/index context.
                    if (!result.detectorId) result.detectorId = detector.id;
                    return result;
                }
            } catch (e) {
                console.warn(`[VIRTUALIZATION_DETECTORS] detector "${detector.id}" failed:`, e);
            }
        }
        return null;
    }
}

/**
 * Create the registry and attach it to `window.VIRTUALIZATION_DETECTORS`.
 * Mirrors `bootstrapSlideProtocols` in `src/classes/slide-protocols.ts`. No env
 * ingestion — detectors register at runtime from their module.
 */
export function bootstrapVirtualizationDetectors(): VirtualizationDetectorRegistry {
    const registry = new VirtualizationDetectorRegistry();
    (window as any).VIRTUALIZATION_DETECTORS = registry;
    return registry;
}
