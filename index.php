<?php
if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}
if (!defined( 'ABSPATH' )) {
    define( 'ABSPATH', __DIR__ . '/' );
}

$directive = isset($_GET["directive"]) ? $_GET["directive"] : "";
if ($directive) {
    switch ($directive) {
        case "dev_setup":
            require_once ABSPATH . "server/php/dev_setup.php";
            exit;
        case "user_setup":
            require_once ABSPATH . "server/php/user_setup.php";
            exit;
        //redirect and others handled by index
        default:
            break;
    }
}

require_once ABSPATH . "server/php/init.php";