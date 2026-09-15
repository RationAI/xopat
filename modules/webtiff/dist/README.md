# web-tiff — vendored bundle

**Version 0.1.0.**

A TIFF / whole-slide decoder: libtiff compiled to WebAssembly. Decoding and HTTP
range reads both happen in a worker, so a tile costs one `postMessage` hop.

**Copy this whole folder.** Every file resolves relative to `web-tiff.mjs`, so it
works at any depth under a web root — no build step, no package manager, no paths
to rewrite.

Re-vendoring: the same version string is exported as `VERSION` from the bundle, so
a consumer can check at runtime which copy it is actually running rather than
diffing two megabytes of WebAssembly. Bump it whenever this folder changes.

## Use

```js
import { openTiff, enableWebTiff } from "./dist/web-tiff.mjs";

// Directly:
const file = await openTiff(urlOrBlobOrBytes);
const level = file.levels.length - 1;              // ascending; 0 is smallest
const { header, packs } = await file.readTile(level, 0, 0, { output: "rgba8" });
context.putImageData(
  new ImageData(new Uint8ClampedArray(packs[0].data.buffer), header.width, header.height),
  0, 0
);
file.close();

// Or through OpenSeadragon 6+:
const TileSource = enableWebTiff(OpenSeadragon);
viewer.open(new TileSource(urlOrFileOrBytes));
```

## If the files are served from somewhere else

Two overrides, for a CDN, a strict-CSP origin, or a deployment path prefix:

```js
openTiff(url, {
  wasmBaseUrl: new URL("./dist/", import.meta.url),
  workerUrl:   new URL("./dist/decode.worker.mjs", import.meta.url).href,
});
```

Build them from `import.meta.url`, never as a root-absolute `"/..."` string: a
leading slash discards the module directory and resolves against the origin.

## Serving

- **`.wasm` must be served as `application/wasm`.** With
  `X-Content-Type-Options: nosniff` set — as most hosts do — a wrong MIME type
  makes `WebAssembly.instantiateStreaming` reject.
- Workers must be same-origin.

## Threads

`webtiff-mt.*` is only selected by `{ threads: true }` on a **cross-origin
isolated** page (COOP + COEP headers, giving `SharedArrayBuffer`). Without those
headers it cannot load at all, and `webtiff-st.*` is used.

Even where it can load, decoding inside it is still serialized — a libtiff handle
is not thread-safe. Concurrency comes from running several workers, which the
single-threaded build already does. **If your deployment will never be
cross-origin isolated, delete `webtiff-mt.mjs` and `webtiff-mt.wasm`** and save
about 2.1 MB.

## Vendoring into xopat

1. `mkdir -p modules/web-tiff/dist` and copy this folder's contents there.
2. Write `modules/web-tiff/include.json` declaring **one** entry point, e.g.
   `"includes": ["index.mjs"]`, and an `index.mjs` that imports
   `./dist/web-tiff.mjs` and calls `enableWebTiff(OpenSeadragon)`.
3. Add **both** lines to `.gitignore`:
   ```
   !/modules/web-tiff
   !/modules/web-tiff/dist
   ```
   xopat ignores `/modules/*` with an allowlist *and* has a bare `dist` rule, so a
   vendored payload silently fails to commit without both.
4. Add a row to `THIRD_PARTY_LICENSES.md` pointing at `bundled-licenses.txt`.

If xopat's `grunt minify` step tries to follow the worker's `new URL` into its
esbuild graph, declare it unbundled in `include.json`:
`{ "src": "...", "bundle": false }`.

## Licences

MIT, plus the vendored libraries listed in `bundled-licenses.txt` (libtiff,
zlib-ng, libjpeg-turbo, libwebp, zstd) — all MIT-compatible.
