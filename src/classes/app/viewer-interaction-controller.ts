/**
 * Pointer state for shaders that read it.
 *
 * Some shader layers (`fisheye-lens`, `interaction-debug`, ...) sample screen-space
 * pointer state through the `fr_interaction_*` GLSL helpers, which the renderer feeds
 * from `FlexRenderer.setInteractionState(...)`.
 *
 * Observing the pointer is the drawer's own job: `FlexDrawer` binds its listeners to the
 * viewer container (an ancestor of the Fabric annotation overlay, so events arrive by
 * bubbling) and maintains the whole interaction state — pointer position in framebuffer
 * pixels, buttons, drag and click serials. This controller therefore only decides *when*
 * that forwarding is worth paying for, because while it is on every changed pointer move
 * costs a `forceRedraw`.
 *
 * Tracking is enabled per viewer only while a *visible* shader layer declares that it
 * consumes interaction state (`ShaderLayer.requiresInteraction()`), so a third-party
 * shader registered by a plugin works without touching this file.
 */

type ForwardingMode = "auto" | "always" | "never";

interface Attachment {
    renderer: any;
    onProgramUsed: (e: any) => void;
    onVisualizationChange: () => void;
}

export class ViewerInteractionController {
    private static readonly ALLOWED_MODES = new Set<ForwardingMode>(["auto", "always", "never"]);
    private static readonly REASON = "xopat-interaction-shader";

    private readonly attachments = new Map<any, Attachment>();
    /** Viewers currently held in lens mode by the hold shortcut. */
    private readonly holdOverride = new Set<any>();

    constructor(private readonly appContext: ApplicationContext) {}

    registerViewerHooks(viewerManager: any) {
        const onViewerCreate = (e: any) => {
            const viewer = e?.eventSource || e?.viewer;
            // Defer: the drawer/renderer are not ready synchronously on `viewer-create`.
            if (viewer) setTimeout(() => this.attach(viewer), 0);
        };
        const onVisualizationReady = (e: any) => {
            const viewer = e?.eventSource || e?.viewer;
            // Re-attach: a drawer swap replaces the renderer we were subscribed to.
            if (viewer) this.attach(viewer);
        };
        const onViewerGone = (e: any) => {
            const viewer = e?.eventSource || e?.viewer;
            if (viewer) this.detach(viewer);
        };

        viewerManager.addHandler?.("viewer-create", onViewerCreate);
        viewerManager.addHandler?.("viewer-destroy", onViewerGone);
        viewerManager.addHandler?.("viewer-reset", onViewerGone);
        viewerManager.broadcastHandler?.("visualization-ready", onVisualizationReady);
        // `visualization-ready` only fires for configs that declare visualizations; a
        // background-only viewer still gets an implicit identity shader the user can
        // retype, so sweep after every open too. `attach` is idempotent.
        viewerManager.addHandler?.("after-open", () => {
            for (const viewer of this.liveViewers()) this.attach(viewer);
        });

        for (const viewer of this.liveViewers()) {
            this.attach(viewer);
        }
    }

    registerUtilities() {
        window.UTILITIES.setInteractionForwarding = (mode: string) => {
            const next: ForwardingMode = ViewerInteractionController.ALLOWED_MODES.has(mode as ForwardingMode)
                ? (mode as ForwardingMode)
                : "auto";

            this.appContext.setOption("flexInteractionForwarding", next);
            this.appContext.setDirty();
            this.refreshAll();
            UTILITIES.syncSessionToUrl(false);
            return next;
        };
    }

    /**
     * Press-and-hold lens mode.
     *
     * An interaction shader may gate on a mouse button being down — `fisheye-lens` has a
     * hover mode (`buttonMask: -1`), but its default mask is a held secondary button, and
     * a button held on the canvas is exactly what OpenSeadragon turns into a pan gesture.
     * While the key is held the drawer is switched to `viewerInputCaptureMode: "drag"`,
     * which suspends drag/click/flick gestures (wheel zoom keeps working) and restores
     * them on release. A hover-mode layer needs none of this.
     */
    registerShortcuts(shortcuts: any, categoryPath: string[], scope: any) {
        if (!shortcuts?.register) return;

        shortcuts.register({
            id: "core.view.interactionLens",
            titleKey: "keymap.core.interactionLens",
            descriptionKey: "keymap.core.interactionLensDesc",
            categoryPath,
            defaultCombos: ["KeyL"],
            type: "hold",
            scope,
            onPress: ({ viewer }: any) => {
                if (!viewer || this.holdOverride.has(viewer)) return;
                this.holdOverride.add(viewer);
                this.refresh(viewer);
            },
            onRelease: ({ viewer }: any) => {
                if (!viewer || !this.holdOverride.delete(viewer)) return;
                this.refresh(viewer);
            },
        });
    }

    /**
     * Re-evaluate every live viewer. Cheap: the verdict is a static read per layer and the
     * drawer is only reconfigured when the desired state differs from the current one.
     */
    refreshAll() {
        for (const viewer of this.liveViewers()) {
            this.refresh(viewer);
        }
    }

    private liveViewers(): any[] {
        const viewers = (window as any).VIEWER_MANAGER?.viewers;
        return Array.isArray(viewers) ? viewers.filter(Boolean) : [];
    }

    /**
     * Bind to a viewer's renderer. Idempotent, and detaches from a stale renderer when
     * the drawer was recreated underneath us.
     */
    attach(viewer: any) {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer || typeof renderer.addHandler !== "function") return;
        if (!this.supportsInteractionForwarding(viewer)) return;

        const existing = this.attachments.get(viewer);
        if (existing) {
            if (existing.renderer === renderer) {
                this.refresh(viewer);
                return;
            }
            this.detachHandlers(viewer);
            // New drawer, new (default-disabled) forwarding state — forget what we asked
            // the previous one for.
            viewer.__xopatInteractionForwarding = undefined;
        }

        // Fires when the fragment program was (re)built/relinked — the moment the set of
        // compiled layers can have changed.
        const onProgramUsed = (e: any) => {
            if (e?.name === "second-pass") this.refresh(viewer);
        };
        // Control/channel edits, including a layer's `visible` flag flipping.
        const onVisualizationChange = () => this.refresh(viewer);

        renderer.addHandler("program-used", onProgramUsed);
        renderer.addHandler("visualization-change", onVisualizationChange);
        this.attachments.set(viewer, { renderer, onProgramUsed, onVisualizationChange });

        this.refresh(viewer);
    }

    detach(viewer: any) {
        this.detachHandlers(viewer);
        this.holdOverride.delete(viewer);
        // Disabling detaches the drawer's listeners, clears the renderer state and
        // releases any viewer input capture it took.
        this.applyForwarding(viewer, false);
        delete viewer.__xopatInteractionForwarding;
    }

    private detachHandlers(viewer: any) {
        const attachment = this.attachments.get(viewer);
        if (!attachment) return;
        try {
            attachment.renderer.removeHandler?.("program-used", attachment.onProgramUsed);
            attachment.renderer.removeHandler?.("visualization-change", attachment.onVisualizationChange);
        } catch (e) {
            /* renderer may already be disposed */
        }
        this.attachments.delete(viewer);
    }

    /**
     * Only FlexDrawer owns interaction state and the pointer observers that feed it; the
     * canvas/HTML drawers do not.
     */
    private supportsInteractionForwarding(viewer: any): boolean {
        const drawer = viewer?.drawer;
        return !!drawer
            && typeof drawer.getType === "function"
            && drawer.getType() === "flex-renderer"
            && typeof drawer.setInteractionOptions === "function";
    }

    private refresh(viewer: any) {
        if (!this.supportsInteractionForwarding(viewer)) return;

        const mode = this.getMode();
        const active = this.holdOverride.has(viewer) || mode === "always"
            ? true
            : mode === "never" ? false : this.visualizationNeedsInteraction(viewer);

        this.applyForwarding(viewer, active);
    }

    private getMode(): ForwardingMode {
        // No caller-side default literal: the default lives in `src/config.json`, so a
        // deployment `setup` block can override it (see AGENTS.md §3).
        const mode = this.appContext.getOption("flexInteractionForwarding");
        return ViewerInteractionController.ALLOWED_MODES.has(mode as ForwardingMode)
            ? (mode as ForwardingMode)
            : "auto";
    }

    // ---------------------------------------------------------------- forwarding

    /**
     * Hand the desired forwarding state to the drawer, but only when it differs from what
     * we last asked for: `refresh` runs on every program build and every control edit, and
     * a viewer with no interaction shader would otherwise take a disable round-trip
     * (listener teardown, state clear, input-capture release) on each of them.
     */
    private applyForwarding(viewer: any, active: boolean) {
        if (!this.supportsInteractionForwarding(viewer)) return;

        const captureMode = active && this.holdOverride.has(viewer) ? "drag" : "none";
        const desired = `${active}:${captureMode}`;
        if (viewer.__xopatInteractionForwarding === desired) return;
        viewer.__xopatInteractionForwarding = desired;

        try {
            viewer.drawer.setInteractionOptions({
                enabled: active,
                // Suspend OSD drag/click gestures only while the hold shortcut is down,
                // so a hover-mode lens leaves navigation untouched.
                viewerInputCaptureMode: captureMode,
            }, { notify: false, reason: ViewerInteractionController.REASON });
        } catch (e) {
            viewer.__xopatInteractionForwarding = undefined;
            console.warn("[interaction-state] forwarding update failed:", e);
        }
    }

    // --------------------------------------------------------------- detection

    /**
     * True when at least one visible shader layer of the viewer's visualization declares
     * that it reads interaction state.
     */
    private visualizationNeedsInteraction(viewer: any): boolean {
        const renderer = viewer?.drawer?.renderer;
        if (!renderer || typeof renderer.getFlatShaderLayers !== "function") return false;

        let layers: any[];
        try {
            layers = renderer.getFlatShaderLayers(renderer.getAllShaders(), renderer.getShaderLayerOrder()) || [];
        } catch (e) {
            return false;
        }

        for (const layer of layers) {
            if (this.layerCompiles(layer) && ViewerInteractionController.layerNeedsInteraction(layer)) return true;
        }
        return false;
    }

    /**
     * Mirrors the library's own gate in `getShaderLayerComputeDefinition`: a layer that is
     * hidden, disabled or errored compiles to a placeholder body, so its code never runs
     * and it cannot be the reason to pay for pointer tracking.
     */
    private layerCompiles(layer: any): boolean {
        let config: any;
        try {
            config = layer?.getConfig?.();
        } catch (e) {
            return false;
        }
        return !!config && config.type !== "none" && !config.error && !!config.visible;
    }

    /**
     * `ShaderLayer.requiresInteraction()` is the library's declaration that a layer reads
     * `fr_interaction_*` state. The read is deliberately tolerant: a shader class from an
     * older library build, or one that overrides the static badly, reads as "no".
     */
    private static layerNeedsInteraction(layer: any): boolean {
        const shaderClass = layer?.constructor;
        try {
            return !!(shaderClass
                && typeof shaderClass.requiresInteraction === "function"
                && shaderClass.requiresInteraction() === true);
        } catch (e) {
            return false;
        }
    }
}
