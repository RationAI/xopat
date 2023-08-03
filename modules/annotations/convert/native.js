OSDAnnotations.Convertor.register("native", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'xOpat Annotations';
    static description = 'Native Annotations Format';

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.json';
    }

    static exports() {
        return ['objects', 'presets'];
    }

    async encode(annotationsGetter, presetsGetter, annotationsModule, options) {
        const presets = presetsGetter();
        const annotations = annotationsGetter();

        const result = {};
        result.metadata = {
            version: annotationsModule.version,
            created: Date.now(),
        };
        if (annotations) {
            result.objects = annotations;
        }
        if (presets) {
            result.presets = presets;
        }
        return JSON.stringify(result);
    }

    async decode(data, annotationsModule, options) {
        return JSON.parse(data);
    }
});
