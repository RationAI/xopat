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

self.onmessage = async (e)=> {
    if (!self.mod) return;
    const {type, profile, image, width, height, stride, canvas, bitmap, tileId} = e.data;
    if (type === 'setProfile') {
        const p = self.mod._malloc(profile.byteLength);
        self.mod.HEAPU8.set(new Uint8Array(profile), p);
        self.mod.ccall('set_icc_profile', null, ['number', 'number'], [p, profile.byteLength]);
        self.mod._free(p);
        postMessage({type: 'profileSet'});
    } else if (type === 'process') {
        // process raw RGB buffer
        const ptr = self.mod._malloc(image.byteLength);
        self.mod.HEAPU8.set(new Uint8Array(image), ptr);
        self.mod.ccall('process_image', null, ['number', 'number'], [ptr, image.byteLength / 3]);
        const out = self.mod.HEAPU8.slice(ptr, ptr + image.byteLength);
        self.mod._free(ptr);
        postMessage({type: 'done', image: out.buffer, tileId}, [out.buffer]);
    } else if (type === 'processBitmap' && bitmap) {
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
        postMessage({ type: 'doneBitmap', bitmap: processedBmp, tileId }, [processedBmp]);
    }
};
