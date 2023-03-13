<?php
/**
 * TODO Describe how to use this
 */
require_once "src/core.php";

?>

<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="utf-8">
    <title>Visualisation Developer Setup</title>

    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>primer_css.css">
    <script src="<?php echo PROJECT_SOURCES; ?>loader.js"></script>
    <script src="<?php echo PROJECT_SOURCES; ?>shader_input_gui.js"></script>
    <script src="<?php echo PROJECT_SOURCES; ?>ui_components.js"></script>

    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
    <script>
        var OpenSeadragon = {};
    </script>

    <?php

    include_once(PROJECT_SOURCES . "plugins.php");
    global $PLUGINS, $MODULES;
    resolveDependencies($MODULES);
    ?>
</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">
<div class="Layout" style="max-width: 1260px;padding: 25px 60px;margin: 0 auto;">
    <div class="Layout-main ">

        <h1 class="f00-light">Setup</h1>

        <div id="container"></div>
    </div>
</div>

<script>
    (function(w) {
        var callback = w.console;
        const runLoader = initXOpatLoader(
            <?php echo json_encode($PLUGINS) ?>,
            <?php echo json_encode($MODULES) ?>,
            '<?php echo PLUGINS_FOLDER ?>',
            '<?php echo MODULES_FOLDER ?>',
            '<?php echo VERSION ?>');
        runLoader();

        UTILITIES.loadModules(()=>{
            PredefinedShaderControlParameters.runShaderAndControlSelector("container", x => callback(x));
        },'webgl');

        window.runConfigurator = function(clbck) {
            callback = clbck;
        };
    })(window);
</script>
</body>
</html>
