/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

import EasyMDE from "easymde";
// CSS is bundled as a string via esbuild's `--loader:.css=text`; we inject it
// once at first open so the editor doesn't depend on a sibling .css file
// being loaded by the plugin loader.
import easymdeCss from "easymde/dist/easymde.min.css";

import { newOverlayId, newAssetId, defaultPlacement, defaultStyle } from "./overlay-types";
import { createAnchorGrid } from "./placement-anchor-grid";
import type { OverlayRenderer } from "./overlay-renderer";

const IMAGE_WARN_BYTES = 2 * 1024 * 1024;   // 2 MB per overlay → warn
const IMAGE_BLOCK_BYTES = 10 * 1024 * 1024; // 10 MB per overlay → reject
const EDITOR_WIDTH = "min(960px, 95vw)";
const BLANK_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Plugin locale bundle — this file is not an XOpatElement, so scope it here. */
const t = (key: string, options: Record<string, any> = {}) => $.t(key, { ...options, ns: "recorder" });

/** Text-only modal action button (core UI atom, no raw DOM). */
const _button = (label: string, style: string, onClick: () => void): HTMLElement =>
    new UI.Button({
        onClick,
        extraClasses: { v: style },
        extraProperties: { type: "button" },
    }, label).create() as HTMLElement;

let _easymdeCssInjected = false;
function _ensureEasymdeCss(): void {
    if (_easymdeCssInjected || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.id = "recorder-easymde-style";
    style.textContent = easymdeCss;
    document.head.appendChild(style);
    _easymdeCssInjected = true;
}

interface DraftAsset {
    id: string;
    kind: "image" | "audio";
    mimeType: string;
    data: string;   // base64, no data: prefix
    size: number;
    createdAt: number;
}

/**
 * Per-step overlay editor.
 *
 * One overlay per "card", and each card is a composite holding markdown text
 * + an optional image at one anchor — so the same +Add path covers both kinds.
 * Audio (Phase B) will sit alongside as its own card kind. Legacy text/image
 * overlays load as composite cards so prior data round-trips into the new UI.
 *
 * The EasyMDE instances and DOM created inside are tied to the modal's
 * lifetime and disposed on close.
 */
export class OverlayEditor {
    private draft: RecorderCompositeOverlay[];
    private draftAssets = new Map<string, DraftAsset>();
    private deletedAssetIds = new Set<string>();
    private mdeInstances = new Map<string, EasyMDE>();
    private listEl!: HTMLDivElement;
    private modal?: InstanceType<typeof UI.Modal>;

    constructor(
        private recorder: RecorderModule,
        private step: RecorderSnapshotStep,
        private renderer: OverlayRenderer,
    ) {
        this.draft = (step.overlays ?? []).map(o => this._toComposite(o));
    }

    open(): void {
        _ensureEasymdeCss();
        const { div, span } = van.tags;

        this.listEl = div({ class: "flex flex-col gap-2" }) as HTMLDivElement;
        this._renderAllCards();

        const body = div({ class: "flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1" },
            div({ class: "flex items-center gap-2" },
                new UI.Button({
                    onClick: () => this._addCard(),
                    extraClasses: { v: "btn-sm btn-primary gap-1" },
                    extraProperties: { type: "button" },
                }, new UI.PhIcon("ph-plus"), t("addOverlay")).create(),
                span({ class: "text-xs opacity-60" }, t("overlayHint")),
            ),
            this.listEl,
        );

        const footer = div({ class: "flex w-full justify-end gap-2" },
            _button($.t("common.cancel"), "btn-ghost", () => this._close(false)),
            _button(t("save"), "btn-primary", () => this._close(true)),
        );

        this.modal = new UI.Modal({
            id: `recorder-overlay-editor-${this.step.id}`,
            header: t("overlaysTitle", { id: this.step.id.slice(0, 6) }),
            body,
            footer,
            width: EDITOR_WIDTH,
        }).mount();
        this.modal.open();

        // Initial preview so the user sees the current state before any edit.
        this._syncPreview();
    }

    // ── Card list ────────────────────────────────────────────────────────

    private _renderAllCards(): void {
        const { div } = van.tags;
        this._disposeAllMde();
        if (this.draft.length === 0) {
            this.listEl.replaceChildren(div({ class: "text-xs opacity-60 italic px-1" }, t("noOverlays")));
            return;
        }
        this.listEl.replaceChildren(...this.draft.map(overlay => this._buildCard(overlay)));
    }

    private _buildCard(overlay: RecorderCompositeOverlay): HTMLElement {
        const { div, span } = van.tags;
        return div({ class: "border border-base-300 rounded-md p-3 bg-base-100", "data-overlay-id": overlay.id },
            // Header: compact anchor picker on the left, delete on the right.
            // `flex-wrap` keeps the layout single-row when there's room and
            // stacks on narrow modals.
            div({ class: "flex flex-wrap items-center gap-2 mb-2" },
                div({ class: "flex items-center gap-1.5" },
                    span({ class: "text-[10px] uppercase tracking-wide opacity-60" }, t("anchor")),
                    createAnchorGrid({
                        value: overlay.placement.anchor,
                        onChange: (next) => { overlay.placement.anchor = next; this._syncPreview(); },
                    }),
                ),
                div({ class: "flex-1 min-w-0" }),
                new UI.Button({
                    onClick: () => this._removeOverlay(overlay.id),
                    extraClasses: { v: "btn-ghost btn-xs btn-square text-error" },
                    extraProperties: { type: "button", title: t("removeOverlay") },
                }, new UI.PhIcon("ph-x")).create(),
            ),
            // Body: image picker on the left, markdown editor on the right.
            div({ class: "grid grid-cols-3 gap-3" },
                div({ class: "col-span-1" }, this._buildImagePicker(overlay)),
                div({ class: "col-span-2 min-w-0" }, this._buildTextEditor(overlay)),
            ),
        ) as HTMLElement;
    }

    // ── Image picker ─────────────────────────────────────────────────────

    private _buildImagePicker(overlay: RecorderCompositeOverlay): HTMLElement {
        const { div, span, img, input } = van.tags;
        // The thumbnail source is a state: swapping the picked image is a state
        // write, not a node rebuild. The placeholder is a transparent pixel —
        // an empty `src` would re-request the page itself.
        const src = van.state(BLANK_PIXEL);
        const hasImage = van.state(false);

        const showPreview = () => {
            const asset = overlay.imageAssetId ? this._resolveAsset(overlay.imageAssetId) : undefined;
            hasImage.val = !!asset;
            src.val = asset ? `data:${asset.mimeType};base64,${asset.data}` : BLANK_PIXEL;
        };
        showPreview();

        const fileInput = input({
            type: "file", accept: "image/*",
            class: "file-input file-input-bordered file-input-xs flex-1",
            onchange: async () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                if (file.size > IMAGE_BLOCK_BYTES) {
                    Dialogs.show(t("imageTooLarge", { size: this._fmtSize(file.size), max: this._fmtSize(IMAGE_BLOCK_BYTES) }), 3000, Dialogs.MSG_ERR);
                    fileInput.value = "";
                    return;
                }
                if (file.size > IMAGE_WARN_BYTES) {
                    Dialogs.show(t("imageLarge", { size: this._fmtSize(file.size) }), 2500, Dialogs.MSG_WARN);
                }
                const base64 = await this._fileToBase64(file);
                if (overlay.imageAssetId) this._markAssetDeleted(overlay.imageAssetId);
                const id = newAssetId();
                this.draftAssets.set(id, { id, kind: "image", mimeType: file.type || "image/png", data: base64, size: file.size, createdAt: Date.now() });
                overlay.imageAssetId = id;
                if (!overlay.imageAlt) overlay.imageAlt = file.name;
                showPreview();
                this._syncPreview();
            },
        }) as HTMLInputElement;

        const altInput = input({
            type: "text", class: "input input-bordered input-xs w-full",
            placeholder: t("altTextPlaceholder"), value: overlay.imageAlt || "",
            oninput: () => { overlay.imageAlt = altInput.value; },
        }) as HTMLInputElement;

        return div({ class: "flex flex-col gap-2" },
            div({ class: "flex items-center justify-center h-32 bg-base-200 rounded" },
                img({ alt: t("imagePreviewAlt"), src: () => src.val,
                    style: () => `max-height:120px;max-width:100%;object-fit:contain;display:${hasImage.val ? "" : "none"};` }),
                span({ class: "text-xs opacity-60 italic px-2 text-center",
                    style: () => `display:${hasImage.val ? "none" : ""};` }, t("noImage")),
            ),
            div({ class: "flex gap-1" },
                fileInput,
                new UI.Button({
                    onClick: () => {
                        if (!overlay.imageAssetId) return;
                        this._markAssetDeleted(overlay.imageAssetId);
                        overlay.imageAssetId = undefined;
                        overlay.imageAlt = undefined;
                        fileInput.value = "";
                        showPreview();
                        this._syncPreview();
                    },
                    extraClasses: { v: "btn-xs btn-ghost" },
                    extraProperties: { type: "button", title: t("removeImage") },
                }, new UI.PhIcon("ph-trash")).create(),
            ),
            altInput,
        ) as HTMLElement;
    }

    // ── Markdown editor ──────────────────────────────────────────────────

    private _buildTextEditor(overlay: RecorderCompositeOverlay): HTMLElement {
        const { div, textarea } = van.tags;
        // EasyMDE takes over this textarea and renders its own toolbar/DOM; van
        // only provides the mount point it replaces.
        const ta = textarea({ value: overlay.markdown || "" }) as HTMLTextAreaElement;
        const wrap = div(ta) as HTMLElement;
        queueMicrotask(() => {
            const mde = new EasyMDE({
                element: ta,
                spellChecker: false,
                status: false,
                minHeight: "120px",
                autofocus: false,
                placeholder: t("markdownPlaceholder"),
                toolbar: ["bold", "italic", "heading", "|", "unordered-list", "ordered-list", "link", "|", "preview"],
            });
            mde.codemirror.on("change", () => {
                overlay.markdown = mde.value();
                this._syncPreview();
            });
            this.mdeInstances.set(overlay.id, mde);
        });
        return wrap;
    }

    // ── Add / remove / convert legacy ────────────────────────────────────

    private _addCard(): void {
        const overlay: RecorderCompositeOverlay = {
            id: newOverlayId(),
            kind: "composite",
            placement: defaultPlacement(),
            style: defaultStyle(),
            markdown: "",
        };
        this.draft.push(overlay);
        this._renderAllCards();
        this._syncPreview();
    }

    private _removeOverlay(id: string): void {
        const idx = this.draft.findIndex(o => o.id === id);
        if (idx < 0) return;
        const removed = this.draft[idx];
        if (removed?.imageAssetId) this._markAssetDeleted(removed.imageAssetId);
        const mde = this.mdeInstances.get(id);
        if (mde) { try { mde.toTextArea(); } catch { /* */ } this.mdeInstances.delete(id); }
        this.draft.splice(idx, 1);
        this._renderAllCards();
        this._syncPreview();
    }

    /**
     * Coerce any overlay (composite, legacy text, legacy image) into the
     * composite shape the editor edits. Audio overlays are kept as-is by the
     * editor scope (Phase B) — for now they pass through unchanged via a
     * side channel since the editor doesn't render them.
     */
    private _toComposite(o: RecorderOverlay): RecorderCompositeOverlay {
        if (o.kind === "composite") return { ...o, placement: { ...o.placement }, style: o.style ? { ...o.style } : undefined };
        if (o.kind === "text") {
            return {
                id: o.id,
                kind: "composite",
                placement: { ...o.placement },
                style: o.style ? { ...o.style } : defaultStyle(),
                markdown: (o as RecorderTextOverlay).markdown,
            };
        }
        if (o.kind === "image") {
            return {
                id: o.id,
                kind: "composite",
                placement: { ...o.placement },
                style: o.style ? { ...o.style } : defaultStyle(),
                imageAssetId: (o as RecorderImageOverlay).assetId,
                imageAlt: (o as RecorderImageOverlay).alt,
            };
        }
        // Audio overlays don't surface in this editor pass; we still need to
        // pass them through on save. They're captured separately.
        return {
            id: o.id,
            kind: "composite",
            placement: { ...o.placement },
            style: o.style ? { ...o.style } : defaultStyle(),
        };
    }

    // ── Asset bookkeeping ────────────────────────────────────────────────

    private _resolveAsset(id: string | undefined): { mimeType: string; data: string; kind: "image" | "audio" } | undefined {
        if (!id) return undefined;
        const draft = this.draftAssets.get(id);
        if (draft) return { mimeType: draft.mimeType, data: draft.data, kind: draft.kind };
        const saved = this.recorder.getAsset(id);
        return saved ? { mimeType: saved.mimeType, data: saved.data, kind: saved.kind } : undefined;
    }

    private _markAssetDeleted(id: string): void {
        if (this.draftAssets.has(id) && !this.recorder.getAsset(id)) {
            this.draftAssets.delete(id);
            return;
        }
        this.deletedAssetIds.add(id);
    }

    // ── Preview / save / cancel ──────────────────────────────────────────

    private _syncPreview(): void {
        const assets = new Map<string, RecorderAsset>();
        for (const a of this.draftAssets.values()) assets.set(a.id, { ...a });
        // Drop overlays that have neither text nor image so the preview
        // doesn't render invisible cards mid-edit.
        const visible = this.draft.filter(o => (o.markdown && o.markdown.trim()) || o.imageAssetId);
        this.renderer.previewSet(this.step, visible, assets);
    }

    private _close(save: boolean): void {
        this._disposeAllMde();
        this.renderer.previewClear();
        if (save) this._commit();
        this.modal?.close();
        this.modal = undefined;
    }

    private _commit(): void {
        // 1. Drop empty cards.
        const finalDraft: RecorderCompositeOverlay[] = this.draft
            .filter(o => (o.markdown && o.markdown.trim()) || o.imageAssetId)
            .map(o => ({
                id: o.id,
                kind: "composite",
                placement: { ...o.placement },
                style: o.style ? { ...o.style } : undefined,
                markdown: o.markdown?.trim() || undefined,
                imageAssetId: o.imageAssetId,
                imageAlt: o.imageAlt,
            }));

        // 2. Promote draft assets that the final draft still references.
        const stillReferenced = new Set<string>();
        for (const o of finalDraft) if (o.imageAssetId) stillReferenced.add(o.imageAssetId);
        for (const id of stillReferenced) {
            const draft = this.draftAssets.get(id);
            if (draft && !this.recorder.getAsset(id)) this.recorder.putAsset({ ...draft });
        }

        // 3. Delete assets the user removed (and that no overlay still uses).
        for (const id of this.deletedAssetIds) {
            if (!stillReferenced.has(id)) this.recorder.deleteAsset(id);
        }

        // 4. Preserve any audio overlays that lived on the step but the
        // editor doesn't surface yet (Phase B).
        const preservedAudio = (this.step.overlays ?? []).filter(o => o.kind === "audio");

        this.recorder.updateStep(this.step.id, (s) => {
            s.overlays = [...finalDraft, ...preservedAudio];
        });
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private _fileToBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                if (typeof result !== "string") { reject(new Error("FileReader returned non-string")); return; }
                const comma = result.indexOf(",");
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
            reader.readAsDataURL(file);
        });
    }

    private _fmtSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    private _disposeAllMde(): void {
        for (const mde of this.mdeInstances.values()) {
            try { mde.toTextArea(); } catch { /* */ }
        }
        this.mdeInstances.clear();
    }
}
