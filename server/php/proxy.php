<?php

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

// Route to Proxy
$path = $_SERVER['PATH_INFO'] ?? $_SERVER['REQUEST_URI'];
require_once PHP_INCLUDES . "proxy.php";
handleProxyRequest($path);