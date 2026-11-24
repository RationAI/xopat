import { PresetCard } from '../components/presetCard.mjs';
import { PresetBindList } from '../components/presetBindList.mjs';

const { div, span, input, select, option, button, i, b, a, br, h4 } = globalThis.van.tags;

function iconNode(icon, extraClass = '', style = '') {
    const cls = `ph-light ${icon ?? ''} ${extraClass}`;
    return i({ class: cls.trim(), style });
}

function textNode(value) {
    return document.createTextNode(value ?? '');
}

export const presetMethods = {
    updatePresetEvent() {
        this.updatePresetsHTML();
    },

    /**
     * Is class creation constrained to a server-provided list right now?
     * @return {object|undefined} the active vocabulary, or undefined when free
     */
    _lockedVocabulary() {
        const vocabulary = this.context.presets.vocabulary;
        return vocabulary && !vocabulary.allowFreeform ? vocabulary : undefined;
    },

    /**
     * Which fields of a card the destination owns.
     *
     * Only presets that actually carry a vocabulary class are locked: an
     * unclassified preset is the user's own scratch class and stays editable, and
     * a preset predating the vocabulary must not become uneditable retroactively.
     */
    _presetCardLock(preset) {
        const vocabulary = this._lockedVocabulary();
        if (!vocabulary) return undefined;
        if (!this.context.presets.classValueOf(preset)) return undefined;
        return {
            metaKeys: new Set([vocabulary.metaKey]),
            title: true,
            reason: this.t('annotations.presets.vocabularyLocked'),
        };
    },

    _setContainerContent(target, ...children) {
        if (!target) return;
        target.replaceChildren(...children.flat().filter(Boolean));
    },

    _normalizeDomLike(item) {
        if (item == null || item === false) return [];
        if (Array.isArray(item)) return item.flatMap(x => this._normalizeDomLike(x));
        if (item instanceof Node) return [item];
        if (item?.create && typeof item.create === 'function') {
            try { return [item.create()]; } catch {}
        }
        if (typeof item === 'string') {
            // Route strings through the core builder: it sanitizes markup (when
            // the sanitizer is loaded) and otherwise renders as plain text, so a
            // string contributed by a `render-annotation-presets` listener can
            // never inject raw HTML here.
            const node = UI?.BaseComponent?.toNode?.(item);
            return node ? [node] : [span(item)];
        }
        return [span(String(item))];
    },

    /**
     * Expand one card of the class editor (and collapse the others). Purely
     * about which editor is open: binding a class to a mouse button is done by
     * the card's own bind buttons.
     */
    _selectPresetCard(presetId, sourceCard) {
        if (!this._presetCards) return;
        const next = this._presetSelection === presetId ? undefined : presetId;
        for (const [id, card] of this._presetCards) {
            card.setSelected(id === next);
        }
        this._presetSelection = next;
    },

    /** Repaint every class-binding surface that is not rebuilt per viewer. */
    updatePresetsHTML() {
        this._refreshPresetSwatch?.();
        // The class editor stays open across a binding change.
        if (this._presetCards) {
            const leftId = this.context.getPreset(true)?.presetID;
            const rightId = this.context.getPreset(false)?.presetID;
            for (const [id, card] of this._presetCards) card.setBound?.(id === leftId, id === rightId);
        }
    },

    /** Name a class is shown under, everywhere. */
    _presetDisplayName(preset) {
        return preset?.getMetaValue?.('category') || this.t('annotations.presets.unnamed');
    },

    /**
     * The one class picker (see {@link PresetBindList}), fed from current state.
     * @param {object} [opts]
     * @param {string} [opts.maxHeight]
     * @param {Node} [opts.empty]
     * @return {Node}
     */
    _buildPresetBindList({ maxHeight, empty } = {}) {
        const rows = [];
        let slot = 0;
        this.context.presets.foreach((preset) => {
            rows.push({
                id: preset.presetID,
                name: this._presetDisplayName(preset),
                color: preset.color,
                // Key bound to this class's slot (see classSlots.mjs), if any.
                slotKey: this._classSlotLabel?.(slot++),
                dimmed: this.isUnpreferredPreset(preset.presetID),
            });
        });
        return new PresetBindList({
            rows,
            leftId: this.context.getPreset(true)?.presetID,
            rightId: this.context.getPreset(false)?.presetID,
            disabled: !!this.context.disabledInteraction,
            maxHeight,
            empty,
            t: (key) => this.t(key),
            onBind: (id, isLeft, explicit) => this._bindPreset(id, isLeft, { toggle: explicit }),
        }).create();
    },

    /**
     * Bind a class to a mouse button.
     * @param {string} presetId
     * @param {boolean} isLeft
     * @param {object} [opts]
     * @param {boolean} [opts.toggle=false] release the binding when the class is
     *   already bound to that button; without it such a call is a no-op, so a
     *   plain click on the active class never unbinds it by accident
     * @return {boolean} whether the binding changed
     */
    _bindPreset(presetId, isLeft, { toggle = false } = {}) {
        if (this.context.disabledInteraction) return false;
        if (presetId === undefined || presetId === null) return false;
        const preset = this.context.presets.get(presetId);
        if (!preset) return false;
        const bound = this.context.getPreset(isLeft)?.presetID === preset.presetID;
        if (bound && !toggle) return false;
        this.context.setPreset(bound ? undefined : preset, isLeft);
        return true;
    },

    /**
     * Build the annotation toolbar's preset swatch: a single ToolbarPanelButton
     * whose icon shows two mouse glyphs tinted by the active left/right presets.
     * Clicking opens a compact picker where a left-click binds a class to the
     * left mouse button and a right-click binds it to the right button. Colours
     * and rows stay in sync via {@link _refreshPresetSwatch}.
     * @return {ToolbarPanelButton}
     */
    buildPresetSwatchToolbarButton() {
        const leftIconId = `${this.id}-swatch-l`;
        const rightIconId = `${this.id}-swatch-r`;
        this._presetSwatchIconIds = { left: leftIconId, right: rightIconId };

        // Van nodes with stable ids; colours are applied later via
        // element.style.color (DOM API) so a user-supplied preset colour is
        // never interpolated into markup.
        this._presetSwatchIcon = span({ class: "inline-flex items-center gap-0.5"},
            i({id:`${leftIconId}`, class: "ph-light ph-mouse-left-click text-sm"}),
            i({id: `${rightIconId}`, class: "ph-light ph-mouse-right-click text-sm"})
        );

        this._presetSwatchPanel = div({ class: 'flex flex-col w-56 bg-base-200' });

        this._presetSwatchButton = new UI.ToolbarPanelButton({
            id: `${this.id}-preset-swatch`,
            itemID: 'preset-swatch',
            icon: this._presetSwatchIcon,
            label: this.t('annotations.toolbar.presetSwatch'),
            onOpen: () => this._renderPresetSwatchPanel()
        }, this._presetSwatchPanel);

        // Initial paint once the icon/panel nodes exist in the DOM.
        queueMicrotask(() => this._refreshPresetSwatch());
        return this._presetSwatchButton;
    },

    /** Tint the two toolbar mouse glyphs from the active left/right presets. */
    _renderPresetSwatchIcon() {
        const ids = this._presetSwatchIconIds;
        if (!ids) return;
        const muted = 'var(--fallback-bc, #9ca3af)';
        const paint = (elId, preset) => {
            const el = document.getElementById(elId);
            if (el) {
                el.style.color = preset?.color || muted;
                el.style.opacity = preset ? '1' : '0.5';
            }
        };
        paint(ids.left, this.context.getPreset(true));
        paint(ids.right, this.context.getPreset(false));
    },

    /** Rebuild the swatch picker rows (one per preset + an edit shortcut). */
    _renderPresetSwatchPanel() {
        const panel = this._presetSwatchPanel;
        if (!panel) return;

        const header = div({ class: 'flex items-center justify-between px-1 pb-1.5' },
            span({ class: 'text-[11px] font-semibold uppercase tracking-wide opacity-50' },
                this.t('annotations.toolbar.presetSwatchTitle'))
        );

        const editLink = button({
                class: 'btn btn-ghost btn-xs justify-center gap-1 normal-case font-normal opacity-70 hover:opacity-100 mt-1 pt-1 border-t border-base-300 rounded-none',
                onclick: () => {
                    this._presetSwatchButton?.close?.();
                    this.showPresets();
                }
            },
            iconNode('ph-pencil-simple', 'text-xs'),
            this.t('annotations.toolbar.editPresets')
        );

        // Same list as the side panel's "Classes" section.
        panel.replaceChildren(
            header,
            this._buildPresetBindList({
                maxHeight: '240px',
                empty: div({ class: 'text-xs opacity-50 text-center py-3' }, this.t('annotations.toolbar.noPresets')),
            }),
            editLink
        );
    },

    /** Keep the toolbar swatch (icon + open panel) in sync with preset state. */
    _refreshPresetSwatch() {
        if (!this._presetSwatchButton) return;
        this._renderPresetSwatchIcon();
        if (this._presetSwatchButton.isOpen?.()) this._renderPresetSwatchPanel();
    },

    getPresetHTMLById(id, isLeftClick, index = undefined) {
        const preset = this.context.presets.get(id);
        if (!preset) return undefined;
        return this.getPresetHTML(preset);
    },

    _metaFieldHtml(presetId, key, metaObject, allowDelete = true, classes = '') {
        const container = div({ class: 'relative group/meta' });

        const inputNode = input({
            class: `input input-bordered focus:input-primary transition-all ${classes}`.trim(),
            placeholder: metaObject.name || 'Value...',
            type: 'text',
            value: metaObject.value,
            disabled: !this.enablePresetModify,
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => this.updatePresetWith(presetId, key, e.target.value)
        });

        container.appendChild(inputNode);

        if (allowDelete && this.enablePresetModify) {
            container.appendChild(button({
                class: 'btn btn-ghost btn-xs btn-square absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/meta:opacity-100 text-error',
                onclick: (e) => { e.stopPropagation(); this.deletePresetMeta(e.currentTarget, presetId, key); }
            }, iconNode('ph-trash', 'text-[10px]')));
        }

        return container;
    },

    getPresetHTML(preset, defaultPreset = undefined) {
        const isSelected = preset.presetID === defaultPreset?.presetID;
        if (isSelected) this._presetSelection = preset.presetID;

        const card = new PresetCard({
            preset,
            isSelected,
            enableModify: this.enablePresetModify,
            lock: this._presetCardLock(preset),
            bound: {
                left: this.context.getPreset(true)?.presetID === preset.presetID,
                right: this.context.getPreset(false)?.presetID === preset.presetID,
            },
            t: (key) => this.t(key),
            callbacks: {
                onBind: (id, isLeft) => this._bindPreset(id, isLeft, { toggle: true }),
                onSelect: (id) => this._selectPresetCard(id),
                onDelete: (id, instance) => this._removePresetCard(id, instance),
                onColorChange: (id, value) => this.updatePresetWith(id, 'color', value),
                onMetaChange: (id, key, value) => this.updatePresetWith(id, key, value),
                onMetaDelete: (id, key, rowEl) => this._deleteMetaField(id, key, rowEl),
                onMetaAdd: (id, name) => this._addMetaField(id, name),
            },
        });

        if (!this._presetCards) this._presetCards = new Map();
        this._presetCards.set(preset.presetID, card);
        return card.create();
    },

    removePreset(buttonNode, presetId) {
        if (!this.enablePresetModify) return;
        this._removePresetCard(presetId, undefined, buttonNode?.closest('[data-preset-id]'));
    },

    _removePresetCard(presetId, instance, fallbackEl) {
        if (!this.enablePresetModify) return;
        const removed = this.context.presets.removePreset(presetId);
        if (removed) {
            const node = instance?.root || fallbackEl || this._presetCards?.get(presetId)?.root;
            node?.remove();
            this._presetCards?.delete(presetId);
            this._updatePresetEmptyState();
            return;
        }
        if (removed === false) {
            console.warn('Failed to remove preset', presetId);
            Dialogs.show(this.t('annotations.errors.presetRemoveFail'), 5000, Dialogs.MSG_ERR);
        }
    },

    _addMetaField(presetId, name) {
        if (!this.enablePresetModify) return null;
        const key = this.context.presets.addCustomMeta(presetId, name, '');
        if (!key) {
            Dialogs.show(this.t('annotations.errors.metaCreateFail', { name }), 2500, Dialogs.MSG_ERR);
            return null;
        }
        return this._metaFieldHtml(presetId, key, { name, value: '' }, true, 'input-xs w-full');
    },

    _deleteMetaField(presetId, key, rowEl) {
        if (!this.enablePresetModify) return;
        if (this.context.presets.deleteCustomMeta(presetId, key)) {
            rowEl?.remove();
            return;
        }
        Dialogs.show(this.t('annotations.errors.metaDeleteFail'), 2500, Dialogs.MSG_ERR);
    },

    _updatePresetEmptyState() {
        if (!this._presetCardsContainer) return;
        const empty = this._presetCardsContainer.parentElement?.querySelector?.('[data-preset-empty]');
        if (!empty) return;
        const hasAny = (this._presetCards?.size || 0) > 0;
        empty.classList.toggle('hidden', hasAny);
    },

    updatePresetWith(id, propName, value) {
        if (!this.enablePresetModify) return;
        // The preset's factory is a deprecated default, not editable from the UI:
        // the drawing shape is the toolbar's tool (context.setActiveFactory).
        if (propName === 'objectFactory') return;
        if (!this.context.presets.get(id)) return;

        // PresetManager.updatePreset writes the property and raises
        // preset-update only when something actually changed.
        this.context.presets.updatePreset(id, { [propName]: value });
        this.updatePresetEvent();
    },

    insertPresetMeta(buttonNode, presetId) {
        if (!this.enablePresetModify) return;
        const inputNode = buttonNode.previousElementSibling;
        const name = inputNode?.value?.trim();
        if (!name) {
            Dialogs.show(this.t('annotations.errors.metaNameRequired'), 2500, Dialogs.MSG_ERR);
            return;
        }

        const key = this.context.presets.addCustomMeta(presetId, name, '');
        if (key) {
            const newNode = this._metaFieldHtml(presetId, key, { name, value: '' });
            buttonNode.parentElement.before(newNode);
            inputNode.value = '';
            return;
        }
        Dialogs.show(this.t('annotations.errors.metaCreateFail', { name }), 2500, Dialogs.MSG_ERR);
    },

    deletePresetMeta(inputNode, presetId, key) {
        if (!this.enablePresetModify) return;
        if (this.context.presets.deleteCustomMeta(presetId, key)) {
            inputNode.parentElement.remove();
            return;
        }
        Dialogs.show(this.t('annotations.errors.metaDeleteFail'), 2500, Dialogs.MSG_ERR);
    },

    /**
     * The "add a class" affordance.
     *
     * With a locked vocabulary this is a picker over the classes the destination
     * declares, not a button that mints a blank one: a free-form class would be
     * refused by the `crud:preset` guard, and before the guard existed it was
     * silently dropped on the way upstream — the annotation stored, its
     * classification lost. Drawing *without* a class stays possible (that is
     * `allowUnclassified`); inventing one does not.
     */
    _createPresetAddControl(isLeftClick) {
        if (!this.enablePresetModify) return null;
        const vocabulary = this._lockedVocabulary();
        if (!vocabulary) {
            return button({
                    class: 'btn btn-primary btn-sm gap-1 shrink-0',
                    title: this.t('annotations.presets.addNew'),
                    onclick: (e) => this.createNewPreset(e.currentTarget, isLeftClick)
                },
                iconNode('ph-plus', 'text-xs'),
                span({ class: 'sm:inline' }, this.t('annotations.presets.addNew'))
            );
        }

        const available = this.context.presets.unusedVocabularyEntries();
        if (!available.length) {
            return span({
                class: 'text-xs opacity-60 shrink-0',
                title: this.t('annotations.presets.vocabularyLocked'),
            }, this.t('annotations.presets.vocabularyExhausted'));
        }

        const picker = new UI.Autocomplete({
            size: 'sm',
            allowClear: false,
            placeholder: this.t('annotations.presets.vocabularyPick'),
            options: available.map(entry => ({
                value: entry.value,
                label: entry.label,
                description: entry.description,
            })),
            onChange: (value) => {
                if (!value) return;
                this.createNewPreset(undefined, isLeftClick, value);
                // The chosen entry is no longer available; rebuilding the header
                // is what removes it from the list.
                this._refreshPresetAddControl(isLeftClick);
            },
        });
        this._presetAddPicker = picker;
        return div({ class: 'shrink-0 w-56' }, picker.create());
    },

    _refreshPresetAddControl(isLeftClick) {
        const host = this._presetAddControlHost;
        if (!host) return;
        // Autocomplete portals its panel to document.body and tracks its anchor
        // while open; `remove()` is what detaches both.
        this._presetAddPicker?.remove?.();
        this._presetAddPicker = undefined;
        const next = this._createPresetAddControl(isLeftClick);
        host.replaceChildren(...(next ? [next] : []));
    },

    _createPresetDialogHeader(isLeftClick) {
        const addBtn = div({ class: 'flex items-center shrink-0' },
            ...[this._createPresetAddControl(isLeftClick)].filter(Boolean));
        this._presetAddControlHost = addBtn;

        return div({ class: 'flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-3 pb-2' },
            div({ class: 'flex items-center gap-2' },
                iconNode('ph-tag', 'text-primary'),
                h4({ class: 'text-lg font-bold' }, this.t('annotations.presets.dialogTitle'))
            ),
            div({ class: 'flex items-center gap-2 w-full sm:w-auto' },
                div({ class: 'relative flex-1 sm:w-64' },
                    span({ class: 'absolute inset-y-0 left-0 flex items-center pl-3 opacity-50' },
                        iconNode('ph-magnifying-glass', 'text-xs')
                    ),
                    input({
                        id: 'preset-filter-select',
                        class: 'input input-bordered input-sm w-full pl-9 focus:input-primary',
                        type: 'text',
                        placeholder: this.t('annotations.presets.filterPlaceholder') || 'Filter classes...',
                        oninput: (e) => this._applyPresetFilter(e.target.value)
                    })
                ),
                addBtn
            )
        );
    },

    _createPresetEmptyState() {
        return div({
            'data-preset-empty': '',
            class: 'flex flex-col items-center justify-center gap-2 py-6 text-center text-base-content/60 hidden'
        },
            iconNode('ph-tag', 'text-2xl opacity-60'),
            span({ class: 'text-sm' },
                this.t('annotations.presets.emptyState') || 'No classes yet. Use "Add new class" below to create one.'
            )
        );
    },

    _createPresetNoResults() {
        return div({
            'data-preset-no-results': '',
            class: 'flex flex-col items-center justify-center gap-1 py-4 text-center text-base-content/60 hidden'
        },
            span({ class: 'text-sm' },
                this.t('annotations.presets.noFilterResults') || 'No classes match your filter.'
            )
        );
    },

    _createPresetDialogFooter() {
        return div({ class: 'flex justify-end items-center gap-2 w-full pt-3 mt-1 border-t border-base-300' },
            button({
                class: 'btn btn-primary btn-sm px-6',
                onclick: () => this._closePresetDialog()
            }, this.t('annotations.presets.finishEditing'))
        );
    },

    _applyPresetFilter(searchValue = '') {
        const search = String(searchValue || '').toLowerCase();
        const cards = this._presetCardsContainer?.querySelectorAll?.('[data-preset-id]');
        if (!cards) return;

        let visible = 0;
        cards.forEach((el) => {
            const meta = this.context.presets.get(el.dataset.presetId)?.meta || {};
            const value = String(meta.category?.value || '').toLowerCase();
            const collection = String(meta.collection?.name || '').toLowerCase();
            const shouldShow = !search
                || value.includes(search)
                || ('unknown'.includes(search) && !value)
                || collection.includes(search);
            el.classList.toggle('hidden', !shouldShow);
            if (shouldShow) visible++;
        });

        const hint = this._presetCardsContainer.parentElement?.querySelector?.('[data-preset-no-results]');
        if (hint) hint.classList.toggle('hidden', visible > 0 || cards.length === 0);
    },

    /**
     * Open the class editor. One dialog, whatever opened it: it edits classes,
     * and each card carries the same left/right bind buttons as the pickers.
     */
    showPresets() {
        if (this.context.disabledInteraction) {
            Dialogs.show(this.t('annotations.errors.annotationsDisabled'), 2500, Dialogs.MSG_WARN);
            return;
        }
        // Close any prior dialog first — _closePresetDialog clears the
        // card map and container refs, so it must run before we (re)build them.
        this._closePresetDialog();

        this._presetSelection = undefined;
        this._presetCards = new Map();

        const cardsContainer = div({
            class: 'flex flex-col gap-1 max-h-[60vh] overflow-y-auto pr-1'
        });
        this._presetCardsContainer = cardsContainer;

        const emptyState = this._createPresetEmptyState();
        const noResults = this._createPresetNoResults();

        const event = { presets: Array.from(this.context.presets._presets.values()) };
        this.raiseEvent('render-annotation-presets', event);

        for (const item of event.presets) {
            if (typeof item === 'string' || item instanceof Node || item?.create) {
                const nodes = this._normalizeDomLike(item);
                cardsContainer.append(...nodes);
            } else {
                cardsContainer.appendChild(this.getPresetHTML(item));
            }
        }

        if (this._presetCards.size === 0) emptyState.classList.remove('hidden');

        const body = div({ class: 'flex flex-col gap-2' },
            emptyState,
            cardsContainer,
            noResults
        );

        const header = this._createPresetDialogHeader();
        const footer = this._createPresetDialogFooter();

        const modal = new UI.Modal({
            header,
            body,
            footer,
            width: 'min(36rem, 92vw)',
            allowResize: true,
            allowClose: true,
            isBlocking: true,
        });
        modal.create().classList.add('preset-modify-dialog');
        document.body.appendChild(modal.root);
        modal.open();
        this._presetDialog = modal;
    },

    _closePresetDialog() {
        const dialog = this._presetDialog;
        if (dialog) {
            dialog.close?.();
            dialog.root?.remove?.();
        }
        this._presetDialog = null;
        this._presetCards = null;
        this._presetCardsContainer = null;
    },

    /**
     * Bind the class picked in a menu (`presetID`, or the pending
     * `_presetSelection`) to a mouse button. Never releases a binding.
     */
    _clickPresetSelect(isLeft, presetID = undefined) {
        this._bindPreset(presetID ?? this._presetSelection, isLeft);
        return false;
    },

    // `fabric` in the helpers below is the wrapper of the viewer the context menu
    // was opened for, and is required. `this.context.fabric` is the ACTIVE viewer's
    // wrapper — a different canvas whenever the menu comes from another viewport's
    // board, since side-menu clicks do not change the active viewer.
    _getMousePosition(e, fabric, checkBounds = true) {
        const viewer = fabric.viewer;
        const image = viewer.scalebar.getReferencedTiledImage() || viewer.world.getItemAt(0);
        if (!image) return { x: 0, y: 0 };
        const screen = new OpenSeadragon.Point(e.originalEvent.x, e.originalEvent.y);
        const { x, y } = image.windowToImageCoordinates(screen);
        const { x: maxX, y: maxY } = image.getContentSize();
        if (checkBounds && (x <= 0 || y <= 0 || x >= maxX || y >= maxY)) return false;
        return { x, y };
    },

    _copyAnnotation(mousePos, annotation) {
        // Anchor is the offset from the click position to the annotation's
        // own `left`/`top` (originX/Y space). Using `left`/`top` directly —
        // not `getBoundingRect()`'s bbox-min — keeps the math compatible
        // with originX='center' shapes like polygons, where bbox.left and
        // obj.left differ by half the width.
        this._copiedPos = { x: annotation.left - mousePos.x, y: annotation.top - mousePos.y };
        this._copiedAnnotation = annotation;
        this._copiedIsCopy = true;
    },

    _cutAnnotation(mousePos, annotation, fabric) {
        this._copiedPos = { x: annotation.left - mousePos.x, y: annotation.top - mousePos.y };
        this._copiedAnnotation = annotation;
        this._copiedIsCopy = false;
        this._deleteAnnotation(annotation, fabric);
    },

    _deleteAnnotation(annotation, fabric) {
        fabric.deleteObject(annotation);
    },

    _canPasteAnnotation(e, fabric, getMouseValue = false) {
        if (!this._copiedAnnotation) return null;
        const mousePos = this._getMousePosition(e, fabric);
        if (getMouseValue) return mousePos;
        return !!mousePos;
    },

    _pasteAnnotation(e, fabric) {
        const mousePos = this._canPasteAnnotation(e, fabric, true);
        if (!mousePos) {
            if (mousePos === false) Dialogs.show('Cannot paste annotation out of bounds', 5000, Dialogs.MSG_WARN);
            return;
        }

        const annotation = this._copiedAnnotation;
        const factory = annotation._factory();
        const copy = factory.copy(annotation);
        const targetLeft = mousePos.x + this._copiedPos.x;
        const targetTop = mousePos.y + this._copiedPos.y;
        factory.move(copy, targetLeft - copy.left, targetTop - copy.top);
        if (this._copiedIsCopy) delete copy.internalID;
        fabric.addAnnotation(copy);
        factory.renderAllControls(copy);
    },

    _clickAnnotationChangePreset(annotation, fabric) {
        if (this._presetSelection === undefined) {
            Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
            return false;
        }
        setTimeout(() => {
            this._closePresetDialog();
            fabric.changeAnnotationPreset(annotation, this._presetSelection);
        }, 150);
        return false;
    },

    _clickAnnotationMarkPrivate(annotation, fabric) {
        const newValue = !this._getAnnotationProps(annotation).private;
        fabric.setAnnotationPrivate(annotation, newValue);
    },

    _getAnnotationProps(annotation) {
        return { private: annotation.private };
    },

    /**
     * @param {Node} [buttonNode] insertion anchor when there is no card container
     * @param {boolean} isLeftClick which mouse button the dialog is editing
     * @param {string} [classValue] vocabulary class to bind; creates the preset and
     *   its class in one dispatch instead of a create followed by a meta update
     */
    createNewPreset(buttonNode, isLeftClick, classValue = undefined) {
        const preset = classValue !== undefined
            ? this.context.presets.addVocabularyPreset(classValue)
            : this.context.presets.addPreset();
        // A refused create (vocabulary guard, rights guard) already toasted; there
        // is nothing to render and nothing more to say.
        if (!preset) return;

        const newNode = this.getPresetHTMLById(preset.presetID, isLeftClick);
        if (this._presetCardsContainer) {
            this._presetCardsContainer.appendChild(newNode);
        } else {
            buttonNode?.before(newNode);
        }
        this._updatePresetEmptyState();
    },

    getAnnotationsHeadMenu(error = '') {
        return div({ class: 'annotations-head-menu-root' },
            error ? div({ class: 'error-container m-2' }, error) : null,
            br(),
            h4 ? h4({ class: 'f3-light header-sep' }, 'Stored on a server') : div({ class: 'f3-light header-sep' }, 'Stored on a server'),
            br()
        );
    },

    setPreferredPresets(presetIDs) {
        this._preferredPresets = new Set(presetIDs);
    },

    addPreferredPreset(presetID) {
        this._preferredPresets.add(presetID);
    },

    removePreferredPreset(presetID) {
        this._preferredPresets.delete(presetID);
    },

    isUnpreferredPreset(presetID) {
        return this._preferredPresets.size > 0 && !this._preferredPresets.has(presetID);
    }
};
