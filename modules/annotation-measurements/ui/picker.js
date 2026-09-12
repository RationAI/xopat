(function (global) {
    'use strict';

    /**
     * Canvas picking for measurement operands.
     *
     * The user knows the region on the slide, not its increment id, so an operand
     * is chosen by clicking it on the canvas — never from a list. The mechanism is
     * deliberately thin: it does not hit-test anything of its own. It *routes* the
     * annotations module's own `annotation-selection-changed` event, so picking
     * inherits mode locks, per-viewer correctness and the existing visual feedback
     * for free.
     *
     *   picker.arm('B', op => ...)   // next canvas selection lands in slot B
     *   picker.consume(event)        // true when the event was a pick, not a selection
     *
     * A pick is a transient gesture, not a selection change: the canvas selection
     * that was in place when the slot was armed is put back once the pick lands,
     * so the panel's subject (and operand A, which follows the selection) never
     * silently turns into the thing that was just picked for B.
     *
     * Set-valued operands (a whole class, "all") have no canvas identity and are
     * the only thing still chosen from a menu.
     */
    const NS = global.AnnotationMeasurements = global.AnnotationMeasurements || {};
    const UI_NS = NS.ui = NS.ui || {};

    /** @typedef {{kind: 'annotation', object: object}
     *          | {kind: 'list', objects: object[], label?: string}
     *          | {kind: 'class', presetID: any}
     *          | {kind: 'all'}} Operand */

    class CanvasPicker {
        /**
         * @param {object} options
         * @param {OSDAnnotations} options.annotations
         * @param {function(string, object=): string} options.t translator
         * @param {function(boolean): void} [options.onArmedChange] armed-state notifier
         * @param {function(): {fabric: object, objects: object[]}|null} [options.snapshot]
         *   the canvas selection to put back after a pick lands; taken when a slot is armed
         */
        constructor({ annotations, t, onArmedChange, snapshot } = {}) {
            this.annotations = annotations;
            this.t = t || ((k) => k);
            this.onArmedChange = onArmedChange || (() => {});
            this.snapshot = snapshot || (() => null);
            this._slot = null;
            this._resolve = null;
            this._keyHandler = null;
            this._restore = null;
        }

        get armedSlot() { return this._slot; }
        isArmed(slot) { return slot === undefined ? this._slot !== null : this._slot === slot; }

        /**
         * Arm a slot. The next canvas-originated selection is delivered to
         * `onPicked` instead of being treated as a subject change. Re-arming the
         * same slot disarms it, so the button is a toggle.
         *
         * `restoreSelection: false` keeps the pick's own selection — for a slot
         * whose purpose IS to select (the panel's empty-state "pick a subject").
         */
        arm(slot, onPicked, { restoreSelection = true } = {}) {
            if (this._slot === slot) { this.disarm(); return; }
            this._slot = slot;
            this._resolve = onPicked;
            this._restore = restoreSelection ? (this.snapshot() || null) : undefined;
            // Escape cancels. Contextual key inside a widget — stays local rather
            // than entering the shortcut registry (AGENTS.md §2).
            this._keyHandler = (e) => { if (e.key === 'Escape') this.disarm(); };
            document.addEventListener('keydown', this._keyHandler, true);
            this.onArmedChange(true);
        }

        disarm() {
            if (this._slot === null) return;
            this._slot = null;
            this._resolve = null;
            this._restore = null;
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }
            this.onArmedChange(false);
        }

        /**
         * Offer a selection event to the armed slot.
         * @return {boolean} true when the event was consumed as a pick — the caller
         *   must then NOT also treat it as a subject change.
         */
        consume(event) {
            if (this._slot === null || !event?.fromCanvas) return false;
            const picked = (event.selected || []).filter(Boolean).pop();
            if (!picked) return false;
            const resolve = this._resolve;
            const slot = this._slot;
            const restore = this._restore;
            this.disarm();
            resolve?.({ kind: 'annotation', object: picked }, slot);

            // Put the pre-pick selection back (unless the slot opted out). The pick
            // landed on `pickedFabric`; when that is not where the snapshot lives,
            // the pick's own selection is cleared there so it does not linger as a
            // second, unrelated cue.
            if (restore === undefined) return true;
            const pickedFabric = fabricFor(this.annotations, picked);
            if (restore?.fabric) {
                if (pickedFabric && pickedFabric !== restore.fabric) pickedFabric.clearAnnotationSelection?.(false);
                applySelection(restore.fabric, restore.objects);
            } else if (pickedFabric) {
                pickedFabric.clearAnnotationSelection?.(false);
            }
            return true;
        }
    }

    // ─── operand description ────────────────────────────────────────────────

    /**
     * Label + swatch colour for any operand kind. Returns the "pick me" prompt
     * for an empty slot, so callers never branch on null.
     */
    function describeOperand(annotations, operand, t) {
        const format = UI_NS.format;
        if (!operand) return { label: t('pickHint'), color: '', empty: true };
        switch (operand.kind) {
            case 'annotation':
                return {
                    label: format.annotationLabel(annotations, operand.object, t),
                    color: format.presetColor(annotations, operand.object?.presetID),
                    empty: false,
                };
            case 'list': {
                const objects = (operand.objects || []).filter(Boolean);
                const first = objects[0];
                if (objects.length === 1) {
                    return {
                        label: format.annotationLabel(annotations, first, t),
                        color: format.presetColor(annotations, first?.presetID),
                        empty: false,
                    };
                }
                return {
                    label: t('listSet', {
                        name: operand.label || format.presetName(annotations, first?.presetID, t),
                        count: objects.length,
                    }),
                    color: format.presetColor(annotations, first?.presetID),
                    empty: !objects.length,
                };
            }
            case 'class':
                return {
                    label: t('classSet', { name: format.presetName(annotations, operand.presetID, t) }),
                    color: format.presetColor(annotations, operand.presetID),
                    empty: false,
                };
            case 'all':
                return { label: t('allAnnotations'), color: '', empty: false };
            default:
                return { label: t('pickHint'), color: '', empty: true };
        }
    }

    /**
     * The annotation objects an operand stands for, resolved against a viewer.
     *
     * Object-valued operands are filtered to what is still on a canvas: an
     * annotation deleted after it was picked must fall out of the comparison
     * rather than keep contributing a ghost's area.
     *
     * A derived tissue mask lands as a `list` of the islands that survived
     * pruning, nearest first — a concrete set the user just made, unlike `class`
     * which re-resolves against whatever the class holds at render time.
     */
    function operandObjects(annotations, viewer, operand) {
        const format = UI_NS.format;
        if (!operand) return [];
        switch (operand.kind) {
            case 'annotation': return [operand.object].filter((o) => isLive(annotations, o));
            case 'list': return (operand.objects || []).filter((o) => isLive(annotations, o));
            case 'class': return format.annotationsIn(annotations, viewer)
                .filter((o) => String(o.presetID) === String(operand.presetID));
            case 'all': return format.annotationsIn(annotations, viewer);
            default: return [];
        }
    }

    /**
     * Drop the dead members of an object-valued operand. Returns the operand
     * unchanged when nothing changed, `null` when nothing is left, so a caller
     * can tell "still valid" from "must be cleared" by identity.
     */
    function pruneOperand(annotations, operand) {
        if (!operand) return null;
        if (operand.kind === 'annotation') {
            return isLive(annotations, operand.object) ? operand : null;
        }
        if (operand.kind === 'list') {
            const live = (operand.objects || []).filter((o) => isLive(annotations, o));
            if (!live.length) return null;
            return live.length === operand.objects.length ? operand : { ...operand, objects: live };
        }
        return operand;
    }

    // ─── canvas feedback ────────────────────────────────────────────────────

    /**
     * Is `object` still on some annotation canvas? Strict, unlike
     * `format.viewerOf`, which falls back to the active viewer for an unknown
     * object — the right default for measuring, the wrong one for drawing a
     * highlight of something that was deleted.
     */
    function isLive(annotations, object) {
        if (!object) return false;
        const wrappers = global.OSDAnnotations?.FabricWrapper?.instances?.() || [];
        for (const w of wrappers) {
            const canvas = w?.canvas;
            if (!canvas) continue;
            if (typeof canvas.contains === 'function' ? canvas.contains(object) : (canvas.getObjects?.() || []).includes(object)) {
                return true;
            }
        }
        return false;
    }

    /** The fabric wrapper owning `object`, or null when it is on no canvas. */
    function fabricFor(annotations, object) {
        if (!isLive(annotations, object)) return null;
        const viewer = UI_NS.format.viewerOf(annotations, object);
        return viewer ? annotations?.getFabric?.(viewer) : null;
    }

    /**
     * Transiently highlight `object`. The highlight is a single-slot helper
     * annotation, so leaving must restore whatever the *selection* was showing —
     * otherwise hovering a row silently drops the selected annotation's cue.
     */
    function hoverHighlight(annotations, object, on) {
        const fabric = fabricFor(annotations, object);
        if (!fabric) return;
        if (on) {
            fabric.highlightAnnotation(object);
            return;
        }
        const selected = (fabric.getSelectedAnnotations?.() || []).filter(Boolean);
        const last = selected[selected.length - 1];
        if (last) fabric.highlightAnnotation(last);
        else fabric.removeHighlight();
    }

    /** Bring `object` into view in its own viewer. */
    function focusAnnotation(annotations, object) {
        fabricFor(annotations, object)?.focusObjectOrArea?.(object, object?.incrementId);
    }

    /**
     * Bring a whole set into view: the union of the members' focus boxes, in the
     * viewer of the first live member. One member behaves like `focusAnnotation`
     * (which also highlights it).
     */
    function focusObjects(annotations, objects) {
        const live = (objects || []).filter((o) => isLive(annotations, o));
        if (!live.length) return;
        if (live.length === 1) { focusAnnotation(annotations, live[0]); return; }
        const fabric = fabricFor(annotations, live[0]);
        if (!fabric?.focusArea) return;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const o of live) {
            const b = fabric.getFocusBBox?.(o);
            if (!b) continue;
            const l = Number(b.left ?? b.x), t = Number(b.top ?? b.y);
            if (!Number.isFinite(l) || !Number.isFinite(t)) continue;
            left = Math.min(left, l);
            top = Math.min(top, t);
            right = Math.max(right, l + (Number(b.width) || 0));
            bottom = Math.max(bottom, t + (Number(b.height) || 0));
        }
        if (!Number.isFinite(left) || !Number.isFinite(top)) return;
        fabric.focusArea({ left, top, width: right - left, height: bottom - top });
    }

    /** Make `object` the canvas selection (and therefore the panel subject). */
    function selectAnnotation(annotations, object, clearPrevious = true) {
        fabricFor(annotations, object)?.selectAnnotation?.(object, false, clearPrevious);
    }

    /**
     * Make exactly `objects` the selection of `fabric` (programmatic, not
     * `fromCanvas`). Dead members are skipped; an empty set clears the selection.
     */
    function applySelection(fabric, objects) {
        if (!fabric) return;
        const live = (objects || []).filter((o) => o && fabric.canvas?.contains?.(o) !== false);
        if (!live.length) {
            fabric.clearAnnotationSelection?.(false);
            return;
        }
        live.forEach((o, i) => fabric.selectAnnotation?.(o, false, i === 0));
    }

    // ─── chip ───────────────────────────────────────────────────────────────

    /**
     * One operand chip: swatch + label, with a pick toggle, an optional menu for
     * the set-valued kinds, and a clear button. Returns an imperative handle
     * rather than a van derivation — the chip mutates a handful of attributes in
     * place, which avoids swapping the subtree (and the listeners on it) on every
     * operand change.
     *
     * Every non-empty operand is hoverable and focusable, not only a single
     * annotation: a set highlights its first member (the highlight is one slot)
     * and focuses the union of its members. `viewer` resolves the set-valued
     * kinds, which have no canvas identity of their own.
     *
     * @return {{node: HTMLElement, set: function(Operand=): void, setArmed: function(boolean): void}}
     */
    function operandChip({ annotations, t, slot, picker, onChange, onMenu, viewer, allowClear = true }) {
        const { div, span, button } = global.van.tags;

        const swatch = span({ class: 'w-2 h-2 rounded-full shrink-0 opacity-0' });
        const label = span({ class: 'truncate' }, '');
        const pickBtn = button({
            type: 'button',
            class: 'btn btn-xs btn-ghost px-1',
            title: t('pickTooltip'),
            onclick: (e) => {
                e.stopPropagation();
                picker.arm(slot, (operand) => onChange?.(operand));
            },
        }, span({ class: 'ph-light ph-crosshair-simple' }));

        const menuBtn = onMenu ? button({
            type: 'button',
            class: 'btn btn-xs btn-ghost px-1',
            title: t('otherOperands'),
            onclick: (e) => { e.stopPropagation(); onMenu(e); },
        }, span({ class: 'ph-light ph-caret-down' })) : null;

        const clearBtn = allowClear ? button({
            type: 'button',
            class: 'btn btn-xs btn-ghost px-1 hidden',
            title: t('clearOperand'),
            onclick: (e) => { e.stopPropagation(); onChange?.(null); },
        }, span({ class: 'ph-light ph-x' })) : null;

        let current = null;
        const members = () => operandObjects(annotations, viewer?.() || annotations?.viewer || null, current);

        const body = div({
            class: 'flex items-center gap-1 min-w-0 flex-1 cursor-pointer',
            onmouseenter: () => { const m = members(); if (m.length) hoverHighlight(annotations, m[0], true); },
            onmouseleave: () => { const m = members(); if (m.length) hoverHighlight(annotations, m[0], false); },
            onclick: () => focusObjects(annotations, members()),
        }, swatch, label);

        // No `flex-1`: the chip is placed in an explicit grid track by the caller, which
        // owns its width. `min-w-0` stays so the label can actually truncate.
        const node = div(
            { class: 'flex items-center gap-1 px-1 py-0.5 rounded border border-base-300 bg-base-100 min-w-0' },
            pickBtn, body, ...(menuBtn ? [menuBtn] : []), ...(clearBtn ? [clearBtn] : []),
        );

        function set(operand) {
            current = operand || null;
            const desc = describeOperand(annotations, current, t);
            label.textContent = desc.label;
            label.classList.toggle('opacity-60', !!desc.empty);
            swatch.style.background = desc.color || '';
            swatch.classList.toggle('opacity-0', !desc.color);
            body.classList.toggle('cursor-pointer', !!current && !desc.empty);
            clearBtn?.classList.toggle('hidden', !current);
        }

        function setArmed(armed) {
            node.classList.toggle('ring-1', armed);
            node.classList.toggle('ring-primary', armed);
            pickBtn.classList.toggle('btn-active', armed);
            if (armed) label.textContent = t('pickArmed');
            else set(current);
        }

        set(null);
        return { node, set, setArmed };
    }

    UI_NS.picker = {
        CanvasPicker,
        describeOperand,
        operandObjects,
        pruneOperand,
        isLive,
        hoverHighlight,
        focusAnnotation,
        focusObjects,
        selectAnnotation,
        applySelection,
        operandChip,
    };
})(typeof window !== 'undefined' ? window : globalThis);
