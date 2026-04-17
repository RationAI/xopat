export const ioMethods = {
    _getViewerImportTargets() {
        if (typeof UTILITIES?.getOpenedViewerIOContexts === 'function') {
            return UTILITIES.getOpenedViewerIOContexts();
        }

        const viewers = Array.isArray(VIEWER_MANAGER?.viewers) ? VIEWER_MANAGER.viewers.filter(Boolean) : [];
        return viewers.map((viewer, index) => ({
            viewer,
            index,
            uniqueId: String(viewer?.uniqueId || ''),
            title: String(viewer?.uniqueId || `Viewer ${index + 1}`),
            label: String(viewer?.uniqueId || `Viewer ${index + 1}`),
            fileToken: viewer?.uniqueId ? encodeURIComponent(String(viewer.uniqueId)) : '',
        }));
    },

    async _promptImportTarget(fileName, targets, resolveInfo = undefined) {
        if (!targets.length) return null;

        if (targets.length === 1) {
            const only = targets[0];
            const confirmed = window.confirm(
                `${resolveInfo?.reason || `Import "${fileName}" into the only open viewer?`}\n\n${only.label}`
            );
            return confirmed ? only : null;
        }

        const suggestedId = resolveInfo?.target?.uniqueId || '';
        const lines = targets.map((target, idx) => {
            const suggested = suggestedId && target.uniqueId === suggestedId ? ' — suggested' : '';
            return `${idx + 1}. ${target.label}${suggested}`;
        });

        const defaultChoice = Math.max(1, targets.findIndex((target) => target.uniqueId === suggestedId) + 1 || 1);
        const choice = window.prompt(
            `${resolveInfo?.reason || `Select import target for "${fileName}".`}\n\n` +
            `${lines.join('\n')}\n\n` +
            'Enter the target number. Enter 0 or press Cancel to abort.',
            String(defaultChoice)
        );

        if (choice === null) return null;

        const index = Number.parseInt(choice, 10);
        if (!Number.isInteger(index) || index < 0 || index > targets.length) {
            Dialogs.show('Import cancelled: invalid target selection.', 2500, Dialogs.MSG_WARN);
            return null;
        }

        if (index === 0) return null;
        return targets[index - 1];
    },

    async _resolveImportTarget(file) {
        const targets = this._getViewerImportTargets();
        if (!targets.length) {
            throw new Error('No open viewers available for annotation import.');
        }

        const resolveInfo = typeof UTILITIES?.resolveOpenedViewerFromExportFileName === 'function'
            ? UTILITIES.resolveOpenedViewerFromExportFileName(file?.name || '')
            : { target: null, reason: `Could not resolve a viewer target for "${file?.name || ''}".`, targets };

        if (resolveInfo?.target?.viewer) {
            return resolveInfo.target;
        }

        return await this._promptImportTarget(file?.name || '', targets, resolveInfo);
    },

    async _readAndImportFile(e) {
        const file = e?.target?.files?.[0];
        if (!file) {
            return { cancelled: true };
        }

        const target = await this._resolveImportTarget(file);
        if (!target?.viewer) {
            return { cancelled: true };
        }

        const format = this.exportOptions.format;
        const replace = this.getOption('importReplace', true);
        this.context.setIOOption('format', format);

        const data = await UTILITIES.readFileUploadEvent(e);
        const fabric = this.context.getFabric(target.viewer);
        const result = await fabric.import(data, { format }, replace);

        return {
            cancelled: false,
            result,
            target,
            fileName: file.name,
            format
        };
    },

    importFromFile(e) {
        this._readAndImportFile(e).then((payload) => {
            if (!payload || payload.cancelled) {
                return;
            }

            if (payload.result) {
                Dialogs.show(`Loaded into ${payload.target.title}.`, 1800, Dialogs.MSG_INFO);
            } else {
                Dialogs.show(
                    `No data was imported into ${payload.target.title}. Are you sure the selected format (${payload.format}) matches the file?`,
                    3500,
                    Dialogs.MSG_WARN
                );
            }
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
        const activeViewer = this.context.viewer;
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
        const viewerContext = typeof UTILITIES?.getViewerIOContext === 'function'
            ? UTILITIES.getViewerIOContext(activeViewer)
            : undefined;
        const viewerSuffix = viewerContext?.fileToken ? `--viewer-${viewerContext.fileToken}` : '';
        const name = APPLICATION_CONTEXT.referencedName(true)
            + viewerSuffix + '-' + UTILITIES.todayISOReversed() + '-'
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
