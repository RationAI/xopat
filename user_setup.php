<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
  <meta charset="utf-8">
  <title>Visualisation</title>

  <!-- <link rel="stylesheet" href="./style.css">    -->
  <link rel="stylesheet" href="./github.css">
  
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

  <!-- jquery -->
  <script src="http://code.jquery.com/jquery-1.10.2.min.js"></script>

</head>

<body>
<h1>Visualisation setup</h1>
The requested data has no visualisation goal: set it up by yourself!
<form method="POST" action="index.php">
   <input type="hidden" name="layer" value="<?php echo $_GET['layer']?>">
   <input type="hidden" name="image" value="<?php echo $_GET['image']?>">
   <input type="hidden" name="dev" value="<?php echo $_GET['dev']?>">

   Data 1: probability <input type="color" name="col1" id="data1color"> <br>
   Data 2: annotation <input type="color" name="col2" id="data2color"> <br>
   What is first in the order? <select name="first" id="first"><option value="1">Data1</option><option value="2">Data2</option></select>

   <!-- todo hardcoded, for testing purposes as of now-->
   <input type="hidden" name="visualisation" id="visualisation" value=''>
   <input type="submit" value="Start">
</form>

  <script type="text/javascript">
  
  
  $(document).off('submit');

  // new form handling
  $('form').submit(function(evt) {
    
    var user_settings = {};
    user_settings.name = "My first dynamic shader";
    user_settings.params = {};
    user_settings.shaders = [];
    
    var data1 = {
        data: "Probability layer",
        type: "color",
        visible: "1",
        params: {
            color: $("#data1color").val()
        }
    }
    
    var data2 = {
        data: "Annotation layer",
        type: "edge",
        visible: "1",
        params: {
            color: $("#data2color").val()
        }
    }
    
    if ($("#first").val() === 1) {
        user_settings.shaders.push(data2);
        user_settings.shaders.push(data1);
    } else {
        user_settings.shaders.push(data1);
        user_settings.shaders.push(data2);
    }
    
    //only one visualisation possible for now
      document.getElementById("visualisation").value = JSON.stringify([user_settings]);
    //evt.preventDefault(); we want to do this
  });
  
  
  </script>
</body>

</html>