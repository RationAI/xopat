(function (window) {
    const withLayers = function() {
        return APPLICATION_CONTEXT.layersAvailable;
    };

    window.USER_INTERFACE.Tutorials.add("", "Basic functionality", "learn how the visualiser works", "foundation", [ {
        'next #viewer-container' : 'You can navigate in the content either using mouse,<br> or via keyboard: arrow keys (movement) and +/- (zoom). Try it out now.'
    },{
        'next #main-panel' : 'On the right, the Main Panel <br> holds most functionality and also allows <br> to interact with plugins.',
    }, {
        'next #navigator-container' : 'An interactive navigator can be used <br> for orientation or to jump quickly on different areas.',
    }, {
        'next #general-controls' : 'The whole visualisation consists of two layers: <br> the background canvas and the data layer above.',
        runIf: function() {return APPLICATION_CONTEXT.config.background.length == 1 && withLayers();}
    },{
        'next #general-controls' : 'You can toggle background visibility <br> and control the data layer opacity. <br> The button on the right clones the viewer and synchronizes the navigation.',
        runIf: withLayers
    }, {
        'next #tissue-list-menu' : 'The viewer supports multiple backgrounds<br>you can switch between if available at the bottom of the screen.',
    }, {
        'click #images-pin' : 'There are several background images available. Click to open.',
        runIf: function () {return APPLICATION_CONTEXT.config.background.length > 1 && APPLICATION_CONTEXT.config.params.stackedBackground;}
    }, {
       'next #panel-images' : 'You can turn them on/off or blend using an opacity slider.',
        runIf: function () {return APPLICATION_CONTEXT.config.background.length > 1 && APPLICATION_CONTEXT.config.params.stackedBackground;}
    }, {
        'next #panel-shaders': 'The data layer <br>-the core visualisation functionality-<br> is highly flexible and can be controlled here.',
        runIf: withLayers
    }, {
        'click #shaders-pin': 'Click to set <br>this controls subpanel to be always visible.',
        runIf: withLayers
    }, {
        'next #shaders': 'In case multiple different visualisations <br>are set, you can select <br>which one is being displayed.',
        runIf: withLayers
    }, {
        'next #data-layer-options': 'Each visualisation consists of several <br>data parts and their interpretation. <br>Here, you can control each part separately, <br>and also drag-n-drop to reorder.',
        runIf: withLayers
    }, {
        'next #cache-snapshot': 'Your settings can be saved here. <br> This feature works only with enabled cookies. <br> Saved adjustments are applied on layers of the same name.',
        runIf: withLayers
    }, {
        'next #copy-url' : 'Your setup can be shared with a link.'
    },{
        'next #global-export' : 'You can share also a file: this option <br>includes (most) plugins data too (unlike URL sharing). <br> That means, if you export a file with <br> drawn annotations, these will be included too.'
    },{
        'next #global-help' : 'That\'s all for now.<br> For more functionality, see Plugins menu. <br> With attached plugins, more tutorials will appear here.'
    }], function() {
        if (withLayers()) {
            //prerequisite - pin in default state
            let pin = $("#shaders-pin");
            let container = pin.parents().eq(1).children().eq(1);
            pin.removeClass('pressed');
            container.removeClass('force-visible');
        }
    });
})(window);