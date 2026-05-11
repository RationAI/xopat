import { PresetCard } from '../components/presetCard.mjs';

const { div, span, input, select, option, button, i, b, a, br, h4 } = globalThis.van.tags;

function iconNode(icon, extraClass = '', style = '') {
    return i({ class: `fa-auto ${icon} ${extraClass}`.trim(), style });
}

function textNode(value) {
    return document.createTextNode(value ?? '');
}

export const presetMethods = {
    validatePresetFactory(preset) {
        if (!this._allowedFactories.find((t) => preset.objectFactory.factoryID === t)) {
            preset.objectFactory = this.context.getAnnotationObjectFactory('polygon');
        }
    },

    updatePresetEvent() {
        this.updatePresetsHTML();
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
            const parsed = UI?.BaseComponent?.parseDomLikeItem?.(item);
            if (parsed instanceof Node) return [parsed];
            if (Array.isArray(parsed)) return parsed.flatMap(x => this._normalizeDomLike(x));
            if (typeof parsed === 'string') {
                const s = parsed.trim();
                if (s.startsWith('<')) {
                    const wrap = div();
                    wrap.innerHTML = s;
                    return Array.from(wrap.childNodes);
                }
                return [span(parsed)];
            }
            return [];
        }
        return [span(String(item))];
    },

    _selectPresetCard(presetId, sourceCard) {
        if (!this._presetCards) return;
        const next = this._presetSelection === presetId ? undefined : presetId;
        for (const [id, card] of this._presetCards) {
            card.setSelected(id === next);
        }
        this._presetSelection = next;
    },

    updatePresetsMouseButtons() {
        const leftPreset = this.context.getPreset(true);
        const rightPreset = this.context.getPreset(false);
        const left = document.getElementById('annotations-left-click');
        const right = document.getElementById('annotations-right-click');

        if (leftPreset) {
            this.validatePresetFactory(leftPreset);
            this._setContainerContent(left, this.getPresetControlHTML(leftPreset, true));
        } else {
            this._setContainerContent(left, this.getMissingPresetHTML(true));
        }
        if (rightPreset) {
            this.validatePresetFactory(rightPreset);
            this._setContainerContent(right, this.getPresetControlHTML(rightPreset, false));
        } else {
            this._setContainerContent(right, this.getMissingPresetHTML(false));
        }
    },

    updatePresetsHTML() {
        this.updatePresetsMouseButtons();
        this._updateRightSideMenuPresetList();
    },

    _updateRightSideMenuPresetList() {
        const target = document.getElementById('preset-list-inner-mp');
        if (!target) return;

        const leftPresetId = this.context.getPreset(true)?.presetID;
        const rightPresetId = this.context.getPreset(false)?.presetID;

        const container = div({class: 'flex flex-col gap-1 w-full max-h-[200px] overflow-y-auto pr-1'});

        this.context.presets.foreach((preset) => {
            const isLeft = preset.presetID === leftPresetId;
            const isRight = preset.presetID === rightPresetId;
            const isActive = isLeft || isRight;

            const item = button({
                    class: `btn btn-ghost btn-sm justify-start gap-2 normal-case font-medium w-full truncate border ${isActive ? 'bg-base-200 border-base-300' : 'border-transparent'}`.trim(),
                    onclick: () => this._clickPresetSelect(true, preset.presetID),
                    oncontextmenu: (e) => {
                        e.preventDefault();
                        this._clickPresetSelect(false, preset.presetID);
                    }
                },
                iconNode(preset.objectFactory.getIcon(), 'text-sm', `color: ${preset.color};`),
                span({class: 'truncate flex-1 text-left'}, preset.meta['category']?.value || 'Unnamed Class'),

                // Functional "Remove" Icons
                isLeft ? button({
                    class: 'badge badge-primary badge-xs h-4 w-4 p-0 font-bold hover:bg-error hover:border-error transition-colors',
                    title: 'Click to remove Left assignment',
                    onclick: (e) => {
                        e.stopPropagation();
                        this.context.setPreset(undefined, true);
                    }
                }, 'L') : null,

                isRight ? button({
                    class: 'badge badge-outline badge-xs h-4 w-4 p-0 font-bold hover:bg-error hover:text-error-content transition-colors',
                    title: 'Click to remove Right assignment',
                    onclick: (e) => {
                        e.stopPropagation();
                        this.context.setPreset(undefined, false);
                    }
                }, 'R') : null
            );
            container.appendChild(item);
        });

        this._setContainerContent(target, container);
    },

    getPresetControlHTML(preset, isLeftClick) {
        const category = preset.getMetaValue('category') || preset.objectFactory.title();
        return div({
                class: 'group flex items-center gap-2 bg-base-300 hover:bg-base-100 px-2 py-1 rounded-lg transition-all cursor-pointer border border-base-content/10',
                onclick: () => this.showPresets(isLeftClick)
            },
            iconNode(preset.objectFactory.getIcon(), 'text-xs', `color: ${preset.color};`),
            span({ class: 'text-xs font-bold truncate max-w-[80px]' }, category),
            button({
                class: 'btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100 min-h-0 h-5 w-5',
                onclick: (event) => {
                    event.stopPropagation();
                    this.context.setPreset(undefined, isLeftClick);
                }
            }, iconNode('fa-xmark', 'text-[10px]'))
        );
    },

    getMissingPresetHTML(isLeftClick) {
        return button({
                class: 'btn btn-ghost btn-xs border-dashed border-base-content/20 gap-1 normal-case font-medium',
                onclick: () => this.showPresets(isLeftClick)
            },
            iconNode('fa-plus', 'text-[10px]'),
            'Set'
        );
    },

    getPresetHTMLById(id, isLeftClick, index = undefined) {
        const preset = this.context.presets.get(id);
        if (!preset) return undefined;
        return this.getPresetHTML(preset, this.context.presets.getActivePreset(isLeftClick), index);
    },

    _createFactorySelect(preset) {
        const opts = this._allowedFactories.map((factoryId) => {
            const factory = this.context.getAnnotationObjectFactory(factoryId);
            return factory ? option({
                value: factory.factoryID,
                selected: factory.factoryID === preset.objectFactory.factoryID
            }, factory.title()) : null;
        });

        return select({
            class: 'select select-bordered select-xs w-full font-medium',
            disabled: !this.enablePresetModify,
            onchange: (e) => this.updatePresetWith(preset.presetID, 'objectFactory', e.target.value)
        }, ...opts);
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
            }, iconNode('fa-trash', 'text-[10px]')));
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
            allowedFactories: this._allowedFactories,
            t: (key) => this.t(key),
            callbacks: {
                getFactory: (id) => this.context.getAnnotationObjectFactory(id),
                onSelect: (id) => this._selectPresetCard(id),
                onDelete: (id, instance) => this._removePresetCard(id, instance),
                onColorChange: (id, value) => this.updatePresetWith(id, 'color', value),
                onFactoryChange: (id, value) => this.updatePresetWith(id, 'objectFactory', value),
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
            this._updateRightSideMenuPresetList();
            this._updatePresetEmptyState();
            return;
        }
        if (removed === false) {
            console.warn('Failed to remove preset', presetId);
            Dialogs.show('Failed to remove preset.', 5000, Dialogs.MSG_ERR);
        }
    },

    _addMetaField(presetId, name) {
        if (!this.enablePresetModify) return null;
        const key = this.context.presets.addCustomMeta(presetId, name, '');
        if (!key) {
            Dialogs.show(`Failed to create new metadata field ${name}`, 2500, Dialogs.MSG_ERR);
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
        Dialogs.show('Failed to delete meta field.', 2500, Dialogs.MSG_ERR);
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
        const preset = this.context.presets.get(id);
        if (!preset) return;

        if (propName === 'objectFactory') {
            // objectFactory stores a factory instance, not the id string —
            // keep this path inline and raise preset-update manually so
            // the IO pipeline still sees the change.
            const next = this.context.getAnnotationObjectFactory(value);
            if (next && next !== preset.objectFactory) {
                preset.objectFactory = next;
                this.context.raiseEvent('preset-update', { preset });
            }
        } else {
            // PresetManager.updatePreset writes the property and raises
            // preset-update only when something actually changed.
            this.context.presets.updatePreset(id, { [propName]: value });
        }

        this.updatePresetEvent();
    },

    insertPresetMeta(buttonNode, presetId) {
        if (!this.enablePresetModify) return;
        const inputNode = buttonNode.previousElementSibling;
        const name = inputNode?.value?.trim();
        if (!name) {
            Dialogs.show('You must add a name of the new field.', 2500, Dialogs.MSG_ERR);
            return;
        }

        const key = this.context.presets.addCustomMeta(presetId, name, '');
        if (key) {
            const newNode = this._metaFieldHtml(presetId, key, { name, value: '' });
            buttonNode.parentElement.before(newNode);
            inputNode.value = '';
            return;
        }
        Dialogs.show(`Failed to create new metadata field ${name}`, 2500, Dialogs.MSG_ERR);
    },

    deletePresetMeta(inputNode, presetId, key) {
        if (!this.enablePresetModify) return;
        if (this.context.presets.deleteCustomMeta(presetId, key)) {
            inputNode.parentElement.remove();
            return;
        }
        Dialogs.show('Failed to delete meta field.', 2500, Dialogs.MSG_ERR);
    },

    _createPresetDialogHeader() {
        return div({ class: 'flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-3 pb-2' },
            div({ class: 'flex items-center gap-2' },
                iconNode('fa-tags', 'text-primary'),
                h4({ class: 'text-lg font-bold' }, this.t('annotations.presets.dialogTitle'))
            ),
            div({ class: 'relative w-full sm:w-64' },
                span({ class: 'absolute inset-y-0 left-0 flex items-center pl-3 opacity-50' },
                    iconNode('fa-magnifying-glass', 'text-xs')
                ),
                input({
                    id: 'preset-filter-select',
                    class: 'input input-bordered input-sm w-full pl-9 focus:input-primary',
                    type: 'text',
                    placeholder: this.t('annotations.presets.filterPlaceholder') || 'Filter classes...',
                    oninput: (e) => this._applyPresetFilter(e.target.value)
                })
            )
        );
    },

    _createAddNewPresetButton(isLeftClick) {
        return div({
                id: 'preset-add-new',
                class: 'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-base-content/20 bg-base-100 hover:border-primary/60 hover:bg-base-200 transition-all cursor-pointer group min-h-[64px] py-3',
                onclick: (e) => this.createNewPreset(e.currentTarget, isLeftClick)
            },
            iconNode('fa-circle-plus', 'text-base opacity-60 group-hover:opacity-100'),
            span({ class: 'text-sm font-semibold uppercase tracking-wide opacity-60 group-hover:opacity-100' },
                this.t('annotations.presets.addNew') || 'Add new class'
            )
        );
    },

    _createPresetEmptyState() {
        return div({
            'data-preset-empty': '',
            class: 'flex flex-col items-center justify-center gap-2 py-6 text-center text-base-content/60 hidden'
        },
            iconNode('fa-tag', 'text-2xl opacity-60'),
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

    _createPresetDialogFooter(allowSelect) {
        const container = div({ class: 'flex justify-end items-center gap-2 w-full pt-3 mt-1 border-t border-base-300' });

        if (allowSelect) {
            container.append(
                button({
                    class: 'btn btn-outline btn-sm',
                    onclick: () => this._clickPresetSelect(false)
                }, this.t('annotations.presets.useRight') || 'Use for Right Click'),
                button({
                    class: 'btn btn-primary btn-sm',
                    onclick: () => this._clickPresetSelect(true)
                }, this.t('annotations.presets.useLeft') || 'Use for Left Click')
            );
        } else {
            container.append(
                button({
                    class: 'btn btn-primary btn-sm px-6',
                    onclick: () => this._closePresetDialog()
                }, this.t('annotations.presets.finishEditing') || 'Finish Editing')
            );
        }
        return container;
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

    showPresets(isLeftClick) {
        if (this.context.disabledInteraction) {
            Dialogs.show('Annotations are disabled. Enable them first.', 2500, Dialogs.MSG_WARN);
            return;
        }
        // Close any prior dialog first — _closePresetDialog clears the
        // card map and container refs, so it must run before we (re)build them.
        this._closePresetDialog();

        const allowSelect = isLeftClick !== undefined;
        this._presetSelection = undefined;
        this._presetCards = new Map();

        const currentPreset = allowSelect
            ? (this.context.getPreset(isLeftClick) || this.context.presets.get())
            : undefined;

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
                cardsContainer.appendChild(this.getPresetHTML(item, currentPreset));
            }
        }

        if (this._presetCards.size === 0) emptyState.classList.remove('hidden');

        const addNewWrapper = this.enablePresetModify
            ? div({ class: 'mt-3' }, this._createAddNewPresetButton(isLeftClick))
            : null;

        const body = div({ class: 'flex flex-col gap-2' },
            emptyState,
            cardsContainer,
            noResults,
            addNewWrapper
        );

        const header = this._createPresetDialogHeader();
        const footer = this._createPresetDialogFooter(allowSelect);

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

    _clickPresetSelect(isLeft, presetID = undefined) {
        // Get the preset object
        const preset = presetID ? this.context.presets.get(presetID) : this._presetSelection;

        // Check current assignment for toggle behavior
        const currentActive = this.context.getPreset(isLeft);
        const isAlreadyActive = currentActive?.presetID === preset?.presetID;

        setTimeout(() => {
            this._closePresetDialog();
            // If it's already active, send undefined to remove the assignment
            this.context.setPreset(isAlreadyActive ? undefined : preset, isLeft);
        }, 150);
        return false;
    },

    _getMousePosition(e, checkBounds = true) {
        const image = VIEWER.scalebar.getReferencedTiledImage() || VIEWER.world.getItemAt(0);
        if (!image) return { x: 0, y: 0 };
        const screen = new OpenSeadragon.Point(e.originalEvent.x, e.originalEvent.y);
        const { x, y } = image.windowToImageCoordinates(screen);
        const { x: maxX, y: maxY } = image.getContentSize();
        if (checkBounds && (x <= 0 || y <= 0 || x >= maxX || y >= maxY)) return false;
        return { x, y };
    },

    _copyAnnotation(mousePos, annotation) {
        const bounds = annotation.getBoundingRect(true, true);
        this._copiedPos = { x: bounds.left - mousePos.x, y: bounds.top - mousePos.y };
        this._copiedAnnotation = annotation;
        this._copiedIsCopy = true;
    },

    _cutAnnotation(mousePos, annotation) {
        const bounds = annotation.getBoundingRect(true, true);
        this._copiedPos = { x: bounds.left - mousePos.x, y: bounds.top - mousePos.y };
        this._copiedAnnotation = annotation;
        this._copiedIsCopy = false;
        this._deleteAnnotation(annotation);
    },

    _deleteAnnotation(annotation) {
        this.context.fabric.deleteObject(annotation);
    },

    _canPasteAnnotation(e, getMouseValue = false) {
        if (!this._copiedAnnotation) return null;
        const mousePos = this._getMousePosition(e);
        if (getMouseValue) return mousePos;
        return !!mousePos;
    },

    _pasteAnnotation(e) {
        const mousePos = this._canPasteAnnotation(e, true);
        if (!mousePos) {
            if (mousePos === false) Dialogs.show('Cannot paste annotation out of bounds', 5000, Dialogs.MSG_WARN);
            return;
        }

        const annotation = this._copiedAnnotation;
        const factory = annotation._factory();
        const copy = factory.copy(annotation);
        const res = factory.translate(copy, { x: mousePos.x + this._copiedPos.x, y: mousePos.y + this._copiedPos.y }, true);
        if (this._copiedIsCopy) delete copy.internalID;
        this.context.fabric.addAnnotation(res);
        factory.renderAllControls(res);
    },

    _clickAnnotationChangePreset(annotation) {
        if (this._presetSelection === undefined) {
            Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
            return false;
        }
        setTimeout(() => {
            this._closePresetDialog();
            this.context.fabric.changeAnnotationPreset(annotation, this._presetSelection);
        }, 150);
        return false;
    },

    _clickAnnotationMarkPrivate(annotation) {
        const newValue = !this._getAnnotationProps(annotation).private;
        this.context.fabric.setAnnotationPrivate(annotation, newValue);
    },

    _getAnnotationProps(annotation) {
        return { private: annotation.private };
    },

    createNewPreset(buttonNode, isLeftClick) {
        const id = this.context.presets.addPreset().presetID;
        const newNode = this.getPresetHTMLById(id, isLeftClick);
        if (this._presetCardsContainer) {
            this._presetCardsContainer.appendChild(newNode);
        } else {
            buttonNode.before(newNode);
        }
        this._updatePresetEmptyState();
        this._updateRightSideMenuPresetList();
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
