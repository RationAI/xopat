export default {
    data: (key) => ({
        'book': ["https://libimages1.princeton.edu/loris/pudl0001%2F4609321%2Fs42%2F00000001.jp2/info.json"],
        'tissue': [
            Cypress.env('wsi_tissue'),
            Cypress.env('wsi_annotation'),
            Cypress.env('wsi_probability'),
            Cypress.env('wsi_explainability'),
        ],
        'invalid': [
            'some-bad!-data1',
            'some-bad-data24&',
        ],
        'even-indexes-valid-only': [
            Cypress.env('wsi_tissue'),
            'some-bad-data24&',
            Cypress.env('wsi_annotation'),
            'some-bad!-data1',
        ]
    }[key]),
    //todo: fix: book fails because we parse it with deepzoom, try to have stable data to check, test instead raw image!
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
        locale: "en",
        customBlending: false,
        debugMode: false,
        webglDebugMode: false,
        scaleBar: true,
        statusBar: true,
        viewport: undefined,
        activeBackgroundIndex: 0,
        activeVisualizationIndex: 0,
        grayscale: false,
        tileCache: true,
        preventNavigationShortcuts: false,
        permaLoadPlugins: false,
        bypassCookies: true, //by default tests do not work with cookies
        theme: "dark",
        stackedBackground: false,
        maxImageCacheCount: 1200,
        webGlPreferredVersion: "2.0",
        headers: {},
        preferredFormat: "zip",
        fetchAsync: false,
        ...overrides
    }),
    viewport: (key, index) => ({
        book: [
            {"zoomLevel":1.856327727513599,"point":{"x":0.5865508469133377,"y":0.6628850942200756}}
        ],
        tissue: [
            {"zoomLevel":6.300233646209005,"point":{"x":0.32962356991800645,"y":0.44177267064294934}},
            {"zoomLevel":9.072336450540966,"point":{"x":0.30969351493546343,"y":0.5272290789301906}}
        ]
    })[key][index],
}
