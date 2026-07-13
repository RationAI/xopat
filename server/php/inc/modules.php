<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

global $MODULES;
$MODULES = array();

// Modules only participate in the "available" config-gate. The "whitelist"
// mode is a plugin concept (modules are infrastructure pulled in by plugins;
// dropping a required module surfaces as a plugin-level missing-dep error via
// the existing dependency check).

include_once PHP_INCLUDES . "comments.class.php";
use Ahc\Json\Comment;

/**
 * Resolve a dot-path inside an element's own (merged) record. Returns null
 * when any path segment is missing. Used by the "available" plugin-selection
 * mode to test whether all `requiredConfig` paths are populated.
 */
function xopat_required_config_value(array $data, string $path) {
    $segments = explode('.', $path);
    $cursor = $data;
    foreach ($segments as $segment) {
        if (is_array($cursor) && array_key_exists($segment, $cursor)) {
            $cursor = $cursor[$segment];
        } else {
            return null;
        }
    }
    return $cursor;
}

/**
 * "Configured" means present and not undefined/null/empty-string. Booleans
 * `false` and the number `0` count as configured (intentional choices).
 */
function xopat_required_config_is_set($value): bool {
    if ($value === null) return false;
    if (is_string($value) && $value === '') return false;
    return true;
}

/**
 * True iff every dot-path in $paths resolves to a configured value in at
 * least one of the supplied $records (variadic). A non-array / missing
 * $paths list is treated as no gate (returns true). With no records, a
 * non-empty $paths list returns false.
 *
 * Records are the deployment-supplied source-of-truth for the gate:
 *   - first record: pre-merge ENV block ($ENV['plugins'][$id] / $ENV['modules'][$id]).
 *   - second record: preserved server-secure block
 *     ($GLOBALS['CORE_SECURE']['plugins'][$id] / ...['modules'][$id]) — set
 *     by core.php before the strip. Pass an empty array when the secure
 *     block is unavailable; the gate then degrades to ENV-only.
 *
 * Include.json defaults are intentionally NOT consulted — the merged
 * record is never passed in.
 */
function xopat_required_config_satisfied($paths, ...$records): bool {
    if (!is_array($paths)) return true;
    foreach ($paths as $reqPath) {
        if (!is_string($reqPath) || $reqPath === '') continue;
        $satisfied = false;
        foreach ($records as $rec) {
            if (!is_array($rec)) continue;
            $resolved = xopat_required_config_value($rec, $reqPath);
            if (xopat_required_config_is_set($resolved)) {
                $satisfied = true;
                break;
            }
        }
        if (!$satisfied) return false;
    }
    return true;
}

/**
 * Resolve the active `pluginSelectionMode` from $CORE['client']. Falls back
 * to "all" for unset/invalid values and warns once. Shared between
 * modules.php and plugins.php.
 */
function xopat_resolve_plugin_selection_mode(): string {
    global $CORE;
    $valid = ['all', 'whitelist', 'available'];
    if (is_array($CORE) && isset($CORE['client']) && is_array($CORE['client'])
        && isset($CORE['client']['pluginSelectionMode'])
        && is_string($CORE['client']['pluginSelectionMode'])) {
        $mode = $CORE['client']['pluginSelectionMode'];
        if (in_array($mode, $valid, true)) return $mode;
        trigger_error("Unknown pluginSelectionMode '{$mode}' - falling back to 'all'.", E_USER_WARNING);
    }
    return 'all';
}

/**
 * Expands glob patterns within an array of includes.
 * @param string $basePath The absolute path to the module/plugin directory.
 * @param array $includes The includes array from the JSON config.
 * @return array The expanded includes array.
 */
function expand_include_globs($basePath, $includes) {
    $expanded = [];
    foreach ($includes as $file) {
        // We only support globs on string entries
        if (is_string($file) && (str_contains($file, '*') || str_contains($file, '?'))) {
            $matches = glob($basePath . $file, GLOB_BRACE);
            if ($matches) {
                foreach ($matches as $fullPath) {
                    // Convert absolute path back to relative path for the include
                    $expanded[] = str_replace($basePath, '', $fullPath);
                }
            }
        } else {
            $expanded[] = $file;
        }
    }
    return $expanded;
}

/** True when the deployment client config requests production (minified) serving. */
function xopat_is_production(): bool {
    global $CORE;
    return is_array($CORE) && !empty($CORE['client']['production']);
}

/**
 * Classify a single includes[] entry: "classic" (local .js → index.min.js),
 * "module" (.mjs → index.min.mjs) or "separate" (remote / .min.js / object-form
 * / `bundle:false`). Mirrors classifyIncludeKind in the Node template.
 */
function xopat_include_kind($entry): string {
    if (is_string($entry)) {
        if (preg_match('#^https?://#', $entry)) return 'separate';
        if (str_ends_with($entry, '.mjs')) return 'module';
        if (str_ends_with($entry, '.min.js')) return 'separate';
        if (str_ends_with($entry, '.js')) return 'classic';
        return 'separate';
    }
    return 'separate';
}

/**
 * Compute the optional production `prodIncludes` overlay, leaving canonical
 * `includes` untouched. Mirrors buildProdIncludes in the Node template: classic
 * `.js` collapse into index.min.js, `.mjs` modules into index.min.mjs, each used
 * only if its artifact exists; "separate" entries stay in place.
 */
function xopat_build_prod_includes($full_path, &$data, $production) {
    if (!$production || !is_array($data)) return;
    if (!isset($data['includes']) || !is_array($data['includes']) || count($data['includes']) === 0) return;
    $includes = array_values($data['includes']);

    $wsEntry = $includes[0];
    if ($wsEntry === 'index.workspace.js') {
        if (!file_exists($full_path . 'index.workspace.min.js')) return;
        $data['prodIncludes'] = array_merge(['index.workspace.min.js'], array_slice($includes, 1));
        return;
    }
    // .mjs workspace bundles / `main` entries can't be a classic min file.
    if (is_string($wsEntry) && str_starts_with($wsEntry, 'index.workspace.')) return;

    $hasClassic = false; $hasModule = false;
    foreach ($includes as $e) {
        $k = xopat_include_kind($e);
        if ($k === 'classic') $hasClassic = true;
        else if ($k === 'module') $hasModule = true;
    }
    $classicOk = $hasClassic && file_exists($full_path . 'index.min.js');
    $moduleOk  = $hasModule  && file_exists($full_path . 'index.min.mjs');
    if (!$classicOk && !$moduleOk) return;

    $result = [];
    $classicPlaced = false; $modulePlaced = false;
    foreach ($includes as $e) {
        $k = xopat_include_kind($e);
        if ($k === 'classic' && $classicOk) {
            if (!$classicPlaced) { $result[] = 'index.min.js'; $classicPlaced = true; }
        } else if ($k === 'module' && $moduleOk) {
            if (!$modulePlaced) { $result[] = 'index.min.mjs'; $modulePlaced = true; }
        } else {
            $result[] = $e;
        }
    }
    $data['prodIncludes'] = $result;
}

$XOPAT_MODULE_SELECTION_MODE = xopat_resolve_plugin_selection_mode();

foreach (array_diff(scandir(ABS_MODULES), array('..', '.')) as $_=>$dir) {
    $full_path = ABS_MODULES . "$dir/";
    $interface = $full_path . "include.json";

    try {
        // Base data from include.json (if present)
        $data = NULL;
        if (file_exists($interface)) {
            $data = (new Comment)->decode(file_get_contents($interface), true);
        }

        $workspace = $full_path . 'package.json';
        if (file_exists($workspace)) {
            $packageData = (new Comment)->decode(file_get_contents($workspace), true);

            // Default entry points
            $has_js = file_exists($full_path . 'index.workspace.js');
            $has_mjs = file_exists($full_path . 'index.workspace.mjs');

            // Logic: Default JS -> Default MJS -> Package 'main'
            $workspaceEntry = null;
            if ($has_js) {
                $workspaceEntry = 'index.workspace.js';
            } else if ($has_mjs) {
                $workspaceEntry = 'index.workspace.mjs';
            } else if (isset($packageData['main'])) {
                $workspaceEntry = $packageData['main'];
            }

            if ($workspaceEntry) {
                if (!isset($data['includes']) || !is_array($data['includes'])) {
                    $data['includes'] = [];
                }
                // Avoid duplicate includes if 'main' is already there
                if (!in_array($workspaceEntry, $data['includes'])) {
                    array_unshift($data['includes'], $workspaceEntry);
                }
            } else {
                error_log("Module $full_path has package.json but no valid entry point found (index.workspace or main)!");
            }

            $data['includes'] = expand_include_globs($full_path, $data['includes']);

            // Fill missing fields from package.json
            if (!isset($data['id']) || $data['id'] === '' ) {
                if (isset($packageData['name'])) $data['id'] = $packageData['name'];
            }
            if (!isset($data['name']) || $data['name'] === '' ) {
                if (isset($packageData['name'])) $data['name'] = $packageData['name'];
            }
            if (!isset($data['author']) || $data['author'] === '' ) {
                if (isset($packageData['author'])) $data['author'] = $packageData['author'];
            }
            if (!isset($data['version']) || $data['version'] === '' ) {
                if (isset($packageData['version'])) $data['version'] = $packageData['version'];
            }
            if (!isset($data['description']) || $data['description'] === '' ) {
                if (isset($packageData['description'])) $data['description'] = $packageData['description'];
            }
        }

        if (!empty($data) && is_array($data)) {
            $data["directory"] = $dir;
            $data["path"] = MODULES_FOLDER . "$dir/";
            $data["loaded"] = false;
            if (file_exists($full_path . "style.css")) {
                $data["styleSheet"] = $data["path"] . "style.css";
            }

            if (!isset($data['requires']) || !is_array($data['requires'])) {
                $data['requires'] = [];
            }

            // Author server manifest (server.json) — optional. See plugins.php
            // for full semantics. Mirrors `requiredConfig` hoist + author-secure
            // stash for modules.
            $serverManifestPath = $full_path . "server.json";
            if (file_exists($serverManifestPath)) {
                $serverManifest = (new Comment)->decode(file_get_contents($serverManifestPath), true);
                if (is_array($serverManifest)) {
                    if (isset($serverManifest['requiredConfig']) && is_array($serverManifest['requiredConfig'])) {
                        $existing = (isset($data['requiredConfig']) && is_array($data['requiredConfig']))
                            ? $data['requiredConfig'] : [];
                        $data['requiredConfig'] = array_values(array_unique(
                            array_merge($existing, $serverManifest['requiredConfig'])));
                    }
                    $authorSecure = $serverManifest;
                    unset($authorSecure['requiredConfig']);
                    if (!empty($authorSecure) && !empty($data['id'])) {
                        $GLOBALS['CORE_AUTHOR_SECURE']['modules'][$data['id']] = $authorSecure;
                    }
                }
            }

            // Pre-merge captures: deployment-ENV module block AND preserved
            // server-secure module block. Include.json defaults must NOT
            // pollute the gate input. The secure block is read from the
            // pre-strip backup in $GLOBALS['CORE_SECURE'] (set by core.php)
            // — $CORE['server']['secure'] is already gone by this point.
            $envBlock = [];
            $secBlock = [];
            try {
                global $ENV, $MODULES;
                if (is_array($ENV)) {
                    if (!isset($ENV["modules"]) || !is_array($ENV["modules"])) $ENV["modules"] = [];
                    $ENV_MOD = $ENV["modules"];

                    if (isset($ENV_MOD[$data["id"]]) && is_array($ENV_MOD[$data["id"]])) {
                        $envBlock = $ENV_MOD[$data["id"]];
                        $data = array_merge_recursive_distinct($data, $envBlock);
                    }

                    if (isset($GLOBALS['CORE_SECURE']['modules'][$data["id"]])
                        && is_array($GLOBALS['CORE_SECURE']['modules'][$data["id"]])) {
                        $secBlock = $GLOBALS['CORE_SECURE']['modules'][$data["id"]];
                    }

                    if (ENABLE_PERMA_LOAD && isset($data["permaLoad"]) && $data["permaLoad"]) {
                        $data["loaded"] = true;
                    }
                } else {
                    trigger_error("Env setup for module failed: invalid \$ENV! Was CORE included?", E_USER_WARNING);
                }
            } catch (Exception $e) {
                trigger_error($e, E_USER_WARNING);
            }

            $enabledNotFalse = !isset($data["enabled"]) || $data["enabled"] != false;
            $configSatisfied = $XOPAT_MODULE_SELECTION_MODE !== 'available'
                || xopat_required_config_satisfied($data["requiredConfig"] ?? null, $envBlock, $secBlock);
            if ($enabledNotFalse && $configSatisfied) {
                // Precompute the production single-file overlay (leaves
                // `includes` canonical); see xopat_build_prod_includes.
                xopat_build_prod_includes($full_path, $data, xopat_is_production());
                $MODULES[$data["id"]] = $data;
            }
        }
    } catch (Exception $e) {
            // todo only log error, do not shut down everything
        trigger_error("Module $full_path has invalid configuration file and cannot be loaded!", E_USER_WARNING);
    }
}

$order = 0;
//DFS assigns smaller numbers to children -> loaded earlier
function scanDependencies(&$itemList, $id, $contextName) {
    global $i18n;
    $item = &$itemList[$id];
    global $order;

    if (isset($item["_xoi"])) return $item["_xoi"] > 0;
    $item["_xoi"] = -1;

    $valid = true;
    foreach ($item["requires"] as $dependency) {
        $dep = $itemList[$dependency];
        if (!isset($dep)) {
            $item["error"] = $i18n->t('php.invalidDeps',
                array("context" => $contextName, "dependency" => $dependency));
            return false;
        }

        if (isset($dep["error"])) {
            $item["error"] = $i18n->t('php.transitiveInvalidDeps',
                array("context" => $contextName, "dependency" => $dependency, "transitive" => $dependency));
            return false;
        }

        if (!isset($dep["_xoi"])) {
            $valid &= scanDependencies($itemList, $dependency, $contextName);
        } else if ($dep["_xoi"] == -1) {
            $item["error"] = $i18n->t('php.cyclicDeps',
                array("context" => $contextName, "dependency" => $dependency));
            return false;
        }
    }
    $item["_xoi"] = $order++;
    if (!$valid) {
        $item["error"] = $i18n->t('php.removedInvalidDeps',
            array("dependencies" => implode(", ", $item["requires"])));
    }
    return $valid;
}

//make sure all modules required by other modules are loaded, goes in acyclic deps list - everything gets loaded
function resolveDependencies(&$itemList) {
    foreach ($itemList as $_ => $mod){
        if ($mod["loaded"]) {
            foreach ($mod["requires"] as $__ => $requirement) {
                $itemList[$requirement]["loaded"] = true;
            }
        }
    }
}

function getAttributes($source, $properties) {
    $html = "";
    foreach ($properties as $property => $propScriptName) {
        if (isset($source[$property])) {
            $val = $source[$property];
            // Add type='module' automatically if src ends with .mjs and no explicit type is set
            if ($property === 'src' && str_ends_with($val, '.mjs') && empty($source['type'])) {
                $html .= " type=\"module\"";
            }
            $html .= " $propScriptName=\"" . htmlspecialchars($val, ENT_QUOTES) . "\"";
        }
    }
    return $html;
}

/**
 * Print module or plugin dependency based on its parsed configuration
 * @param $directory string parent context directory full path, ending with slash
 * @param $item object item to load
 * @param $production boolean whether to prefer minified files
 */
function printDependencies($directory, $item, $production) {
    $version = VERSION;
    //add module style sheet if exists
    if (isset($item["styleSheet"])) {
        echo "<link rel=\"stylesheet\" href=\"{$item["styleSheet"]}?v=$version\" type='text/css'>\n";
    }

    // In production the item may carry a precomputed `prodIncludes` overlay
    // (foldable files collapsed into index.min.js / index.workspace.min.js,
    // non-foldable entries kept in place). Fall back to canonical `includes`.
    $includesList = ($production && isset($item["prodIncludes"]) && is_array($item["prodIncludes"]))
        ? $item["prodIncludes"] : $item["includes"];

    foreach ($includesList as $__ => $file) {
        if (is_string($file)) {
            $path = "$directory{$item["directory"]}/$file?v=$version";
            if (str_ends_with($file, '.mjs')) {
                echo "    <script src=\"$path\" type=\"module\"></script>\n";
            } else {
                echo "    <script src=\"$path\"></script>\n";
            }
        } else if (is_array($file)) {
            if (isset($file['src']) && !preg_match('#^https?://#', $file['src'])) {
                $src = ltrim($file['src'], './');
                $file['src'] = "$directory{$item["directory"]}/$src?v=$version";
                if (str_ends_with($src, '.mjs') && empty($file['type'])) {
                    $file['type'] = 'module';
                }
            }
            echo "    <script" . getAttributes($file, array(
                    'async' => 'async', 'crossOrigin' => 'crossorigin', 'defer' => 'defer', 'type' => 'type',
                    'integrity' => 'integrity', 'referrerPolicy' => 'referrerpolicy', 'src' => 'src')) . "></script>";
        } else {
            $details = json_encode($file);
            echo "<script type='text/javascript'>console.warn('Invalid include', '{$item["id"]}', {$details});</script>";
        }
    }
}

//resolve dependencies
foreach ($MODULES as $id=>$mod) {
    //scan only if priority not set (not visited yet)

    if (!isset($mod["_xoi"])) {
        scanDependencies($MODULES, $id, 'modules');
    }
}

uasort($MODULES, function($a, $b) {
    //ascending
    return $a["_priority"] - $b["_priority"];
});

?>
