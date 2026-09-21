/**
 * `OpenSeadragon.PreviewSlideSource` — renders one already-decoded
 * `HTMLImageElement` as a single-tile, single-level "pyramid".
 *
 * Used where a slide preview/thumbnail must be shown as a real world item
 * (e.g. `OpenSeadragon.Tools` slide previews, see `src/classes/osd/tools.ts`).
 * Never auto-detected — `supports()` is hard `false`; construct it explicitly
 * with `{ image }`.
 *
 * Unrelated to `TileSource.prototype.tryInjectPreviewLevel`
 * (`src/classes/preview-level.ts`), which grafts a synthetic coarsest level
 * onto a *real* pyramid.
 */

type PreviewSlideSourceOptions = {
    image: HTMLImageElement;
    [key: string]: unknown;
};

const OSD = window.OpenSeadragon as any;

OSD.PreviewSlideSource = class PreviewSlideSource extends OSD.TileSource {

    // `declare` (never emitted): OSD's TileSource constructor copies every
    // option onto `this`, so a real field declaration would clobber it under
    // define-semantics class fields.
    declare image: HTMLImageElement;
    tilesUrl: string;

    constructor(options: PreviewSlideSourceOptions) {
        console.assert(options.image instanceof HTMLImageElement,
            "PreviewSlideSource requires image within the constructor!");
        const img = options.image;
        options.ready = true;
        options.width = img.naturalWidth || img.width || 256;
        options.height = img.naturalHeight || img.height || 256;
        // Single-tile pyramid
        options.tileWidth = options.width;
        options.tileHeight = options.height;
        options.minLevel = 0;
        options.maxLevel = 0;
        super(options);
        this.tilesUrl = options.image.src;
    }

    supports(data: any, url: string): boolean {
        return false; //we want explicit use
    }

    configure(data: any, url: string, postData: string | null): object {
        return {};
    }

    getTileUrl(level: number, x: number, y: number): string {
        return this.tilesUrl;
    }

    /**
     * Retrieve image metadata for given image index - tilesources can fetch data or data-arrays.
     * @return {TileSourceMetadata}
     */
    getMetadata(): TileSourceMetadata {
        return {};
    }

    tileExists(level: number, x: number, y: number): boolean {
        return level === 0 && x === 0 && y === 0;
    }

    downloadTileStart(context: any): void {
        context.finish(this.image, null, "image");
    }

    downloadTileAbort(context: any): void {
        //pass
    }
};

export {};
