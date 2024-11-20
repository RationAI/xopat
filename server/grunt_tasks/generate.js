require("console");

module.exports = function(grunt) {
  // required modules
  const path = require("path");
  const fs = require("fs");
  const readline = require("readline");

  // initialize grunt configuration
  grunt.initConfig({
    pkg: grunt.file.readJSON("package.json")
  });

  // register task
  grunt.registerTask("generate", "Generate a plugin or module", async function(
    type
  ) {


    // --------------------------
    // function to handle errors
    // --------------------------
    function handleError(message, done = true) {
      // log error
      console.log(`\x1b[38;2;206;60;49m`, `× ERROR: ${message}`);
      if (done) {
        rl.close();
        done();
      }
    }


    // ---------------------------------
    // helper function to ask a question
    // ---------------------------------
    function askQuestion(query, mandatory = true) {
      // return answer promise
      return new Promise((resolve, reject) => {
        // styled query
        const coloredQuery = `\n\x1b[38;2;50;163;219m→ ${query}\x1b[0m`;
        rl.question(coloredQuery, answer => {
          // check for emptiness if answer is required
          if (answer.trim() || !mandatory) {
            resolve(answer.trim());
          } else {
            reject(Error("answer is required."));
          }
        });
      });
    }


    // ---------------------------------------
    // function to validate module name input
    // ---------------------------------------
    function validateModules(modules) {
      // check if modules exist in modules folder
      modules.forEach(module => {
        const modulePath = path.join(__dirname, "modules", module);
        if (!fs.existsSync(modulePath))
          throw new Error(`module '${module}' does not exist.`);
      });
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

      // try block to create plugin with error handling
      try {
        // ask for full name and check
        let name = await askQuestion("Enter the full name for your plugin: ");
        if (!name.trim()) throw new Error("name required");
        name = name.replace(/[^a-zA-Z0-9]/g, "");

        // ask for author and check
        let author = await askQuestion("Enter the plugin author: ");
        if (!author.trim()) throw new Error("Author required.");
        author = author.replace(/[^a-zA-Z0-9]/g, "");

        // ask for description (optional)
        let description = await askQuestion(
          "Enter the plugin description (optional): ",
          false
        );
        description = description.replace(/[^a-zA-Z0-9]/g, "");

        // ask if modules are needed
        const addModulesAnswer = await askQuestion(
          "Do you want to add modules? (y/n): "
        );
        if (addModulesAnswer !== "y" && addModulesAnswer !== "n")
          throw new Error("invalid answer");
        const addModules = addModulesAnswer.toLowerCase() === "y";
        let modules = [];

        // ask for modules
        if (addModules) {
          const modulesInput = await askQuestion(
            "Enter modules separated by commas: "
          );
          modules = modulesInput.split(",").map(m => m.trim());

          // check if modules exist in modules folder
          validateModules(modules);
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
          `\n✓ SUCCESS: plugin '${pluginName}' created`
        );
      } catch (error) {
        // handle error
        handleError(error.message);
      }
    }


    // --------------------------
    // function to create module
    // --------------------------
    async function createModule(basePath, moduleName, classType, className) {
      // create folder path
      const folderPath = path.join(basePath, moduleName);

      try {
        // ask for full name
        let name = await askQuestion("Enter the full name for your module: ");
        if (!name.trim()) throw new Error("name required");
        name = name.replace(/[^a-zA-Z0-9]/g, "");

        // ask if requirements are needed
        const addRequirementsAnswer = await askQuestion(
          "Do you want to add any required modules? (y/n): "
        );
        if (addRequirementsAnswer !== "y" && addRequirementsAnswer !== "n")
          throw new Error("invalid answer for requirements");
        const addRequirements = addRequirementsAnswer.toLowerCase() === "y";
        let requirements = [];

        // ask for module requirements
        if (addRequirements) {
          const requirementsInput = await askQuestion(
            "Enter modules separated by commas: "
          );
          requirements = requirementsInput.split(",").map(r => r.trim());
        }

        // check if required modules exist in modules folder
        validateModules(requirements);

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
          version: "0.1.0",
          includes: [`${moduleName}.js`],
          requires: requirements
        };

        // create files
        createFiles(folderPath, jsContent, jsonContent);

        // log success
        console.log(
          `\x1b[38;2;43;199;121m`,
          `\n✓ SUCCESS: module '${moduleName}' created`
        );
      } catch (error) {
        // handle error
        handleError(error.message);
      }
    }


    // --------------
    // init function
    // --------------
    async function initCreate(structureType) {
      // try block to start main process
      try {
        let isPlugin = structureType === "plugin";

        // ask for name and check
        let name = await askQuestion(
          `Enter the identification name for your ${structureType}: `
        );
        if (!name.trim()) throw new Error("name required.");
        name = name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

        // ask for class creation
        const createClassAnswer = await askQuestion(
          `Do you want to create a class for your ${structureType} (y/n): `
        );
        if (createClassAnswer !== "y" && createClassAnswer !== "n")
          throw new Error("invalid answer");
        let createClass = createClassAnswer.toLowerCase() === "y";

        // ask for module-specific class type
        createClass = !isPlugin
          ? createClass
            ? await askQuestion(
                "XOpatModule class or XOpatModuleSingleton? (class/singleton): "
              )
            : ""
          : createClass;

        // ask for class name and check
        let className = createClass
          ? await askQuestion(`Enter the name of your ${structureType} class: `)
          : "";
        if (createClass && !className.trim())
          throw new Error("class name required");
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

        // create plugin or module
        isPlugin
          ? await createPlugin(basePath, name, createClass, className)
          : await createModule(basePath, name, createClass, className);

        // close readline
        rl.close();

        // finish task
        done();
      } catch (error) {
        // handle error
        handleError(error.message);
      }
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
      const done = this.async();

      // check if type argument is provided
      if (type !== "plugin" && type !== "module") {
        grunt.log.error(
          "ERROR: please specify either 'plugin' or 'module' as an option"
        );
        done(false);
        return;
      }

      // initialize create process
      await initCreate(type, rl);
      rl.close();
      done();

    } catch (error) {
      handleError(error.message);
    }
  });
};