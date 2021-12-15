<?php
require_once("config.php");

session_start();

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

$title = hasKey($_SESSION, "title") ? $_SESSION['title'] : (hasKey($_GET, "title") ? $_GET['title'] : false);
$description = hasKey($_SESSION, "description") ? $_SESSION['description'] : (hasKey($_GET, "description") ? $_GET['description'] : false);
$techNFO = hasKey($_SESSION, "details") ? $_SESSION['details'] : (hasKey($_GET, "details") ? $_GET['details'] : false);

unset($_SESSION['title']);
unset($_SESSION['description']);
unset($_SESSION['details']);
session_destroy();

?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
    <meta charset="utf-8">
    <title>Visualisation Error</title>

    <link rel="stylesheet" href="./style.css">
    <link rel="stylesheet" href="./external/primer_css.css">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>
</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" >


<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;Error</div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="display: none;max-height: 50vh;"></div>

    <button onclick="window.location='<?php echo GATEWAY; ?>'" class="btn" type="button">Back to experiments</button>

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
    }

    DisplayError.show('<?php echo $title; ?>', `<?php echo $description; if ($techNFO) echo "<br><code>".$techNFO."</code>"; ?>`);
</script>
</body>
</html>