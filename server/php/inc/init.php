<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

//Absolute Root Path to the php server
define('PHP_INCLUDES', ABSPATH . 'server/php/inc/');
define('VIEWER_SOURCES_ABS_ROOT', ABSPATH . 'src/');
define('ABS_MODULES', ABSPATH . 'modules/');
define('ABS_PLUGINS', ABSPATH . 'plugins/');

//Relative Paths For the Viewer
defined('PROJECT_ROOT') || define('PROJECT_ROOT', "");
define('PROJECT_SOURCES', PROJECT_ROOT . 'src/');
define('EXTERNAL_SOURCES', PROJECT_SOURCES . 'external/');
define('UI_SOURCES', PROJECT_ROOT . 'ui/');
define('LIBS_ROOT', PROJECT_SOURCES . 'libs/');
define('ASSETS_ROOT', PROJECT_SOURCES . 'assets/');
define('LOCALES_ROOT', PROJECT_SOURCES . 'locales/');
define('MODULES_FOLDER', PROJECT_ROOT . 'modules/');
define('PLUGINS_FOLDER', PROJECT_ROOT . 'plugins/');

if (!defined('DISABLE_PERMA_LOAD')) {
    define('ENABLE_PERMA_LOAD', true);
}

define('HTML_TEMPLATE_REGEX', "/<template\s+id=\"template-([a-zA-Z0-9-_]+)\">\s*<\/template>/");

//fallback for php 7.1
if (!function_exists("array_is_list")) {
    function array_is_list(array $array): bool
    {
        $i = -1;
        foreach ($array as $k => $v) {
            ++$i;
            if ($k !== $i) {
                return false;
            }
        }
        return true;
    }
}

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function getAppParam($key, $default=false) {
    return hasKey($_POST, $key) ? $_POST[$key] : (hasKey($_GET, $key) ? $_GET[$key] : $default);
}


function isBoolFlagInObject($object, $key) {
    if (!isset($object->$key)) return false;
    $v = $object->$key;
    return (gettype($v) === "string" && $v !== "" && $v !== "false") || $v;
}

function ensureDefined($object, $property, $default) {
    if (!isset($object->{$property})) {
        $object->{$property} = $default;
        return false;
    }
    $prop_type = gettype($object->{$property});
    $def_type = gettype($default);
    if ($def_type !== $prop_type) {
        if ($def_type === "object") {
            $object->{$property} = ((object)$object->{$property});
        } else if ($def_type === "array") {
            $object->{$property} = ((array)$object->{$property});
        } // todo else: incompatible type :/
    }
    return true;
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        require_once(PHP_INCLUDES . "error.php");
        try {
            show_error($title, $description, $details, $_GET["lang"] ?? 'en');
            exit;
        } catch (Throwable $e) {
            throwFatalErrorIfFallback(true, $title, $description, $details);
        }
    }
    return $condition;
}

set_exception_handler(function (Throwable $exception) {
    global $i18n;
    try {
        if (!isset($i18n)) {
            require_once ABSPATH . "server/php/inc/i18m.class.php";
            $i18n = i18n_mock::default($_GET["lang"] ?? "en", LOCALES_ROOT);
        }
        throwFatalErrorIf(true, "error.unknown", "",$exception->getMessage() .
            " in " . $exception->getFile() . " line " . $exception->getLine() .
            "<br>" . $exception->getTraceAsString());
    } catch (Throwable $e) {
        print_r($e);
    }
});

function setupI18n($debugMode, $fallbackLocale) {
    global $i18n;
    $locale = $_GET["lang"] ?? ($fallbackLocale ?? "en");
    //now we can translate - translation known
    require_once PHP_INCLUDES . 'i18n.class.php';
    i18n::$debug = $debugMode;
    $i18n = i18n::default($locale, LOCALES_ROOT);
    return $locale;
}

if (! function_exists('str_ends_with')) {
    function str_ends_with(string $haystack, string $needle): bool
    {
        $needle_len = strlen($needle);
        return ($needle_len === 0 || 0 === substr_compare($haystack, $needle, - $needle_len));
    }
}
if (! function_exists('str_starts_with')) {
    function str_starts_with($haystack, $needle) {
        return (string)$needle !== '' && strncmp($haystack, $needle, strlen($needle)) === 0;
    }
}

// ── Security headers ─────────────────────────────────────────────────────────
//
// Parity with applySecurityHeaders() in server/node/index.js. The PHP renderer
// is a supported deployment and shipped NO security headers at all: no nosniff
// (so a text/plain error body could be sniffed as HTML on the viewer's own
// origin, next to XOPAT_CSRF_TOKEN), no framing policy, no referrer policy.
//
// Split in two because the second half needs the parsed deployment config:
//   - baseline: no config required, emitted from inc/init.php for EVERY
//     entrypoint including the proxy;
//   - configured: `core.server.security` (frameAncestors / frameOptions /
//     hstsMaxAge / csp / corp), emitted from inc/core.php once CORE exists.

/** Emitted once per request, before any output. */
function xo_apply_baseline_security_headers() {
    if (headers_sent() || defined('XO_BASELINE_SECURITY_HEADERS_SENT')) return;
    define('XO_BASELINE_SECURITY_HEADERS_SENT', true);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Permitted-Cross-Domain-Policies: none');
    // Replaced by the configured pass when the deployment declares an embedder
    // allowlist (the two contradict, and browsers honouring both take the
    // stricter one, which would silently kill the allowlist).
    header('X-Frame-Options: SAMEORIGIN');
}

/**
 * Sanitize one CSP source expression. The value reaches a response header, so
 * anything that could carry ';' (a new directive) or a newline (a new header) is
 * dropped rather than escaped. Mirrors normalizeFrameAncestors() in Node.
 */
function xo_normalize_frame_ancestors($value) {
    if ($value === true) return array('*');
    if (!$value) return null;
    $list = is_array($value) ? $value : preg_split('/[\s,]+/', (string)$value);
    $out = array();
    foreach ($list as $raw) {
        if (!is_string($raw)) continue;
        $token = trim($raw);
        if ($token === '' || strlen($token) > 253) continue;
        if (!preg_match('/^(\*|\'self\'|\'none\'|[A-Za-z0-9.:\/*\-_\[\]]+)$/', $token)) {
            error_log("[security] ignoring malformed frameAncestors entry: $token");
            continue;
        }
        $out[] = $token;
    }
    return count($out) ? $out : null;
}

/** Emitted once CORE is parsed; safe to call repeatedly. */
function xo_apply_configured_security_headers() {
    global $CORE;
    if (headers_sent() || defined('XO_CONFIGURED_SECURITY_HEADERS_SENT')) return;
    define('XO_CONFIGURED_SECURITY_HEADERS_SENT', true);

    $sec = $CORE['server']['security'] ?? null;
    if (!is_array($sec)) $sec = array();

    $frameAncestors = array_key_exists('frameAncestors', $sec)
        ? xo_normalize_frame_ancestors($sec['frameAncestors']) : null;

    if (array_key_exists('frameOptions', $sec)) {
        if ($sec['frameOptions']) header('X-Frame-Options: ' . (string)$sec['frameOptions']);
        else header_remove('X-Frame-Options');
    } elseif ($frameAncestors) {
        // The operator named who may frame us; the legacy header cannot express
        // that and would only override the allowlist with "same origin".
        header_remove('X-Frame-Options');
    }

    // Two policies, deliberately. `security.csp` is report-only by default (the
    // page's inline scripts are not nonce'd), while the framing allowlist has to
    // be ENFORCED to mean anything — a report-only frame-ancestors restricts
    // nothing. CSP intersects across headers, so shipping them apart never
    // loosens either.
    $cspReportOnly = ($sec['cspReportOnly'] ?? true) !== false;
    $csp = (isset($sec['csp']) && is_string($sec['csp']) && trim($sec['csp']) !== '') ? trim($sec['csp']) : null;

    $policies = array();
    if ($frameAncestors) $policies[] = 'frame-ancestors ' . implode(' ', $frameAncestors);
    if ($csp && !$cspReportOnly) $policies[] = $csp;
    if (count($policies)) header('Content-Security-Policy: ' . implode('; ', $policies));
    if ($csp && $cspReportOnly) header('Content-Security-Policy-Report-Only: ' . $csp);

    $corp = (isset($sec['corp']) && is_string($sec['corp']) && trim($sec['corp']) !== '') ? trim($sec['corp']) : null;
    // An embedder running under COEP: require-corp cannot load a frame that does
    // not opt in. Harmless otherwise — CORP only ever relaxes.
    if (!$corp && $frameAncestors) $corp = 'cross-origin';
    if ($corp) header('Cross-Origin-Resource-Policy: ' . $corp);

    // Only over TLS: HSTS on a plain-HTTP dev server pins the developer's
    // browser to https for months after the server is gone.
    $hsts = array_key_exists('hstsMaxAge', $sec) ? (int)$sec['hstsMaxAge'] : 15552000;
    $forwardedProto = strtolower(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')[0]);
    $isSecure = $forwardedProto === 'https'
        || (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off');
    if ($isSecure && $hsts > 0) header("Strict-Transport-Security: max-age=$hsts");
}

/**
 * `/dev_setup` and `/scheme*` publish the deployment's own shape — every
 * plugin's include.json merged with its ENV block, plus the raw text of
 * src/types/*.d.ts. A development aid, gratuitous disclosure in production.
 *
 * Parity with EXPOSE_SCHEME_ROUTES in Node: dev mode enables them, and
 * `core.server.exposeSchemeRoutes: true` is the explicit production opt-in.
 * The PHP renderer has no dev mode yet (init.php pins server.devMode = false),
 * so today only the explicit opt-in unlocks them — which is the safe default.
 */
function xo_scheme_routes_exposed() {
    global $CORE;
    if (($CORE['server']['exposeSchemeRoutes'] ?? false) === true) return true;
    return ($CORE['server']['devMode'] ?? false) === true;
}

/** 404 and stop unless the deployment opted the introspection routes in. */
function xo_require_scheme_routes_exposed() {
    if (xo_scheme_routes_exposed()) return;
    header("HTTP/1.1 404 Not Found");
    header('Content-Type: text/plain; charset=utf-8');
    exit;
}

xo_apply_baseline_security_headers();
