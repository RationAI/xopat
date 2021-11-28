<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation Developer Setup</title>

  <link rel="stylesheet" href="./external/primer_css.css">
  
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"></script>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="max-widt">

<div class="Layout"  style="max-width: 1260px;padding: 25px 60px;margin: 0 auto;">
  <div class="Layout-main ">
  <h1 class="f00-light">Developer visualisation setup</h1>

<br><br>
<?php

include_once("config.php");
include_once("dynamic_shaders/defined.php");

function hasKey($array, $key) {
  return isset($array[$key]) && $array[$key];
}

$image = hasKey($_GET, "image") ? $_GET["image"] : (hasKey($_POST, "image") ? $_POST["image"] : " < No image specified! > ");
$layer = hasKey($_GET, "layer") ? $_GET["layer"] : (hasKey($_POST, "layer") ? $_POST["layer"] : "");
$shader_selections = array();
$inputs = array();

foreach ($shaders as $name=>$filename) {
    //html parts inner part must be an argument: data ID
    $shader_selections[$name] =
        "<div class='d-flex'>
<div style='min-width: 150px'>
<p class='f3-light mb-0'>$name</p><p style='max-width: 150px;'>{$descriptions[$name]}</p></div>
<div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'>
<img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='dynamic_shaders/$filename.png'></div><div>";


    foreach($options[$name] as $option=>$settings) {
        $shader_selections[$name] .= "<div>
<span style='width: 20%;direction:rtl;transform: translate(0px, -4px);' class='position-relative'>
<span class='flex-1'>Option <code>$option</code> - {$paramDescriptions[$option]}</span></div>";
    }
    $shader_selections[$name] .= "</div></div><br>";
}


//javascript will handle the parameter selection
$layer = explode(",", $layer);

echo <<<EOF
<h3>The Visualization & Image Layer</h3>
<textarea id="visualisation-settings" rows="10" style=" width: 90%; box-sizing: border-box; resize: vertical;"  class="form-control m-2"
onchange="
          try {
              user_settings = $.extend(user_settings, JSON.parse($(this).val()));
          } catch (e) {
              console.warn(e, 'Data:', $(this).val());
              alert(`Incorrect JSON in the visualisation setting: ${e} (see console).`);
          }
">
{
    "name": "The visualization name",
    "data": $image,
    "params": {
         "experimentId": "VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69",
         "losslessImageLayer": false,
         "losslessDataLayer": true
    }
}
</textarea><br><br>
EOF;

$i = 0;
echo "<div id='layers' class='position-relative'><h3>Data Layer(s)</h3>
<button class='btn position-absolute top-2 right-2' onclick='addLayer();'>Add Layer</button><div id='layers-data'>";

foreach($layer as $data) {
    echo <<<EOF
<div class="m-2">
&emsp; The path to the data (relative to IIPImage folder): <input type='text' class='form-control layer-data' value='$data' 
placeholder="Layer is ignored if no data set." style="width: 50%;">
<br><br><textarea rows="10" class="form-control m-2 layer-params" style="resize: vertical; width: 90%;box-sizing: border-box;" onchange="
          try {
              JSON.parse($(this).val());
          } catch (e) {
              console.warn(e, 'Data: ', $(this).val());
              alert(`Incorrect JSON in the layer setting: ${e} (see console).`);
          }
">
{
    "name": "The layer name",
    "type": "none", 
    "visible": "1", 
    "params": { 
    
    }
}
</textarea><hr>
</div>    
EOF;
}
echo "</div></div>";

?>

<br>
<form method="POST" target="_blank" action="<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/index.php" id="request">
   <input type="hidden" name="visualisation" id="visualisation" value=''>
   <button class="btn" type="submit" value="Ready!" style="cursor: pointer;">Ready!</button>&emsp; 
   
</form>
      <br><br><br>
      <div><h3>Available shaders and their parameters</h3><br>

          <?php
          foreach ($shader_selections as $_ => $html) {
              echo $html;
          }
          ?>


      </div>
      <br><br>
      <div><h3>Alternatively, send any valid JSON parametrization</h3><br>
          <textarea rows="20" class="form-control m-2 layer-params" id="custom-params" style="resize: vertical; width: 90%;box-sizing: border-box;" onchange="
          try {
              JSON.parse($(this).val());
          } catch (e) {
              console.warn(e, 'Data:', $(this).val());
              alert(`Incorrect JSON in the custom visualisation: ${e} (see console).`);
          }
">
[
{
      "name": "Visualisation 1",
      "params": {
            "experimentId": "VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69",
            "losslessImageLayer": false,
            "losslessDataLayer": true
      },
      "data": "",
      "shaders": {
            "": {
                 "name": "Annotation layer",
                 "type": "",
                 "visible": "1",
                 "params": {

                 }
            }
      }
}
]
</textarea>
          <form method="POST" target="_blank" action="<?php echo $path; ?>/index.php" id="custom-request">
              <input type="hidden" name="visualisation" id="custom-visualisation" value=''>
              <button class="btn" type="submit" value="Ready!" style="cursor: pointer;">Ready!</button>&emsp;
          </form>
      </div>

  </div>

</div>




<script type="text/javascript">

    var user_settings = {};

    function addLayer() {
        $('#layers-data').append(`
<div class="m-2">
&emsp; The path to the data (relative to IIPImage folder): <input type='text' class='form-control layer-data' value=''
placeholder="Layer is ignored if no data set." style="width: 50%;">
<br><br><textarea rows="10" class="form-control m-2 layer-params" style="resize: vertical; width: 90%;box-sizing: border-box;" onchange="
          try {
              JSON.parse($(this).val());
          } catch (e) {
              console.warn(e, 'Data:', $(this).val());
              alert('Incorrect JSON in the layer setting: ' + e + ' (see console).');
          }
">
{
    "name": "The layer name",
    "type": "none",
    "visible": "1",
    "params": {

    }
}
</textarea>
<hr>
</div>
        `);
    }

    var shaderObject = null;
    var setShader = null;

    $(document).off('submit');

    // new form handling
    $('#request').submit(function(evt) {
        user_settings.shaders = {};
        $('#layers-data').children().each((index, child) => {
            let jQchild = $(child);
            let dataInput = jQchild.find(".layer-data"),
                key = dataInput.val().trim();
            try {
                if (key && !user_settings.shaders.hasOwnProperty(key)) {
                    var toParse = jQchild.find(".layer-params").val();
                    user_settings.shaders[key] = JSON.parse(toParse);
                    jQchild.removeClass("color-bg-danger");
                    dataInput.removeClass("color-border-danger");
                    dataInput.attr("title", "");
                } else {
                    jQchild.addClass("color-bg-danger");
                    dataInput.addClass("color-border-danger");
                    dataInput.attr("title", "This layer is ignored because different layer with the same data (key) was defined earlier.");
                }
            } catch (e) {
                console.warn("Invalid layer params", key, "Data:", toParse, e);
                alert(`Incorrect JSON in the layer ${key} setting: ${e} (see console).`);
            }
        });

        if ($.isEmptyObject(user_settings.shaders)) {
            console.warn("Invalid visualisation setup: no layers defined.", user_settings);
            alert("Invalid visualisation setup: no layers defined (see console).");
        } else {
            document.getElementById("visualisation").value = JSON.stringify([user_settings]);
        }
    });

    $('#custom-request').submit(function(evt) {
        document.getElementById("custom-visualisation").value = $("#custom-params").val();
    });

</script>
</body>

</html>