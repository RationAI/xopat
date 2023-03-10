<?php
include_once("src/core.php");
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation Developer Setup</title>

  <link rel="stylesheet" href="<?php echo LIBS_ROOT; ?>primer_css.css">
  <script src="<?php echo PROJECT_SOURCES; ?>shader_configurator.js"></script>
  <script src="<?php echo PROJECT_SOURCES; ?>ui_components.js"></script>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"
            integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
            crossorigin="anonymous"></script>
    <script>
        var OpenSeadragon = {};
    </script>

    <?php

    include_once(PROJECT_SOURCES . "plugins.php");

    $webglPath = "";
    $version = VERSION;

    $MODULES["webgl"]["loaded"] = true;
    require_modules();

    function hasKey($array, $key) {
        return isset($array[$key]) && $array[$key];
    }

    $root = $CORE["client"]["domain"] . $CORE["client"]["path"];

    ?>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="max-widt">

<div class="Layout"  style="max-width: 1260px;padding: 25px 60px;margin: 0 auto;">
  <div class="Layout-main ">
  <h1 class="f00-light">Developer visualisation setup</h1>
<br><br>

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
      <form method="POST" target="_blank" action="<?php echo $root; ?>/index.php" id="custom-request">
          <input type="hidden" name="visualisation" id="custom-visualisation" value=''>
          <button class="btn pointer" type="submit" value="Ready!">Ready!</button>&emsp;
      </form>

          <br><br>
          <div id="documentation"></div>
      </div>
  </div>
</div>


<script type="text/javascript">

    PredefinedShaderControlParameters.buildShadersAndControlsDocs("documentation");

    $(document).off('submit');

    $('#custom-request').submit(function(evt) {
        document.getElementById("custom-visualisation").value = $("#custom-params").val();
    });

</script>
</body>

</html>
