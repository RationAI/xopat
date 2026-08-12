/*
 * OpenSeadragon - ExtendedDziTileSource
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2013 OpenSeadragon contributors
 * Copyright (C) 2021 RationAI Research Group (Modifications)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/**
 * `OpenSeadragon.ExtendedDziTileSource` — the RationAI DeepZoom extension
 * (`xmlns` `rationai.fi.muni.cz/deepzoom/images`): an `ImageArray` document
 * describing several co-registered images sharing one tile grid, fetchable with
 * POST and optionally delivered as a ZIP of tiles (see `setFormat("zip")`).
 *
 * Auto-detected by OSD (`supports()` matches the namespace); the class name
 * must keep the `…TileSource` suffix for `TileSource.determineType`.
 */

/** Per-image entry of the `ImageArray` document. */
interface DziImageEntry {
    xmlns?: string;
    Url?: string | null;
    Format?: string;
    DisplayRect?: unknown;
    Overlap?: number;
    TileSize?: number;
    Size?: { Width: number; Height: number };
    error?: string;
}

interface DziConfiguration {
    ImageArray: DziImageEntry[];
    DisplayRect?: Array<{ Rect: Record<string, string | number> }>;
    [key: string]: unknown;
}

type DziDisplayRect = {
    x: number; y: number; width: number; height: number;
    minLevel: number; maxLevel: number;
};

const OSD = window.OpenSeadragon as any;

OSD.ExtendedDziTileSource = class ExtendedDziTileSource extends OSD.TileSource {

    tilesUrl: string;
    fileFormat: string;
    displayRects?: DziDisplayRect[];
    // Populated by OSD's TileSource constructor from the configure() output —
    // `declare` so no field definition is emitted that would clobber them.
    declare postData?: string;
    declare queryParams: string;
    declare minLevel: number;
    declare maxLevel: number;
    declare ImageArray?: DziImageEntry[];
    declare _tileWidth: number;

    private _levelRects: Record<number, DziDisplayRect[]>;
    private __cached_downloadTileStart?: (context: any) => void;
    private __cached_downloadTileAbort?: (context: any) => void;

    constructor(options: any) {
        super(options);

        this._levelRects = {};
        this.tilesUrl = options.tilesUrl;
        this.fileFormat = options.fileFormat;
        this.displayRects = options.displayRects;

        if (this.displayRects) {
            for (let i = this.displayRects.length - 1; i >= 0; i--) {
                const rect = this.displayRects[i]!;
                for (let level = rect.minLevel; level <= rect.maxLevel; level++) {
                    if (!this._levelRects[level]) {
                        this._levelRects[level] = [];
                    }
                    this._levelRects[level]!.push(rect);
                }
            }
        }

        if (!this.fileFormat) this.fileFormat = ".jpg";
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     */
    supports(data: any, url: string): boolean {
        let ns;
        if (data.ImageArray) {
            ns = data.ImageArray.xmlns;
        } else if (data.documentElement) {
            if ("ImageArray" === data.documentElement.localName || "ImageArray" === data.documentElement.tagName) {
                ns = data.documentElement.namespaceURI;
            }
        }
        ns = ns || "";
        return ns.indexOf('rationai.fi.muni.cz/deepzoom/images') !== -1;
    }

    /**
     * TODO!!!! this is not tileSource but tiledImage!!!
     *    in TiledImage:
     *             options = $TileSource.prototype.configure.apply( _this, [ data, url, postData ]);
     * @param data - the raw configuration
     * @param url - the url the data was retrieved from if any.
     * @param postData - data for the post request or null
     * @return options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure(data: any, url: string, postData: string | null): any {

        const options = OSD.isPlainObject(data) ?
            configureFromObject(this, data) : configureFromXML(this, data);

        //little hack: if we ask for non-pyramidal data (jpg, png), overwrite level, we use post: the query contains link
        const targetUrl = typeof postData === "string" ? postData : url;
        if (targetUrl.endsWith("jpg.dzi") || targetUrl.endsWith("png.dzi") || targetUrl.endsWith("jpeg.dzi")) {
            options.maxLevel = options.minLevel = 0;
        }

        if (postData) {
            options.postData = postData.replace(/([^\/]+?)(\.(dzi|xml|js)?(\?[^\/]*)?)?\/?$/, '$1_files/');
        } else if (url) {
            url = url.replace(
                /([^\/]+?)(\.(dzi|xml|js)?(\?[^\/]*)?)?\/?$/, '$1_files/');
        }

        if (url && !options.tilesUrl) {
            options.tilesUrl = url;
            if (url.search(/\.(dzi|xml|js)\?/) !== -1) {
                options.queryParams = url.match(/\?.*/);
            } else {
                options.queryParams = '';
            }
        }
        return options;
    }

    getTileUrl(level: number, x: number, y: number): string {
        return this.getUrl(level, x, y);
    }

    /**
     * More generic for other approaches
     * @param tiles optionally, provide tiles URL
     */
    getUrl(level: number, x: number, y: number, tiles: string = this.tilesUrl): string {
        return this.postData ? `${tiles}${this.queryParams}`
            : `${tiles}${level}/${x}_${y}.${this.fileFormat}${this.queryParams}`;
    }

    /**
     * Responsible for retrieving the headers which will be attached to the image request for the
     * region specified by the given x, y, and level components.
     * This option is only relevant if {@link OpenSeadragon.Options}.loadTilesWithAjax is set to true.
     * The headers returned here will override headers specified at the Viewer or TiledImage level.
     * Specifying a falsy value for a header will clear its existing value set at the Viewer or
     * TiledImage level (if any).
     */
    getTileAjaxHeaders(level: number, x: number, y: number): Record<string, string> {
        return {'Content-type': 'application/x-www-form-urlencoded'};
    }

    /**
     * Must use AJAX in order to work, i.e. loadTilesWithAjax : true is set.
     * It should return url-encoded string with the following structure:
     *   key=value&key2=value2...
     * or null in case GET is used instead.
     * @return post data to send with tile configuration request
     */
    getTilePostData(level: number, x: number, y: number): string | null {
        return this.getPostData(level, x, y, this.postData);
    }

    /**
     * More general implementation of post data construction
     * @return post data to send with tile configuration request
     */
    getPostData(level: number, x: number, y: number, data?: string): string | null {
        return data ? `${data}${level}/${x}_${y}.${this.fileFormat}` : null;
    }

    /**
     * Retrieve image metadata. The underlying ImageArray is a per-image bag
     * populated by `configureFromObject`; the first entry is the one that drives
     * this tile source.
     */
    getMetadata(): TileSourceMetadata {
        return (this.ImageArray?.[0] as TileSourceMetadata) || {};
    }

    getDisplayMetadata(): TileSourceDisplayMetadata {
        const fields: TileSourceDisplayField[] = [];
        if (this.tilesUrl) fields.push({ label: "Tiles URL", value: String(this.tilesUrl) });
        if (this.fileFormat) fields.push({ label: "Format", value: String(this.fileFormat) });
        const self = this as any;
        if (self.width != null && self.height != null) {
            fields.push({ label: "Dimensions", value: `${self.width} × ${self.height} px` });
        }
        if (Number.isFinite(this.maxLevel)) {
            fields.push({ label: "Pyramid levels", value: this.maxLevel + 1 });
        }
        const meta = this.getMetadata();
        if (meta?.error) return [{ title: "Slide unavailable", description: String(meta.error) }];
        return fields.length ? [{ title: "DZI slide", fields }] : [];
    }

    // todo legacy remove support...
    setFormat(format: string): void {
        this.fileFormat = format;

        let blackImage = (context: any, resolve: (img: HTMLImageElement) => void, reject: (e?: any) => void) => {
            const canvas = document.createElement('canvas');
            canvas.width = context.getTileWidth();
            canvas.height = context.getTileHeight();
            const ctx = canvas.getContext('2d')!;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const img = new Image(canvas.width, canvas.height);
            img.onload = () => {
                //next promise just returns the created object
                blackImage = (_context: any, ready: (i: HTMLImageElement) => void, _: any) => ready(img);
                resolve(img);
            };
            img.onerror = img.onabort = reject;
            img.src = canvas.toDataURL();
        };

        if (format === "zip") {
            this.__cached_downloadTileStart = this.downloadTileStart;
            this.downloadTileStart = function (this: any, context: any) {
                const abort = context.fail.bind(context, "Load aborted.");
                if (!context.loadWithAjax) {
                    abort("DeepZoomExt protocol with ZIP does not support fetching data without ajax!");
                }

                const dataStore = context.userData;
                const _this = this;
                dataStore.request = OSD.makeAjaxRequest({
                    url: context.src,
                    withCredentials: context.ajaxWithCredentials,
                    headers: context.ajaxHeaders,
                    responseType: "arraybuffer",
                    postData: context.postData,
                    success: async function (request: any) {
                        let blb;
                        try {
                            blb = new window.Blob([request.response]);
                        } catch (e: any) {
                            const BlobBuilder = (
                                (window as any).BlobBuilder ||
                                (window as any).WebKitBlobBuilder ||
                                (window as any).MozBlobBuilder ||
                                (window as any).MSBlobBuilder
                            );
                            if (e.name === 'TypeError' && BlobBuilder) {
                                const bb = new BlobBuilder();
                                bb.append(request.response);
                                blb = bb.getBlob();
                            }
                        }
                        // If the blob is empty for some reason consider the image load a failure.
                        if (blb!.size === 0) {
                            return abort("Empty image response.");
                        }

                        const {entries} = await (window as any).unzipit.unzipRaw(blb);
                        Promise.all(
                            Object.entries(entries).map(([_name, entry]: [string, any]) => {
                                return new Promise<HTMLImageElement>((resolve, reject) => {
                                    entry.blob().then((blob: Blob) => {
                                        if (blob.size > 0) {
                                            const img = new Image();
                                            const objUrl = URL.createObjectURL(blob);
                                            img.onload = () => {
                                                resolve(img);
                                                URL.revokeObjectURL(objUrl);
                                            };
                                            img.onerror = img.onabort = reject;
                                            img.src = objUrl;
                                        } else blackImage(_this, resolve, reject);
                                    });
                                });
                            })
                        ).then(result =>
                            //we return array of promise responses - images
                            context.finish(result, dataStore.request, "image")
                        ).catch(
                            abort
                        );
                    },
                    error(request: any) {
                        abort("Image load aborted - XHR error");
                    }
                });
            };
            //no need to provide downloadTileAbort since we keep the meta structure
            this.__cached_downloadTileAbort = this.downloadTileAbort;
            this.downloadTileAbort = OSD.TileSource.prototype.downloadTileAbort;
        } else if (this.__cached_downloadTileStart) {
            this.downloadTileStart = this.__cached_downloadTileStart;
            this.downloadTileAbort = this.__cached_downloadTileAbort!;
        }
    }

    getTileHashKey(level: number, x: number, y: number, url: string,
                   ajaxHeaders: object, postData: string | null): string {
        return `${x}_${y}/${level}/${this.postData}`;
    }

    getTileCacheDataAsContext2D(cacheObject: any): any {
        //hotfix: in case the cacheObject._data object arrives as array, fix it (webgl drawing did not get called)
        //todo will be replaced by the cache overhaul in OpenSeadragon
        if (!cacheObject._renderedContext) {
            if (Array.isArray(cacheObject._data)) {
                cacheObject._data = cacheObject._data[0];
            } else if (Array.isArray(cacheObject.data)) {
                cacheObject.data = cacheObject.data[0];
            }
        }
        return super.getTileCacheDataAsContext2D(cacheObject);
    }

    tileExists(level: number, x: number, y: number): boolean {
        const rects = this._levelRects[level];

        if ((this.minLevel && level < this.minLevel) || (this.maxLevel && level > this.maxLevel)) {
            return false;
        }

        if (!rects || !rects.length) {
            return true;
        }

        for (let i = rects.length - 1; i >= 0; i--) {
            const rect = rects[i]!;

            if (level < rect.minLevel || level > rect.maxLevel) {
                continue;
            }

            const scale = (this as any).getLevelScale(level);
            let xMin = rect.x * scale;
            let yMin = rect.y * scale;
            let xMax = xMin + rect.width * scale;
            let yMax = yMin + rect.height * scale;

            xMin = Math.floor(xMin / this._tileWidth);
            yMin = Math.floor(yMin / this._tileWidth); // DZI tiles are square, so we just use _tileWidth
            xMax = Math.ceil(xMax / this._tileWidth);
            yMax = Math.ceil(yMax / this._tileWidth);

            if (xMin <= x && x < xMax && yMin <= y && y < yMax) {
                return true;
            }
        }

        return false;
    }
};

/**
 * @private
 */
function configureFromXML(tileSource: any, xmlDoc: XMLDocument): any {

    if (!xmlDoc || !xmlDoc.documentElement) {
        throw new Error(OSD.getString("Errors.Xml"));
    }

    const imagesArray = xmlDoc.documentElement,
        rootName = imagesArray.localName || imagesArray.tagName,
        ns = xmlDoc.documentElement.namespaceURI,
        configuration: DziConfiguration = {ImageArray: []},
        displayRects: Array<{ Rect: Record<string, string | number> }> = [];
    let root: any = null,
        dispRectNodes: any,
        dispRectNode: any,
        rectNode: any,
        sizeNode: any,
        i: number;

    if (imagesArray.childNodes.length < 1) throw new Error("No images defined. There are zero images to display.");

    if (rootName === "ImageArray") {

        try {
            const selectedNode = 0;

            for (let child = 0; child < imagesArray.childNodes.length; child++) {
                root = imagesArray.childNodes[child];

                sizeNode = root.getElementsByTagName("Size")[0];
                if (sizeNode === undefined) {
                    sizeNode = root.getElementsByTagNameNS(ns, "Size")[0];
                }

                const width = parseInt(sizeNode.getAttribute("Width"), 10);
                const height = parseInt(sizeNode.getAttribute("Height"), 10);

                if (!OSD.imageFormatSupported(root.getAttribute("Format"))) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error(
                        OSD.getString("Errors.ImageFormat", root.getAttribute("Format").toUpperCase())
                    );
                }

                configuration.ImageArray.push({
                    xmlns:       "http://rationai.fi.muni.cz/deepzoom/images",
                    Url:         root.getAttribute("Url"),
                    Format:      root.getAttribute("Format"),
                    DisplayRect: null,
                    Overlap:     parseInt(root.getAttribute("Overlap"), 10),
                    TileSize:    parseInt(root.getAttribute("TileSize"), 10),
                    Size: {
                        Height: height,
                        Width:  width
                    }
                });
            }

            root = imagesArray.childNodes[selectedNode];

            dispRectNodes = root.getElementsByTagName("DisplayRect");
            if (dispRectNodes === undefined) {
                dispRectNodes = root.getElementsByTagNameNS(ns, "DisplayRect")[0];
            }

            for (i = 0; i < dispRectNodes.length; i++) {
                dispRectNode = dispRectNodes[i];
                rectNode     = dispRectNode.getElementsByTagName("Rect")[0];
                if (rectNode === undefined) {
                    rectNode = dispRectNode.getElementsByTagNameNS(ns, "Rect")[0];
                }

                displayRects.push({
                    Rect: {
                        X: parseInt(rectNode.getAttribute("X"), 10),
                        Y: parseInt(rectNode.getAttribute("Y"), 10),
                        Width: parseInt(rectNode.getAttribute("Width"), 10),
                        Height: parseInt(rectNode.getAttribute("Height"), 10),
                        MinLevel: parseInt(dispRectNode.getAttribute("MinLevel"), 10),
                        MaxLevel: parseInt(dispRectNode.getAttribute("MaxLevel"), 10)
                    }
                });
            }

            if (displayRects.length) {
                configuration.DisplayRect = displayRects;
            }

            return configureFromObject(tileSource, configuration);

        } catch (e) {
            throw (e instanceof Error) ?
                e :
                new Error(OSD.getString("Errors.Dzi"));
        }
    } else if (rootName === "Collection") {
        throw new Error(OSD.getString("Errors.Dzc"));
    } else if (rootName === "Error") {
        root = imagesArray.childNodes[0];
        const messageNode = root.getElementsByTagName("Message")[0];
        const message = messageNode.firstChild.nodeValue;
        throw new Error(message);
    }

    throw new Error(OSD.getString("Errors.Dzi"));
}

/**
 * @private
 */
function configureFromObject(tileSource: any, configuration: DziConfiguration): any {
    const firstImage   = configuration.ImageArray[0]!,
        fileFormat     = firstImage.Format,
        dispRectData   = configuration.DisplayRect || [],
        displayRects: any[] = [];
    let width          = Infinity,
        height         = Infinity,
        tileSize: number | undefined   = undefined,
        tileOverlap: number | undefined = undefined,
        rectData: any,
        i: number;

    for (let j = 0; j < configuration.ImageArray.length; j++) {
        const image = configuration.ImageArray[j]!,
            imageWidth = parseInt(String(image.Size!.Width), 10),
            imageHeight = parseInt(String(image.Size!.Height), 10),
            imageTileSize = parseInt(String(image.TileSize), 10),
            imageTileOverlap = parseInt(String(image.Overlap), 10);

        if (imageWidth < 1 || imageHeight < 1) {
            image.error = "Missing image data.";
            continue;
        }

        if (tileSize === undefined) {
            tileSize = imageTileSize;
        }

        if (tileOverlap === undefined) {
            tileOverlap = imageTileOverlap;
        }

        if (imageTileSize !== tileSize || imageTileOverlap !== tileOverlap) {
            image.error = "Incompatible layer: the rendering might contain artifacts.";
        }

        if (imageWidth < width || imageHeight < height) {
            //possibly experiment with taking maximum
            width = imageWidth;
            height = imageHeight;
        }
    }

    for (i = 0; i < dispRectData.length; i++) {
        rectData = dispRectData[i]!.Rect;

        displayRects.push(new OSD.DisplayRect(
            parseInt(rectData.X, 10),
            parseInt(rectData.Y, 10),
            parseInt(rectData.Width, 10),
            parseInt(rectData.Height, 10),
            parseInt(rectData.MinLevel, 10),
            parseInt(rectData.MaxLevel, 10)
        ));
    }

    return OSD.extend(true, {
        width: width, /* width *required */
        height: height, /* height *required */
        tileSize: tileSize, /* tileSize *required */
        tileOverlap: tileOverlap, /* tileOverlap *required */
        minLevel: null, /* minLevel */
        maxLevel: null, /* maxLevel */
        fileFormat: fileFormat, /* fileFormat */
        displayRects: displayRects /* displayRects */
    }, configuration);
}

export {};
