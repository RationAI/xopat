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

    $passedCount = 0;
    foreach ($verifiers as $name) {
        $verifier = $PROXY_AUTH_VERIFIERS[$name] ?? null;
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

    $shouldPass = ($mode === 'all' && $passedCount === count($verifiers)) ||
                  ($mode === 'any' && $passedCount > 0);

    if (!$shouldPass) {
        header("HTTP/1.1 401 Unauthorized");
        echo "Unauthorized: proxy auth failed for '$alias'";
        return false;
    }
    return true;
}

// --- Default JWT Verifier Implementation ---
registerProxyAuthVerifier('jwt', function($alias, $proxyConfig, &$upstreamHeaders) {
    global $CORE;
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if (empty($authHeader) || !str_starts_with($authHeader, 'Bearer ')) return false;

    $token = substr($authHeader, 7);
    $parts = explode('.', $token);
    if (count($parts) !== 3) return false;

    list($hB64, $pB64, $sB64) = $parts;
    $payload = json_decode(base64_decode(strtr($pB64, '-_', '+/')), true);
    if (!$payload) return false;

    // Resolve Secret
    $jwtCfg = array_merge($CORE['server']['auth']['jwt'] ?? [], $proxyConfig['auth']['jwt'] ?? []);
    $secret = $jwtCfg['secret'] ?? null;
    if (!$secret) return false;

    // Verify Signature (HS256)
    $sig = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(hash_hmac('sha256', "$hB64.$pB64", $secret, true)));
    if ($sig !== $sB64) return false;

    // Expiry check
    $now = time();
    $skew = $jwtCfg['clockSkewSec'] ?? 60;
    if (isset($payload['exp']) && $now > ($payload['exp'] + $skew)) return false;

    // Forwarding logic
    if (!($jwtCfg['forward'] ?? false)) {
        unset($upstreamHeaders['Authorization'], $upstreamHeaders['HTTP_AUTHORIZATION']);
    }
    if (isset($jwtCfg['userClaimHeader']) && isset($payload['sub'])) {
        $upstreamHeaders[$jwtCfg['userClaimHeader']] = $payload['sub'];
    }

    return true;
});