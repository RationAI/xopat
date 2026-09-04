/// <reference path="../../src/types/globals.d.ts" />

/**
 * `OpenSeadragon.EmpaiaWorkbenchV3TileSource`
 *
 * The Workbench Service serves the very same WSI-Service slide model as the
 * standalone service already supported by
 * `modules/rationai-wsi-tile-source/tile-source.js` — identical `/info`
 * response (`extent`, `tile_extent`, `levels[].downsample_factor`,
 * `pixel_size_nm`, `channels`, `channel_depth`), identical inverted level
 * ordering, identical `z` focal-plane parameter. Only the **routing** differs:
 *
 *   standalone : `{base}/v3/slides/tile/level/{l}/tile/{x}/{y}?slide_id={id}`
 *   workbench  : `{base}/v3/scopes/{scope}/slides/{id}/tile/level/{l}/tile/{x}/{y}`
 *
 * So this class subclasses it and overrides only the URL builders. Everything
 * expensive — pyramid construction, z-stack descriptor, preview-level
 * injection, `getSampleEncoding`, the tiff/raster download dispatch, the
 * `__xopatHttpClient` routing — is inherited unchanged.
 *
 * Constructed directly by the slide-protocol factory (never autodetected), so
 * it keeps the `xopatSelfConfiguring` contract from `src/tile-source.ts`.
 */

export interface EmpaiaTileSourceOptions {
    /** `{wbsUrl}/v3/scopes/{scopeId}` */
    scopeRoot: string;
    slideId: string;
    /** Per-protocol HttpClient stamped by the registry. */
    client?: any;
    /** `image_format` for tile requests, e.g. `"jpeg"` / `"png"` / `"tiff"`. */
    format?: string;
    /** `image_quality`, 0-100. */
    quality?: number;
    [key: string]: any;
}

/** Registers the class on the OpenSeadragon namespace. Idempotent. */
export function registerEmpaiaTileSource(): void {
    const OSD: any = (window as any).OpenSeadragon;
    if (!OSD) {
        console.error("[empaia-workbench] OpenSeadragon unavailable — cannot register the tile source.");
        return;
    }
    if (OSD.EmpaiaWorkbenchV3TileSource) return;

    const Base = OSD.RationaiStandaloneV3TileSource;
    if (!Base) {
        console.error("[empaia-workbench] OpenSeadragon.RationaiStandaloneV3TileSource missing — " +
            'declare "rationai-wsi-tile-source" in include.json::requires.');
        return;
    }

    OSD.EmpaiaWorkbenchV3TileSource = class extends Base {

        /** Built directly by SLIDE_PROTOCOLS; never through OSD autodetection. */
        static xopatSelfConfiguring = true;

        constructor(options: EmpaiaTileSourceOptions) {
            const scopeRoot = String(options.scopeRoot || "").replace(/\/+$/, "");
            const slideId = String(options.slideId || "");
            super({
                ...options,
                // Base `_getInfo` overwrites `tilesUrl` with what it derives from
                // the info URL; we pass the per-slide root and re-pin it below.
                url: `${scopeRoot}/slides/${encodeURIComponent(slideId)}/info`,
                multifetch: false,
            });

            this.__xopatHttpClient = options.client ?? this.__xopatHttpClient;
            this._scopeRoot = scopeRoot;
            this._slideId = slideId;
            /** `{scopeRoot}/slides/{slideId}` — every per-slide route hangs off this. */
            this._slideRoot = `${scopeRoot}/slides/${encodeURIComponent(slideId)}`;
            // Stable per-source identity. DICOMweb-style backends share one base
            // URL across slides, so URL-keyed state collides (AGENTS.md §8).
            this.tileSourceId = `empaia:${slideId}`;
            this.fileId = slideId;
        }

        /**
         * The workbench never serves the multiplexed `/v3/files` endpoint and
         * always carries the slide id in the path — so the base's URL sniffing
         * does not apply. Recognise our own shape and delegate to the inherited
         * `_getInfo`, which configures `this` in place and raises `ready`.
         */
        getImageInfo(url: string) {
            const match = String(url || "").match(/^(.*\/v3\/scopes\/[^/]+\/slides\/[^/]+)\/info(?:\?.*)?$/i);
            if (match) {
                this._setDownloadHandler(false);
                return this._getInfo(url, match[1]);
            }
            console.warn("[empaia-workbench] not a workbench slide-info URL, falling back to autodetection:", url);
            return super.getImageInfo(url);
        }

        /**
         * Tile URL. Level inversion is the same as the base class (WSI-Service
         * level 0 is the finest, OSD level 0 the coarsest); the difference is
         * that `slide_id` lives in the path, so the option query — which the
         * base emits as `&`-prefixed after `?slide_id=` — has to start the
         * query string here.
         */
        getUrl(level: number, x: number, y: number, tiles: string = this._slideRoot): string {
            const serverLevel = this.maxLevel - level;
            const query = this._queryString();
            return `${tiles}/tile/level/${serverLevel}/tile/${x}/${y}${query}`;
        }

        getTileUrl(level: number, x: number, y: number): string {
            return this.getUrl(level, x, y);
        }

        /**
         * `_qArgs` is built by the inherited `setSourceOptions` as `&a=1&b=2`
         * (it is appended after a mandatory `?slide_id=…`). Turn it into a
         * standalone query string, then append the focal-plane parameter.
         */
        _queryString(): string {
            const args = String(this._qArgs || "").replace(/^&/, "");
            const z = String(this._zQuery() || "").replace(/^&/, "");
            const parts = [args, z].filter(Boolean);
            return parts.length ? `?${parts.join("&")}` : "";
        }

        async getThumbnail({ targetWidth = 512 }: { targetWidth?: number } = {}): Promise<Blob> {
            const size = Math.min(targetWidth, 500);
            const res = await this._fetch(`${this._slideRoot}/thumbnail/max_size/${size}/${size}${this._queryString()}`);
            return res.blob();
        }

        async getLabel(): Promise<Blob> {
            const size = 250;
            const res = await this._fetch(`${this._slideRoot}/label/max_size/${size}/${size}${this._queryString()}`);
            return res.blob();
        }

        async getMacro({ targetWidth = 500 }: { targetWidth?: number } = {}): Promise<Blob> {
            const size = Math.min(targetWidth, 500);
            const res = await this._fetch(`${this._slideRoot}/macro/max_size/${size}/${size}${this._queryString()}`);
            return res.blob();
        }

        /**
         * The workbench exposes no ICC endpoint; the base implementation would
         * request a 404 on every open. Report "no profile" instead.
         */
        async downloadICCProfile(): Promise<ArrayBuffer | undefined> {
            return undefined;
        }

        /**
         * Same story for raw slide access: the scope-rooted workbench API has no
         * `/download` route, and the app's data-access contract is the scope, not
         * the file. Never offer it, whatever `raw_download` the info says.
         */
        canDownloadSlideFile(): boolean {
            return false;
        }

        /** Technical metadata only — nothing patient-identifying (see src/tile-source.ts). */
        getDisplayMetadata() {
            const t = (key: string) => $.t(`slideInfo.${key}`, { ns: "empaia-workbench" });
            const m = this.metadata || {};
            if (m.error) return [{ title: t("unavailable"), description: String(m.error) }];

            const fields: Array<{ label: string; value: string | number }> = [];
            if (this.width != null && this.height != null) {
                fields.push({ label: t("dimensions"), value: `${this.width} × ${this.height} px` });
            }
            const tw = this._tileWidth ?? this.tileSize;
            const th = this._tileHeight ?? this.tileSize;
            if (tw != null) {
                fields.push({ label: t("tileSize"), value: th != null && th !== tw ? `${tw} × ${th} px` : `${tw} px` });
            }
            if (Number.isFinite(this.maxLevel)) {
                fields.push({ label: t("levels"), value: this.maxLevel + 1 });
            }
            if (Number.isFinite(m.micronsX) && Number.isFinite(m.micronsY)) {
                fields.push({ label: t("pixelSize"), value: `${Number(m.micronsX).toFixed(3)} × ${Number(m.micronsY).toFixed(3)} µm` });
            }
            if (this._slideId) fields.push({ label: t("slideId"), value: String(this._slideId) });
            if (this.innerFormat) fields.push({ label: t("format"), value: String(this.innerFormat) });
            const channels = Array.isArray(this.data?.channels) ? this.data.channels.length : undefined;
            if (channels) fields.push({ label: t("channels"), value: channels });
            if (Number.isFinite(Number(this.data?.channel_depth))) {
                fields.push({ label: t("bitDepth"), value: `${Number(this.data.channel_depth)} bit` });
            }
            if (this.zStack && this.zStack.count > 1) {
                fields.push({ label: t("focalPlanes"), value: this.zStack.count });
            }
            return fields.length ? [{ title: t("title"), fields }] : [];
        }

        getTileHashKey(level: number, x: number, y: number): string {
            const serverLevel = this.maxLevel - level;
            // z-independent on purpose — see the base class note.
            return `${x}_${y}/${serverLevel}/empaia:${this._slideId}`;
        }
    };
}
