import { BackgroundConfig } from "../background-config";
import { validateVisualizations } from "./visualization-validation";

/**
 * Remove `<` / `>` from the display text of shader controls (`title`, option labels).
 *
 * flex-renderer interpolates these unescaped into HTML that xOpat mounts via
 * innerHTML (`UIControls.renderTitle`, the select `<option>` labels — see
 * UPSTREAM.md), and they arrive from session / POST_DATA / peer bundles (§7).
 * Both sinks are element-text context, where only `<` can open markup, so dropping
 * the angle brackets is sufficient. Stripping (not entity-escaping) is idempotent:
 * live-config-sync writes the renderer's config back into the session, and an
 * escaped title would gain one more `&amp;` on every reopen. Mutates `params`
 * (callers pass their own deep copy). Remove once the library escapes.
 */
function stripControlMarkup(params: Record<string, any>, depth = 0): void {
    if (depth > 6) return;
    const strip = (value: any) => typeof value === "string" ? value.replace(/[<>]/g, "") : value;
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (key === "title") {
            params[key] = strip(value);
        } else if (key === "options" && Array.isArray(value)) {
            params[key] = value.map((opt: any) => opt && typeof opt === "object" && "label" in opt
                ? { ...opt, label: strip(opt.label) }
                : strip(opt));
        } else if (key === "options" && value && typeof value === "object") {
            for (const optKey of Object.keys(value)) value[optKey] = strip(value[optKey]);
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
            stripControlMarkup(value, depth + 1);
        }
    }
}

export class ViewerVisualizationRuntime {
    constructor(private readonly appContext: ApplicationContext) {}

    getRenderingCapability(force = false) {
        const runtimeAppContext: any = this.appContext as any;
        if (!force && runtimeAppContext.__renderingCapability) {
            return runtimeAppContext.__renderingCapability;
        }

        const rendererClass = (window.OpenSeadragon as any)?.FlexRenderer;
        const fallback = {
            ok: false,
            error: "FlexRenderer runtime self-test is not available.",
        };

        const capability = rendererClass && typeof rendererClass.ensureRuntimeSupport === "function"
            ? rendererClass.ensureRuntimeSupport({
                webGLPreferredVersion: this.appContext.getOption("webGlPreferredVersion"),
                debug: !!this.appContext.getOption("webglDebugMode"),
                force,
                throwOnFailure: false,
            })
            : fallback;

        runtimeAppContext.__renderingCapability = capability;
        return capability;
    }

    warnRenderingCapability(message: string) {
        const runtimeAppContext: any = this.appContext as any;
        if (runtimeAppContext.__renderingCapabilityWarning === message) {
            return;
        }
        runtimeAppContext.__renderingCapabilityWarning = message;
        console.warn(message);
        if (typeof Dialogs !== "undefined" && Dialogs?.show) {
            Dialogs.show(message, 12000, Dialogs.MSG_WARN);
        }
    }

    /**
     * A visualization the session asked for is not the one being shown.
     *
     * Distinct from `warnRenderingCapability`, which reports what the *device*
     * cannot do — this reports what the *configuration* got wrong: a layer whose
     * shader type nothing registers, a `visualizationIndex` past the end of the
     * collection. Both used to be `console.warn` only, so the viewer opened
     * looking healthy while silently showing less than it was told to.
     *
     * Latched on the message, on its own field, for the same reason the
     * capability warning is: an open re-runs this path per viewer and per
     * rebuild, and one misconfiguration must not stack N identical toasts.
     */
    warnVisualization(message: string) {
        const runtimeAppContext: any = this.appContext as any;
        if (runtimeAppContext.__visualizationWarning === message) {
            return;
        }
        runtimeAppContext.__visualizationWarning = message;
        console.warn(message);
        if (typeof Dialogs !== "undefined" && Dialogs?.show) {
            Dialogs.show(message, 12000, Dialogs.MSG_WARN);
        }
    }

    /**
     * Surface flex-renderer's diagnostics as one toast.
     *
     * The renderer degrades on its own — a control that fails to build, a palette that
     * is not a palette, a layer it cannot assemble — so the viewer looks healthy while
     * showing something other than what was configured. Those fallbacks arrive through
     * `UIControls.setReporter` (wired in `src/app.ts`) as {@link reportRendererDiagnostic};
     * the few paths the library still only logs to the console are caught from the
     * logging broker's `console` channel by {@link RENDERER_CONSOLE_DIAGNOSTIC}.
     *
     * Debounced: one rebuild reports per layer, per viewer and per pass, and all of it
     * is one problem to the user.
     */
    watchRendererDiagnostics(debounceMs = 750) {
        const logging: any = (this.appContext as any).logging;
        this._diagnosticDebounceMs = debounceMs;
        if (this._stopDiagnostics || typeof logging?.onRecord !== "function") {
            return;
        }
        const pattern = ViewerVisualizationRuntime.RENDERER_CONSOLE_DIAGNOSTIC;
        this._stopDiagnostics = logging.onRecord((record: any) => {
            if (record.channel === "console" && (record.level === "warn" || record.level === "error")
                && pattern.test(record.message)) {
                this._countDiagnostic();
            }
        });
    }

    /**
     * Reporter for `UIControls.setReporter(fn)`: logs the fallback on the
     * `flex-renderer` channel and counts it toward the toast.
     *
     * `cache-value-rejected` is logged only: the renderer dropped a saved value that did
     * not fit its control and rendered the configured default — the layer now looks the
     * way the session author intended, so telling the user otherwise would be wrong.
     */
    reportRendererDiagnostic(level: string, code: string, details: Record<string, any> = {}) {
        const log: any = (this.appContext as any).log?.("flex-renderer");
        const { message, value, error, ...fields } = details || {};
        const write = level === "error" ? log?.error : log?.warn;
        if (write) {
            write.call(log, { ...fields, code }, message || code, ...(error !== undefined ? [error] : []));
        } else {
            (level === "error" ? console.error : console.warn)(`[FlexRenderer] ${message || code}`);
        }
        if (code !== "cache-value-rejected") {
            this._countDiagnostic();
        }
    }

    private _countDiagnostic() {
        this._diagnosticCount++;
        if (this._diagnosticTimer) return;
        this._diagnosticTimer = setTimeout(() => {
            this._diagnosticTimer = null;
            const total = this._diagnosticCount;
            this._diagnosticCount = 0;
            if (typeof Dialogs !== "undefined" && Dialogs?.show) {
                Dialogs.show($.t("error.visualizationRendererWarnings", { count: total }), 15000, Dialogs.MSG_WARN);
            }
        }, this._diagnosticDebounceMs);
    }

    /**
     * Messages of flex-renderer failures that still bypass `UIControls.report` and go
     * straight to the console (shader construction, second-pass HTML controls, invalid
     * channel — UPSTREAM.md). Drop each alternative once the library reports it.
     */
    static readonly RENDERER_CONSOLE_DIAGNOSTIC = new RegExp([
        "^Failed to construct shader",
        "^Second pass HTML controls error",
        "^Invalid channel\\b",
    ].join("|"));

    private _stopDiagnostics: (() => void) | null = null;
    private _diagnosticCount = 0;
    private _diagnosticTimer: any = null;
    private _diagnosticDebounceMs = 750;

    clearVisualizationCaches(shaderConfigMap: Record<string, any>) {
        let clearedAny = false;
        for (const shaderId in shaderConfigMap) {
            if (!Object.prototype.hasOwnProperty.call(shaderConfigMap, shaderId)) {
                continue;
            }
            const config = shaderConfigMap[shaderId];
            if (!config || typeof config !== "object") {
                continue;
            }
            if (config.cache && typeof config.cache === "object" && Object.keys(config.cache).length > 0) {
                clearedAny = true;
            }
            if (config._cacheApplied) {
                clearedAny = true;
            }
            config.cache = {};
            delete config._cacheApplied;
        }
        return clearedAny;
    }

    validateVisualizationCollection(
        visualizations: VisualizationItem[] = [],
        data: DataSpecification[] = [],
    ) {
        const rendererClass: any = (window.OpenSeadragon as any)?.FlexRenderer;
        const shaderRegistry = rendererClass?.ShaderLayerRegistry;
        const sanitizedVisualizations: VisualizationItem[] = [];
        const issues: string[] = [];

        const sanitizeKey = (value: any, fallback: string) => {
            const raw = typeof value === "string" && value ? value : fallback;
            if (rendererClass && typeof rendererClass.sanitizeKey === "function") {
                try {
                    return rendererClass.sanitizeKey(String(raw));
                } catch (e) {
                    return fallback;
                }
            }
            return String(raw);
        };

        for (let vizIndex = 0; vizIndex < visualizations.length; vizIndex++) {
            const sourceVisualization: any = visualizations[vizIndex];
            if (!sourceVisualization || typeof sourceVisualization !== "object") {
                issues.push(`Visualization #${vizIndex} is not an object.`);
                continue;
            }

            const visualization: any = OpenSeadragon.extend(true, {}, sourceVisualization);
            if (typeof visualization.name !== "string" || !visualization.name) {
                visualization.name = $.t("main.shaders.defaultTitle");
            }

            const sourceShaders = visualization.shaders && typeof visualization.shaders === "object" && !Array.isArray(visualization.shaders)
                ? visualization.shaders
                : {};
            if (sourceShaders !== visualization.shaders) {
                issues.push(`Visualization #${vizIndex} had an invalid shaders definition and was reset.`);
            }

            const sanitizeShaderMap = (
                shaderMap: Record<string, any>,
                siblingPath: string[] = []
            ): { shaders: Record<string, any>; aliases: Map<string, string>; } => {
                const sanitizedShaders: Record<string, any> = {};
                const seenIds = new Set<string>();
                const aliases = new Map<string, string>();
                let layerIndex = 0;

                for (const shaderKey in shaderMap) {
                    if (!Object.prototype.hasOwnProperty.call(shaderMap, shaderKey)) {
                        continue;
                    }
                    const sourceLayer: any = shaderMap[shaderKey];
                    const layerPath = siblingPath.concat([shaderKey]).join("/");
                    if (!sourceLayer || typeof sourceLayer !== "object") {
                        issues.push(`Visualization #${vizIndex} layer '${layerPath}' is not an object.`);
                        continue;
                    }

                    // A layer that fails any check below is dropped outright: it
                    // never reaches the renderer, so the shader menu — which
                    // builds its cards from live renderer shader objects — has
                    // nothing to show a card for. Surfacing dropped layers as
                    // greyed-out rows was considered and declined: a real card
                    // needs a stub shader satisfying the whole ShaderLayer
                    // contract, and its controls would be inert regardless. The
                    // user-facing signal is the aggregated warning raised by the
                    // caller (`error.visualizationValidationIssues`); the
                    // per-layer detail is in `issues`, which the caller logs.
                    const layer: any = OpenSeadragon.extend(true, {}, sourceLayer);
                    const hasNestedShaders = layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders);
                    if ((!layer.type || typeof layer.type !== "string") && hasNestedShaders) {
                        layer.type = "group";
                    }
                    if (typeof layer.type !== "string" || !layer.type) {
                        issues.push(`Visualization #${vizIndex} layer '${layerPath}' is missing a shader type.`);
                        continue;
                    }
                    if (shaderRegistry && typeof shaderRegistry.get === "function" && !shaderRegistry.get(layer.type)) {
                        issues.push(`Visualization #${vizIndex} layer '${layerPath}' uses unknown shader type '${layer.type}'.`);
                        continue;
                    }

                    const fallbackId = `layer_${vizIndex}_${layerIndex}`;
                    const layerId = sanitizeKey(layer.id || shaderKey || fallbackId, fallbackId);
                    if (seenIds.has(layerId)) {
                        issues.push(`Visualization #${vizIndex} defines duplicate layer id '${siblingPath.concat([layerId]).join("/")}'.`);
                        continue;
                    }
                    seenIds.add(layerId);
                    aliases.set(shaderKey, layerId);
                    aliases.set(layerId, layerId);

                    if (typeof layer.name !== "string" || !layer.name) {
                        layer.name = shaderKey || layer.type;
                    }
                    if (layer.params && typeof layer.params === "object") {
                        stripControlMarkup(layer.params);
                    }

                    if (layer.dataReferences !== undefined) {
                        if (!Array.isArray(layer.dataReferences)) {
                            issues.push(`Visualization #${vizIndex} layer '${siblingPath.concat([layerId]).join("/")}' has invalid dataReferences.`);
                            continue;
                        }

                        const refs = layer.dataReferences.filter((entry: any) => Number.isInteger(entry) && entry >= 0);
                        if (refs.length !== layer.dataReferences.length) {
                            issues.push(`Visualization #${vizIndex} layer '${siblingPath.concat([layerId]).join("/")}' had non-integer dataReferences.`);
                        }
                        if (refs.some((entry: number) => entry >= data.length)) {
                            issues.push(`Visualization #${vizIndex} layer '${siblingPath.concat([layerId]).join("/")}' references unavailable data.`);
                            continue;
                        }
                        layer.dataReferences = refs;
                    }

                    if (Array.isArray(layer.tiledImages)) {
                        layer.tiledImages = layer.tiledImages.filter((entry: any) => Number.isInteger(entry) && entry >= 0);
                    }

                    if (layer.shaders !== undefined) {
                        const nestedShaders = layer.shaders && typeof layer.shaders === "object" && !Array.isArray(layer.shaders)
                            ? layer.shaders
                            : {};
                        if (nestedShaders !== layer.shaders) {
                            issues.push(`Visualization #${vizIndex} group '${siblingPath.concat([layerId]).join("/")}' had an invalid nested shaders definition and was reset.`);
                        }
                        const nestedResult = sanitizeShaderMap(nestedShaders, siblingPath.concat([layerId]));
                        layer.shaders = nestedResult.shaders;

                        if (Array.isArray(layer.order)) {
                            const seenOrder = new Set<string>();
                            const normalizedOrder: string[] = [];
                            for (const entry of layer.order) {
                                if (typeof entry !== "string" || !entry) {
                                    continue;
                                }
                                const mapped = nestedResult.aliases.get(entry) || sanitizeKey(entry, entry);
                                if (layer.shaders?.[mapped] && !seenOrder.has(mapped)) {
                                    normalizedOrder.push(mapped);
                                    seenOrder.add(mapped);
                                }
                            }
                            for (const childId of Object.keys(layer.shaders)) {
                                if (!seenOrder.has(childId)) {
                                    normalizedOrder.push(childId);
                                }
                            }
                            layer.order = normalizedOrder;
                        }
                    }

                    layer.id = layerId;
                    sanitizedShaders[layerId] = layer;
                    layerIndex++;
                }

                return {
                    shaders: sanitizedShaders,
                    aliases,
                };
            };

            visualization.shaders = sanitizeShaderMap(sourceShaders).shaders;
            sanitizedVisualizations.push(visualization as VisualizationItem);
        }

        // Second opinion from the renderer itself: the published JSON Schema plus the
        // shaders' own coupling rules. The structural pass above only knows what xOpat
        // can know (is it an object, is the type registered, do the dataReferences
        // exist); everything about *control* validity — which control names a shader
        // declares, which control types exist, which palette belongs to which mode —
        // is the renderer's knowledge and is asked for here rather than duplicated.
        //
        // Deliberately a separate channel from `issues`: these findings do NOT drop a
        // layer. The renderer degrades them on its own (an unknown control type falls
        // back to the layer's declared one, an unknown params key is ignored, a broken
        // coupling renders wrong but renders), so deleting a layer the user authored
        // would destroy more than it protects. They also must not fail a strict open,
        // which `issues` does. Run against the SANITIZED collection so the verdict is
        // about what will actually be sent to the renderer.
        const advisories: string[] = [];
        const verdict = validateVisualizations(sanitizedVisualizations as any[]);
        for (const issue of verdict.issues) {
            advisories.push(`${issue.path}: ${issue.message}`);
        }

        return {
            visualizations: sanitizedVisualizations,
            issues,
            advisories,
            valid: issues.length === 0,
        };
    }
}
