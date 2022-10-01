export default {
    heatmap: (dataIndex, name="Heatmap overlay", value="#12fbff", overrides={}, withControls={}) => ({
        "name": name,
        "type": "heatmap",
        "visible": 1,
        "params": {
            "color": {
                "type": "color",
                "default": value
            },
            ...withControls
        },
        ...overrides, /*todo generic constructor instead*/
        "dataReferences": [dataIndex],
    })
}