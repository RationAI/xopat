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

$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] :
    (hasKey($_GET, "visualisation") ? $_GET["visualisation"] : false);
throwFatalErrorIf(!$visualisation, "Invalid link.", "The request has no setup data. See POST data:",
        print_r($_POST, true));

/**
 * Parsing: verify valid parameters
 */

$parsedParams = json_decode($visualisation);
throwFatalErrorIf(!$parsedParams, "Invalid link.", "The visualisation setup is not parse-able.",
    "Error: " . json_last_error() . "<br>" . $visualisation);

ensureDefined($parsedParams, "params", (object)array());
ensureDefined($parsedParams, "data", array());
ensureDefined($parsedParams, "background", array());
ensureDefined($parsedParams, "shaderSources", array());
ensureDefined($parsedParams, "plugins", (object)array());
ensureDefined($parsedParams, "dataPage", (object)array());

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

$layerVisible = isset($parsedParams->visualizations) ? 1 : 0;
$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = count($_COOKIE) < 1 && !$bypassCookies;
$errors_print = "";

if ($layerVisible) {
    $layerVisible--;
    foreach ($parsedParams->visualizations as $index=>$visualisationTarget) {
        if (!isset($visualisationTarget->name)) {
            $visualisationTarget->name = "Custom Visualisation";
        }
        if (!isset($visualisationTarget->shaders)) {
            $visSummary = print_r($visualisationTarget, true);
            $errors_print .= "console.warn('Visualisation #$index removed: missing shaders definition. The layer: <code>$visSummary</code>');";
            unset($parsedParams->visualizations[$index]);
        }

        $shader_count = 0;
        foreach ($visualisationTarget->shaders as $data=>$layer) {
            if (!isset($layer->name)) {
                $temp = substr($data, max(0, strlen($data)-24), 24);
                if (strlen($temp) != strlen($data)) $temp  = "...$temp";
                $layer->name = "Source: $temp";
            }

            throwFatalErrorIf(!isset($layer->type), "No visualisation style defined for $layer->name.",
                "You must specify <b>type</b> parameter.", print_r($layer, true));

            if (!isset($layer->cache) && isset($layer->name) && isset($cookieCache->{$layer->name})) {
                $layer->cache = $cookieCache->{$layer->name};
            }
            if (!isset($layer->params)) {
                $layer->params = (object)array();
            }
            $shader_count++;
        }

        if ($shader_count > 0) {
            $layerVisible++;
        } else {
            unset($parsedParams->visualizations[$index]);
        }
    }

    //requires webgl module
    $MODULES["webgl"]->loaded = true;
    $layerVisible = $layerVisible > 0;
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
$cookie_setup = JS_COOKIE_SETUP;

function getAttributes($source, ...$properties) {
    $html = "";
    foreach ($properties as $property) {
        if (isset($source->{$property})) {
            $html .= " $property=\"{$source->{$property}}\"";
        }
    }
    return $html;
}

function printDependencies($directory, $item) {
    global $version;
    //add module style sheet if exists
    if (isset($item->styleSheet)) {
        echo "<link rel=\"stylesheet\" href=\"$item->styleSheet\" type='text/css'>\n";
    }
    foreach ($item->includes as $__ => $file) {
        if (is_string($file)) {
            echo "    <script src=\"$directory/{$item->directory}/$file?v=$version\"></script>\n";
        } else if (is_object($file)) {
            echo "    <script" . getAttributes($file, 'async', 'crossorigin', 'use-credentials',
                    'defer', 'integrity', 'referrerpolicy', 'src') . "></script>";
        } else {
            //todo ignore? error?
        }
    }
}

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

    <link rel="stylesheet" href="./assets/style.css?v=$version">
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
        <?php echo $errors_print; ?>
    </script>

    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

    <!--TODO add anonymous and integrity tags, require them from files included in safe mode-->
    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"
        integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
        crossorigin="anonymous"></script>

    <!-- OSD -->
    <script src="./openseadragon/build/openseadragon/openseadragon.js"></script>

    <!--Extensions/modifications-->
    <script src="./external/dziexttilesource.js?v=$version"></script>
    <script src="./external/osd_tools.js?v=$version"></script>
    <script src="./external/scalebar.js?v=$version"></script>
    <script src="./external/scrollTo.min.js"></script>

    <!--Tutorials-->
    <script src="./external/kinetic-v5.1.0.min.js"></script>
    <link rel="stylesheet" href="./external/enjoyhint.css">
    <script src="./external/enjoyhint.min.js"></script>

    <!--UI Classes-->
    <script src="ui_components.js"></script>

    <!--Modules-->
    <?php
    foreach ($MODULES as $_ => $mod) {
        if ($mod->loaded) {
            printDependencies(MODULES_FOLDER, $mod);
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
<span id="main-panel-show" class="material-icons btn-pointer" onclick="USER_INTERFACE.MainMenu.open();">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="background: var(--color-bg-primary); width: 400px;">
    <div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 80px;overflow-y: scroll;scrollbar-width: thin /*mozilla*/;overflow-x: hidden;">
        <div id="general-controls" class="inner-panel inner-panel-visible d-flex py-1">
            <span id="main-panel-hide" class="material-icons btn-pointer flex-1" onclick="USER_INTERFACE.MainMenu.close();">chevron_right</span>

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

            <span class="material-icons btn-pointer ml-2" onclick="UTILITIES.clone()" title="Clone and synchronize">repeat_on</span>
        </div><!--end of general controls-->

        <div id="navigator-container" data-position="relative"  class="inner-panel right-0" style="width: 400px; position: relative; background-color: var(--color-bg-canvas)">
            <div><!--the div below is re-inserted by OSD, keep it in the hierarchy at the same position-->
                <div id="panel-navigator" style=" height: 300px; width: 100%;"></div>
            </div>
            <span id="navigator-pin" class="material-icons btn-pointer inline-pin position-absolute right-2 top-2" onclick="
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
        <div id="panel-images" class="inner-panel mt-2">
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="images-pin" class="material-icons btn-pointer inline-arrow" onclick="USER_INTERFACE.clickMenuHeader($(this), $(this).parents().eq(1).children().eq(1));" style="padding: 0;"> navigate_next </span>
                        <h3 class="d-inline-block btn-pointer" onclick="USER_INTERFACE.clickMenuHeader($(this.previousElementSibling), $(this).parents().eq(1).children().eq(1));">Images</h3>
                    </div>

                    <div id="image-layer-options" class="inner-panel-hidden">
                        <!--populated with options for a given image data -->
                    </div>
                </div>
           </div>
EOF;
            }
            if ($layerVisible) {
                $opened = $firstTimeVisited || (isset($_COOKIE["_shadersPin"]) && $_COOKIE["_shadersPin"] == "true");
                $pinClass = $opened ? "opened" : "";
                $shadersSettingsClass = $opened ? "force-visible" : "";
                echo <<<EOF
          <div id="panel-shaders" class="inner-panel">

                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="shaders-pin" class="material-icons btn-pointer inline-arrow $pinClass" onclick="let jqSelf = $(this); USER_INTERFACE.clickMenuHeader(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                        document.cookie = `_shadersPin=\${jqSelf.hasClass('pressed')}; $cookie_setup`" style="padding: 0;">navigate_next</span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1 pointer" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <span id="cache-snapshot" class="material-icons btn-pointer" style="text-align:right; vertical-align:sub;float: right;" title="Remember settings" onclick="UTILITIES.makeCacheSnapshot();">bookmark</span>
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

        <div class="d-flex flex-items-end p-2 flex-1 position-fixed bottom-0 bg-opacity fixed-bg-opacity" style="width: 400px;">
            <span id="copy-url" class="pl-1 btn-pointer" onclick="UTILITIES.copyUrlToClipboard();" title="Get the visualisation link"><span class="material-icons pr-1" style="font-size: 22px;">link</span>URL</span>&emsp;
            <span id="global-export" class="pl-1 btn-pointer" onclick="UTILITIES.export();" title="Export visualisation together with plugins data"><span class="material-icons pr-1" style="font-size: 22px;">download</span>Export</span>&emsp;
            <span id="add-plugins" class="pl-1 btn-pointer" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);" title="Add plugins to the visualisation"><span class="material-icons pr-1" style="font-size: 22px;">extension</span>Plugins</span>&emsp;
            <span id="global-help" class="pl-1 btn-pointer" onclick="USER_INTERFACE.Tutorials.show();" title="Show tutorials"><span class="material-icons pr-1 pointer" style="font-size: 22px;">school</span>Tutorial</span>&emsp;
            <span id="settings" class="p-0 material-icons btn-pointer" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);" title="Settings">settings</span>
        </div>
    </div>

    <div id="plugin-tools-menu" class="position-absolute top-0 right-0 left-0 noselect"></div>
    <div id="fullscreen-menu" class="position-absolute top-0 left-0 noselect height-full color-shadow-medium" style="display:none; background: var(--color-bg-primary); z-index: 3;"></div>
    <div id="tissue-list-menu" class="position-absolute bottom-0 right-0 left-0 noselect"></div>

    <!-- Values Initialization -->
    <script type="text/javascript">
(function (window) {
    let setup = <?php echo $visualisation ?>;
    let defaultSetup = {
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
        bypassCookies: false,
        theme: "auto",
        stackedBackground: false,
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
        version: '<?php echo VERSION ?>',
        backgroundServer: '<?php echo BG_TILE_SERVER ?>',
        backgroundProtocol: '<?php echo BG_DEFAULT_PROTOCOL ?>',
        backgroundProtocolPreview: '<?php echo BG_DEFAULT_PROTOCOL_PREVIEW ?>',
        layersServer: '<?php echo LAYERS_TILE_SERVER ?>',
        layersProtocol: '<?php echo LAYERS_DEFAULT_PROTOCOL ?>',
        cookiePolicy: '<?php echo JS_COOKIE_SETUP ?>',
        url: '<?php echo SERVER . $_SERVER["REQUEST_URI"]; ?>',
        rootPath: '<?php echo VISUALISATION_ROOT_ABS_PATH ?>',
        postData: <?php echo json_encode($_POST)?>,
        layersAvailable: false, //default
        settingsMenuId: "app-settings",
        pluginsMenuId: "app-plugins",
        metaMenuId: "app-meta-data",
        getOption: function (name, defaultValue=undefined) {
            let cookie = this._getCookie(name);
            if (cookie !== undefined) return cookie;
            return this.setup.params.hasOwnProperty(name) ? this.setup.params[name] :
                (defaultValue === undefined ? this.defaultParams[name] : defaultValue);
        },
        setOption: function (name, value, cookies = false) {
            if (cookies) this._setCookie(name, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            this.setup.params[name] = value;
        },
        _setCookie: function (key, value) {
            if (!this.setup.params.bypassCookies) {
                serverCookies[key] = value;
                document.cookie = `${key}=${value}; ${APPLICATION_CONTEXT.cookiePolicy}`; //todo URL encode?
            }
        },
        _getCookie: function (key) {
            if (!this.setup.params.bypassCookies && serverCookies.hasOwnProperty(key)) {
                let value = serverCookies[key]; //todo URL decode?
                if (value === "false") value = false;
                else if (value === "true") value = true;
                return value;
            }
            return undefined;
        }
    };

    window.HTTPError = class extends Error {
        constructor(message, response) {
            super();
            this.message = message;
            this.code = response;
        }
    };

    /**
     * window.PLUGINS
     * object that contains metadata, paths for plugins,
     * holds instances of plugins and is not exported
     */
    window.PLUGINS = <?php echo json_encode((object)$PLUGINS)?>;

    //preventive error message, that will be discarded after the full initialization
    window.onerror = function (message, file, line, col, error) {
        let ErrUI = USER_INTERFACE.Errors;
        if (ErrUI.active) return false;
        ErrUI.show("Unknown error.", `Something has gone wrong: '${message}' <br><code>${error.message}
<b>in</b> ${file}, <b>line</b> ${line}</code>`, true);
        return false;
    };

})(window);
    </script>

    <!-- UI -->
    <script type="text/javascript" src="user_interface.js"></script>

    <!-- Basic Tutorial -->
    <?php include_once ("basic_tutorial.php"); ?>

    <!-- Basic Initialization -->
    <script type="text/javascript">

(function (window) {

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
        prefixUrl: "openseadragon/build/openseadragon/images",
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
        debugMode: APPLICATION_CONTEXT.getOption("debugMode"),
    });
    VIEWER.gestureSettingsMouse.clickToZoom = false;
    VIEWER.tools = new OpenSeadragon.Tools(VIEWER);

    VIEWER.addHandler('warn-user', e => {
        //todo time deduction from the message length
        //todo make this as a last handler
        Dialogs.show(e.message, 5000, Dialogs.MSG_WARN, false);
    });
    VIEWER.addHandler('error-user', e => {
        //todo time deduction from the message length
        //todo make this as a last handler
        Dialogs.show(e.message, 5000, Dialogs.MSG_ERR, false);
    });
})(window);
    </script>

    <!--Event listeners, Utilities, Exporting...-->
    <script type="text/javascript" src="scripts.js"></script>

<?php
    if ($layerVisible) {
        echo <<<EOF
    <!--Visualization setup-->
    <script type="text/javascript" src="layers.js"></script>
EOF;
    }
?>

    <!--Plugins Loading-->
    <script type="text/javascript">

(function (window) {
    var registeredPlugins = [];
    var LOADING_PLUGIN = false;
    const MODULES = <?php echo json_encode((object)$MODULES) ?>;

    function showPluginError(id, e) {
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            $(`#load-plugin-${id}`).html("");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">This plugin has been automatically
removed: there was an error. <br><code>[${e}]</code></div>`);
        $(`#load-plugin-${id}`).html(`<button disabled class="btn">Failed</button>`);
        Dialogs.show(`Plugin <b>${PLUGINS[id].name}<b> has been removed: there was an error.`,
            4000, Dialogs.MSG_ERR);
    }

    function cleanUpScripts(id) {
        $(`#script-section-${id}`).remove();
        LOADING_PLUGIN = false;
    }

    function cleanUpPlugin(id, e="Unknown error") {
        delete PLUGINS[id].instance;
        delete window[id];
        PLUGINS[id].loaded = false;
        PLUGINS[id].error = e;

        let removalIndices = [];
        for (let i = 0; i < UTILITIES._exportHandlers.length; i++) {
            if (UTILITIES._exportHandlers[i].pluginId === id) {
                removalIndices.push(i);
            }
        }
        //removed in backward pass to always access valid indices
        for (let j = removalIndices.length-1; j >= 0; j--) {
            UTILITIES._exportHandlers.splice(removalIndices[j], 1);
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
        if (!PLUGINS[id]) {
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

        plugin.id = id; //silently set
        if (window[plugin.id]) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, window[id]);
            Dialogs.show(`Plugin ${plugin.name} could not be loaded: please, contact administrator.`, 7000, Dialogs.MSG_WARN);
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS[id].instance = plugin;
        window[id] = plugin;
        plugin.setOption = function(key, value, cookies=true) {
            //todo encode/sanitize?
            if (cookies) APPLICATION_CONTEXT._setCookie(key, value);
            APPLICATION_CONTEXT.setup.plugins[id][key] = value;
        }
        plugin.getOption = function(key, defaultValue=undefined) {
            //todo encode/sanitize?
            let cookie = APPLICATION_CONTEXT._getCookie(key);
            if (cookie !== undefined) return cookie;
            return APPLICATION_CONTEXT.setup.plugins[id].hasOwnProperty(key) ?
                APPLICATION_CONTEXT.setup.plugins[id][key] : defaultValue;
        }
        //todo use this across plugns instead
        //todo encode ` character if contained
        plugin.setData = function(key, dataExportHandler) {
            UTILITIES._exportHandlers.push({name: `${key}_${id}`, call: dataExportHandler, pluginId: id});
        }
        plugin.getData = function(key) {
            return APPLICATION_CONTEXT.postData[`${key}_${id}`];
        }
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
     * @param properties script attributes to set
     * @param onload function to call on success
     */
    window.attachScript = function(pluginId, properties, onload) {
        let errHandler = function (e) {
            window.onerror = null;
            if (LOADING_PLUGIN) {
                cleanUpPlugin(pluginId, e);
            } else {
                cleanUpScripts(pluginId);
            }
        };

        if (!properties.hasOwnProperty('src')) {
            errHandler("Script property must contain 'src' attribute!");
            return;
        }

        let container = document.getElementById(`script-section-${pluginId}`);
        if (!container) {
            $("body").append(`<div id="script-section-${pluginId}"></div>`);
            container = document.getElementById(`script-section-${pluginId}`);
        }
        let script = document.createElement("script");
        for (let key in properties) {
            if (key === 'src') continue;
            script[key] = properties[key];
        }
        script.async = false;
        script.onload = function () {
            window.onerror = null;
            onload();
        };
        script.onerror = errHandler;
        window.onerror = errHandler;
        script.src = properties.src;
        container.append(script);
        return true;
    };

    /**
     * Register plugin. Plugin is instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    window.addPlugin = function(id, PluginClass) {
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

    function extendIfContains(target, source, ...properties) {
        for (let property of properties) {
            if (source.hasOwnProperty(property)) target[property] = source[property];
        }
    }

    function chainLoad(id, sources, index, onSuccess, folder='<?php echo PLUGINS_FOLDER ?>') {
        if (index >= sources.includes.length) {
            onSuccess();
        } else {
            let toLoad = sources.includes[index],
                properties = {};
            if (typeof toLoad === "string") {
                properties.src = `${folder}/${sources.directory}/${toLoad}?v=<?php echo $version?>`;
            } else if (typeof toLoad === "object") {
                extendIfContains(properties, toLoad, 'async', 'crossorigin', 'use-credentials', 'defer', 'integrity',
                    'referrerpolicy', 'src')
            } else {
                throw "Invalid dependency: invalid type " + (typeof toLoad);
            }

            attachScript(id, properties,
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
                    if (typeof module.attach === "string" && window[module.attach]) {
                        window[module.attach].metadata = module;
                    }
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
    UTILITIES.loadModules = function(onload=_=>{}, ...ids) {
        LOADING_PLUGIN = false;
        chainLoadModules(ids, 0, onload);
    };

    /**
     * Load a plugin at runtime
     * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
     * @param id plugin to load
     * @param onload function to call on successful finish
     */
    UTILITIES.loadPlugin = function(id, onload=_=>{}) {
        let meta = PLUGINS[id];
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
            if (!initializePlugin(PLUGINS[id].instance)) {
                Dialogs.show(`Plugin <b>${PLUGINS[id].name}</b> could not be loaded.`, 2500, Dialogs.MSG_WARN);
                return;
            }
            Dialogs.show(`Plugin <b>${PLUGINS[id].name}</b> has been loaded.`, 2500, Dialogs.MSG_INFO);

            if (meta.styleSheet) {  //load css if necessary
                $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
            }
            meta.loaded = true;
            if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                let plugins = [];
                for (let p in PLUGINS) {
                    if (PLUGINS[p].loaded) plugins.push(p);
                }
                document.cookie = `_plugins=${plugins.join(",")}; <?php echo JS_COOKIE_SETUP ?>`;
            }
            onload();
        };
        LOADING_PLUGIN = true;
        chainLoadModules(meta.modules || [], 0, _ => chainLoad(id, meta, 0, successLoaded));
    };

    /**
     * Check whether component is loaded
     * @param {string} id component id
     * @param {boolean} isPlugin true if check for plugins
     */
    UTILITIES.isLoaded = function (id, isPlugin=false) {
        if (isPlugin) {
            let plugin = PLUGINS[id];
            return plugin.loaded && plugin.instance;
        }
        return MODULES[id].loaded;
    };

    UTILITIES.swapBackgroundImages = function (bgIndex) {
        const activeBackground = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
        if (activeBackground === bgIndex) return;
        const image = APPLICATION_CONTEXT.setup.background[bgIndex],
            imagePath = APPLICATION_CONTEXT.setup.data[image.dataReference],
            sourceUrlMaker = new Function("path,data", "return " +
            (image.protocol || APPLICATION_CONTEXT.backgroundProtocol));

        let prevImage = VIEWER.world.getItemAt(0);
        let url = sourceUrlMaker(APPLICATION_CONTEXT.backgroundServer, imagePath);
        VIEWER.addTiledImage({
            tileSource: url,
            index: 0,
            opacity: 1,
            replace: true,
            success: function (e) {
                APPLICATION_CONTEXT.setOption('activeBackgroundIndex', bgIndex);
                let previousBackgroundSetup = APPLICATION_CONTEXT.setup.background[activeBackground];
                VIEWER.raiseEvent('background-image-swap', {
                    backgroundImageUrl: url,
                    prevBackgroundSetup: previousBackgroundSetup,
                    backgroundSetup: image,
                    previousTiledImage: prevImage,
                    tiledImage: e.item,
                });
                let container = document.getElementById('tissue-preview-container');
                container.children[activeBackground].classList.remove('selected');
                container.children[bgIndex].classList.add('selected');
            }
        });
    };

    function fireTheVisualization() {
        window.VIEWER.removeHandler('open', fireTheVisualization);
        let i = 0, selectedImageLayer = 0;
        let setup = APPLICATION_CONTEXT.setup;

        if (APPLICATION_CONTEXT.getOption("stackedBackground") || setup.background.length < 2 /*todo show allways but hiden in this case*/) {
            let largestWidth = 0,
                imageNode = $("#image-layer-options");
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
        } else {
            let html = "", activeIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
            for (let idx = 0; idx < setup.background.length; idx++ ) {
                let image = setup.background[idx],
                    imagePath = setup.data[image.dataReference];
                const previewUrlmaker = new Function("path,data", "return " +
                    (image.protocolPreview || APPLICATION_CONTEXT.backgroundProtocolPreview));
                html += `
<div onclick="UTILITIES.swapBackgroundImages(${idx});"
class="${activeIndex === idx ? 'selected' : ''} pointer position-relative"><img src="${
previewUrlmaker(APPLICATION_CONTEXT.backgroundServer, imagePath)
 }"/></div>
                `;
            }
            $("#panel-images").remove(); //necessary in other mode only
            //use switching panel
            USER_INTERFACE.TissueList.setMenu('__viewer', '__tisue_list', "Tissues", `
<div id="tissue-preview-container">${html}</div>`);
            i++; //rendering group always second
        }


        //the viewer scales differently-sized layers sich that the biggest rules the visualization
        //this is the largest image layer
        VIEWER.tools.linkReferenceTileSourceIndex(selectedImageLayer);

        //private API
        if (setup.hasOwnProperty("visualizations") && VIEWER.bridge) {
            VIEWER.bridge._onload(i);
        }

        let microns = APPLICATION_CONTEXT.getOption("microns");
        if (microns && APPLICATION_CONTEXT.getOption("scaleBar")) {
            VIEWER.scalebar({
                pixelsPerMeter: microns * 1e3,
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

        for (let modID in MODULES) {
            const module = MODULES.hasOwnProperty(modID) && MODULES[modID];
            if (module && module.loaded && typeof module.attach === "string" && window[module.attach]) {
                window[module.attach].metadata = module;
            }
        }

        //Notify plugins OpenSeadragon is ready
        registeredPlugins.forEach(plugin => initializePlugin(plugin));
        registeredPlugins = undefined;

        let focus = APPLICATION_CONTEXT.getOption("viewport");
        if (focus && focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
            window.VIEWER.viewport.panTo(focus.point, true);
            window.VIEWER.viewport.zoomTo(focus.zoomLevel, null, true);
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
        if ($firstTimeVisited) {
            echo "        setTimeout(function() {
                    USER_INTERFACE.Tutorials.show('It looks like this is your first time here', 
                        'Please, go through <b>Basic Functionality</b> tutorial to familiarize yourself with the environment.');
            }, 2000);";
        }
        ?>
        VIEWER.raiseEvent('loaded');
    }
    window.VIEWER.addHandler('open', fireTheVisualization);

    /*---------------------------------------------------------*/
    /*------------ Initialization of UI -----------------------*/
    /*---------------------------------------------------------*/

    USER_INTERFACE.AdvancedMenu._build();
})(window);
    </script>

    <!-- Permanently Loaded Plugins -->
    <?php
    foreach ($PLUGINS as $_ => $plugin) {
        if ($plugin->loaded) {
            echo "<div id='script-section-{$plugin->id}'>";
            printDependencies(PLUGINS_FOLDER, $plugin);
            echo "</div>";
        }
    }

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
            let toOpen;
            if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
                toOpen = APPLICATION_CONTEXT.setup.background.map(value => {
                    const urlmaker = new Function("path,data", "return " + (value.protocol || APPLICATION_CONTEXT.backgroundProtocol));
                    return urlmaker(APPLICATION_CONTEXT.backgroundServer, APPLICATION_CONTEXT.setup.data[value.dataReference]);
                }).reverse(); //reverse order: last opened IMAGE is the first visible
            } else {
                let selectedImage = APPLICATION_CONTEXT.setup.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)];
                const urlmaker = new Function("path,data", "return " + (selectedImage.protocol || APPLICATION_CONTEXT.backgroundProtocol))
                toOpen = [urlmaker(APPLICATION_CONTEXT.backgroundServer, APPLICATION_CONTEXT.setup.data[selectedImage.dataReference])];
            }
          
            VIEWER.bridge.createUrlMaker(VIEWER.bridge.visualization());
            toOpen.push(VIEWER.bridge.urlMaker(APPLICATION_CONTEXT.layersServer, activeData));
            window.VIEWER.open(toOpen);
    });

</script>
EOF;

    } else if (count($parsedParams->background) > 0) {
        echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init without layers (layers.js) -------------------*/
    /*---------------------------------------------------------*/
    
(function (window) {
        
    let toOpen;
    if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
        toOpen = APPLICATION_CONTEXT.setup.background.map(value => {
            const urlmaker = new Function("path,data", "return " + (value.protocol || APPLICATION_CONTEXT.backgroundProtocol));
            return urlmaker(APPLICATION_CONTEXT.backgroundServer, APPLICATION_CONTEXT.setup.data[value.dataReference]);
        }).reverse(); //reverse order: last opened IMAGE is the first visible
    } else {
        let selectedImage = APPLICATION_CONTEXT.setup.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)];
        const urlmaker = new Function("path,data", "return " + (selectedImage.protocol || APPLICATION_CONTEXT.backgroundProtocol));
        toOpen = [urlmaker(APPLICATION_CONTEXT.backgroundServer, APPLICATION_CONTEXT.setup.data[selectedImage.dataReference])];
    }
    window.VIEWER.open(toOpen);
}(window)); 

</script>
EOF;
    }
?>
</body>
</html>
