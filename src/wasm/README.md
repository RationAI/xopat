# Web Assembly

Web Assembly is a performant alternative to running expensive code. While WASM can be used regardless of 
location, there are several caveats to follow. This directory only hosts core WASM dependencies, 
your files can be safely added through modules or plugins.

### Naming Convention
Only files that end with ``.wasm``, files that contain `wasm` and files that end in `worker.js` or
``worker.mjs`` should host WASM or thread workers in general. The application recognizes these
files and sends appropriate headers so that threading works without issues.

### Loading
As workers and js modules (recommended usage), the viewer does not offer advanced tools for
loading these scripts dynamically. You need to use **relative** file names and instantiate
your worker or import a module. Relative paths must begin in the repository root. With plugins and 
modules, the easiest way is to extend appropriate (module/plugin) interface and retrieve ``this.PLUGIN_ROOT`` or
``this.MODULE_ROOT`` respectively, against which you can import local files.

### Threading
Compiling WASM to a thread is not supported. For now we have no way of ensuring all resources are COOP/COEP compliant.
