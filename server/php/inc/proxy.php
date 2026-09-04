<?php
if (!defined('ABSPATH')) exit;
require_once PHP_INCLUDES . "auth.php";

function handleProxyRequest($pathInfo) {
    global $CORE;

    // 1. Session & CSRF Check
    if (session_status() === PHP_SESSION_NONE) session_start();
    if (!isset($_SESSION['xopat_session'])) {
        header("HTTP/1.1 401 Unauthorized");
        exit("Unauthorized: missing session");
    }

    // `hash_equals`, not `!==`: the CSRF token is a bearer credential for
    // state-changing requests, and PHP's string comparison short-circuits on the
    // first differing byte. Mirrors csrfTokenMatches() in server/node/auth.js.
    $clientCsrf = $_SERVER['HTTP_X_XOPAT_CSRF'] ?? '';
    $expectedCsrf = $_SESSION['csrf_token'] ?? '';
    if (empty($clientCsrf) || empty($expectedCsrf) || !hash_equals((string)$expectedCsrf, (string)$clientCsrf)) {
        header("HTTP/1.1 403 Forbidden");
        exit("Forbidden: invalid CSRF token");
    }

    // 2. Resolve Alias (Prefix-Aware)
    $parts = explode('/', trim($pathInfo, '/'));

    // Find where 'proxy' is in the array
    $proxyIndex = array_search('proxy', $parts);
    $alias = ($proxyIndex !== false && isset($parts[$proxyIndex + 1])) ? $parts[$proxyIndex + 1] : null;
    $proxyConfig = $GLOBALS['CORE_SECURE']['proxies'][$alias] ?? null;

    // Do NOT echo the alias or the path — both are request input, PHP answers
    // text/html by default, and this response renders on the viewer's own origin
    // next to the CSRF token. Reflecting it here was a reflected XSS. Log the
    // offending value instead; mirrors the same fix in server/node/index.js.
    // The per-session alias allowlist answers deliberately the same way as an
    // unknown alias: which aliases exist is not a restricted session's business.
    if (!$proxyConfig || !is_array($proxyConfig) || !is_string($proxyConfig['baseUrl'] ?? null)
        || !proxyAliasAllowedForSession($alias)) {
        error_log("[proxy] refused unknown/disallowed alias for path: $pathInfo");
        header("HTTP/1.1 403 Forbidden");
        header("Content-Type: text/plain; charset=utf-8");
        exit("Proxy target alias is not allowed or not configured.");
    }

    // An alias that attaches operator credentials must enforce authentication —
    // session + CSRF only proves same-origin, and both are handed to any anonymous
    // page load.
    if (!enforceProxyCredentialGate($alias, $proxyConfig)) exit;

    // 3. Prepare Upstream
    // Target path starts AFTER the alias
    $targetPath = '/' . implode('/', array_slice($parts, $proxyIndex + 2));
    $targetUrl = rtrim($proxyConfig['baseUrl'], '/') . $targetPath . ($_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : '');

    $incoming = getallheaders();

    // Auth verification reads the INCOMING headers (it needs Authorization).
    if (!verifyProxyAuth($alias, $proxyConfig, $incoming)) exit;

    // Explicit allowlist, mirroring PROXY_FORWARDED_REQUEST_HEADERS in
    // server/node/index.js — not a denylist. `Authorization` is deliberately
    // absent: a browser-sent credential is for THIS server, and forwarding it
    // hands the upstream a token it was never issued. Anything the upstream
    // needs is injected below from operator config instead.
    $forwardable = [
        'accept', 'accept-language', 'accept-encoding',
        'content-type', 'content-length',
        'range', 'if-range', 'if-none-match', 'if-modified-since',
        'user-agent',
    ];
    $headers = [];
    foreach ($incoming as $k => $v) {
        if (in_array(strtolower($k), $forwardable, true)) $headers[$k] = $v;
    }

    if (isset($proxyConfig['headers'])) {
        $headers = array_merge($headers, $proxyConfig['headers']);
    }

    // 4. cURL Forward
    $ch = curl_init($targetUrl);
    $formattedHeaders = [];
    foreach ($headers as $k => $v) $formattedHeaders[] = "$k: $v";

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $_SERVER['REQUEST_METHOD'],
        CURLOPT_HTTPHEADER => $formattedHeaders,
        CURLOPT_POSTFIELDS => file_get_contents('php://input'),
        CURLOPT_HEADER => true,
        // Do NOT follow redirects. cURL replays the request — including the
        // operator-injected credentials above — at whatever Location the upstream
        // names, including a different host. Hand the 3xx back to the caller and
        // let it decide instead.
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ]);

    $response = curl_exec($ch);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    header("HTTP/1.1 $resCode");

    // Response headers NEVER passed back to the browser. `set-cookie` is the
    // important one: without it a proxied upstream can set cookies on the
    // VIEWER's origin, next to the session cookie. The rest are hop-by-hop.
    // Mirrors PROXY_STRIPPED_RESPONSE_HEADERS in server/node/index.js — minus
    // `content-encoding`/`content-length`, which that list drops only because
    // undici has already decoded the body. cURL here has NOT (no
    // CURLOPT_ENCODING), so the body below is byte-exact and both headers still
    // describe it correctly; stripping them would corrupt every gzip response.
    $strippedResponseHeaders = [
        'set-cookie', 'set-cookie2',
        'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
        'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
    ];
    $resHeaders = substr($response, 0, $headerSize);
    foreach (explode("\r\n", $resHeaders) as $hdr) {
        if (empty($hdr)) continue;
        $sep = strpos($hdr, ':');
        // The status line (`HTTP/1.1 200 OK`) carries no colon, and we have
        // already emitted our own above.
        if ($sep === false) continue;
        $name = strtolower(trim(substr($hdr, 0, $sep)));
        if (in_array($name, $strippedResponseHeaders, true)) continue;
        header($hdr);
    }

    echo substr($response, $headerSize);
    curl_close($ch);
    exit;
}
