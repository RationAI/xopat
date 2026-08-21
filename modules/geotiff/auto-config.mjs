/**
 * Choosing a built-in shader for a TIFF background.
 *
 * The decoder normalizes every channel to `[0,1]`, so no shader needs to know
 * anything about TIFF to render one correctly. The one thing it cannot infer is
 * the *channel layout*: the implicit `identity` layer samples `.rgba` and only
 * works for four-channel sources, so a slide the decoder packs as one or six
 * scalar channels needs a different built-in.
 *
 * That is all this file decides. Everything emitted is tagged {@link AUTO_TAG}
 * so a later run can tell its own guesses apart from a configuration the user
 * chose.
 */

/** Marks a shader config this module derived rather than a human authored. */
export const AUTO_TAG = "geotiff@1";

/**
 * Below this the slide cannot reach half intensity and is, for practical purposes,
 * a black frame — which is the only case an automatic window is worth its
 * surprise. A well-exposed slide is left exactly as the file declares it.
 */
const RESCUE_CEILING = 0.5;

/** A window narrower than this is noise amplification, not a rescue. */
const MIN_WINDOW_SPAN = 1e-3;

/**
 * Whether the built-in scalar shader accepts an input window.
 *
 * The controls are a renderer-side feature, so a deployment running an older
 * vendored `flex-renderer` does not have them. Emitting params it cannot resolve
 * would be config the user sees and cannot act on, so probe the registry instead
 * of assuming — the rest of the auto-configuration works either way.
 *
 * @return {boolean}
 */
function shaderSupportsWindow() {
    try {
        const registry = window.OpenSeadragon?.FlexRenderer?.ShaderLayerRegistry;
        const controls = registry?.get?.("single_channel")?.defaultControls;
        return !!(controls && controls.window_low && controls.window_high);
    } catch (e) {
        return false;
    }
}

/**
 * Whether the built-in scalar shader can be told to output opaque alpha.
 *
 * Same reasoning as {@link shaderSupportsWindow}: a renderer-side feature an
 * older vendored `flex-renderer` does not have, and emitting a param nothing can
 * resolve is config the user sees and cannot act on.
 *
 * @return {boolean}
 */
function shaderSupportsOpaque() {
    try {
        const registry = window.OpenSeadragon?.FlexRenderer?.ShaderLayerRegistry;
        return !!registry?.get?.("single_channel")?.defaultControls?.opaque;
    } catch (e) {
        return false;
    }
}

/**
 * The window a measured channel needs, or undefined when it needs none.
 *
 * Applied only to a channel that would otherwise be unreadable. The decoder
 * normalizes against the range the file *declares*, and that is the right
 * contract — but a file declaring 16 bits while using 12 (with no
 * `SMaxSampleValue` to say so) decodes to a peak of `0.0625`, and nothing in the
 * header distinguishes it from a genuinely dim scene. Only the samples do, which
 * is why the decision is made here and stays adjustable rather than being baked
 * into the pixels.
 *
 * @param {ChannelRange} [range] from `tiff-statistics.mjs`
 * @param {string} [mode] `"rescue"` (default), `"always"` or `"off"`
 * @return {{window_low: number, window_high: number}|undefined}
 */
function windowParams(range, mode = "rescue") {
    if (!range || mode === "off") return undefined;

    const low = Number(range.low);
    const high = Number(range.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
    if (high - low < MIN_WINDOW_SPAN) return undefined;

    // `high <= RESCUE_CEILING`: never reaches half intensity. `low >= RESCUE_CEILING`:
    // the inverse case, a channel with a floor so high nothing in it is distinguishable.
    const needsRescue = high <= RESCUE_CEILING || low >= RESCUE_CEILING;
    if (mode !== "always" && !needsRescue) return undefined;

    return { window_low: low, window_high: high };  // eslint-disable-line camelcase
}

/**
 * Fallback tints for a multi-channel source that declares no colours. Chosen to
 * stay distinguishable when several are blended additively.
 */
const FALLBACK_TINTS = [
    "#ff4d4d", "#4dff4d", "#4d8cff", "#ffe14d",
    "#ff4dff", "#4dffff", "#ff9a4d", "#b04dff",
];

const tagged = (config) => ({ ...config, autoDerived: AUTO_TAG });

/**
 * Decide the shader configuration for a TIFF background.
 *
 * @param {object} descriptor from `tiff-metadata.mjs`
 * @param {object} [options]
 * @param {ChannelRange[]} [options.statistics] measured per-channel ranges, from
 *      `tiff-statistics.mjs`; used only to seed the shader's input window
 * @param {string} [options.autoWindow] `"rescue"` (default), `"always"` or `"off"`
 * @return {{shaders: object[]|undefined, reason: string}} `shaders: undefined`
 *      means "leave the background alone" (implicit `identity`).
 */
export function buildAutoShaders(descriptor, options = {}) {
    if (!descriptor) return { shaders: undefined, reason: "no-descriptor" };

    // Resolved once per call rather than per channel: the registry does not change
    // mid-open, and a six-channel slide would otherwise probe it six times.
    const windowing = shaderSupportsWindow()
        ? { statistics: options.statistics, mode: options.autoWindow || "rescue" }
        : undefined;

    const count = Number(descriptor.samplesPerPixel)
        || (Array.isArray(descriptor.bitsPerSample) ? descriptor.bitsPerSample.length : 0)
        || 1;

    // The decoder's image path renders to four opaque channels before upload —
    // 8-bit colour, 8-bit grayscale and palette all arrive display-ready, which
    // is exactly what `identity` expects.
    if (descriptor.interpretation === "image") {
        return { shaders: undefined, reason: "image-path" };
    }

    if (count === 1) {
        // White, not `single_channel`'s tinted default: a one-channel slide is a
        // grayscale image, and it should look like one.
        //
        // Opaque, too. `single_channel` writes the sampled value into alpha, which
        // is what additive blending of several tinted channels needs — but this
        // layer has nothing beneath it, so a low value would blend toward the
        // canvas backdrop instead of toward black. Against the default opaque-white
        // clear that renders a white-tinted grayscale slide as a blank frame.
        const opaque = shaderSupportsOpaque();
        const params = {
            color: "#ffffff",
            ...(opaque ? { opaque: true } : {}),
            ...windowFor(0, windowing),
        };
        const reason = params.window_high === undefined ? "scalar" : "scalar+window";
        return {
            shaders: [tagged({ type: "single_channel", params })],
            reason: opaque ? `${reason}+opaque` : reason,
        };
    }

    if (count === 3 || count === 4) {
        // Colour on the data path: the packer pads the unused lane with
        // `gpu.padAlpha` (opaque by default), so the texel `identity` samples is
        // a complete RGBA — normalized, and correct without any format knowledge.
        return { shaders: undefined, reason: "colour-data-path" };
    }

    // Several scalar channels (fluorescence, QPTIFF, OME): one tinted layer each,
    // blended together.
    const children = {};
    const order = [];
    for (let i = 0; i < count; i++) {
        const id = `ch${i}`;
        children[id] = channelConfig(i, descriptor, windowing);
        order.push(id);
    }
    return {
        shaders: [tagged({ type: "group", shaders: children, order })],
        reason: `multichannel:${count}`,
    };
}

/**
 * Window params for one channel, or an empty object when none applies.
 * @param {number} index
 * @param {{statistics: ChannelRange[]|undefined, mode: string}} [windowing]
 * @return {object}
 */
function windowFor(index, windowing) {
    if (!windowing) return {};
    return windowParams(windowing.statistics?.[index], windowing.mode) || {};
}

/**
 * One `single_channel` entry for logical channel `index`.
 * @param {number} index
 * @param {object} descriptor
 * @param {{statistics: ChannelRange[]|undefined, mode: string}} [windowing]
 * @return {object}
 */
function channelConfig(index, descriptor, windowing) {
    const color = descriptor.channelColors?.[index] || FALLBACK_TINTS[index % FALLBACK_TINTS.length];

    // Channel selection, the tint and the window are shader *controls*, so they
    // belong in `params` — that is the object a ShaderLayer resolves its controls
    // from. Each channel is measured on its own: in a fluorescence stack the
    // channels routinely differ by an order of magnitude.
    const config = {
        type: "single_channel",
        params: {
            use_channel_base0: index,   // eslint-disable-line camelcase
            color,
            ...windowFor(index, windowing),
        },
    };
    const name = descriptor.channelNames?.[index];
    if (name) config.name = name;
    return config;
}

/**
 * Whether this module may overwrite a background's shader configuration: either
 * nothing is configured, or everything configured is a previous auto-derivation
 * whose type has not been changed since.
 *
 * The type check matters because the canonical scene writes a user's runtime
 * layer switch back into the config while keeping the rest of the entry — so a
 * tagged entry with a foreign type means the user took over.
 *
 * @param {object} background background config entry
 * @return {boolean}
 */
export function shadersAreAutoOwned(background) {
    const shaders = background?.shaders;
    if (!shaders) return true;
    if (!Array.isArray(shaders) || !shaders.length) return false;
    return shaders.every(entry => entry && entry.autoDerived === AUTO_TAG);
}

/**
 * Drop auto-derived shader arrays so they are re-derived from scratch.
 *
 * They describe the file's channel layout, which the next open re-reads anyway;
 * persisting them into a session only risks carrying a stale layout.
 *
 * @param {object[]} backgrounds `config.background`
 * @return {number} how many entries were reset
 */
export function stripAutoDerived(backgrounds) {
    if (!Array.isArray(backgrounds)) return 0;
    let count = 0;
    for (const background of backgrounds) {
        if (background && Array.isArray(background.shaders) && background.shaders.length
            && background.shaders.every(entry => entry && entry.autoDerived === AUTO_TAG)) {
            delete background.shaders;
            count++;
        }
    }
    return count;
}
