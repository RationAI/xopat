module.exports = function(grunt) {
    return function (file) {
        const config = require(file || './docs/openseadragon.conf');
        grunt.file.write('./docs/build/docs.conf.json', JSON.stringify(config));
        grunt.file.copy('./docs/assets/xopat-banner.png', './docs/build/docs/assets/xopat-banner.png');
        const result = grunt.util.execAtPath('./node_modules/.bin/jsdoc', '-c ./docs/build/docs.conf.json --verbose');
        grunt.log.writeln(result);
    };
};
