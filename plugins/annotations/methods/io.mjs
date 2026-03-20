export const ioMethods = {
  importFromFile(e) {
    const _this = this;
    this.context.setIOOption('format', this.exportOptions.format);
    UTILITIES.readFileUploadEvent(e).then(async (data) => {
      return await _this.context.fabric.import(data, undefined, this.getOption('importReplace', true));
    }).then((result) => {
      Dialogs.show(result ? 'Loaded.' : 'No data was imported! Are you sure you have a correct format set?', 1500, result ? Dialogs.MSG_INFO : Dialogs.MSG_WARN);
    }).catch((error) => {
      console.log(error);
      Dialogs.show('Failed to load the file. Is the selected file format correct and the file valid?', 5000, Dialogs.MSG_ERR);
    });
  },

  async getExportData(options = null, withObjects = true, withPresets = true) {
    options.scopeSelected = this.exportOptions.scope === 'selected' || false;
    return this.context.fabric.export(options, withObjects, withPresets);
  },

  async exportToFile(withObjects = true, withPresets = true) {
    const toFormat = this.exportOptions.format;
    let scope = 'all';
    let selectedItems = [];
    if (withObjects) {
      scope = this.exportOptions.scope === 'selected' ? 'selected' : 'all';
      if (scope === 'selected') {
        const selectedAnns = (this.context.fabric.getSelectedAnnotations?.() || []);
        const layers = (this.context.fabric.getSelectedLayers?.() || []).filter(Boolean);
        const layerAnns = layers.length ? layers.flatMap((l) => l.getObjects?.() || []) : [];

        const seen = new Set();
        const pushUnique = (arr) => {
          for (const object of arr) {
            const key = String(object?.incrementId ?? '');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            selectedItems.push(object);
          }
        };

        pushUnique(selectedAnns);
        pushUnique(layerAnns);
        if (!selectedItems.length) {
          Dialogs.show('No annotations selected to export.', 2500, Dialogs.MSG_WARN);
          return;
        }
      }
    }

    selectedItems = selectedItems.map((o) => o.id);
    const scopeSuffix = withObjects && scope === 'selected' ? '-selection' : '';
    const name = APPLICATION_CONTEXT.referencedName(true)
      + '-' + UTILITIES.todayISOReversed() + '-'
      + (withPresets && withObjects ? 'all' : (withObjects ? 'annotations' : 'presets'))
      + scopeSuffix;

    const ioArgs = {};
    if (toFormat) ioArgs.format = toFormat;
    if (withObjects && scope === 'selected') ioArgs.filter = { ids: selectedItems };

    return this.getExportData(ioArgs, withObjects, withPresets).then((result) => {
      UTILITIES.downloadAsFile(name + this.context.getFormatSuffix(toFormat), result);
    }).catch((error) => {
      if (error?.code === 'EXPORT_NO_SELECTION') {
        Dialogs.show('No annotations selected to export.', 2500, Dialogs.MSG_WARN);
        return;
      }
      Dialogs.show('Could not export annotations in the selected format.', 5000, Dialogs.MSG_WARN);
      console.error(error);
    });
  },

  setExportScope(scope) {
    this.exportOptions.scope = scope === 'selected' ? 'selected' : 'all';
    $('#export-scope-all-radio').prop('checked', this.exportOptions.scope === 'all');
    $('#export-scope-selected-radio').prop('checked', this.exportOptions.scope === 'selected');
  },

  RightSideMenuVisibleControls() {
    return `
<div style="float: right; transform: translateY(-5px);">
<span id="annotations-left-click" class="d-inline-block position-relative mt-1 ml-2 border-md rounded-3" style="cursor:pointer;border-width:3px!important;"></span>
<span id="annotations-right-click" class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3" style="cursor:pointer;border-width:3px!important;"></span>
</div>`;
  }
};
