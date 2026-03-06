<?php

if (!defined( 'ABSPATH' )) {
    exit;
}

// Route to Proxy
$path = $_SERVER['PATH_INFO'] ?? $_SERVER['REQUEST_URI'];
require_once PHP_INCLUDES . "proxy.php";
handleProxyRequest($path);
