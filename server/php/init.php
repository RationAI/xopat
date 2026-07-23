<?php

/**
 * PHP server index entrypoint, parsing input data and compiling index.html page.
 * (server view: CORE is parsed EMV, app view: ENV is the default config)
 */

if (!defined( 'ABSPATH' )) {
    exit;
}

require_once ABSPATH . "server/php/inc/init.php";

if (!count($_POST)) {
    try {
        $_POST = (array)json_decode(file_get_contents("php://input"), false);
    } catch (Exception $e) {
        //pass not a valid input
        $_POST = (object)[];
    }
}

if (!isset($_POST)) {
    $_POST = (object)[];
}

global $PLUGINS, $MODULES, $CORE;
require_once PHP_INCLUDES . "core.php";

// todo try parsing params somehow and configuring from them
$locale = setupI18n(false, "en");
global $i18n;

//load plugins
require_once PHP_INCLUDES . "plugins.php";

function safeReadPostValue($val) {
    if (!is_string($val)) return $val;
    try {
        $parsed = json_decode($val);
        if ((bool)$val && $parsed != null) {
            return $parsed;
        }
    } catch (Exception $e) {
        return $val;
    }
}

// in PHP, forms are automatically decoded, so we get nested arrays already, just
// ensure we remove double-encoding
foreach ($_POST as $key=>&$value) {
    if (is_array($value)) {
        foreach ($value as $childKey=>$childValue) {
            $value[$childKey] = safeReadPostValue($childValue);
        }
    } else if (is_object($value)) {
        foreach ($value as $childKey=>$childValue) {
            $value->{$childKey} = safeReadPostValue($childValue);
        }
    } else {
        $_POST[$key] = safeReadPostValue($value);
    }
}

//todo consider parsing at least plugins and loading active items -> the 'compile time element load' - otherwise fetched dynamically
//$bypassCookies = isBoolFlagInObject($parsedParams->params, "bypassCookies");
//
//$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
//

//ensureDefined($_POST, "params", {});
//ensureDefined($_POST, "data", []);
//ensureDefined($_POST, "background", []);
//ensureDefined($_POST, "plugins", {});

$CORE["server"]["name"] = "php";
$CORE["server"]["supportsPost"] = true;
$CORE["server"]["devMode"] = false; // todo: support dev mode from env/args

// i18next init config. In production, module/plugin locale bundles are baked in
// so the client's loadLocale() short-circuits on hasResourceBundle(locale, id)
// instead of fetching one file per element at boot (namespace = element id,
// shape-equivalent to addResourceBundle). Must mirror the Node server's
// getI18NData() output shape (server/node/index.js).
$I18N_LANG = $i18n->getAppliedLang();
$I18N_RESOURCES = array($I18N_LANG => json_decode($i18n->getRawData(), true));
if ($CORE["client"]["production"]) {
    $bakeElementLocales = function ($records, $folder, $lang) use (&$I18N_RESOURCES) {
        if (!isset($I18N_RESOURCES[$lang])) $I18N_RESOURCES[$lang] = array();
        foreach ($records as $id => $record) {
            $dir = is_array($record) ? ($record["directory"] ?? null) : null;
            if (!$dir) continue;
            $file = ABSPATH . "$folder/$dir/locales/$lang.json";
            if (!file_exists($file)) continue;
            if (array_key_exists($id, $I18N_RESOURCES[$lang])) continue;
            $parsed = json_decode(file_get_contents($file), true);
            if ($parsed !== null) $I18N_RESOURCES[$lang][$id] = $parsed;
        }
    };
    $bakeElementLocales($MODULES, "modules", $I18N_LANG);
    $bakeElementLocales($PLUGINS, "plugins", $I18N_LANG);
    if ($I18N_LANG !== "en") {
        // English fallback bundles: i18next falls back per-namespace via
        // fallbackLng, which only works when the en bundle is registered.
        $bakeElementLocales($MODULES, "modules", "en");
        $bakeElementLocales($PLUGINS, "plugins", "en");
    }
}

// Scripting `.d.ts` bake — mirrors Node's getBakedDtsRegistry (server/node/index.js).
// Convention-scanned declaration files are inlined as `window.XOPAT_BAKED_DTS` so the
// client's fetchDtsCached (src/classes/scripting/dts-fetch.ts) resolves them without
// any request in production. Keys are app-relative paths; no API introspection —
// core `src/classes/scripting/*.scripts.d.ts` plus, per scanned element,
// `<dir>/scripting/*.d.ts` and `<dir>/*.scripts.d.ts`. Custom paths fall back to
// the client's cached fetch. Both servers must emit an identical shape.
$DTS_REGISTRY = array();
if ($CORE["client"]["production"]) {
    $dtsAddFile = function ($absPath, $relPath) use (&$DTS_REGISTRY) {
        if (!is_file($absPath) || filesize($absPath) > 262144) return;
        $text = file_get_contents($absPath);
        if ($text !== false) $DTS_REGISTRY[$relPath] = $text;
    };
    foreach ((glob(ABSPATH . "src/classes/scripting/*.scripts.d.ts") ?: array()) as $f) {
        $dtsAddFile($f, "src/classes/scripting/" . basename($f));
    }
    $dtsBakeElements = function ($records, $folder) use ($dtsAddFile) {
        foreach ($records as $id => $record) {
            $dir = is_array($record) ? ($record["directory"] ?? null) : null;
            if (!$dir) continue;
            foreach ((glob(ABSPATH . "$folder/$dir/scripting/*.d.ts") ?: array()) as $f) {
                $dtsAddFile($f, "$folder/$dir/scripting/" . basename($f));
            }
            foreach ((glob(ABSPATH . "$folder/$dir/*.scripts.d.ts") ?: array()) as $f) {
                $dtsAddFile($f, "$folder/$dir/" . basename($f));
            }
        }
    };
    $dtsBakeElements($MODULES, "modules");
    $dtsBakeElements($PLUGINS, "plugins");
}

$replacer = function($match) use ($i18n, $PLUGINS, $MODULES, $CORE, $I18N_LANG, $I18N_RESOURCES, $DTS_REGISTRY) {
    ob_start();

    switch ($match[1]) {
        case "branding":
            require_branding_head();
            break;

        case "head":
            require_openseadragon();
            require_libs();
            require_external();
            require_ui();
            require_core("loader");
            require_core("deps");
            require_core("app");
            require_core("env");
            echo "<script>window.XOPAT_CSRF_TOKEN = '{$_SESSION['csrf_token']}';</script>";
            break;

        case "app":
            //Todo think of secure way of sharing POST with the app
?>
    <script type="text/javascript">
        <?php if (count($DTS_REGISTRY)) { ?>window.XOPAT_BAKED_DTS = <?php echo json_encode((object)$DTS_REGISTRY, JSON_HEX_TAG | JSON_HEX_APOS); ?>;
        <?php } ?>initXOpat(
            <?php echo json_encode((object)$PLUGINS) ?>,
            <?php echo json_encode((object)$MODULES) ?>,
            <?php echo json_encode((object)$CORE) ?>,
            <?php echo json_encode($_POST); ?>,
            '<?php echo PLUGINS_FOLDER ?>',
            '<?php echo MODULES_FOLDER ?>',
            '<?php echo VERSION ?>',
            //i18next init config
            {
                resources: <?php echo json_encode((object)$I18N_RESOURCES) ?>,
                lng: '<?php echo $I18N_LANG ?>',
            }
        );
    </script><?php break;

        case "modules":
            require_modules($CORE["client"]["production"]);
            break;

        case "plugins":
            require_plugins($CORE["client"]["production"]);
            break;

        default:
            //todo some warn?
            break;
    }
    return ob_get_clean();
};

$template_file = ABSPATH . "server/templates/index.html";
if (!file_exists($template_file)) {
    throwFatalErrorIf(true, "error.unknown", "error.noDetails",
        "File not found: " . ABSPATH . "server/templates/index.html");
}
echo preg_replace_callback(HTML_TEMPLATE_REGEX, $replacer, file_get_contents($template_file));
