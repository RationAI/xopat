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

    async _resolveImportTarget(file, hintViewerOrId = undefined) {
        const targets = this._getViewerImportTargets();
        if (!targets.length) {
            throw new Error('No open viewers available for annotation import.');
        }

        // Caller-supplied hint (e.g. the settings panel's "Into slide:" select)
        // bypasses auto-resolution and the user prompt entirely.
        if (hintViewerOrId !== undefined && hintViewerOrId !== null) {
            const hintId = String(hintViewerOrId?.uniqueId ?? hintViewerOrId);
            const match = targets.find(t => String(t.uniqueId) === hintId);
            if (match) return match;
        }

        const resolveInfo = typeof UTILITIES?.resolveOpenedViewerFromExportFileName === 'function'
            ? UTILITIES.resolveOpenedViewerFromExportFileName(file?.name || '')
            : { target: null, reason: `Could not resolve a viewer target for "${file?.name || ''}".`, targets };

        if (resolveInfo?.target?.viewer) {
            return resolveInfo.target;
        }

        return await this._promptImportTarget(file?.name || '', targets, resolveInfo);
    },

    async _readAndImportFile(e, hintViewerOrId = undefined) {
        const file = e?.target?.files?.[0];
        if (!file) {
            return { cancelled: true };
        }

        const target = await this._resolveImportTarget(file, hintViewerOrId);
        if (!target?.viewer) {
            return { cancelled: true };
        }

        const requestedFormat = this.exportOptions.format;
        const replace = this.getOption('importReplace', true);
        if (requestedFormat && requestedFormat !== 'auto') {
            this.context.setIOOption('format', requestedFormat);
        }

        // Read from the captured File reference, not from the event: the input's
        // onchange handler typically clears e.target.value synchronously right after
        // dispatching importFromFile, so e.currentTarget.files is empty by the time
        // any await resumes here. The File blob captured above is independent.
        const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = ev => resolve(ev.target?.result);
            reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
            reader.readAsText(file);
        });
        const fabric = this.context.getFabric(target.viewer);
        // fabric.import mutates options.format to the resolved format (relevant
        // for auto-detect); pass a fresh options object so we can read it back.
        const importOptions = { format: requestedFormat, filename: file.name };
        const result = await fabric.import(data, importOptions, replace);

        return {
            cancelled: false,
            result,
            target,
            fileName: file.name,
            requestedFormat,
            resolvedFormat: importOptions.format
        };
    },

    importFromFile(e, hintViewerOrId = undefined) {
        this._readAndImportFile(e, hintViewerOrId).then((payload) => {
            if (!payload || payload.cancelled) {
                return;
            }

            if (payload.result) {
                const sameFormat = payload.requestedFormat === payload.resolvedFormat
                    || payload.requestedFormat === 'auto';
                const msg = sameFormat
                    ? `Loaded into ${payload.target.title} as ${payload.resolvedFormat}.`
                    : `Loaded into ${payload.target.title} as ${payload.resolvedFormat} (you selected ${payload.requestedFormat}).`;
                Dialogs.show(msg, 2200, Dialogs.MSG_INFO);
            } else {
                const fmt = payload.requestedFormat === 'auto'
                    ? 'auto-detect'
                    : payload.requestedFormat;
                Dialogs.show(
                    `No data was imported into ${payload.target.title}. Are you sure the selected format (${fmt}) matches the file?`,
                    3500,
                    Dialogs.MSG_WARN
                );
            }
        }).catch((error) => {
            console.log(error);
            const fmt = this.exportOptions.format;
            const msg = fmt && fmt !== 'auto'
                ? `Failed to load the file as ${fmt}. Is the selected file format correct and the file valid?`
                : 'Failed to load the file. Could not auto-detect a matching format.';
            Dialogs.show(msg, 5000, Dialogs.MSG_ERR);
        });
    },

    async getExportData(options = null, withObjects = true, withPresets = true, fabric = null) {
        options.scopeSelected = this.exportOptions.scope === 'selected' || false;
        return (fabric || this.context.fabric).export(options, withObjects, withPresets);
    },

    async exportToFile(withObjects = true, withPresets = true, viewerOrId = undefined) {
        const toFormat = this.exportOptions.format;
        const fabric = (viewerOrId !== undefined && viewerOrId !== null)
            ? this.context.getFabric(viewerOrId)
            : this.context.fabric;
        const activeViewer = fabric?.viewer || this.context.viewer;
        let scope = 'all';
        let selectedItems = [];
        if (withObjects) {
            scope = this.exportOptions.scope === 'selected' ? 'selected' : 'all';
            if (scope === 'selected') {
                const selectedAnns = (fabric.getSelectedAnnotations?.() || []);
                const layers = (fabric.getSelectedLayers?.() || []).filter(Boolean);
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

        return this.getExportData(ioArgs, withObjects, withPresets, fabric).then((result) => {
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
