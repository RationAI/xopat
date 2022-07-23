<?php
global $wpdb, $wp_query;
$id = get_current_user_id();
$DATE = $wp_query->query_vars["date"];
$OSP_SQL = $wpdb->get_results("SELECT * FROM osp_test_results WHERE datum='$DATE' AND login_id= '$id' LIMIT 1", ARRAY_A);

$OSP_FOUND = $wpdb->num_rows;
if ($OSP_FOUND == 0){
    echo "Omlouváme se, ale data nejsou k dispozici.";
}
if (($OSP_FOUND == 1) and (is_numeric($OSP_SQL[0]["questions"]))){
    $results = json_decode($OSP_SQL[0]["results"], true);
    $spravne_test = 0;
    $spatne_test = 0;
    $nezod_test = 0;
    $procenta = 0;
    foreach ($results as $key => $check_test) {
        //pokud mám otázky 7 až 12, počítej správně jen pokud sou dvojice dobře
        if (in_array($key, array(6, 7, 8, 9, 10, 11))) {
            if ($key % 2 == 0) {
                if ((strpos($check_test, "/") === false) and (strpos($results[$key + 1], "/") === false)) {
                    $spravne_test++;
                    $procenta++;
                } else {
                    if ((strlen($check_test) == 3) or (strlen($results[$key + 1]) == 3)) {
                        $spatne_test++;
                        $procenta -= 0.25;
                    } else {
                        $nezod_test++;
                    }
                }
            }
        } else {
            if ((strpos($check_test, "/") === false) and (strpos($check_test, "-") === false)) {
                $spravne_test++;
                $procenta++;
            } else {
                if (strlen($check_test) == 3) {
                    $spatne_test++;
                    if (strpos($check_test, "-") === false) $procenta -= 0.25;
                    else $procenta -= 0.333333;
                } else {
                    $nezod_test++;
                }
            }
        }
    }
    test_show("{$OSP_SQL[0]['test_id']}. Test OSP - VÝSLEDKY", $spravne_test, $spatne_test, $nezod_test,
        $procenta, $OSP_SQL[0]['test_id'], array(1 => "Verbální oddíl", 2 => "Analytický oddíl"), $results);
}
//####################################################################################################################################################################//
//######################################################################## test generovaný ###########################################################################//
//####################################################################################################################################################################//
else if ($OSP_FOUND == 1) {
    $results = json_decode($OSP_SQL[0]["results"], true);
    $questions = json_decode($OSP_SQL[0]["questions"], true);
    $spravne_test = 0;
    $spatne_test = 0;
    $nezod_test = 0;
    foreach ($results as $key => $check_test){
        if(strpos($check_test, "/") === false){
            $spravne_test = ++$spravne_test;
        } else {
            if(strlen($check_test) != 2){
                $spatne_test = ++$spatne_test;
            } else {
                $nezod_test = ++$nezod_test;
            }
        }
    }
    foreach ($questions as $key => $value) {
        ${'v_sql'.$key} = $wpdb->get_results("SELECT * FROM ulohy WHERE id='". $value ."' LIMIT 1", ARRAY_A);
    }
    echo "<h1>Generovaný Test OSP - VÝSLEDKY</h1>";
    $sablona = '<br />
                  <p style="float:left">
                  Správně: <span class="spravno">[-spravne/test-]</span>/[-plnypocet-] &emsp; špatně: <span class="spatno">[-spatne/test-]</span>/[-plnypocet-]&emsp; nezodpovězeno: <span class="nezod">[-nezod/test-]</span>/[-plnypocet-]&emsp;&emsp; &emsp;
                  </p>
                  
                  <table style="border: 1px solid #000; padding: 8px; min-width: 300px; float:right;">
                  <tr>
                  <td>Legenda:</td>
                  <td> &emsp; &emsp; &emsp; &emsp; &emsp;</td>
                  <td> <span class="spravne-legend">Správná odpověď</span></td>
                  </tr>
                  <tr>
                  <td></td>
                  <td> &emsp; &emsp; &emsp; &emsp; &emsp;</td>
                  <td> <span class="spatne-legend">Špatná odpověď</span></td>
                  </tr>
                  <tr>
                  <td></td>
                  <td> &emsp; &emsp; &emsp; &emsp; &emsp;</td>
                  <td> <span class="neod-legend">Nezvolená správná</span></td>
                  </tr>
                  </table>
                  <div class="clear"></div>
                  <br />
                  <ol class="osp_test">';
    $sablona = replace($sablona, "spravne/test", $spravne_test);
    $sablona = replace($sablona, "spatne/test", $spatne_test);
    $sablona = replace($sablona, "nezod/test", $nezod_test);
    $sablona = replace($sablona, "plnypocet", count($results));
    echo clearAll($sablona);
    foreach ($results as $key=>$value){
        $vysvetleni = '<br /><li>[-v_zadani-][-fotka-][-otazka-]<br />';
        $odpovedi = '<span class="[-dobre_spatne/1-] [-dobre_spatne-1-]">A: [-v_zadani_1-]</span><br />
                    <span class="[-dobre_spatne/2-] [-dobre_spatne-2-]">B: [-v_zadani_2-]</span><br />
                    <span class="[-dobre_spatne/3-] [-dobre_spatne-3-]">C: [-v_zadani_3-]</span><br />
                    <span class="[-dobre_spatne/4-] [-dobre_spatne-4-]">D: [-v_zadani_4-]</span><br />';
        if ( ${'v_sql'.$key}[0]["o5"] != "") {
            $odpovedi .= '<span class="[-dobre_spatne/5-] [-dobre_spatne-5-]">E: [-v_zadani_5-]</span><br />';
            $odpovedi = replace($odpovedi, "v_zadani_5", ${'v_sql'.$key}[0]["o5"]);
        }
        $vysvetleni = replace($vysvetleni, "v_zadani", ${'v_sql'.$key}[0]["text"]);
        $vysvetleni = replace($vysvetleni, "otazka", ${'v_sql'.$key}[0]["otazka"]);
        $odpovedi .= '</li><br /><hr />';
        if(${'v_sql'.$number}[0]["fotka"] != ""){ $vysvetleni = replace($vysvetleni, "fotka", '<div style="margin: 0 auto; width: fit-content;"><a href="/ulohy/'.${'v_sql'.$number}[0]["fotka"].'" data-lightbox="fotka[uloha]" title="Fotografie k úloze"><img src="/ulohy/'.${'v_sql'.$number}[0]["fotka"].'" style="max-width: 90%; max-height: 350px;" alt="Fotografie k úloze" /></a></div>');}
        else { $vysvetleni = replace($vysvetleni, "fotka", '' );}
        if (strlen($value) == 2) {
            $prvni = my_strstr($value, '/');
            $odpovedi = replace($odpovedi, "dobre_spatne".$prvni, "neod");
        } else {
            if (strpos($value, "/") === false){
                $odpovedi = replace($odpovedi, "dobre_spatne/".$value, "spravne");
            } else {
                $prvni = my_strstr($value, '/', true);
                $druhy = my_strstr($value, '/');
                $odpovedi = replace($odpovedi, "dobre_spatne/".$prvni, "spatne");
                $odpovedi = replace($odpovedi, "dobre_spatne".$druhy, "neod");
            }
        }
        $odpovedi = replace($odpovedi, "v_zadani_1", ${'v_sql'.$key}[0]["o1"]);
        $odpovedi = replace($odpovedi, "v_zadani_2", ${'v_sql'.$key}[0]["o2"]);
        $odpovedi = replace($odpovedi, "v_zadani_3", ${'v_sql'.$key}[0]["o3"]);
        $odpovedi = replace($odpovedi, "v_zadani_4", ${'v_sql'.$key}[0]["o4"]);
        echo $vysvetleni;
        echo $odpovedi;
    }
}


