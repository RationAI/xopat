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
                "default": options.value || "#fff312"
            },
            ...(options.controls || {})
        },
        ...(options.overrides || {}), /*todo generic constructor instead*/
        "type": "heatmap",
        "dataReferences": dataIndexes,
    }),
    edge: (options={}, ...dataIndexes) => ({
        "name": options.name || "Edge overlay",
        "visible": 1,
        "params": {
            "color": {
                "type": "color",
                "default": options.value || "#12fbff"
            },
            ...(options.controls || {})
        },
        ...(options.overrides || {}), /*todo generic constructor instead*/
        "type": "edge",
        "dataReferences": dataIndexes,
    }),
    bipolarHeatmap: (options={}, ...dataIndexes) => ({
        "name": options.name || "Bipolar heatmap overlay",
        "visible": 1,
        "params": {
            "colorHigh": {
                "type": "color",
                "default": options.valueHigh || "#ff1255"
            },
            "colorLow": {
                "type": "color",
                "default": options.valueLow || "#6dff12"
            },
            ...(options.controls || {})
        },
        ...(options.overrides || {}), /*todo generic constructor instead*/
        "type": "bipolar-heatmap",
        "dataReferences": dataIndexes,
    }),
}