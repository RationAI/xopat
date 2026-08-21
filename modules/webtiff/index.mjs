/**
 * TIFF support: decoder wiring, slide protocol, and shader auto-config.
 *
 * The decoder is libtiff compiled to WebAssembly (`dist/`, vendored). It
 * normalizes every channel to `[0,1]` and declares its encoding, so the ordinary
 * renderer shaders are already correct on TIFF data and this module ships none of
 * its own. What is left here:
 *
 *  - stand up the decode transport: workers for libtiff, `HttpClient` for bytes
 *    (`decode-pool.mjs`);
 *  - install the tile source, which packs tiles the way the drawer wants them
 *    (`tile-source.mjs`);
 *  - register a `tiff` slide protocol so a `.tif`/`.tiff` background opens
 *    without a deployment writing its own protocol entry;
 *  - pick the built-in shader that fits the slide's channel layout, since the
 *    implicit `identity` layer only works for four-channel sources.
 *
 * This module replaces `geotiff`. Both register the `tiff` protocol, so a
 * deployment loads one or the other — see README, *Replacing `geotiff`*.
 *
 * Deployment knobs live in `include.json` (merged with `ENV.modules.webtiff`) and
 * are read through `moduleMeta` — deployment-trusted config, never session data.
 *
 * @module webtiff
 */

import { ProxyDecoderPool } from "./decode-pool.mjs";
import { installWebTiffTileSource } from "./tile-source.mjs";
import { registerRawTiffConverters } from "./raw-tiff.mjs";
import { describeTileSource, descriptorsDiffer } from "./tiff-metadata.mjs";
import { buildAutoShaders, shadersAreAutoOwned, stripAutoDerived } from "./auto-config.mjs";
import { measureChannelRanges } from "./tiff-statistics.mjs";

const MODULE_ID = "webtiff";
const meta = (key, fallback) => {
    const value = window.moduleMeta?.(MODULE_ID, key);
    return value === undefined ? fallback : value;
};

const debugEnabled = () => !!window.APPLICATION_CONTEXT?.getOption?.("debugMode");
const debug = (...args) => { if (debugEnabled()) console.info("[webtiff]", ...args); };

/**
 * Per-tile decode latency, aggregated. A pyramid is hundreds of tiles and the
 * question is never what one of them did.
 */
const stats = { tiles: 0, decodeMs: 0, maxMs: 0 };
const logLatency = (_label, ms) => {
    stats.tiles++;
    stats.decodeMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    if (stats.tiles % 25 === 0) {
        debug(`decoded ${stats.tiles} tiles`,
            `| avg ${(stats.decodeMs / stats.tiles).toFixed(1)}ms`,
            `| max ${stats.maxMs.toFixed(1)}ms`,
            `| ${pool.size} worker(s)`);
    }
};

/**
 * The fetch every byte of every slide travels through.
 *
 * `HttpClient.createAdapter()` routes each URL to the client owning it (proxy
 * alias, JWT, CSRF) and falls back to the plain `fetch` for a URL no protocol
 * claims — which is exactly the policy this module wants, without knowing
 * anything about which deployment it is running in.
 */
const adapter = window.HttpClient?.createAdapter?.();
if (!adapter) {
    console.warn("[webtiff] HttpClient is unavailable; slide bytes will be fetched unauthenticated.");
}
const httpFetch = adapter
    ? (url, init) => adapter.fetch(url, init)
    : (url, init) => window.fetch(url, init);

/**
 * Decoder warnings, once each.
 *
 * The decoder deduplicates them per drain, and a drain happens per message — so
 * a per-tile condition (there is at least one: data-mode tiles report
 * `encoding_channel_0_of_0` although their packs carry the right scale) would
 * otherwise print once per tile and bury everything else. Repeats are still
 * visible under `debugMode`.
 *
 * @param {{code?: string, message?: string}} warning
 */
const seenWarnings = new Set();
function reportDecoderWarning(warning) {
    const code = warning?.code || warning?.message || "unknown";
    if (seenWarnings.has(code)) {
        debug("decoder (repeat):", warning?.message || code);
        return;
    }
    seenWarnings.add(code);
    console.warn(`[webtiff] decoder: ${warning?.message || code}`);
}

/**
 * The decode transport. Workers are created on the first slide, not at load:
 * a deployment that never opens a TIFF pays nothing for having the module
 * installed.
 */
const pool = new ProxyDecoderPool({
    size: Number(meta("decodeWorkers", 0)) || undefined,
    build: meta("threads", false) ? "mt" : "st",
    blockSize: Number(meta("blockSize", 0)) || undefined,
    cacheBytes: Number(meta("workerCacheBytes", 0)) || undefined,
    byteCacheBlocks: Number(meta("byteCacheBlocks", 96)),
    fetch: httpFetch,
    onWarning: reportDecoderWarning,
});

/**
 * How the decoder should pack a tile. 8-bit packs when the file needs no more
 * than 8 bits, which halves the upload for an ordinary colour slide; a file that
 * needs more still gets RGBA16F, decided per tile by the decoder.
 */
const preferRGBA8 = meta("preferRGBA8", true) !== false;
const forceRGBA16F = !!meta("forceRGBA16F", false);

/** The same two flags in the decoder's own bitfield, for the buffer path. */
const packFlags = (preferRGBA8 ? 1 : 0) | (forceRGBA16F ? 2 : 0);

/**
 * The tile source, with the pool and the packing preferences baked in as
 * per-instance defaults.
 */
const WebTiffTileSource = installWebTiffTileSource(OpenSeadragon, {
    pool,
    logLatency: debugEnabled() ? logLatency : false,
    format: { gpu: { preferRGBA8, forceRGBA16F } },
});

// Tiles that are themselves TIFFs (WSI-Service `image_format=tiff`) are decoded
// by the same pool. Not an ownership claim — a converter edge, so replacing the
// `geotiff` module does not leave those deployments with undrawable tiles.
if (meta("decodeRawTiffTiles", true)) {
    registerRawTiffConverters(OpenSeadragon, pool, { packFlags, padAlpha: 1 });
}

debug("decoder installed | converter present:", !!OpenSeadragon.converter);

if (debugEnabled()) {
    // Which target a TIFF-encoded tile actually converts to. The conversion graph
    // picks by edge weight, and OSD's weights are not what the `learn()` arguments
    // suggest (see `raw-tiff.mjs`), so "is this slide going through the packed
    // path or through a canvas?" is worth one line instead of an investigation.
    try {
        const drawerFormats = ["rasterBlob", "context2d", "image", "gpuTextureSet"];
        const path = OpenSeadragon.converter?.getConversionPath?.("rawTiff", drawerFormats);
        debug("rawTiff converts as:", path
            ? path.map(step => step.target?.value ?? step.target).join(" → ")
            : "NO PATH — server-tiled TIFF tiles will not render");
    } catch (e) {
        debug("conversion-path probe failed:", e?.message || e);
    }
}

window.loadElementLocale?.("modules", MODULE_ID);

/**
 * Channel layouts already learned, keyed by data id. A TIFF only reveals its
 * layout once its header has been read; caching means every subsequent open of
 * the same slide is decided up front.
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

function reportPlan(dataId, reason) {
    console.debug(`[webtiff] shader plan for ${dataId}: ${reason}`);
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
 * TIFF-backed protocol turns `registerSlideProtocol` off and names it here;
 * without that this module would own nothing up front and every slide would have
 * to be opened twice before rendering correctly.
 */
const PROTOCOL_ID = meta("protocolId", "tiff");

/**
 * Whether this module may configure a background — *before* any source exists.
 *
 * Ownership is the protocol that will serve the slide, never what its data id
 * looks like. A `.tif` served over DICOM, WSI-Service or any other protocol
 * belongs to that protocol: its module knows things about the slide this one does
 * not, and silently rewriting its shaders is a bug even when the file really is a
 * TIFF.
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
 * {@link ownsBackground}, asked once the source exists and can answer for itself.
 * A source that merely *describes* tiff-encoded samples (WSI-Service `/info`) is
 * not ours; only one this decoder built is.
 *
 * @param {object} source an OpenSeadragon TileSource
 * @return {boolean}
 */
const ownsSource = (source) => !!source && source instanceof WebTiffTileSource;

// Data ids may be bare file names when the deployment says where they live.
const baseUrl = meta("protocolBaseUrl", "");
const resolveUrl = (dataID) => {
    const id = String(dataID);
    if (!baseUrl || /^(https?:)?\/\//i.test(id)) return id;
    return baseUrl.replace(/\/+$/, "") + "/" + id.replace(/^\/+/, "");
};

/**
 * The URL a data id is served from — the cache key, and the only thing the
 * decoder ever sees.
 *
 * Both callers must agree on it: the protocol factory building the source for an
 * open, and the layout probe reading the header before that open. A protocol
 * declaring its own `httpClient` gives a proxied or prefixed base, so the id has
 * to go through the client as well — resolving it in one place and not the other
 * would build two sources for one slide, one of them pointed at a path the server
 * does not serve.
 *
 * @param {string} dataID
 * @param {object} [client] the protocol's HttpClient, when the caller has it
 * @return {string}
 */
function slideUrlFor(dataID, client) {
    const raw = resolveUrl(dataID);
    const owner = client ?? window.SLIDE_PROTOCOLS?.getClientForProtocol?.(PROTOCOL_ID);
    let url = raw;
    try {
        if (owner) url = owner.resolveUrl(raw);
    } catch (e) {
        // A client that cannot resolve leaves the id as written; the warning below
        // then reports where it really points, which is the useful half anyway.
    }
    warnIfViewerOrigin(dataID, url);
    return url;
}

/** Reported once per session: a data id that silently resolved to the viewer origin. */
let warnedViewerOrigin = false;

/**
 * The failure mode this module is easiest to misconfigure into.
 *
 * With no `protocolBaseUrl` and no protocol-level client, a relative data id
 * resolves against the *viewer* origin: every range request 404s and the only
 * symptom is a header the decoder cannot read. A deployment that really does
 * serve slides from the viewer is legitimate, so this is advisory — but it must
 * not be silent, and it must say which knob to reach for.
 *
 * Once per session, not per tile: the decoder never re-resolves a URL, but a
 * slide list asks about many slides and a viewport opens many tiles.
 *
 * @param {string} dataID the data id as written in the session
 * @param {string} url what it resolved to
 */
function warnIfViewerOrigin(dataID, url) {
    if (warnedViewerOrigin) return;
    // An absolute URL — from an absolute data id or an absolute base — says where
    // it points, whether or not that is the viewer.
    if (/^(https?:)?\/\//i.test(url)) return;
    // A client claiming the URL means a transport is configured (a proxy alias,
    // an authenticated base). `getActiveClientForUrl` normalizes relative URLs
    // against the page before matching, so this is the accurate test.
    if (window.SLIDE_PROTOCOLS?.getActiveClientForUrl?.(url)) return;

    warnedViewerOrigin = true;
    let absolute = url;
    try {
        absolute = new URL(url, window.location.href).href;
    } catch (e) {
        // Keep it as written; it is only there to make the message concrete.
    }
    console.warn(
        `[webtiff] data id ${JSON.stringify(String(dataID))} for the "${PROTOCOL_ID}" protocol ` +
        `resolves against the viewer origin (${absolute}) — \`ENV.modules.webtiff.protocolBaseUrl\` ` +
        "is not set. If the viewer serves the slides itself, set it to their path to say so " +
        "explicitly; otherwise set it to the file server's base URL, or use absolute data ids. " +
        "See modules/webtiff/README.md, \"Where the slides live\". Reported once per session."
    );
}

/**
 * Sources already built, keyed by resolved URL, most recently used last.
 *
 * A source owns the parsed header, the level pyramid and — in the workers — the
 * decoder's block cache. Rebuilding one per open means re-reading the header and
 * re-fetching every block, which is what makes returning to a slide as slow as
 * opening it the first time.
 *
 * The cost of keeping them is real (one wasm block cache per worker that touched
 * the file), so the map is bounded: the least recently used source that no viewer
 * is showing is closed for good.
 */
const sources = new Map();
const maxOpenSlides = Math.max(1, Number(meta("maxOpenSlides", 4)) || 4);

/** Whether any viewer is currently rendering this source. */
function sourceInUse(source) {
    const viewers = window.VIEWER_MANAGER?.viewers;
    if (!Array.isArray(viewers)) return true;   // cannot tell: assume yes, never evict blindly
    for (const viewer of viewers) {
        const world = viewer?.world;
        if (!world) continue;
        for (let i = 0; i < world.getItemCount(); i++) {
            if (world.getItemAt(i)?.source === source) return true;
        }
    }
    return false;
}

/** Close the oldest idle sources until the cache is within its bound. */
function trimSources() {
    if (sources.size <= maxOpenSlides) return;
    for (const [url, source] of sources) {
        if (sources.size <= maxOpenSlides) return;
        if (sourceInUse(source)) continue;
        sources.delete(url);
        try {
            source.closeFile();
            debug("closed idle slide", url);
        } catch (e) {
            console.warn("[webtiff] closing an idle slide failed:", e?.message || e);
        }
    }
}

/**
 * Point a source at the client that owns its URL.
 *
 * The bytes route themselves (the pool's adapter matches the URL against the
 * registry's clients), but everything *else* that talks to a slide — ICC
 * profiles, thumbnails, the z-plane prefetcher — reads `__xopatHttpClient` off
 * the source. A cached source must get it too: the layout probe builds the
 * source before the protocol factory is ever called, so on that path the
 * factory's stamp would land on a source nobody returns.
 *
 * @param {object} source
 * @param {object} [client]
 */
function stampClient(source, client) {
    if (client && source && !source.__xopatHttpClient) source.__xopatHttpClient = client;
}

/**
 * Build (or reuse) the source for a resolved URL.
 * @param {string} url
 * @param {object} [client] the protocol's HttpClient, when it declares one
 * @return {object} the tile source; possibly still parsing its header
 */
function sourceFor(url, client) {
    const cached = sources.get(url);
    // Only reuse a source that actually parsed: one that failed would otherwise
    // pin its failure for the rest of the session.
    if (cached && cached._ready) {
        sources.delete(url);
        sources.set(url, cached);       // refresh recency
        stampClient(cached, client);
        return cached;
    }
    if (cached && !cached.__xopatOpenFailure) {
        stampClient(cached, client);
        return cached;                  // still opening
    }

    const source = new WebTiffTileSource(url, {});
    // The identity everything per-slide is keyed by (preview cache, visited
    // slides, virtualization detectors). The URL is a correct id here because
    // this protocol serves one file per URL — unlike DICOMweb, which shares one
    // base URL across slides.
    source.tileSourceId = url;
    stampClient(source, client);
    // The header read is already in flight, so an `open-failed` can fire before
    // the open pipeline subscribes; record it where `awaitSourceReady` looks.
    source.addHandler("open-failed", (e) => {
        source.__xopatOpenFailure = (typeof e?.message === "string" ? e.message : e?.message?.message)
            || "[webtiff] the slide failed to open";
    });
    sources.set(url, source);
    trimSources();
    return source;
}

/**
 * Build (or reuse) the source for a data id and wait for its header.
 *
 * Reached through {@link ensureSlideLayout}, from an awaited `before-open` or from
 * the preview hook, so the channel layout is known *before* the shader
 * configuration is assembled. The alternative — correcting after the open — can
 * only change a layer's type, not its params, which is why a first open would
 * render with the wrong colour and a second one correctly.
 *
 * @param {string} dataId
 * @return {Promise<object|undefined>} the ready source, or undefined on failure
 */
async function readySourceFor(dataId) {
    // The same client the protocol factory will be handed. Resolving without it
    // would give a different URL — and the URL is both the cache key and
    // `tileSourceId`, so the probe and the open would build two sources for one
    // slide and read its header twice.
    const client = window.SLIDE_PROTOCOLS?.getClientForProtocol?.(PROTOCOL_ID);
    const url = slideUrlFor(dataId, client);
    const source = sourceFor(url, client);
    if (source._ready) return source;

    try {
        // `promises.ready` is a *deferred* (`{promise, resolve, reject}`), not a
        // promise. Awaiting the deferred itself is a no-op — it has no `then`, so
        // it settles on the next microtask with the header still unread and the
        // background left on the implicit `identity`.
        await source.promises?.ready?.promise;
        return source._ready ? source : undefined;
    } catch (e) {
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
            const source = ownsSource(knownSource) && knownSource._ready
                ? knownSource
                : await readySourceFor(dataId);
            const descriptor = descriptors.get(dataId)
                || (source ? describeTileSource(source) : undefined);
            if (!descriptor) return undefined;
            descriptors.set(dataId, descriptor);

            if (autoWindow !== "off" && !statistics.has(dataId) && source) {
                // An `undefined` result is stored deliberately: a slide that cannot
                // be measured must not be re-measured on every thumbnail repaint.
                statistics.set(dataId,
                    await measureChannelRanges(source.getTiffFile?.(), descriptor));
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
            label: "TIFF / WSI (web-tiff)",
            // The tile source reads the file itself (range requests through the
            // pool's `HttpClient` fetch), so the data id resolves to the file URL.
            createTileSource: (ctx) => sourceFor(
                slideUrlFor(ctx.dataID, ctx.httpClient), ctx.httpClient),
        });
    } catch (e) {
        // The most likely cause by far is that `geotiff` is loaded too and got
        // there first — in which case this module decodes nothing at all, so say
        // what to do about it rather than logging a duplicate-id error.
        console.warn(`[webtiff] the "${PROTOCOL_ID}" slide protocol is already registered ` +
            "(is the deprecated `geotiff` module still enabled? load one decoder, not both): ",
        e?.message || e);
    }
}

if (meta("autoConfigure", true) && window.VIEWER_MANAGER) {
    // Auto-derived shader configurations are a runtime decision, not state worth
    // persisting: they describe the file's channel layout, which the next open
    // re-derives anyway. Drop them on load.
    VIEWER_MANAGER.addHandler("before-app-init", (e) => {
        const reset = stripAutoDerived(e?.background);
        if (reset) console.debug(`[webtiff] re-deriving shaders for ${reset} background(s)`);
    });

    // Decide before the open pipeline clones the background's shader list.
    VIEWER_MANAGER.addHandler("before-open", async (e) => {
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

    // Learn the real layout once the source is open, and correct this viewer if the
    // slide turned out to be something else than the plan assumed.
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

            const warnings = item.source.getWarnings?.();
            if (warnings?.length) {
                console.warn(`[webtiff] ${dataId}: ${warnings.join("; ")}`);
            }

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

            // Deliberately not swapping the live layer here. A runtime swap can only
            // change a layer's *type* — its params (channel index, colour) stay at
            // the shader's defaults, which renders a grayscale slide in magenta. The
            // corrected configuration above applies on reopen; `before-open` resolves
            // the layout up front, so this path only runs when a slide's layout turns
            // out to differ from what the header said.
            console.info(
                `[webtiff] ${dataId}: layout resolved as ${wantedType || "identity"}; ` +
                "applies on the next open of this slide."
            );
        }
    });
}
