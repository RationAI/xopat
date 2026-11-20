IO_PIPELINE.formats.register({
    domain: "annotations",
    id: "native",
    title: 'xOpat Annotations',
    description: 'Native Annotations Format',
    extensions: [".json"],
    contentType: "application/json",
    traits: { allProps: false },

    encode(model) {
        //todo consider as global-level option, data would arrive trimmed...
        return JSON.stringify({
            metadata: {
                version: OSDAnnotations.instance().version,
                created: Date.now(),
            },
            objects: model.objects,
            presets: OSDAnnotations.Convertor.filterUnusedPresets(model.objects, model.presets),
        });
    },

    //todo some servers decode data :/ breaks api
    decode(data) {
        return typeof data === "string" ? JSON.parse(data) : data;
    },

    // Native is the one format that would "accept" any JSON and import
    // nothing, so it must say no to JSON that is plainly something else.
    sniff(_data, hint) {
        const json = hint.json;
        if (Array.isArray(json)) return json.some(o => o?.type === "Feature") ? 0 : 0.4;
        if (!json || typeof json !== "object") return 0;
        if (!Array.isArray(json.objects) && !Array.isArray(json.presets)) return 0;
        return json.metadata ? 0.95 : 0.8;
    },
});
