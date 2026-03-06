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

    $clientCsrf = $_SERVER['HTTP_X_XOPAT_CSRF'] ?? '';
    if (empty($clientCsrf) || $clientCsrf !== $_SESSION['csrf_token']) {
        header("HTTP/1.1 403 Forbidden");
        exit("Forbidden: invalid CSRF token");
    }

    // 2. Resolve Alias
    $parts = explode('/', trim($pathInfo, '/'));
    $alias = $parts[1] ?? null; // /proxy/alias/...
    $proxyConfig = $CORE['server']['secure']['proxies'][$alias] ?? null;

    if (!$proxyConfig) {
        header("HTTP/1.1 403 Forbidden");
        exit("Proxy alias '$alias' not configured.");
    }

    // 3. Prepare Upstream
    $targetPath = '/' . implode('/', array_slice($parts, 2));
    $targetUrl = rtrim($proxyConfig['baseUrl'], '/') . $targetPath . ($_SERVER['QUERY_STRING'] ? '?' . $_SERVER['QUERY_STRING'] : '');

    $headers = getallheaders();
    unset($headers['Host'], $headers['Connection'], $headers['Origin'], $headers['Referer']);

    if (!verifyProxyAuth($alias, $proxyConfig, $headers)) exit;

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
        CURLOPT_FOLLOWLOCATION => true
    ]);

    $response = curl_exec($ch);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $resCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    header("HTTP/1.1 $resCode");
    // Forward upstream headers (simplified)
    $resHeaders = substr($response, 0, $headerSize);
    foreach (explode("\r\n", $resHeaders) as $hdr) {
        if (!empty($hdr) && !str_starts_with(strtolower($hdr), 'transfer-encoding')) header($hdr);
    }

    echo substr($response, $headerSize);
    curl_close($ch);
    exit;
}