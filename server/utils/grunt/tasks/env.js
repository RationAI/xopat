const {parse, stringify} = require("comment-json");
module.exports = function(grunt) {
    return function() {
        let shortReport = grunt.option('minimal');
        const fullReport = !(shortReport);

        grunt.log.write("Core configuration...\n");
        const output = [`
{
    /*********************************************************************************
     *        Core viewer configuration, defaults located at 'src/config.json'       *
     *                                                                               *
     *              To build example configuration file, run 'grunt env'             *
     *        Values unchanged are better to left commented/removed (=defaults)      *
     *           Configuration is written in JSON with comments (JS style)           *
     ********************************************************************************/        
    "core": 
    `];
        const core = grunt.file.read("src/config.json");
        const coreData = parse(core);
        delete coreData.version;
        if (!fullReport) {
            delete coreData.monaco;
            delete coreData.openSeadragonPrefix;
            delete coreData.openSeadragon;
            delete coreData.js;
            delete coreData.css;
        }
        output.push(stringify(coreData, null, '\t').replaceAll(/\n/g, '\n    '));
        grunt.log.write("Plugins configuration...\n");
        output.push(`,
    /*********************************************************************************
     * Plugins configuration, defaults located at 'plugins/[directory]/include.json' *
     *              To build example configuration file, run 'grunt env'             *
     *           Configuration is written in JSON with comments (JS style)           *
     ********************************************************************************/ 
    "plugins": {
        `);
        let pushed = grunt.util.reducePlugins((acc, plugin) => {
            let id = plugin.id;
            delete plugin.id;
            delete plugin.includes;
            delete plugin.requires;
            delete plugin.modules;
            delete plugin.version;
            delete plugin.author;
            delete plugin.icon;
            if (fullReport) {
                if (plugin.enabled === undefined) plugin.enabled = true;
            } else {
                delete plugin.name;
                delete plugin.description;
                delete plugin.permaLoad;
            }
            output.push('"', id, '": ', stringify(plugin, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            return true; //at least one plugin was parsed
        }, false, true);
        grunt.log.write("\n");
        if (pushed) output.pop();
        grunt.log.write("Modules configuration...\n");
        output.push(`
    },
    /*********************************************************************************
     * Modules configuration, defaults located at 'modules/[directory]/include.json' *
     *              To build example configuration file, run 'grunt env'             *
     *           Configuration is written in JSON with comments (JS style)           *    
     ********************************************************************************/ 
    "modules": {
        `);
        pushed = grunt.util.reduceModules((acc, module) => {
            let id = module.id;
            delete module.id;
            delete module.name;
            delete module.includes;
            delete module.version;
            delete module.requires;
            delete module.description;
            if (fullReport) {
                if (module.enabled === undefined) module.enabled = true;
            } else {
                if (Object.values(module).length < 1) return false;
            }
            output.push('"', id, '": ', stringify(module, null, '\t').replaceAll(/\n/g, '\n        '), `,\n        `);
            return true; //at least one module was parsed
        }, false, true);
        grunt.log.write("\n");
        if (pushed) output.pop();
        output.push(`
    }
}`);
        grunt.file.write("env/env.example.json", output.join(""));
        grunt.log.write("Saved: "+(fullReport ? 'full configuration' : 'minimal configuration' )+" in 'env/env.example.json'.\n");
    };
};
