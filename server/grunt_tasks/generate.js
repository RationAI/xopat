require("console");
const inquirer = require("inquirer");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

module.exports = function(grunt) {
  // initialize grunt configuration
  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json")
  });

  // register task
  grunt.registerTask("generate", "Generate a plugin or module", async function(type) {

    /**
     * Ask question
     * @param query
     * @param mandatory
     * @return {Promise<unknown>}
     */
    function askQuestion(query, mandatory = true) {
      // return answer promise
      return new Promise((resolve, reject) => {
        // styled query
        const coloredQuery = `\n\x1b[38;2;50;163;219m→ ${query}\x1b[0m`;
        rl.question(coloredQuery, answer => {
          const res = answer.trim();
          if (res || !mandatory) {
            resolve(res);
          } else {
            resolve("");
          }
        });
      });
    }


    /**
     * Select module
     * @return {Promise<string[]>}
     */
    async function selectModules() {
      // Get the list of available modules from the 'modules' folder
      const modules = grunt.util.reduceModules( (acc, module, folder) => {
        acc.push({name: module.name, value: module.id});
        return acc;
      }, []);

      const prompt = inquirer.createPromptModule();
      const answer = await prompt([
        {
          type: 'checkbox',
          name: 'selectedModules',
          message: 'Select one or more modules:',
          choices: modules,
        },
      ]);
      return answer.selectedModules;
    }

    /**
     * Ask question with attempts option
     * @param question query string
     * @param parser if undefined, the question is treated as nonmandatory, else a parser that returns value or falsey
     *    value upon error
     * @param errorMessage error to show when parser returns falsey value
     * @param maxAttempts
     * @return {Promise<*>}
     */
    async function askWithValidation(question, parser, errorMessage = "", maxAttempts = 3) {
      let attempts = 0;

      const mandatory = !!parser;
      while (attempts < maxAttempts) {
        if (!mandatory) question = question + " (optional)";
        const answer = await askQuestion(question + ": ", mandatory);
        if (!mandatory) return answer;
        const data = parser(answer);
        if (data) {
          return data; // Valid answer
        }

        console.log(`Invalid input. ${errorMessage}`);
        attempts++;
      }

      throw new Error(`Failed to provide a valid input after ${maxAttempts} attempts.`);
    }

    async function askYesNo(question, maxAttempts = 3) {
      const answer = await askWithValidation(
          question + " (y/n)",
          x => {
            x = x.toLowerCase();
            return x === "y" || x === "n" ? x : false
          },
          "Use y or n to answer yes or no.",
          maxAttempts
      );
      return answer === "y";
    }

    // ---------------------------------------
    // function to create directory and files
    // ---------------------------------------
    function createFiles(folderPath, jsContent, jsonContent, cssContent = "") {
      try {
        // create folder and files
        fs.mkdirSync(folderPath, { recursive: true });
        fs.writeFileSync(
          path.join(folderPath, "include.json"),
          JSON.stringify(jsonContent, null, 2)
        );
        fs.writeFileSync(
          path.join(folderPath, `${jsonContent.id}.js`),
          jsContent
        );

        // create css file if content is provided
        if (cssContent)
          fs.writeFileSync(path.join(folderPath, "style.css"), cssContent);
      } catch (error) {
        throw new Error("error creating files.");
      }
    }


    // --------------------------
    // function to create plugin
    // --------------------------
    async function createPlugin(basePath, pluginName, createClass, className) {
      // create folder path
      const folderPath = path.join(basePath, pluginName);

      // ask for full name and check
      let name = await askWithValidation("Enter the full name for your plugin", x => x.trim(), "Name is required!");
      name = name.replace(/[^a-zA-Z0-9]/g, "");

      // ask for author and check
      let author = await askWithValidation("Enter the plugin author", x => x.trim(), "Author required!");
      author = author.replace(/[^a-zA-Z0-9]/g, "");

      // ask for description (optional)
      let description = await askWithValidation("Enter the plugin description", false);
      description = description.replace(/[^a-zA-Z0-9]/g, "");

      let modules = [];
      if (await askYesNo("Do you want to add modules?")) {
        modules = await selectModules();
      }

      // template content
      const jsContent = createClass
          ? `// '${pluginName}' plugin class\nclass ${className} extends XOpatPlugin {\n  constructor(id) { super(id); }\n  pluginReady() { alert('hello world'); }\n}\naddPlugin('${pluginName}', ${className});`
          : `// '${pluginName}' plugin\naddPlugin('${pluginName}', class extends XOpatPlugin {\n  constructor(id) { super(id); }\n  pluginReady() { alert('hello world'); }\n});`;

      // create json content
      const jsonContent = {
        id: pluginName,
        name,
        author,
        version: "1.0.0",
        description,
        includes: [`${pluginName}.js`],
        modules
      };
      const cssContent = "/* ADD YOUR CSS STYLES HERE */";

      // create files
      createFiles(folderPath, jsContent, jsonContent, cssContent);

      // log success
      console.log(
          `\x1b[38;2;43;199;121m`,
          `\n✓ SUCCESS: plugin '${pluginName}' created.`
      );
    }


    // --------------------------
    // function to create module
    // --------------------------
    async function createModule(basePath, moduleName, classType, className) {
      // create folder path
      const folderPath = path.join(basePath, moduleName);
      // ask for full name and check
      let name = await askWithValidation("Enter the full name for your module", x => x.trim(), "Name is required!");
      name = name.replace(/[^a-zA-Z0-9]/g, "");

      // ask for author and check
      let author = await askWithValidation("Enter the module author", x => x.trim(), "Author required!");
      author = author.replace(/[^a-zA-Z0-9]/g, "");

      // ask for description (optional)
      let description = await askWithValidation("Enter the module description", false);
      description = description.replace(/[^a-zA-Z0-9]/g, "");

      let requirements = [];
      if (await askYesNo("Do you want to add any required modules?")) {
        requirements = await selectModules();
      }

      // template content
      const jsContent =
          classType === "class"
              ? `// '${moduleName}' module class\n(function () {\n  class ${className} extends XOpatModule {\n    constructor() { alert('hello world'); }\n  }\n  new ${className}();\n})();`
              : classType == "singleton"
                  ? `// '${moduleName}' module singleton class\n(function () {\n  class ${className} extends XOpatModuleSingleton {\n    constructor() { alert('hello world'); }\n  }\n  new ${className}();\n})();`
                  : `// '${moduleName}' module\n(function () {\n  alert('hello world');\n})();`;

      // create json content
      const jsonContent = {
        id: moduleName,
        name: name,
        author: author,
        version: "0.1.0",
        includes: [`${moduleName}.js`],
        requires: requirements
      };
      if (description) jsContent["description"] = description;

      // create files
      createFiles(folderPath, jsContent, jsonContent);

      // log success
      console.log(
          `\x1b[38;2;43;199;121m`,
          `\n✓ SUCCESS: module '${moduleName}' created.`
      );
    }


    async function initCreate(structureType) {
      let isPlugin = structureType === "plugin";

      // ask for name and check
      let id = await askWithValidation(`Enter ${structureType} id`, x => {
        x = x.trim();
        const reducer = isPlugin ? grunt.util.reducePlugins : grunt.util.reduceModules;
        if (reducer((acc, value, folder) => acc && value.id !== x, true)) return x;
        return false;
      }, "ID is required! Id must not be taken by existing " + structureType);
      id = id.replace(/[^a-zA-Z0-9]/g, "");

      let createClass = await askYesNo(`Do you want to create a class for your ${structureType}`);
      // ask for module-specific class type
      createClass = !isPlugin
          ? createClass
              ? await askWithValidation("XOpatModule class or XOpatModuleSingleton? (class/singleton)", x => {
                x = x.trim();
                if (x === "class" || x === "singleton") return x;
                return false;
              }, "You must specify one of class / singleton!")
              : ""
          : createClass;

      // ask for class name and check
      let className = createClass
          ? await askWithValidation(`Enter the name of your ${structureType} class`, x => x.trim(), "class name required")
          : "";
      className = className.replace(/[^a-zA-Z0-9]/g, "");

      // --------------------
      // folder path resolver
      // --------------------
      function findProjectRoot(startPath) {
        let currentDir = startPath;

        // Loop upwards until we find a 'package.json' (or use any other root marker)
        while (!fs.existsSync(path.join(currentDir, "package.json"))) {
          const parentDir = path.dirname(currentDir);

          // If we're at the root directory, stop searching
          if (currentDir === parentDir) {
            throw new Error("Project root directory not found.");
          }

          currentDir = parentDir;
        }

        return currentDir;
      }

      // define base path
      const basePath = path.join(
          findProjectRoot(__dirname),
          structureType === "plugin" ? "plugins" : "modules"
      );

      isPlugin
          ? await createPlugin(basePath, id, createClass, className)
          : await createModule(basePath, id, createClass, className);
    }

    ////// TASK LOGIC //////
    // define done function
    const done = this.async();

    // create readline interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      // check if type argument is provided
      if (type !== "plugin" && type !== "module") {
        grunt.log.error(
          "ERROR: please use either 'generate:plugin' or 'generate:module'"
        );
      } else {
        // initialize create process
        await initCreate(type, rl);
      }
    } catch (error) {
      console.log(`\x1b[38;2;206;60;49m`, `× ERROR: ${error.message}`);
    }
    rl.close();
    done();
  });
};
