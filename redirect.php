<?php
    require_once("config.php");
?>

<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Redirecting...</title>
</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">

<form method="POST" action="<?php echo VISUALISATION_ROOT_ABS_PATH ?>/index.php" id="redirect">
   <input type="hidden" name="visualisation" id="visualisation" value=''>
</form>
<a style="display:none;" id="export-visualisation"></a>

  <script type="text/javascript">

  try {
    var url = new URL(window.location.href);
  } catch (error) {
    alert(error);
  }

  var form = document.getElementById("redirect");
  let params = decodeURIComponent(url.hash).split("|");
  document.getElementById("visualisation").value = params[0].substring(1);

  //turn on plugins
  for (let i = 1; i < params.length; i++) {
    if (!params[i]) continue;
    let node = document.createElement("input");
    node.setAttribute("type", "hidden");
    node.setAttribute("name", params[i]);
    node.setAttribute("value", "1");
    form.appendChild(node);
  }

  form.submit();

  </script>
</body>

</html>