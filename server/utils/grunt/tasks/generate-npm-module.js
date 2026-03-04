"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const inquirer = require("inquirer");
const prompt = inquirer.createPromptModule();

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function writeFile(p, s) { fs.writeFileSync(p, s); }

function spawnAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
        child.on("error", reject);
    });
}

module.exports = function (grunt) {
    return async function () {
        const done = this.async();

        // Locate project root by walking up until package.json exists
        let root = process.cwd();
        while (!fs.existsSync(path.join(root, "package.json"))) {
            const parent = path.dirname(root);
            if (parent === root) throw new Error("Project root not found.");
            root = parent;
        }

        const answers = await prompt([
            { type: "input", name: "moduleId", message: "Viewer module id (folder name):", validate: v => !!v.trim() },
            { type: "input", name: "npmName", message: "NPM package name (e.g. lodash):", validate: v => !!v.trim() },
            { type: "input", name: "npmVersion", message: "NPM version/range (optional, e.g. ^4.17.21):" },
            {
                type: "list",
                name: "exportMode",
                message: "How should it be exposed to vanilla JS?",
                choices: [
                    { name: "Namespace: XOpat.modules[id] = import * as pkg", value: "namespace" },
                    { name: "Default export to global: window[id] = default", value: "defaultGlobal" },
                    { name: "Everything to global: window[id] = import * as pkg", value: "starGlobal" },
                ]
            },
            { type: "confirm", name: "runInstall", message: "Run npm install in the new module folder?", default: true },
        ]);

        const moduleId = answers.moduleId.trim().replace(/[^a-zA-Z0-9-]/g, "");
        const npmName = answers.npmName.trim();
        const npmDep = answers.npmVersion?.trim() ? `${answers.npmVersion.trim()}` : "latest";

        const moduleDir = path.join(root, "modules", moduleId);

        // include.json (points to workspace output)
        writeJson(path.join(moduleDir, "include.json"), {
            id: moduleId,
            name: `${npmName} (NPM)`,
            author: "Auto-generated",
            version: "0.1.0",
            includes: ["index.workspace.js"],
            requires: []
        });

        // package.json (workspace item)
        writeJson(path.join(moduleDir, "package.json"), {
            name: `@xopat-module/${moduleId}`,
            private: true,
            version: "0.1.0",
            main: "entry.js",
            dependencies: {
                [npmName]: npmDep
            }
            // Optionally add "copy": { "node_modules/<pkg>/dist/*.css": "dist/" }
        });

        // wrapper
        let entry;
        if (answers.exportMode === "defaultGlobal") {
            entry = `import def from "${npmName}";\n` +
                `globalThis["${moduleId}"] = def;\n`;
        } else if (answers.exportMode === "starGlobal") {
            entry = `import * as pkg from "${npmName}";\n` +
                `globalThis["${moduleId}"] = pkg;\n`;
        } else {
            entry =
`import * as pkg from "${npmName}"
const root = (globalThis.npm = globalThis.npm || {});
root.modules = root.modules || {};
root.modules["${moduleId}"] = pkg;
`;
        }
        writeFile(path.join(moduleDir, "entry.js"), entry);

        if (answers.runInstall) {
            await spawnAsync("npm", ["install"], { cwd: moduleDir });
        }

        grunt.log.ok(`Created NPM-backed module at modules/${moduleId}`);
        grunt.log.ok(`Next: run "grunt build" (or your watch task) to generate index.workspace.js`);
        done();
    };
};