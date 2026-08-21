/**
 * `OpenSeadragon.EmptyTileSource` — a placeholder source rendered in place of a
 * faulty / missing layer.
 *
 * Never auto-detected (`supports()` is hard `false`); it is constructed
 * explicitly by the open pipeline when a slot must exist in the world but has
 * no image data behind it (see `viewer-open-pipeline.ts` `openPlaceholder` and
 * `viewer-state-binding-controller.ts`).
 *
 * Tiles are synthesized locally as a solid-colour canvas — no network traffic,
 * no cache pressure keyed on a URL (all tiles share the `'empty'` hash key).
 */

type EmptyTileSourceOptions = {
    width?: number;
    height?: number;
    tileSize?: number;
    /** Message surfaced through `getMetadata().error` (marks the slide faulty). */
    error?: string;
    [key: string]: unknown;
};

const OSD = window.OpenSeadragon as any;

OSD.EmptyTileSource = class EmptyTileSource extends OSD.TileSource {

    tilesUrl: string;
    color: string;
    errorMessage: string | null;

    constructor(options: EmptyTileSourceOptions) {
        options.ready = true;
        options.height = options.height || 256;
        options.width = options.width || 256;
        options.tileSize = options.tileSize || 256;
        super(options);
        this.tilesUrl = 'empty';
        this.color = "rgba(0,0,0,0)";
        this.errorMessage = options.error || null;
    }

    supports(data: any, url: string): boolean {
        return false; //we want explicit use
    }

    configure(data: any, url: string, postData: string | null): object {
        return {};
    }

    getTileUrl(level: number, x: number, y: number): string {
        return 'empty';
    }

    /**
     * Retrieve image metadata for given image index - tilesources can fetch data or data-arrays.
     * @return {TileSourceMetadata}
     */
    getMetadata(): TileSourceMetadata {
        return {error: this.errorMessage || 'No data available. The layer is empty.'};
    }

    getDisplayMetadata(): TileSourceDisplayMetadata {
        return [{
            title: "Empty layer",
            description: "This layer is a placeholder. No image data is attached to it."
        }];
    }

    setColor(color: string): void {
        this.color = color;
    }

    getTileHashKey(level: number, x: number, y: number, url: string,
                   ajaxHeaders: object, postData: string | null): string {
        return this.tilesUrl;
    }

    tileExists(level: number, x: number, y: number): boolean {
        return true;
    }

    downloadTileStart(context: any): void {
        const size = context.tile.size || {x: 0, y: 0};
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext('2d')!;
        if (size.x < 1 || size.y < 1) {
            canvas.width = 512;
            canvas.height = 512;
        } else {
            canvas.width = Math.floor(size.x);
            canvas.height = Math.floor(size.y);
        }
        ctx.fillStyle = this.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        context.finish(ctx, null, "context2d");
    }

    downloadTileAbort(context: any): void {
        //pass
    }
};

export {};
