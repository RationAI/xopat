/**
 * TIFF support: decoder wiring, slide protocol, and shader auto-config.
 *
 * The decoder itself is the vendored `geotiff-tilesource` bundle, which
 * normalizes every channel to `[0,1]` and declares its encoding
 * (`getTiffDescriptor()`). Because of that, the ordinary renderer shaders are
 * already correct on TIFF data and this module ships none of its own. What is
 * left here:
 *
 *  - install the tile source, pointing it at `HttpClient` for range requests;
 *  - register a `tiff` slide protocol so a `.tif`/`.tiff` background opens
 *    without a deployment writing its own protocol entry;
 *  - pick the built-in shader that fits the slide's channel layout, since the
 *    implicit `identity` layer only works for four-channel sources.
 *
 * Deployment knobs live in `include.json` (merged with `ENV.modules.geotiff`) and
 * are read through `moduleMeta` — deployment-trusted config, never session data.
 */

import { enableGeoTIFFTileSource } from "./dist/geotiff-tilesource.lite.mjs";
import { describeTileSource, descriptorsDiffer } from "./tiff-metadata.mjs";
import { buildAutoShaders, shadersAreAutoOwned, stripAutoDerived } from "./auto-config.mjs";
import { measureChannelRanges } from "./tiff-statistics.mjs";

const MODULE_ID = "geotiff";
const meta = (key, fallback) => {
    const value = window.moduleMeta?.(MODULE_ID, key);
    return value === undefined ? fallback : value;
};

// The bundle's own default is root-absolute (`new URL("/assets/tiff.worker-*.js",
// import.meta.url)`), which resolves against the origin and ignores the module
// directory — under xOpat that points at a path no server serves. Resolve it
// relative to this module instead. Still pinned to a build hash, so it has to be
// updated on every decoder bump; the symptom of getting it wrong is a worker that
// never answers, which stalls every tile without an error anywhere.
const DEFAULT_WORKER_URL = new URL("./dist/assets/tiff.worker.js", import.meta.url).href;
const workerUrl = meta("workerUrl", DEFAULT_WORKER_URL);

/**
 * Diagnostics, on under `debugMode`.
 *
 * A TIFF has a long way to travel — decode, converter graph, drawer upload — and
 * every link fails quietly: an unregistered converter edge, a tile finished as a
 * type nothing can route, a rejected worker request. The visible symptom of any
 * of them is the same blank viewport, so the trail is worth keeping rather than
 * re-deriving each time.
 */
const debugEnabled = () => !!window.APPLICATION_CONTEXT?.getOption?.("debugMode");
const debug = (...args) => { if (debugEnabled()) console.info("[geotiff]", ...args); };

debug("installing decoder; converter present:", !!OpenSeadragon.converter, "| worker:", workerUrl);

// A worker that never answers stalls every tile with no error, so verify the
// asset is really there and really JavaScript — a dev server answering unknown
// paths with index.html would otherwise hand the worker HTML and hang silently.
// Same-origin static asset: plain fetch is correct here, as for locales/.d.ts.
if (debugEnabled()) {
    // Decode should happen off the main thread: geotiff.js runs its own decoder
    // pool, and the packer runs in the RawTiff worker. If the main thread is
    // blocked instead, per-tile latency is CPU contention, not decode cost —
    // and everything else in the app suffers with it.
    try {
        let longTasks = 0;
        let longTaskMs = 0;
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTasks++;
                longTaskMs += entry.duration;
            }
            if (longTasks % 10 === 0) {
                debug(`main thread blocked: ${longTasks} long tasks, ${longTaskMs.toFixed(0)}ms total`);
            }
        }).observe({ type: "longtask", buffered: true });
    } catch (e) {
        debug("longtask observer unavailable:", e?.message || e);
    }

    // Both pools, so a decode running on the main thread is visible as such.
    setTimeout(() => {
        const decodePool = OpenSeadragon.GeoTIFFTileSource?.sharedPool;
        debug("decoder pool size:", decodePool?.size,
            "| workers:", decodePool?.workers?.length ?? "not created",
            "| packer pool:", !!OpenSeadragon.RawTiffPlugin?.getWorkerPool?.());
    }, 3000);

    fetch(workerUrl, { method: "GET" }).then(response => {
        const type = response.headers.get("content-type") || "";
        if (!response.ok || !/javascript|ecmascript/i.test(type)) {
            console.warn(`[geotiff] decoder worker at ${workerUrl} responded ${response.status} ` +
                `as '${type}' — tiles will decode but never finish.`);
        } else {
            debug("worker asset ok:", response.status, type);
        }
    }).catch(e => console.warn("[geotiff] decoder worker unreachable:", workerUrl, e?.message || e));
}

/**
 * Per-tile decode latency and HTTP traffic, aggregated. Reported as running
 * summaries rather than per-event lines — a pyramid is hundreds of tiles, and
 * the question is always "which of the two is the cost", not what one tile did.
 */
const stats = { tiles: 0, decodeMs: 0, maxMs: 0, requests: 0, bytes: 0 };
const reportStats = () => debug(`decoded ${stats.tiles} tiles`,
    `| avg ${(stats.decodeMs / Math.max(1, stats.tiles)).toFixed(1)}ms`,
    `| max ${stats.maxMs.toFixed(1)}ms`,
    `| ${stats.requests} range requests`,
    `(${(stats.requests / Math.max(1, stats.tiles)).toFixed(1)} per tile,`,
    `${(stats.bytes / 1048576).toFixed(1)} MB)`);

const logTileLatency = (_label, ms) => {
    stats.tiles++;
    stats.decodeMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    if (stats.tiles % 25 === 0) reportStats();
};

const baseAdapter = window.HttpClient?.createAdapter?.();
const httpAdapter = baseAdapter && debugEnabled() ? {
    fetch: (url, init) => {
        stats.requests++;
        return baseAdapter.fetch(url, init).then(response => {
            const length = Number(response.headers?.get?.("content-length"));
            if (Number.isFinite(length)) stats.bytes += length;
            return response;
        });
    }
} : baseAdapter;

enableGeoTIFFTileSource(OpenSeadragon, {
    ...(workerUrl ? { workerUrl } : {}),
    httpAdapter,
});

if (debugEnabled()) {
    // The decoder registers its converter edges only if `OpenSeadragon.converter`
    // existed at install time, and stays silent otherwise. Without an edge from
    // `tiffRaster` to a format the drawer accepts, tiles decode, land in the
    // cache, and are never handed over — with nothing logged anywhere.
    try {
        const converter = OpenSeadragon.converter;
        const describePath = (from, to) => {
            try {
                const path = converter?.getConversionPath?.(from, to);
                return path ? `${path.length} step(s)` : "NONE";
            } catch (e) {
                return `error: ${e?.message || e}`;
            }
        };
        debug("conversion paths —",
            "tiffRaster→gpuTextureSet:", describePath("tiffRaster", "gpuTextureSet"),
            "| tiffRaster→context2d:", describePath("tiffRaster", "context2d"),
            "| rawTiff→gpuTextureSet:", describePath("rawTiff", "gpuTextureSet"));
    } catch (e) {
        console.warn("[geotiff] conversion-path probe failed:", e);
    }

    // Which conversions OSD actually performs on a decoded tile. A tile that is
    // never converted is never handed to the drawer, and OpenSeadragon marks it
    // ready either way — so silence here is itself the answer.
    try {
        const converter = OpenSeadragon.converter;
        const originalConvert = converter?.convert?.bind(converter);
        if (originalConvert) {
            let remaining = 4;
            converter.convert = (tile, data, from, ...to) => {
                const trace = remaining > 0 && (from === "tiffRaster" || from === "rawTiff");
                if (trace) {
                    remaining--;
                    debug("converting", from, "→", to.join("|"));
                }
                const result = originalConvert(tile, data, from, ...to);
                if (trace && result && typeof result.then === "function") {
                    result.then(
                        out => debug("converted", from, "→", typeof out?.getType === "function"
                            ? out.getType() : out?.constructor?.name),
                        err => console.warn("[geotiff] conversion failed:", from, err?.message || err)
                    );
                }
                return result;
            };
        }
    } catch (e) {
        console.warn("[geotiff] converter probe failed:", e);
    }

    // What the source actually hands OSD. It re-checks `converter` per tile, so
    // this can differ from what the install-time line reported.
    try {
        const proto = OpenSeadragon.GeoTIFFTileSource?.prototype;
        const originalDownload = proto?.downloadTileStart;
        if (originalDownload) {
            let remaining = 2;
            proto.downloadTileStart = function (context) {
                if (remaining > 0) {
                    remaining--;
                    const finish = context.finish?.bind(context);
                    const fail = context.fail?.bind(context);
                    if (finish) {
                        context.finish = (data, request, type) => {
                            const tile = context.tile;
                            debug("tile finished as", type,
                                "| ctor:", data?.constructor?.name,
                                "| converter present:", !!OpenSeadragon.converter);
                            const result = finish(data, request, type);
                            // Whether OSD actually completes the tile after the
                            // source hands it over: a tile that never becomes
                            // `loaded` is never converted, never uploaded, and
                            // never drawn — silently.
                            setTimeout(() => {
                                const cache = tile?.getCache?.(tile?.cacheKey);
                                debug("tile after finish:", `${tile?.level}/${tile?.x}_${tile?.y}`,
                                    "| loaded:", tile?.loaded,
                                    "| loading:", tile?.loading,
                                    "| cacheKey:", tile?.cacheKey,
                                    "| cache type:", cache?.type,
                                    "| caches:", Object.keys(tile?._caches || {}).length);
                            }, 250);
                            return result;
                        };
                    }
                    if (fail) {
                        context.fail = (message, request) => {
                            console.warn("[geotiff] tile failed:", message);
                            return fail(message, request);
                        };
                    }
                }
                return originalDownload.call(this, context);
            };
        }
    } catch (e) {
        console.warn("[geotiff] tile-download probe failed:", e);
    }
}

/**
 * Log the first tiles a viewer's drawer is asked to prepare. Silence here, while
 * tiles are downloading, means the converter never produced a format the drawer
 * accepts — the failure mode that otherwise leaves no trace at all.
 * @param {object} drawer the viewer's drawer
 */
function traceDrawerUploads(drawer) {
    if (!drawer || drawer.__geotiffTraced || typeof drawer.internalCacheCreate !== "function") return;
    drawer.__geotiffTraced = true;
    debug("tracing drawer uploads for", drawer.getType?.());

    const original = drawer.internalCacheCreate.bind(drawer);
    let remaining = 2;
    drawer.internalCacheCreate = (cache, tile) => {
        if (remaining > 0) {
            remaining--;
            debug("drawer preparing tile", `${tile?.level}/${tile?.x}_${tile?.y}`, "as", cache?.type);
        }
        return original(cache, tile);
    };
}

if (debugEnabled() && window.VIEWER_MANAGER) {
    // A first-time viewer does not exist yet at `before-open`, so attach on both
    // hooks — `traceDrawerUploads` is idempotent per drawer.
    VIEWER_MANAGER.addHandler("before-open", (e) => traceDrawerUploads(e?.viewer?.drawer));
    VIEWER_MANAGER.broadcastHandler("open", (e) => {
        const viewer = e?.eventSource;
        traceDrawerUploads(viewer?.drawer);
        debug("open: drawer", viewer?.drawer?.getType?.(), "| traced:", !!viewer?.drawer?.__geotiffTraced,
            openStartedAt ? `| pipeline ${(performance.now() - openStartedAt).toFixed(0)}ms` : "");

        // Time from `open` to the first prepared tile — the drawer raises no
        // event this module can hook for "drawn", so measure the upload instead.
        const openedAt = performance.now();
        let firstUpload = true;
        const drawer = viewer?.drawer;
        if (drawer && !drawer.__geotiffTimed && typeof drawer.internalCacheCreate === "function") {
            drawer.__geotiffTimed = true;
            const prepare = drawer.internalCacheCreate.bind(drawer);
            drawer.internalCacheCreate = (cache, tile) => {
                if (firstUpload) {
                    firstUpload = false;
                    debug(`first tile uploaded ${(performance.now() - openedAt).toFixed(0)}ms after open`);
                }
                return prepare(cache, tile);
            };
        }

        // A tile that fails after handover is reported here and nowhere else.
        viewer.addHandler("tile-load-failed", (fe) => console.warn("[geotiff] tile-load-failed:",
            `${fe?.tile?.level}/${fe?.tile?.x}_${fe?.tile?.y}`, fe?.message, fe?.tiledImage?.source?.constructor?.name));

        // The interesting moment is a loaded tile, not the open itself: at `open`
        // no tile exists yet and rendering is still suspended by the pipeline's
        // render transaction, so both readings would be meaningless.
        let remaining = 2;
        viewer.addHandler("tile-loaded", (te) => {
            if (remaining <= 0) return;
            remaining--;
            const tile = te?.tile;
            const cache = tile?.getCache?.(tile?.cacheKey);
            const item = te?.tiledImage;
            debug("tile-loaded", `${tile?.level}/${tile?.x}_${tile?.y}`,
                "| cache type:", cache?.type,
                "| usable for drawer:", cache?.isUsableForDrawer?.(viewer.drawer),
                "| packs:", item?.__flexPackCount,
                "| channels:", item?.__flexChannelCount);
        });
    });
}

// Without a worker pool the decoder falls back to a main-thread packer that does
// not behave identically (alpha padding, channel selection, pack count), so a
// missing worker is a correctness problem, not just a performance one. It must
// not pass unnoticed.
try {
    if (!OpenSeadragon.RawTiffPlugin?.getWorkerPool?.()) {
        console.warn(
            "[geotiff] no decoder worker pool — tiles decode on the main thread, " +
            "whose packing differs from the worker's. Check that the worker asset " +
            `named by the bundle exists${workerUrl ? ` (configured: ${workerUrl})` : ""}.`
        );
    }
} catch (e) {
    console.warn("[geotiff] could not probe the decoder worker pool:", e?.message || e);
}

window.loadElementLocale?.("modules", MODULE_ID);

/**
 * Channel layouts already learned, keyed by data id. A TIFF only reveals its
 * layout once its header (or the server's slide info) has been read, which
 * happens during the open — too late for the shader decision of that same open.
 * Caching means every subsequent open of the same slide is decided up front.
 */
const descriptors = new Map();

/**
 * Measured channel ranges, keyed by data id — the second half of the layout
 * question. The header says what the file *declares*; this says what it actually
 * contains, which is the only thing that can tell a 12-bit-in-16 slide from a
 * genuinely dim one. Costs one overview read per slide, so it is cached exactly
 * like the descriptor.
 */
const statistics = new Map();

/** How aggressively a measured range may seed the shader's window. */
const autoWindow = meta("autoWindow", "rescue");

/** Backgrounds already corrected once, so a mismatch cannot ping-pong. */
const corrected = new WeakSet();

/** Wall clock of the last `before-open`, to time the open pipeline itself. */
let openStartedAt = 0;

function reportPlan(dataId, reason) {
    console.debug(`[geotiff] shader plan for ${dataId}: ${reason}`);
}

const specOf = (background) => (background?.dataReference !== undefined
    ? APPLICATION_CONTEXT?.config?.data?.[background.dataReference]
    : undefined);

const dataIdOf = (background) => {
    const spec = specOf(background);
    if (typeof spec === "string") return spec;
    if (spec && typeof spec === "object" && typeof spec.dataID === "string") return spec.dataID;
    return undefined;
};

/**
 * The protocol whose slides this module owns.
 *
 * Normally the one registered below. A deployment that declares its own
 * GeoTIFF-backed protocol turns `registerSlideProtocol` off and names it here;
 * without that it would own nothing up front and every slide would have to be
 * opened twice before rendering correctly.
 */
const PROTOCOL_ID = meta("protocolId", "tiff");

/**
 * Whether this module may configure a background — *before* any source exists.
 *
 * Ownership is the protocol that will serve the slide, never what its data id
 * looks like. A `.tif` served over DICOM, WSI-Service or any other protocol
 * belongs to that protocol: its module knows things about the slide this one
 * does not, and silently rewriting its shaders is a bug even when the file
 * really is a TIFF.
 *
 * `protocolIdFor` is the non-constructing half of `resolve` — asking with
 * `resolve` would build the foreign source (and issue its requests) just to
 * answer the question.
 *
 * @param {object} background background config entry
 * @return {boolean}
 */
const ownsBackground = (background) => {
    if (!background || Array.isArray(background)) return false;
    try {
        return window.SLIDE_PROTOCOLS?.protocolIdFor({
            spec: specOf(background),
            bgEntry: background,
            role: "background",
        }) === PROTOCOL_ID;
    } catch (e) {
        // A spec nothing can resolve is not ours either.
        return false;
    }
};

/**
 * Whether an opened world item is one of ours — the same question as
 * {@link ownsBackground}, asked once the source exists and can answer for
 * itself. A source that merely *describes* tiff-encoded samples (WSI-Service
 * `/info`) is not ours; only one this decoder built is.
 *
 * @param {object} source an OpenSeadragon TileSource
 * @return {boolean}
 */
const ownsSource = (source) => !!source
    && typeof OpenSeadragon.GeoTIFFTileSource === "function"
    && source instanceof OpenSeadragon.GeoTIFFTileSource;

// Data ids may be bare file names when the deployment says where they live.
const baseUrl = meta("protocolBaseUrl", "");
const resolveUrl = (dataID) => {
    const id = String(dataID);
    if (!baseUrl || /^(https?:)?\/\//i.test(id)) return id;
    return baseUrl.replace(/\/+$/, "") + "/" + id.replace(/^\/+/, "");
};

/**
 * Sources already built, keyed by resolved URL.
 *
 * A source owns the parsed header, the level pyramid and geotiff's 64 KB block
 * cache. Rebuilding one per open means re-reading the header and re-fetching
 * every block, which is what makes returning to a slide as slow as opening it
 * the first time. Reuse is safe: `TiledImage.destroy()` calls `source.destroy()`,
 * and both the base implementation (`openseadragon.js:14744`) and this decoder
 * leave it a no-op — the teardown belongs to the tiled image, not to the source.
 */
const sources = new Map();

/**
 * Build (or reuse) the source for a data id and wait for its header.
 *
 * Reached through {@link ensureSlideLayout}, from an awaited `before-open` or from
 * the preview hook, so the channel layout is known *before* the shader
 * configuration is assembled. The alternative — correcting after the open — can
 * only change a layer's type, not its params, which is why a first open used to
 * render with the wrong colour and a second one correctly.
 *
 * @param {string} dataId
 * @return {Promise<object|undefined>} the ready source, or undefined on failure
 */
async function readySourceFor(dataId) {
    const url = resolveUrl(dataId);
    let source = sources.get(url);
    if (source?._ready) return source;

    if (!source) {
        source = new OpenSeadragon.GeoTIFFTileSource(url, {
            logLatency: debugEnabled() ? logTileLatency : false,
        });
        sources.set(url, source);
    }

    try {
        // `promises.ready` is a *deferred* (`{promise, resolve, reject}`), not a
        // promise. Awaiting the deferred itself is a no-op — it has no `then`, so
        // it resolves on the next microtask with the header still unread, the
        // descriptor still unknown, and the background left on the implicit
        // `identity`. That is what rendered a grayscale TIFF red and a
        // six-channel one as raw noise on its *first* open, then correctly on
        // every later one (the `open` handler had cached the layout by then).
        await (source.promises?.ready?.promise ?? source.promises?.ready);
        return source._ready ? source : undefined;
    } catch (e) {
        // Leave the entry in place: `createTileSource` checks `_ready` and will
        // rebuild, and the open pipeline reports the failure properly.
        debug("header read failed for", url, e?.message || e);
        return undefined;
    }
}

/**
 * Layout resolutions in flight, keyed by data id. A slide list asks about the
 * same slide from several cards at once; without this each ask would re-read the
 * header.
 */
const layoutInFlight = new Map();

/**
 * The descriptor *and* the measured ranges for a slide, resolved once and cached
 * together.
 *
 * Both consumers — the open pipeline and the preview hook — go through here, and
 * that is the point. Resolving them separately lets a slide end up with a cached
 * descriptor but unmeasured statistics: whichever consumer ran second would find
 * the descriptor already known, skip the measurement, and silently drop the input
 * window — so the same slide would render windowed in one place and black in the
 * other, which is the exact defect this module exists to avoid.
 *
 * @param {string} dataId
 * @param {object} [knownSource] a source the caller already resolved and awaited
 * @return {Promise<object|undefined>} the descriptor, or undefined when unknown
 */
function ensureSlideLayout(dataId, knownSource) {
    if (!dataId) return Promise.resolve(undefined);
    if (descriptors.has(dataId) && (autoWindow === "off" || statistics.has(dataId))) {
        return Promise.resolve(descriptors.get(dataId));
    }

    let pending = layoutInFlight.get(dataId);
    if (!pending) {
        pending = (async () => {
            const source = (knownSource && typeof knownSource.getTiffDescriptor === "function")
                ? knownSource
                : await readySourceFor(dataId);
            const descriptor = descriptors.get(dataId)
                || (source ? describeTileSource(source) : undefined);
            if (!descriptor) return undefined;
            descriptors.set(dataId, descriptor);

            if (autoWindow !== "off" && !statistics.has(dataId) && source) {
                // An `undefined` result is stored deliberately: a slide that cannot
                // be measured must not be re-measured on every thumbnail repaint.
                statistics.set(dataId, await measureChannelRanges(source, descriptor));
            }
            return descriptor;
        })().finally(() => layoutInFlight.delete(dataId));
        layoutInFlight.set(dataId, pending);
    }
    return pending;
}

if (meta("registerSlideProtocol", true) && window.SLIDE_PROTOCOLS) {
    try {
        window.SLIDE_PROTOCOLS.register({
            // Same id the ownership test compares against, so the two cannot drift.
            id: PROTOCOL_ID,
            label: "TIFF / GeoTIFF",
            // The tile source reads the file itself (range requests through the
            // adapter installed above), so the data id resolves to the file URL.
            createTileSource: (ctx) => {
                const url = resolveUrl(ctx.dataID);
                const cached = sources.get(url);
                // Only reuse a source that actually parsed: one that failed would
                // otherwise pin its failure for the rest of the session.
                if (cached && cached._ready) {
                    debug("reusing tile source for", url);
                    return cached;
                }

                const source = new OpenSeadragon.GeoTIFFTileSource(url, {
                    // The decoder reports per-tile decode time through this hook;
                    // aggregate it instead of printing one line per tile.
                    logLatency: debugEnabled() ? logTileLatency : false,
                });
                sources.set(url, source);
                return source;
            },
        });
    } catch (e) {
        // A deployment that already declares its own `tiff` protocol wins.
        console.warn("[geotiff] slide protocol not registered:", e?.message || e);
    }
}

if (meta("autoConfigure", true) && window.VIEWER_MANAGER) {
    // Auto-derived shader configurations are a runtime decision, not state worth
    // persisting: they describe the file's channel layout, which the next open
    // re-derives anyway. Drop them on load.
    VIEWER_MANAGER.addHandler("before-app-init", (e) => {
        const reset = stripAutoDerived(e?.background);
        if (reset) console.debug(`[geotiff] re-deriving shaders for ${reset} background(s)`);
    });

    // Decide before the open pipeline clones the background's shader list.
    VIEWER_MANAGER.addHandler("before-open", async (e) => {
        // How long the open pipeline itself takes, before any tile is involved.
        openStartedAt = performance.now();
        const background = e?.background;
        // Two independent gates: `ownsBackground` keeps this module off foreign
        // *data*, `shadersAreAutoOwned` keeps it off foreign *configuration*.
        if (!ownsBackground(background) || !shadersAreAutoOwned(background)) return;

        const dataId = dataIdOf(background);

        // This handler is awaited and the source is memoized, so reading the header
        // now costs one read that would have happened moments later anyway — and it
        // buys the layout *before* the shader list is assembled.
        const descriptor = await ensureSlideLayout(dataId);
        if (!descriptor) return;   // unknown layout: leave the implicit identity

        const { shaders, reason } = buildAutoShaders(descriptor, {
            statistics: statistics.get(dataId),
            autoWindow,
        });
        reportPlan(dataId, reason);
        if (shaders) background.shaders = shaders;
        else delete background.shaders;
    });

    // A slide-list thumbnail is rendered for a slide that is open in no viewer, so
    // nothing knows its shader configuration and the preview falls back to the
    // implicit `identity` — the same wrong picture the viewport showed before this
    // module ran. Answer with the layout that would be applied on open, so the card
    // and the viewport agree. Configs only: a preview must not write session state.
    VIEWER_MANAGER.addHandler("get-preview-shader", async (e) => {
        if (e.shaders) return;              // someone with a better claim answered
        if (e.usesPreviewImage) return;     // rendered source is a flat RGB image

        const background = e.background;
        // Same two gates as `before-open`: foreign data, foreign configuration.
        if (!ownsBackground(background) || !shadersAreAutoOwned(background)) return;

        const dataId = e.dataId || dataIdOf(background);
        // The preview already resolved and awaited the source, so in the common case
        // this costs no I/O at all — and whatever it does read warms the later open.
        const descriptor = await ensureSlideLayout(dataId, e.source);
        if (!descriptor) return;

        const { shaders, reason } = buildAutoShaders(descriptor, {
            statistics: statistics.get(dataId),
            autoWindow,
        });
        if (!shaders) return;               // implicit identity is the right answer
        reportPlan(dataId, `preview:${reason}`);
        e.shaders = shaders;
    });

    // Learn the real layout once the source is open, and correct this viewer if
    // the slide turned out to be something else than the plan assumed.
    VIEWER_MANAGER.broadcastHandler("open", (e) => {
        const viewer = e?.eventSource;
        const world = viewer?.world;
        if (!world) return;

        for (let i = 0; i < world.getItemCount(); i++) {
            const item = world.getItemAt(i);
            const background = item?.getConfig?.("background");
            if (!background) continue;
            // This runs for every item of every viewer, so the ownership test is
            // what keeps it from describing — and then reconfiguring — a DICOM or
            // WSI-Service slide that merely answers one of the descriptor chain's
            // questions.
            if (!ownsSource(item.source)) continue;

            const descriptor = describeTileSource(item.source);
            if (!descriptor) continue;

            const dataId = dataIdOf(background);
            const known = descriptors.get(dataId);
            descriptors.set(dataId, descriptor);

            if (!shadersAreAutoOwned(background) || corrected.has(background)) continue;
            if (known && !descriptorsDiffer(known, descriptor)) continue;

            const { shaders, reason } = buildAutoShaders(descriptor, {
                statistics: statistics.get(dataId),
                autoWindow,
            });
            reportPlan(dataId, reason);
            const currentType = background.shaders?.[0]?.type;
            const wantedType = shaders?.[0]?.type;
            if (currentType === wantedType) continue;

            corrected.add(background);
            if (shaders) background.shaders = shaders;
            else delete background.shaders;

            // Deliberately not swapping the live layer here. A runtime swap can
            // only change a layer's *type* — its params (channel index, colour)
            // stay at the shader's defaults, which rendered a grayscale slide in
            // magenta until the next open. The corrected configuration above
            // applies on reopen; `before-open` resolves the layout up front, so
            // this path only runs when a slide's layout turns out to differ from
            // what the header said.
            console.info(
                `[geotiff] ${dataId}: layout resolved as ${wantedType || "identity"}; ` +
                "applies on the next open of this slide."
            );
        }
    });
}
