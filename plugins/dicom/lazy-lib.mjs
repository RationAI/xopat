/**
 * Load a plugin-local vendored library on first use.
 *
 * The DICOM plugin ships three large vendored files, and `include.json` used to
 * pull all of them into the page at boot — for every session, whether or not a
 * DICOM slide was ever opened:
 *
 *   dcmjs.js                              1.64 MB
 *   cornerstoneWADOImageLoader.bundle.js  1.36 MB
 *   index.worker.bundle.min.worker.js     1.24 MB
 *
 * None of them is needed to open a slide. The worker bundle is fetched by the
 * worker itself from its own URL; cornerstone only decodes what the browser
 * cannot (a baseline-JPEG pyramid never touches it); dcmjs only reads and writes
 * DICOM SR, which happens when annotations are loaded or saved.
 *
 * Same-origin and plugin-relative by construction — the URL is resolved against
 * `import.meta.url`, never taken from configuration or a session — so there is
 * no third-party script surface here and nothing to pin with SRI.
 */

/** globalName -> Promise, so concurrent callers share one load. */
const _loads = new Map();

/**
 * @param {string} globalName the global the script defines, e.g. `"dcmjs"`
 * @param {string} url absolute URL, normally `new URL('./dist/x.js', import.meta.url).href`
 * @returns {Promise<*>} the global, once it exists
 */
export function loadVendorScript(globalName, url) {
    const existing = window[globalName];
    if (existing) return Promise.resolve(existing);

    let promise = _loads.get(globalName);
    if (promise) return promise;

    promise = new Promise((resolve, reject) => {
        // Deliberately NOT `window.attachScript`: its error handler unloads the
        // whole plugin and nulls `window.onerror` globally. A decoder that fails
        // to load should fail the tile that wanted it, not take the viewer's
        // DICOM support down with it.
        const script = document.createElement("script");
        script.async = false;
        script.src = url;
        script.onload = () => {
            const g = window[globalName];
            if (g) resolve(g);
            else reject(new Error(`${url} loaded but did not define ${globalName}`));
        };
        script.onerror = () => reject(new Error(`Failed to load ${url}`));
        document.head.append(script);
    });

    // A failed load must not be remembered, or one flaky fetch disables the
    // codec for the rest of the session.
    promise.catch(() => _loads.delete(globalName));

    _loads.set(globalName, promise);
    return promise;
}
