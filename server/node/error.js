//todo add translation
const fs = require("node:fs");
const constants = require("./constants");

function throwFatalErrorIf(res, condition, title, description="", details="") {
    if (condition) {
        try {
            showError(title, description, details); //todo $_GET["lang"] ?? 'en'
        } catch (e) {
            throwFatalErrorIfFallback(res,true, title, description, details);
        }
        return true;
    }
    return false;
}

function throwFatalErrorIfFallback(res, condition, title, description, details="") {

    if (!fs.existsSync(constants.ABSPATH + "error.html")) {
        //try to reach the file externally
        res.setHeader('Location', "error.html");
        res.end();
        return;
    }
    //try to add additional info to the file

    const replacer = function(match, p1) {
        switch (p1) {
        case "error":
            return `
                <div class="collapsible" onclick="toggleContent()">Detailed Information</div>
                <div class="content">
                    <p>${description}</p>
                    <code>${details}</code>
                </div>`;
        default:
            break;
        }
        return "";
    }
    const html = fs.readFileSync(constants.ABSPATH +  "error.html", { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    res.write(html);
    res.end();
}



function showError(res, errTitle, errDesc, errDetails, locale='en') {

    // global $i18n;
    // if (!isset($i18n)) {
    //     require_once PHP_INCLUDES . 'i18n.class.php';
    //     $i18n = i18n::default($locale, LOCALES_ROOT);
    // }

    let title = errTitle ? errTitle : false;  //i18n.t(errTitle) : false;
    let description = errDesc ? errDesc : false; //i18n.t(errDesc) : false;
    if (!description) description = 'No details are available'; // i18n.t('error.noDetails');
    if (errDetails) description += "<br><code>"+errDetails+"</code>";

    let templateFile = constants.ABSPATH + "server/templates/error.html";
    if (!fs.existsSync(templateFile)) {
        return throwFatalErrorIfFallback(res, true, errTitle, errDesc, errDetails);
    }


    const replacer = function(match, p1) {
        switch (p1) {
        case "head":
            return `
${core.requireLib("primer")}
${core.requireCore("env")}
${core.requireLib("jquery")}`;

        case "text-title":
            return "Error"; //i18n.t('error.title');
        case "text-details":
            return "details"; //i18n.t('error.detailsBtn');
        case "custom":
            return core.GATEWAY ? `<button onclick="window.location='<?php echo GATEWAY; ?>'" class="btn" 
type="button">back</button>` : "";
        case "display-error-call":
            return `<script>DisplayError.show('${title}', \`${description}\`);<\/script>`;
        default:
            break;
        }
        return "";
    }

    const html = fs.readFileSync(templateFile, { encoding: 'utf8', flag: 'r' })
        .replace(constants.TEMPLATE_PATTERN, replacer);
    res.write(html);
    res.end();
}

module.exports = {
    throwFatalErrorIf
}
