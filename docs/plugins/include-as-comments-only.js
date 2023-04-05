// jsdocPlugin.js
var commentPattern = /\/\*\*[\s\S]+?\*\//g,
    notNewLinePattern = /[^\n]/g,
    extname = require('path').extname,
    comments,
    logger = require('jsdoc/util/logger');

exports.handlers = {
    beforeParse: function (e, opts) {
        //todo somehow access opts to provide extensions dynamically
        let ext = extname(e.filename), alloverExt = ['css', 'json'].map(x => `.${x}`);
        if (alloverExt.includes(ext)) {
            logger.warn(JSON.stringify(opts));

            logger.warn('File in comments-mode only: '+ e.filename);
            comments = e.source.match(commentPattern);
            e.source = comments ? e.source.split(commentPattern).reduce(function(result, source, i) {
                return result + source.replace(notNewLinePattern, '') + comments[i];
            }, '') : e.source.replace(notNewLinePattern, '');
        }
    }
};
