# HTML Server

Is no server at all, provides a static and simplest means of deployment with the following downsides:
 - POST queries are not supported
 - the deployment is not dynamic, change in configuration requires re-compilation

This implementation depends on the JS and HTML templates and **must be built** using the grunt task.

### Usage:
The index file should be relative to the repository root (e.g. copy the index file outside).
The index file _needs_ the ``src``, `modules` and `plugins` folders with the JS code. The index 
file default position (on the level of these folders) can be customized by specifying 
``PROJECT_PATH = "";`` value that must provide either absolute or relative path to the source 
folders wrt. the deployed index file on the webserver

Furthermore, the built index file respects the state of the source files, meaning if you run
the source build task ``grunt build``, it recognizes there are files that are minified versions
of the source code and loads these instead. The recognition is simply based on the minified
source code index file presence and does not recognize file updates.
