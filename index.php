<?php

if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}

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

/**
 * Redirection: based on parameters, either setup visualisation or redirect
 */

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

/**
 * Parsing: verify valid parameters
 */

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
$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = !isset($_COOKIE["shadersPin"]);
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

    //requires webgl module
    $MODULES["webgl"]->loaded = true;
}

$visualisation = json_encode($parsedParams);
$cookieCache = json_encode($cookieCache);
$version = VERSION;

/**
 * Plugins+Modules loading: load required parts of the application
 */

$pluginsInCookies = isset($_COOKIE["plugins"]) ? explode(',', $_COOKIE["plugins"]) : [];
foreach ($PLUGINS as $_ => $plugin) {
    //plugin is loaded if flag not specified or if flag set and no error in the plugin occurred
    $plugin->loaded = !isset($plugin->error) &&
        (!isset($plugin->flag) || isFlagInProtocols($plugin->flag) || in_array($plugin->flag, $pluginsInCookies));
    $plugin->permaLoaded = $plugin->loaded && isset($_GET[$plugin->flag]) && $_GET[$plugin->flag] == "true";

    //make sure all modules required by plugins are also loaded
    if ($plugin->loaded) {
        foreach ($plugin->modules as $modId) {
            $MODULES[$modId]->loaded = true;
        }
    }
}

//make sure all modules required by other modules are loaded
foreach ($MODULES as $_ => $mod) {
    if ($mod->loaded) {
        foreach ($mod->requires as $__ => $requirement) {
            $MODULES[$requirement]->loaded = true;
        }
    }
}

?>
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

    <!--Tutorials-->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/kineticjs/5.2.0/kinetic.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jquery-scrollTo/2.1.2/jquery.scrollTo.min.js"></script>
    <link rel="stylesheet" href="./external/enjoyhint.css">
    <script src="./external/enjoyhint.min.js"></script>

    <!--Modules-->
<?php

foreach ($MODULES as $_ => $mod) {
    if ($mod->loaded) {
        //add module style sheet if exists
        if (file_exists(MODULES . "/" . $mod->directory . "/style.css")) {
            echo "<link rel=\"stylesheet\" href=\"" . MODULES . "/" . $mod->directory . "/style.css?v=$version\">\n";
        }
        foreach ($mod->includes as $__ => $file) {
            echo "    <script src=\"" . MODULES . "/" . $mod->directory . "/$file?v=$version\"></script>\n";
        }
    }
}

?>

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
    <br><br><button class="btn" onclick="Tutorials.hide();">Exit</button>
</div>

<!-- Main Panel -->
<span id="main-panel-show" class="material-icons pointer" onclick="$('#main-panel').css('right', 0);">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="overflow-y: overlay; width: 400px;" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">

    <div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 40px;overflow-y: auto; scrollbar-width: thin /*mozilla*/;">
        <span id="main-panel-hide" class="material-icons pointer" onclick="$('#main-panel').css('right', '-400px');">chevron_right</span>
        <div id="navigator-container" class="inner-panel top-0 left-0" style="width: 400px; position: relative; background-color: var(--color-bg-canvas)">
            <div><!--the div below is re-inserted by OSD, keep it in the hierarchy at the same position-->
                <div id="panel-navigator" style=" height: 300px; width: 100%;"></div>
            </div>
            <span id="navigator-pin" class="material-icons pointer inline-pin position-absolute right-2 top-2" onclick=" let self = $(this);
 if (self.hasClass('pressed')) {
    self.removeClass('pressed');
    self.parent().removeClass('color-shadow-medium position-fixed');
 } else {
    self.parent().addClass('color-shadow-medium position-fixed');
    self.addClass('pressed');
 }
"> push_pin </span>
        </div>
        <div id="general-controls" class="inner-panel d-flex">
            <!--TODO export also these values? -->
<?php

//if only one data layer visible, show as checkbox, else add Images menu
if ($layerVisible && $singleBgImage) {
    echo <<<EOF
            <label for="global-opacity">Layer Opacity: &nbsp;</label>
            <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 150px;">&emsp;
            <label for="global-tissue-visibility"> Show tissue &nbsp;</label>
            <input type="checkbox" style="align-self: center;" checked class="form-control" id="global-tissue-visibility"
                   onchange="viewer.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
        </div><!--end of general controls-->
EOF;
} else {
    if ($layerVisible) {
        echo '<label for="global-opacity">Layer Opacity: &nbsp;</label>
            <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 250px;">&emsp;';
    }
    echo <<<EOF
        </div> <!--end of general controls-->
        <div id="panel-images" class="inner-panel">   
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="images-pin" class="material-icons pointer inline-pin" onclick="pinClick($(this), $(this).parents().eq(1).children().eq(1));"> push_pin </span>
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
    $opened = $firstTimeVisited || $_COOKIE["shadersPin"] == "true";
    $pinClass = $opened ? "pressed" : "";
    $shadersSettingsClass = $opened ? "force-visible" : "";
    echo <<<EOF
          <div id="panel-shaders" class="inner-panel" >
    
                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
    
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
    
                        <span id="shaders-pin" class="material-icons pointer inline-pin $pinClass" onclick="let jqSelf = $(this); pinClick(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                        document.cookie = `shadersPin=\${jqSelf.hasClass('pressed')}; expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=Strict; path=/`"> push_pin </span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <span id="cache-snapshot" class="material-icons pointer" style="text-align:right; vertical-align:sub;float: right;" title="Remember settings" onclick="makeCacheSnapshot();">repeat_on</span>
                    </div>
    
                    <div id="data-layer-options" class="inner-panel-hidden $shadersSettingsClass">
                            <!--populated with options for a given image data -->
                    </div>
                </div>
            </div>
EOF;
}
?>
        <!-- Appended controls for other plugins -->
    </div>

    <div class="d-flex flex-items-end p-2 flex-1 position-fixed bottom-0 pointer" style="width: 400px; background: #787878cf;">
        <span id="copy-url" class="pl-2" onclick="copyHashUrlToClipboard();" title="Get the visualisation link"><span class="material-icons pointer">link</span>Get link</span>
        <span id="global-export" class="pl-2" onclick="exportVisualisation();" title="Export visualisation together with plugins data"><span class="material-icons pointer">download</span>Export</span>
        <a style="display:none;" id="export-visualisation"></a> &emsp;
        <span id="add-plugins" onclick="showAvailablePlugins();" title="Add plugins to the visualisation"><span class="material-icons pointer">extension</span>Plugins</span>&emsp;
        <span id="global-help" onclick="Tutorials.show();" title="Show tutorials"><span class="material-icons pointer">school</span>Tutorial</span>&emsp;
    </div>
</div>

<!-- DEFAULT SETUP SCRIPTING -->
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*------------ System error messenger ---------------------*/
    /*---------------------------------------------------------*/

    var DisplayError = {
        active: false,

        show: function(title, description, withHiddenMenu=false) {
            Tutorials._hideImpl(false); //preventive
            $("#system-message-title").html(title);
            $("#system-message-details").html(description);
            $("#system-message").removeClass("d-none");
            $("#viewer-container").addClass("disabled");
            if (withHiddenMenu) $("#main-panel").css("right", "-400px");
            this.active = true;
        },

        hide: function() {
            $("#system-message").addClass("d-none");
            $("#viewer-container").removeClass("disabled");
            this.active = false;
        }
    };

    //preventive error message, that will be discarded on the full initialization
    window.onerror = function (message, file, line, col, error) {
        if (DisplayError.active) return false;
        DisplayError.show("Unknown error.", `Something has gone wrong: '${message}' <br><code>${error.message}
<b>in</b> ${file}, <b>line</b> ${line}</code>`, true);
        return false;
    };

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
        ajaxHeaders: <?php echo json_encode((object)COMMON_HEADERS); ?>,
        splitHashDataForPost: true,
        //todo maybe do not set for chrome?
        subPixelRoundingForTransparency: OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
        // debugMode:  true,
    });
    viewer.gestureSettingsMouse.clickToZoom = false;

    /*---------------------------------------------------------*/
    /*------------ Initialization of Visualisation ------------*/
    /*---------------------------------------------------------*/

    var shadersCache = <?php echo $cookieCache ?>;
    var setup = <?php echo $visualisation ?>;
    var activeVisualization = 0; //todo dynamic?
    const visualizationUrlMaker = new Function("path,data",
        "return " + (setup.params.visualizationProtocol || "`${path}#DeepZoomExt=${data.join(',')}.dzi`"));

    //index of the layer composed of shaders, last one or not present (-1)
    let layerIDX = setup.hasOwnProperty("visualizations") ? setup.background.length : -1;

    // Tutorial functionality
    var Tutorials = {
        tutorials: $("#tutorials"),
        steps: [],
        prerequisites: [],

        show: function(title="Select a tutorial", description="The visualisation is still under development: components and features are changing. The tutorials might not work, missing or be outdated.") {
            if (DisplayError.active) return;

            $("#tutorials-container").removeClass("d-none");
            $("#viewer-container").addClass("disabled");
            $("#tutorials-title").html(title);
            $("#tutorials-description").html(description);
            $('#main-panel').css('right', '-400px');
        },

        hide: function() {
            this._hideImpl(true);
        },

        _hideImpl: function(reflectGUIChange) {
            $("#tutorials-container").addClass("d-none");
            if (reflectGUIChange) {
                $("#viewer-container").removeClass("disabled");
                $('#main-panel').css('right', '0px');
            }
            document.cookie = 'shadersPin=false; expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=Strict; path=/';
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


            //reset plugins visibility
            $(".plugins-pin").each(function() {
                let pin = $(this);
                let container = pin.parents().eq(1).children().eq(2);
                pin.removeClass('pressed');
                container.removeClass('force-visible');
            });
            //do prerequisite setup if necessary
            if(this.prerequisites[index]) this.prerequisites[index]();
            let enjoyhintInstance = new EnjoyHint({});
            enjoyhintInstance.set(this.steps[index]);
            this.hide();
            enjoyhintInstance.run();
        }
    };

    <?php

echo <<<EOF
    Tutorials.add("", "Basic functionality", "learn how the visualiser works", "foundation", [ {
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
} else {
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
        \'next #panel-shaders\' : \'The data layer <br>-the core visualisation functionality-<br> is highly flexible and can be conrolled here.\'
}, {
        \'click #shaders-pin\' : \'Click on the pin to set <br>this controls subpanel to be always visible.\'
}, {
        \'next #shaders\' : \'In case multiple different visualisations <br>are set, you can select <br>which one is being displayed.\'
}, {
        \'next #data-layer-options\' : \'Each visualisation consists of several <br>data parts and their interpretation. <br>Here, you can control each part separately, <br>and also drag-n-drop to reorder.\'
},';
}

echo <<<EOF
{
        'next #global-help' : 'That\'s all for now.<br> With plugins, more tutorials will appear here.'
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
         echo "document.getElementById(\"visualisation\").value = \`\${JSON.stringify(setup, seaGL.webGLWrapper.jsonReplacer)}\`;";
     } else {
         echo "document.getElementById(\"visualisation\").value = \`\${JSON.stringify(setup)}\`;";
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

        let oldViewport = setup.params.viewport;
        setup.params.viewport = {
            zoomLevel: viewer.viewport.getZoom(),
            point: viewer.viewport.getCenter()
        };
<?php
if ($layerVisible) {
    //we need to safely stringify setup (which has been modified by the webgl module)
    echo "        let postData = JSON.stringify(setup, seaGL.webGLWrapper.jsonReplacer) + '|';";
} else {
    echo "        let postData = JSON.stringify(setup) + '|';";
}
?>
        setup.params.viewport = oldViewport;
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
<div>Errors (if any): <pre>${JSON.stringify(console.savedLogs)}</pre></div>
${constructExportVisualisationForm()}
</body></html>`;
        let output = new Blob([doc], { type: 'text/html' });
        let downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-visualisation");
        downloader.href = downloadURL;
        downloader.download = "export.html";
        downloader.click();
        URL.revokeObjectURL(downloadURL);
    }
</script>

<?php
require_once ("dialogs.php");
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
        <span class="material-icons inline-pin plugins-pin pointer" id="${id}-pin" onclick="pinClick($(this), $(this).parent().parent().children().eq(2));"> push_pin </span>
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
<div class="h5 pl-3 py-1 position-relative"><input type="checkbox" checked class="form-control"
onchange="viewer.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);">Image
${fileNameOf(setup.data[image.dataReference])}<input type="range" min="0" max="1" value="1" step="0.1"
onchange="viewer.world.getItemAt(${i}).setOpacity(Number.parseFloat(this.value));"></div>`);
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
    echo "            seaGL.setLayerIndex(layerIDX);";
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

        if (setup.params.hasOwnProperty("viewport")
                && setup.params.viewport.hasOwnProperty("point")
                && setup.params.viewport.hasOwnProperty("zoomLevel")) {
            viewer.viewport.panTo(setup.params.viewport.point);
            viewer.viewport.zoomTo(setup.params.viewport.zoomLevel);
        }

        if (window.innerHeight < 630) {
            $("#navigator-pin").click();
            $("#main-panel-hide").click();
        }

        window.onerror = function(message, source, lineno, colno, error) {
            Dialogs.show(message, 10000, Dialogs.MSG_ERR);
            return false;
        };

        if (DisplayError.active) {
            $("#viewer-container").addClass("disabled"); //preventive
            return; //actually valid, PHP can attach code below this
        }

<?php
if ($firstTimeVisited) {
    echo "        setTimeout(_ => Tutorials.show('It looks like this is your first time here', 'Please, go through <b>Basic Functionality</b> tutorial to familiarize yourself with the environment.'), 2000);";
}
?>
    });

    function showAvailablePlugins() {
        let content = "<input type='checkbox' class='form-control position-absolute top-1 right-2' checked id='remember-plugin-selection'><label class='position-absolute top-0 right-5' for='remember-plugin-selection'>remember selection</label><br>";
        Object.values(PLUGINS.each).forEach(plugin => {
            let dependency = "";
            if (plugin.requires) {
                dependency = `onchange="let otherNode = document.getElementById('select-plugin-${plugin.requires}'); if (otherNode && this.checked) {otherNode.checked = true; otherNode.disabled = true;} else if (otherNode) {otherNode.disabled = false;}"`;
            }

            let checked = plugin.loaded ? "checked" : "";
            let disabled = plugin.permaLoaded ? "disabled" : "";
            let problematic = plugin.error ? `<span class='material-icons pointer' style='font-size: initial; color: var( --color-icon-danger)' title='This plugin has been automatically removed: there was an error. [${plugin.error}]'>warning</span>`: "";
            content += `<input class="form-control" id="select-plugin-${plugin.id}" type="checkbox" ${dependency} value="${plugin.flag}" ${checked} ${disabled}>&emsp;<label for="select-plugin-${plugin.id}">${problematic}${plugin.name}</label><br>`;
        });

        Dialogs.showCustom("load-plugins", "Add plugins", content + "<br>",
            `<button onclick="loadWithPlugins(document.getElementById('remember-plugin-selection'));" class="btn position-absolute bottom-2 right-4">Load with selected</button>`, {allowClose: true});
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
        document.cookie = `plugins=${plugins}; expires=Fri, 31 Dec 9999 23:59:59 GMT; SameSite=Strict; path=/`;
        $("body").append(constructExportVisualisationForm(formData, false));
    }

</script>
<!-- PLUGINS -->
<?php
foreach ($PLUGINS as $_ => $plugin) {
    if ($plugin->loaded) {
        //add plugin style sheet if exists
        if (file_exists(PLUGINS . "/" . $plugin->directory . "/style.css")) {
            echo "<link rel=\"stylesheet\" href=\"" . PLUGINS . "/" . $plugin->directory . "/style.css?v=$version\">\n";
        }
        //add plugin includes
        foreach ($plugin->includes as $__ => $file) {
            echo "<script src=\"" . PLUGINS . "/" . $plugin->directory . "/$file?v=$version\"></script>\n";
        }
    }
}

$srvImages = SERVED_IMAGES;
$srvLayers = SERVED_LAYERS;

if ($layerVisible) {
    echo <<<EOF
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*----- Init with layers (variables from layers.js) -------*/
    /*---------------------------------------------------------*/

    seaGL.loadShaders(function() {
        activeData = seaGL.dataImageSources(); 
        //reverse order: last opened IMAGE is the first visible
        let toOpen = setup.background.map(value => {
            const urlmaker = new Function("path,data", "return " + (value.protocol || "`\${path}?Deepzoom=\${data}.dzi`"));
            return urlmaker("$srvImages", setup.data[value.dataReference]);
        }).reverse();
        toOpen.push(visualizationUrlMaker("$srvLayers", activeData));
        viewer.open(toOpen);
    });
    seaGL.init(viewer);

    viewer.addHandler('open-failed', function(e) {
        let sources = []; //todo create valid urls again
        DisplayError.show("No valid images.", `We were unable to open provided image sources. 
Url's are probably invalid. <br><code>\${sources.join(", ")}</code>`, true);
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
         let toOpen = setup.background.map(value => {
            const urlmaker = new Function("path,data", "return " + (value.protocol || "`\${path}?Deepzoom=\${data}.dzi`"));
            //todo absolute path? dynamic using php?
            return urlmaker("$srvImages", setup.data[value.dataReference]);
        }).reverse(); 
        viewer.open(toOpen);
    })();
</script>
EOF;
}
?>
</body>
</html>
