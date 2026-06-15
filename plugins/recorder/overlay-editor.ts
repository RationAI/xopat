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
        const body = document.createElement("div");
        body.className = "flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1";

        const toolbar = document.createElement("div");
        toolbar.className = "flex items-center gap-2";
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn btn-sm btn-primary";
        addBtn.innerHTML = `<span class="ph-light ph-plus"></span> Add overlay`;
        addBtn.onclick = () => this._addCard();
        const hint = document.createElement("span");
        hint.className = "text-xs opacity-60";
        hint.textContent = "Each overlay pins to one corner of the viewer. Use text, image, or both.";
        toolbar.append(addBtn, hint);

        this.listEl = document.createElement("div");
        this.listEl.className = "flex flex-col gap-2";
        this._renderAllCards();

        body.append(toolbar, this.listEl);

        const footer = document.createElement("div");
        footer.className = "flex w-full justify-end gap-2";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "btn btn-ghost";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick = () => this._close(false);

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "btn btn-primary";
        saveBtn.textContent = "Save";
        saveBtn.onclick = () => this._close(true);

        footer.append(cancelBtn, saveBtn);

        this.modal = new UI.Modal({
            id: `recorder-overlay-editor-${this.step.id}`,
            header: `Overlays — step ${this.step.id.slice(0, 6)}`,
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
        this._disposeAllMde();
        this.listEl.innerHTML = "";
        if (this.draft.length === 0) {
            const empty = document.createElement("div");
            empty.className = "text-xs opacity-60 italic px-1";
            empty.textContent = "No overlays yet. Click \"Add overlay\" to create one.";
            this.listEl.appendChild(empty);
            return;
        }
        for (const overlay of this.draft) {
            this.listEl.appendChild(this._buildCard(overlay));
        }
    }

    private _buildCard(overlay: RecorderCompositeOverlay): HTMLElement {
        const card = document.createElement("div");
        card.className = "border border-base-300 rounded-md p-3 bg-base-100";
        card.dataset.overlayId = overlay.id;

        // Header: compact anchor picker on the left, delete on the right.
        // `flex-wrap` keeps the layout single-row when there's room and stacks
        // on narrow modals.
        const header = document.createElement("div");
        header.className = "flex flex-wrap items-center gap-2 mb-2";

        const anchorWrap = document.createElement("div");
        anchorWrap.className = "flex items-center gap-1.5";
        const anchorLabel = document.createElement("span");
        anchorLabel.className = "text-[10px] uppercase tracking-wide opacity-60";
        anchorLabel.textContent = "Anchor";
        anchorWrap.append(anchorLabel, createAnchorGrid({
            value: overlay.placement.anchor,
            onChange: (next) => { overlay.placement.anchor = next; this._syncPreview(); },
        }));

        const spacer = document.createElement("div");
        spacer.className = "flex-1 min-w-0";

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-ghost btn-xs btn-square text-error";
        delBtn.title = "Remove overlay";
        delBtn.innerHTML = `<span class="ph-light ph-x"></span>`;
        delBtn.onclick = () => this._removeOverlay(overlay.id);

        header.append(anchorWrap, spacer, delBtn);
        card.appendChild(header);

        // Body: image picker on the left, markdown editor on the right.
        const grid = document.createElement("div");
        grid.className = "grid grid-cols-3 gap-3";

        const imageCell = document.createElement("div");
        imageCell.className = "col-span-1";
        imageCell.appendChild(this._buildImagePicker(overlay));

        const textCell = document.createElement("div");
        textCell.className = "col-span-2 min-w-0";
        textCell.appendChild(this._buildTextEditor(overlay));

        grid.append(imageCell, textCell);
        card.appendChild(grid);
        return card;
    }

    // ── Image picker ─────────────────────────────────────────────────────

    private _buildImagePicker(overlay: RecorderCompositeOverlay): HTMLElement {
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";

        const previewBox = document.createElement("div");
        previewBox.className = "flex items-center justify-center h-32 bg-base-200 rounded";
        const thumb = document.createElement("img");
        thumb.alt = "image preview";
        thumb.style.maxHeight = "120px";
        thumb.style.maxWidth = "100%";
        thumb.style.objectFit = "contain";
        const noImg = document.createElement("span");
        noImg.className = "text-xs opacity-60 italic px-2 text-center";
        noImg.textContent = "No image. Pick one to add to this overlay.";
        previewBox.append(thumb, noImg);

        const showPreview = () => {
            const asset = overlay.imageAssetId ? this._resolveAsset(overlay.imageAssetId) : undefined;
            if (asset) {
                thumb.src = `data:${asset.mimeType};base64,${asset.data}`;
                thumb.style.display = "";
                noImg.style.display = "none";
            } else {
                thumb.style.display = "none";
                noImg.style.display = "";
            }
        };
        showPreview();

        const controls = document.createElement("div");
        controls.className = "flex gap-1";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.className = "file-input file-input-bordered file-input-xs flex-1";
        fileInput.onchange = async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            if (file.size > IMAGE_BLOCK_BYTES) {
                Dialogs.show(`Image too large (${this._fmtSize(file.size)} > ${this._fmtSize(IMAGE_BLOCK_BYTES)}); not added.`, 3000, Dialogs.MSG_ERR);
                fileInput.value = "";
                return;
            }
            if (file.size > IMAGE_WARN_BYTES) {
                Dialogs.show(`Large image (${this._fmtSize(file.size)}) will bloat the recorder bundle.`, 2500, Dialogs.MSG_WARN);
            }
            const base64 = await this._fileToBase64(file);
            if (overlay.imageAssetId) this._markAssetDeleted(overlay.imageAssetId);
            const id = newAssetId();
            this.draftAssets.set(id, { id, kind: "image", mimeType: file.type || "image/png", data: base64, size: file.size, createdAt: Date.now() });
            overlay.imageAssetId = id;
            if (!overlay.imageAlt) overlay.imageAlt = file.name;
            showPreview();
            this._syncPreview();
        };

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "btn btn-xs btn-ghost";
        clearBtn.title = "Remove image";
        clearBtn.innerHTML = `<span class="ph-light ph-trash"></span>`;
        clearBtn.onclick = () => {
            if (!overlay.imageAssetId) return;
            this._markAssetDeleted(overlay.imageAssetId);
            overlay.imageAssetId = undefined;
            overlay.imageAlt = undefined;
            fileInput.value = "";
            showPreview();
            this._syncPreview();
        };

        controls.append(fileInput, clearBtn);

        const altInput = document.createElement("input");
        altInput.type = "text";
        altInput.className = "input input-bordered input-xs w-full";
        altInput.placeholder = "Alt text (optional)";
        altInput.value = overlay.imageAlt || "";
        altInput.oninput = () => { overlay.imageAlt = altInput.value; };

        wrap.append(previewBox, controls, altInput);
        return wrap;
    }

    // ── Markdown editor ──────────────────────────────────────────────────

    private _buildTextEditor(overlay: RecorderCompositeOverlay): HTMLElement {
        const wrap = document.createElement("div");
        const ta = document.createElement("textarea");
        ta.value = overlay.markdown || "";
        wrap.appendChild(ta);
        queueMicrotask(() => {
            const mde = new EasyMDE({
                element: ta,
                spellChecker: false,
                status: false,
                minHeight: "120px",
                autofocus: false,
                placeholder: "Markdown supported — bold, italic, headings, lists, links",
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
        if (removed.imageAssetId) this._markAssetDeleted(removed.imageAssetId);
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
