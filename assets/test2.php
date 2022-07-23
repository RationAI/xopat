<?php





$id = get_current_user_id();
$base_url = '/osp-test';
global $wpdb;

$OSP_SQL = test_init($id);

if (count($OSP_SQL) < 1 && $_POST["zacit"] == -1) {
    $ULOHY_VYBRANE_ID = array();
    //doplnovani do vet
    $check_sql_doplnovani = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='2' ORDER BY RAND() LIMIT 3", ARRAY_A);
    foreach ($check_sql_doplnovani as $row_doplnovani) {
        array_push($ULOHY_VYBRANE_ID, $row_doplnovani['id']);
    }
    //vztahy mezi slovy
    $check_sql_vztahy = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='1' ORDER BY RAND() LIMIT 3", ARRAY_A);
    foreach ($check_sql_vztahy as $row_vztahy) {
        array_push($ULOHY_VYBRANE_ID, $row_vztahy['id']);
    }
    //antonyma
    $check_sql_anton = $wpdb->get_results("SELECT id,podulohy FROM ulohy WHERE typ_ulohy='4' AND podulohy NOT LIKE 'isChild' ORDER BY RAND() LIMIT 3", ARRAY_A);
    foreach ($check_sql_anton as $row_anton) {
        array_push($ULOHY_VYBRANE_ID, $row_anton['id']);
        $children = explode(",", substr($row_anton['podulohy'], 7));
        $ULOHY_VYBRANE_ID = array_merge($ULOHY_VYBRANE_ID, $children);
    }
    //co neni v souladu
    $check_sql_soulad = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='13' ORDER BY RAND() LIMIT 6", ARRAY_A);
    foreach ($check_sql_soulad as $row_soulad) {
        array_push($ULOHY_VYBRANE_ID, $row_soulad['id']);
    }
    //kratke texty
    $check_sql_kratke = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='15' ORDER BY RAND() LIMIT 8", ARRAY_A);
    foreach ($check_sql_kratke as $row_kratke) {
        array_push($ULOHY_VYBRANE_ID, $row_kratke['id']);
    }
    //dlouhe texty
    $check_sql_dlouhe = $wpdb->get_results("SELECT id,podulohy FROM ulohy WHERE typ_ulohy='3' AND podulohy NOT LIKE 'isChild' ORDER BY RAND() LIMIT 2", ARRAY_A);
    foreach ($check_sql_dlouhe as $row_dlouhe) {
        array_push($ULOHY_VYBRANE_ID, $row_dlouhe['id']);
        $children = explode(",", substr($row_dlouhe['podulohy'], 7));
        $ULOHY_VYBRANE_ID = array_merge($ULOHY_VYBRANE_ID, $children);
    }
    //porovnavani dvou textu
    $check_sql_dvatexty = $wpdb->get_results("SELECT id,podulohy FROM ulohy WHERE typ_ulohy='14' AND podulohy NOT LIKE 'isChild' ORDER BY RAND() LIMIT 1", ARRAY_A);
    foreach ($check_sql_dvatexty as $row_dvatexty) {
        array_push($ULOHY_VYBRANE_ID, $row_dvatexty['id']);
        $children = explode(",", substr($row_dvatexty['podulohy'], 7));
        $ULOHY_VYBRANE_ID = array_merge($ULOHY_VYBRANE_ID, $children);
    }
    //grafy a tabulky
    $check_sql_grafy = $wpdb->get_results("SELECT id,podulohy FROM ulohy WHERE typ_ulohy='9' AND podulohy NOT LIKE 'isChild' ORDER BY RAND() LIMIT 2", ARRAY_A);
    foreach ($check_sql_grafy as $row_grafy) {
        array_push($ULOHY_VYBRANE_ID, $row_grafy['id']);
        $children = explode(",", substr($row_grafy['podulohy'], 7));
        $ULOHY_VYBRANE_ID = array_merge($ULOHY_VYBRANE_ID, $children);
    }
    //porovnavani hodnot
    $check_sql_hodnot = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='5' ORDER BY RAND() LIMIT 6", ARRAY_A);
    foreach ($check_sql_hodnot as $row_hodnot) {
        array_push($ULOHY_VYBRANE_ID, $row_hodnot['id']);
    }
    //uplnost zadani
    $check_sql_uplnost = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='10' ORDER BY RAND() LIMIT 3", ARRAY_A);
    foreach ($check_sql_uplnost as $row_uplnost) {
        array_push($ULOHY_VYBRANE_ID, $row_uplnost['id']);
    }
    //slovni ulohy
    $check_sql_slovni = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='6' ORDER BY RAND() LIMIT 8", ARRAY_A);
    foreach ($check_sql_slovni as $row_slovni) {
        array_push($ULOHY_VYBRANE_ID, $row_slovni['id']);
    }
    //materializace textu
    $check_sql_mater = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='7' ORDER BY RAND() LIMIT 2", ARRAY_A);
    foreach ($check_sql_mater as $row_mater) {
        array_push($ULOHY_VYBRANE_ID, $row_mater['id']);
    }
    //vynechavky
    $check_sql_vynechavky = $wpdb->get_results("SELECT id FROM ulohy WHERE typ_ulohy='8' ORDER BY RAND() LIMIT 1", ARRAY_A);
    foreach ($check_sql_vynechavky as $row_vynechavky) {
        array_push($ULOHY_VYBRANE_ID, $row_vynechavky['id']);
    }
    //zebry
    $check_sql_zebry = $wpdb->get_results("SELECT id,podulohy FROM ulohy WHERE typ_ulohy='12' AND podulohy NOT LIKE 'isChild' ORDER BY RAND() LIMIT 2", ARRAY_A);
    foreach ($check_sql_zebry as $row_zebry) {
        array_push($ULOHY_VYBRANE_ID, $row_zebry['id']);
        $children = explode(",", substr($row_zebry['podulohy'], 7));
        $ULOHY_VYBRANE_ID = array_merge($ULOHY_VYBRANE_ID, $children);
    }
    $data = array('login_id' => $id, 'questions' => json_encode($ULOHY_VYBRANE_ID), 'faze' => 'generuj_verbalni', 'datum' => time());
    $wpdb->insert('osp_test_tmp', $data);
    //insert and retrieve
    $OSP_SQL = $wpdb->get_results($wpdb->prepare("SELECT * FROM osp_test_tmp WHERE login_id='%d' LIMIT 1", $id), ARRAY_A);
} else if (count($OSP_SQL) < 1 && $_POST["zacit"] > 0) {
    $test_id = 0;
    switch ($_POST["zacit"]) {
        //allowed only three at this time
        case "1":
            $test_id = 1;
            break;
        case "2":
            $test_id = 2;
            break;
        case "3":
            $test_id = 3;
            break;
        default:
            break;
    }
    if ($test_id > 0) {
        $data = array('login_id' => $id, 'test_id' => $test_id, 'faze' => 'percentil_verbalni', 'datum' => time());
        $wpdb->insert('osp_test_tmp', $data);
        $OSP_SQL = $wpdb->get_results($wpdb->prepare("SELECT * FROM osp_test_tmp WHERE login_id='%d' LIMIT 1", $id), ARRAY_A);
    }
}
//CHECK IF DATUM > 80mins (+reserve)
if ($wpdb->num_rows != 0 && time() - $OSP_SQL[0]["datum"] > 7200) {
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

$OSP_FOUND = $wpdb->num_rows;
if ($OSP_FOUND < 1) {
    echo "<h1>Test OSP</h1>";
    if (!premium_osp($id)) {
        echo '<p> <a class="login-trigger" href="/prihlaseni/">Přihlaš se</a> prosím na svůj prémiový účet.
          <br /> Pokud nemáš Prémiovy účet, můžeš si jej zakoupit <a href="/premiovy-ucet/"> ZDE.</a><br><br>Pokud máš rozdělaný test a systém tě vyhodil, <a href="/prihlaseni/">pro 
          obnovení testu se přihlaš.</a></p><p>Pokud jsi přihlášený, ale stále vidíš tuto zprávu, tvůj prohlížeč si pamatuje staré údaje: <b>obnov stránku stiskem Ctrl + F5</b>.';
    } else {
        echo "<ul>
             <li>Na test máš 85 (35 + 50) minut. Po spuštění testu máš k dispozici odpočet času pro každý oddíl zvlášť. Jakmile ti čas dojde, oddíl právě řešeného testu se sám ukončí.</li>
             <li>Neaktualizuj prohlížeč během testu (při aktualizování přijdeš o své odpovědi daného oddílu).</li>
            </ul>
            <p class=\"tip\">
              <span class=\"important\"></span><span class=\"novee\">UPOZORNĚNÍ:</span>Testy, které mají více než 40 otázek nezodpovězených, se při dokončení automaticky zahazují.
            </p>
            <H2>Závěrečné testy s percentilem </H2> <br />
            <p>Test s percentilem obsahuje zcela nové úlohy, které nenajdeš mezi ostatními úlohami k procvičení. Úlohy jsou pevně dané a struktura, počet otázek i čas na vyplnění přesně odpovídají ostrým testům OSP od společnosti Scio.</p>
            <p>Po vyplnění se ti zobrazí percentil, který odpovídá tomu u Národních srovnávacích zkoušek. </p>
            <p>Testy obsahují 66 úloh, ale pozor na značení: úlohy s hledáním synonym a antonym se vyhodnocují podle nových testů SCIO, tedy musíš mít <b>\"obě\"</b> úlohy ke větě dobře, aby byl započítán bod. Scio testy je značí A-J, my zde používáme stejnou šablonu pro všechny úlohy, takže je zde 2x A-E, nicméně vyhodnocení je stejné. </p>
            <p>INFO: Tvůj výsledek se započítává do databáze řešení testu, a tak ovlivňuje percentil dalším uživatelům. </p>
            <div style=\"margin: 0 auto; max-width: 690px;\"><form action=\"$base_url\" class=\"odpoved-form\" method=\"post\" style=\"display: inline-block;margin: 10px 20px;\">
              <input type=\"hidden\" name=\"zacit\" value=\"1\" /> <input type=\"submit\" value=\"Spustit test 1)\" />
            </form>
            <form action=\"$base_url\" class=\"odpoved - form\" method=\"post\" style=\"display: inline-block;margin: 10px 20px;\">
              <input type=\"hidden\" name=\"zacit\" value=\"2\" /> <input type=\"submit\" value=\"Spustit test 2)\" />
            </form>
            <form action=\"$base_url\" class=\"odpoved - form\" method=\"post\" style=\"display: inline-block;margin: 10px 20px;\">
              <input type=\"hidden\" name=\"zacit\" value=\"3\" /> <input type=\"submit\" value=\"Spustit test 3)\" />
            </form></div>
            <p class=\"tip\">
              <span class=\"important\"></span><span class=\"novee\">TIP:</span> 
              Každý test s percentilem můžeš vyplnit kolikrát chceš, bude však obsahovat vždy stejné úlohy. Zvaž tedy jestli si ho nechat na konec tvé přípravy, nebo ho vyplnit už na začátku.
            </p>
            <H2>Generovaný test </H2> <br />
            <p>Generovaný test se poskládá z náhodných úloh v naší databázi tak, aby simuloval testy OSP od společnosti Scio. Díky tomu si můžeš těchto testů vyzkoušet libovolný počet a žádné dva nebudou stejné. <br />(Může se ale stát, že se v nich budou opakovat některé úlohy.)</p>
            <p>Tyto testy se od ostrých OSP testů mohou mírně lišit počtem úloh, strukturou nebo obtížností (problémy s univerzálností scriptu). Věříme ale, že ti pomohou seznámit se se strukturou testů OSP.</p>
            <p>Protože každý takto generovaný test je originál, tak ve vyhodnocení neuvidíš percentil, ale jen porovnání správných a tvých odpovědí.</p>
            <form action=\"$base_url\" class=\"odpoved-form\" method=\"post\">
             <fieldset class=\"send\"><input type=\"hidden\" name=\"zacit\" value=\"-1\" /> <input type=\"submit\" value=\"Spustit generovaný test\"/></fieldset>
            </form>";
    }
    return;
}





// HARDCODED OLD, switch order with echo notice!!








$echo_notice = function($test_id, $part, $number) {
    if ($part == 1) {
        if ($number == 0) {
            echo '<p class="hint">Doplňte z nabízených možností do vynechaných míst slova, která se do příslušné/ých vět/y <b>nejlépe</b> významově a stylisticky hodí.</p>';
            return;
        }
        $msgs = array("U každé z následujících úloh vyberte z nabízených možností tu, která má významový vztah mezi výrazy nejpodobnější významovému vztahu mezi dvojicí výrazů v zadání. <b>Pořadí výrazů ve dvojici je podstatné.</b>",
            "V následujících úlohách vyberte z nabízených možností výraz, který ve smyslu věty se nejvíce blíží podtrženému výrazu v zadání (synonymum). Poté u navazující úlohy vyberte výraz nejblíže opačnému významu podtrženého slova (antonymum). Zde ignorujte čísla otázek, synonymum a antonymum k jedné větě je jako jedna otázka a musíte mít obě dobře, aby je systém vyhodnotil jako jednu správnou odpověď.",
            "V každém z textu je jedna část, která do něj svým vyzněním nesedí. U každé z úloh zvolte právě tu část, která není v souladu s celkovým vyzněním celého textu.",
            "Všechny úlohy u každého textu řešte pouze na základě informací, které z textu vyplývají, nebo jsou v něm obsaženy.",
            "Za textem jsou úlohy, které souvisí s obsahem. Přečtěte si uvedený text a poté následně pracujte s informacemi, které jsou obsaženy v textu, nebo z něj vyplývají, abyste mohl/a zodpovědět dané otázky.",
            "Po dvou textech následují otázky sestaveny na základně jejich obsahu. Všechny úlohy řešte z informací, co jste se dozvěděli v textech, nebo z toho co z nich vyplývá. Přečtěte si oba texty a poté vyberte nejvhodnější odpověď. Vždy si pečlivě přečtěte otázku, otázky mohou být podobné.");
        switch ($test_id) {
            case 0: $test_positions = array(4=>0,7=>1,10=>2,16=>3,24=>4,26=>5); break;
            case 1: $test_positions = array(3=>0,6=>1,12=>2,18=>3,26=>4,32=>5); break;
            case 2: $test_positions = array(3=>0,6=>1,12=>2,18=>3,26=>4,32=>5); break;
            case 3: $test_positions = array(3=>0,6=>1,12=>2,18=>3,26=>4,32=>5); break;
            default: return;
        }
    } else if ($part == 2) {
        if ($number == 0) {
            echo '<p class="hint">Kalkulačky nejsou povoleny! Všechna čísla jsou reálná, není-li uvedeno jinak. Čáry, které se jeví jako přímé považujte za přímky. Pokud je u části geometrického obrazce umístěné číslo, tak označuje velikost této části. <b>Nelze činit žádné předpoklady o velikosti neoznačených částí obrazců.</b> Geometrické úlohy se řešte matematickými znalostmi, nikoliv odhadem či měřením z obrázku.</p>';
            return;
        }
        $msgs = array("V následujících úlohách je vašim úkolem porovnat hodnoty vlevo a vpravo a podle toho zvolit správnou odpověď. Informace k výrazům jsou uvedeny nad nimi.",
            "Úlohy v následujícím cvičení jsou složeny z otázky a dvou tvrzení (1) a (2), ty obsahují jisté informace. U některých úloh jsou obsaženy informace v úvodu. Za pomoci všech těchto informací, znalostí matematiky a objektivních známých faktů (např. Kolik je dní v roce nebo v určitých měsících...) rozhodnete, jestli jste schopni určit,<b> zda jsou uvedené informace dostatečné</b> pro zodpovězení otázky.",
            "",
            "Všechny z následujících úloh jsou založeny na<b> textu</b> nebo na nějaké matematické <b>rovnici, nerovnici, zápisu funkce</b>, nebo na jiném matematickém výrazu, případně ne kombinaci. Vyřešení úlohy spočívá v matematizaci jisté situaci nebo naopak v převedení  zadání do textové podoby. <b>Nezapomeňte si pořádně přečíst otázku</b> –  i zdánlivě podobná zadání se mohou lišit.",
            "Všechny z následujících úloh jsou založeny na textu a několika podmínkách. Dbejte na to, které podmínky jsou pro celou úlohu, a které pouze pro jednotlivé otázky. U některých úloh si můžete pomoci náčrtkem.");
        switch ($test_id) {
            case 0: $test_positions = array(3=>0,9=>1,18=>false,20=>3,23=>4); break;
            case 1: $test_positions = array(9=>0,15=>1,18=>2,25=>3,29=>4); break;
            case 2: $test_positions = array(9=>0,12=>1,15=>2,22=>3,26=>4); break;
            case 3: $test_positions = array(9=>0,15=>1,18=>2,25=>3,29=>4); break;
            default: return;
        }
    } else return;
    $idx = $test_positions[$number];
    if ($idx) echo "<hr class=\"hrtop\" /><p class=\"hint\">{$msgs[$idx]}</p>";
};




if ((count($OSP_SQL) == 1) and ($OSP_SQL[0]["faze"] == 'percentil_verbalni')) {
    if ($_POST["finish_verbalni"] == 1) {
        $OSP_SQL = percentil_end_phase($OSP_SQL[0]["test_id"], 1, 'percentil_analyticky', $id);
    } else {
        percentil_phase($OSP_SQL[0]["test_id"], 1, 'finish_verbalni',
            "{$OSP_SQL[0]['test_id']}. Test OSP - VERBÁLNÍ ODDÍL", $base_url, 35, $echo_notice);
    }
}
if ((count($OSP_SQL) == 1) and ($OSP_SQL[0]["faze"] == 'percentil_analyticky')) {
    if ($_POST["finish_analyticky"] == 1) {
        $OSP_SQL = percentil_end_phase($OSP_SQL[0]["test_id"], 2, 'percentil_vysledky', $id, $OSP_SQL[0]["results"]);
    } else {
        percentil_phase($OSP_SQL[0]["test_id"], 2, 'finish_analyticky',
            "{$OSP_SQL[0]['test_id']}. Test OSP - ANALYTICKÝ ODDÍL</h1>", $base_url, 50, $echo_notice);
    }
}

if ((count($OSP_SQL) == 1) and ($OSP_SQL[0]["faze"] == 'percentil_vysledky')) {
    percentil_finish($OSP_SQL[0]["test_id"], array(1 => "Verbální oddíl", 2 => "Analytický oddíl"), "Test OSP - VÝSLEDKY", $id, $OSP_SQL[0]["results"]);
}





