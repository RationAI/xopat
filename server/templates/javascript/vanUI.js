const { parse } = require("comment-json");
const { safeScanDir } = require("./utils");

module.exports.loadUI = function (core, fileExists, readFile, scanDir, i18n) {

    const isType = core.isType;
    const UI = core.UI,
        ENV = core.ENV;

    let uiPaths = safeScanDir(core.ABS_UI + "/components");

    /**
     * Load all plugins
     * @param {boolean} production if true, prefer minified file over sources
     */
    core.requireUI = function (production) {
        if (production){
            return `<script src=\"ui/index.min.js\">` + "</script>";
        }
        let result = [`<script src=\"ui/index.mjs\" type=module>` + "</script>"];
        for(let p of uiPaths) {
            result.push(`\t<script src=\"ui/components/${p}\" type=module>` + "</script>");
        }
        return(result.join("\n")+"\n");
    }
}
