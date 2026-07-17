/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

import { anchorToCss, regionToCss, defaultStyle } from "./overlay-types";

type Viewer = OpenSeadragon.Viewer & { uniqueId: UniqueViewerId };

interface Mount {
    el: HTMLElement;
    audio?: HTMLAudioElement;
    chromeId: string;
    /** Viewer the overlay was mounted into (parallel multi-viewer playback). */
    viewerId?: UniqueViewerId;
}

interface AssetSource { kind: "image" | "audio"; mimeType: string; data: string; }

type AssetResolver = (id: string) => AssetSource | undefined;

const PREVIEW_KEY = "__preview__";

/**
 * Mounts a step's overlays into its viewer's DOM container while the step is
 * the active playback step, and tears them down again on transition. Owned by
 * the recorder plugin; one instance per page.
 *
 * Live editor previews bypass the event loop: the editor calls
 * `previewSet(step, draftOverlays, draftAssets)` to render an unsaved draft,
 * and `previewClear()` to drop it.
 */
export class OverlayRenderer {
    private mounts = new Map<string, Mount>();
    private currentStepId: string | null = null;
    private mountedStepIds = new Set<string>();
    private inPreview = false;

    constructor(private recorder: RecorderModule) {
        recorder.addHandler("enter", (e: any) => this._onEnter(e.step, e.viewerId));
        recorder.addHandler("update", (e: any) => this._onUpdate(e.step));
        recorder.addHandler("stop", (e: any) => this._tearDownViewer(e?.viewerId));
        recorder.addHandler("play", (e: any) => this._tearDownViewer(e?.viewerId));
    }

    previewSet(step: RecorderSnapshotStep, overlays: RecorderOverlay[], draftAssets: Map<string, RecorderAsset>): void {
        this.inPreview = true;
        this._tearDownAll();
        const resolver: AssetResolver = (id) => {
            const draft = draftAssets.get(id);
            if (draft) return { kind: draft.kind, mimeType: draft.mimeType, data: draft.data };
            const saved = this.recorder.getAsset(id);
            return saved ? { kind: saved.kind, mimeType: saved.mimeType, data: saved.data } : undefined;
        };
        this._mountAll(step, overlays, PREVIEW_KEY, resolver);
    }

    previewClear(): void {
        if (!this.inPreview) return;
        this.inPreview = false;
        this._tearDownAll();
        // Re-mount the live step if one was current (e.g. user opened editor
        // mid-playback). Use the recorder's last index, not the field we
        // cleared during _tearDownAll.
        const idx = this.recorder.currentStepIndex();
        const step = this.recorder.getStep(idx);
        if (step) this._mountStepLive(step);
    }

    private _onEnter(step: RecorderSnapshotStep | undefined, viewerId?: UniqueViewerId): void {
        if (this.inPreview) return;
        // Tear down only the entering viewer's overlays so a different viewer
        // playing in parallel keeps its own.
        this._tearDownViewer(viewerId ?? (step?.viewerId as UniqueViewerId | undefined));
        if (step) this._mountStepLive(step);
    }

    private _onUpdate(step: RecorderSnapshotStep | undefined): void {
        if (this.inPreview || !step || !this.mountedStepIds.has(step.id)) return;
        this._tearDownViewer(step.viewerId as UniqueViewerId | undefined);
        this._mountStepLive(step);
    }

    private _mountStepLive(step: RecorderSnapshotStep): void {
        this._mountAll(step, step.overlays ?? [], step.id, (id) => {
            const a = this.recorder.getAsset(id);
            return a ? { kind: a.kind, mimeType: a.mimeType, data: a.data } : undefined;
        });
    }

    private _mountAll(step: RecorderSnapshotStep, overlays: RecorderOverlay[], stepKey: string, resolve: AssetResolver): void {
        this.currentStepId = stepKey;
        if (!overlays?.length) return;
        const viewer = VIEWER_MANAGER.getViewer(step.viewerId, false) as Viewer | undefined;
        const container = viewer?.element;
        if (!container) return;
        if (step.id) this.mountedStepIds.add(step.id);
        const layer = this._ensureLayer(container);
        for (const overlay of overlays) {
            const mount = this._buildMount(overlay, resolve);
            if (!mount) continue;
            mount.viewerId = viewer?.uniqueId;
            layer.appendChild(mount.el);
            this._registerChrome(mount);
            mount.audio?.play().catch(() => undefined);
            this.mounts.set(overlay.id, mount);
        }
    }

    /**
     * One layer per viewer container. Sits inside `viewer.element` (which OSD
     * makes `position:relative`), pinned to all four edges with overflow
     * clipped — so overlays can never escape the viewer the step belongs to.
     * `pointer-events:none` keeps cursor events flowing to OSD; interactive
     * overlay children opt back in via their own `pointer-events:auto`.
     */
    private _ensureLayer(container: HTMLElement): HTMLDivElement {
        const existing = container.querySelector<HTMLDivElement>(":scope > .recorder-overlay-layer");
        if (existing) return existing;
        // Defensive: OSD's container is already position:relative but other
        // wrappers (multi-viewport grids) may not be.
        if (getComputedStyle(container).position === "static") {
            container.style.position = "relative";
        }
        const layer = document.createElement("div");
        layer.className = "recorder-overlay-layer";
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.overflow = "hidden";
        layer.style.pointerEvents = "none";
        layer.style.zIndex = "20";
        container.appendChild(layer);
        return layer;
    }

    private _buildMount(overlay: RecorderOverlay, resolve: AssetResolver): Mount | null {
        if (overlay.kind === "composite") return this._mountComposite(overlay, resolve);
        if (overlay.kind === "text") return this._mountText(overlay);
        if (overlay.kind === "image") return this._mountImage(overlay, resolve);
        if (overlay.kind === "audio") return this._mountAudio(overlay, resolve);
        return null;
    }

    private _mountComposite(overlay: RecorderCompositeOverlay, resolve: AssetResolver): Mount | null {
        const hasText = !!overlay.markdown?.trim();
        const hasImage = !!overlay.imageAssetId;
        if (!hasText && !hasImage) return null;

        const wrap = document.createElement("div");
        wrap.dataset.recorderOverlayId = overlay.id;
        wrap.dataset.recorderOverlayKind = "composite";
        wrap.className = "recorder-overlay recorder-overlay-composite flex flex-col gap-1";
        this._applyPlacement(wrap, overlay);
        this._applyStyle(wrap, this._cardStyle(overlay));
        // Composite card needs visible padding so the body breathes a bit.
        wrap.style.padding = wrap.style.padding || "8px 10px";
        wrap.style.pointerEvents = "none";

        if (hasImage) {
            const asset = resolve(overlay.imageAssetId!);
            if (asset) {
                const img = document.createElement("img");
                img.alt = overlay.imageAlt || "";
                img.src = `data:${asset.mimeType};base64,${asset.data}`;
                img.style.display = "block";
                img.style.maxWidth = "100%";
                img.style.maxHeight = "60vh";
                img.style.objectFit = "contain";
                if (overlay.style?.borderRadius) img.style.borderRadius = `${overlay.style.borderRadius}px`;
                wrap.appendChild(img);
            }
        }
        if (hasText) {
            const body = document.createElement("div");
            body.className = "recorder-overlay-text-body";
            body.innerHTML = this._renderMarkdown(overlay.markdown!);
            wrap.appendChild(body);
        }
        return { el: wrap, chromeId: this._chromeId(overlay.id) };
    }

    private _mountText(overlay: RecorderTextOverlay): Mount {
        const el = document.createElement("div");
        el.dataset.recorderOverlayId = overlay.id;
        el.dataset.recorderOverlayKind = "text";
        el.className = "recorder-overlay recorder-overlay-text";
        this._applyPlacement(el, overlay);
        this._applyStyle(el, this._cardStyle(overlay));
        el.style.padding = el.style.padding || "8px 10px";
        el.style.pointerEvents = "none"; // text overlays never eat clicks
        el.innerHTML = this._renderMarkdown(overlay.markdown || "");
        return { el, chromeId: this._chromeId(overlay.id) };
    }

    private _mountImage(overlay: RecorderImageOverlay, resolve: AssetResolver): Mount | null {
        const asset = resolve(overlay.assetId);
        if (!asset) return null;
        const img = document.createElement("img");
        img.dataset.recorderOverlayId = overlay.id;
        img.dataset.recorderOverlayKind = "image";
        img.className = "recorder-overlay recorder-overlay-image";
        img.alt = overlay.alt || "";
        img.src = `data:${asset.mimeType};base64,${asset.data}`;
        this._applyPlacement(img, overlay);
        this._applyStyle(img, overlay.style);
        // Default cap; layer overflow:hidden takes care of any remainder.
        if (!img.style.maxWidth) img.style.maxWidth = "40%";
        if (!img.style.maxHeight) img.style.maxHeight = "60vh";
        img.style.objectFit = "contain";
        img.style.pointerEvents = "none";
        return { el: img, chromeId: this._chromeId(overlay.id) };
    }

    private _mountAudio(overlay: RecorderAudioOverlay, resolve: AssetResolver): Mount | null {
        const asset = resolve(overlay.assetId);
        if (!asset) return null;
        const audio = new Audio(`data:${asset.mimeType};base64,${asset.data}`);
        audio.preload = "auto";
        if (overlay.hidden) {
            // Off-DOM player; create a tiny invisible anchor so chrome
            // registration has something to attach to.
            const ghost = document.createElement("span");
            ghost.dataset.recorderOverlayId = overlay.id;
            ghost.dataset.recorderOverlayKind = "audio-hidden";
            ghost.style.display = "none";
            return { el: ghost, audio, chromeId: this._chromeId(overlay.id) };
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.recorderOverlayId = overlay.id;
        btn.dataset.recorderOverlayKind = "audio";
        btn.className = "recorder-overlay recorder-overlay-audio btn btn-sm btn-circle";
        btn.innerHTML = `<span class="ph-light ph-play"></span>`;
        btn.title = "Play / pause voiceover";
        btn.onclick = () => {
            if (audio.paused) {
                audio.play().catch(() => undefined);
                btn.innerHTML = `<span class="ph-light ph-pause"></span>`;
            } else {
                audio.pause();
                btn.innerHTML = `<span class="ph-light ph-play"></span>`;
            }
        };
        audio.onended = () => { btn.innerHTML = `<span class="ph-light ph-play"></span>`; };
        this._applyPlacement(btn, overlay);
        this._applyStyle(btn, overlay.style);
        return { el: btn, audio, chromeId: this._chromeId(overlay.id) };
    }

    private _applyPlacement(el: HTMLElement, overlay: RecorderOverlay): void {
        const placement = overlay.placement;
        const padding = placement?.padding ?? 16;
        // A region carries the author's layout intent and sizes the overlay too;
        // the nine-cell anchor is the fallback for overlays authored before
        // regions existed (and by the anchor-grid editor).
        Object.assign(el.style, placement?.region
            ? regionToCss(placement.region, padding)
            : anchorToCss(placement?.anchor || "bc", padding));
        el.style.zIndex = "20";
    }

    /**
     * Text-bearing overlays (text, composite) render over arbitrary slide
     * pixels, so they are unreadable without a backdrop. The editor stamps
     * `defaultStyle()` on what it authors, but overlays created anywhere else
     * (scripting API, imported bundles, host-injected recordings) carry no
     * style at all — fill the gaps here so readability never depends on who
     * produced the overlay. Author-set fields always win.
     */
    private _cardStyle(overlay: RecorderOverlay): RecorderOverlayStyle {
        const defaults = defaultStyle();
        // A region already decided the extent (a band spans the viewer); the
        // default card width would silently shrink it back to a column.
        if (overlay.placement?.region) delete defaults.maxWidth;
        return { ...defaults, ...(overlay.style || {}) };
    }

    private _applyStyle(el: HTMLElement, style?: RecorderOverlayStyle): void {
        if (!style) return;
        if (typeof style.fontSize === "number") el.style.fontSize = `${style.fontSize}px`;
        if (style.color) el.style.color = style.color;
        if (style.background) el.style.background = style.background;
        if (typeof style.opacity === "number") el.style.opacity = String(style.opacity);
        if (typeof style.borderRadius === "number") el.style.borderRadius = `${style.borderRadius}px`;
        if (typeof style.maxWidth === "number") el.style.maxWidth = `${style.maxWidth}px`;
    }

    private _renderMarkdown(src: string): string {
        const marked = (window as any).xnpm?.marked;
        if (marked?.parse) {
            try { return marked.parse(src); } catch (e) { console.warn("[recorder] markdown parse failed", e); }
        }
        // Defensive plain-text fallback (escaped) if marked failed to load.
        const div = document.createElement("div");
        div.textContent = src;
        return div.innerHTML;
    }

    private _chromeId(overlayId: string): string {
        return `recorder-overlay-${overlayId}`;
    }

    private _registerChrome(mount: Mount): void {
        const chrome = (UI as any)?.Services?.AppBar?.Chrome;
        if (!chrome?.register) return;
        chrome.register(mount.chromeId, {
            is: () => mount.el.style.visibility !== "hidden",
            set: (visible: boolean) => { mount.el.style.visibility = visible ? "visible" : "hidden"; },
        });
    }

    private _disposeMount(mount: Mount, layers: Set<HTMLElement>): void {
        const chrome = (UI as any)?.Services?.AppBar?.Chrome;
        chrome?.unregister?.(mount.chromeId);
        if (mount.audio) { try { mount.audio.pause(); mount.audio.src = ""; } catch { /* */ } }
        const layer = mount.el.parentElement;
        if (layer?.classList.contains("recorder-overlay-layer")) layers.add(layer);
        mount.el.remove();
    }

    /** Tear down only one viewer's overlays (no id → all of them). */
    private _tearDownViewer(viewerId?: UniqueViewerId): void {
        if (!viewerId) { this._tearDownAll(); return; }
        const layers = new Set<HTMLElement>();
        for (const [key, mount] of this.mounts) {
            if (mount.viewerId !== viewerId) continue;
            this._disposeMount(mount, layers);
            this.mounts.delete(key);
        }
        for (const layer of layers) {
            if (!layer.childElementCount) layer.remove();
        }
    }

    private _tearDownAll(): void {
        const layers = new Set<HTMLElement>();
        for (const mount of this.mounts.values()) {
            this._disposeMount(mount, layers);
        }
        for (const layer of layers) {
            if (!layer.childElementCount) layer.remove();
        }
        this.mounts.clear();
        this.currentStepId = null;
        this.mountedStepIds.clear();
    }
}
