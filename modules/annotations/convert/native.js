IO_PIPELINE.formats.register({
    domain: "annotations",
    id: "native",
    title: 'xOpat Annotations',
    description: 'Native Annotations Format',
    extensions: [".json"],
    contentType: "application/json",
    traits: { allProps: false },

    encode(model, fctx) {
        // `toModel` always carries the presets (other formats read a feature's
        // class from them); whether to WRITE them is the caller's `withPresets`,
        // which arrives here as `exportsPresets`.
        const withPresets = fctx?.options?.exportsPresets !== false;
        //todo consider as global-level option, data would arrive trimmed...
        return JSON.stringify({
            metadata: {
                version: OSDAnnotations.instance().version,
                created: Date.now(),
            },
            objects: model.objects,
            // Each object already names its layer; this list is for what objects
            // cannot carry — a layer with nothing in it, and which one is active.
            layers: model.layers,
            activeLayerId: model.activeLayerId,
            presets: withPresets
                ? OSDAnnotations.Convertor.filterUnusedPresets(model.objects, model.presets)
                : undefined,
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
