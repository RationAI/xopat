<?php

if (!defined( 'ABSPATH' )) {
    define( 'ABSPATH', dirname(__DIR__, 2) . '/' );
}

//disable autoload on pages that use custom modules
define('ENABLE_PERMA_LOAD', false);
require_once ABSPATH . "server/php/inc/init.php";
$locale = setupI18n(false, "en");

include_once ABSPATH . "server/php/inc/core.php";
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation Developer Setup</title>

    <?php require_lib("primer"); ?>
    <?php require_lib("jquery"); ?>
    <?php require_core("env"); ?>
    <?php require_core("deps"); ?>

    <script>
        var OpenSeadragon = {};
    </script>

    <?php

    include_once(PHP_INCLUDES . "plugins.php");

    $webglPath = "";
    $version = VERSION;

    $MODULES["webgl"]["loaded"] = true;
    require_modules();

    $root = PROJECT_ROOT;

    ?>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">

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
      <form method="POST" target="_blank" action="<?php echo PROJECT_ROOT ?>index.php" id="custom-request">
          <input type="hidden" name="visualisation" id="custom-visualisation" value=''>
          <button class="btn pointer" type="submit" value="Ready!">Ready!</button>&emsp;
      </form>

          <br><br>
          <div id="documentation"></div>
      </div>
  </div>
</div>


<script type="text/javascript">

    ShaderConfigurator.buildShadersAndControlsDocs("documentation");

    $(document).off('submit');

    $('#custom-request').on('submit', evt => {
        document.getElementById("custom-visualisation").value = $("#custom-params").val();
    });

</script>
</body>

</html>
