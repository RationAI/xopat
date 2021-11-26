<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation User Setup</title>

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
    "');\"><img alt='' style='max-width: 150px; max-height: 150px;' class='rounded-2' src='dynamic_shaders/$filename.png'><p class='f3-light mb-0'>$name</p><p style='max-width: 150px;'>{$descriptions[$name]}</p></div>"
  ];

  $params = array();
  foreach($options[$name] as $option=>$settings) {
    $params[$option] = [
        "<div class='d-flex'><span style='width: 20%;direction:rtl;transform: translate(0px, -4px);' class='position-relative'><input style='direction:ltr; max-width:70px;' class='form-control input-sm mr-2' type='{$htmlInputTypes[$settings[0]]}' $settings[1] onchange=\"setValue(this, '$option', '$settings[0]', '",
        "');\" ></span ><span class='flex-1' > Option <code > $option</code > - {$paramDescriptions[$option]}</span ></div >"
    ];
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
    echo "<section class='position-relative border m-2 px-2 pb-3 active $progress data-layer-container' data-count='1'> 
    <header class='position-sticky top-0 color-bg-secondary f2-light p-responsive px-1 mt-2 d-block'>Data <code class='h3'>$data</code></header>";

    echo "<button class='btn float-right mt-2 position-absolute top-0 right-2' onclick=\"addShader(this.parentNode, '$data');\">Add data interpretation</button><div></div>";
    echo "</section>";
    $i++;
}
if ($i == 0) {
    throwFatalError("Unable to setup: no data defined.",
        "Visualisation was not defined and custom data sources are missing. See POST data:",
        print_r($_POST, true));
}

$path = "http://" . $_SERVER['HTTP_HOST'].dirname($_SERVER['SCRIPT_NAME']);
?>

<br>
<form method="POST" action="<?php echo $path; ?>/index.php"  id="request">
   <input type="hidden" name="visualisation" id="visualisation" value=''>
    <input type="hidden" name="ignoreCookiesCache" id="ignoreCookiesCache" value='1'>

    <button class="btn" type="submit" value="Ready!" style="cursor: pointer;">Ready!</button>&emsp;
   
</form><br>
      <p class='f3-light mt-4'>OR</p> <label for="import-settings" class="btn">Load saved setup</label>
      <input type="file" name="import-settings" id="import-settings" onchange="importSettings(event, this)" class="d-none">

      <div class="float-right ml-4">
          <input id="export-name" type="text" class="form-control" value="export" placeholder="Invalid filename!">
          <button class="btn float-right" onclick="exportVisualisation(this);" title="Export visualisation" style="cursor: pointer;">Export visualisation</button>
      </div>

      <div class="float-right">
          <input id="settings-name" type="text" class="form-control" value="settings" placeholder="Invalid filename!">
          <button class="btn" onclick="exportSettings()" title="Save shader setup" style="cursor: pointer;">Save setup</button>
          <p class='f1-light d-inline-block mt-0 mb-0 mr-0 ml-3' style="line-height: 12px;vertical-align: text-top;"> / </p>

      </div>

      <a style="display:none;" id="export-visualisation"></a>

  </div>
</div>


<script type="text/javascript">

    var user_settings = {
        name: "Custom Visualisation",
        params: {},
        data: '<?php echo $image; ?>',
        shaders: {}
    };
    var SHADERS = <?php echo $shaders_json; ?>;
    var PARAMS = <?php echo $inputs_json; ?>;
    var LAYERS = <?php echo json_encode(array_reverse($layer)); ?>;
    var shaderObject = null;
    var setShader = null;

    function addShader(self, dataId) {
        var shadersNo = parseInt(self.dataset.count);
        //TODO multiple intepretations not allowed for now, enable?
        if (shadersNo > 1) return;
        //var html = `<div><p class='f3-light text-center mt-4'>interpretation no. ${shadersNo}</p><div>`;
        var html = `<div class="data-interpretation"><div>`;
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

        if (!user_settings.shaders[dataID]) {
            shaderObject = {
                type: name,
                visible: "1",
                params: {}
            };
            user_settings.shaders[dataID] = shaderObject;
        } else {
            shaderObject = user_settings.shaders[dataID];
            shaderObject.type = name;
            shaderObject.params = {};
        }

        setShader = name;
        if (Object.keys(PARAMS[name]).length < 1) {
            //TODO
            node.innerHTML = "";
        } else {
            node.innerHTML = "<p class='f3-light mt-2 mb-1'>" + name + " shader - Advanced Options</p>";

            for (let [key, value] of Object.entries(PARAMS[name])) {
                node.innerHTML += `${value[0]}${dataID}${value[1]}`;
            }
        }
        self.classList.add("color-border-warning");
    }

    function setValue(self, option, type, dataID) {
        let shader = user_settings.shaders[dataID];
        if (type === "bool" || type === "neg_bool") {
            shader.params[option] = (self.checked == true); //type coercion
        } else {
            shader.params[option] = self.value;
        }
    }

    function exportSettings() {
        let name = $("#settings-name").val();
        if (!name) return;

        let count = 0;
        let exported = [];
        for (let idx in LAYERS) {
            if (user_settings.shaders.hasOwnProperty(LAYERS[idx])) {
                exported.push(user_settings.shaders[LAYERS[idx]]);
                count++;
            } else {
                exported.push({});
            }
        }
        if (count === 0) {
            alert("No data has been exported: first create some visualisation setup.")
            return;
        }

        var output = new Blob([JSON.stringify(exported)], { type: 'text/json' });
        var downloadURL = window.URL.createObjectURL(output);
        var downloader = document.getElementById("export-visualisation");
        downloader.href = downloadURL;
        downloader.download = `${name}.json`;
        downloader.click();
    }
    
    function importSettings(event, self) {
        let file = event.target.files[0];
        if (!file) return;
        let fileReader = new FileReader();
        fileReader.onload = function(e) {

            try {
                let imported = JSON.parse(e.target.result);
                let count = 0;
                for(let i = 0; i < Math.min(LAYERS.length, imported.length); i++) {
                    // if (user_settings.shaders.hasOwnProperty(LAYERS[i])) {
                    //     user_settings.shaders[LAYERS[i]].type = imported[i].type;
                    //     user_settings.shaders[LAYERS[i]].params = imported[i].params;
                    //     user_settings.shaders[LAYERS[i]].visible = 1;
                    // } else {
                    user_settings.shaders[LAYERS[i]] = imported[i];
                    // }
                    count++;
                }

                if (count === 0) {
                    alert("No data has been detected: invalid file.");
                    return;
                }

                $('#request').submit();

                //todo modify GUI? now for simplicity just redirect...
                // $(".data-interpretation").remove();
                // $(".data-layer-container").each(e => {
                //      addShader()...
                // });
            } catch (e) {
                alert("Invalid setup file!");
            }

        }
        fileReader.readAsText(file);
        self.value = '';
    }

    function exportVisualisation(self) {
        let name = $("#export-name").val();
        if (!name) return;

        var action = $("#request").attr('action');
        var visSetup = JSON.stringify([user_settings]);

        //todo missing plugins? etc. use only one JS file with form creation to unify export
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
        downloader.download = `${name}.html`;
        downloader.click();
    }

    $(document).off('submit');

    // new form handling
    $('#request').submit(function(evt) {
        let shaders = user_settings.shaders;

        //reorder to reflect the ordering in the GUI
        user_settings.shaders = {};
        for (let idx in LAYERS) {
            if (shaders.hasOwnProperty(LAYERS[idx])) {
                user_settings.shaders[LAYERS[idx]] = shaders[LAYERS[idx]];
            }
        }
        document.getElementById("visualisation").value = JSON.stringify([user_settings]);
    });

</script>
</body>

</html>