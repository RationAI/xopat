module.exports = function(grunt) {
    return function (file) {
        try {
            const config = require(grunt.util.getPath(file || 'docs/openseadragon.conf'));
            grunt.file.write(grunt.util.getPath('docs/build/docs.conf.json'), JSON.stringify(config));
            grunt.file.copy(grunt.util.getPath('docs/assets/xopat-banner.png'), grunt.util.getPath('docs/build/docs/assets/xopat-banner.png'));
            const result = grunt.util.execAtPath('node_modules/.bin/jsdoc', `-c ${grunt.util.getPath("docs/build/docs.conf.json")} --verbose`);
            grunt.log.writeln(result);
        } catch (e) {
            grunt.log.error(e);
        }
    };
};
