export default {
    identity: (options={}, ...dataIndexes) => ({
        "name": options.name || "Identity overlay",
        "visible": 1,
        "params": options.controls || {},
        ...(options.overrides || {}),
        "type": "identity",
        "dataReferences": dataIndexes,
    }),
    heatmap: (options={}, ...dataIndexes) => ({
        "name": options.name || "Heatmap overlay",
        "visible": 1,
        "params": {
            "color": {
                "type": "color",
                "default": options.value || "#12fbff"
            },
            ...(options.controls || {})
        },
        ...(options.overrides || {}), /*todo generic constructor instead*/
        "type": "heatmap",
        "dataReferences": dataIndexes,
    }),
}