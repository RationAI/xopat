OSDAnnotations.Convertor.register("native", class extends OSDAnnotations.Convertor.IConvertor {
    static title = 'xOpat Annotations';
    static description = 'Native Annotations Format';

    static includeAllAnnotationProps = false;

    static getFileName(context) {
        return 'annotations_' + UTILITIES.todayISO() + '.json';
    }

    static encodeFinalize(output) {
        return JSON.stringify({
            metadata: {
                version: OSDAnnotations.instance().version,
                created: Date.now(),
            },
            ...output
        });
    }

    async encodePartial(annotationsGetter, presetsGetter, annotationsModule, options) {
        let presets = options.exportsPresets ? presetsGetter() : undefined;
        let annotations = options.exportsObjects ? annotationsGetter() : undefined;
        if (options.serialize) {
            presets = presets ? JSON.stringify(presets) : undefined;
            annotations = annotations ? JSON.stringify(annotations) : undefined;
        }

        return {
            objects: annotations,
            presets: presets
        };
    }

    async decode(data, annotationsModule, options) {
        return JSON.parse(data);
    }
});
