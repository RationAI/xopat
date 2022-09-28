<?php
include_once("./config.php");
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation Developer Setup</title>

  <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>/primer_css.css">
  <script src="<?php echo PROJECT_ROOT; ?>/shader_input_gui.js"></script>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
    <script>
        var OpenSeadragon = {};
    </script>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="max-widt">

<div class="Layout"  style="max-width: 1260px;padding: 25px 60px;margin: 0 auto;">
  <div class="Layout-main ">
  <h1 class="f00-light">Developer visualisation setup</h1>
<br><br>
<?php

include_once(PROJECT_ROOT . "/modules.php");

$webglPath = "";
$version = VERSION;
foreach ($MODULES as $id => $mod) {
    if ($id == "webgl") {
        $webglPath = MODULES_FOLDER . "/" . $mod->directory;
        foreach ($mod->includes as $__ => $file) {
            echo "    <script src=\"" .$webglPath . "/$file?v=$version\"></script>\n";
        }
    }
}
function hasKey($array, $key) {
  return isset($array[$key]) && $array[$key];
}

?>
      <br>
          <textarea rows="40" class="form-control m-2 layer-params" id="custom-params" style="resize: vertical; width: 90%;box-sizing: border-box;" onchange="
          try {
              JSON.parse($(this).val());
          } catch (e) {
              console.warn(e, 'Data:', $(this).val());
              alert(`Incorrect JSON in the custom visualisation: ${e} (see console).`);
          }
">
{
    "params": {
        "customBlending": true
    },
    "data": [],
    "background": [
        {
            "dataReference": 0,
            "lossless": false
        }
    ],
    "shaderSources" : [
        {
            "url": "http://my-shader-url.com/customShader.js",
            "headers": {},
            "typedef": "new_type"
        }
    ],
    "visualizations": [
        {
            "name": "A visualisation setup 1",
            "lossless": true,
            "shaders": {
                "shader_id_1": {
                    "name": "Layer 1",
                    "type": "identity",
                    "visible": 1,
                    "fixed": false,
                    "dataReferences": [],
                    "params": { }
                }
            }
        }
    ]
}
</textarea>
      <form method="POST" target="_blank" action="<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/index.php" id="custom-request">
          <input type="hidden" name="visualisation" id="custom-visualisation" value=''>
          <button class="btn pointer" type="submit" value="Ready!">Ready!</button>&emsp;
      </form>

          <br><br>
          <div id="documentation"></div>
      </div>
  </div>
</div>


<script type="text/javascript">

    PredefinedShaderControlParameters.printShadersAndParams("documentation");

    $(document).off('submit');

    $('#custom-request').submit(function(evt) {
        document.getElementById("custom-visualisation").value = $("#custom-params").val();
    });

</script>
</body>

</html>
