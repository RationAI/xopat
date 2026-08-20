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
 * Verifies the request against configured proxy authentication.
 */
function verifyProxyAuth($alias, $proxyConfig, &$upstreamHeaders) {
    global $PROXY_AUTH_VERIFIERS, $CORE;

    $authCfg = $proxyConfig['auth'] ?? null;
    if (!$authCfg || ($authCfg['enabled'] ?? false) === false) return true;

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