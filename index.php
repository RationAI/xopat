<?php

if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}

require_once("config.php");

global $version, $i18n;
$version = VERSION;
$errors_print = "";

set_exception_handler(function (Throwable $exception) {
    global $i18n;
    if (!isset($i18n)) {
        require_once PROJECT_SOURCES . 'i18m.class.php';
        $i18n = i18n_mock::default($_GET["lang"] ?? "en", LOCALES_ROOT);
    }
    throwFatalErrorIf(true, "error.unknown", "", $exception->getMessage());
});

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function isBoolFlagInObject($object, $key) {
    if (!isset($object->$key)) return false;
    $v = $object->$key;
    return (gettype($v) === "string" && $v !== "" && $v !== "false") || $v;
}

function printJSConsole($message, $is_error=true) {
    global $errors_print;
    $fn = $is_error ? "error" : "warn";
    $errors_print .= "console.$fn(`$message`);";
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        require_once(PROJECT_SOURCES . "error.php");
        show_error($title, $description, $details, $_GET["lang"] ?? 'en');
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
//todo visualisation -> visualization
$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] :
    (hasKey($_GET, "visualisation") ? $_GET["visualisation"] : false);
if (!$visualisation) {
    //for json-based POST requests
    $_POST = json_decode(file_get_contents('php://input'));
    $visualisation = $_POST["visualisation"];
}

file_put_contents('/mnt/data/visualization/importer/data/test.txt', $visualisation);

throwFatalErrorIf(!$visualisation, "messages.urlInvalid", "messages.invalidPostData",
        print_r($_POST, true));

/**
 * Parsing: verify valid parameters
 */

//params that come in might be associative arrays :/
$parsedParams = $visualisation;
if (is_string($visualisation)) $parsedParams = json_decode($parsedParams);
throwFatalErrorIf(!is_object($parsedParams), "messages.urlInvalid", "messages.postDataSyntaxErr",
    "JSON Error: " . json_last_error_msg() . "<br>" . print_r($visualisation, true));

ensureDefined($parsedParams, "params", (object)array());
ensureDefined($parsedParams, "data", array());
ensureDefined($parsedParams, "background", array());
ensureDefined($parsedParams, "shaderSources", array());
ensureDefined($parsedParams, "plugins", (object)array());

$is_debug = isBoolFlagInObject($parsedParams->params, "debugMode");
if ($is_debug) {
    error_reporting(E_ERROR);
    ini_set('display_errors', 1);
}
$bypassCookies = isBoolFlagInObject($parsedParams->params, "bypassCookies");
$locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");

//now we can translate - translation known
require_once PROJECT_SOURCES . 'i18n.class.php';
i18n::$debug = $is_debug;
$i18n = i18n::default($locale, LOCALES_ROOT);

//load modules and plugins after translation is ready
require_once(PROJECT_SOURCES . "plugins.php");

foreach ($parsedParams->background as $bg) {
    throwFatalErrorIf(!isset($bg->dataReference), "messages.urlInvalid", "messages.bgReferenceMissing",
        print_r($parsedParams->background, true));

    throwFatalErrorIf(!is_numeric($bg->dataReference) || $bg->dataReference >= count($parsedParams->data),
        "messages.urlInvalid", "messages.bgReferenceMissing",
        "Invalid data reference value '$bg->dataReference'. Available data: " . print_r($parsedParams->data, true));
}

$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = count($_COOKIE) < 1 && !$bypassCookies;

if (isset($parsedParams->visualizations)) {
    //requires webgl module
    $MODULES["webgl"]->loaded = true;
}

/**
 * Plugins+Modules loading: load required parts of the application
 */
$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];

foreach ($PLUGINS as $key => $plugin) {
    if (!$plugin->id) {
        $errors_print .= "console.warn('Plugin ($key) removed: probably include.json misconfiguration.');";
        unset($PLUGINS[$key]);
    }

    if (file_exists(PLUGINS_FOLDER . $plugin->directory . "/style.css")) {
        $plugin->styleSheet = PLUGINS_FOLDER . $plugin->directory . "/style.css?v=$version";
    }

    $hasParams = isset($parsedParams->plugins->{$plugin->id});
    $plugin->loaded = !isset($plugin->error) &&
        (isset($parsedParams->plugins->{$plugin->id})
            || (isset($plugin->permaLoad) && $plugin->permaLoad) //param in the static config
            || $hasParams && $plugin->$parsedParams->plugins->{$plugin->id}->permaLoad //param in the plugin params
            || in_array($plugin->id, $pluginsInCookies)
        );

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

?>
<!DOCTYPE html>
<html lang="en" dir="ltr" data-light-theme="light">

<head>
    <meta charset="utf-8">
    <title>Visualisation</title>

    <link rel="apple-touch-icon" sizes="180x180" href="<?php echo ASSETS_ROOT; ?>apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="<?php echo ASSETS_ROOT; ?>favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="<?php echo ASSETS_ROOT; ?>favicon-16x16.png">
<!--    <link rel="manifest" href="./assets/site.webmanifest">-->
    <link rel="mask-icon" href="<?php echo ASSETS_ROOT; ?>safari-pinned-tab.svg" color="#5bbad5">
    <meta name="msapplication-TileColor" content="#da532c">

    <link rel="stylesheet" href="<?php echo ASSETS_ROOT; ?>style.css?v=$version">
    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>primer_css.css">
    <!--
    Possible external dependency
    <link href="https://unpkg.com/@primer/css@^16.0.0/dist/primer.css" rel="stylesheet" />
    -->

    <!--Remember WARNS/ERRORS to be able to export-->
    <script type="text/javascript">
        (function () {
            window.console.appTrace = [];

            const defaultError = console.error;
            const timestamp = () => {
                let ts = new Date(), pad = "000", ms = ts.getMilliseconds().toString();
                return ts.toLocaleTimeString("cs-CZ") + "." + pad.substring(0, pad.length - ms.length) + ms + " ";
            };
            window.console.error = function () {
                window.console.appTrace.push("ERROR ",
                    // (new Error().stack.split("at ")[1]).trim(), " ",
                    timestamp(), ...arguments, "\n");
                defaultError.apply(window.console, arguments);
            };

            const defaultWarn = console.warn;
            window.console.warn = function () {
                window.console.appTrace.push("WARN  ", ...arguments, "\n");
                defaultWarn.apply(window.console, arguments);
            };
        })();

        <?php echo $errors_print; ?>
    </script>

    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

    <!--TODO add anonymous and integrity tags, require them from files included in safe mode-->
    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"
        integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
        crossorigin="anonymous"></script>

    <script src="config_meta.js"></script>

    <!-- basic utilities-->
    <script src="<?php echo EXTERNAL_SOURCES; ?>js.cookie.js"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>i18next.min.js"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>i18next.jquery.min.js"></script>

    <!-- OSD -->
    <script src="<?php echo OPENSEADRAGON_BUILD; ?>"></script>

    <!--OSD extensions-->
    <script src="<?php echo EXTERNAL_SOURCES; ?>dziexttilesource.js?v=<?php echo $version?>"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>emptytilesource.js?v=<?php echo $version?>"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>osd_tools.js?v=<?php echo $version?>"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>scalebar.js?v=<?php echo $version?>"></script>

    <!--Tutorials-->
    <script src="<?php echo EXTERNAL_SOURCES; ?>scrollTo.min.js"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>kinetic-v5.1.0.min.js"></script>
    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>enjoyhint.css">
    <script src="<?php echo EXTERNAL_SOURCES; ?>enjoyhint.min.js"></script>

    <script src="<?php echo PROJECT_SOURCES; ?>loader.js"></script>

    <!--UI Classes-->
    <script src="<?php echo PROJECT_SOURCES; ?>ui_components.js"></script>
</head>
<body style="overflow: hidden;">
<!-- OSD viewer -->
<div id="viewer-container" class="position-absolute width-full height-full top-0 left-0" style="pointer-events: none;">
    <div id="osd" style="pointer-events: auto;" class="position-absolute width-full height-full top-0 left-0"></div>
</div>

<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center">
        <span class="material-icons f0-light mr-1" style="transform: translate(0px, -5px);">error_outline</span>
        <span data-i18n="error.title">Error</span>
    </div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <div class="text-small text-center" data-i18n="error.doExport"> [ if you want to report a problem, please include exported file ] </div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button" data-i18n="error.detailsBtn">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="display: none;max-height: 50vh;"></div>
</div>

<!--Tutorials-->
<div id="tutorials-container" class="d-none system-container">
    <div id="tutorials-title" class="f1-light text-center clearfix"></div>
    <p id="tutorials-description" class="text-center"></p>
    <!--<p class="text-center">You can also show tutorial section by pressing 'H' on your keyboard.</p>-->
    <br>
    <div id="tutorials"></div>
    <br><br><button class="btn" onclick="USER_INTERFACE.Tutorials.hide();" data-i18n="common.Exit">Exit</button>
</div>

<!-- Main Panel -->
<span id="main-panel-show" class="material-icons btn-pointer" onclick="USER_INTERFACE.MainMenu.open();">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="background: var(--color-bg-primary); width: 400px;">
    <div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 80px;overflow-y: scroll;scrollbar-width: thin /*mozilla*/;overflow-x: hidden;">
        <div id="general-controls" class="inner-panel inner-panel-visible d-flex py-1">
            <span id="main-panel-hide" class="material-icons btn-pointer flex-1" onclick="USER_INTERFACE.MainMenu.close();">chevron_right</span>

            <span id="global-opacity">
                <label>
                    <span data-i18n="main.global.layerOpacity">Layer Opacity</span>
                    <input type="range"  min="0" max="1" value="1" step="0.1" class="ml-1" style="width: 100px;">
                </label>
                &emsp;
            </span>

            <span id="global-tissue-visibility">
                <label>
                    <span data-i18n="main.global.tissue">Tissue</span>
                    <input type="checkbox" style="align-self: center;" checked class="form-control ml-1" onchange="VIEWER.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
                </label>
                &emsp;
            </span>

            <span class="material-icons btn-pointer ml-2 pr-0" onclick="UTILITIES.clone()" data-i18n="[title]main.global.clone">repeat_on</span>
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
            <div id="tissue-title-header" class="one-liner" style="max-height: 255px;"></div>
        </div>

        <div id="panel-images" class="inner-panel mt-2"></div>

        <?php
                $opened = $firstTimeVisited || (isset($_COOKIE["_shadersPin"]) && $_COOKIE["_shadersPin"] == "true");
                $pinClass = $opened ? "opened" : "";
                $shadersSettingsClass = $opened ? "force-visible" : "";
                echo <<<EOF
          <div id="panel-shaders" class="inner-panel" style="display:none;">

                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="shaders-pin" class="material-icons btn-pointer inline-arrow $pinClass" onclick="let jqSelf = $(this); USER_INTERFACE.clickMenuHeader(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                        APPLICATION_CONTEXT._setCookie('_shadersPin', `\${jqSelf.hasClass('opened')}`);" style="padding: 0;">navigate_next</span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1 pointer" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <div class="d-inline-block float-right position-relative">
                            <span id="cache-snapshot" class="material-icons btn-pointer text-right" 
                            style="vertical-align:sub;" data-i18n="[title]main.shaders.saveCookies">bookmark</span>
                            <div class="position-absolute px-2 py-1 rounded-2 border-sm cache-snapshot-visible top-0 right-2 flex-row" 
                            style="display: none; background: var(--color-bg-tertiary);">
                                <span class="material-icons btn-pointer" data-i18n="[title]main.shaders.cookiesByName" onclick="UTILITIES.makeCacheSnapshot(true);">sort_by_alpha</span>
                                <span class="material-icons btn-pointer" data-i18n="[title]main.shaders.cookiesByOrder" onclick="UTILITIES.makeCacheSnapshot(false);">format_list_numbered</span>
                            </div>
                        </div>
                    </div>

                    <div id="data-layer-options" class="inner-panel-hidden $shadersSettingsClass">
                            <!--populated with options for a given image data -->
                    </div>
                    <div id="blending-equation"></div>
                </div>
            </div>
EOF;
            ?>

            <!-- Appended controls for other plugins -->
        </div>

        <div class="d-flex flex-items-end px-1 flex-1 position-fixed bottom-0 bg-opacity fixed-bg-opacity" style="width: 400px;">
            <span id="copy-url" class="btn-pointer py-2 pr-1" onclick="UTILITIES.copyUrlToClipboard();" data-i18n="[title]main.bar.explainExportUrl">
                <span class="material-icons pr-0" style="font-size: 22px;">link</span>
                <span data-i18n="main.bar.exportUrl">URL</span>
            </span>&emsp;
            <span id="global-export" class="btn-pointer py-2 pr-1" onclick="UTILITIES.export();" data-i18n="[title]main.bar.explainExportFile">
                <span class="material-icons pr-0" style="font-size: 22px;">download</span>
                <span data-i18n="main.bar.exportFile">Export</span>
            </span>&emsp;
            <span id="add-plugins" class="btn-pointer py-2 pr-1" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);" data-i18n="[title]main.bar.explainPlugins">
                <span class="material-icons pr-0" style="font-size: 22px;">extension</span>
                <span data-i18n="main.bar.plugins">Plugins</span>
            </span>&emsp;
            <span id="global-help" class="btn-pointer py-2 pr-1" onclick="USER_INTERFACE.Tutorials.show();" data-i18n="[title]main.bar.explainTutorials">
                <span class="material-icons pr-0 pointer" style="font-size: 22px;">school</span>
                <span data-i18n="main.bar.tutorials">Tutorial</span>
            </span>&emsp;
            <span id="settings" class="p-0 material-icons btn-pointer py-2 pr-1" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);" data-i18n="[title]main.bar.settings">settings</span>
        </div>
    </div>

    <div id="plugin-tools-menu" class="position-absolute top-0 right-0 left-0 noselect"></div>
    <div id="fullscreen-menu" class="position-absolute top-0 left-0 noselect height-full color-shadow-medium" style="display:none; background: var(--color-bg-primary); z-index: 3;"></div>

    <!-- Values Initialization -->
    <script type="text/javascript">


(function (window) {
    /*---------------------------------------------------------*/
    /*---------- APPLICATION_CONTEXT and viewer data ----------*/
    /*---------------------------------------------------------*/

    const PLUGINS = <?php echo json_encode((object)$PLUGINS)?>;
    const MODULES = <?php echo json_encode((object)$MODULES) ?>;
    const runLoader = initXOpatLoader(PLUGINS, MODULES,
        '<?php echo PLUGINS_FOLDER ?>', '<?php echo MODULES_FOLDER ?>', '<?php echo VERSION ?>');

    const setup = <?php echo $visualisation ?>;
    const postData = <?php unset($_POST["visualisation"]); echo json_encode($_POST); ?>;
    const defaultSetup = {
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
        permaLoadPlugins: true,
        bypassCookies: false,
        theme: "auto",
        stackedBackground: false,
        maxImageCacheCount: 1200,
        webGlPreferredVersion: "2.0",
        secureMode: false,
    };

    const sameSite = JSON.parse(`"<?php echo JS_COOKIE_SAME_SITE ?>"`);
    const cookies = Cookies;

    Cookies.withAttributes({
        path: JSON.parse(`"<?php echo JS_COOKIE_PATH ?>"`) || undefined,
        expires: JSON.parse(`<?php echo JS_COOKIE_EXPIRE ?>`) || undefined,
        sameSite: JSON.parse(`"<?php echo JS_COOKIE_SAME_SITE ?>"`) || undefined,
        secure: typeof sameSite === "boolean" ? sameSite : undefined
    });

    //default parameters not extended by setup.params (would bloat link files)
    setup.params = setup.params || {};
    //optimization allways present
    setup.params.bypassCookies = setup.params.bypassCookies ?? defaultSetup.bypassCookies;

    const metaStore = new MetaStore(setup.meta || {});

    window.APPLICATION_CONTEXT = {
        config: {
            get params () { // getOption should be preferred over params access
                return setup.params || {};
            },
            get meta () {
                return metaStore;
            },
            get data () {
                return setup.data || [];
            },
            get background () {
                return setup.background || [];
            },
            get visualizations () {
                return setup.visualizations || [];
            },
            get shaderSources () {
                return setup.shaderSources || [];
            },
            get plugins () {
                return setup.plugins || {};
            },
        },
        //here are all parameters supported by the core visualization
        get defaultConfig() {
           return defaultSetup;
        },
        get version() {
            return '<?php echo VERSION ?>';
        },
        get backgroundServer() {
            return '<?php echo BG_TILE_SERVER ?>';
        },
        get backgroundProtocol() {
            return '<?php echo BG_DEFAULT_PROTOCOL ?>';
        },
        get backgroundProtocolPreview() {
            return '<?php echo BG_DEFAULT_PROTOCOL_PREVIEW ?>';
        },
        get layersServer() {
            return '<?php echo LAYERS_TILE_SERVER ?>';
        },
        get layersProtocol() {
            return '<?php echo LAYERS_DEFAULT_PROTOCOL ?>';
        },
        get url() {
            return '<?php echo SERVER . $_SERVER["REQUEST_URI"]; ?>';
        },
        get rootPath() {
            return '<?php echo VISUALISATION_ROOT_ABS_PATH ?>';
        },
        get postData() {
            return postData;
        },
        get settingsMenuId() { return "app-settings"; },
        get pluginsMenuId() { return "app-plugins"; },
        layersAvailable: false, //default todo getter instead
        getOption(name, defaultValue=undefined) {
            let cookie = this._getCookie(name);
            if (cookie !== undefined) return cookie;
            let value = this.config.params[name] !== undefined ? this.config.params[name] :
                (defaultValue === undefined ? this.defaultConfig[name] : defaultValue);
            if (value === "false") value = false; //true will eval to true anyway
            return value;
        },
        setOption(name, value, cookies = false) {
            if (cookies) this._setCookie(name, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            this.config.params[name] = value;
        },
        getData(key) {
            return APPLICATION_CONTEXT.postData[key];
        },
        setDirty() {
            this.__cache.dirty = true;
        },
        pluginIds() {
            return Object.keys(PLUGINS);
        },
        activePluginIds() {
            const result = [];

            for (let pid in PLUGINS) {
                if (!PLUGINS.hasOwnProperty(pid)) continue;
                const plugin = PLUGINS[pid];

                if (!plugin.error && plugin.instance && (plugin.loaded || plugin.permaLoad)) {
                    result.push(pid);
                }
            }
            return result;
        },
        referencedFileName(stripSuffix=false) { //todo unify namespace, move to tools or other function here?
            if (setup.background.length < 0) {
                return undefined;
            }
            const bgConfig = VIEWER.tools.referencedTiledImage()?.getBackgroundConfig();
            if (bgConfig) return UTILITIES.fileNameFromPath(setup.data[bgConfig.dataReference], stripSuffix);
            return undefined;
        },
        _setCookie(key, value) {
            if (!this.config.params.bypassCookies) {
                cookies.set(key, value);
            }
        },
        _getCookie(key, defaultValue=undefined, willParse=false) {
            if (!this.config.params.bypassCookies) {
                let value = cookies.get(key);

                if (!willParse) {
                    if (value === "false") value = false;
                    else if (value === "true") value = true;
                }
                return value;
            }
            return defaultValue;
        },
        _dangerouslyAccessConfig() {
            //remove in the future?
            return setup;
        },
        _dangerouslyAccessPlugin(id) {
            //remove in the future?
            return PLUGINS[id];
        },
        __cache: {
            dirty: false
        }
    };
    metaStore.initPersistentStore('<?php echo METADATA_SERVER ?>');

    //preventive error message, that will be discarded after the full initialization, no translation
    window.onerror = function (message, file, line, col, error) {
        let ErrUI = USER_INTERFACE.Errors;
        if (ErrUI.active) return false;
        ErrUI.show("Unknown error.", `Something has gone wrong: '${message}' <br><code>${error.message}
<b>in</b> ${file}, <b>line</b> ${line}</code>`, true);
        return false;
    };

    i18next.init({
        debug: APPLICATION_CONTEXT.getOption("debugMode"),
        resources: {
            '<?php echo $i18n->getAppliedLang() ?>' : <?php echo $i18n->getRawData() ?>
        },
        lng: '<?php echo $i18n->getAppliedLang() ?>',
        fallbackLng: 'en',
    }, (err, t) => {
        if (err) throw err;

        jqueryI18next.init(i18next, $, {
            tName: 't', // $.t = i18next.t
            i18nName: 'i18n', // $.i18n = i18next
            handleName: 'localize', // $(selector).localize(opts);
            selectorAttr: 'data-i18n', // data-() attribute
            targetAttr: 'i18n-target', // data-() attribute
            optionsAttr: 'i18n-options', // data-() attribute
            useOptionsAttr: false, // see optionsAttr
            parseDefaultValueFromContent: true // parses default values from content ele.val or ele.text
        });
        //clean up
        delete window.jqueryI18next;
        delete window.i18next;
        $('body').localize();
    });

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./src/error.php?title=${encodeURIComponent('Your browser is not supported.')}
&description=${encodeURIComponent('ERROR: The visualisation requires canvasses in order to work.')}`;
    }

    // Initialize viewer - OpenSeadragon
    window.VIEWER = OpenSeadragon({
        id: "osd",
        prefixUrl: "openseadragon/build/openseadragon/images", //todo configurable
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
        maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount")
    });
    VIEWER.gestureSettingsMouse.clickToZoom = false;
    new OpenSeadragon.Tools(VIEWER);
    VIEWER.addHandler('warn-user', e => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50*e.message.length, 15000), 5000), Dialogs.MSG_WARN, false);
    }, -Infinity);
    VIEWER.addHandler('error-user', e => {
        if (e.preventDefault || !e.message) return;
        Dialogs.show(e.message, Math.max(Math.min(50*e.message.length, 15000), 5000), Dialogs.MSG_ERR, false);
    }, -Infinity);
    VIEWER.addHandler('plugin-failed', e => Dialogs.show(e.message, 6000, Dialogs.MSG_ERR));
    VIEWER.addHandler('plugin-loaded', e => Dialogs.show($.t('messages.pluginLoadedNamed', {plugin: PLUGINS[e.id].name}), 2500, Dialogs.MSG_INFO));

    /*---------------------------------------------------------*/
    /*----------------- MODULE/PLUGIN core API ----------------*/
    /*---------------------------------------------------------*/

    //properties depentend and important to change on bg image load/swap
    //index is the TiledImage index in OSD - usually 0, with stacked bgs the selected background...
    function updateBackgroundChanged(index) {
        //the viewer scales differently-sized layers sich that the biggest rules the visualization
        //this is the largest image layer, or possibly the rendering layers layer
        VIEWER.tools.linkReferenceTileSourceIndex(index);
        const tiledImage = VIEWER.tools.referencedTiledImage(),
            imageData = tiledImage?.getBackgroundConfig();

        const title = $("#tissue-title-header").removeClass('error-container');
        if (Number.isInteger(Number.parseInt(imageData?.dataReference))) {
            const name = imageData.name || UTILITIES.fileNameFromPath(
                APPLICATION_CONTEXT.config.data[imageData.dataReference]
            );
            title.html(name);
            title.attr('title', name);
        } else if (!tiledImage || tiledImage.source instanceof EmptyTileSource) {
            title.addClass('error-container').html($.t('main.navigator.faultyTissue'));
        }

        if (imageData && APPLICATION_CONTEXT.getOption("scaleBar")) {
            const microns = imageData.microns;
            const metricPx = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC;
            VIEWER.scalebar({
                pixelsPerMeter: microns * 1e3 || 1,
                sizeAndTextRenderer: microns ?
                    OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH
                    : (ppm, minSize) => metricPx(ppm, minSize, "px", false),
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
        } else {
            VIEWER.scalebar({
                destroy: true
            });
        }
    }

    let preventedSwap = false;

    /**
     * Change background image if not in stacked mode
     * @param bgIndex
     */
    window.UTILITIES.swapBackgroundImages = function (bgIndex) {
        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            console.error("UTILITIES::swapBackgroundImages not supported in stackedBackground mode!");
            return;
        }
        if (preventedSwap) {
            Dialogs.show($.t('messages.stillLoadingSwap'), 5000, Dialogs.MSG_WARN);
            return;
        }
        let activeBackground = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
        if (typeof activeBackground === "string") activeBackground = Number.parseInt(activeBackground);
        if (activeBackground === bgIndex) return;
        const image = APPLICATION_CONTEXT.config.background[bgIndex],
            imagePath = APPLICATION_CONTEXT.config.data[image.dataReference],
            sourceUrlMaker = new Function("path,data", "return " +
                (image.protocol || APPLICATION_CONTEXT.backgroundProtocol));

        let prevImage = VIEWER.world.getItemAt(0);
        let url = sourceUrlMaker(APPLICATION_CONTEXT.backgroundServer, imagePath);
        preventedSwap = true;
        VIEWER.addTiledImage({
            tileSource: url,
            index: 0,
            opacity: 1,
            replace: true,
            success: function (e) {
                preventedSwap = false;
                APPLICATION_CONTEXT.setOption('activeBackgroundIndex', bgIndex);
                e.item.getBackgroundConfig = () => APPLICATION_CONTEXT.config.background[bgIndex];
                updateBackgroundChanged(0);
                let previousBackgroundSetup = APPLICATION_CONTEXT.config.background[activeBackground];
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
            },
            error: function (e) {
                preventedSwap = false;
                console.error("Swap Images Failure", e);
                let container = document.getElementById('tissue-preview-container');
                Dialogs.show($.t('messages.swapImagesFail'), 5000, Dialogs.MSG_ERR);
                container.children[bgIndex].classList.remove('selected');
                container.children[activeBackground].classList.add('selected');
            }
        });
    };

    //initialization of UI and handling of background image load errors
    let reopenCounter = -1;
    function handleSyntheticOpenEvent() {
        reopenCounter += 1; //so that immediately the value is set

        let confData = APPLICATION_CONTEXT.config.data,
            confBackground = APPLICATION_CONTEXT.config.background;

        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            let i = 0, selectedImageLayer = 0;
            let imageOpts = [];
            let largestWidth = 0,
                imageNode = $("#image-layer-options");
            //image-layer-options can be missing --> populate menu only if exists
            if (imageNode) {
                for (let idx = confBackground.length - 1; idx >= 0; idx-- ) {
                    const image = confBackground[idx],
                        worldItem =  VIEWER.world.getItemAt(i),
                        referencedImage = worldItem?.getBackgroundConfig();

                    if (image == referencedImage) {
                        //todo not very flexible...
                        if (image.hasOwnProperty("lossless") && image.lossless) {
                            worldItem.source.fileFormat = "png";
                        }
                        let width = worldItem.getContentSize().x;
                        if (width > largestWidth) {
                            largestWidth = width;
                            selectedImageLayer = i;
                        }
                        imageOpts.push(`
<div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" checked class="form-control"
onchange="VIEWER.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);" style="margin: 5px;">
<span class="pr-1" style="color: var(--color-text-tertiary)">${$.t('common.Image')}</span>
${UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
max="1" value="${worldItem.getOpacity()}" step="0.1" onchange="VIEWER.world.getItemAt(${i}).setOpacity(Number.parseFloat(this.value));" style="width: 100%;"></div>`);
                        i++;
                    } else {
                        imageOpts.push(`
<div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" disabled class="form-control" style="margin: 5px;">
<span class="pr-1" style="color: var(--color-text-danger)">${$.t('common.Faulty')}</span>
${UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
max="1" value="0" step="0.1" style="width: 100%;" disabled></div>`);
                    }
                }
            }
            imageOpts.push(`<div class="inner-panel-content noselect" id="inner-panel-content-1">
        <div>
             <span id="images-pin" class="material-icons btn-pointer inline-arrow" onclick="USER_INTERFACE.clickMenuHeader($(this), $(this).parents().eq(1).children().eq(1));" style="padding: 0;"> navigate_next </span>
             <h3 class="d-inline-block btn-pointer" onclick="USER_INTERFACE.clickMenuHeader($(this.previousElementSibling), $(this).parents().eq(1).children().eq(1));">Images</h3>
        </div>
        <div id="image-layer-options" class="inner-panel-hidden">`);
            imageOpts = imageOpts.reverse();
            imageOpts.push("</div></div>");
            $("#panel-images").html(imageOpts.join("")).css('display', 'block');

            $("#global-tissue-visibility").css("display", "none");
            handleSyntheticEventFinishWithValidData(selectedImageLayer, i);
            return;
        }

        $("#panel-images").html("").css('display', 'none');

        const activeIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
        if (confBackground.length > 1) {
            let html = "";
            for (let idx = 0; idx < confBackground.length; idx++ ) {
                const image = confBackground[idx],
                    imagePath = confData[image.dataReference];

                if (APPLICATION_CONTEXT.config.params.secureMode) delete image.protocolPreview;

                const previewUrlmaker = new Function("path,data", "return " +
                    (image.protocolPreview || APPLICATION_CONTEXT.backgroundProtocolPreview));
                html += `
<div onclick="UTILITIES.swapBackgroundImages(${idx});"
class="${activeIndex == idx ? 'selected' : ''} pointer position-relative" style="width: 100px; background: url('${
                    previewUrlmaker(APPLICATION_CONTEXT.backgroundServer, imagePath)
                }') center; height: 100%; border-bottom: 1px solid var(--color-bg-backdrop);"></div>`;
            }

            //use switching panel
            USER_INTERFACE.Tools.setMenu('__viewer', '__tisue_list', $.t('common.Tissues'), `<div id="tissue-preview-container">${html}</div>`);
        }

        if (confBackground.length > 0) {
            $("#global-tissue-visibility").css("display", "initial");

            const image = confBackground[activeIndex],
                worldItem = VIEWER.world.getItemAt(0);

            const referencedImage = worldItem?.getBackgroundConfig();

            if (image != referencedImage) {
                const dimensions = worldItem?.getContentSize();
                VIEWER.addTiledImage({
                    tileSource : new EmptyTileSource({
                        height: dimensions?.y || 20000,
                        width: dimensions?.x || 20000,
                        tileSize: 512 //can be arbitrary, 512 works well...
                    }),
                    index: 0,
                    opacity: $("#global-opacity input").val(),
                    replace: false,
                    success: (event) => {
                        event.item.getBackgroundConfig = () => {
                            return undefined;
                        }
                        $("#global-tissue-visibility").css("display", "none");
                        //standard
                        handleSyntheticEventFinishWithValidData(0, 1);
                    }
                });
                return;
            } else {
                //todo not very flexible...
                if (image.hasOwnProperty("lossless") && image.lossless && worldItem) {
                    worldItem.source.fileFormat = "png";
                }
            }

            handleSyntheticEventFinishWithValidData(0, 1);
        } else {
            $("#global-tissue-visibility").css("display", "none");
            handleSyntheticEventFinishWithValidData(0, 0);
        }
    }

    function handleSyntheticEventFinishWithValidData(referenceImage, layerPosition) {
        updateBackgroundChanged(referenceImage);
        const eventOpts = {};

        //private API
        const seaGL = VIEWER.bridge;
        if (APPLICATION_CONTEXT.config.visualizations.length > 0 && seaGL) {
            const layerWorldItem = VIEWER.world.getItemAt(layerPosition);
            const activeVis = seaGL.visualization();
            if (layerWorldItem) {
                if ((!activeVis.hasOwnProperty("lossless") || activeVis.lossless) && layerWorldItem.source.setFormat) {
                    layerWorldItem.source.setFormat("png");
                }
                layerWorldItem.source.greyscale = APPLICATION_CONTEXT.getOption("grayscale") ? "/greyscale" : "";

                $("#panel-shaders").css('display', 'block');
                $("#global-opacity").css('display', 'initial');

                seaGL.addLayer(layerPosition);
                seaGL.initAfterOpen();
            } else {
                //todo action page reload
                Dialogs.show($.t('messages.visualisationDisabled', {name: activeVis.name}), 20000, Dialogs.MSG_ERR);

                $("#panel-shaders").css('display', 'none');
                $("#global-opacity").css('display', 'none');

                APPLICATION_CONTEXT.disableRendering();
                eventOpts.error = $.t('messages.overlaysDisabled');
            }
        } else {
            $("#global-opacity").css('display', 'none');
        }

        handleSyntheticEventFinish();
    }

    //fired when all TiledImages are on their respective places
    function handleSyntheticEventFinish(opts={}) {

        if (reopenCounter === 0) {

            runLoader();

            let focus = APPLICATION_CONTEXT.getOption("viewport");
            if (focus && focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
                window.VIEWER.viewport.panTo({x: Number.parseFloat(focus.point.x), y: Number.parseFloat(focus.point.y)}, true);
                window.VIEWER.viewport.zoomTo(Number.parseFloat(focus.zoomLevel), null, true);
            }

            if (window.innerHeight < 630) {
                <?php if (!$firstTimeVisited) {
                echo "            $('#navigator-pin').click();";
            }?>
                USER_INTERFACE.MainMenu.close();
            }

            window.onerror = null;

            if (window.opener && window.opener.VIEWER) {
                VIEWER.tools.link( window.opener.VIEWER);
            }

            if (!USER_INTERFACE.Errors.active) {
                <?php
                if ($firstTimeVisited) {
                    echo "        setTimeout(function() {
                    USER_INTERFACE.Tutorials.show($.t('messages.pluginsWelcome'), 
                        $.t('messages.pluginsWelcomeDescription', {tutorial: $.t('tutorials.basic.title')});
                    }, 2000);";
                }
                ?>
            }
        }

        if (USER_INTERFACE.Errors.active) {
            $("#viewer-container").addClass("disabled"); //preventive
        }

        //todo this way of calling open event has in OpenSeadragon todo comment - check for API changes in future
        opts.source = VIEWER.world.getItemAt(0)?.source;
        opts.reopenCounter = reopenCounter;
        VIEWER.raiseEvent('open', opts);
    }

    let _allowRecursionReload = true;
    APPLICATION_CONTEXT.prepareViewer = function (
        data,
        background,
        visualizations=[],
    ) {
        window.VIEWER.close();

        const isSecureMode = APPLICATION_CONTEXT.config.params.secureMode;

        //todo loading animation?
        let renderingWithWebGL = visualizations?.length > 0;
        if (renderingWithWebGL) {
            if (_allowRecursionReload && !window.WebGLModule) {
                _allowRecursionReload = false;
                UTILITIES.loadModules(() => APPLICATION_CONTEXT.prepareViewer(data, background, visualizations), "webgl");
                return;
            }

            if (!window.WebGLModule) {
                console.error("Recursion prevented: webgl module failed to load!");
                //allow to continue...
                Dialogs.show($.t('messages.overlaysLoadFail'), 8000, Dialogs.MSG_ERR);
                renderingWithWebGL = false;
            }
        }

        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
        config.data = data;
        config.background = background;
        config.visualizations = visualizations;

        if (reopenCounter > 0) {
            APPLICATION_CONTEXT.disableRendering();
        } else {
            VIEWER.raiseEvent('before-canvas-reload');
        }

        const toOpen = [];
        const opacity = Number.parseFloat($("global-opacity").val()) || 1;
        let openedSources = 0;
        const handleFinishOpenImageEvent = () => {
            openedSources--;
            if (openedSources <= 0) {
                handleSyntheticOpenEvent();
            }
        };
        let imageOpenerCreator = (success, userArg=undefined) => {
            return (toOpenLastBgIndex, source, toOpenIndex) => {
                openedSources++;
                window.VIEWER.addTiledImage({
                    tileSource: source,
                    opacity: opacity,
                    success: (event) => {
                        success({userArg, toOpenLastBgIndex, toOpenIndex, event});
                        handleFinishOpenImageEvent();
                    },
                    error: () => {
                        handleFinishOpenImageEvent();
                    }
                });
            }
        };

        let imageOpener; //has to set-up correct getBackgroundConfig function
        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            //reverse order: last opened IMAGE is the first visible
            for (let i = background.length-1; i >= 0; i--) {
                const bg = background[i];
                if (isSecureMode) delete bg.protocol;
                const urlmaker = new Function("path,data", "return " + (bg.protocol || APPLICATION_CONTEXT.backgroundProtocol));
                toOpen.push(urlmaker(APPLICATION_CONTEXT.backgroundServer, data[bg.dataReference]));
            }

            imageOpener = imageOpenerCreator(e => {
                const index = e.toOpenLastBgIndex - e.toOpenIndex; //reverse order in toOpen
                e.event.item.getBackgroundConfig = () => {
                    return APPLICATION_CONTEXT.config.background[index];
                };
            });
        } else if (background.length > 0) {
            const selectedIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
            let selectedImage = background[selectedIndex];
            if (isSecureMode) delete selectedImage.protocol;
            const urlmaker = new Function("path,data", "return " + (selectedImage.protocol || APPLICATION_CONTEXT.backgroundProtocol));
            toOpen.push(urlmaker(APPLICATION_CONTEXT.backgroundServer, data[selectedImage.dataReference]));

            imageOpener = imageOpenerCreator(e => {
                const index = e.userArg;
                e.event.item.getBackgroundConfig = () => {
                    return APPLICATION_CONTEXT.config.background[index];
                };
            }, selectedIndex);
        }

        const openAll = (numOfVisLayersAtTheEnd) => {
            let i = 0;
            let lastValidBgIndex = toOpen.length - numOfVisLayersAtTheEnd - 1;
            for (; i <= lastValidBgIndex; i++) imageOpener(lastValidBgIndex, toOpen[i], i);

            const visOpener = imageOpenerCreator(()=>{});
            for (; i < toOpen.length; i++) visOpener(toOpen.length - 1, toOpen[i], i);
        }

        if (renderingWithWebGL) {
            APPLICATION_CONTEXT.prepareRendering();

            let activeVisIndex = Number.parseInt(APPLICATION_CONTEXT.getOption("activeVisualizationIndex"));
            if (!APPLICATION_CONTEXT.getOption("stackedBackground")) {
                // binding background config overrides active visualisation, only if not in stacked mode
                const activeBackgroundSetup = config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)],
                    defaultIndex = Number.parseInt(activeBackgroundSetup?.goalIndex);

                if (defaultIndex >= 0 && defaultIndex < config.visualizations.length) {
                    activeVisIndex = defaultIndex;
                    APPLICATION_CONTEXT.setOption("activeVisualizationIndex", activeVisIndex);
                }
            }

            VIEWER.bridge.loadShaders(
                activeVisIndex,
                function() {
                    VIEWER.bridge.createUrlMaker(VIEWER.bridge.visualization(), isSecureMode);
                    toOpen.push(VIEWER.bridge.urlMaker(APPLICATION_CONTEXT.layersServer, VIEWER.bridge.dataImageSources()));
                    openAll(1);
                }
            );
        } else {
            openAll(0);
        }
    }

})(window);
    </script>

    <!-- UI -->
    <script type="text/javascript" src="<?php echo PROJECT_SOURCES; ?>user_interface.js"></script>

    <!--Event listeners, Utilities, Exporting...-->
    <script type="text/javascript" src="<?php echo PROJECT_SOURCES; ?>scripts.js"></script>

    <!--Visualization setup-->
    <script type="text/javascript" src="<?php echo PROJECT_SOURCES; ?>layers.js"></script>

    <!--Modules-->
<?php
resolveDependencies($MODULES, $version);
foreach ($MODULES as $_ => $mod) {
    if ($mod->loaded) {
        printDependencies(MODULES_FOLDER, $mod);
    }
}
?>

    <!--Plugins Loading-->
    <script type="text/javascript">

(function (window) {

    /*---------------------------------------------------------*/
    /*------------ Basic Tutorial       -----------------------*/
    /*---------------------------------------------------------*/

    const withLayers = function() {
        return APPLICATION_CONTEXT.layersAvailable;
    };

    window.USER_INTERFACE.Tutorials.add("", $.t('tutorials.basic.title'), $.t('tutorials.basic.description'), "foundation", [
        {'next #viewer-container' : $.t('tutorials.basic.1')
        }, {'next #main-panel' : $.t('tutorials.basic.2')
        }, {'next #navigator-container' : $.t('tutorials.basic.3')
        }, {'next #general-controls' : $.t('tutorials.basic.4'),
            runIf: function() {return APPLICATION_CONTEXT.config.background.length === 1 && withLayers();}
        }, {'next #general-controls' : $.t('tutorials.basic.4a'),
            runIf: function() {return APPLICATION_CONTEXT.config.background.length === 1 && !withLayers();}
        }, {'next #general-controls' : $.t('tutorials.basic.5'), runIf: withLayers
        }, {
            'next #__tisue_list' : $.t('tutorials.basic.6'),
            runIf: function () {return APPLICATION_CONTEXT.config.background.length > 1 && !APPLICATION_CONTEXT.getOption("stackedBackground");}
        }, {
            'click #images-pin' : $.t('tutorials.basic.7'),
            runIf: function () {return APPLICATION_CONTEXT.config.background.length > 1 && APPLICATION_CONTEXT.getOption("stackedBackground");}
        }, {'next #panel-images' : $.t('tutorials.basic.8'),
            runIf: function () {return APPLICATION_CONTEXT.config.background.length > 1 && APPLICATION_CONTEXT.getOption("stackedBackground");}
        }, {'next #panel-shaders': $.t('tutorials.basic.9'), runIf: withLayers
        }, {'click #shaders-pin': $.t('tutorials.basic.10'), runIf: withLayers
        }, {'next #shaders': $.t('tutorials.basic.11'), runIf: withLayers
        }, {'next #data-layer-options': $.t('tutorials.basic.12'), runIf: withLayers
        }, {'next #cache-snapshot': $.t('tutorials.basic.13'), runIf: withLayers
        }, {'next #copy-url' : $.t('tutorials.basic.14')
        }, {'next #global-export' : $.t('tutorials.basic.15')
        }, {'next #global-help' : $.t('tutorials.basic.16')}], function() {
        if (withLayers()) {
            //prerequisite - pin in default state
            let pin = $("#shaders-pin");
            let container = pin.parents().eq(1).children().eq(1);
            pin.removeClass('pressed');
            container.removeClass('force-visible');
        }
    });

    /*---------------------------------------------------------*/
    /*------------ Initialization of UI -----------------------*/
    /*---------------------------------------------------------*/

    USER_INTERFACE.AdvancedMenu._build();
    USER_INTERFACE.MainMenu._sync();
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
   ?>

<script>
    APPLICATION_CONTEXT.prepareViewer(
        APPLICATION_CONTEXT.config.data,
        APPLICATION_CONTEXT.config.background,
        APPLICATION_CONTEXT.config.visualizations
    );
</script>
</body>
</html>
