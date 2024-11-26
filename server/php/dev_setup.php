<?php

if (!defined( 'ABSPATH' )) {
    define( 'ABSPATH', dirname(__DIR__, 2) . '/' );
}

//disable autoload on pages that use custom modules
define('ENABLE_PERMA_LOAD', false);
require_once ABSPATH . "server/php/inc/init.php";
$locale = setupI18n(false, "en");
global $i18n;

include_once ABSPATH . "server/php/inc/core.php";

$replacer = function($match) use ($i18n) {
    ob_start();

    // Temporary, we also load opensedragon in case some modules got loaded too,
    // When renderer becomes part of OSD, remove requireModules && requireOpenseadragon
    switch ($match[1]) {
        case "head":
            require_lib("primer");
            require_lib("jquery");
            require_core("env");
            require_core("deps");
            require_openseadragon();

            include_once(PHP_INCLUDES . "plugins.php");
            global $MODULES;
            $MODULES["webgl"]["loaded"] = true;
            require_modules(true);
            break;

        case "form-init":
            global $CORE;
            $viewer_root = $CORE["client"]["domain"] . $CORE["client"]["path"];
            echo <<<EOF
    <script type="text/javascript">
    window.formInit = {
        location: "$viewer_root",
        lang: {
            ready: "Ready!"
        }
    }
    </script>
EOF;
            break;

        default:
            //todo some warn?
            break;
    }
    return ob_get_clean();
};

$template_file = ABSPATH . "server/templates/dev-setup.html";
if (!file_exists($template_file)) {
    throwFatalErrorIf(true, "error.unknown", "error.noDetails",
        "File not found: " . ABSPATH . "server/templates/dev-setup.html");
}
echo preg_replace_callback(HTML_TEMPLATE_REGEX, $replacer, file_get_contents($template_file));
?>
