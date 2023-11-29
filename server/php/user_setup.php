<?php
/**
 *  TODO Describe how to use this
 *  const theWindow = window.open(this.interactiveShaderConfigUrl, 'config', "height=550,width=850"),
        theDoc = theWindow.document;
    const _this = this;
    theWindow.onload = function () {
        theWindow.runConfigurator(config => {
            //do something with the configuration object the user has created
            theWindow.close();
        });
    };
 */
if (!defined( 'ABSPATH' )) {
    define( 'ABSPATH', dirname(__DIR__, 2) . '/' );
}
include_once ABSPATH . "server/php/inc/core.php";

?>

<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="utf-8">
    <title>Visualisation Developer Setup</title>

    <?php require_core("env"); ?>
    <?php require_lib("primer"); ?>
    <?php require_lib("jquery"); ?>
    <?php require_core("loader"); ?>
    <?php require_core("deps"); ?>

    <script>
        var OpenSeadragon = {};
    </script>

    <?php

    include_once(PHP_INCLUDES . "plugins.php");
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
            ShaderConfigurator.runShaderAndControlSelector("container", x => callback(x));
        },'webgl');

        window.runConfigurator = function(clbck) {
            callback = clbck;
        };
    })(window);
</script>
</body>
</html>
