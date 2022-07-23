<?php

$id = get_current_user_id();
$base_url = '/test';
global $wpdb;

$test_meta = test_init($id);

if (count($test_meta) < 1) {
    if (isset($_POST["zacit"]) && $_POST["zacit"] > 0) {
        $data = array('login_id' => $id, 'test_id' => $_POST["zacit"], 'faze' => 'prvni_faze', 'datum' => time());
        $wpdb->insert('osp_test_tmp', $data);
        $test_meta = $wpdb->get_results($wpdb->prepare("SELECT * FROM osp_test_tmp WHERE login_id='%d' LIMIT 1", $id), ARRAY_A);
    } else {

    }
} else {
    echo "<h1>Online test: Medicína</h1>";
    if (!premium_internal($id, 'med_premium')) {
        echo '<p> <a class="login-trigger" href="/prihlaseni/">Přihlaš se</a> prosím na svůj prémiový účet.
          <br /> Pokud nemáš Prémiovy účet, můžeš si jej zakoupit <a href="/premiovy-ucet/"> ZDE.</a><br><br>Pokud máš rozdělaný test a systém tě vyhodil, <a href="/prihlaseni/">pro 
          obnovení testu se přihlaš.</a></p><p>Pokud jsi přihlášený, ale stále vidíš tuto zprávu, tvůj prohlížeč si pamatuje staré údaje: <b>obnov stránku stiskem Ctrl + F5</b>.';
    } else {
        echo "<ul>
             <li>Na test máš ?? minut. Po spuštění testu máš k dispozici odpočet času pro každý oddíl zvlášť. Jakmile ti čas dojde, oddíl právě řešeného testu se sám ukončí.</li>
             <li>Neaktualizuj prohlížeč během testu (při aktualizování přijdeš o své odpovědi daného oddílu).</li>
            </ul>
            <p class=\"tip\">
              <span class=\"important\"></span><span class=\"novee\">UPOZORNĚNÍ:</span>Testy, které mají více než 40 otázek nezodpovězených, se při dokončení automaticky zahazují.
            </p>
            <H2>Závěrečné testy s percentilem </H2> <br />
            <p>Test s percentilem obsahuje zcela nové úlohy, které nenajdeš mezi ostatními úlohami k procvičení. Úlohy jsou pevně dané a struktura, počet otázek i čas na vyplnění přesně odpovídají ostrým testům OSP od společnosti Scio.</p>
            <p>Po vyplnění se ti zobrazí percentil, který odpovídá tomu u Národních srovnávacích zkoušek. </p>
            <p>INFO: Tvůj výsledek se započítává do databáze řešení testu, a tak ovlivňuje percentil dalším uživatelům. </p>
            <div style=\"margin: 0 auto; max-width: 690px;\"><form action=\"$base_url\" class=\"odpoved-form\" method=\"post\" style=\"display: inline-block;margin: 10px 20px;\">
              <input type=\"hidden\" name=\"zacit\" value=\"4\" /> <input type=\"submit\" value=\"Spustit test ID 4\" />
            </form></div>
            <p class=\"tip\">
              <span class=\"important\"></span><span class=\"novee\">TIP:</span> 
              Každý test s percentilem můžeš vyplnit kolikrát chceš, bude však obsahovat vždy stejné úlohy. Zvaž tedy jestli si ho nechat na konec tvé přípravy, nebo ho vyplnit už na začátku.
            </p>";
    }
    return;
}

//TODO time?
if ($wpdb->num_rows != 0 && time() - $test_meta[0]["datum"] > 999999999) {
    //do not delete?
    $wpdb->delete('osp_test_tmp', array('login_id' => $id));
    echo '<div id="clona"></div>
          <div id="alert">
            <table><tbody>
             <tr>
               <td>Test byl spuštěn před dobou delší, než je vyhrazený limit na jeho dokončení. Ať už se rozhodnete nahlédnout do této otevřené stránky, nebo půjdete zpět, test byl již nenávratně odstraněn (náhled je zobrazen jen pro informaci, po jeho vytvoření byl test smazán).</td>
               <td> 
                <span class="closebtn"><a href="'.$base_url.'" style="text-decoration: none; margin-bottom: 8px" class="closebtn"><b>&nbsp;Zpět</b></a></span>
                <span class="closebtn" onclick="document.getElementById(\'alert\').setAttribute(\'style\', \'display:none\'); document.getElementById(\'clona\').setAttribute(\'style\', \'display:none\');ReturnCount(); "><b>Nahlédnout</b></span>  
               </td>
             </tr>
            </tbody></table>
          </div>';
}


$insert_labels_renderer = function($test_id, $part, $number) {

};

$test_meta = $test_meta[0];
if ($test_meta["faze"] == 'prvni_faze') {
    if ($_POST["finish_prvni"] == 1) {
        $test_meta = percentil_end_phase($test_meta["test_id"], 1, 'druha_faze', $id)[0];
    } else {
        percentil_phase($test_meta["test_id"], 1, 'finish_prvni',
            "(ID {$test_meta['test_id']}) Test Medicína - Biologie", $base_url, 35, $insert_labels_renderer);
    }
}
if ($test_meta["faze"] == 'druha_faze') {
    if ($_POST["finish_druhy"] == 1) {
        $test_meta = percentil_end_phase($test_meta["test_id"], 2, 'treti_faze', $id, $test_meta["results"]);
    } else {
        percentil_phase($test_meta["test_id"], 2, 'finish_druhy',
            "(ID {$test_meta['test_id']}) Test Medicína - Fyzika</h1>", $base_url, 50, $insert_labels_renderer);
    }
}
if ($test_meta["faze"] == 'treti_faze') {
    if ($_POST["finish_treti"] == 1) {
        $test_meta = percentil_end_phase($test_meta["test_id"], 3, 'vysledky', $id, $test_meta["results"]);
    } else {
        percentil_phase($test_meta["test_id"], 3, 'finish_treti',
            "(ID {$test_meta['test_id']}) Test Medicína - Chemie</h1>", $base_url, 50, $insert_labels_renderer);
    }
}

if ($test_meta["faze"] == 'vysledky') {
    percentil_finish($test_meta["test_id"], array(1 => "Biologie", 2 => "Fyzika", 3 => "Chemie"), "Medicína - VÝSLEDKY", $id, $test_meta["results"]);
}


