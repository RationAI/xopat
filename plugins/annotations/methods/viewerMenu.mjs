import { createCommentsWindow, finalizeCommentsWindowMount } from '../comments/commentsWindow.mjs';

export const viewerMenuMethods = {
  setDrawOutline(enable) {
    // todo no way to change this for a single viewer for now -> presets are global
    this.context.setAnnotationCommonVisualProperty('modeOutline', enable);
  },

  setEdgeCursorNavigate(enable, viewerId) {
    enable = this.context.getFabric(viewerId)?.setCloseEdgeMouseNavigation(enable) || false;
    this.setOption('edgeCursorNavigate', enable);
    return enable;
  },

  _toggleStrokeStyling(enable) {
    const authorButton = $('#author-list-button-mp');
    const isAuthorsTabActive = authorButton.attr('aria-selected') === 'true';

    if (enable) {
      authorButton.show();
    } else {
      authorButton.hide();
      if (isAuthorsTabActive) {
        this.switchMenuList('preset');
      }
    }
  },

  initHTML() {
    USER_INTERFACE.addHtml(createCommentsWindow(this), this.id);
    finalizeCommentsWindowMount(this);

    this.context.addHandler('annotation-selected', (e) => this._annotationSelected(e.object));
    this.context.addHandler('annotation-deselected', (e) => this._annotationDeselected(e.object));

    // as a last resort save by exporting to a file
    this.context.addHandler('save-annotations', async (e) => {
      await this.exportToFile();
      e.setHandled(this.t('annotations.export.downloadFallbackHandled'));
    }, null, -Infinity);

    this.registerViewerMenu((viewer) => {
      const UI = globalThis.UI;

      const topRow = new UI.Div({ extraClasses: 'flex flex-row items-center justify-between w-full mb-2 px-1' },
        new UI.Button({
          id: 'enable-disable-annotations',
          type: UI.Button.TYPE.NONE,
          extraClasses: 'btn-square btn-sm',
          extraProperties: {
            title: this.t('annotations.viewerMenu.toggleVisibility'),
            'data-ref': 'on'
          },
          onClick: (e) => this._toggleEnabled(e.currentTarget)
        }, new UI.FAIcon('fa-eye')),
        new UI.Button({
          id: 'btn-toggle-outline',
          type: UI.Button.TYPE.NONE,
          extraClasses: `btn-square btn-sm ${this.context.getAnnotationCommonVisualProperty('modeOutline') ? 'btn-active' : ''}`,
          extraProperties: { title: this.t('annotations.viewerMenu.outlineOnly') },
          onClick: (e) => {
            const btn = e.target.closest('button');
            const isActive = btn.classList.toggle('btn-active');
            this.setDrawOutline(isActive);
          }
        }, new UI.FAIcon('fa-vector-square')),
        new UI.Button({
          id: 'btn-toggle-edge-nav',
          type: UI.Button.TYPE.NONE,
          extraClasses: `btn-square btn-sm ${this.getOption('edgeCursorNavigate', true) ? 'btn-active' : ''}`,
          extraProperties: { title: this.t('annotations.viewerMenu.edgeNavigation') },
          onClick: (e) => {
            const btn = e.target.closest('button');
            const isActive = btn.classList.toggle('btn-active');
            this.setEdgeCursorNavigate(isActive, viewer.uniqueId);
          }
        }, new UI.FAIcon('fa-up-down-left-right')),
        new UI.Button({
          id: 'server-primary-save',
          title: this.t('annotations.viewerMenu.save'),
          type: UI.Button.TYPE.NONE,
          style: UI.Button.STYLE.TITLEICON,
          extraClasses: 'btn-square btn-sm',
          extraProperties: { title: this.t('annotations.viewerMenu.save') },
          onClick: () => this.context.requestExport()
            .then((msg) => Dialogs.show(msg))
            .catch((e) => Dialogs.show(`${this.t('annotations.export.saveFailed')} ${e.message}`, 5000, Dialogs.MSG_ERR))
        }, new UI.FAIcon('fa-floppy-disk')),
        new UI.Button({
          id: 'show-annotation-export',
          type: UI.Button.TYPE.NONE,
          extraClasses: 'btn-square btn-sm',
          extraProperties: { title: this.t('annotations.viewerMenu.moreOptions') },
          onClick: () => USER_INTERFACE.AppBar.Plugins.openSubmenu(this.id, 'annotations-shared')
        }, new UI.FAIcon('fa-ellipsis-vertical'))
      );

      const slidersRow = new UI.Div({ extraClasses: 'flex flex-row w-full gap-2 mb-2' },
        new UI.Div({ extraClasses: 'flex-1' },
          new UI.Div({ extraClasses: 'text-xs mb-1 opacity-70' }, this.t('annotations.viewerMenu.border')),
          new UI.Input({
            id: 'annotations-border-width',
            extraClasses: 'range range-xs range-primary w-full',
            extraProperties: { type: 'range', min: '1', max: '10', step: '1' }
          })
        ),
        new UI.Div({ extraClasses: 'flex-1' },
          new UI.Div({ extraClasses: 'text-xs mb-1 opacity-70' }, this.t('annotations.viewerMenu.opacity')),
          new UI.Input({
            id: 'annotations-opacity',
            extraClasses: 'range range-xs range-primary w-full',
            extraProperties: { type: 'range', min: '0', max: '1', step: '0.1' }
          })
        )
      );

      const tabs = new UI.Join({ style: UI.Join.STYLE.HORIZONTAL, extraClasses: 'w-full border-b border-base-300' },
        new UI.Button({
          id: 'preset-list-button-mp',
          extraClasses: 'rounded-0 border-b-0 flex-1 btn-sm',
          extraProperties: { 'aria-selected': 'true' },
          onClick: () => this.switchMenuList('preset')
        }, this.t('annotations.viewerMenu.tabs.classes')),
        new UI.Button({
          id: 'annotation-list-button-mp',
          extraClasses: 'rounded-0 border-b-0 flex-1 btn-sm',
          onClick: () => this.switchMenuList('annot')
        }, this.t('annotations.viewerMenu.tabs.annotations')),
        new UI.Button({
          id: 'author-list-button-mp',
          extraClasses: 'rounded-0 border-b-0 flex-1 btn-sm',
          extraProperties: { style: 'display: none;' },
          onClick: () => this.switchMenuList('authors')
        }, this.t('annotations.viewerMenu.tabs.authors'))
      );

      const presetList = new UI.Div({ id: 'preset-list-mp', extraClasses: 'flex-1 pl-2 pr-1 mt-2 relative' },
        new UI.Button({
          id: 'preset-list-mp-edit',
          size: UI.Button.SIZE.TINY,
          extraClasses: 'absolute top-0 right-4 border rounded shadow-sm z-10 bg-base-100',
          onClick: () => this.showPresets()
        },
        new UI.FAIcon({ name: 'fa-pen-to-square', extraClasses: 'text-xs mr-1' }),
        this.t('annotations.viewerMenu.editPresets')),
        new UI.Div({ id: 'preset-list-inner-mp' })
      );

      const annotList = new UI.Div({
        id: 'annotation-list-mp',
        extraClasses: 'mx-2 mt-2',
        extraProperties: { style: 'display: none;' }
      });

      const authorList = new UI.Div({
        id: 'author-list-mp',
        extraClasses: 'mx-2 mt-2',
        extraProperties: { style: 'display: none;' }
      }, new UI.Div({ id: 'author-list-inner-mp' }));

      return {
        id: this.id,
        title: this.t('annotations.viewerMenu.title'),
        icon: 'fa-question-circle',
        body: new UI.Div({ extraClasses: 'flex flex-col w-full h-full' },
          topRow,
          slidersRow,
          tabs,
          presetList,
          annotList,
          authorList
        )
      };
    });

    setTimeout(() => {
      const ui = window.UI;
      const modes = this.context.Modes;

      const gHistory = new ui.ToolbarGroup({ id: 'g-history' },
        new ui.ToolbarItem({
          id: 'toolbar-history-undo',
          icon: 'fa-rotate-left',
          label: this.t('annotations.toolbar.undo'),
          onClick: () => this.context.undo()
        }),
        new ui.ToolbarItem({
          id: 'toolbar-history-redo',
          icon: 'fa-rotate-right',
          label: this.t('annotations.toolbar.redo'),
          onClick: () => this.context.redo()
        }),
        new ui.ToolbarItem({
          id: 'toolbar-history-board',
          icon: 'fa-list',
          label: this.t('annotations.toolbar.history'),
          onClick: () => this.switchMenuList('annot')
        }),
        new ui.ToolbarItem({
          id: 'toolbar-history-metrics',
          icon: 'fa-square-poll-horizontal',
          label: this.t('annotations.toolbar.measurements'),
          onClick: () => this.showMeasurementsWindow()
        })
      );

      const factories = this._allowedFactories
        .map((factoryId) => this.context.getAnnotationObjectFactory(factoryId))
        .filter(Boolean);

      const gModes = new ui.ToolbarGroup({
        itemID: 'g-modes',
        selectable: true,
        defaultSelected: modes.AUTO.getId(),
        extraClasses: { padding: 'mx-2' }
      });

      new ui.ToolbarItem({
        itemID: modes.AUTO.getId(),
        icon: modes.AUTO.getIcon(),
        label: modes.AUTO.getDescription(),
        onClick: () => {
          this.switchModeActive(modes.AUTO.getId());
        }
      }).attachTo(gModes);

      this._shapeChoice = new ui.ToolbarChoiceGroup({
        headerMode: 'selectOrExpand',
        itemID: 'cg-shapes',
        defaultSelected: factories[0]?.id || 'none',
        onChange: (factoryId) => {
          this.switchModeActive(modes.CUSTOM.getId(), factoryId, true);
        }
      }, ...factories.map((factory) => new ui.ToolbarItem({
        itemID: factory.factoryID,
        icon: factory.getIcon(),
        label: `${modes.CUSTOM.getDescription()}: ${factory.title()}`
      }))).attachTo(gModes);

      this._gBrush = new ui.ToolbarGroup({ id: 'g-brush', itemID: 'g-brush', selectable: true },
        new ui.ToolbarItem({
          itemID: modes.FREE_FORM_TOOL_ADD.getId(),
          icon: modes.FREE_FORM_TOOL_ADD.getIcon(),
          label: modes.FREE_FORM_TOOL_ADD.getDescription(),
          onClick: () => {
            this.switchModeActive(modes.FREE_FORM_TOOL_ADD.getId());
          },
          extraClasses: { icon: 'thumb-add' }
        }),
        new ui.ToolbarItem({
          itemID: modes.FREE_FORM_TOOL_REMOVE.getId(),
          icon: modes.FREE_FORM_TOOL_REMOVE.getIcon(),
          label: modes.FREE_FORM_TOOL_REMOVE.getDescription(),
          onClick: () => {
            this.switchModeActive(modes.FREE_FORM_TOOL_REMOVE.getId());
          },
          extraClasses: { icon: 'thumb-remove' }
        })
      ).attachTo(gModes);

      this._autoChoice = new ui.ToolbarChoiceGroup({
        itemID: 'cg-auto',
        defaultSelected: modes.MAGIC_WAND.getId(),
        onChange: (id) => {
          this.switchModeActive(id);
        }
      },
      new ui.ToolbarItem({
        itemID: modes.MAGIC_WAND.getId(),
        icon: modes.MAGIC_WAND.getIcon(),
        label: modes.MAGIC_WAND.getDescription()
      }),
      new ui.ToolbarItem({
        itemID: modes.FREE_FORM_TOOL_CORRECT.getId(),
        icon: modes.FREE_FORM_TOOL_CORRECT.getIcon(),
        label: modes.FREE_FORM_TOOL_CORRECT.getDescription()
      }),
      new ui.ToolbarItem({
        itemID: modes.VIEWPORT_SEGMENTATION.getId(),
        icon: modes.VIEWPORT_SEGMENTATION.getIcon(),
        label: modes.VIEWPORT_SEGMENTATION.getDescription()
      })).attachTo(gModes);
      this._gModes = gModes;

      this._htmlWrap = new UI.RawHtml({
        id: `${this.id}-mode-options-html`,
        extraClasses: { base: 'w-full h-full text-sm' }
      }, this.context.mode.customHtml() || '');

      this._modeOptionsPanel = new UI.ToolbarPanelButton({
        id: 'mode-options',
        itemID: 'mode-options',
        icon: 'fa-sliders',
        label: this.t('annotations.toolbar.modeOptions'),
        panelClass: 'w-80 max-h-[60vh] overflow-y-auto space-y-2',
        onToggle: (open) => {
          if (!open) this._forceCloseModeOptions = true;
        }
      }, this._htmlWrap);

      USER_INTERFACE.Tools.setMenu(this.id, 'annotations-tool-bar', this.t('annotations.toolbar.title'),
        [gHistory, new UI.ToolbarSeparator(), gModes, new UI.ToolbarSeparator(), this._modeOptionsPanel],
        'draw'
      );
    }, 2000);

    USER_INTERFACE.AppBar.Plugins.setMenu(this.id, 'annotations-shared', this.t('annotations.export.menuTitle'),
      `<h3 class="f2-light">${this.t('annotations.export.menuTitle')} <span class="text-small" id="gui-annotations-io-tissue-name">${this.t('annotations.export.forSlide', { slide: this.activeTissue })}</span></h3><br>
<span class="text-small">${this.t('annotations.export.description')}</span>
<div id="annotations-shared-head"></div><div id="available-annotations"></div>
<br>
<h4 class="f3-light header-sep">${this.t('annotations.export.fileSection')}</h4><br>
<div>${this.exportOptions.availableFormats.map((o) => this.getIOFormatRadioButton(o)).join('')}</div>
<div id="annotation-convertor-options"></div>
<div id="export-annotations-scope" class="mt-2">
  <span class="text-small mr-2">${this.t('annotations.export.scopeLabel')}</span>
  ${['all', 'selected'].map((s) => this.getExportScopeRadioButton(s)).join('')}
</div>
<br>
${UIComponents.Elements.checkBox({ label: this.t('annotations.export.replaceOnImport'), onchange: this.THIS + ".setOption('importReplace', !!this.checked)", default: this.getOption('importReplace', true) })}
<br><br>
<div id="annotations-local-export-panel">
  <button id="importAnnotation" onclick="this.nextElementSibling.click();return false;" class="btn"></button>
  <input type='file' style="visibility:hidden; width: 0; height: 0;" onchange="${this.THIS}.importFromFile(event);$(this).val('');" />
  &emsp;&emsp;
  <button id="downloadPreset" onclick="${this.THIS}.exportToFile(false, true);return false;" class="btn">${this.t('annotations.export.downloadPresets')}</button>&nbsp;
  <button id="downloadAnnotation" onclick="${this.THIS}.exportToFile(true, true);return false;" class="btn">${this.t('annotations.export.downloadAnnotations')}</button>&nbsp;
</div>
<h4 class="f3-light header-sep">${this.t('annotations.comments.title')}</h4><br>
${UIComponents.Elements.checkBox({ label: this.t('annotations.comments.enable'), onchange: this.THIS + '.enableComments(!!this.checked)', default: this._commentsEnabled })}
${UIComponents.Elements.checkBox({ label: this.t('annotations.comments.autoOpen'), onchange: this.THIS + '.commentsDefaultOpen(!!this.checked)', default: this._commentsDefaultOpened })}
<div class="flex gap-2 justify-between">
  <span>${this.t('annotations.comments.rememberState')}</span>
  ${UIComponents.Elements.select({
    default: this._commentsClosedMethod,
    options: {
      none: this.t('annotations.comments.rememberOptions.none'),
      global: this.t('annotations.comments.rememberOptions.global'),
      individual: this.t('annotations.comments.rememberOptions.individual')
    },
    changed: this.THIS + '.switchCommentsClosedMethod(value)'
  })}
</div>`);

    this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel('available-annotations');
    this.updateSelectedFormat(this.exportOptions.format);
    this.updatePresetsHTML();

    this.context.addHandler('author-annotation-styling-toggle', (e) => this._toggleStrokeStyling(e.enable));
    this.context.addHandler('comments-control-clicked', () => this.commentsToggleWindow());
    this.context.addHandler('annotation-updated-comment', () => this._renderComments());
    this._toggleStrokeStyling(this.context.strokeStyling);
  },

  getExportScopeRadioButton(scope) {
    const id = `export-scope-${scope}-radio`;
    const label = scope === 'all' ? this.t('annotations.export.scopeOptions.all') : this.t('annotations.export.scopeOptions.selected');
    const checked = this.exportOptions.scope === scope ? 'checked' : '';
    return `
      <div class="d-inline-block p-2">
        <input type="radio" id="${id}" class="d-none switch" ${checked} name="annotation-scope-switch">
        <label for="${id}" class="position-relative format-selector" onclick="${this.THIS}.setExportScope('${scope}');">
          <span class="btn">${label}</span>
        </label>
      </div>`;
  },

  getIOFormatRadioButton(format) {
    const selected = format === this.exportOptions.format ? 'checked' : '';
    const convertor = OSDAnnotations.Convertor.get(format);
    return `<div class="d-inline-block p-2"><input type="radio" id="${format}-export-format" class="hidden switch" ${selected} name="annotation-format-switch">
<label for="${format}-export-format" class="position-relative format-selector" title="${convertor.description || ''}" onclick="${this.THIS}.updateSelectedFormat('${format}');"><span style="font-size: smaller">${convertor.title}</span><br>
<span class="show-hint d-inline-block" data-hint="${this.t('annotations.export.formatHint')}"><span class="btn">${format}</span></span></label></div>`;
  },

  updateSelectedFormat(format) {
    const convertor = OSDAnnotations.Convertor.get(format);
    document.getElementById('downloadAnnotation').style.visibility = convertor.exportsObjects ? 'visible' : 'hidden';
    document.getElementById('downloadPreset').style.visibility = convertor.exportsPresets ? 'visible' : 'hidden';
    const scopeEl = document.getElementById('export-annotations-scope');
    if (scopeEl) scopeEl.style.display = convertor.exportsObjects ? 'block' : 'none';

    document.getElementById('importAnnotation').innerHTML = this.t('annotations.export.importFileButton', { format });
    this.exportOptions.format = format;
    this.setCacheOption('defaultIOFormat', format);
    $('#annotation-convertor-options').html(
      Object.values(convertor.options).map((option) => UIComponents.Elements[option.type]?.(option)).join('<br>')
    );
  }
};
