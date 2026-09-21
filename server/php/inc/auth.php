<?php
if (!defined('ABSPATH')) exit;

/**
 * Registry of proxy auth verifiers.
 */
$PROXY_AUTH_VERIFIERS = [];

function registerProxyAuthVerifier($name, $fn) {
    global $PROXY_AUTH_VERIFIERS;
    $PROXY_AUTH_VERIFIERS[$name] = $fn;
}

/**
 * Whether verifyProxyAuth() will actually run a verifier for this alias.
 * Mirrors proxyAuthIsEnforced() in server/node/auth.js.
 */
function proxyAuthIsEnforced($proxyConfig) {
    $authCfg = $proxyConfig['auth'] ?? null;
    if (!$authCfg || ($authCfg['enabled'] ?? true) === false) return false;
    return !empty($authCfg['verifiers'] ?? []);
}

/**
 * Whether this alias injects operator secrets (API keys) upstream.
 */
function proxyCarriesOperatorCredentials($proxyConfig) {
    $headers = $proxyConfig['headers'] ?? null;
    return is_array($headers) && count($headers) > 0;
}

/**
 * Whether `$_SESSION['allowed_proxies']` permits this alias.
 *
 * Missing / 'ALL' means unrestricted — sessions are minted anonymously, so
 * narrowing is opt-in and no existing deployment changes behaviour. An auth
 * integration narrows it on a completed login by assigning an array (or 'NONE').
 * Mirrors proxyAliasAllowedForSession() in server/node/auth.js, including the
 * deny-on-unknown-shape rule: a restriction we cannot read is still a restriction.
 */
function proxyAliasAllowedForSession($alias) {
    $allowed = $_SESSION['allowed_proxies'] ?? 'ALL';
    if ($allowed === null || $allowed === 'ALL') return true;
    if ($allowed === 'NONE') return false;
    if (is_array($allowed)) return in_array($alias, $allowed, true);
    return false;
}

/**
 * Refuse a credential-bearing alias that enforces no authentication.
 *
 * Session + CSRF proves same-origin, not authorization: a session is minted to any
 * anonymous page load and the CSRF token is rendered into that page. So an alias
 * that attaches `proxies.<alias>.headers` (operator API keys) with no verifier is
 * an open relay to its upstream for every visitor. Fails closed; opt out either
 * per alias with `auth: {"enabled": false}` (deliberately public) or
 * deployment-wide with `server.secure.proxyCredentialsRequireAuth: false`.
 *
 * Mirrors checkProxyCredentialGate() in server/node/auth.js.
 *
 * @return bool true when the request may proceed; emits the response otherwise.
 */
function enforceProxyCredentialGate($alias, $proxyConfig) {
    if (!proxyCarriesOperatorCredentials($proxyConfig)) return true;
    if (proxyAuthIsEnforced($proxyConfig)) return true;
    // An `auth` block saying `enabled: false` is intent; a missing one is not.
    if (isset($proxyConfig['auth']) && ($proxyConfig['auth']['enabled'] ?? true) === false) return true;
    if (($GLOBALS['CORE_SECURE']['proxyCredentialsRequireAuth'] ?? true) === false) return true;

    error_log("[proxy] '$alias' injects operator credentials (proxies.$alias.headers) but enforces no " .
        "authentication, which makes it an open relay to its upstream for every visitor. Refusing. " .
        "Configure proxies.$alias.auth.verifiers, declare it public with " .
        "proxies.$alias.auth = {\"enabled\": false}, or set " .
        "server.secure.proxyCredentialsRequireAuth: false deployment-wide.");
    header("HTTP/1.1 500 Internal Server Error");
    header("Content-Type: text/plain; charset=utf-8");
    // Does not name the alias: this renders on the viewer's own origin.
    echo "Proxy target is misconfigured: a credential-bearing proxy must enforce authentication.";
    return false;
}

/**
 * Verifies the request against configured proxy authentication.
 */
function verifyProxyAuth($alias, $proxyConfig, &$upstreamHeaders) {
    global $PROXY_AUTH_VERIFIERS, $CORE;

    $authCfg = $proxyConfig['auth'] ?? null;
    // `?? true`, not `?? false`. An `auth` block present WITHOUT an explicit
    // `enabled` used to skip every verifier on PHP while Node ran them
    // (`authCfg.enabled === false` there) — the exact config an operator writes to
    // secure an alias failed open on one backend and closed on the other.
    if (!$authCfg || ($authCfg['enabled'] ?? true) === false) return true;

    $verifiers = $authCfg['verifiers'] ?? [];
    $mode = ($authCfg['mode'] ?? 'all') === 'any' ? 'any' : 'all';

    if (empty($verifiers)) {
        header("HTTP/1.1 500 Internal Server Error");
        echo "Proxy '$alias' auth misconfigured: no verifiers specified.";
        return false;
    }

    // `verifiers` accepts BOTH shapes, matching getVerifierEntries() in
    // server/node/auth.js: an array of names (`["jwt"]`, no per-verifier config)
    // or a map of name => config (`{"jwt": {...}}`), which is what src/config.json
    // itself documents. Treating the map as a list made $name a config array used
    // as an array offset, so no verifier ever resolved and EVERY proxied request
    // 401'd on PHP while working on Node.
    $verifierNames = array_is_list($verifiers) ? $verifiers : array_keys($verifiers);

    $passedCount = 0;
    foreach ($verifierNames as $name) {
        $verifier = is_string($name) ? ($PROXY_AUTH_VERIFIERS[$name] ?? null) : null;
        if (!$verifier) continue;

        try {
            $ok = $verifier($alias, $proxyConfig, $upstreamHeaders);
            if ($ok) {
                $passedCount++;
                if ($mode === 'any') return true;
            } else if ($mode === 'all') break;
        } catch (Exception $e) {
            if ($mode === 'all') break;
        }
    }

    $shouldPass = ($mode === 'all' && $passedCount === count($verifierNames)) ||
                  ($mode === 'any' && $passedCount > 0);

    if (!$shouldPass) {
        header("HTTP/1.1 401 Unauthorized");
        echo "Unauthorized: proxy auth failed for '$alias'";
        return false;
    }
    return true;
}

/**
 * Decode a base64url string (JWT segments), tolerating missing '=' padding.
 * Returns false on malformed input. Mirrors the Buffer-based decode the Node
 * server uses in verifyJwtToken (server/node/auth.js).
 */
if (!function_exists('xopat_b64url_decode')) {
    function xopat_b64url_decode($s) {
        $rem = strlen($s) % 4;
        if ($rem) $s .= str_repeat('=', 4 - $rem);
        return base64_decode(strtr($s, '-_', '+/'), true);
    }
}

// --- Default JWT Verifier Implementation ---
// Kept at parity with the Node verifier (server/node/auth.js verifyJwtToken):
// HS256-only, validates header typ/alg, signature, exp/nbf, and optional
// issuer/audience. Returns false on any failure (verifyProxyAuth treats
// false/exception as a rejection).
registerProxyAuthVerifier('jwt', function($alias, $proxyConfig, &$upstreamHeaders) {
    global $CORE;
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if (empty($authHeader) || !str_starts_with($authHeader, 'Bearer ')) return false;

    $token = substr($authHeader, 7);
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;

    list($hB64, $pB64, $sB64) = $parts;

    // Decode + validate the header: HS256 only, typ JWT.
    $headerJson = xopat_b64url_decode($hB64);
    $header = $headerJson === false ? null : json_decode($headerJson, true);
    if (!$header || ($header['typ'] ?? null) !== 'JWT') return false;
    if (($header['alg'] ?? null) !== 'HS256') return false;

    $payloadJson = xopat_b64url_decode($pB64);
    $payload = $payloadJson === false ? null : json_decode($payloadJson, true);
    if (!$payload) return false;

    // Resolve Secret (per-proxy overrides global), with secretEnv fallback.
    // `server.auth` is stripped out of $CORE before the page is rendered (see
    // inc/core.php), so read the server-only backup first — mirror of Node's
    // `core.CORE?.server?.auth || core.CORE_AUTH` in server/node/auth.js.
    $globalAuth = $CORE['server']['auth'] ?? $GLOBALS['CORE_AUTH'] ?? [];
    $jwtCfg = array_merge($globalAuth['jwt'] ?? [], $proxyConfig['auth']['jwt'] ?? []);
    $secret = $jwtCfg['secret'] ?? null;
    if (!$secret && !empty($jwtCfg['secretEnv'])) $secret = getenv($jwtCfg['secretEnv']) ?: null;
    if (!$secret) return false;

    // Verify Signature (HS256), constant-time compare.
    $sig = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(hash_hmac('sha256', "$hB64.$pB64", $secret, true)));
    if (!hash_equals($sig, $sB64)) return false;

    // Time + claim checks.
    $now = time();
    $skew = $jwtCfg['clockSkewSec'] ?? 60;

    // A token with no `exp` never expires — a permanent credential handed out by
    // accident. Required by default; `requireExpiry: false` is the escape hatch
    // for an issuer that genuinely mints non-expiring service tokens.
    if (!isset($payload['exp']) || !is_numeric($payload['exp'])) {
        if (($jwtCfg['requireExpiry'] ?? true) !== false) return false;
    } else if ($now > ($payload['exp'] + $skew)) {
        return false;
    }

    if (isset($payload['nbf']) && $now < ($payload['nbf'] - $skew)) return false;

    // A CONFIGURED issuer/audience is a requirement, not a hint. These used to
    // be skipped when the claim was absent (`isset($payload['iss']) && ...`), so
    // a token minted without `iss`/`aud` sailed past an issuer- or
    // audience-constrained config — precisely the token an attacker would craft.
    // Kept at parity with server/node/auth.js.
    if (!empty($jwtCfg['issuer']) && ($payload['iss'] ?? null) !== $jwtCfg['issuer']) return false;
    if (!empty($jwtCfg['audience'])) {
        $expectedAud = $jwtCfg['audience'];
        $aud = $payload['aud'] ?? null;
        if (is_array($aud)) {
            if (!in_array($expectedAud, $aud, true)) return false;
        } else if ($aud !== $expectedAud) {
            return false;
        }
    }

    // Forwarding logic
    if (!($jwtCfg['forward'] ?? false)) {
        unset($upstreamHeaders['Authorization'], $upstreamHeaders['HTTP_AUTHORIZATION']);
    }
    if (isset($jwtCfg['userClaimHeader']) && isset($payload['sub'])) {
        $upstreamHeaders[$jwtCfg['userClaimHeader']] = $payload['sub'];
    }

    return true;
});