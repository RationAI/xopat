<?php

function show_error($err_title, $err_desc, $err_details, $locale='en') {

    error_reporting(E_ERROR);
    ini_set('display_errors', 1);

$title = isset($err_title) ? $err_title : false;
$description = isset($err_desc) ? $err_desc : false;
$techNFO = isset($err_details) ? $err_details : false;

require_once PROJECT_ROOT . '/i18n.class.php';
$t = i18n::default($locale, LOCALES_ROOT);

?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
    <meta charset="utf-8">
    <title>Visualisation Error</title>

    <link rel="stylesheet" href="<?php echo ASSETS_ROOT; ?>/style.css">
    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>/primer_css.css">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" >


<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center color-text-primary"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;<?php echo $t->t('error.title') ?></div>
    <div id="system-message-title" class="f2-light text-center clearfix color-text-primary"></div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button"><?php echo $t->t('error.detailsBtn') ?></button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll color-text-primary" style="display: none;max-height: 50vh;"></div>

    <button onclick="window.location='<?php echo GATEWAY; ?>'" class="btn" type="button"><?php echo $t->t('error.back') ?></button>

</div>


<!-- DEFAULT SETUP SCRIPTING -->
<script type="text/javascript">

    /*---------------------------------------------------------*/
    /*------------ System error messenger ---------------------*/
    /*---------------------------------------------------------*/

    var DisplayError = {
        msgTitle: $("#system-message-title"),
        msgDetails: $("#system-message-details"),
        msgContainer: $("#system-message"),
        screenContainer: $("#viewer-container"),

        show: function(title, description) {
            this.msgTitle.html(title);
            this.msgDetails.html(description);
            this.msgContainer.removeClass("d-none");
            this.screenContainer.addClass("disabled");
        },

        hide: function() {
            this.msgContainer.addClass("d-none");
            this.screenContainer.removeClass("disabled");
        }
    };

    DisplayError.show('<?php echo $title; ?>', `<?php echo $description; if ($techNFO) echo "<br><code>".$techNFO."</code>"; ?>` || '<?php echo $t->t('error.noDetails') ?>');
</script>
</body>
</html>
 <?php
}
