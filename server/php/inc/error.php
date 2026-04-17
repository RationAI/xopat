<?php
if (!defined( 'ABSPATH' )) {
    exit;
}

function throwFatalErrorIfFallback($condition, $title, $description, $details) {

    if (!file_exists(ABSPATH . "error.html")) {
        //try to reach the file externally
        header("Location error.html");
        exit;
    }
    //try to add additional info to the file

    echo preg_replace_callback(HTML_TEMPLATE_REGEX, function ($match) use ($title, $description, $details) {
        switch ($match[1]) {
            case "head":
                ob_start();
                require_libs();
                return ob_get_clean();
            case "error":
                return <<<EOF
<div class="collapsible" onclick="toggleContent()">Detailed Information</div>
<div class="content">
  <p>$description</p>
  <code>$details</code>
</div>
EOF;
            default:
                break;
        }
        return "";
    }, file_get_contents(ABSPATH . "error.html"));
    exit;
}

/**
 * @param $err_title string translation key
 * @param $err_desc string translation key
 * @param $err_details string technical error details
 * @param $locale string default locale
 * @return void
 */
function show_error(string $err_title, string $err_desc, string $err_details, string $locale='en') {

    $title = $err_title ?? false;
    $description = $err_desc ?? false;
    $techNFO = $err_details ?? false;

    global $i18n;
    if (!isset($i18n)) {
        require_once PHP_INCLUDES . 'i18n.class.php';
        $i18n = i18n::default($locale, LOCALES_ROOT);
    }

    $title = $title ? $i18n->t($title) : $title;
    $description = $description ? $i18n->t($description) : $description;
    if (!$description) $description = $i18n->t('error.noDetails');
    if ($techNFO) $description .= "<br><code>".$techNFO."</code>";

    $template_file = ABSPATH . "server/templates/error.html";
    if (!file_exists($template_file)) {
        throwFatalErrorIfFallback(true, $err_title, $err_desc, $err_details);
    }

    $replacer = function($match) use ($i18n, $title, $description, $techNFO) {
        ob_start();

        switch ($match[1]) {
            case "head":
                require_lib("primer");
                if (defined('VERSION')) {
                    require_core("env");
                }
                require_lib("jquery");
                break;

            case "text-title":
                echo $i18n->t('error.title');
                break;

            case "text-details":
                echo $i18n->t('error.detailsBtn');
                break;

            case "custom":
                if (defined('GATEWAY')) {
                    ?><button onclick="window.location='<?php echo GATEWAY; ?>'" class="btn" type="button"><?php echo $i18n->t('error.back') ?></button><?php
                }
                break;

            case "display-error-call":
                echo <<<EOF
<script>
DisplayError.show('$title', `$description`);
</script>
EOF;
            default:
                 break;
        }
        return ob_get_clean();
    };

    echo preg_replace_callback(HTML_TEMPLATE_REGEX, $replacer, file_get_contents($template_file));
}
