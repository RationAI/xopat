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

// Profile bytes per source identity. The LittleCMS WASM module has a single
// global profile slot — without this cache, two concurrent sources with
// different profiles would clobber each other and tiles from the first
// would silently get the second's correction. We re-arm the WASM slot
// from this cache before each `processBitmap` whose `profileContextId`
// doesn't match the one currently loaded.
const profileCache = new Map(); // profileContextId -> ArrayBuffer
let currentArmedProfile = null;

function armWasmProfile(profileContextId) {
    if (currentArmedProfile === profileContextId) return true;
    const buf = profileCache.get(profileContextId);
    if (!buf) return false;
    const p = self.mod._malloc(buf.byteLength);
    self.mod.HEAPU8.set(new Uint8Array(buf), p);
    self.mod.ccall('set_icc_profile', null, ['number', 'number'], [p, buf.byteLength]);
    self.mod._free(p);
    currentArmedProfile = profileContextId;
    return true;
}

self.onmessage = async (e)=> {
    if (!self.mod) return;
    const {type, profile, image, width, height, stride, canvas, bitmap, contextId, profileContextId} = e.data;
    if (type === 'setProfile') {
        // Cache the bytes for later re-arm and immediately load into WASM so
        // the current `contextId` is "ready" by the time the caller awaits.
        profileCache.set(contextId, profile);
        currentArmedProfile = null; // force re-load (profile may have changed)
        armWasmProfile(contextId);
        postMessage({type: 'profileSet', contextId});
    } else if (type === 'unsetProfile') {
        profileCache.delete(contextId);
        if (currentArmedProfile === contextId) currentArmedProfile = null;
    } else if (type === 'process') {
        // process raw RGB buffer
        const ptr = self.mod._malloc(image.byteLength);
        self.mod.HEAPU8.set(new Uint8Array(image), ptr);
        self.mod.ccall('process_image', null, ['number', 'number'], [ptr, image.byteLength / 3]);
        const out = self.mod.HEAPU8.slice(ptr, ptr + image.byteLength);
        self.mod._free(ptr);
        postMessage({type: 'done', image: out.buffer, contextId}, [out.buffer]);
    } else if (type === 'processBitmap' && bitmap) {
        // Re-arm the WASM profile slot with this source's profile. Without
        // this, the last `setProfile` call wins globally — fine for single
        // viewport, wrong for concurrent multi-source sessions.
        if (profileContextId && !armWasmProfile(profileContextId)) {
            postMessage({
                type: 'error',
                contextId,
                message: `ICC profile "${profileContextId}" not cached in worker`
            });
            return;
        }
        // Draw into an OffscreenCanvas owned by the worker
        const off = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = off.getContext('2d');
        ctx.drawImage(bitmap, 0, 0); // bitmap consumed here

        // Get pixels → RGB → WASM process
        const imgData = ctx.getImageData(0, 0, off.width, off.height);
        const rgba = imgData.data;
        const rgb = new Uint8Array((rgba.length / 4) * 3);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
            rgb[j]   = rgba[i];
            rgb[j+1] = rgba[i+1];
            rgb[j+2] = rgba[i+2];
        }

        const malloc = self.mod._malloc || self.mod.cwrap('malloc', 'number', ['number']);
        const free   = self.mod._free   || self.mod.cwrap('free',   null,     ['number']);

        const ptr = malloc(rgb.byteLength);
        self.mod.HEAPU8.set(rgb, ptr);
        self.mod.ccall('process_image', null, ['number','number'], [ptr, rgb.byteLength / 3]);
        const out = self.mod.HEAPU8.slice(ptr, ptr + rgb.byteLength);
        free(ptr);

        // RGB → RGBA, paint back
        const outRgba = new Uint8ClampedArray((out.length / 3) * 4);
        for (let i = 0, j = 0; i < out.length; i += 3, j += 4) {
            outRgba[j]   = out[i];
            outRgba[j+1] = out[i+1];
            outRgba[j+2] = out[i+2];
            outRgba[j+3] = 255;
        }
        ctx.putImageData(new ImageData(outRgba, off.width, off.height), 0, 0);

        // Return a fresh ImageBitmap (transferable)
        const processedBmp = await off.transferToImageBitmap();
        postMessage({ type: 'doneBitmap', bitmap: processedBmp, contextId }, [processedBmp]);
    }
};
