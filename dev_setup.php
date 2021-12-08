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

?>
      <br>

          <textarea rows="40" class="form-control m-2 layer-params" id="custom-params" style="resize: vertical; width: 90%;box-sizing: border-box;" onchange="
          try {
              JSON.parse($(this).val());
          } catch (e) {
              console.warn(e, 'Data:', $(this).val());
              alert(`Incorrect JSON in the custom visualisation: ${e} (see console).`);
          }
">
{
    "params": {
        "experimentId": "VGG16-TF2-DATASET-e95b-4e8f-aeea-b87904166a69"
    },
    "data": [],
    "background": [
        {
            "dataReference": 0,
            "lossless": false
        }
    ],
    "shaderSources" : [
        {
            "url": "http://my-shader-url.com/customShader.js",
            "headers": {},
            "typedef": "new_type"
        }
    ],
    "visualizations": [
        {
            "name": "A visualisation setup 1",
            "lossless": true,
            "shaders": {
                "shader_id_1": {
                    "name": "Layer 1",
                    "type": "none",
                    "visible": "1",
                    "dataReferences": [],
                    "params": { }
                }
            }
        }
    ]
}
</textarea>
      <form method="POST" target="_blank" action="<?php echo VISUALISATION_ROOT_ABS_PATH; ?>/index.php" id="custom-request">
          <input type="hidden" name="visualisation" id="custom-visualisation" value=''>
          <button class="btn" type="submit" value="Ready!" style="cursor: pointer;">Ready!</button>&emsp;
      </form>

          <br><br>
          <div><h3>Available shaders and their parameters</h3><br>

              <?php
              foreach ($shader_selections as $_ => $html) {
                  echo $html;
              }
              ?>


          </div>
          <br><br>


      </div>

  </div>

</div>




<script type="text/javascript">

    $(document).off('submit');

    $('#custom-request').submit(function(evt) {
        document.getElementById("custom-visualisation").value = $("#custom-params").val();
    });

</script>
</body>

</html>