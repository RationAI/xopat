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
        this.context.createPresetsCookieSnapshot();
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

    _selectPresetCard(card, presetId) {
        const parent = card?.parentElement;
        if (!parent) return;

        // Remove highlight from others
        parent.querySelectorAll('.card').forEach(el => {
            el.classList.remove('border-primary', 'ring-2', 'ring-primary/20');
            el.classList.add('border-transparent');
        });

        // Add to current
        card.classList.remove('border-transparent');
        card.classList.add('border-primary', 'ring-2', 'ring-primary/20');
        this._presetSelection = presetId;
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

        // Main Card Container
        const card = div({
            'data-preset-id': preset.presetID,
            class: `card card-compact m-1 bg-base-200 shadow-sm border-2 transition-all cursor-pointer hover:border-primary/50 ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-transparent'}`,
            style: 'width: 240px; display: inline-block' // Fixed width for grid consistency
        });

        card.onclick = () => this._selectPresetCard(card, preset.presetID);

        // Header: Title and Delete
        const header = div({ class: 'flex items-center justify-between p-2 pb-0' },
            this.enablePresetModify
                ? this._metaFieldHtml(
                    preset.presetID,
                    'category',
                    preset.meta.category || {value: ''},
                    false,
                    'input-xs font-bold bg-transparent border-none hover:bg-base-300 focus:bg-base-100 transition-colors'
                )
                : span({ class: 'text-sm font-bold px-2' }, preset.meta.category?.value || 'Class'),
            this.enablePresetModify ? button({
                class: 'btn btn-ghost btn-xs btn-square text-error',
                onclick: (e) => { e.stopPropagation(); this.removePreset(e.currentTarget, preset.presetID); }
            }, iconNode('fa-trash')) : null
        );

        // Body: Color and Factory
        const body = div({ class: 'card-body p-3 pt-1 gap-2' },
            div({ class: 'flex gap-2 items-center' },
                // Color Picker (DaisyUI Styled)
                div({ class: 'tooltip tooltip-top', 'data-tip': 'Color' },
                    input({
                        class: 'p-0 border-none bg-transparent cursor-pointer w-8 h-8 rounded-lg overflow-hidden',
                        type: 'color',
                        value: preset.color,
                        disabled: !this.enablePresetModify,
                        onchange: (e) => this.updatePresetWith(preset.presetID, 'color', e.target.value)
                    })
                ),
                // Factory Select
                div({ class: 'flex-1' }, this._createFactorySelect(preset))
            ),

            // Metadata Fields
            div({ class: 'space-y-1' },
                Object.entries(preset.meta)
                    .filter(([key]) => key !== 'category')
                    .map(([key, meta]) => this._metaFieldHtml(preset.presetID, key, meta, true, 'input-xs w-full'))
            ),

            // Add Metadata Button
            this.enablePresetModify ? div({ class: 'join w-full mt-1' },
                input({
                    class: 'input input-xs input-bordered join-item flex-1',
                    placeholder: 'New field...',
                    onclick: (e) => e.stopPropagation()
                }),
                button({
                    class: 'btn btn-xs btn-primary join-item',
                    onclick: (e) => { e.stopPropagation(); this.insertPresetMeta(e.currentTarget, preset.presetID); }
                }, 'Add')
            ) : null
        );

        card.append(header, body);
        return card;
    },

    removePreset(buttonNode, presetId) {
        if (!this.enablePresetModify) return;

        const removed = this.context.presets.removePreset(presetId);
        if (removed) {
            buttonNode.closest('[data-preset-id]')?.remove();
            this.context.createPresetsCookieSnapshot();
            this._updateRightSideMenuPresetList();
            return;
        }
        if (removed === false) {
            console.warn('Failed to remove preset', presetId);
            Dialogs.show('Failed to remove preset.', 5000, Dialogs.MSG_ERR);
        }
    },

    updatePresetWith(id, propName, value) {
        if (!this.enablePresetModify) return;
        const preset = this.context.presets.get(id);
        if (!preset) return;

        if (propName === 'objectFactory') {
            preset.objectFactory = this.context.getAnnotationObjectFactory(value) || preset.objectFactory;
        } else if (propName === 'color') {
            preset.color = value;
        } else if (preset.meta[propName]) {
            preset.meta[propName].value = value;
        }

        this.context.createPresetsCookieSnapshot();
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
            this.context.createPresetsCookieSnapshot();
            return;
        }
        Dialogs.show(`Failed to create new metadata field ${name}`, 2500, Dialogs.MSG_ERR);
    },

    deletePresetMeta(inputNode, presetId, key) {
        if (!this.enablePresetModify) return;
        if (this.context.presets.deleteCustomMeta(presetId, key)) {
            inputNode.parentElement.remove();
            this.context.createPresetsCookieSnapshot();
            return;
        }
        Dialogs.show('Failed to delete meta field.', 2500, Dialogs.MSG_ERR);
    },

    _createPresetDialogHeader() {
        return div({ class: 'flex flex-col sm:flex-row items-start sm:items-center justify-between w-full gap-4 pb-2' },
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
                    placeholder: 'Filter classes...',
                    oninput: (e) => this._applyPresetFilter(e.target.value)
                })
            )
        );
    },

    _createAddNewPresetButton(isLeftClick) {
        return div({
                id: 'preset-add-new',
                class: 'card card-compact w-[240px] m-1 bg-base-100 border-2 border-dashed border-base-content/20 hover:border-primary/50 hover:bg-base-200 transition-all cursor-pointer group flex items-center justify-center min-h-[180px]',
                style: 'display: inline-block',
                onclick: (e) => this.createNewPreset(e.currentTarget, isLeftClick)
            },
            div({ class: 'flex flex-col items-center gap-2 opacity-40 group-hover:opacity-100 transition-opacity' },
                iconNode('fa-circle-plus', 'text-3xl'),
                span({ class: 'font-bold text-sm uppercase tracking-widest pt-4' }, 'Add New Class')
            )
        );
    },

    _createPresetDialogFooter(allowSelect) {
        const container = div({ class: 'flex justify-end items-center gap-3 w-full p-4 border-t border-base-300 bg-base-200/50' });

        if (allowSelect) {
            container.append(
                button({
                    class: 'btn btn-outline btn-sm',
                    onclick: () => this._clickPresetSelect(false)
                }, 'Use for Right Click'),
                button({
                    class: 'btn btn-primary btn-sm',
                    onclick: () => this._clickPresetSelect(true)
                }, 'Use for Left Click')
            );
        } else {
            container.append(
                button({
                    class: 'btn btn-primary px-8',
                    onclick: () => this._presetDialog?.close?.()
                }, 'Finish Editing')
            );
        }
        return container;
    },

    _applyPresetFilter(searchValue = '') {
        const search = String(searchValue || '').toLowerCase();
        this._presetCardsContainer?.querySelectorAll?.('.preset-option')?.forEach((el) => {
            const meta = this.context.presets._presets[el.dataset.presetId]?.meta || {};
            const value = String(meta.category?.value || '').toLowerCase();
            const collection = String(meta.collection?.name || '').toLowerCase();
            const shouldShow = !search || value.includes(search) || ('unknown'.includes(search) && !value) || collection.includes(search);
            el.classList.toggle('hidden', !shouldShow);
        });
    },

    showPresets(isLeftClick) {
        if (this.context.disabledInteraction) {
            Dialogs.show('Annotations are disabled. Enable them first.', 2500, Dialogs.MSG_WARN);
            return;
        }
        const allowSelect = isLeftClick !== undefined;
        this._presetSelection = undefined;

        const currentPreset = this.context.getPreset(isLeftClick) || this.context.presets.get();
        const body = div({ class: 'w-full max-w-5xl' });
        const cardsContainer = div({ });
        this._presetCardsContainer = cardsContainer;

        const event = { presets: Object.values(this.context.presets._presets) };
        this.raiseEvent('render-annotation-presets', event);

        for (const item of event.presets) {
            if (typeof item === 'string' || item instanceof Node || item?.create) {
                const nodes = this._normalizeDomLike(item);
                cardsContainer.append(...nodes);
            } else {
                cardsContainer.appendChild(this.getPresetHTML(item, currentPreset));
            }
        }

        if (this.enablePresetModify) {
            cardsContainer.appendChild(this._createAddNewPresetButton(isLeftClick));
        }

        body.appendChild(cardsContainer);

        const header = this._createPresetDialogHeader();
        const footer = this._createPresetDialogFooter(allowSelect);

        this._closePresetDialog();
        this._presetDialog = Dialogs.showCustom('preset-modify-dialog', header, body, footer, {
            allowResize: true,
            width: 'max-w-6xl'
        });
    },

    _closePresetDialog() {
        this._presetDialog?.close?.();
        this._presetDialog = null;
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
        buttonNode.before(newNode);
        this.context.createPresetsCookieSnapshot();
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
