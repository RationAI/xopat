<?php

if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}

require_once("config.php");
require_once("plugins.php");
$version = VERSION;

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function isFlagInProtocols($flag) {
    return (hasKey($_GET, $flag) ? $_GET[$flag] : (hasKey($_POST, $flag) ? $_POST[$flag] : false));
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        session_start();
        $_SESSION['title'] = $title;
        $_SESSION['description'] = $description;
        $_SESSION['details'] = $details;
        header('Location: error.php');
        exit;
    }
}

function ensureDefined($object, $property, $default) {
    if (!isset($object->{$property})) {
        $object->{$property} = $default;
    }
}

/**
 * Redirection: based on parameters, either setup visualisation or redirect
 */

$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] : false;
throwFatalErrorIf(!$visualisation, "Invalid link.", "The request has no setup data. See POST data:",
        print_r($_POST, true));

/**
 * Parsing: verify valid parameters
 */

$parsedParams = json_decode($visualisation);
throwFatalErrorIf(!$parsedParams, "Invalid link.", "The visualisation setup is not parse-able.", $visualisation);

ensureDefined($parsedParams, "params", (object)array());
ensureDefined($parsedParams, "data", array());
ensureDefined($parsedParams, "background", array());
ensureDefined($parsedParams, "shaderSources", array());
ensureDefined($parsedParams, "plugins", (object)array());

$bypassCookies = isset($parsedParams->params->bypassCookies) && $parsedParams->params->bypassCookies;
$cookieCache = isset($_COOKIE["_cache"]) && !$bypassCookies ? json_decode($_COOKIE["_cache"]) : (object)[];

foreach ($parsedParams->background as $bg) {
    throwFatalErrorIf(!isset($bg->dataReference), "No data available.",
        "JSON parametrization of the visualiser requires <i>dataReference</i> for each background layer. This field is missing.",
        print_r($parsedParams->background, true));

    throwFatalErrorIf(!is_numeric($bg->dataReference) || $bg->dataReference >= count($parsedParams->data),
        "Invalid image.",
        "JSON parametrization of the visualiser requires valid <i>dataReference</i> for each background layer.",
        "Invalid data reference value '$bg->dataReference'. Available data: " . print_r($parsedParams->data, true));
}

$layerVisible = isset($parsedParams->visualizations);
$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = !isset($_COOKIE["_shadersPin"]);

if ($layerVisible) {
    foreach ($parsedParams->visualizations as $visualisationTarget) {
        if (!isset($visualisationTarget->name)) {
            $visualisationTarget->name = "Custom Visualisation";
        }
        throwFatalErrorIf(!isset($visualisationTarget->shaders), "No visualisation defined.",
            "You must specify non-empty <b>shaders</b> object.", print_r($visualisationTarget, true));

        foreach ($visualisationTarget->shaders as $data=>$layer) {
            throwFatalErrorIf(!isset($layer->type), "No visualisation style defined for $layer->name.",
                "You must specify <b>type</b> parameter.", print_r($layer, true));

            if (!isset($layer->name)) {
                $temp = substr($data, max(0, strlen($data)-24), 24);
                if (strlen($temp) != strlen($data)) $temp  = "...$temp";
                $layer->name = "Source: $temp";
            }

            if (!isset($layer->cache) && isset($layer->name) && isset($cookieCache->{$layer->name})) {
                $layer->cache = $cookieCache->{$layer->name};
            }
        }
    }

    //requires webgl module
    $MODULES["webgl"]->loaded = true;
}

/**
 * Plugins+Modules loading: load required parts of the application
 */
$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
foreach ($PLUGINS as $_ => $plugin) {
    if (file_exists(PLUGINS_FOLDER . "/" . $plugin->directory . "/style.css")) {
        $plugin->styleSheet = PLUGINS_FOLDER . "/" . $plugin->directory . "/style.css?v=$version";
    }

    $hasParams = isset($parsedParams->plugins->{$plugin->id});
    $plugin->loaded = !isset($plugin->error) &&
        (isset($parsedParams->plugins->{$plugin->id}) || in_array($plugin->id, $pluginsInCookies));

    //make sure all modules required by plugins are also loaded
    if ($plugin->loaded) {
        if (!$hasParams) {
            $parsedParams->plugins->{$plugin->id} = (object)array();
        }
        foreach ($plugin->modules as $modId) {
            $MODULES[$modId]->loaded = true;
        }
    }
}

$visualisation = json_encode($parsedParams);
$protoLayers = LAYERS_DEFAULT_PROTOCOL;
$cookie_setup = JS_COOKIE_SETUP;

//make sure all modules required by other modules are loaded
foreach ($MODULES as $_ => $mod) {
    if (file_exists(MODULES_FOLDER . "/" . $mod->directory . "/style.css")) {
        $mod->styleSheet = MODULES_FOLDER . "/" . $mod->directory . "/style.css?v=$version";
    }
    if ($mod->loaded) {
        foreach ($mod->requires as $__ => $requirement) {
            $MODULES[$requirement]->loaded = true;
        }
    }
}

?>
<!DOCTYPE html>
<html lang="en" dir="ltr" data-light-theme="light">

<head>
    <meta charset="utf-8">
    <title>Visualisation</title>

    <link rel="stylesheet" href="./style.css?v=$version">
    <link rel="stylesheet" href="./external/primer_css.css">
    <!--
    Possible external dependency
    <link href="https://unpkg.com/@primer/css@^16.0.0/dist/primer.css" rel="stylesheet" />
    -->

    <!--Remember WARNS/ERRORS to be able to export-->
    <script type="text/javascript">
        console.defaultError = console.error.bind(console);
        console.savedLogs = [];
        console.error = function(){
            console.defaultError.apply(console, arguments);
            console.savedLogs.push(Array.from(arguments));
        };

        console.defaultWarn = console.warn.bind(console);
        console.warn = function(){
            console.defaultWarn.apply(console, arguments);
            console.savedLogs.push(Array.from(arguments));
        };
    </script>

    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>

    <!-- OSD -->
    <!-- <script src="./osd/openseadragon.min.js"></script> -->

    <script src="./osd_debug/src/openseadragon.js?v=$version"></script>

    <script src="./osd_debug/src/eventsource.js"></script>
    <script src="./osd_debug/src/rectangle.js"></script>
    <script src="./osd_debug/src/tile.js?v=$version"></script>
    <script src="./osd_debug/src/tilecache.js?v=$version"></script>
    <script src="./osd_debug/src/tiledimage.js?v=$version"></script>
    <script src="./osd_debug/src/tilesource.js?v=$version"></script>
    <script src="./osd_debug/src/button.js"></script>
    <script src="./osd_debug/src/buttongroup.js"></script>
    <script src="./osd_debug/src/control.js"></script>
    <script src="./osd_debug/src/controldock.js"></script>
    <script src="./osd_debug/src/displayrectangle.js"></script>

    <script src="./osd_debug/src/imageloader.js"></script>
    <script src="./osd_debug/src/drawer.js"></script>

    <script src="./osd_debug/src/dzitilesource.js"></script>
    <script src="./osd_debug/src/fullscreen.js"></script>
    <script src="./osd_debug/src/iiiftilesource.js"></script>
    <script src="./osd_debug/src/imagetilesource.js"></script>
    <script src="./osd_debug/src/legacytilesource.js"></script>
    <script src="./osd_debug/src/mousetracker.js"></script>
    <script src="./osd_debug/src/viewer.js"></script>
    <script src="./osd_debug/src/navigator.js"></script>
    <script src="./osd_debug/src/osmtilesource.js"></script>
    <script src="./osd_debug/src/overlay.js"></script>
    <script src="./osd_debug/src/placement.js"></script>
    <script src="./osd_debug/src/point.js"></script>
    <script src="./osd_debug/src/profiler.js"></script>
    <script src="./osd_debug/src/referencestrip.js"></script>
    <script src="./osd_debug/src/spring.js"></script>
    <script src="./osd_debug/src/strings.js"></script>
    <script src="./osd_debug/src/tilesourcecollection.js"></script>
    <script src="./osd_debug/src/tmstilesource.js"></script>
    <script src="./osd_debug/src/viewport.js"></script>
    <script src="./osd_debug/src/world.js"></script>
    <script src="./osd_debug/src/zoomifytilesource.js"></script>

    <!--Extensions/modifications-->
    <script src="./external/dziexttilesource.js?v=$version"></script>
    <script src="./external/osd_tools.js?v=$version"></script>
    <script src="./external/scalebar.js?v=$version"></script>

    <!--Tutorials-->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/kineticjs/5.2.0/kinetic.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-scrollTo/2.1.2/jquery.scrollTo.min.js"></script>
    <link rel="stylesheet" href="./external/enjoyhint.css">
    <script src="./external/enjoyhint.min.js"></script>

    <!--UI Classes-->
    <?php require_once ("ui_components.php"); ?>

    <!--Modules-->
    <?php
    foreach ($MODULES as $_ => $mod) {
        if ($mod->loaded) {
            //add module style sheet if exists
            if (isset($mod->styleSheet)) {
                echo "<link rel=\"stylesheet\" href=\"$mod->styleSheet\" type='text/css'>\n";
            }
            foreach ($mod->includes as $__ => $file) {
                echo "    <script src=\"" . MODULES_FOLDER . "/" . $mod->directory . "/$file?v=$version\"></script>\n";
            }
        }
    }

    ?>

</head>

<body style="overflow: hidden;">
<!-- OSD viewer -->
<div id="viewer-container" class="position-absolute width-full height-full top-0 left-0" style="pointer-events: none;">
    <div id="osd" style="pointer-events: auto;" class="position-absolute width-full height-full top-0 left-0"></div>
</div>

<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;Error</div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <div class="text-small text-center"> [ if you want to report a problem, please include exported file ] </div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="display: none;max-height: 50vh;"></div>
</div>

<!--Tutorials-->
<div id="tutorials-container" class="d-none system-container">
    <div id="tutorials-title" class="f1-light text-center clearfix"></div>
    <p id="tutorials-description" class="text-center"></p>
    <!--<p class="text-center">You can also show tutorial section by pressing 'H' on your keyboard.</p>-->
    <br>
    <div id="tutorials"></div>
    <br><br><button class="btn" onclick="USER_INTERFACE.Tutorials.hide();">Exit</button>
</div>

<!-- Main Panel -->
<span id="main-panel-show" class="material-icons pointer" onclick="USER_INTERFACE.MainMenu.open();">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="background: var(--color-bg-primary); width: 400px;">

    <div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 80px;overflow-y: scroll;scrollbar-width: thin /*mozilla*/;overflow-x: hidden;">
        <div id="general-controls" class="inner-panel inner-panel-visible d-flex py-1">
            <span id="main-panel-hide" class="material-icons pointer flex-1" onclick="USER_INTERFACE.MainMenu.close();">chevron_right</span>

            <!--TODO export also these values? -->
            <?php
            if ($layerVisible) {
                echo <<<EOF
            <label for="global-opacity">Layer Opacity &nbsp;</label>
            <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 100px;">&emsp;
EOF;
            }

            if ($singleBgImage) {
                echo <<<EOF
            <label for="global-tissue-visibility"> Tissue &nbsp;</label>
            <input type="checkbox" style="align-self: center;" checked class="form-control" id="global-tissue-visibility"
                   onchange="VIEWER.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
EOF;
            }?>

            <span class="material-icons pointer ml-2" onclick="APPLICATION_CONTEXT.UTILITIES.clone()" title="Clone and synchronize">repeat_on</span>
        </div><!--end of general controls-->

        <div id="navigator-container" data-position="relative"  class="inner-panel right-0" style="width: 400px; position: relative; background-color: var(--color-bg-canvas)">
            <div><!--the div below is re-inserted by OSD, keep it in the hierarchy at the same position-->
                <div id="panel-navigator" style=" height: 300px; width: 100%;"></div>
            </div>
            <span id="navigator-pin" class="material-icons pointer inline-pin position-absolute right-2 top-2" onclick="
 let self = $(this);
 if (self.hasClass('pressed')) {
    self.removeClass('pressed');
    self.parent().removeClass('color-shadow-medium').attr('data-position', 'relative').css('position', 'relative');
 } else {
    self.parent().addClass('color-shadow-medium').attr('data-position', 'fixed');
    self.addClass('pressed');
 }
"> push_pin </span>
        </div>

        <?php
           if (count($parsedParams->background) > 1) {
                echo <<<EOF
        </div> <!--end of general controls-->
        <div id="panel-images" class="inner-panel mt-2">
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="images-pin" class="material-icons pointer inline-arrow" onclick="APPLICATION_CONTEXT.UTILITIES.clickMenuHeader($(this), $(this).parents().eq(1).children().eq(1));" style="padding: 0;"> navigate_next </span>
                        <h3 class="d-inline-block pointer" onclick="APPLICATION_CONTEXT.UTILITIES.clickMenuHeader($(this.previousElementSibling), $(this).parents().eq(1).children().eq(1));">Images</h3>
                    </div>

                    <div id="image-layer-options" class="inner-panel-hidden">
                        <!--populated with options for a given image data -->
                    </div>
                </div>
           </div>
EOF;
            }
            if ($layerVisible) {
                $opened = $firstTimeVisited || $_COOKIE["_shadersPin"] == "true";
                $pinClass = $opened ? "opened" : "";
                $shadersSettingsClass = $opened ? "force-visible" : "";
                echo <<<EOF
          <div id="panel-shaders" class="inner-panel">

                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="shaders-pin" class="material-icons pointer inline-arrow $pinClass" onclick="let jqSelf = $(this); APPLICATION_CONTEXT.UTILITIES.clickMenuHeader(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                        document.cookie = `_shadersPin=\${jqSelf.hasClass('pressed')}; $cookie_setup`" style="padding: 0;">navigate_next</span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <span id="cache-snapshot" class="material-icons pointer" style="text-align:right; vertical-align:sub;float: right;" title="Remember settings" onclick="APPLICATION_CONTEXT.UTILITIES.makeCacheSnapshot();">bookmark</span>
                    </div>

                    <div id="data-layer-options" class="inner-panel-hidden $shadersSettingsClass">
                            <!--populated with options for a given image data -->
                    </div>
                    <div id="blending-equation"></div>
                </div>
            </div>
EOF;
            }?>

            <!-- Appended controls for other plugins -->
        </div>

        <div class="d-flex flex-items-end p-2 flex-1 position-fixed bottom-0 pointer bg-opacity fixed-bg-opacity" style="width: 400px;">
            <span id="copy-url" class="pl-1" onclick="APPLICATION_CONTEXT.UTILITIES.copyUrlToClipboard();" title="Get the visualisation link"><span class="material-icons pr-1 pointer" style="font-size: 22px;">link</span>URL</span>
            <span id="global-export" class="pl-1" onclick="APPLICATION_CONTEXT.UTILITIES.export();" title="Export visualisation together with plugins data"><span class="material-icons pr-1 pointer" style="font-size: 22px;">download</span>Export</span>
            <a style="display:none;" id="export-visualisation"></a> &emsp;
            <span id="add-plugins" class="pl-1" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);" title="Add plugins to the visualisation"><span class="material-icons pr-1 pointer" style="font-size: 22px;">extension</span>Plugins</span>&emsp;
            <span id="global-help" class="pl-1" onclick="USER_INTERFACE.Tutorials.show();" title="Show tutorials"><span class="material-icons pr-1 pointer" style="font-size: 22px;">school</span>Tutorial</span>&emsp;
            <span id="settings" class="p-0 material-icons" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);" title="Settings">settings</span>&emsp;
        </div>
    </div>

    <div id="plugin-tools-menu" class="position-absolute top-0 right-0 left-0 noselect"></div>
    <div id="fullscreen-menu" class="position-absolute top-0 left-0 noselect height-full" style="display:none; background: var(--color-bg-primary); z-index: 3;"></div>
<?php
    include_once ("user_interface.php");
?>

    <!-- APPLICATION -->
    <script type="text/javascript">

(function (window) {
    let setup = <?php echo $visualisation ?>;
    let defaultSetup = {
        customBlending: false,
        debugMode: false,
        webglDebugMode: false,
        scaleBar: true,
        microns: undefined,
        viewport: {
            zoomLevel: 1,
            point: {x: 0.5, y: 0.5}
        },
        activeVisualizationIndex: 0,
        grayscale: false,
        preventNavigationShortcuts: false,
        permaLoadPlugins: true,
        bypassCookies: false,
        theme: "auto"
    };
    let serverCookies = <?php echo json_encode($_COOKIE) ?>;
    //default parameters not extended by setup.params (would bloat link files)
    setup.params = setup.params || {};
    //optimization allways present
    setup.params.bypassCookies = setup.params.bypassCookies ?? defaultSetup.bypassCookies;

    window.APPLICATION_CONTEXT = {
        shadersCache: serverCookies._cache || {},
        setup: setup,
        //here are all parameters supported by the core visualization
        defaultParams: defaultSetup,
        layersAvailable: false, //default
        settingsMenuId: "app-settings",
        pluginsMenuId: "app-plugins",
        getOption: function (name) {
            if (!this.defaultParams.hasOwnProperty(name)) console.warn("Unknown viewer parameter!", name);
            if (!this.setup.params.bypassCookies && serverCookies.hasOwnProperty(name)) {
                let value = serverCookies[name]; //todo URL decode?
                if (value === "false") value = false;
                return value;
            }
            return this.setup.params.hasOwnProperty(name) ? this.setup.params[name] : this.defaultParams[name];
        },
        setOption: function (name, value, cookies=false) {
            if (!this.defaultParams.hasOwnProperty(name)) console.warn("Unknown viewer parameter!", name);
            if (value === "false") value = false;
            if (cookies && !this.setup.params.bypassCookies) {
                serverCookies[name] = value;
                document.cookie = `${name}=${value}; <?php echo JS_COOKIE_SETUP ?>`; //todo URL encode?
            }
            this.setup.params[name] = value;
        }
    };

    //https://github.com/mrdoob/stats.js
    if (setup.params.debugMode) {
        (function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);stats.showPanel(1);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src='external/stats.js';document.head.appendChild(script);})()
    }

    window.HTTPError = class extends Error {
        constructor(message, response) {
            super();
            this.message = message;
            this.code = response;
        }
    };

    window.PLUGINS = {
        addTutorial: USER_INTERFACE.Tutorials.add.bind(USER_INTERFACE.Tutorials),
        addPostExport: function(name, valueHandler, pluginId) {
            this._exportHandlers.push({name: name, call: valueHandler, pluginId: pluginId});
        },
        addHtml: function(containerId, html, pluginId, selector="body") {
            $(selector).append(html);
            $(`#${containerId}`).addClass(`${pluginId}-plugin-root`);
        },
        fetchJSON: async function(url, postData=null) {
            let method = postData ? "POST" : "GET",
                headers = {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    <?php
                        if (defined(AUTH_HEADER_CONTENT)) {
                            echo "'Authorization': '" . AUTH_HEADER_CONTENT . "'";
                        }
                    ?>
                };
            const response = await fetch(url, {
                method: method,
                mode: 'cors',
                cache: 'no-cache',
                credentials: 'same-origin',
                headers: headers,
                body: postData ? JSON.stringify(postData) : null
            });

            if (response.status < 200 || response.status > 299) {
                return response.text().then(text => {
                    throw new HTTPError(`Server returned ${response.status}: ${text}`, response);
                });
            }
            return response.json();
        },
        setParams(id, params) {
            APPLICATION_CONTEXT.setup.plugins[id] = params;
        },
        imageSources: setup.data,
        //note that this does not work on page closing, just for button refreshing...
        setDirty: () => {setup.dirty = true;},
        postData: <?php echo json_encode($_POST)?>,
        each: <?php echo json_encode((object)$PLUGINS)?>,
        _exportHandlers: []
    };

    //preventive error message, that will be discarded after the full initialization
    window.onerror = function (message, file, line, col, error) {
        let ErrUI = USER_INTERFACE.Errors;
        if (ErrUI.active) return false;
        ErrUI.show("Unknown error.", `Something has gone wrong: '${message}' <br><code>${error.message}
<b>in</b> ${file}, <b>line</b> ${line}</code>`, true);
        return false;
    };

    /*---------------------------------------------------------*/
    /*------------ Initialization of UI -----------------------*/
    /*---------------------------------------------------------*/

    USER_INTERFACE.AdvancedMenu._build();

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./error.php?title=${encodeURIComponent('Your browser is not supported.')}
&description=${encodeURIComponent('ERROR: The visualisation requires canvasses in order to work.')}`;
    }

    // Initialize viewer - OpenSeadragon
    window.VIEWER = OpenSeadragon({
        id: "osd",
        prefixUrl: "osd/images/",
        showNavigator: true,
        maxZoomPixelRatio: 1,
        blendTime: 0,
        showNavigationControl: false,
        navigatorId: "panel-navigator",
        loadTilesWithAjax : true,
        ajaxHeaders: <?php echo json_encode((object)COMMON_HEADERS); ?>,
        splitHashDataForPost: true,
        subPixelRoundingForTransparency:
            navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc") ?
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
        debugMode: setup.params.debugMode,
    });
    VIEWER.gestureSettingsMouse.clickToZoom = false;
    VIEWER.tools = new OpenSeadragon.Tools(VIEWER);

    if (!setup.params.hasOwnProperty("scaleBar") || setup.params.scaleBar) {
        VIEWER.scalebar({
            pixelsPerMeter: (setup.params.microns ?? 1000) * 1e3,
            sizeAndTextRenderer: OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH,
            stayInsideImage: false,
            location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
            xOffset: 5,
            yOffset: 10,
            // color: "var(--color-text-primary)",
            // fontColor: "var(--color-text-primary)",
            backgroundColor: "rgba(255, 255, 255, 0.5)",
            fontSize: "small",
            barThickness: 2
        });
    }

    /*---------------------------------------------------------*/
    /*------------ Initialization of Visualisation ------------*/
    /*---------------------------------------------------------*/

    <?php echo <<<EOF
    window.USER_INTERFACE.Tutorials.add("", "Basic functionality", "learn how the visualiser works", "foundation", [ {
    'next #viewer-container' : 'You can navigate in the content either using mouse,<br> or via keyboard: arrow keys (movement) and +/- (zoom). Try it out now.'
},{
        'next #main-panel' : 'On the right, the Main Panel <br> holds most functionality and also allows <br> to interact with plugins.',
}, {
        'next #navigator-container' : 'An interactive navigator can be used <br> for orientation or to jump quickly on different areas.',
},
EOF;

    if ($singleBgImage && $layerVisible) {
        echo '{
        \'next #general-controls\' : \'The whole visualisation consists of two layers: <br> the background canvas and the data layer above.<br>You can control the data layer opacity here.\'
},';
    } else if (count($parsedParams->background) > 0) {
        echo '{
        \'next #panel-images\' : \'There are several background images available: <br> you can turn them on/off or blend using an opacity slider.\'
        
},';
        if ($layerVisible) {
            echo '{
        \'next #general-controls\' : \'The data layer opacity atop background images can be controlled here.\'
},';
        }
    }

    if ($layerVisible) {
        echo '{
        \'next #panel-shaders\': \'The data layer <br>-the core visualisation functionality-<br> is highly flexible and can be conrolled here.\'
}, {
        \'click #shaders-pin\': \'Click to set <br>this controls subpanel to be always visible.\'
}, {
        \'next #shaders\': \'In case multiple different visualisations <br>are set, you can select <br>which one is being displayed.\'
}, {
        \'next #data-layer-options\': \'Each visualisation consists of several <br>data parts and their interpretation. <br>Here, you can control each part separately, <br>and also drag-n-drop to reorder.\'
}, {
        \'next #cache-snapshot\': \'Your settings can be saved here. <br> Saved adjustments are applied on layers of the same name.\'
}, ';
    }

    echo <<<EOF
{
        'next #copy-url' : 'Your setup can be shared with a link.'
},{
        'next #global-export' : 'You can share also a file: this option <br>includes (most) plugins data too (unlike URL sharing). <br> That means, if you export a file with <br> drawn annotations, these will be included too.'
},{
        'next #global-help' : 'That\'s all for now.<br> For more functionality, see Plugins menu. <br> With attached plugins, more tutorials will appear here.'
}]
EOF; //end of the first argument of Tutorials.add()

    if ($layerVisible) {
        echo <<<EOF
, function() {
    //prerequisite - pin in default state
    let pin = $("#shaders-pin");
    let container = pin.parents().eq(1).children().eq(1);
    pin.removeClass('pressed');
    container.removeClass('force-visible');
}
EOF;
    }
    echo ");"; //end of Tutorials.add(...
    ?>

    // opacity of general layer available everywhere
    $("#global-opacity").on("input", function () {
        let val = $(this).val();
        VIEWER.world.getItemAt(VIEWER.bridge.getWorldIndex()).setOpacity(val);
    });

    $(VIEWER.element).on('contextmenu', function (event) {
        event.preventDefault();
    });

    /**
     * Focusing all key press events and forwarding to OSD
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer = true;
    VIEWER.addHandler('canvas-enter', function () {
        focusOnViewer = true;
    });
    VIEWER.addHandler('canvas-exit', function () {
        focusOnViewer = false;
    });
    document.addEventListener('keydown', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-up', e);
    });

    let failCount = new WeakMap();
    VIEWER.addHandler('tile-load-failed', function(e) {
        if (e.message === "Image load aborted") return;
        let index = VIEWER.world.getIndexOfItem(e.tiledImage);
        let failed = failCount[index];
        if (!failed || failed != e.tiledImage) {
            failCount[index] = e.tiledImage;
            e.tiledImage._failedCount = 1;
        } else {
            let d = e.time - e.tiledImage._failedDate;
            if (d < 500) {
                e.tiledImage._failedCount++;
            } else {
                e.tiledImage._failedCount = 1;
            }
            if (e.tiledImage._failedCount > 5) {
                e.tiledImage._failedCount = 1;
                //to-docs
                e.worldIndex = index;
                VIEWER.raiseEvent('tiled-image-problematic', e);
            }
        }
        e.tiledImage._failedDate = e.time;
    });

    /**
     * From https://github.com/openseadragon/openseadragon/issues/1690
     * brings better zooming behaviour
     */
    window.VIEWER.addHandler("canvas-scroll", function() {
        if (typeof this.scrollNum == 'undefined') {
            this.scrollNum = 0;
        }

        if (typeof this.lastScroll == 'undefined') {
            this.lastScroll = new Date();
        }

        this.currentScroll = new Date(); //Time that this scroll occurred at

        if (this.currentScroll - this.lastScroll < 400) {
            this.scrollNum++;
        } else {
            this.scrollNum = 0;
            VIEWER.zoomPerScroll = 1.2;
        }

        if (this.scrollNum > 2 && VIEWER.zoomPerScroll <= 2.5) {
            VIEWER.zoomPerScroll += 0.2;
        }

        this.lastScroll = this.currentScroll; //Set last scroll to now
    });

    window.VIEWER.addHandler('navigator-scroll', function (e) {
        VIEWER.viewport.zoomBy(e.scroll / 2 + 1); //accelerated zoom
        VIEWER.viewport.applyConstraints();
    });

    if (!setup.params.preventNavigationShortcuts) {
        function adjustBounds(speedX, speedY) {
            let bounds = VIEWER.viewport.getBounds();
            bounds.x += speedX*bounds.width;
            bounds.y += speedY*bounds.height;
            VIEWER.viewport.fitBounds(bounds);
        }

        //todo article!!! also acceleration!
        VIEWER.addHandler('key-up', function(e) {
            if (e.focusCanvas) {
                let zoom = null,
                    speed = 0.3;
                switch (e.key) {
                    case "Down": // IE/Edge specific value
                    case "ArrowDown":
                        adjustBounds(0, speed);
                        break;
                    case "Up": // IE/Edge specific value
                    case "ArrowUp":
                        adjustBounds(0, -speed);
                        break;
                    case "Left": // IE/Edge specific value
                    case "ArrowLeft":
                        adjustBounds(-speed, 0);
                        break;
                    case "Right": // IE/Edge specific value
                    case "ArrowRight":
                        adjustBounds(speed, 0);
                        break;
                    case "+":
                        zoom = VIEWER.viewport.getZoom();
                        VIEWER.viewport.zoomTo(zoom + zoom * speed * 3);
                        return;
                    case "-":
                        zoom = VIEWER.viewport.getZoom();
                        VIEWER.viewport.zoomTo(zoom - zoom * speed * 2);
                        return;
                    default:
                        return; // Quit when this doesn't handle the key event.
                }
            }

            if (e.key === 'Escape') {
                USER_INTERFACE.AdvancedMenu.close();
                USER_INTERFACE.Tutorials.hide();
            }
        });
    }

    /*---------------------------------------------------------*/
    /*------------ EXPORTING ----------------------------------*/
    /*---------------------------------------------------------*/

    function constructExportVisualisationForm(customAttributes="", includedPluginsList=undefined, withCookies=false) {
        //reconstruct active plugins
        let pluginsData = APPLICATION_CONTEXT.setup.plugins;
        let plugins = PLUGINS.each;
        let includeEvaluator = includedPluginsList ?
            p => includedPluginsList.includes(p) :
            p => plugins[p].loaded;

        for (let plugin in plugins) {
            if (!plugins.hasOwnProperty(plugin)) continue;
            if (!includeEvaluator(plugin)) {
                delete pluginsData[plugin];
            } else if (!pluginsData.hasOwnProperty(plugin)) {
                pluginsData[plugin] = {};
            }
        }

        let bypass = APPLICATION_CONTEXT.setup.params.bypassCookies;
        if (!withCookies) APPLICATION_CONTEXT.setup.params.bypassCookies = true;
        let form = `
      <form method="POST" id="redirect" action="<?php echo SERVER . $_SERVER["REQUEST_URI"]; ?>">
        <input type="hidden" id="visualisation" name="visualisation">
        ${customAttributes}
        <input type="submit" value="">
      </form>
      <script type="text/javascript">
<?php
        if ($layerVisible) {
            //we need to safely stringify setup (which has been modified by the webgl module)
            echo "document.getElementById(\"visualisation\").value = \`\${JSON.stringify(APPLICATION_CONTEXT.setup, VIEWER.bridge.webGLEngine.jsonReplacer)}\`;";
        } else {
            echo "document.getElementById(\"visualisation\").value = \`\${JSON.stringify(APPLICATION_CONTEXT.setup)}\`;";
        }
        ?>
        var form = document.getElementById("redirect");
        var node;`;
        APPLICATION_CONTEXT.setup.params.bypassCookies = bypass;

        for (let i = 0; i < PLUGINS._exportHandlers.length; i++) {
            let toExport = PLUGINS._exportHandlers[i];
            if (toExport) {
                let value = toExport.call();
                form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", \`${toExport.name}\`);
node.setAttribute("value", \`${value}\`);
form.appendChild(node);`;
            }
        }

        return `${form}
form.submit();<\/script>`;
    }

    window.APPLICATION_CONTEXT.UTILITIES = {
        clickMenuHeader: function(jQSelf, jQTargetParent) {
            if (jQTargetParent.hasClass('force-visible')) {
                jQTargetParent.removeClass('force-visible');
                jQSelf.removeClass('opened');
            } else {
                jQSelf.addClass('opened');
                jQTargetParent.addClass('force-visible');
            }
        },

        updateTheme: function() {
            let theme = APPLICATION_CONTEXT.getOption("theme");
            if (!["dark", "dark_dimmed", "light", "auto"].some(t => t === theme)) theme = APPLICATION_CONTEXT.defaultParams.theme;
            if (theme === "dark_dimmed") {
                document.documentElement.dataset['darkTheme'] = "dark_dimmed";
                document.documentElement.dataset['colorMode'] = "dark";
            } else {
                document.documentElement.dataset['darkTheme'] = "dark";
                document.documentElement.dataset['colorMode'] = theme;
            }
        },

        getForm: constructExportVisualisationForm,

        copyUrlToClipboard: function () {
            let baseUrl = "<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/redirect.php#";

            let oldViewport = APPLICATION_CONTEXT.setup.params.viewport;
            APPLICATION_CONTEXT.setup.params.viewport = {
                zoomLevel: VIEWER.viewport.getZoom(),
                point: VIEWER.viewport.getCenter()
            };

            let bypass = APPLICATION_CONTEXT.setup.params.bypassCookies;
            APPLICATION_CONTEXT.setup.params.bypassCookies = true;
            <?php
            if ($layerVisible) {
                //we need to safely stringify setup (which has been modified by the webgl module)
                echo "        let postData = JSON.stringify(APPLICATION_CONTEXT.setup, VIEWER.bridge.webGLEngine.jsonReplacer);";
            } else {
                echo "        let postData = JSON.stringify(APPLICATION_CONTEXT.setup);";
            }
            ?>
            APPLICATION_CONTEXT.setup.params.viewport = oldViewport;
            APPLICATION_CONTEXT.setup.params.bypassCookies = bypass;

            let $temp = $("<input>");
            $("body").append($temp);
            $temp.val(baseUrl + encodeURIComponent(postData)).select();
            document.execCommand("copy");
            $temp.remove();
            Dialogs.show("The URL was copied to your clipboard.", 4000, Dialogs.MSG_INFO);
        },

        export: function () {
            let oldViewport = setup.params.viewport;
            setup.params.viewport = {
                zoomLevel: VIEWER.viewport.getZoom(),
                point: VIEWER.viewport.getCenter()
            };
            let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualisation export</title></head>
<body>
<div>Errors (if any): <pre>${JSON.stringify(console.savedLogs)}</pre></div>
${constructExportVisualisationForm()}
</body></html>`;
            setup.params.viewport = oldViewport;
            let output = new Blob([doc], { type: 'text/html' });
            let downloadURL = window.URL.createObjectURL(output);
            var downloader = document.getElementById("export-visualisation");
            downloader.href = downloadURL;
            downloader.download = "export.html";
            downloader.click();
            URL.revokeObjectURL(downloadURL);
            setup.dirty = false;
        },

        clone: function () {
            if (window.opener) {
                return;
            }

            let ctx = Dialogs.getModalContext('synchronized-view');
            if (ctx) {
                ctx.window.focus();
                return;
            }
            let x = window.innerWidth / 2, y = window.innerHeight;
            window.resizeTo(x, y);
            Dialogs._showCustomModalImpl('synchronized-view', "Loading...",
                constructExportVisualisationForm(), `width=${x},height=${y}`);
        }
    };

    APPLICATION_CONTEXT.UTILITIES.updateTheme();
})(window);
    </script>

    <?php
    if ($layerVisible) {
        include_once("layers.php");
    }
    ?>

    <script type="text/javascript">
        /*---------------------------------------------------------*/
        /*------------ PLUGINS ------------------------------------*/
        /*---------------------------------------------------------*/
(function (window) {
    var registeredPlugins = [];
    var MODULES = <?php echo json_encode((object)$MODULES) ?>;
    var LOADING_PLUGIN = false;

    function showPluginError(id, e) {
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            $(`#load-plugin-${id}`).html("");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">This plugin has been automatically
removed: there was an error. <br><code>[${e}]</code></div>`);
        $(`#load-plugin-${id}`).html(`<button disabled class="btn">Failed</button>`);
        Dialogs.show(`Plugin <b>${PLUGINS.each[id].name}<b> has been removed: there was an error.`,
            4000, Dialogs.MSG_ERR);
    }

    function cleanUpScripts(id) {
        $(`#script-section-${id}`).remove();
        LOADING_PLUGIN = false;
    }

    function cleanUpPlugin(id, e="Unknown error") {
        delete PLUGINS.each[id].instance;
        delete window[id];
        PLUGINS.each[id].loaded = false;
        PLUGINS.each[id].error = e;

        let removalIndices = [];
        for (let i = 0; i < PLUGINS._exportHandlers.length; i++) {
            if (PLUGINS._exportHandlers[i].pluginId === id) {
                removalIndices.push(i);
            }
        }
        //removed in backward pass to always access valid indices
        for (let j = removalIndices.length-1; j >= 0; j--) {
            PLUGINS._exportHandlers.splice(removalIndices[j], 1);
        }

        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
    }

    function instantiatePlugin(id, PluginClass) {
        if (!id) {
            console.warn("Plugin registered with no id defined!", id);
            return;
        }
        if (!PLUGINS.each[id]) {
            console.warn("Plugin registered with invalid id: no such id present in 'include.json'.", id);
            return;
        }

        try {
            let parameters = APPLICATION_CONTEXT.setup.plugins[id];
            if (!parameters) {
                parameters = {};
                APPLICATION_CONTEXT.setup.plugins[id] = parameters;
            }
            var plugin = new PluginClass(id, parameters);
        } catch (e) {
            console.warn(`Failed to instantiate plugin ${PluginClass}.`, e);
            cleanUpPlugin(id, e);
            return;
        }

        if (plugin.id !== id) plugin.id = id; //silently set
        if (window[plugin.id]) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, window[id]);
            Dialogs.show(`Plugin ${plugin.name} could not be loaded: please, contact administrator.`, 7000, Dialogs.MSG_WARN);
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS.each[id].instance = plugin;
        window[id] = plugin;
        showPluginError(id, null);
        return plugin;
    }

    function initializePlugin(plugin) {
        if (!plugin) return false;
        if (!plugin.pluginReady) return true;
        try {
            plugin.pluginReady();
            return true;
        } catch (e) {
            console.warn(`Failed to initialize plugin ${plugin}.`, e);
            cleanUpPlugin(plugin.id, e);
        }
        return false;
    }

    /**
     * Load a script at runtime. Plugin is REMOVED from the viewer
     * if the script is faulty
     *
     * Enhancement: use Premise API instead
     * @param pluginId plugin that uses particular script
     * @param src script URL
     * @param onload function to call on success
     */
    PLUGINS.attachScript = function(pluginId, src, onload) {
        let container = document.getElementById(`script-section-${pluginId}`);
        if (!container) {
            $("body").append(`<div id="script-section-${pluginId}"></div>`);
            container = document.getElementById(`script-section-${pluginId}`);
        }
        let script = document.createElement("script");
        script.async = false;

        let errHandler = function (e) {
            window.onerror = null;
            if (LOADING_PLUGIN) {
                cleanUpPlugin(pluginId, e);
            } else {
                cleanUpScripts(pluginId);
            }
        };

        script.onload = function () {
            window.onerror = null;
            onload();
        };
        script.onerror = errHandler;
        window.onerror = errHandler;
        script.src = src;
        container.append(script);
        return true;
    };

    /**
     * Register plugin. Plugin is instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    PLUGINS.register = function(id, PluginClass) {
        let plugin = instantiatePlugin(id, PluginClass);

        if (!plugin) return;

        if (registeredPlugins !== undefined) {
            if (plugin && OpenSeadragon.isFunction(plugin["pluginReady"])) {
                registeredPlugins.push(plugin);
            }
        } //else do not initialize plugin, wait untill all files loaded dynamically
    };

    function fileNameOf(imageFilePath) {
        let begin = imageFilePath.lastIndexOf('/')+1;
        return imageFilePath.substr(begin, imageFilePath.length - begin - 4);
    }

    function fireTheVisualization() {
        window.VIEWER.removeHandler('open', fireTheVisualization);
        let i = 0;
        let largestWidth = 0, selectedImageLayer = 0;
        let imageNode = $("#image-layer-options");
        let setup = APPLICATION_CONTEXT.setup;
        //image-layer-options can be missing --> populate menu only if exists
        if (imageNode) {
            //reverse order menu since we load images in reverse order
            for (let revidx = setup.background.length-1; revidx >= 0; revidx-- ) {
                let image = setup.background[revidx];
                let worldItem =  window.VIEWER.world.getItemAt(i);
                if (image.hasOwnProperty("lossless") && image.lossless) {
                    worldItem.source.fileFormat = "png";
                }
                let width = worldItem.getContentSize().x;
                if (width > largestWidth) {
                    largestWidth = width;
                    selectedImageLayer = i;
                }
                imageNode.prepend(`
<div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" checked class="form-control"
onchange="VIEWER.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);" style="margin: 5px;"> Image
${fileNameOf(APPLICATION_CONTEXT.setup.data[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
max="1" value="1" step="0.1" onchange="VIEWER.world.getItemAt(${i}).setOpacity(Number.parseFloat(this.value));" style="width: 100%;"></div>`);
                i++;
            }
        }
        //the viewer scales differently-sized layers sich that the biggest rules the visualization
        //this is the largest image layer
        VIEWER.tools.linkReferenceTileSourceIndex(selectedImageLayer);
        VIEWER.tools.referencedTileSource = VIEWER.world.getItemAt.bind(window.VIEWER.world, selectedImageLayer);

        let layerIDX = setup.hasOwnProperty("visualizations") ? setup.background.length : -1;
        if (layerIDX !== -1) {
            if (layerIDX !== i) {
                console.warn("Invalid initialization: layer index should be ", i);
                layerIDX = i;
            }

            let layerWorldItem =  VIEWER.world.getItemAt(layerIDX);
            if (layerWorldItem) {
                let activeVis = VIEWER.bridge.currentVisualisation();
                if (!activeVis.hasOwnProperty("lossless") || activeVis.lossless && layerWorldItem.source.setFormat) {
                    layerWorldItem.source.setFormat("png");
                }
                layerWorldItem.source.greyscale = APPLICATION_CONTEXT.getOption("grayscale") ? "/greyscale" : "";
            }

            <?php
            if ($layerVisible) {
                echo <<<EOF
                VIEWER.bridge.addLayer(layerIDX);
                VIEWER.bridge.initAfterOpen();
EOF;
            }
            ?>
        }

        //Notify plugins OpenSeadragon is ready
        registeredPlugins.forEach(plugin => initializePlugin(plugin));
        registeredPlugins = undefined;

        if (setup.params.hasOwnProperty("viewport")
            && setup.params.viewport.hasOwnProperty("point")
            && setup.params.viewport.hasOwnProperty("zoomLevel")) {
            window.VIEWER.viewport.panTo(setup.params.viewport.point, true);
            window.VIEWER.viewport.zoomTo(setup.params.viewport.zoomLevel, null, true);
        }

        if (window.innerHeight < 630) {
            <?php if (!$firstTimeVisited) {
                echo "            $('#navigator-pin').click();";
            }?>
            USER_INTERFACE.MainMenu.close();
        }

        window.onerror = null;

        if (window.opener && window.opener.VIEWER) {
            OpenSeadragon.Tools.link( window.VIEWER, window.opener.VIEWER);
        }

        if (USER_INTERFACE.Errors.active) {
            $("#viewer-container").addClass("disabled"); //preventive
            return;
        }
        <?php
        if ($firstTimeVisited && !$bypassCookies) {
            echo "        setTimeout(function() {
                    USER_INTERFACE.Tutorials.show('It looks like this is your first time here', 
                        'Please, go through <b>Basic Functionality</b> tutorial to familiarize yourself with the environment.');
            }, 2000);";
        }
        ?>
    }
    window.VIEWER.addHandler('open', fireTheVisualization);

    function chainLoad(id, sources, index, onSuccess, folder='<?php echo PLUGINS_FOLDER ?>') {
        if (index >= sources.includes.length) {
            onSuccess();
        } else {
            PLUGINS.attachScript(id,
                `${folder}/${sources.directory}/${sources.includes[index]}?v=<?php echo $version?>`,
                _ => chainLoad(id, sources, index+1, onSuccess, folder));
        }
    }

    function chainLoadModules(moduleList, index, onSuccess) {
        if (index >= moduleList.length) {
            onSuccess();
            return;
        }
        let module = MODULES[moduleList[index]];
        if (!module || module.loaded) {
            chainLoadModules(moduleList, index+1, onSuccess);
            return;
        }

        function loadSelf() {
            //load self files and continue loading from modulelist
            chainLoad(module.id + "-module", module, 0,
                function() {
                    if (module.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${module.styleSheet}' type='text/css'/>`);
                    }
                    module.loaded = true;
                    chainLoadModules(moduleList, index+1, onSuccess);
                }, '<?php echo MODULES_FOLDER ?>');
        }

        //first dependencies, then self
        chainLoadModules(module.requires || [], 0, loadSelf);
    }

    /**
     * Load modules at runtime
     * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
     * @param onload function to call on successful finish
     * @param ids all modules id to be loaded (rest parameter syntax)
     */
    APPLICATION_CONTEXT.UTILITIES.loadModules = function(onload=_=>{}, ...ids) {
        LOADING_PLUGIN = false;
        chainLoadModules(ids, 0, onload);
    };

    /**
     * Load a plugin at runtime
     * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
     * @param id plugin to load
     * @param onload function to call on successful finish
     */
    APPLICATION_CONTEXT.UTILITIES.loadPlugin = function(id, onload=_=>{}) {
        let meta = PLUGINS.each[id];
        if (!meta || meta.loaded || meta.instance) return;
        if (window.hasOwnProperty(id)) {
            Dialogs.show("Could not load the plugin.", 5000, Dialogs.MSG_ERR);
            return;
        }
        if (!Array.isArray(meta.includes)) {
            Dialogs.show("The selected plugin is corrupted.", 5000, Dialogs.MSG_ERR);
            return;
        }

        let successLoaded = function() {
            LOADING_PLUGIN = false;

            //loaded after page load
            if (!initializePlugin(PLUGINS.each[id].instance)) return;
            Dialogs.show(`Plugin <b>${PLUGINS.each[id].name}</b> has been loaded.`, 2500, Dialogs.MSG_INFO);

            if (meta.styleSheet) {  //load css if necessary
                $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
            }
            meta.loaded = true;
            if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                let plugins = new URLSearchParams(document.cookie.replaceAll("; ","&")).get("_plugins");
                document.cookie = `_plugins=${plugins + "," + meta.id}; <?php echo JS_COOKIE_SETUP ?>`;
            }
            onload();
        };
        LOADING_PLUGIN = true;
        chainLoadModules(meta.modules || [], 0, _ => chainLoad(id, meta, 0, successLoaded));
    };

    //TODO: also refresh page should not ask to re-send data -> redirect loop instead?
    function preventDirtyClose(e) {
        e.preventDefault();
        if (APPLICATION_CONTEXT.setup.dirty) return "You will lose your workspace if you leave now: are you sure?";

        if ( window.history.replaceState ) {
            window.history.replaceState( null, null, window.location.href );
        }
        window.location = window.location.href;
        return;
    }

    if (window.addEventListener) {
        window.addEventListener('beforeunload', preventDirtyClose, true);
    } else if (window.attachEvent) {
        window.attachEvent('onbeforeunload', preventDirtyClose);
    }

    /**
     * Refresh current page with all plugins and their data if export API used
     * @param formData additional HTML to add to the refresh FORM
     * @param includedPluginsList of ID's of plugins to include, inludes current active if not specified
     */
    APPLICATION_CONTEXT.UTILITIES.refreshPage = function(formData="", includedPluginsList=undefined) {
        if (APPLICATION_CONTEXT.setup.dirty) {
            Dialogs.show(`It seems you've made some work already. It might be wise to <a onclick="APPLICATION_CONTEXT.UTILITIES.export();" class='pointer'>export</a> your setup first. <a onclick="APPLICATION_CONTEXT.setup.dirty = false; APPLICATION_CONTEXT.UTILITIES.refreshPage();" class='pointer'>Reload now.</a>.`,
                15000, Dialogs.MSG_WARN);
            return;
        }

        if (window.removeEventListener) {
            window.removeEventListener('beforeunload', preventDirtyClose, true);
        } else if (window.detachEvent) {
            window.detachEvent('onbeforeunload', preventDirtyClose);
        }
        $("body").append(APPLICATION_CONTEXT.UTILITIES.getForm(formData, includedPluginsList, true));
    };
})(window);
    </script>
    <!-- PLUGINS -->
    <?php
    foreach ($PLUGINS as $_ => $plugin) {
        if ($plugin->loaded) {
            echo "<div id='script-section-{$plugin->id}'>";
            //add plugin style sheet if exists
            if (isset($plugin->styleSheet)) {
                echo "<link rel=\"stylesheet\" href=\"{$plugin->styleSheet}\">\n";
            }
            //add plugin includes
            foreach ($plugin->includes as $__ => $file) {
                echo "<script src=\"" . PLUGINS_FOLDER . "/" . $plugin->directory . "/$file?v=$version\"></script>\n";
            }
            echo "</div>";
        }
    }

    $srvImages = BG_TILE_SERVER;
    $srvLayers = LAYERS_TILE_SERVER;
    $protoImages = BG_DEFAULT_PROTOCOL;

    if ($layerVisible) {
        echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init with layers (variables from layers.js) -------*/
    /*---------------------------------------------------------*/

    VIEWER.bridge.loadShaders(
        APPLICATION_CONTEXT.getOption("activeVisualizationIndex"),
        function() {
            let activeData = VIEWER.bridge.dataImageSources(); 
            //reverse order: last opened IMAGE is the first visible
            let toOpen = APPLICATION_CONTEXT.setup.background.map(value => {
                const urlmaker = new Function("path,data", "return " + (value.protocol || "$protoImages"));
                return urlmaker("$srvImages", APPLICATION_CONTEXT.setup.data[value.dataReference]);
            }).reverse();
            VIEWER.bridge.createUrlMaker(VIEWER.bridge.currentVisualisation());
            toOpen.push(VIEWER.bridge.urlMaker("$srvLayers", activeData));
            window.VIEWER.open(toOpen);
    });

    //todo better error system :(
     window.VIEWER.addHandler('open-failed', function(e) {
        let sources = []; //todo create valid urls again
        USER_INTERFACE.Errors.show("No valid images.", `We were unable to open provided image sources. 
Url's are probably invalid. <br><code>\${sources.join(", ")}</code>`, true);
    });

</script>
EOF;

    } else if (count($parsedParams->background) > 0) {
        echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init without layers (layers.js) -------------------*/
    /*---------------------------------------------------------*/

     window.VIEWER.open(APPLICATION_CONTEXT.setup.background.map(value => {
        const urlmaker = new Function("path,data", "return " + (value.protocol || "$protoImages"));
        //todo absolute path? dynamic using php?
        return urlmaker("$srvImages", APPLICATION_CONTEXT.setup.data[value.dataReference]);
    }).reverse());

</script>
EOF;
    }
    ?>
</body>
</html>
