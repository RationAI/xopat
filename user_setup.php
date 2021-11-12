<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation</title>

  <link rel="stylesheet" href="./external/primer_css.css">
  
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
  <script src="http://code.jquery.com/jquery-1.10.2.min.js"></script>

</head>

<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed" style="max-widt">

<div class="Layout"  style="max-width: 1260px;padding: 25px 60px;margin: 0 auto;">
  <div class="Layout-main ">
  <h1 class="f00-light">Visualisation setup</h1>

<p> The data you requested has no visualisation goal. Below, you can specify how to show the data yourself. </p>

<?php

include_once("dynamic_shaders/defined.php");

function hasKey($array, $key) {
  return isset($array[$key]) && $array[$key];
}
function throwFatalError($title, $description, $details) {
    session_start();
    $_SESSION['title'] = $title;
    $_SESSION['description'] = $description;
    $_SESSION['details'] = $details;
    header('Location:./error.php');
    exit;
}
$image = hasKey($_GET, "image") ? $_GET["image"] : (hasKey($_POST, "image") ? $_POST["image"] : false);
if (!$image) {
    throwFatalError("Unable to setup: no image defined.",
    "Visualisation was not defined and custom image source is missing. See POST data:",
    print_r($_POST, true));
}
$layer = hasKey($_GET, "layer") ? $_GET["layer"] : (hasKey($_POST, "layer") ? $_POST["layer"] : false);
if (!$layer) {
    throwFatalError("Unable to setup: no data defined.",
    "Visualisation was not defined and custom data sources are missing. See POST data:",
    print_r($_POST, true));
}
$shader_selections = array();
$inputs = array();


foreach ($shaders as $name=>$filename) {
 
  //html parts inner part must be an argument: data ID
  $shader_selections[$name] = [
    "<div class='d-inline-block mx-1 px-1 py-1 pointer v-align-top rounded-2' style='border: 3px solid transparent'  onclick=\"selectShaderPart(this, '$name', '$filename', '",
    "');\"><img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='dynamic_shaders/$filename.png'><p class='f3-light mb-0'>$name</p><p style='max-width: 150px;'>{$descriptions[$name]}</div>"
  ];

  $params = array();
  foreach($options[$name] as $option=>$settings) {
    $params[$option] = "<div class='d-flex'><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);' class='position-relative'><input style='direction:ltr; max-width:70px;' class='form-control input-sm mr-2' type='{$htmlInputTypes[$settings[0]]}' $settings[1] onchange=\"setValue(this, '$option', '$settings[0]');\"></span><span class='flex-1'>Option <code>$option</code> - {$paramDescriptions[$option]}</span></div>";
  }
  $inputs[$name] = (object)$params;
}


//javascript will handle the parameter selection
$inputs_json = json_encode((object)$inputs);
$shaders_json = json_encode((object)$shader_selections);
$layer = explode(",", $layer);

$i = 0;
foreach($layer as $data) {
    $progress = $i == 0 ? "in-progress" : "";
    echo "<section class='position-relative border m-2 px-2 pb-3 active $progress' data-count='1'> 
    <header class='position-sticky top-0 color-bg-secondary f2-light p-responsive px-1 mt-2 d-block'>Data <code class='h3'>$data</code></header>";

    echo "<button class='btn float-right mt-2 position-absolute top-0 right-2' onclick=\"addShader(this.parentNode, '$data');\">Add data interpretation</button>";
    echo "</section>";
    $i++;
}

$path = "http://" . $_SERVER['HTTP_HOST'].dirname($_SERVER['SCRIPT_NAME']);
?>

<br>
<form method="POST" action="<?php echo $path; ?>/index.php"  id="request">
   <input type="hidden" name="visualisation" id="visualisation" value=''>
   <button class="btn" type="submit" value="Ready!" style="cursor: pointer;">Ready!</button>&emsp; 
   
</form>
<button class="btn float-right" onclick="exportVisualisation(this);" title="Export visualisation" style="cursor: pointer;">Save setup</button>
<a style="display:none;" id="export-visualisation"></a>

  </div>
</div>


<script type="text/javascript">

    var user_settings = {
        name: "Custom Visualisation",
        params: {},
        data: '<?php echo $image; ?>',
        shaders: [

        ]
    };
    var SHADERS = <?php echo $shaders_json; ?>;
    var PARAMS = <?php echo $inputs_json; ?>;
    var shaderObject = null;
    var setShader = null;

    var shadersNo = 1;
    function addShader(self, dataId) {
        var shadersNo = parseInt(self.dataset.count);
        var html = `<div><p class='f3-light text-center mt-4'>interpretation no. ${shadersNo}<div>`;
        Object.entries(SHADERS).forEach(element => {
            const [k, v] = element;
            html += `${v[0]}${dataId}${v[1]}`;
        });
        shadersNo++;
        self.dataset.count = shadersNo.toString();
        $(self).append(html + "</div><div class='shader-part-advanced mt-3'></div></div>");
    }

    function selectShaderPart(self, name, filename, dataID) {
        let node = self.parentNode.parentNode.lastChild;
        self.parentNode.childNodes.forEach(child => {
            child.classList.remove("color-border-warning");
        });

        shaderObject = user_settings.shaders.find(obj => obj.data === dataID);

        if (!shaderObject) {
            shaderObject = {
                data: dataID,
                type: name,
                visible: "1",
                params: {}
            };
            user_settings.shaders.push(shaderObject);
        } else {
            shaderObject.type = name;
            shaderObject.params = {};
        }

        console.log(user_settings.shaders);


        setShader = name;
        if (Object.keys(PARAMS[name]).length < 1) {
            //TODO
            node.innerHTML = "";
        } else {
            node.innerHTML = "<p class='f3-light mt-2 mb-1'>" + name + " shader - Advanced Options</p>";

            for (let [key, value] of Object.entries(PARAMS[name])) {
                node.innerHTML += value;
            }
        }
        self.classList.add("color-border-warning");


    }

    function setValue(self, option, type) {
        console.log(type);
        if (type === "bool" || type === "neg_bool") {
            shaderObject.params[option] = (self.checked == true); //type coercion
        } else {
            shaderObject.params[option] = self.value;
        }
        console.log(shaderObject);
    }

    function exportVisualisation(self) {
        var action = $("#request").attr('action');
        var visSetup = JSON.stringify([user_settings]);
        var doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
</head>
<body>
  <form method="POST" id="redirect" action="${action}">
    <input type="hidden" id="visualisation" name="visualisation">
    <input type="submit" value="">
    </form>
  <script type="text/javascript">
    //safely set values (JSON)
    document.getElementById("visualisation").value = '${visSetup}';
    document.getElementById("redirect").submit();
    <\/script>
</body>
</html>`;
        var output = new Blob([doc], { type: 'text/html' });
        var downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-visualisation");
        downloader.href = downloadURL;
        downloader.download = "visualisation.html";
        downloader.click();
    }

    $(document).off('submit');

    // new form handling
    $('#request').submit(function(evt) {



        // var data1 = {
        //     data: "Probability layer",
        //     type: "color",
        //     visible: "1",
        //     params: {
        //         color: $("#data1color").val()
        //     }
        // }

        // var data2 = {
        //     data: "Annotation layer",
        //     type: "edge",
        //     visible: "0",
        //     params: {
        //         color: $("#data2color").val(),
        //         ctrlThreshold: false
        //     }
        // }

        // var data3 = {
        //     data: "Identity shader",
        //     type: "identity",
        //     visible: "1",
        //     params: {
        //     }
        // }

        // user_settings.shaders.push(data3);

        // if ($("#first").val() === 1) {
        //     user_settings.shaders.push(data2);
        //     user_settings.shaders.push(data1);
        // } else {
        //     user_settings.shaders.push(data1);
        //     user_settings.shaders.push(data2);
        // }

        //only one visualisation possible for now
        document.getElementById("visualisation").value = JSON.stringify([user_settings]);
        //evt.preventDefault(); we want to do this
    });


</script>
</body>

</html>