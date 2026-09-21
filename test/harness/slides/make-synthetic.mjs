/**
 * Generates a synthetic DeepZoom slide so browser tests need no external data.
 *
 * ## Why this exists
 *
 * The pre-runner e2e suite could not run on a clean checkout: it needed a live
 * WSI service plus a ~200 MB `CMU-1.tiff` downloaded by hand, and its documented
 * failure mode for a missing slide was a 30-second "waiting for the viewer"
 * timeout. That is the single biggest reason the suite rotted.
 *
 * A DZI pyramid is a directory of PNGs and one XML descriptor — no service, no
 * decoder, no credentials — and OpenSeadragon autodetects it from the URL, so
 * xOpat needs nothing but a `slide_protocols` entry pointing at the static path
 * (see `test/env/synthetic.json`).
 *
 * ## The tile pattern is diagnostic, not decorative
 *
 * Each tile is tinted by `(level, col, row)` and stamped with a coloured corner
 * marker. A slide that renders with tiles transposed, off-by-one, or from the
 * wrong level looks obviously wrong rather than merely different — which is
 * what makes a pixel baseline worth having at all.
 *
 * Output is content-addressed by its parameters and cached, so regenerating is
 * free after the first run. It lands in a gitignored directory.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fromRoot } from "../paths.mjs";
import { encodePng } from "./png.mjs";

export const SLIDES_DIR = fromRoot("test", "fixtures", "slides", "generated");

const DEFAULTS = { name: "synthetic", width: 2048, height: 1536, tileSize: 256, overlap: 0 };

/** DeepZoom level count: enough halvings to reach a single pixel. */
const maxLevelFor = (width, height) => Math.ceil(Math.log2(Math.max(width, height)));

/** Dimensions of a given DZI level. */
function levelSize(width, height, level, maxLevel) {
    const scale = 2 ** (maxLevel - level);
    return { width: Math.ceil(width / scale), height: Math.ceil(height / scale) };
}

/**
 * Deterministic tile content: a tinted checkerboard plus a per-tile corner
 * marker whose hue encodes the level.
 */
function renderTile(pxWidth, pxHeight, { level, col, row, maxLevel }) {
    const rgba = new Uint8Array(pxWidth * pxHeight * 4);
    const levelHue = Math.round((level / maxLevel) * 200) + 30;
    const tint = ((col * 53 + row * 97) % 64) - 32;

    for (let y = 0; y < pxHeight; y++) {
        for (let x = 0; x < pxWidth; x++) {
            const i = (y * pxWidth + x) * 4;
            const checker = ((x >> 5) + (y >> 5)) % 2 === 0;
            const base = checker ? 200 : 120;
            rgba[i] = Math.max(0, Math.min(255, base + tint));
            rgba[i + 1] = Math.max(0, Math.min(255, base - tint));
            rgba[i + 2] = levelHue;
            rgba[i + 3] = 255;

            // Corner marker: 8×8, opaque red. Wrong tile placement shows up as
            // a grid of markers in the wrong spots.
            if (x < 8 && y < 8) {
                rgba[i] = 220; rgba[i + 1] = 30; rgba[i + 2] = 30;
            }
        }
    }
    return rgba;
}

function descriptorXml({ tileSize, overlap, width, height }) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"
       Format="png" Overlap="${overlap}" TileSize="${tileSize}">
  <Size Width="${width}" Height="${height}"/>
</Image>
`;
}

/**
 * Create the slide if it is not already on disk.
 *
 * @param {Partial<typeof DEFAULTS>} [options]
 * @returns {{name: string, descriptor: string, dir: string, width: number, height: number,
 *            tileSize: number, maxLevel: number, dataId: string}}
 */
export function ensureSyntheticSlide(options = {}) {
    const config = { ...DEFAULTS, ...options };
    const { name, width, height, tileSize, overlap } = config;
    const maxLevel = maxLevelFor(width, height);

    const descriptor = path.join(SLIDES_DIR, `${name}.dzi`);
    const tilesDir = path.join(SLIDES_DIR, `${name}_files`);
    const stamp = path.join(SLIDES_DIR, `${name}.stamp.json`);
    const signature = JSON.stringify({ ...config, maxLevel, format: 1 });

    const result = {
        ...config,
        maxLevel,
        descriptor,
        dir: SLIDES_DIR,
        // What a session's `data` entry carries; the `static` protocol in
        // `test/env/synthetic.json` templates it onto the served path.
        dataId: `${name}.dzi`,
    };

    if (existsSync(stamp) && readFileSync(stamp, "utf8") === signature && existsSync(descriptor)) {
        return result;
    }

    mkdirSync(SLIDES_DIR, { recursive: true });
    writeFileSync(descriptor, descriptorXml({ tileSize, overlap, width, height }), "utf8");

    for (let level = 0; level <= maxLevel; level++) {
        const size = levelSize(width, height, level, maxLevel);
        const cols = Math.ceil(size.width / tileSize);
        const rows = Math.ceil(size.height / tileSize);
        const levelDir = path.join(tilesDir, String(level));
        mkdirSync(levelDir, { recursive: true });

        for (let col = 0; col < cols; col++) {
            for (let row = 0; row < rows; row++) {
                const pxWidth = Math.min(tileSize, size.width - col * tileSize);
                const pxHeight = Math.min(tileSize, size.height - row * tileSize);
                if (pxWidth <= 0 || pxHeight <= 0) continue;
                const rgba = renderTile(pxWidth, pxHeight, { level, col, row, maxLevel });
                writeFileSync(path.join(levelDir, `${col}_${row}.png`), encodePng(pxWidth, pxHeight, rgba));
            }
        }
    }

    writeFileSync(stamp, signature, "utf8");
    return result;
}

// Also usable directly: `node test/harness/slides/make-synthetic.mjs`
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const slide = ensureSyntheticSlide();
    console.log(`synthetic slide ready: ${slide.descriptor} (levels 0..${slide.maxLevel})`);
}
