export function createErrorHandlers(plugin) {
  return {
    W_NO_PRESET: (e) => {
      Dialogs.show(plugin.t('errors.noPresetAction', {
        selfId: plugin.id,
        action: `USER_INTERFACE.highlight('RightSideMenu', 'annotations-panel', '${e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click'}');`
      }), 3000, Dialogs.MSG_WARN, false);
      return false;
    },
    W_AUTO_CREATION_FAIL: () => {
      Dialogs.show(`Could not create automatic annotation. Make sure you are <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">detecting in the correct layer</a> and selecting coloured area. Also, adjusting threshold can help.`, 5000, Dialogs.MSG_WARN, false);
      return false;
    },
    E_AUTO_OUTLINE_INVISIBLE_LAYER: () => {
      Dialogs.show(`The <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">chosen layer</a> is not visible: auto outline method will not work.`, 5000, Dialogs.MSG_WARN, false);
      return false;
    }
  };
}

export const handlerMethods = {
  initHandlers() {
    // FIXME event no longer exist
    VIEWER.addHandler('background-image-swap', () => this.setupActiveTissue());
    VIEWER_MANAGER.broadcastHandler('warn-user', (e) => this._errorHandlers[e.code]?.apply(this, [e]));

    const modeChangeHandler = (e) => {
      const mode = e.mode;
      const modes = this.context.Modes;
      const modeId = mode.getId();

      if (this._htmlWrap && this._modeOptionsPanel) {
        const rawHtml = (this.context.mode.customHtml && this.context.mode.customHtml()) || '';
        const hasHtml = !!rawHtml && rawHtml.trim().length > 0;

        if (hasHtml) {
          this._htmlWrap.setHtml(rawHtml);
          this._modeOptionsPanel.setEnabled(true);
          if (!this._forceCloseModeOptions && !this._modeOptionsPanel.isOpen()) {
            this._modeOptionsPanel.open();
          }
        } else {
          this._htmlWrap.setHtml('');
          this._modeOptionsPanel.close();
          this._modeOptionsPanel.setEnabled(false);
          this._forceCloseModeOptions = true;
        }
      }

      if (modeId === modes.AUTO.getId()) {
        this._gModes.setSelected(modes.AUTO.getId(), false);
      } else if (
        modeId === modes.MAGIC_WAND.getId() ||
        modeId === modes.FREE_FORM_TOOL_CORRECT.getId() ||
        modeId === modes.VIEWPORT_SEGMENTATION.getId()
      ) {
        this._gModes.setSelected('cg-auto', false);
        this._autoChoice.setSelected(modeId, false, false);
      } else if (
        modeId === modes.FREE_FORM_TOOL_ADD.getId() ||
        modeId === modes.FREE_FORM_TOOL_REMOVE.getId()
      ) {
        this._gModes.setSelected('g-brush', false);
        this._gBrush.setSelected(modeId, false);
      } else if (modeId === modes.CUSTOM.getId()) {
        const pl = this.context.presets.left;
        if (pl && pl.objectFactory && pl.objectFactory.factoryID) {
          this._gModes.setSelected('cg-shapes', false);
          this._shapeChoice.setSelected(pl.objectFactory.factoryID, false, false);
        }
      } else {
        this._gModes.setSelected(`${modeId}`, false);
      }

      USER_INTERFACE.Status.show(mode.getDescription());
    };

    this.context.addHandler('mode-changed', modeChangeHandler);
    this.context.addHandler('import', () => {
      this.updatePresetsHTML();
      if ($('#author-list-mp').css('display') !== 'none') {
        this._populateAuthorsList();
      }
    });
    this.context.addHandler('enabled', this.annotationsEnabledHandler);
    this.annotationsEnabledEditModeHandler = this.annotationsEnabledEditModeHandler.bind(this);
    this.context.addHandler('enabled-edit-mode', this.annotationsEnabledEditModeHandler);
    this.context.addHandler('preset-select', this.updatePresetsHTML.bind(this));
    this.context.addHandler('preset-update', this.updatePresetEvent.bind(this));
    this.context.addHandler('preset-delete', (e) => {
      if (e.preset === this.context.getPreset(false)) $('#annotations-right-click').html(this.getMissingPresetHTML(false));
      if (e.preset === this.context.getPreset(true)) $('#annotations-left-click').html(this.getMissingPresetHTML(true));
      this.context.createPresetsCookieSnapshot();
      this._updateRightSideMenuPresetList();
    });

    this.context.historyManager.setAutoOpenDOMRenderer(this._annotationsDomRenderer, '160px');
    this.context.addHandler('history-swap', (e) => this._afterHistoryWindowOpen(e.inNewWindow));
    this.context.addHandler('history-close', (e) => e.inNewWindow && this.openHistoryWindow(false));

    this.context.addFabricHandler('annotation-set-private', () => {
      // todo smells
      this.context.fabric.rerender();
    });

    // todo consider moving to OSD Annotations events instead
    this.context.fabric.canvas.on('object:added', (e) => {
      if ($('#author-list-mp').css('display') !== 'none' && this.context.fabric.isAnnotation(e.target)) {
        this._populateAuthorsList();
      }
    });

    this.context.fabric.canvas.on('object:removed', (e) => {
      if ($('#author-list-mp').css('display') !== 'none' && this.context.fabric.isAnnotation(e.target)) {
        this._populateAuthorsList();
      }
    });

    this.context.addHandler('nonprimary-release-not-handled', (e) => {
      if (this.context.presets.right || (Date.now() - e.pressTime) > 250) return;

      let actions = [];
      let handler;
      // todo what about e.target?
      const active = this.context.fabric.canvas.findTarget(e.originalEvent);
      if (active) {
        this.context.fabric.canvas.setActiveObject(active);
        this.context.fabric.canvas.renderAll();
        actions.push({ title: 'Change annotation to:' });
        handler = this._clickAnnotationChangePreset.bind(this, active);
      } else {
        actions.push({ title: 'Select preset for left click:' });
        handler = this._clickPresetSelect.bind(this, true);
      }

      this.context.presets.foreach((preset) => {
        const category = preset.getMetaValue('category') || 'unknown';
        const icon = preset.objectFactory.getIcon();
        const containerCss = this.isUnpreferredPreset(preset.presetID) && 'opacity-50';
        actions.push({
          icon,
          iconCss: `color: ${preset.color};`,
          containerCss,
          title: category,
          action: () => {
            this._presetSelection = preset.presetID;
            handler();
          }
        });
      });

      if (active) {
        const props = this._getAnnotationProps(active);
        const handlerMarkPrivate = this._clickAnnotationMarkPrivate.bind(this, active);
        actions.push({ title: 'Modify annotation:' });
        actions.push({
          title: props.private ? 'Unmark as private' : 'Mark as private',
          icon: props.private ? 'visibility' : 'visibility_lock',
          action: () => handlerMarkPrivate()
        });
      }

      actions.push({ title: 'Actions:' });
      const mousePos = this._getMousePosition(e);
      const handlerCopy = this._copyAnnotation.bind(this, mousePos, active);
      actions.push({ title: 'Copy', icon: 'fa-copy', containerCss: !active && 'opacity-50', action: () => active && handlerCopy() });
      const handlerCut = this._cutAnnotation.bind(this, mousePos, active);
      actions.push({ title: 'Cut', icon: 'fa-scissors', containerCss: !active && 'opacity-50', action: () => active && handlerCut() });
      const canPaste = this._canPasteAnnotation(e);
      const handlerPaste = this._pasteAnnotation.bind(this, e);
      actions.push({ title: 'Paste', icon: 'fa-paste', containerCss: !canPaste && 'opacity-50', action: () => canPaste && handlerPaste() });
      const handlerDelete = this._deleteAnnotation.bind(this, active);
      actions.push({ title: 'Delete', icon: 'fa-trash', containerCss: !active && 'opacity-50', action: () => active && handlerDelete() });

      USER_INTERFACE.DropDown.open(e.originalEvent, actions);
    });

    this.context.addHandler('history-select', (e) => {
      if (e.originalEvent.isPrimary || e.originalEvent.button === 0) return;
      const annotationObject = this.context.fabric.findObjectOnCanvasByIncrementId(e.incrementId);
      if (!annotationObject) return;

      const actions = [{ title: 'Change annotation to:' }];
      const handler = this._clickAnnotationChangePreset.bind(this, annotationObject);
      this.context.presets.foreach((preset) => {
        const category = preset.getMetaValue('category') || 'unknown';
        const icon = preset.objectFactory.getIcon();
        const containerCss = this.isUnpreferredPreset(preset.presetID) && 'opacity-50';
        actions.push({
          icon,
          iconCss: `color: ${preset.color};`,
          containerCss,
          title: category,
          action: () => {
            this._presetSelection = preset.presetID;
            handler();
          }
        });
      });

      USER_INTERFACE.DropDown.open(e.originalEvent, actions);
    });

    this.context.Modes.FREE_FORM_TOOL_ADD.customHtml =
      this.context.Modes.FREE_FORM_TOOL_REMOVE.customHtml =
      this.context.Modes.FREE_FORM_TOOL_CORRECT.customHtml =
        this.freeFormToolControls.bind(this);

    this.context.addHandler('free-form-tool-radius', (e) => {
      $('#fft-size').val(e.radius);
    });
  },

  setupTutorials() {
    USER_INTERFACE.Tutorials.add(
      this.id,
      'Annotations Plugin Overview',
      'get familiar with the annotations plugin',
      'draw',
      [
        { 'next #annotations-panel': 'Annotations allow you to annotate <br>the canvas parts and export and share all of it.' },
        { 'next #enable-disable-annotations': 'This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all annotation controls and hotkeys.' },
        { 'next #server-primary-save': 'Depending on the viewer settings <br>the annotations can be saved here (either locally or to a server).' }
      ]
    );
  },

  annotationsEnabledHandler(e) {
    if (e.isEnabled) {
      $('#annotations-tool-bar').removeClass('disabled');
      $('#annotations-opacity').attr('disabled', false);
      $('#annotations-border-width').attr('disabled', false);
    } else {
      $('#annotations-tool-bar').addClass('disabled');
      $('#annotations-opacity').attr('disabled', true);
      $('#annotations-border-width').attr('disabled', true);
    }
  },

  annotationsEnabledEditModeHandler(e) {
    // todo disable whole toolbar activity, visibility and outline slider to not to allow change these while edit is going on.
    if (e.isEditEnabled) {
      // turn off
    } else {
      // turn on
    }
  },

  _toggleEnabled(btnElement) {
    const icon = btnElement.querySelector('.fa-auto');
    const toolBar = document.getElementById('annotations-tool-bar-content');

    if (this.context.disabledInteraction) {
      this.context.enableAnnotations(true);
      if (icon) {
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
      btnElement.dataset.ref = 'on';
      if (toolBar) {
        toolBar.style.pointerEvents = 'auto';
        toolBar.style.opacity = '1';
        toolBar.setAttribute('aria-disabled', 'false');
      }
    } else {
      this.context.enableAnnotations(false);
      if (icon) {
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      }
      btnElement.dataset.ref = 'off';
      if (toolBar) {
        toolBar.style.pointerEvents = 'none';
        toolBar.style.opacity = '0.5';
        toolBar.setAttribute('aria-disabled', 'true');
      }
    }
  },

  _annotationsDomRenderer(history, containerId) {
    let headHtml = history.getHistoryWindowHeadHtml();
    headHtml = headHtml.replace(/<span[^>]*>Annotation List<\/span>\s*/, '');
    $('#annotation-list-mp').html(`<div id="${containerId}" class="position-relative">${headHtml}${history.getHistoryWindowBodyHtml()}</div>`);
  },

  freeFormToolControls() {
    return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush (scroll to change).">Brush radius:</span>
<input class="form-control" title="Size of a brush (scroll to change)." type="number" min="5" max="100" step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.freeFormTool.screenRadius}" style="height: 22px; width: 60px;" onchange="${this.THIS}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">`;
  }
};
