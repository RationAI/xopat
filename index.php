<?php

function hasKey($array, $key) {
  return isset($array[$key]) && $array[$key];
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

//if no request for new visualisation
if (!$visualisation 
      && !hasKey($_GET, "new") 
      && !hasKey($_POST, "new") 
      && !hasKey($_COOKIE, "new") 
      && hasKey($_COOKIE, "visualisation")) {
  
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

//whether to use the visualisation for development of network or for visualisation / browsing of data
$networkDevelopment = hasKey($_GET, "dev") ? $_GET["dev"] : (hasKey($_POST, "dev") ? $_POST["dev"] : false);

//possible cache
$cached = hasKey($_POST, "cache") ? $_POST["cache"] : "{}";

//possible annotations export
$anotationsJSON = hasKey($_POST, "annotations") ? $_POST["annotations"] : "";

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
  <script src="./osd_debug/openseadragon.js"></script>

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
  <script src="./osd_debug/zoomifytilesource.js"></script>

  <script src="./webgl/openSeadragonGLdynamic.js"></script>
  <script src="./webgl/viaWebGLdynamic.js"></script>

  <?php
  if ($networkDevelopment) {
    echo '<!-- New plugin -->
    <link rel="stylesheet" href="./network/style.css">
    <script src="./network/network.js"></script>';
  }
  ?>

  <!-- Fabric -->
  <link rel="stylesheet" href="./annotations/style.css">
  <script src="./external/fabric.min.js"></script>
  <script src="./external/openseadragon-fabricjs-overlay.js"></script>
  <script src="./annotations/osd_fabric_annotation.js"></script>
  <script src="./external/hull.js"></script>
  <script src="./external/point-in-polygon.js"></script>
  <script src="./external/greiner-hormann.min.js"></script>

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

          <span class="material-icons inline-pin"
          onclick="$(this).parents().eq(1).children().eq(1).toggleClass('force-visible'); $(this).toggleClass('pressed');"> push_pin </span>
          
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

    

    var DisplayError = {
      msgTitle: $("#system-message-title"),
      msgDetails: $("#system-message-details"),
      msgContainer: $("#system-message"), 
      screenContainer: $("#viewer-container"),
      // Status: Object.freeze({
      //   ERROR
      // });

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
    
   /*------------ Initialization of OpenSeadragon ------------*/

    var urlImage = "<?php echo $dataSource["image"]; ?>";
    var urlLayer = "<?php echo $dataSource["layer"]; ?>";
    var setup = <?php echo $visualisation ?>;  
    
    // set tile sources for individual images.
    //IIPIMAGE with deepzoom protocol will provide dzi tiles from tif (urlImage and layer data)
    var baseTileSource = "/iipsrv/iipsrv.fcgi?Deepzoom=" + urlImage + ".dzi";
    var layerTileSource = "/iipsrv/iipsrv.fcgi?Deepzoom=" + urlLayer + ".dzi";

    let sources = [baseTileSource, layerTileSource];
    let baseIDX = 0;
    let layerIDX = 1;

    var activeShader = 0;

    // initialize viewer
    var viewer = OpenSeadragon({
      id: "osd",
      prefixUrl: "images/",
      tileSources: sources,
      showNavigator: true,
      maxZoomPixelRatio: 1,
      showNavigator:  true,
      //navigatorAutoFade:  false,
      navigatorId: "panel-navigator",
      // debugMode:  true,  
    });
    viewer.gestureSettingsMouse.clickToZoom = false;


    let shaderNames = $("#shaders");
    //note: a shader, once defined, must be used
    seaGL = new openSeadragonGL(viewer, {
      //todo HCEK if parameters not missing and throw error if required param missing
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

      //called once a visualisation is (for the first time only) compiled and linked (might not happen)
      visualisationReady: function(i, visualisation) {

      },

      visualisationInUse: function(visualisation) {
        enableDragSort("shader-options");
        //called only if everything is fine
        DisplayError.hide(); //preventive
      },
      onFatalError: function(vis) {
        DisplayError.show(vis.error, vis.desc);
      },
      onException: function(error) {
        DisplayError.show("Something went wrong and the visualissation is unable to continue. You can use other visualisation if available.", error.message);
      },
      htmlShaderPartHeader: function(key, data, isVisible) {
        let style = isVisible ? '' : 'style="filter: brightness(0.5);">';
        let checked = isVisible ? 'checked' : '';
        return `<div class="shader-part rounded-3 mx-1 mb-2 pl-3 pt-1 pb-2" data-id="${key}" ${style}>
            <div class="h5 py-1 position-relative">
              <input type="checkbox" class="form-control" ${checked} data-id="${key}" onchange="shaderPartToogleOnOff(this);">
              &emsp;${key}<span class="material-icons position-absolute right-1" style="width: 10%;">swap_vert</span>
            </div>
            <div class="non-draggable">${data[key]["html"]}</div>
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

    

    //init
    // setupShaders();
    //updateShaderControls();
    seaGL.init();


    viewer.addHandler("canvas-scroll", function (event) {
      //Create var to count number of consecutive scrolls that have taken place within the specified time limit of each other
      if (typeof this.scrollNum == 'undefined') {
        this.scrollNum = 0;
      }

      //Create var to store the time of the previous scroll that occurred
      if (typeof this.lastScroll == 'undefined') {
        this.lastScroll = new Date();
      }

      this.currentScroll = new Date(); //Time that this scroll occurred at

      //If the last scroll was less than 400 ms ago, increase the scroll count
      if (this.currentScroll - this.lastScroll < 400) {
        this.scrollNum++;
      }
      //Otherwise, reset the count and zoom speed
      else {
        this.scrollNum = 0;
        viewer.zoomPerScroll = 1.2;
      }

      //If user has scrolled more than twice consecutively within 400 ms, increase the scroll speed with each consecutive scroll afterwards
      if (this.scrollNum > 2) {
        //Limit maximum scroll speed to 2.5
        if (viewer.zoomPerScroll <= 2.5) {
          viewer.zoomPerScroll += 0.2;
        }
      }

      this.lastScroll = this.currentScroll; //Set last scroll to now
    });





    /* Made with love by @fitri
    This is a component of my ReactJS project
    https://codepen.io/fitri/full/oWovYj/ 
    
    Modified by Jiří
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


    
/*------------ Initialization of OSD Annotations ------------*/
var openseadragon_image_annotations = new OSDAnnotations({
  controlPanelId: "main-panel",
   
});


    viewer.addHandler('open', initialize_annotations);


    // /*---------- Handlers for opening of viewer and tile loading--------------- */


    // // load optional images for decision layer
    //viewer.addHandler('open', loadOptions);
    // // initialize fabricjs overlay with annotation control
    // viewer.addHandler('open', initialize_annotations);
    // // set name of downloadable annotation file based on experiment and slide name
    // viewer.addHandler('open', nameAnnotFile);
    // // add handler to recalculate pixels to navigator (so image in nav and viewer stayed the same)
    // viewer.navigator.addHandler('tile-loaded', changePixels);

    /*-------------- End of handlers---------------- */


    /* ------------------Custom functions for handlers-------------*/


    /* initialize_annotations()
    Create annotation overlay and enables annotation control(add, edit, dowload...)
    
    - scale: width of source image (annotationcanvas is created with same width)
    - json_annotation: json string from annotations export
    */

    function initialize_annotations() {
      var options = {
        scale: viewer.world.getItemAt(0).source.Image.Size.Width,
        fireRightClick: true
      };
      var json_annotation = <?php echo "'$anotationsJSON'";?>;
      openseadragon_image_annotations.initialize(json_annotation, viewer, viewer.world.getItemAt(layerIDX), "imageAnnotationToolbarContent", options);
    };

    
    function nameAnnotFile(self) {
      var probabs_url_array = urlProbabilities.split("/");
      var slide = probabs_url_array.pop().split(".")[0].slice(0, -4);
      var experiment = probabs_url_array.pop();
      var file_name = [experiment, slide].join(":");

      document.getElementById('download_link1').download = file_name + ".json";
      document.getElementById('download_link2').download = file_name + ".xml";
    };

    function exportVisualisation() {
      var annotations = openseadragon_image_annotations.getJSONContent();
      var visCache = JSON.stringify(seaGL.viaGL.getCache());
      var doc = `<!DOCTYPE html>
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
			var output = new Blob([doc], { type: 'text/html' });
			var downloadURL = window.URL.createObjectURL(output);
      var downloader = document.getElementById("export-visualisation");
			downloader.href = downloadURL;
      downloader.download = "export.html";
      downloader.click();
    }


    <?php
  if ($networkDevelopment) {
    echo <<<EOF
    var networkPlugin = new Network({
       //send any properties to the plugin
       controlPanelId: "main-panel"
    });

    viewer.addHandler('open', function() {
      //tiledImage now ready
      networkPlugin.init(viewer.viewport, viewer.world.getItemAt(layerIDX), openseadragon_image_annotations);
    });

EOF; 
  } 
  ?>

  </script>
</body>

</html>