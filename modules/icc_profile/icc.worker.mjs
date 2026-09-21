// todo test uses:
// Cross-Origin-Opener-Policy: same-origin
// Cross-Origin-Embedder-Policy: require-corp

self.addEventListener('error', (e) => {
    self.postMessage({
        type: 'error',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack
    });
});
self.addEventListener('unhandledrejection', (e) => {
    self.postMessage({ type: 'error', message: String(e.reason), stack: e.reason?.stack });
});

(async () => {
    try {
        const wrapperUrl = new URL('./icc_wasm.mjs', import.meta.url).href;
        const ns = await import(wrapperUrl);

        // Inspect what we actually got
        const candidates = [
            ns.default,
            ns.createModule,
            ns.Module,
            ns.moduleFactory // just in case a custom name was used
        ];
        const factory = candidates.find((x) => typeof x === 'function');

        if (!factory) {
            const keys = Object.keys(ns);
            throw new Error(
                "icc_wasm.mjs doesn't export a factory function. Exports: " + (keys.length ? keys.join(', ') : '(none)')
            );
        }

        const supportsThreads = self.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
        const ModuleOpts = {
            pthreadPoolSize: supportsThreads ? Math.min(self.navigator?.hardwareConcurrency ?? 4, 8) : 0,
            locateFile: (p) => new URL(p, import.meta.url).toString(),
        };

        const mod = await factory(ModuleOpts);
        self.mod = mod;
        postMessage({ type: 'ready', threads: supportsThreads });
    } catch (err) {
        postMessage({ type: 'error', message: String(err), stack: err?.stack });
    }
})();

/*
 * The heap views must be re-read before every use and never cached across a
 * call: the module is built with `ALLOW_MEMORY_GROWTH`, so the moment lcms grows
 * the linear memory every previously obtained view is detached and writing
 * through it silently goes nowhere. `updateMemoryViews()` in the Emscripten
 * wrapper reassigns `Module.HEAPU8`/`HEAPU16`, which is why they are exported by
 * name in the build recipe (see build/icc/README.md).
 */
const heapU8 = () => self.mod.HEAPU8;
const heapU16 = () => self.mod.HEAPU16;

/**
 * Profile handles per source identity. Each handle owns its own pair of lcms
 * transforms, so several slides can be open at once — the previous single-slot
 * design had to tear the transform down and rebuild it whenever tiles from two
 * sources interleaved, which is most of the time in a grid layout.
 */
const handles = new Map(); // profileContextId -> int handle

function loadProfile(profileContextId, profileBytes) {
    releaseProfile(profileContextId);

    const bytes = new Uint8Array(profileBytes);
    const ptr = self.mod._malloc(bytes.byteLength);
    heapU8().set(bytes, ptr);
    const handle = self.mod.ccall('set_icc_profile', 'number', ['number', 'number'], [ptr, bytes.byteLength]);
    self.mod._free(ptr);

    if (handle >= 1) {
        handles.set(profileContextId, handle);
        return true;
    }
    return false;
}

function releaseProfile(profileContextId) {
    const handle = handles.get(profileContextId);
    if (handle === undefined) return;
    self.mod.ccall('release_icc_profile', null, ['number'], [handle]);
    handles.delete(profileContextId);
}

/**
 * Correct an interleaved RGBA buffer in place, in the wasm heap.
 * @param {Uint8Array|Uint16Array} view samples, 4 per pixel
 * @param {number} handle profile handle
 * @returns {Uint8Array|Uint16Array} a fresh view over the corrected samples
 */
function correctRgba(view, handle) {
    const bytes = view.byteLength;
    const ptr = self.mod._malloc(bytes);
    const is16 = view.BYTES_PER_ELEMENT === 2;
    const pixels = view.length / 4;

    if (is16) {
        heapU16().set(view, ptr >> 1);
        self.mod.ccall('process_rgba16', null, ['number', 'number', 'number'], [handle, ptr, pixels]);
    } else {
        heapU8().set(view, ptr);
        self.mod.ccall('process_rgba8', null, ['number', 'number', 'number'], [handle, ptr, pixels]);
    }

    // `slice` (not `subarray`) — the result must outlive the free below, and must
    // not be a view into a heap that the next call may detach.
    const out = is16
        ? heapU16().slice(ptr >> 1, (ptr >> 1) + view.length)
        : heapU8().slice(ptr, ptr + view.length);
    self.mod._free(ptr);
    return out;
}

function resolveHandle(profileContextId, contextId) {
    const handle = handles.get(profileContextId);
    if (handle === undefined) {
        postMessage({
            type: 'error',
            contextId,
            message: `ICC profile "${profileContextId}" not loaded in worker`
        });
        return null;
    }
    return handle;
}

/** Whether the platform can hand us pixels without going through a canvas. */
const canDecodeDirectly = typeof ImageDecoder !== 'undefined';

/**
 * Decode a compressed image blob straight to interleaved RGBA.
 *
 * `ImageDecoder` skips the canvas entirely: no `drawImage`, no `getImageData`,
 * no readback. The canvas fallback exists for browsers without WebCodecs and is
 * the path this used to take unconditionally — it measured ~17× the cost of the
 * colour transform it was feeding.
 */
async function decodeToRgba(blob) {
    if (canDecodeDirectly) {
        const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
        try {
            const { image } = await decoder.decode();
            try {
                const width = image.displayWidth;
                const height = image.displayHeight;
                const data = new Uint8Array(image.allocationSize({ format: 'RGBA' }));
                await image.copyTo(data, { format: 'RGBA' });
                return { data, width, height };
            } finally {
                image.close();
            }
        } finally {
            decoder.close?.();
        }
    }
    return bitmapToRgba(await createImageBitmap(blob));
}

/** Pixels out of an ImageBitmap. Consumes the bitmap. */
function bitmapToRgba(bitmap) {
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const imgData = ctx.getImageData(0, 0, off.width, off.height);
    return { data: imgData.data, width: off.width, height: off.height };
}

self.onmessage = async (e) => {
    if (!self.mod) return;
    const { type, profile, buffer, format, bitmap, blob, contextId, profileContextId } = e.data;

    if (type === 'setProfile') {
        const ok = loadProfile(contextId, profile);
        postMessage({ type: 'profileSet', contextId, ok });
        return;
    }

    if (type === 'unsetProfile') {
        releaseProfile(contextId);
        return;
    }

    // Raw sample buffers — how every non-raster tile type is corrected. The
    // caller owns the layout; we only need to know the sample width.
    if (type === 'processPixels' && buffer) {
        const handle = resolveHandle(profileContextId, contextId);
        if (handle === null) return;

        const view = format === 'rgba16' ? new Uint16Array(buffer) : new Uint8Array(buffer);
        const out = correctRgba(view, handle);
        postMessage({ type: 'donePixels', buffer: out.buffer, format, contextId }, [out.buffer]);
        return;
    }

    // A compressed raster tile, corrected without ever touching a canvas when
    // the platform can decode it for us.
    if (type === 'processBlob' && blob) {
        const handle = resolveHandle(profileContextId, contextId);
        if (handle === null) return;
        try {
            const { data, width, height } = await decodeToRgba(blob);
            const out = correctRgba(data, handle);
            const processedBmp = await createImageBitmap(
                new ImageData(new Uint8ClampedArray(out.buffer), width, height));
            postMessage({ type: 'doneBitmap', bitmap: processedBmp, contextId }, [processedBmp]);
        } catch (err) {
            postMessage({ type: 'error', contextId, message: String(err?.message ?? err) });
        }
        return;
    }

    if (type === 'processBitmap' && bitmap) {
        const handle = resolveHandle(profileContextId, contextId);
        if (handle === null) return;

        const { data, width, height } = bitmapToRgba(bitmap);
        // The RGBA buffer goes to lcms as-is. The transform is TYPE_RGBA_8 with
        // cmsFLAGS_COPY_ALPHA, so alpha is carried through untouched and no
        // RGBA<->RGB repacking is needed on either side.
        const out = correctRgba(data, handle);
        // `createImageBitmap` takes an ImageData directly — going back through
        // `putImageData` + `transferToImageBitmap` would be two more full-frame
        // passes for nothing.
        const processedBmp = await createImageBitmap(
            new ImageData(new Uint8ClampedArray(out.buffer), width, height));
        postMessage({ type: 'doneBitmap', bitmap: processedBmp, contextId }, [processedBmp]);
    }
};
