<?php
if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}

global $i18n;

set_exception_handler(function (Throwable $exception) {
    global $i18n;
    if (!isset($i18n)) {
        require_once ABS_ROOT . 'i18m.class.php';
        $i18n = i18n_mock::default($_GET["lang"] ?? "en", LOCALES_ROOT);
    }
    throwFatalErrorIf(true, "error.unknown", "",$exception->getMessage() .
        " in " . $exception->getFile() . " line " . $exception->getLine() .
        "<br>" . $exception->getTraceAsString());
});

global $PLUGINS, $MODULES, $CORE;
require_once "src/core.php";

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function isBoolFlagInObject($object, $key) {
    if (!isset($object->$key)) return false;
    $v = $object->$key;
    return (gettype($v) === "string" && $v !== "" && $v !== "false") || $v;
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        require_once(ABS_ROOT . "error.php");
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
$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] :
    (hasKey($_GET, "visualisation") ? $_GET["visualisation"] : false);
if (!$visualisation) {
    //for json-based POST requests
    $_POST = json_decode(file_get_contents('php://input'));
    $visualisation = $_POST["visualisation"];
}

throwFatalErrorIf(!$visualisation, "messages.urlInvalid", "messages.invalidPostData",
        print_r($_POST, true));

/**
 * Parsing: verify valid parameters
 */

//params that come in might be associative arrays :/
$parsedParams = $visualisation;
if (is_string($visualisation)) $parsedParams = json_decode($parsedParams, false);
else if (is_array($visualisation)) $parsedParams = (object)$parsedParams;
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
require_once ABS_ROOT . 'i18n.class.php';
i18n::$debug = $is_debug;
$i18n = i18n::default($locale, LOCALES_ROOT);

//load plugins
require_once ABS_ROOT . "plugins.php";

foreach ($parsedParams->background as $bg) {
    $bg = (object)$bg;
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
    $MODULES["webgl"]["loaded"] = true;
}
//todo if secure mode remove all sensitive data from config and set it up in cache
/**
 * Detect required presence of plugins, 'permaLoaded' is supported only by the APP, not the loader - detect here
 */
$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
if (is_array($parsedParams->plugins)) {
    $parsedParams->plugins = (object)$parsedParams->plugins;
}

foreach ($PLUGINS as $key => &$plugin) {
    $hasParams = isset($parsedParams->plugins->{$plugin["id"]});
    $plugin["loaded"] = !isset($plugin["error"]) &&
        $hasParams
            || (isset($plugin["permaLoad"]) && $plugin["permaLoad"]) //param in the static config
            || in_array($plugin["id"], $pluginsInCookies);

    //make sure all modules required by plugins are also loaded
    if ($plugin["loaded"]) {
        if (!$hasParams) {
            $parsedParams->plugins->{$plugin["id"]} = (object)array();
        }
        foreach ($plugin["modules"] as $modId) {
            $MODULES[$modId]["loaded"] = true;
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
    <link rel="mask-icon" href="<?php echo ASSETS_ROOT; ?>safari-pinned-tab.svg" color="#5bbad5">
    <meta name="msapplication-TileColor" content="#da532c">

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
    </script>

    <?php require_core("env"); ?>

    <!-- TODO move these to local dependencies -->
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"
        integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
        crossorigin="anonymous"></script>
    <script src="config_meta.js"></script>


    <?php require_libs(); ?>
    <?php require_openseadragon(); ?>
    <?php require_external(); ?>
    <?php require_core("loader"); ?>
    <?php require_core("deps"); ?>
    <?php require_core("app"); ?>
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

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium top-0" style="width: 400px;">
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

<!-- Get Static Config and Run App -->
<script type="text/javascript">
    (function (window) {
        /*---------------------------------------------------------*/
        /*---------- APPLICATION_CONTEXT and viewer data ----------*/
        /*---------------------------------------------------------*/

        initXopatUI();

        initXopat(
            <?php echo json_encode((object)$PLUGINS) ?>,
            <?php echo json_encode((object)$MODULES) ?>,
            <?php echo json_encode((object)$CORE) ?>,
            <?php unset($_POST["visualisation"]); echo json_encode($_POST); ?>,
            <?php echo $visualisation ?>,
            '<?php echo PLUGINS_FOLDER ?>',
            '<?php echo MODULES_FOLDER ?>',
            '<?php echo VERSION ?>'
        );

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

        initXopatScripts();
        initXopatLayers();
    })(window);
</script>

<?php
require_modules();
?>

    <script type="text/javascript">

(function (window) {

    /*---------------------------------------------------------*/
    /*------------ Basic Tutorial       -----------------------*/
    /*---------------------------------------------------------*/

    const withLayers = () => APPLICATION_CONTEXT.layersAvailable;
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

    <!--Plugins Loading-->
<?php
require_plugins();
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
