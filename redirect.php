<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation</title>

  <link rel="stylesheet" href="./external/primer_css.css">
  
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="max-widt">

<form method="POST" action="<?php echo "https://$_SERVER[HTTP_HOST]" . dirname($_SERVER['SCRIPT_NAME']); ?>/index.php" id="redirect">
   <input type="hidden" name="visualisation" id="visualisation" value=''>
</form>
<button class="btn float-right" onclick="exportVisualisation(this);" title="Export visualisation" style="cursor: pointer;">Save setup</button>
<a style="display:none;" id="export-visualisation"></a>

  <script type="text/javascript">

  try {
    var url = new URL(window.location.href);
  } catch (error) {
    alert(error);
  }

  var form = document.getElementById("redirect");
  let params = url.hash.split("|");
  document.getElementById("visualisation").value = decodeURIComponent(params[0]).substring(1);

  //turn on plugins
  for (let i = 2; i < params.length; i++) {
    let node = document.createElement("input");
    node.setAttribute("type", "hidden");
    node.setAttribute("name", decodeURIComponent(params[i]));
    node.setAttribute("value", "1");
    form.appendChild(node);
  }

  form.submit();

  </script>
</body>

</html>