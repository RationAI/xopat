# WebGL in OpenSeadragon

The complex functionality will be described later. Shaders are inside `dynamic-shaders/` folder - served via dynamic PHP scripting.


### webGLContext.js

Serves as a `State` pattern, providing either WebGL 2.0 (if supported) or WebGL 1.0 (fallback) functionality.