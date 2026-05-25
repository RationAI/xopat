<?php

if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__DIR__, 2) . '/');
}

define('ENABLE_PERMA_LOAD', false);
require_once ABSPATH . "server/php/inc/init.php";
$locale = setupI18n(false, "en");
global $i18n;

include_once ABSPATH . "server/php/inc/core.php";
include_once ABSPATH . "server/php/inc/plugins.php";

function normalize_scheme_plugin_records(array $plugins): array
{
    $result = [];
    $manifestKeys = array_flip([
        'id', 'name', 'author', 'version', 'description', 'icon',
        'includes', 'modules', 'requires', 'permaLoad', 'enabled',
        'loaded', 'error', 'directory', 'path', 'styleSheet',
        'requiredConfig'
    ]);

    foreach ($plugins as $id => $plugin) {
        if (!is_array($plugin)) {
            continue;
        }

        $meta = [];
        foreach ([
            'id', 'name', 'author', 'version', 'description', 'icon',
            'modules', 'requires', 'permaLoad', 'enabled', 'loaded',
            'directory', 'requiredConfig'
        ] as $key) {
            if (array_key_exists($key, $plugin)) {
                $meta[$key] = $plugin[$key];
            }
        }

        $defaults = [];
        foreach ($plugin as $key => $value) {
            if (!isset($manifestKeys[$key])) {
                $defaults[$key] = $value;
            }
        }

        $result[$id] = [
            "meta" => $meta,
            "defaults" => $defaults
        ];
    }

    return $result;
}

$pagePayload = [
    "viewer" => [
        "name" => $CORE["name"] ?? "xOpat",
        "version" => VERSION,
    ],
    "paramsDefaults" => $CORE["setup"] ?? [],
    "clientDefaults" => [
        // New slide-protocol registry (preferred).
        "slide_protocols" => $CORE["client"]["slide_protocols"] ?? null,
        "default_background_protocol" => $CORE["client"]["default_background_protocol"] ?? null,
        "default_visualization_protocol" => $CORE["client"]["default_visualization_protocol"] ?? null,
        // Legacy fields kept for one deprecation cycle. Auto-synthesized into
        // __legacy_bg / __legacy_viz registry entries client-side.
        "image_group_server" => $CORE["client"]["image_group_server"] ?? null,
        "image_group_protocol" => $CORE["client"]["image_group_protocol"] ?? null,
        "data_group_server" => $CORE["client"]["data_group_server"] ?? null,
        "data_group_protocol" => $CORE["client"]["data_group_protocol"] ?? null,
    ],
    "plugins" => normalize_scheme_plugin_records($PLUGINS ?? []),
    "typesSource" => file_get_contents(ABSPATH . "src/types/app.d.ts"),
    "configTypesSource" => file_get_contents(ABSPATH . "src/types/config.d.ts"),
];

$replacer = function ($match) use ($i18n, $pagePayload) {
    ob_start();

    switch ($match[1]) {
        case "head":
            require_openseadragon();
            require_libs();
            require_core("env");
            break;

        case "page-init":
            $payloadJson = json_encode($pagePayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            echo <<<EOF
    <script type="text/javascript">
    window.schemeInit = $payloadJson;
    </script>
EOF;
            break;

        case "shared-scheme-script":
            $scriptSource = file_get_contents(ABSPATH . "server/static/scheme.js");
            echo <<<EOF
    <script type="text/javascript">
$scriptSource
    </script>
EOF;
            break;

        default:
            break;
    }
    return ob_get_clean();
};

$templateName = isset($schemeTemplate) ? $schemeTemplate : "scheme.html";
$template_file = ABSPATH . "server/templates/" . $templateName;
if (!file_exists($template_file)) {
    throwFatalErrorIf(true, "error.unknown", "error.noDetails",
        "File not found: " . $template_file);
}
echo preg_replace_callback(HTML_TEMPLATE_REGEX, $replacer, file_get_contents($template_file));
?>
