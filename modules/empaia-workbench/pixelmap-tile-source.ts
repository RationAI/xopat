/// <reference path="../../src/types/globals.d.ts" />

/**
 * `OpenSeadragon.EmpaiaPixelmapTileSource`
 *
 * An EMPAIA pixelmap is a *result* raster: an app writes scalar values (one or
 * more channels) onto a tile grid aligned with the WSI pyramid. The endpoint
 *
 *   `GET /{scope}/pixelmaps/{id}/level/{l}/position/{x}/{y}/data`
 *
 * returns a **raw typed-array buffer**, not an image — `tilesize² ×
 * channel_count` elements of `element_type`, laid out **planar per channel**
 * (channel c occupies `[w*h*c, w*h*(c+1))`, row-major inside). That layout is
 * the one the reference renderer assumes
 * (`libs/pixelmap-rendering-collection/src/lib/pixelmap-rendering-collection.ts`,
 * `drawColorMapImage`).
 *
 * We fetch it, colour-map it, and hand OSD a finished canvas — so the overlay
 * can ride the ordinary `identity` shader layer instead of needing a bespoke
 * GPU path. Colour mapping is one `ImageData` write per tile.
 *
 * Sparse-data contract: `levels[].position_min/max_{x,y}` declare where tiles
 * actually exist. Requests outside those bounds are answered locally with a
 * transparent tile and never hit the network — the hint exists precisely so
 * viewers do not hammer the backend with 404s.
 */

import { categoricalColor, colorMapLut, DEFAULT_COLOR_MAP, parseCssColor, type Rgb } from "./colormaps";
import type { Pixelmap, PixelmapElementType, PixelmapLevel, SlideInfo } from "./types";

export interface EmpaiaPixelmapTileSourceOptions {
    pixelmap: Pixelmap;
    /** Slide the pixelmap references — supplies the pyramid geometry. */
    slideInfo: SlideInfo;
    /** `{wbsUrl}/v3/scopes/{scopeId}` */
    scopeRoot: string;
    client?: any;
    /** Channel to render (default 0). */
    channel?: number;
    /** Colour map id for continuous/discrete maps (see `colormaps.ts`). */
    colorMap?: string;
    /** class value → CSS colour, from the EAD nominal-pixelmap rendering hints. */
    classColors?: Map<string, string>;
    [key: string]: any;
}

/** Bytes per element for each declared pixelmap element type. */
const ELEMENT_BYTES: Record<PixelmapElementType, number> = {
    uint8: 1, int8: 1,
    uint16: 2, int16: 2,
    uint32: 4, int32: 4, float32: 4,
    uint64: 8, int64: 8, float64: 8,
};

/** Wrap a buffer in the typed array matching the pixelmap's element type. */
function viewOf(buffer: ArrayBuffer, elementType: PixelmapElementType): ArrayLike<number | bigint> {
    switch (elementType) {
        case "uint8": return new Uint8Array(buffer);
        case "int8": return new Int8Array(buffer);
        case "uint16": return new Uint16Array(buffer);
        case "int16": return new Int16Array(buffer);
        case "uint32": return new Uint32Array(buffer);
        case "int32": return new Int32Array(buffer);
        case "uint64": return new BigUint64Array(buffer);
        case "int64": return new BigInt64Array(buffer);
        case "float32": return new Float32Array(buffer);
        case "float64": return new Float64Array(buffer);
        default: throw new Error(`Unsupported pixelmap element type: ${elementType}`);
    }
}

export function registerEmpaiaPixelmapTileSource(): void {
    const OSD: any = (window as any).OpenSeadragon;
    if (!OSD) {
        console.error("[empaia-workbench] OpenSeadragon unavailable — cannot register the pixelmap tile source.");
        return;
    }
    if (OSD.EmpaiaPixelmapTileSource) return;

    OSD.EmpaiaPixelmapTileSource = class extends OSD.TileSource {

        static xopatSelfConfiguring = true;

        constructor(options: EmpaiaPixelmapTileSourceOptions) {
            const pixelmap = options.pixelmap;
            const slideInfo = options.slideInfo;
            const tileSize = Math.max(1, Math.round(pixelmap.tilesize));
            const levels = Array.isArray(slideInfo.levels) ? slideInfo.levels : [];

            super({
                width: slideInfo.extent.x,
                height: slideInfo.extent.y,
                // Non-square is impossible for a pixelmap (the API enforces
                // squares), but stay with the unprefixed pair so OSD does not
                // re-derive a square `tileSize` and add a phantom row.
                tileWidth: tileSize,
                tileHeight: tileSize,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: Math.max(0, levels.length - 1),
            });

            this._pixelmap = pixelmap;
            this._slideLevels = levels;
            this._scopeRoot = String(options.scopeRoot || "").replace(/\/+$/, "");
            this.__xopatHttpClient = options.client;
            this._channel = clampChannel(options.channel, pixelmap.channel_count);
            this._colorMap = options.colorMap || DEFAULT_COLOR_MAP;
            this._inverted = false;
            this._classColors = options.classColors instanceof Map ? options.classColors : new Map();

            // slide_level → level descriptor, for the sparse-tile bounds check.
            this._levelBounds = new Map<number, PixelmapLevel>();
            for (const level of pixelmap.levels || []) {
                if (level && Number.isInteger(level.slide_level)) this._levelBounds.set(level.slide_level, level);
            }

            this._nominalLut = this._buildNominalLut();
            // Bumped whenever the rendering choice changes, so OSD's cache key
            // changes with it and already-drawn tiles are re-decoded.
            this._renderToken = 0;
            this.tileSourceId = `empaia-pixelmap:${pixelmap.id}:${this._channel}`;
            // The overlay has no meaningful thumbnail; skip the synthetic level.
            this.__noPreviewLevel = true;
            this.ready = true;
        }

        // ── geometry ────────────────────────────────────────────────────────

        /**
         * WSI pyramids declare arbitrary downsample factors, not powers of two,
         * so the OSD default (`1 / 2^(maxLevel-level)`) would misplace tiles.
         * Same override the WSI-Service slide source uses.
         */
        getLevelScale(level: number): number {
            const serverLevel = this.maxLevel - level;
            const levels = this._slideLevels;
            const factor = (idx: number) => {
                const value = Number(levels?.[idx]?.downsample_factor);
                return Number.isFinite(value) && value > 0 ? value : Math.pow(2, idx);
            };
            return factor(0) / factor(serverLevel);
        }

        /** OSD level → WSI-Service level (0 = finest on the server). */
        _serverLevel(level: number): number {
            return this.maxLevel - level;
        }

        /** False when the sparse-data hint says no tile can exist here. */
        _hasTile(serverLevel: number, x: number, y: number): boolean {
            const bounds = this._levelBounds.get(serverLevel);
            if (!bounds) return false;
            const within = (v: number, min: unknown, max: unknown) => {
                if (typeof min === "number" && v < min) return false;
                if (typeof max === "number" && v > max) return false;
                return true;
            };
            return within(x, bounds.position_min_x, bounds.position_max_x)
                && within(y, bounds.position_min_y, bounds.position_max_y);
        }

        getTileUrl(level: number, x: number, y: number): string {
            const serverLevel = this._serverLevel(level);
            return `${this._scopeRoot}/pixelmaps/${encodeURIComponent(String(this._pixelmap.id))}` +
                `/level/${serverLevel}/position/${x}/${y}/data`;
        }

        getTileHashKey(level: number, x: number, y: number): string {
            const serverLevel = this._serverLevel(level);
            return `${x}_${y}/${serverLevel}/${this.tileSourceId}/r${this._renderToken}`;
        }

        // ── rendering options ───────────────────────────────────────────────

        /** Colour map id for continuous / discrete maps. */
        setColorMap(name: string): void {
            if (this._colorMap === name) return;
            this._colorMap = name;
            this._renderToken++;
        }

        getColorMap(): string { return this._colorMap; }

        setInverted(inverted: boolean): void {
            const value = !!inverted;
            if (this._inverted === value) return;
            this._inverted = value;
            this._renderToken++;
        }

        setChannel(channel: number): void {
            const next = clampChannel(channel, this._pixelmap.channel_count);
            if (this._channel === next) return;
            this._channel = next;
            this.tileSourceId = `empaia-pixelmap:${this._pixelmap.id}:${next}`;
            this._renderToken++;
        }

        getChannel(): number { return this._channel; }

        getMetadata() {
            return {
                pixelmapId: this._pixelmap.id,
                pixelmapType: this._pixelmap.type,
                channels: this._pixelmap.channel_count,
                elementType: this._pixelmap.element_type,
            };
        }

        getDisplayMetadata() {
            const t = (key: string) => $.t(`pixelmapInfo.${key}`, { ns: "empaia-workbench" });
            const p = this._pixelmap;
            const fields: Array<{ label: string; value: string | number }> = [
                { label: t("type"), value: String(p.type).replace(/_/g, " ") },
                { label: t("elementType"), value: String(p.element_type) },
                { label: t("channels"), value: p.channel_count },
                { label: t("tileSize"), value: `${p.tilesize} px` },
            ];
            if (typeof p.min_value === "number" && typeof p.max_value === "number") {
                fields.push({ label: t("valueRange"), value: `${p.min_value} – ${p.max_value}` });
            }
            return [{ title: p.name || t("title"), fields }];
        }

        // ── tile pipeline ───────────────────────────────────────────────────

        downloadTileStart(context: any): void {
            const controller = new AbortController();
            context.userData.abortController = controller;

            (async () => {
                try {
                    const level = context.tile?.level ?? 0;
                    const x = context.tile?.x ?? 0;
                    const y = context.tile?.y ?? 0;
                    const serverLevel = this._serverLevel(level);

                    if (!this._hasTile(serverLevel, x, y)) {
                        context.finish(this._blankTile(), null, "context2d");
                        return;
                    }

                    const buffer = await this._fetchTile(context.src, controller.signal);
                    if (controller.signal.aborted) return;
                    if (!buffer || buffer.byteLength === 0) {
                        context.finish(this._blankTile(), null, "context2d");
                        return;
                    }

                    const rendered = this._render(buffer);
                    if (controller.signal.aborted) return;
                    // OSD's `"context2d"` data type is the 2D *context*, not the
                    // canvas element (see its own plain-image source).
                    context.finish(rendered, null, "context2d");
                } catch (e: any) {
                    if (controller.signal.aborted) return;
                    context.fail(e?.message ?? String(e), null);
                }
            })();
        }

        downloadTileAbort(context: any): void {
            context.userData?.abortController?.abort();
            if (context.userData) context.userData.abortController = null;
        }

        async _fetchTile(url: string, signal: AbortSignal): Promise<ArrayBuffer | undefined> {
            const client = this.__xopatHttpClient;
            const res = client?.fetchRaw
                ? await client.fetchRaw(url, { signal })
                : await fetch(url, { signal });
            // A missing tile inside the declared bounds is normal for sparse maps.
            if (res.status === 404 || res.status === 204) return undefined;
            if (!res.ok) throw new Error(`Pixelmap tile request failed: HTTP ${res.status}`);
            return res.arrayBuffer();
        }

        /**
         * Transparent tile for positions the sparse-data hint rules out.
         *
         * A fresh context every time: OSD's cache takes ownership of what
         * `finish` hands it (`learnDestroy("context2d", …)` frees the canvas),
         * so a shared instance would be destroyed out from under later tiles.
         */
        _blankTile(): CanvasRenderingContext2D {
            const canvas = document.createElement("canvas");
            canvas.width = this._pixelmap.tilesize;
            canvas.height = this._pixelmap.tilesize;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas 2D context unavailable.");
            // A fresh 2D canvas is already fully transparent.
            return ctx;
        }

        /**
         * Colour-map one raw tile buffer into an RGBA canvas.
         *
         * The buffer length is validated against the declared geometry before
         * it is viewed as a typed array — a short buffer would otherwise make
         * the view throw or, worse, silently read a truncated plane.
         */
        _render(buffer: ArrayBuffer): CanvasRenderingContext2D {
            const p = this._pixelmap;
            const size = p.tilesize;
            const pixels = size * size;
            const bytes = ELEMENT_BYTES[p.element_type];
            if (!bytes) throw new Error(`Unsupported pixelmap element type: ${p.element_type}`);

            const expected = pixels * p.channel_count * bytes;
            if (buffer.byteLength < expected) {
                throw new Error(
                    `Pixelmap tile is shorter than declared: got ${buffer.byteLength} B, ` +
                    `expected ${expected} B (${size}² × ${p.channel_count} × ${bytes} B).`
                );
            }

            const data = viewOf(buffer, p.element_type);
            const start = pixels * this._channel;

            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas 2D context unavailable.");
            const image = ctx.createImageData(size, size);
            const out = image.data;

            if (p.type === "nominal_pixelmap") {
                this._paintNominal(data, start, pixels, out);
            } else {
                this._paintScalar(data, start, pixels, out);
            }

            ctx.putImageData(image, 0, 0);
            return ctx;
        }

        /** Nominal: value → declared class colour; unmapped values stay transparent. */
        _paintNominal(data: ArrayLike<number | bigint>, start: number, pixels: number, out: Uint8ClampedArray): void {
            const lut = this._nominalLut;
            for (let i = 0; i < pixels; i++) {
                const raw = data[start + i];
                const value = typeof raw === "bigint" ? Number(raw) : raw;
                const color = lut.get(value);
                const o = i * 4;
                if (!color) continue;   // transparent — no class declared for this value
                out[o] = color[0];
                out[o + 1] = color[1];
                out[o + 2] = color[2];
                out[o + 3] = 255;
            }
        }

        /** Continuous / discrete: normalize into [0,1] and look up the colour map. */
        _paintScalar(data: ArrayLike<number | bigint>, start: number, pixels: number, out: Uint8ClampedArray): void {
            const p = this._pixelmap;
            const lut = colorMapLut(this._colorMap);
            const min = Number(p.min_value ?? 0);
            const max = Number(p.max_value ?? 1);
            const span = max - min;
            const neutral = p.neutral_value === null || p.neutral_value === undefined
                ? undefined : Number(p.neutral_value);
            const invert = this._inverted;

            for (let i = 0; i < pixels; i++) {
                const raw = data[start + i];
                const value = typeof raw === "bigint" ? Number(raw) : raw;
                const o = i * 4;

                // The neutral value means "nothing here" — render it away rather
                // than as the colour map's mid-point, which would paint the whole
                // slide and hide the tissue underneath.
                if (neutral !== undefined && value === neutral) continue;
                if (!Number.isFinite(value)) continue;

                let t = span === 0 ? 0 : (value - min) / span;
                t = t < 0 ? 0 : (t > 1 ? 1 : t);
                if (invert) t = 1 - t;

                const idx = Math.round(t * 255) * 3;
                out[o] = lut[idx];
                out[o + 1] = lut[idx + 1];
                out[o + 2] = lut[idx + 2];
                out[o + 3] = 255;
            }
        }

        /**
         * numeric value → RGB for a nominal map. Colours come from the EAD
         * rendering hints when the class is named there, else from the stable
         * categorical palette so every class is at least distinguishable.
         */
        _buildNominalLut(): Map<number, Rgb> {
            const lut = new Map<number, Rgb>();
            const mapping = this._pixelmap.element_class_mapping;
            if (!Array.isArray(mapping)) return lut;

            mapping.forEach((entry, index) => {
                if (!entry || typeof entry.number_value !== "number") return;
                const hinted = parseCssColor(this._classColors.get(entry.class_value));
                lut.set(entry.number_value, hinted ?? categoricalColor(index));
            });
            return lut;
        }

        /** Re-seed nominal colours after the EAD hints become available. */
        setClassColors(classColors: Map<string, string>): void {
            this._classColors = classColors instanceof Map ? classColors : new Map();
            this._nominalLut = this._buildNominalLut();
            this._renderToken++;
        }

        /** Legend entries for the UI: one row per declared class. */
        getLegend(): Array<{ value: number; classValue: string; color: Rgb }> {
            const mapping = this._pixelmap.element_class_mapping;
            if (!Array.isArray(mapping)) return [];
            return mapping
                .filter(e => e && typeof e.number_value === "number")
                .map(e => ({
                    value: e.number_value,
                    classValue: e.class_value,
                    color: this._nominalLut.get(e.number_value) ?? [0, 0, 0] as Rgb,
                }));
        }
    };
}

function clampChannel(channel: unknown, count: number): number {
    const max = Math.max(1, Math.round(count || 1)) - 1;
    const value = Math.round(Number(channel) || 0);
    return Math.max(0, Math.min(max, value));
}
