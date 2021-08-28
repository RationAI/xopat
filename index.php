<?php

require_once("plugins.php");

function hasKey($array, $key) {
  return isset($array[$key]) && $array[$key];
}

function isFlag($flag) {
  return (hasKey($_GET, $flag) ? $_GET[$flag] : (hasKey($_POST, $flag) ? $_POST[$flag] : false));
}

function letUserSetUp($image, $layer) {
  //todo encode params for url?
  header("Location: user_setup.php?image=$image&layer=$layer");
  exit;
}

$errorSource = false;

//can come both from POST and GET
$dataSource = hasKey($_GET, "image") ? $_GET : (hasKey($_POST, "image") ? $_POST : false);
//can come from POST
$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] : false;

$requireNewSetup = hasKey($_GET, "new") || hasKey($_POST, "new") || hasKey($_COOKIE, "new");

//if no request for new visualisationm try to use cookies
if (!$visualisation && !$requireNewSetup && hasKey($_COOKIE, "visualisation")) {
  $visualisation = $_COOKIE["visualisation"];
  //if data not given in POST/GET, try cookies
  if (!$dataSource) {
    $errorSource = !hasKey($_COOKIE, "image") || !hasKey($_COOKIE, "layer");
    if (!$errorSource) {
      $dataSource = $_COOKIE;
    }
  }
}

//TODO check structure of visualisation object and fail if invalid

if (!$dataSource) { //if missing data, error
  $errorSource = true;
} else { //else visualisation style required
  if ($visualisation) {
    //todo check also POST image and POST layer exist!!!!
    setcookie( "visualisation", $visualisation, strtotime( '+30 days' ) );
    //TODO move there arguments to remain in GET parameters to differentiate between visualisation sources
    setcookie( "image", $dataSource["image"], strtotime( '+30 days' ) );
    setcookie( "layer", $dataSource["layer"], strtotime( '+30 days' ) );
  } else {
    letUserSetUp($dataSource["image"], $dataSource["layer"]);
  }
}

//possible cache
$cached = hasKey($_POST, "cache") && !$requireNewSetup ? $_POST["cache"] : "{}";


?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation</title>

  <link rel="stylesheet" href="./style.css">
  <link rel="stylesheet" href="./github.css">

  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
  <script src="http://code.jquery.com/jquery-1.10.2.min.js"></script>
  
  <!-- OSD -->
  <script src="./osd/openseadragon.min.js"></script>
  <!-- <script src="./osd_debug/openseadragon.js"></script>

  <script src="./osd_debug/eventsource.js"></script>
  <script src="./osd_debug/rectangle.js"></script>
  <script src="./osd_debug/tile.js"></script>
  <script src="./osd_debug/tilecache.js"></script>
  <script src="./osd_debug/tiledimage.js"></script>
  <script src="./osd_debug/tilesource.js"></script>
  <script src="./osd_debug/button.js"></script>
  <script src="./osd_debug/buttongroup.js"></script>
  <script src="./osd_debug/control.js"></script>
  <script src="./osd_debug/controldock.js"></script>
  <script src="./osd_debug/displayrectangle.js"></script>
  <script src="./osd_debug/drawer.js"></script>
  <script src="./osd_debug/dzitilesource.js"></script>
  <script src="./osd_debug/fullscreen.js"></script>
  <script src="./osd_debug/iiiftilesource.js"></script>
  <script src="./osd_debug/imageloader.js"></script>
  <script src="./osd_debug/imagetilesource.js"></script>
  <script src="./osd_debug/legacytilesource.js"></script>
  <script src="./osd_debug/mousetracker.js"></script>
  <script src="./osd_debug/viewer.js"></script>
  <script src="./osd_debug/navigator.js"></script>
  <script src="./osd_debug/osmtilesource.js"></script>
  <script src="./osd_debug/overlay.js"></script>
  <script src="./osd_debug/placement.js"></script>
  <script src="./osd_debug/point.js"></script>
  <script src="./osd_debug/profiler.js"></script>
  <script src="./osd_debug/referencestrip.js"></script>
  <script src="./osd_debug/spring.js"></script>
  <script src="./osd_debug/strings.js"></script>
  <script src="./osd_debug/tilesourcecollection.js"></script>
  <script src="./osd_debug/tmstilesource.js"></script>
  <script src="./osd_debug/viewport.js"></script>
  <script src="./osd_debug/world.js"></script>
  <script src="./osd_debug/zoomifytilesource.js"></script> -->

  <script src="./webgl/openSeadragonGLdynamic.js"></script>
  <script src="./webgl/viaWebGLdynamic.js"></script>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" >
  <!-- OSD viewer -->
  <div id="viewer-container" class="position-absolute width-full height-full top-0 left-0" style="pointer-events: none;">
     <div id="osd" style="pointer-events: auto;" class="position-absolute width-full height-full top-0 left-0"></div>
  </div>

  <!-- System messaging -->
  <div id="system-message" class="d-none">
    <div id="system-message-warn" class="f00-light text-center"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;Error</div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('visibility', 'visible'); $(this).css('visibility', 'hidden');" class="btn" type="button">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="visibility: hidden;"></div>
  </div>

  <!-- Panel -->
  <div id="main-panel" class="position-fixed d-flex flex-column right-0 height-full color-shadow-medium" style="overflow-y: overlay; width: 400px;" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">

    <div id="navigator-container" class="inner-panel position-fixed right-0 top-0" style="width: 400px;">
      <div id="panel-navigator" class="inner-panel" style=" height: 300px; width: 100%;"></div>
    </div>

    <div class="inner-panel d-flex" style="margin-top: 320px;">
      <span> Overlay opacity: &emsp;</span>
      <input type="range" id="global-opacity" min="0" max="1" value="1" step="0.1" class="d-flex" style="width: 165px;">&emsp;
      <span onclick="exportVisualisation(this);" title="Export visualisation" style="cursor: pointer;">Export <span class="material-icons">download</span></span>
      <a style="display:none;" id="export-visualisation"></a>
    </div> <!--Height of navigator = margn top of this div + padding-->
    <div id="panel-shaders" class="inner-panel" > 

      <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->

      <div class="inner-panel-content noselect" id="inner-panel-content-1">
        <div>

          <span class="material-icons inline-pin" onclick="pinClick($(this), $(this).parents().eq(1).children().eq(1));"> push_pin </span>
          
          <select name="shaders" id="shaders" class="form-select v-align-baseline h3 mb-1" aria-label="Visualisation">
            <!--populated with shaders from the list -->
          </select>          
        </div>

        <div id="shader-options" class="inner-panel-hidden">
          <!--populated with options for a given shader -->
        </div>
      </div>
   </div>

   <!-- Appended controls for other plugins -->
  </div>

  <!-- Auto-appended scripts -->
  <div id="auto-scripts"></div>
  

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
  //todo failure, no data source
  echo "$('#main-panel').addClass('d-none');";
  $debugSource = print_r($dataSource, true);
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
    var urlImage = "<?php echo $dataSource["image"]; ?>";
    var urlLayer = "<?php echo $dataSource["layer"]; ?>";
    var setup = <?php echo $visualisation ?>;  
    
    //IIPIMAGE with deepzoom protocol will provide dzi tiles from tif (urlImage and layer data)
    var baseTileSource = "/iipsrv/iipsrv.fcgi?Deepzoom=" + urlImage + ".dzi";
    var layerTileSource = "/iipsrv/iipsrv.fcgi?Deepzoom=" + urlLayer + ".dzi";

    let sources = [baseTileSource, layerTileSource];
    let baseIDX = 0;
    let layerIDX = 1;

    var activeShader = 0;

    // Initialize viewer - OpenSeadragon
    var viewer = OpenSeadragon({
      id: "osd",
      prefixUrl: "osd/images/",
      tileSources: sources,
      showNavigator: true,
      maxZoomPixelRatio: 1,
      showNavigator:  true,
      //navigatorAutoFade:  false,
      showNavigationControl: false,
      navigatorId: "panel-navigator",
      // debugMode:  true,  
    });
    viewer.gestureSettingsMouse.clickToZoom = false;

    // Initialize viewer webGL extension - ViaGL
    let shaderNames = $("#shaders");
    seaGL = new openSeadragonGL(viewer, {
      //todo CHECK if parameters not missing and throw error if required param missing
      htmlControlsId: "shader-options",
      scriptId: "auto-scripts",
      jsGlLoadedCall: "glLoaded",
      jsGlDrawingCall: "glDrawing",
      shaderGenerator: "/iipmooviewer-jiri/OSD/dynamic_shaders/build.php",

      //called once fully initialized
      ready: function() {
        var i = 0;
        seaGL.foreachVisualisation(function (vis) {
          if (vis.error) {
            shaderNames.append(`<option value="${i}" title="${vis.error}">&#9888; ${vis['name']}</option>`);
          } else {
            shaderNames.append(`<option value="${i}">${vis['name']}</option>`);
          }
          i++;
        });
      },

      //called once a visualisation is compiled and linked (might not happen)
      visualisationReady: function(i, visualisation) {

      },

      //called once a visualisation is switched to (including first run)
      visualisationInUse: function(visualisation) {
        enableDragSort("shader-options");
        //called only if everything is fine
        DisplayError.hide(); //preventive
      },

      //called when visualisation is unable to run
      onFatalError: function(vis) {
        DisplayError.show(vis.error, vis.desc);
      },

      //called when exception (usually some missing function) occurs
      onException: function(error) {
        DisplayError.show("Something went wrong and the visualissation is unable to continue. You can use other visualisation if available.", error.message);
      },

      //called to get custom HTML header for each shader part
      htmlShaderPartHeader: function(title, html, isVisible, isControllable=true) {
        let style = isVisible ? '' : 'style="filter: brightness(0.5);"';
        let checked = isVisible ? 'checked' : '';
        let disabled = isControllable ? '' : 'disabled';
        return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${title}" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${checked} ${disabled} data-id="${title}" onchange="shaderPartToogleOnOff(this);">
              &emsp;${title}<span class="material-icons position-absolute right-1" style="width: 10%;">swap_vert</span>
            </div>
            <div class="non-draggable">${html}</div>
            </div>`;
      }
    });

    //must be defined
    function redraw() {
      seaGL.redraw(viewer.world, layerIDX);
    }

    //Set visualisations
    setup.forEach(visualisationDef => {
      //setup all visualisations defined     
      seaGL.setVisualisation(visualisationDef);  
    });

    //Set cache
    seaGL.viaGL.setCache(<?php echo $cached; ?>);

    // load desired shader upon selection
    $("#shaders").on("change", function () {
      activeShader = $(this).val();
      seaGL.switchVisualisation(activeShader);
      redraw();
    });
    // opacity of general layer available everywhere
    $("#global-opacity").on("input", function () {
      var val = $(this).val();
      viewer.world.getItemAt(layerIDX).setOpacity(val);
    });

  
    seaGL.init();

   /*---------------------------------------------------------*/
   /*------------ JS utilities and enhancements --------------*/
   /*---------------------------------------------------------*/

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



    /**
     * Made with love by @fitri
     * This is a component of my ReactJS project https://codepen.io/fitri/full/oWovYj/ 
     * 
     * Shader re-compilation and re-ordering logics
     * Modified by Jiří
     */

    function enableDragSort(listId) {
      const sortableList = document.getElementById(listId);
      Array.prototype.map.call(sortableList.children, (item) => {enableDragItem(item)});
    }

 
    function enableDragItem(item) {
      item.setAttribute('draggable', true);
      item.ondragstart = startDrag;
      item.ondrag = handleDrag;
      item.ondragend = handleDrop;
    }

    function startDrag(event) {
      const currentTarget = event.target;
        let clicked = document.elementFromPoint(event.x, event.y);
        if (isPrevented(clicked, 'non-draggable')) {
          event.preventDefault();
        }
    }
    
    //modified from https://codepen.io/akorzun/pen/aYwXoR
    const isPrevented = (element, cls) => {
      let currentElem = element;
      let isParent = false;
      
      while (currentElem) {
        const hasClass = Array.from(currentElem.classList).some(elem => {return cls === elem;});
        if (hasClass) {
          isParent = true;
          currentElem = undefined;
        } else {
          currentElem = currentElem.parentElement;
        }
      }
      return isParent;
    }

    function handleDrag(item) {
      const selectedItem = item.target,
            list = selectedItem.parentNode,
            x = event.clientX,
            y = event.clientY;
      
      selectedItem.classList.add('drag-sort-active');
      let swapItem = document.elementFromPoint(x, y) === null ? selectedItem : document.elementFromPoint(x, y);
      
      if (list === swapItem.parentNode) {
        swapItem = swapItem !== selectedItem.nextSibling ? swapItem : swapItem.nextSibling;
        list.insertBefore(selectedItem, swapItem);
      }
    }

    function handleDrop(item) {
      item.target.classList.remove('drag-sort-active');
      const listItems = item.target.parentNode.children;

      var order = [];
      Array.prototype.forEach.call(listItems, function(child) {
        order.push(child.dataset.id);
      });

      seaGL.reorder(order);
      redraw();
    }

    function shaderPartToogleOnOff(self) {
      if (self.checked == true) {
        seaGL.currentVisualisation().responseData[self.dataset.id].visible = 1;
        self.parentNode.parentNode.classList.remove("shader-part-error");
      } else {
        seaGL.currentVisualisation().responseData[self.dataset.id].visible = 0;
        self.parentNode.parentNode.classList.add("shader-part-error");
      }
      seaGL.reorder();
      redraw();
    }

    
    function pinClick(jQSelf, jQTargetParent) {
      if (jQTargetParent.hasClass('force-visible')) {
        jQTargetParent.removeClass('force-visible');
        jQTargetParent.addClass('force-hidden');
        jQSelf.removeClass('pressed');
        jQSelf.addClass('locked')
      } else if (jQTargetParent.hasClass('force-hidden')) {
        jQTargetParent.removeClass('force-hidden');
        jQSelf.removeClass('locked')
      } else {
        jQSelf.addClass('pressed');
        jQTargetParent.addClass('force-visible');
      }
    }

    /**
     * Exporting of visualisation
     *  
     */
    function exportVisualisation() {
      let annotations = openseadragon_image_annotations.getJSONContent();
      let visCache = JSON.stringify(seaGL.viaGL.getCache());
      let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
</head>
<body>
  <form method="POST" id="redirect" action="<?php echo "http://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]"; ?>">
    <input type="hidden" id="visualisation" name="visualisation">
    <input type="hidden" id="image" name="image">
    <input type="hidden" id="layer" name="layer">
    <input type="hidden" id="cache" name="cache">
    <input type="hidden" id="dev" name="dev">
    <input type="hidden" id="annotations" name="annotations">
    <input type="submit" value="">
    </form>
  <script type="text/javascript">
    //safely set values (JSON)
    document.getElementById("visualisation").value = '<?php echo $visualisation ?>';
    document.getElementById("image").value = '<?php echo $dataSource["image"]; ?>';
    document.getElementById("layer").value = '<?php echo $dataSource["layer"]; ?>';
    document.getElementById("cache").value = '${visCache}';
    document.getElementById("dev").value = '<?php echo $networkDevelopment; ?>';
    document.getElementById("annotations").value = '${annotations}';

    document.getElementById("redirect").submit();
    <\/script>
</body>
</html>`;
			let output = new Blob([doc], { type: 'text/html' });
			let downloadURL = window.URL.createObjectURL(output);
      var downloader = document.getElementById("export-visualisation");
			downloader.href = downloadURL;
      downloader.download = "export.html";
      downloader.click();
    }


   /*---------------------------------------------------------*/
   /*------------ PLUGINS ------------------------------------*/
   /*---------------------------------------------------------*/
  var mainPanel = $("#main-panel");
   var PLUGINS = {
      osd: viewer,
      seaGL: seaGL,
      appendToMainMenu: function(title, titleHtml, html, id) {
        $("#main-panel").append(`<div id="${id}" class="inner-panel"><div><h3 class="d-inline-block h3" style="padding-left: 35px;">${title}&emsp;</h3>${titleHtml}</div><div>${html}</div></div>`);
      },
      appendToMainMenuExtended: function(title, titleHtml, html, hiddenHtml, id) {
        $("#main-panel").append(`<div id="${id}" class="inner-panel"><div>
        <span class="material-icons inline-pin" onclick="pinClick($(this), $(this).parent().parent().children().eq(2));"> push_pin </span>
        <h3 class="d-inline-block h3">${title}&emsp;</h3>${titleHtml}
        </div>
        <div>	
        ${html}
        </div><div class='inner-panel-hidden'>${hiddenHtml}</div></div>`);
      },
      appendToMainMenuRaw: function(html, id) {
        $("#main-panel").append(`<div id="${id}" class="inner-panel">${html}</div>`);
      },
      postData: <?php echo json_encode($_POST)?>,
      each: <?php echo json_encode((object)$PLUGINS)?>
    };

    viewer.addHandler('open', function() {
      PLUGINS.imageLayer = viewer.world.getItemAt(baseIDX);
      PLUGINS.dataLayer = viewer.world.getItemAt(layerIDX);
    });
  
  </script>

    <!-- PLUGINS -->
<?php
foreach ($PLUGINS as $_ => $plugin) {
    if (isset($plugin->flag) && $plugin->flag && !isFlag($plugin->flag)) {
      continue;
    }

    //add plugin includes
    if (file_exists(PLUGIN_FOLDER . $plugin->directory . "/style.css")) {
      echo "<link rel=\"stylesheet\" href=\"" . PLUGIN_FOLDER . $plugin->directory . "/style.css\">";
    }

    foreach ($plugin->includes as $_ => $file) {
      echo "<script src=\"" . PLUGIN_FOLDER . $plugin->directory . "/$file\"></script>";
    }
}
?>
</body>
</html>