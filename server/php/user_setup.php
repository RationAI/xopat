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

//disable autoload on pages that use custom modules
define('ENABLE_PERMA_LOAD', false);
require_once ABSPATH . "server/php/inc/init.php";
$locale = setupI18n(false, "en");

include_once ABSPATH . "server/php/inc/core.php";

// Same class of route as /dev_setup and /scheme*: it renders the deployment's
// full CORE + PLUGINS + MODULES records into a page. Gated the same way.
xo_require_scheme_routes_exposed();

// JSON_HEX_TAG on every value interpolated into a <script> body. These are
// operator-controlled today, but the invariant is "nothing reaches a script body
// unescaped" — a per-value judgement call is what decays. Mirrors $SCRIPT_JSON
// in server/php/init.php and jsonForScript() in server/node/index.js.
$SCRIPT_JSON = JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT;

?>

<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="utf-8">
    <title>Visualization Developer Setup</title>

    <?php require_core("env"); ?>
    <?php require_lib("primer"); ?>
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
            <?php echo json_encode((object)$CORE, $SCRIPT_JSON) ?>,
            <?php echo json_encode((object)$PLUGINS, $SCRIPT_JSON) ?>,
            <?php echo json_encode((object)$MODULES, $SCRIPT_JSON) ?>,
            <?php echo json_encode(PLUGINS_FOLDER, $SCRIPT_JSON) ?>,
            <?php echo json_encode(MODULES_FOLDER, $SCRIPT_JSON) ?>,
            <?php echo json_encode(VERSION, $SCRIPT_JSON) ?>);
        runLoader();

        window.runConfigurator = function(clbck) {
            callback = clbck;
        };
    })(window);
</script>
</body>
</html>
