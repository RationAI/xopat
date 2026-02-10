# xOpat NPM Elements

A plugin or a module can fully use NPM. The main design follows:
 - the installed files are in the root directory of xopat in ``node_modules/`` folder
 - the ``package.json`` file is in the root directory of the plugin or module
 - you can use default compilation logics, or override them
 - you must run a dev command to re-compile your plugin on changes
 - you must not define ``index.workspace.js`` in your plugin or module, this file must be generated as an entry point
by your module

## 🛠 `package.json` Directives

### 1. The Build Priority
The build utility (`build-logic.js`) determines how to compile your workspace based on the following priority:
1. **Override Script**: If `scripts.dev` or `scripts.build` is present, the system runs `npm run <script>`.
2. **Default Bundle**: If no scripts are found, the system uses a default `esbuild` configuration to bundle the file specified in the `"main"` field into `index.workspace.js`.

> **You MUST have ``index.workspace.js`` in your plugin or module, otherwise the system will not load anything**

### 2. Copy Directives
You can automate the movement of assets (icons, locales, templates) by adding a `"copy"` object to your `package.json`. The system performs these copies recursively.

```json
"copy": {
  "../../node_modules/my_dep/dist/*.min.js": "dist/",
}
````
For example, you might need to copy dependencies from `node_modules` to your plugin or module.
Note that wild-card dependency specification `includes` in ``include.json`` is in this case very useful.

## 🚀 Development Workflow
The twinc Watcher
During development, run grunt twinc to start the incremental builder. You can run the task multiple times and use ENV variable ``WATCH_PATTERN``
to specify which files to watch.

Any change to a file inside your workspace triggers a targeted rebuild of just that module or plugin.

The builder automatically executes your copy directives on every change.

The system detects the generated index.workspace.js and ensures the browser reloads with the updated code.

## 💎 Production & Minification
When running grunt minify, the system prepares your code for production.

index.min.js: The final production artifact. It is a concatenation of the items in your include.json and your compiled index.workspace.js.
Optionally, also index.worskpace.min.js is supported and recognized, for example, if you have your own build logics. Note that you stil
need to define ``index.workspace.js`` as of now.

Pre-minified Files: Any file ending in .min.js is automatically filtered out of uglification.

Flexible Compilation: If your custom npm run build script already minifies the code, ensure the result is saved to index.workspace.js. The system expects this file to be present to determine if a module is successfully compiled.

## 🧹 Maintenance
Use grunt clean to remove all generated index.workspace.js files and any files or folders created by copy directives.

## Example Plugin
**`include.json`** includes only things not defined in `package.json`. Note that name here is the name of the plugin, not the name of the module,
possibly shown in the UI. Package uses the same attribute as an id.
````json
{
  "name": "My Cool Plugin",
  "includes": [
    "manual-dependency.js"
  ],
  "modules": [],
  "enabled": true
  //possibly other custom static options
}
````
**`package.json`** where `name` defines `id` for `include.json`.
````json
{
  "name": "xo-image-processor",
  "version": "1.0.0",
  "description": "...",
  "author": "Adaptive AI Team",
  "license": "MIT",
  "main": "src/main.mjs", // where the entry point is, will be used by default build if not overridden
  "scripts": {
    // build steps overridden by dev and build scripts
    "dev": "npx esbuild src/main.mjs --bundle --sourcemap --format=esm --outfile=index.workspace.js",
    "build": "npx esbuild src/main.mjs --bundle --minify --format=esm --outfile=index.workspace.js"
  },
  "dependencies": {
    "my_dep": "1.0.0"
  },
  // copying usually makes sense only for npm deps or other elements outside xopat production
  "copy": {
    "../../node_modules/my_dep/dist/*.min.js": "dist/"
  }
}
````