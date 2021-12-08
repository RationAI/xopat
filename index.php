<?php

require_once("config.php");
require_once("plugins.php");

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function isFlagInProtocols($flag) {
    return (hasKey($_GET, $flag) ? $_GET[$flag] : (hasKey($_POST, $flag) ? $_POST[$flag] : false));
}

function letUserSetUp($image, $layer) {
    header("Location: user_setup.php?image=$image&layer=$layer");
    exit;
}

function throwFatalError($title, $description, $details) {
    session_start();
    $_SESSION['title'] = $title;
    $_SESSION['description'] = $description;
    $_SESSION['details'] = $details;
    header('Location: error.php');
    exit;
}

$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] : false;

if (!$visualisation /*&& hasKey($_COOKIE, "visualisation")*/) {
    $image = hasKey($_GET, "image") ? $_GET["image"] : (hasKey($_POST, "image") ? $_POST["image"] : false);
    if (!$image) {
        throwFatalError("No visualisation defined.",
            "Visualisation was not defined and custom image source is missing. See POST data:",
            print_r($_POST, true));
    }
    $layer = hasKey($_GET, "layer") ? $_GET["layer"] : (hasKey($_POST, "layer") ? $_POST["layer"] : false);
    if (!$layer) {
        throwFatalError("No visualisation defined.",
            "Visualisation was not defined and custom data sources are missing. See POST data:",
            print_r($_POST, true));
    }
    letUserSetUp($image, $layer);
}

$errorSource = false;

function propertyExists($data, $key, $errTitle, $errDesc, $errDetails) {
    if (!isset($data->{$key})) {
        throwFatalError($errTitle, $errDesc, $errDetails);
    }
}

$parsedParams = json_decode($visualisation);
if (!$parsedParams) {
    throwFatalError("Invalid link.",
        "The visualisation setup is not parse-able.", $visualisation);
}
$cookieCache = isset($_COOKIE["cache"]) && !isFlagInProtocols("ignoreCookiesCache") ? json_decode($_COOKIE["cache"]) : (object)[];

propertyExists($parsedParams, "data", "No image data available.",
    "JSON parametrization of the visualiser requires <i>data</i> for each visualisation goal. This field is missing.",
    print_r($parsedParams, true));

propertyExists($parsedParams, "background", "No data available.",
    "JSON parametrization of the visualiser requires <i>background</i> object: a dictionary of data interpretation. This field is missing.",
    print_r($parsedParams, true));

foreach ($parsedParams->background as $bg) {
    propertyExists($bg, "dataReference", "No data available.",
        "JSON parametrization of the visualiser requires <i>dataReference</i> for each background layer. This field is missing.",
        print_r($parsedParams->background, true));

    if (!is_numeric($bg->dataReference) || $bg->dataReference >= count($parsedParams->data)) {
        throwFatalError("Invalid image.",
            "JSON parametrization of the visualiser requires valid <i>dataReference</i> for each background layer.",
            "Invalid data reference value '$bg->dataReference'. Available data: " . print_r($parsedParams->data, true));
    }
}
if (!isset($parsedParams->params)) {
    $parsedParams->params = (object)array();
}
if (!isset($parsedParams->shaderSources)) {
    $parsedParams->shaderSources  = array();
}

$layerVisible = isset($parsedParams->visualizations);
if ($layerVisible) {

    foreach ($parsedParams->visualizations as $visualisationTarget) {
        if (!isset($visualisationTarget->name)) {
            $visualisationTarget->name = "Custom Visualisation";
        }

        propertyExists($visualisationTarget, "shaders", "No visualisation defined.",
            "You must specify non-empty <b>shaders</b> object.", print_r($visualisationTarget, true));

        foreach ($visualisationTarget->shaders as $data=>$layer) {
            propertyExists($layer, "type", "No visualisation style defined for $layer->name.",
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
}



$visualisation = json_encode($parsedParams);
$cookieCache = json_encode($cookieCache);

$pluginsInCookies = isset($_COOKIE["plugins"]) ? explode(',', $_COOKIE["plugins"]) : [];
$webglModuleRequired = $layerVisible;
foreach ($PLUGINS as $_ => $plugin) {
    $plugin->loaded = !isset($plugin->flag) || isFlagInProtocols($plugin->flag) || in_array($plugin->flag, $pluginsInCookies);
    $plugin->permaLoaded = $plugin->loaded && isset($_GET[$plugin->flag]) && $_GET[$plugin->flag] == "true";
    if ($plugin->loaded) {
        $webglModuleRequired = $webglModuleRequired || in_array("webgl", $plugin->modules);
    }
}


$version = VERSION . ""; //force to use variable :( it somehow set $version = "VERSION"
echo <<<EOF
<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
    <meta charset="utf-8">
    <title>Visualisation</title>

    <link rel="stylesheet" href="./style.css?v=$version">
    <link rel="stylesheet" href="./external/primer_css.css">
    <!--
    Possible external dependency
    <link href="https://unpkg.com/@primer/css@^16.0.0/dist/primer.css" rel="stylesheet" />
    -->

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
    <script src="./osd_debug/src/dziexttilesource.js?v=$version"></script>
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
EOF;

if ($layerVisible || $webglModuleRequired) {
    echo <<<EOF

    <script src="./webgl/webGLWrapper.js?v=$version"></script>

    <script src="./webgl/visualisationLayer.js?v=$version"></script>
    <script src="./webgl/shaders/identityVisualisationLayer.js?v=$version"></script>
    <script src="./webgl/shaders/heatmapVisualisationLayer.js?v=$version"></script>
    <script src="./webgl/shaders/edgeVisualisationLayer.js?v=$version"></script>
    <script src="./webgl/shaders/bipolarHeatmapVisualisationLayer.js?v=$version"></script>

    <script src="./webgl/webGLContext.js?v=$version"></script>
    <script src="./webgl/webGLToOSDBridge.js?v=$version"></script>
EOF;
}

echo <<<EOF
    <!--Tutorials-->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/kineticjs/5.2.0/kinetic.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-scrollTo/2.1.2/jquery.scrollTo.min.js"></script>
    <link rel="stylesheet" href="./external/enjoyhint.css">
    <script src="./external/enjoyhint.min.js"></script>
    

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="overflow: hidden;">
<!-- OSD viewer -->
<div id="viewer-container" class="position-absolute width-full height-full top-0 left-0" style="pointer-events: none;">
    <div id="osd" style="pointer-events: auto;" class="position-absolute width-full height-full top-0 left-0"></div>
</div>

<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;Error</div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="display: none;max-height: 50vh;"></div>
</div>

<!--Tutorials-->
<div id="tutorials-container" class="d-none system-container">
    <div class="f1-light text-center clearfix">Select a tutorial</div>
    <p class="text-center">The visualisation is still under development: components and features are changing. The tutorials might not work, missing or be outdated.</p>
    <!--<p class="text-center">You can also show tutorial section by pressing 'H' on your keyboard.</p>-->
    <br>
    <div id="tutorials"></div>
    <br><br><button class="btn" onclick="Tutorials.hide();">Exit</button>
</div>


<!-- Panel -->
<span id="main-panel-show" class="material-icons" onclick="$('#main-panel').css('right', 0);">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="overflow-y: overlay; width: 400px;" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">

    <div id="main-panel-content" class='position-relative' style="padding-bottom: 25px;overflow-y: auto; scrollbar-width: thin /*mozilla*/;">
        <span id="main-panel-hide" class="material-icons" onclick="$('#main-panel').css('right', '-400px');">chevron_right</span>
        <div id="navigator-container" class="inner-panel position-absolute right-0 top-0" style="width: 400px;">
            <div id="panel-navigator" class="inner-panel" style=" height: 300px; width: 100%;"></div>
        </div>

        <div id="general-controls" class="inner-panel d-flex" style="margin-top: 320px;">
            <!--TODO export also these values? -->
EOF;

//if only one data layer visible, show as checkbox, else add Images menu
if (count($parsedParams->background) == 1) {
    echo <<<EOF
            <label for="global-opacity">Layer Opacity: &nbsp;</label>
            <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 150px;">&emsp;
            <label for="global-tissue-visibility"> Show tissue &nbsp;</label>
            <input type="checkbox" style="align-self: center;" checked class="form-control" id="global-tissue-visibility"
                   onchange="viewer.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
        </div> <!--Height of navigator = margn top of this div + padding-->
EOF;
} else {
    echo <<<EOF
            <label for="global-opacity">Layer Opacity: &nbsp;</label>
            <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 250px;">&emsp;
        </div> <!--Height of navigator = margn top of this div + padding-->
        <div id="panel-images" class="inner-panel">   
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="images-pin" class="material-icons inline-pin" onclick="pinClick($(this), $(this).parents().eq(1).children().eq(1));"> push_pin </span>
                        <h3 class="d-inline-block">Images</h3>
                    </div>
   
                    <div id="image-layer-options" class="inner-panel-hidden">
                        <!--populated with options for a given image data -->
                    </div>
                </div>
           </div>
EOF;
}

if ($layerVisible) {
    echo <<<EOF
          <div id="panel-shaders" class="inner-panel" >
    
                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
    
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
    
                        <span id="shaders-pin" class="material-icons inline-pin" onclick="pinClick($(this), $(this).parents().eq(1).children().eq(1));"> push_pin </span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <span id="cache-snapshot" class="material-icons" style="text-align:right; cursor:pointer;vertical-align:sub;float: right;" title="Remember settings" onclick="makeCacheSnapshot();">repeat_on</span>
                    </div>
    
                    <div id="data-layer-options" class="inner-panel-hidden">
                            <!--populated with options for a given image data -->
                    </div>
                </div>
            </div>
EOF;
}
?>
        <!-- Appended controls for other plugins -->
    </div>

    <div class="d-flex flex-items-end p-2 flex-1 position-fixed bottom-0" style="width: 400px; background: #0000005c;">
        <span id="copy-url" class="pl-2" onclick="copyHashUrlToClipboard();" title="Get the visualisation link" style="cursor: pointer;"><span class="material-icons">link</span>Get link</span>
        <span id="global-export" class="pl-2" onclick="exportVisualisation();" title="Export visualisation together with plugins data" style="cursor: pointer;"><span class="material-icons">download</span>Export</span>
        <a style="display:none;" id="export-visualisation"></a> &emsp;
        <span id="add-plugins" onclick="showAvailablePlugins();" title="Add plugins to the visualisation" style="cursor: pointer;"><span class="material-icons">extension</span>Plugins</span>&emsp;
        <span id="global-help" onclick="Tutorials.show();" title="Show tutorials" style="cursor: pointer;"><span class="material-icons">school</span>Tutorial</span>&emsp;
    </div>
</div>

<!-- DEFAULT SETUP SCRIPTING -->
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*------------ System error messenger ---------------------*/
    /*---------------------------------------------------------*/

    var DisplayError = {
        msgTitle: $("#system-message-title"),
        msgDetails: $("#system-message-details"),
        msgContainer: $("#system-message"),
        screenContainer: $("#viewer-container"),

        show: function(title, description) {
            this.msgTitle.html(title);
            this.msgDetails.html(description);
            this.msgContainer.removeClass("d-none");
            this.screenContainer.addClass("disabled");
        },

        hide: function() {
            this.msgContainer.addClass("d-none");
            this.screenContainer.removeClass("disabled");
        }
    }

    <?php

    if($errorSource) {
        //todo redirect to error.php? //todo this does not work anymore
        echo "$('#main-panel').addClass('d-none');";
        $debugSource = ""; //todo $debugSource not existing
        if (!$debugSource) $debugSource = "null";
        $postdata = print_r($_POST, true);
        echo "DisplayError.show('Something went wrong. Please, re-open the visualizer (your URL might be wrong).', `ERROR: Visualiser expects input data. Following data does not contain one: <br><code>$postdata</code>`);";
        echo "</script></body></html>";
        exit;
    }

    ?>

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./error.php?title=${encodeURIComponent('Your browser is not supported.')}
&description=${encodeURIComponent('ERROR: The visualisation requires canvasses in order to work.')}`;
    }

    // Initialize viewer - OpenSeadragon
    var viewer = OpenSeadragon({
        id: "osd",
        prefixUrl: "osd/images/",
        showNavigator: true,
        maxZoomPixelRatio: 1,
        blendTime: 0,
        showNavigationControl: false,
        navigatorId: "panel-navigator",
        loadTilesWithAjax : true,
        // debugMode:  true,
    });
    viewer.gestureSettingsMouse.clickToZoom = false;

    /*---------------------------------------------------------*/
    /*------------ Initialization of Visualisation ------------*/
    /*---------------------------------------------------------*/

    var shadersCache = <?php echo $cookieCache ?>;
    var setup = <?php echo $visualisation ?>;
    var activeVisualization = 0; //todo dynamic?
    const iipSrvUrlPOST = '/iipsrv-martin/iipsrv.fcgi?#DeepZoomExt=';
    const iipSrvUrlGET = '/iipsrv-martin/iipsrv.fcgi?Deepzoom=';
    //index of the layer composed of shaders, last one or not present (-1)
    let layerIDX = setup.hasOwnProperty("visualizations") ? setup.background.length : -1;

    // Tutorial functionality
    var Tutorials = {
        tutorials: $("#tutorials"),
        tutContainer: $("#tutorials-container"),
        screenContainer: $("#viewer-container"),
        steps: [],
        prerequisites: [],

        show: function() {
            this.tutContainer.removeClass("d-none");
            this.screenContainer.addClass("disabled");
        },

        hide: function() {
            this.tutContainer.addClass("d-none");
            this.screenContainer.removeClass("disabled");
        },

        add: function(plugidId, name, description, icon, steps, prerequisites=undefined) {
            if (!icon) icon = "school";
            plugidId = plugidId ? `${plugidId}-plugin-root` : "";
            this.tutorials.append(`
          <div class='d-inline-block px-2 py-2 m-1 pointer v-align-top rounded-2 tutorial-item ${plugidId}' onclick="Tutorials.run(${this.steps.length});">
          <span class="d-block material-icons f1 text-center my-2">${icon}</span><p class='f3-light mb-0'>${name}</p><p>${description}</p></div>`);
            this.steps.push(steps);
            this.prerequisites.push(prerequisites);
        },

        run: function(index) {
            if (index >= this.steps.length || index < 0) return;
            $('#main-panel').css('right', '0px');
            //do prerequisite setup if necessary
            if(this.prerequisites[index]) this.prerequisites[index]();

            //reset plugins visibility
            $(".plugins-pin").each(function() {
                let pin = $(this);
                let container = pin.parent().children().eq(2);
                pin.removeClass('pressed');
                pin.removeClass('locked');
                container.removeClass('force-visible');
                container.removeClass('force-hidden');
            });
            let enjoyhintInstance = new EnjoyHint({});
            enjoyhintInstance.set(this.steps[index]);
            this.hide();
            enjoyhintInstance.run();
        }
    }

    // opacity of general layer available everywhere
    $("#global-opacity").on("input", function () {
        let val = $(this).val();
        viewer.world.getItemAt(layerIDX).setOpacity(val);
    });

    /**
     * From https://github.com/openseadragon/openseadragon/issues/1690
     * brings better zooming behaviour
     */
    viewer.addHandler("canvas-scroll", function (event) {
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
            viewer.zoomPerScroll = 1.2;
        }

        if (this.scrollNum > 2 && viewer.zoomPerScroll <= 2.5) {
            viewer.zoomPerScroll += 0.2;
        }

        this.lastScroll = this.currentScroll; //Set last scroll to now
    });

    document.addEventListener('keydown', (e) => {
        let zoom = null,
            bounds = viewer.viewport.getBounds(),
            speed = 0.3;
        switch (e.key) {
            case "Down": // IE/Edge specific value
            case "ArrowDown":
                bounds.y += speed*bounds.height;
                break;
            case "Up": // IE/Edge specific value
            case "ArrowUp":
                bounds.y -= speed*bounds.height;
                break;
            case "Left": // IE/Edge specific value
            case "ArrowLeft":
                bounds.x -= speed*bounds.width;
                break;
            case "Right": // IE/Edge specific value
            case "ArrowRight":
                bounds.x += speed*bounds.width;
                break;
            case "+":
                zoom = viewer.viewport.getZoom();
                viewer.viewport.zoomTo(zoom + zoom * speed * 3);
                return;
            case "-":
                zoom = viewer.viewport.getZoom();
                viewer.viewport.zoomTo(zoom - zoom * speed * 2);
                return;
            // case "h":
            //   Tutorials.show();
            //   return;
            default:
                return; // Quit when this doesn't handle the key event.
        }
        viewer.viewport.fitBounds(bounds);
    });


    /*---------------------------------------------------------*/
    /*------------ MAIN PANEL JS ------------------------------*/
    /*---------------------------------------------------------*/

    function pinClick(jQSelf, jQTargetParent) {
        if (jQTargetParent.hasClass('force-visible')) {
            jQTargetParent.removeClass('force-visible');
            jQSelf.removeClass('pressed');
        } else {
            jQSelf.addClass('pressed');
            jQTargetParent.addClass('force-visible');
        }
    }

    /*---------------------------------------------------------*/
    /*------------ DIALOGS ------------------------------------*/
    /*---------------------------------------------------------*/

    var Dialogs = {
        MSG_INFO: { class: "", icon: '<path fill-rule="evenodd"d="M6.3 5.69a.942.942 0 0 1-.28-.7c0-.28.09-.52.28-.7.19-.18.42-.28.7-.28.28 0 .52.09.7.28.18.19.28.42.28.7 0 .28-.09.52-.28.7a1 1 0 0 1-.7.3c-.28 0-.52-.11-.7-.3zM8 7.99c-.02-.25-.11-.48-.31-.69-.2-.19-.42-.3-.69-.31H6c-.27.02-.48.13-.69.31-.2.2-.3.44-.31.69h1v3c.02.27.11.5.31.69.2.2.42.31.69.31h1c.27 0 .48-.11.69-.31.2-.19.3-.42.31-.69H8V7.98v.01zM7 2.3c-3.14 0-5.7 2.54-5.7 5.68 0 3.14 2.56 5.7 5.7 5.7s5.7-2.55 5.7-5.7c0-3.15-2.56-5.69-5.7-5.69v.01zM7 .98c3.86 0 7 3.14 7 7s-3.14 7-7 7-7-3.12-7-7 3.14-7 7-7z"/>' },
        MSG_WARN: { class: "Toast--warning", icon: '<path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z" />' },
        MSG_ERR: { class: "Toast--error", icon: '<path fill-rule="evenodd" d="M10 1H4L0 5v6l4 4h6l4-4V5l-4-4zm3 9.5L9.5 14h-5L1 10.5v-5L4.5 2h5L13 5.5v5zM6 4h2v5H6V4zm0 6h2v2H6v-2z" />' },
        _timer: null,

        init: function() {
            $("body").append(`<div id="annotation-messages-container" class="Toast popUpHide position-fixed" style='z-index: 5050; transform: translate(calc(50vw - 50%));'>
          <span class="Toast-icon"><svg width="12" height="16" id="annotation-icon" viewBox="0 0 12 16" class="octicon octicon-check" aria-hidden="true"></svg></span>
          <span id="annotation-messages" class="Toast-content v-align-middle" style="max-width: 350px;"></span>
          <button class="Toast-dismissButton" onclick="Dialogs.hide(false);">
          <svg width="12" height="16" viewBox="0 0 12 16" class="octicon octicon-x" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"/></svg>
          </button>
          </div>`);

            this._body = $("#annotation-messages-container");
            this._board = $("#annotation-messages");
            this._icon = $("#annotation-icon");
        },

        show: function (text, delayMS, importance) {
            this._board.html(text);
            this._icon.html(importance.icon);
            this._body.removeClass(); //all
            this._body.addClass(`Toast position-fixed ${importance.class}`)
            this._body.removeClass("popUpHide");
            this._body.addClass("popUpEnter");

            if (delayMS > 1000) {
                this._timer = setTimeout(this.hide.bind(this), delayMS);
            }
        },

        hide: function (_autoCalled = true) {
            this._body.removeClass("popUpEnter");
            this._body.addClass("popUpHide");

            if (!_autoCalled) {
                clearTimeout(this._timer);
            }
            this._timer = null;
        },

        showCustom: function(parentId, title, content, footer) {
            this._showBuild(parentId, title, content, footer,
                `class="position-fixed" style="z-index:999; left: 50%;top: 50%;transform: translate(-50%,-50%);"`, "");
        },

        showCustomModal: function(parentId, title, content, footer) {
            this._showBuild(parentId, title, content, footer,
                `class="position-absolute" style="left: 15px; top: 50px; z-index: 999;"`, 'style="cursor:move;"');
            let element = document.getElementById(parentId);
            if (!element) return;
            let dragged = element.firstElementChild.firstElementChild;
            dragged.setAttribute('draggable', true);
            dragged.ondragstart = startDrag;
            dragged.ondragend = enddrag;

            var x, y;
            function startDrag(event) {
                x = event.x;
                y = event.y;
            }

            function enddrag(event) {
                const selectedItem = event.target,
                    dx = event.x,
                    dy = event.y;

                element.style.left = (element.offsetLeft + (dx - x)) + "px";
                element.style.top = (element.offsetTop + (dy - y)) + "px";
                x = dx;
                y = dy;
            }
        },

        _showBuild: function(parentId, title, content, footer, positionStrategy, headerStyle) {
            if (!parentId) {
                console.error("Invalid form: unique container id not defined.");
                return;
            }
            $(`#${parentId}`).remove(); //prevent from multiple same windows shown
            $("body").append(`<div id="${parentId}" ${positionStrategy}>
<details-dialog class="Box Box--overlay d-flex flex-column" style=" max-width:80vw; max-height: 80vh">
    <div class="Box-header" ${headerStyle}>
      <button class="Box-btn-octicon btn-octicon float-right" type="button" aria-label="Close help" onclick="$(this).parent().parent().parent().remove();">
        <svg class="octicon octicon-x" viewBox="0 0 12 16" version="1.1" width="12" height="16" aria-hidden="true"><path fill-rule="evenodd" d="M7.48 8l3.75 3.75-1.48 1.48L6 9.48l-3.75 3.75-1.48-1.48L4.52 8 .77 4.25l1.48-1.48L6 6.52l3.75-3.75 1.48 1.48L7.48 8z"></path></svg>
      </button>
      <h3 class="Box-title">${title}</h3>
    </div>
    <div class="overflow-auto position-relative">
      <div class="Box-body overflow-auto" style="padding-bottom: 45px;">
	  ${content}
	  </div>
	  ${footer}
    </div>
</details-dialog>
</div>`);
        },
    }  // end of namespace Dialogs
    Dialogs.init();

    /*---------------------------------------------------------*/
    /*------------ EXPORTING ----------------------------------*/
    /*---------------------------------------------------------*/

    function constructExportVisualisationForm(customAttributes="", includeCurrentPlugins=true) {
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
         echo "document.getElementById(\"visualisation\").value = JSON.stringify(setup, seaGL.webGLWrapper.jsonReplacer);";
     } else {
         echo "document.getElementById(\"visualisation\").value = JSON.stringify(setup);";
     }
?>
        var form = document.getElementById("redirect");
        var node;`;
        if (includeCurrentPlugins) {
            <?php
            foreach ($PLUGINS as $_ => $plugin) {
                if ($plugin->loaded) {
                    echo <<<EOF
form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", '$plugin->flag');
node.setAttribute("value", '1');
form.appendChild(node);`;
EOF;
                }
            }
            ?>
        }

        for (let i = 0; i < PLUGINS._exportHandlers.length; i++) {
            let toExport = PLUGINS._exportHandlers[i];
            if (toExport) {
                let value = toExport.call();
                form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", '${toExport.name}');
node.setAttribute("value", '${value}');
form.appendChild(node);`;
            }
        }

        return `${form}
form.submit();<\/script>`;
    }

    function copyHashUrlToClipboard() {
        let baseUrl = "<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/redirect.php#";
<?php
if ($layerVisible) {
    //we need to safely stringify setup (which has been modified by the webgl module)
    echo "        let postData = JSON.stringify(setup, seaGL.webGLWrapper.jsonReplacer) + '|';";
} else {
    echo "        let postData = JSON.stringify(setup) + '|';";
}
?>
        Object.values(PLUGINS.each).forEach(plugin => {
            if (plugin.loaded) {
                postData += plugin.flag + "|";
            }
        });

        let $temp = $("<input>");
        $("body").append($temp);
        $temp.val(baseUrl + encodeURIComponent(postData)).select();
        document.execCommand("copy");
        $temp.remove();
        Dialogs.show("The URL was copied to your clipboard.", 4000, Dialogs.MSG_INFO);
    }

    function exportVisualisation() {
        let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8"><title>Visualisation export</title>
</head>
<body>
${constructExportVisualisationForm()}
</body></html>`;
        let output = new Blob([doc], { type: 'text/html' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-visualisation");
        downloader.href = downloadURL;
        downloader.download = "export.html";
        downloader.click();
    }
</script>

<?php
if ($layerVisible) {
    echo "<script src=\"layers.js?v=$version\" type=\"text/javascript\"></script>";
}
?>

<script type="text/javascript">
    /*---------------------------------------------------------*/
    /*------------ PLUGINS ------------------------------------*/
    /*---------------------------------------------------------*/

    var PLUGINS = {
        osd: viewer,
<?php
if ($layerVisible) {
    echo "        hasLayers: true,
                  seaGL: seaGL,";
} else {
    echo "        hasLayers: false,
                  seaGL: null,";
}
?>
        addTutorial: Tutorials.add.bind(Tutorials),
        dialog: Dialogs,
        appendToMainMenu: function(title, titleHtml, html, id, pluginId) {
            $("#main-panel-content").append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root"><div><h3 class="d-inline-block h3" style="padding-left: 35px;">${title}&emsp;</h3>${titleHtml}</div><div>${html}</div></div>`);
        },
        replaceInMainMenu: function(title, titleHtml, html, id, pluginId) {
            $(`.${pluginId}-plugin-root`).remove();
            this.appendToMainMenu(title, titleHtml, html, id, pluginId);
        },
        appendToMainMenuExtended: function(title, titleHtml, html, hiddenHtml, id, pluginId) {
            $("#main-panel-content").append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root"><div>
        <span class="material-icons inline-pin plugins-pin" id="${id}-pin" onclick="pinClick($(this), $(this).parent().parent().children().eq(2));"> push_pin </span>
        <h3 class="d-inline-block h3">${title}&emsp;</h3>${titleHtml}
        </div>
        <div>
        ${html}
        </div><div class='inner-panel-hidden'>${hiddenHtml}</div></div>`);
        },
        replaceInMainMenuExtended: function(title, titleHtml, html, hiddenHtml, id, pluginId) {
            $(`.${pluginId}-plugin-root`).remove();
            this.appendToMainMenuExtended(title, titleHtml, html, hiddenHtml, id, pluginId);
        },
        appendToMainMenuRaw: function(html, id, pluginId) {
            $("#main-panel-content").append(`<div id="${id}" class="inner-panel ${pluginId}-plugin-root">${html}</div>`);
        },
        addPostExport: function(name, valueHandler, pluginId) {
            this._exportHandlers.push({name: name, call: valueHandler, pluginId: pluginId});
        },
        addHtml: function(html, pluginId) {
            let pluginRoot = $(`#${pluginId}-plugin-root`);
            if (pluginRoot.length <= 0){
                pluginRoot = $("body").append(`<div id="${pluginId}-plugin-root">${html}</div>`);
            } else {
                pluginRoot.append(html);
            }
        },
        dataLayer: viewer.world.getItemAt.bind(viewer.world, layerIDX),
        postData: <?php echo json_encode($_POST)?>,
        each: <?php echo json_encode((object)$PLUGINS)?>,
        _exportHandlers: []
    };

    var _registeredPlugins = [];

    function registerPlugin(PluginClass) {
        if (_registeredPlugins === undefined) {
            console.error("Plugins has already been loaded.");
            return;
        }
        try {
            var plugin = new PluginClass();
        } catch (e) {
            if (!PluginClass.identifier) {
                console.warn("Plugin registered with no static identifier!", PluginClass);
                return;
            }
            let id = PluginClass.identifier;

            console.warn(`Failed to instantiate plugin ${PluginClass}.`, e);
            PLUGINS.each[id].loaded = false;
            PLUGINS.each[id].permaLoaded = false;
            PLUGINS.each[id].error = e;
            $(`.${id}-plugin-root`).remove();
            return;
        }
        if (PluginClass.identifier !== plugin.id) {
            console.warn("Plugin.identifier should equal to the plugin instance.id!", PluginClass);
        }
        if (plugin.id !== PLUGINS.each[plugin.id].id) {
            console.warn(`Plugin ${PluginClass} has invalid ID set. It must equal to the id defined in include.json`, plugin);
            return;
        }
        PLUGINS.each[plugin.id].instance = plugin;
        window[plugin.id] = plugin;
        if (OpenSeadragon.isFunction(plugin["openSeadragonReady"])) {
            _registeredPlugins.push(plugin);
        }
    }

    function fileNameOf(imageFilePath) {
        let begin = imageFilePath.lastIndexOf('/')+1;
        return imageFilePath.substr(begin, imageFilePath.length - begin - 4);
    }

    viewer.addHandler('open', function() {
        let i = 0;
        let largestWidth = 0, selectedImageLayer = 0;
        let imageNode = $("#image-layer-options");
        //image-layer-options can be missing --> populate menu only if exists
        if (imageNode) {
            //reverse order menu since we load images in reverse order
            for (let revidx = setup.background.length-1; revidx >= 0; revidx-- ) {
                let image = setup.background[revidx];
                let worldItem = viewer.world.getItemAt(i);
                if (image.hasOwnProperty("lossless") && image.lossless) {
                    worldItem.source.fileFormat = "png";
                }
                let width = worldItem.getContentSize().x;
                if (width > largestWidth) {
                    largestWidth = width;
                    selectedImageLayer = i;
                }
                imageNode.prepend(`
            <div class="h5 pl-3 py-1 position-relative">
              <input type="checkbox" checked class="form-control"
              onchange="viewer.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);">
              &emsp;Image ${fileNameOf(setup.data[image.dataReference])}
            </div>`);
                i++;
            }
        }
        PLUGINS.imageLayer = viewer.world.getItemAt.bind(viewer.world, selectedImageLayer);

        if (layerIDX !== -1) {
            if (layerIDX !== i) {
                console.warn("Invalid initialization: layer index should be ", i);
                layerIDX = i;
            }

            let layerWorldItem = viewer.world.getItemAt(layerIDX);
            let activeVis = setup.visualizations[activeVisualization];
            if (activeVis.hasOwnProperty("lossless") && activeVis.lossless && layerWorldItem) {
                layerWorldItem.source.fileFormat = "png";
            }
<?php
if ($layerVisible) {
    echo "seaGL.setLayerIndex(layerIDX);";
}
?>
        }

        _registeredPlugins.forEach(plugin => {
            try {
                plugin.openSeadragonReady()
            } catch (e) {
                console.warn(`Failed to initialize plugin ${plugin}.`, e);
                delete PLUGINS.each[plugin.id].instance;
                delete window[plugin.id];
                PLUGINS.each[plugin.id].loaded = false;
                PLUGINS.each[plugin.id].permaLoaded = false;
                PLUGINS.each[plugin.id].error = e;

                let removalIndices = [];
                for (let i = 0; i < PLUGINS._exportHandlers.length; i++) {
                    if (PLUGINS._exportHandlers[i].pluginId === plugin.id) {
                        removalIndices.push(i);
                    }
                }
                //removed in backward pass to always access valid indices
                for (let j = removalIndices.length-1; j >= 0; j--) {
                    PLUGINS._exportHandlers.splice(removalIndices[j], 1);
                }
                //remove any plugin HTML
                $(`.${plugin.id}-plugin-root`).remove();
            }
        });
        _registeredPlugins = undefined;
    });

    function showAvailablePlugins() {
        let content = "<input type='checkbox' class='form-control position-absolute top-1 right-0' checked id='remember-plugin-selection'><label class='position-absolute top-0 right-4'  for='remember-plugin-selection'>remember selection</label><br>";
        Object.values(PLUGINS.each).forEach(plugin => {
            let dependency = "";
            if (plugin.requires) {
                dependency = `onchange="let otherNode = document.getElementById('select-plugin-${plugin.requires}'); if (otherNode && this.checked) {otherNode.checked = true; otherNode.disabled = true;} else {otherNode.disabled = false;}"`;
            }

            let checked = plugin.loaded ? "checked" : "";
            let disabled = plugin.permaLoaded ? "disabled" : "";
            let problematic = plugin.error ? `<span class='material-icons pointer' style='font-size: initial; color: var( --color-icon-danger)' title='This plugin has been automatically removed: there was an error. [${plugin.error}]'>warning</span>`: "";
            content += `<input class="form-control" id="select-plugin-${plugin.id}" type="checkbox" ${dependency} value="${plugin.flag}" ${checked} ${disabled}>&emsp;<label for="select-plugin-${plugin.id}">${problematic}${plugin.name}</label><br>`;
        });

        Dialogs.showCustom("load-plugins", "Add plugins", content + "<br>",
            `<button onclick="loadWithPlugins(document.getElementById('remember-plugin-selection'));" class="btn position-absolute bottom-2 right-4">Load with selected</button>`);
    }

    function loadWithPlugins(remember=false) {
        let formData = "",
            plugins = [];
        Object.values(PLUGINS.each).forEach(plugin => {
            if (document.getElementById(`select-plugin-${plugin.id}`).checked) {
                formData += `<input type="hidden" name="${plugin.flag}" value="1">`;
                plugins.push(plugin.flag);
            }
        });
        plugins = remember ? plugins.join(',') : "";
        document.cookie = `plugins=${plugins}; expires=Sun, 1 Jan 2023 00:00:00 UTC; SameSite=Strict; path=/`;
        $("body").append(constructExportVisualisationForm(formData, false));
    }

</script>
<!-- PLUGINS -->
<?php
foreach ($PLUGINS as $_ => $plugin) {
    if ($plugin->loaded) {
        //add plugin style sheet if exists
        if (file_exists(PLUGIN_FOLDER . $plugin->directory . "/style.css")) {
            echo "<link rel=\"stylesheet\" href=\"" . PLUGIN_FOLDER . $plugin->directory . "/style.css?v=$version\">";
        }
        //add plugin includes
        foreach ($plugin->includes as $__ => $file) {
            echo "<script src=\"" . PLUGIN_FOLDER . $plugin->directory . "/$file?v=$version\"></script>";
        }
    }
}

if ($layerVisible) {
    echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init with layers (variables from layers.js) -------*/
    /*---------------------------------------------------------*/

    seaGL.loadShaders(function() {
        activeData = seaGL.dataImageSources(); 
        //reverse order: last opened IMAGE is the first visible
        let toOpen = setup.background.map(value => iipSrvUrlGET + setup.data[value.dataReference] + ".dzi").reverse();
        toOpen.push(iipSrvUrlPOST + activeData + ".dzi");
        viewer.open(toOpen);
    });
    seaGL.init(viewer);

    viewer.addHandler('open-failed', function(e) {
        let sources = setup.background.map(value => iipSrvUrlGET + setup.data[value.dataReference] + ".dzi");
        sources.push(iipSrvUrlPOST + activeData + ".dzi");
        DisplayError.show("No valid images.", `We were unable to open provided image sources. 
Url's are probably invalid. <code>\${sources.join(", ")}</code>`);
    });

</script>
EOF;

} else {
    echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init without layers (layers.js) -------------------*/
    /*---------------------------------------------------------*/

    (function() {
        let toOpen = setup.background.map(value => iipSrvUrlGET + setup.data[value.dataReference] + ".dzi");     
        viewer.open(toOpen);
    })();
</script>
EOF;
}
?>
</body>
</html>