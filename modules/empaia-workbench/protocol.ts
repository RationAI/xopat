/// <reference path="../../src/types/globals.d.ts" />

/**
 * Slide-protocol registration for the EMPAIA Workbench.
 *
 * A **factory** protocol (not a URL template) because the backend base URL and
 * the scope id only exist at runtime — they arrive over `postMessage` — so
 * there is nothing an `env.json` template could interpolate. Same shape the
 * DICOM plugin uses (`plugins/dicom/index.workspace.mjs`).
 *
 * `createTileSource` is synchronous by contract, so anything it needs (slide
 * geometry for a pixelmap overlay, the pixelmap record itself) must already be
 * cached. The module pre-fetches both before it appends a data entry that
 * references them; a cache miss is a programming error and says so.
 *
 * `dataID` shapes this protocol understands:
 *   `{ slideId }`                                     → the slide
 *   `{ slideId, role: "pixelmap", pixelmapId, channel }` → a result overlay
 */

import { registerEmpaiaTileSource } from "./tile-source";
import { registerEmpaiaPixelmapTileSource } from "./pixelmap-tile-source";
import type { EmpaiaDataId, Pixelmap, SlideInfo } from "./types";

export const EMPAIA_PROTOCOL_ID = "empaia_wbs3";

export interface EmpaiaProtocolContext {
    /** `{wbsUrl}/v3/scopes/{scopeId}` */
    scopeRoot: string;
    /** Per-protocol HttpClient (the same instance `Wbs3Client` uses). */
    client: any;
    /** Cached `/info` per slide id — populated before a slide is opened. */
    slideInfo: Map<string, SlideInfo>;
    /** Cached pixelmap records per pixelmap id. */
    pixelmaps: Map<string, Pixelmap>;
    /** class value → CSS colour, from EAD `rendering.nominal_pixelmaps`. */
    pixelmapClassColors: Map<string, string>;
    /** `image_format` / `image_quality` for slide tiles. */
    tileFormat?: string;
    tileQuality?: number;
}

/** Live pixelmap sources, so the UI can retune colour/channel without a reopen. */
const _pixelmapSources = new Map<string, any>();

export function getPixelmapSource(pixelmapId: string, channel = 0): any | undefined {
    return _pixelmapSources.get(`${pixelmapId}:${channel}`);
}

export function listPixelmapSources(): any[] {
    return [..._pixelmapSources.values()];
}

/**
 * Register the protocol. Returns the registry's disposer, or undefined when the
 * slide-protocol registry is unavailable (an xOpat too old to have it).
 */
export function registerEmpaiaProtocol(ctx: EmpaiaProtocolContext): (() => void) | undefined {
    registerEmpaiaTileSource();
    registerEmpaiaPixelmapTileSource();

    const registry = (window as any).SLIDE_PROTOCOLS;
    if (!registry?.register) {
        console.error("[empaia-workbench] window.SLIDE_PROTOCOLS unavailable — slides cannot be opened.");
        return undefined;
    }

    const OSD: any = (window as any).OpenSeadragon;

    return registry.register({
        id: EMPAIA_PROTOCOL_ID,
        label: "EMPAIA Workbench v3",
        createTileSource: (resolveCtx: any) => {
            const id = normalizeDataId(resolveCtx?.dataID);
            if (!id) {
                throw new Error(
                    `[empaia-workbench] protocol "${EMPAIA_PROTOCOL_ID}" requires ` +
                    `dataID = { slideId } or { slideId, role: "pixelmap", pixelmapId }, ` +
                    `got ${JSON.stringify(resolveCtx?.dataID)}`
                );
            }

            // The registry stamps `ctx.httpClient` when the entry declares
            // `httpClient` options; we build our own client from the runtime
            // session instead, so pass it explicitly and let the registry's
            // safety-net stamp be a no-op.
            const client = resolveCtx?.httpClient ?? ctx.client;

            if (id.role === "pixelmap") {
                return buildPixelmapSource(ctx, id, client, OSD);
            }

            const source = new OSD.EmpaiaWorkbenchV3TileSource({
                scopeRoot: ctx.scopeRoot,
                slideId: id.slideId,
                client,
            });
            // Apply the deployment's transfer preferences before the metadata
            // request goes out — the whole point of a self-configuring source.
            source.setSourceOptions({
                ...(resolveCtx?.options ?? {}),
                format: resolveCtx?.options?.format ?? ctx.tileFormat,
                quality: resolveCtx?.options?.quality ?? ctx.tileQuality,
            });
            return source;
        },
    });
}

function buildPixelmapSource(ctx: EmpaiaProtocolContext, id: EmpaiaDataId, client: any, OSD: any): any {
    const pixelmapId = String(id.pixelmapId ?? "");
    const pixelmap = ctx.pixelmaps.get(pixelmapId);
    const slideInfo = ctx.slideInfo.get(id.slideId);

    if (!pixelmap) {
        throw new Error(`[empaia-workbench] pixelmap ${pixelmapId} is not cached — ` +
            `fetch it before adding a data entry that references it.`);
    }
    if (!slideInfo) {
        throw new Error(`[empaia-workbench] slide info for ${id.slideId} is not cached — ` +
            `a pixelmap overlay needs its parent slide's pyramid geometry.`);
    }

    const channel = Number.isInteger(id.channel) ? (id.channel as number) : 0;
    const source = new OSD.EmpaiaPixelmapTileSource({
        pixelmap,
        slideInfo,
        scopeRoot: ctx.scopeRoot,
        client,
        channel,
        classColors: ctx.pixelmapClassColors,
    });
    _pixelmapSources.set(`${pixelmapId}:${channel}`, source);
    return source;
}

/** Accepts the object form; tolerates a bare slide-id string for convenience. */
function normalizeDataId(raw: unknown): EmpaiaDataId | undefined {
    if (typeof raw === "string" && raw) return { slideId: raw, role: "wsi" };
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Record<string, unknown>;
    const slideId = typeof value.slideId === "string" ? value.slideId : undefined;
    if (!slideId) return undefined;

    const role = value.role === "pixelmap" ? "pixelmap" : "wsi";
    if (role === "pixelmap" && typeof value.pixelmapId !== "string") return undefined;

    return {
        slideId,
        role,
        pixelmapId: typeof value.pixelmapId === "string" ? value.pixelmapId : undefined,
        channel: typeof value.channel === "number" ? value.channel : undefined,
    };
}
