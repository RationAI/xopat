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

  updatePresetsMouseButtons() {
    const leftPreset = this.context.getPreset(true);
    const rightPreset = this.context.getPreset(false);
    const left = $('#annotations-left-click');
    const right = $('#annotations-right-click');

    if (leftPreset) {
      this.validatePresetFactory(leftPreset);
      left.html(this.getPresetControlHTML(leftPreset, true));
    } else {
      left.html(this.getMissingPresetHTML(true));
    }
    if (rightPreset) {
      this.validatePresetFactory(rightPreset);
      right.html(this.getPresetControlHTML(rightPreset, false));
    } else {
      right.html(this.getMissingPresetHTML(false));
    }
  },

  updatePresetsHTML() {
    this.updatePresetsMouseButtons();
    this._updateRightSideMenuPresetList();
  },

  _updateRightSideMenuPresetList() {
    const html = ['<div style="max-height: 115px; overflow-y: auto;">'];
    let pushed = false;
    this.context.presets.foreach((preset) => {
      const containerCss = this.isUnpreferredPreset(preset.presetID) ? 'opacity-50' : '';
      html.push(`<span style="width: 170px; text-overflow: ellipsis; max-lines: 1;" onclick="return ${this.THIS}._clickPresetSelect(true, '${preset.presetID}');" oncontextmenu="return ${this.THIS}._clickPresetSelect(false, '${preset.presetID}');" class="d-inline-block pointer ${containerCss}"><i class="fa-auto ${preset.objectFactory.getIcon()} pr-1" style="color: ${preset.color};"></i>`);
      html.push(`<span class="d-inline-block pt-2" type="text">${preset.meta['category'].value || 'unknown'}</span></span>`);
      pushed = true;
    });

    if (!pushed) html.push(`To start annotating, please <a onclick="${this.THIS}.showPresets();">create some class presets</a>.`);
    html.push('</div>');
    $('#preset-list-inner-mp').html(html.join(''));
    if (this._fireBoardUpdate) this.context.historyManager.refresh();
    this._fireBoardUpdate = true;
  },

  getMissingPresetHTML(isLeftClick) {
    return `<div class="p-1" onclick="${this.THIS}.showPresets(${isLeftClick});"><i class="fa-auto fa-plus pr-1"></i><span class="one-liner d-inline-block v-align-middle pr-2">Set</span></div>`;
  },

  getPresetControlHTML(preset, isLeftClick) {
    const category = preset.getMetaValue('category') || preset.objectFactory.title();
    return `<div class="position-relative p-1" onclick="${this.THIS}.showPresets(${isLeftClick});">
<i class="fa-auto fa-xmark position-absolute border-sm color-bg-primary close p-0 top-0 right-0 text-small" id="discard-annotation-p-selection" onclick="event.stopPropagation(); ${this.THIS}.context.setPreset(undefined, ${isLeftClick});"></i>
<i class="fa-auto ${preset.objectFactory.getIcon()}" style="color: ${preset.color};"></i>
<span class="one-liner d-inline-block v-align-middle pr-3">${category}</span>
</div>`;
  },

  getPresetHTMLById(id, isLeftClick, index = undefined) {
    const preset = this.context.presets.get(id);
    if (!preset) return '';
    return this.getPresetHTML(preset, this.context.presets.getActivePreset(isLeftClick), index);
  },

  getPresetHTML(preset, defaultPreset = undefined) {
    let select = '';
    const disabled = this.enablePresetModify ? '' : ' disabled ';

    this._allowedFactories.forEach((factoryId) => {
      const factory = this.context.getAnnotationObjectFactory(factoryId);
      if (factory) {
        if (factory.factoryID === preset.objectFactory.factoryID) select += `<option value="${factory.factoryID}" selected>${factory.title()}</option>`;
        else select += `<option value="${factory.factoryID}">${factory.title()}</option>`;
      }
    });

    const html = [`<div data-preset-id="${preset.presetID}" class="preset-option position-relative border v-align-top border-dashed p-1 rounded-3 d-inline-block mb-2 `];
    if (preset.presetID === defaultPreset?.presetID) {
      html.push('highlighted-preset');
      this._presetSelection = preset.presetID;
    }
    html.push(`"style="cursor:pointer;margin: 7px;border-width:4px!important;" onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');${this.THIS}._presetSelection = '${preset.presetID}'">`);

    if (this.enablePresetModify) {
      html.push(`<i class="fa-auto fa-trash btn-pointer position-absolute top-0 right-0 px-0 z-3" onclick="${this.THIS}.removePreset(this, '${preset.presetID}');"></i>`);
    }

    if (preset.meta.category) {
      html.push(this._metaFieldHtml(preset.presetID, 'category', preset.meta.category, false, 'mr-5'));
    }

    html.push(`
<span class="show-hint d-inline-block my-1" data-hint="Color"><input ${disabled} class="form-control" type="color" style="height:33px;" onchange="${this.THIS}.updatePresetWith('${preset.presetID}', 'color', this.value);" value="${preset.color}"></span>
<span class="show-hint d-inline-block my-1" style="width: 155px" data-hint="Annotation"><select class="form-control width-full" onchange="${this.THIS}.updatePresetWith('${preset.presetID}', 'objectFactory', this.value);">${select}</select></span><br>`);

    for (const key in preset.meta) {
      if (key === 'category') continue;
      html.push(this._metaFieldHtml(preset.presetID, key, preset.meta[key], true));
    }
    html.push('<div>');
    if (this.enablePresetModify) {
      html.push(`<input class="form-control my-1" type="text" placeholder="name new field" style="width: 140px;"><span class="btn-pointer" onclick="${this.THIS}.insertPresetMeta(this, '${preset.presetID}');"><i class="fa-auto fa-plus"></i></span>`);
    }
    html.push('</div></div>');
    return html.join('');
  },

  updatePresetWith(idOrBoolean, propName, value, fireBoardUpdate = true) {
    this._fireBoardUpdate = fireBoardUpdate;
    if (!this.enablePresetModify && propName !== 'objectFactory') return;

    let preset = idOrBoolean;
    if (typeof idOrBoolean === 'boolean') {
      preset = idOrBoolean ? this.context.presets.left : this.context.presets.right;
      if (!preset) {
        USER_INTERFACE.highlight('RightSideMenu', 'annotations-panel', `${idOrBoolean ? 'annotations-left-click' : 'annotations-right-click'}`);
        return;
      }
      preset = preset.presetID;
    }

    if (propName === 'objectFactory') {
      const factory = this.context.getAnnotationObjectFactory(value);
      if (!factory) {
        console.warn(`Cannot update preset ${preset} factory - unknown factory!`, value);
        return;
      }
      value = factory;
    }

    this.context.presets.updatePreset(preset, { [propName]: value });
  },

  removePreset(buttonNode, presetId) {
    if (!this.enablePresetModify) return;
    const removed = this.context.presets.removePreset(presetId);
    if (removed) $(buttonNode).parent().remove();
  },

  insertPresetMeta(buttonNode, presetId) {
    if (!this.enablePresetModify) return;
    const input = buttonNode.previousElementSibling;
    const name = input.value;
    if (!name) {
      Dialogs.show('You must add a name of the new field.', 2500, Dialogs.MSG_ERR);
      return;
    }

    const key = this.context.presets.addCustomMeta(presetId, buttonNode.previousElementSibling.value, '');
    if (key) {
      $(this._metaFieldHtml(presetId, key, { name, value: '' })).insertBefore($(buttonNode.parentElement));
      input.value = '';
      return;
    }
    Dialogs.show('Failed to create new metadata field ' + name, 2500, Dialogs.MSG_ERR);
  },

  deletePresetMeta(inputNode, presetId, key) {
    if (!this.enablePresetModify) return;
    if (this.context.presets.deleteCustomMeta(presetId, key)) {
      $(inputNode.parentElement).remove();
      return;
    }
    Dialogs.show('Failed to delete meta field.', 2500, Dialogs.MSG_ERR);
  },

  _metaFieldHtml(presetId, key, metaObject, allowDelete = true, classes = 'width-full') {
    const disabled = this.enablePresetModify ? '' : ' disabled ';
    const delButton = allowDelete && this.enablePresetModify ? `<i class="fa-auto fa-trash btn-pointer position-absolute right-0" style="font-size: 17px;" onclick="${this.THIS}.deletePresetMeta(this, '${presetId}', '${key}')"></i>` : '';
    return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1 ${classes}" placeholder="unknown" type="text" onchange="${this.THIS}.updatePresetWith('${presetId}', '${key}', this.value);" value="${metaObject.value}" ${disabled}>${delButton}</div>`;
  },

  showPresets(isLeftClick) {
    if (this.context.disabledInteraction) {
      Dialogs.show('Annotations are disabled. <a onclick="$(\'#enable-disable-annotations\').click();">Enable.</a>', 2500, Dialogs.MSG_WARN);
      return;
    }
    const allowSelect = isLeftClick !== undefined;
    this._presetSelection = undefined;

    const currentPreset = this.context.getPreset(isLeftClick) || this.context.presets.get();
    const html = ['<div style="min-width: 270px">'];
    const event = { presets: Object.values(this.context.presets._presets) };
    this.raiseEvent('render-annotation-presets', event);
    html.push(...event.presets.map((p) => typeof p === 'string' ? p : this.getPresetHTML(p, currentPreset)));

    if (this.enablePresetModify) {
      html.push(`<div id="preset-add-new" class="border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block ${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer; border-color: var(--color-border-secondary);" onclick="${this.THIS}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);
    }
    html.push('</div>');

    const footer = allowSelect
      ? `<div class="d-flex flex-row-reverse"><button id="select-annotation-preset-right" onclick="return ${this.THIS}._clickPresetSelect(false);" oncontextmenu="return ${this.THIS}._clickPresetSelect(false);" class="btn m-2">Set for right click </button><button id="select-annotation-preset-left" onclick="return ${this.THIS}._clickPresetSelect(true);" class="btn m-2">Set for left click </button></div>`
      : `<div class="d-flex flex-row-reverse"><button class="btn btn-primary m-2" onclick="Dialogs.closeWindow('preset-modify-dialog');">Save</button></div>`;

    Dialogs.showCustom('preset-modify-dialog', '<b>Annotations presets</b> <input id="preset-filter-select" class="form-control ml-3" type="text" placeholder="Filter presets..." />', html.join(''), footer);

    setTimeout(() => {
      $('#preset-filter-select').on('input', (e) => {
        const search = e.target.value.toLowerCase();
        document.querySelectorAll('#preset-modify-dialog .preset-option').forEach((el) => {
          const meta = this.context.presets._presets[el.dataset.presetId].meta;
          const value = meta.category?.value.toLowerCase();
          const collection = meta.collection?.name.toLowerCase() || '';
          if (!search || value.includes(search) || ('unknown'.includes(search) && !value) || collection.includes(search)) {
            el.classList.remove('hidden');
          } else {
            el.classList.add('hidden');
          }
        });
      });
    }, 0);
  },

  _clickPresetSelect(isLeft, presetID = undefined) {
    if (!presetID && this._presetSelection === undefined) {
      Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
      return false;
    }

    const preset = presetID ? this.context.presets.get(presetID) : this._presetSelection;
    setTimeout(() => {
      Dialogs.closeWindow('preset-modify-dialog');
      this._bvselect = null;
      this.context.setPreset(preset, isLeft);
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
    this._deleteAnnotation(annotation);
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
    // todo with polygon, translate creates 'yet another copy' -> avoid.
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
      Dialogs.closeWindow('preset-modify-dialog');
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
    const node = $(buttonNode);
    node.before(this.getPresetHTMLById(id, isLeftClick, node.index()));
    this.context.createPresetsCookieSnapshot();
    this._updateRightSideMenuPresetList();
  },

  getAnnotationsHeadMenu(error = '') {
    //todo
    error = error ? `<div class="error-container m-2">${error}</div><br>` : '';
    return `<br><h4 class="f3-light header-sep">Stored on a server</h4>${error}<br>`;
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
