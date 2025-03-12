const { parse } = require("comment-json");
const { safeScanDir } = require("./utils");

module.exports.loadUI = function (core, fileExists, readFile, scanDir, i18n) {

    const isType = core.isType;
    const UI = core.UI,
        ENV = core.ENV;

    UI = safeScanDir(core.ABS_UI + "/components");

    /**
     * Load all plugins
     * @param {boolean} production if true, prefer minified file over sources
     */
    core.requireUI = function (production) {
        // TODO check
        return UI.map(UI => {
            return `<script src=${UI}'>` + "</script>";
        })
    }.join("");
}
