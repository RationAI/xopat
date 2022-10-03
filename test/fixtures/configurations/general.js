export default {
    data: (key) => ({
        'book': ["https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"],
        'tissue': [
            'cypress/tissue.tif',
            'cypress/annotation.tif',
            'cypress/probability.tif',
            'cypress/explainability.tif',
        ],
        'invalid': [
            'some-bad!-data1',
            'some-bad-data24&',
        ]
    }[key]),
    background: (overrides, ...dataIndexes) => {
        return dataIndexes.map(i => ({
            "dataReference": i,
            "lossless": false,
            ...overrides
        }));
    },
    visualization: (overrides, ...shaders) => ({
        name: "The Visualization Layers.",
        ...overrides,
        shaders: {
            ...shaders
        }
    }),
    params: (overrides) => ({
        customBlending: false,
        debugMode: false,
        webglDebugMode: false,
        scaleBar: true,
        microns: undefined,
        viewport: undefined,
        activeBackgroundIndex: 0,
        activeVisualizationIndex: 0,
        grayscale: false,
        tileCache: true,
        preventNavigationShortcuts: false,
        permaLoadPlugins: true,
        bypassCookies: true, //by default tests do not work with cookies
        theme: "auto",
        stackedBackground: false,
        ...overrides
    }),
    viewport: (key, index) => ({
        book: [
            {"zoomLevel":1.856327727513599,"point":{"x":0.5865508469133377,"y":0.6628850942200756}}
        ],
        tissue: [
            {"zoomLevel":9.072336450540966,"point":{"x":0.30969351493546343,"y":0.5272290789301906}}
        ]
    })[key][index],

}