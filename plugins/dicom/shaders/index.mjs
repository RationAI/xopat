import { defineDicomSegShader } from './dicom-seg.mjs';
import { defineDicomParametricShader } from './dicom-parametric.mjs';

let registered = false;

/**
 * Fallback translator for callers that do not supply one.
 *
 * `XOpatElement.t` resolves a plugin string with `{ns: <plugin id>}`
 * (src/loader.ts). Prefixing the namespace into the key itself instead looks
 * plausible, resolves in no namespace, and silently renders the raw key — so
 * the namespace is expressed here exactly once rather than at every call site.
 */
const defaultTranslator = (key, options = {}) => window.$.t(key, { ...options, ns: "dicom" });

/**
 * Register the DICOM shader layers with the flex-renderer registry.
 *
 * The layers are defined as factories over the OpenSeadragon namespace rather
 * than as top-level classes because `$.FlexRenderer.ShaderLayer` only exists
 * once the renderer bundle has loaded — and this module is imported by the
 * plugin's workspace bundle, which may be evaluated earlier.
 *
 * Registration is idempotent: the registry logs a warning when a type is
 * overwritten, and a plugin reload should not produce that noise.
 *
 * @param {(key: string, options?: object) => string} [t] the owning plugin's
 *   translator (`this.t`), which already carries the right namespace.
 * @returns {boolean} whether the layers are available
 */
export function registerDicomShaderLayers(t = defaultTranslator) {
    if (registered) return true;

    const $ = window.OpenSeadragon;
    const registry = $?.FlexRenderer?.ShaderLayerRegistry;
    if (!registry || !$.FlexRenderer.ShaderLayer) {
        // WebGL rendering is unavailable (or the renderer failed its capability
        // gate). Overlays simply will not be offered — the slide still opens.
        console.warn("[dicom] flex-renderer unavailable; SEG/parametric overlays disabled.");
        return false;
    }

    registry.register(defineDicomSegShader($, t));
    registry.register(defineDicomParametricShader($, t));
    registered = true;
    return true;
}
