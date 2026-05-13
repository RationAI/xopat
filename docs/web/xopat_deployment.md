To deploy xOpat, we need to configure it statically, 

1. Clone repository and install development dependencies:
        ```
        git clone https://github.com/RationAI/xopat.git
        cd xopat
        npm install
        ```
2. Create env.json in env directory (can be also created - but unpersonalised - by using `grunt env`):
       
    !!! note 
        This env.json file is suitable for WSI-Server. If you have your own image server you need to configure your own.

    !!! warning
        Be sure that you use this env file with openseadragon* attributes or you have openseadragon builded in your repository.
       
    ``` json title="env.json"
    {
    "core": {
        // This configuration file supports JSON with comments
        "gateway": "/",
        // Active configuration key from 'client'
        "active_client": "localhost",
        "client": {
            "localhost": {
                // Viewer url, so that it is accessible at domain+path url
                "domain": "http://localhost:8000",
                "path": "/",
                // Named slide-protocol registry. Each entry is a backtick template
                // resolving a scalar DataID to a tile-source URL; the server URL is
                // embedded directly in the template. The `default_*_protocol` keys
                // pick which entry is used by default for background / visualization
                // slides. Protocols can also be added at runtime by plugins via
                // `window.SLIDE_PROTOCOLS.register(...)` — e.g. the dicom plugin
                // registers a "dicom" factory protocol that builds a DICOMWebTileSource.
                "slide_protocols": {
                    "wsi_service": "`http://localhost:8080/v3/slides/info?slide_id=${data}`"
                },
                "default_background_protocol":    "wsi_service",
                "default_visualization_protocol": "wsi_service",
                "headers": {},
                "js_cookie_expire": 365,
                "js_cookie_path": "/",
                "js_cookie_same_site": "",
                "js_cookie_secure": "",
                "secureMode": false
            }
        },
        // Setup can configure much more default parameters for the viewer
        "setup": {
            "locale": "en",
            "theme": "auto"
        },
        // OpenSeadragon library origin
        "openSeadragonPrefix": "https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/",
        "openSeadragon": "openseadragon.min.js"
    },
    // We do not re-define any plugin configuration
    "plugins": {},
    // We force-load module for communication with WSI-Service
    "modules": {
        "empaia-wsi-tile-source": {  // the module id
            "permaLoad": true        // the built-in parameter for force-loading
        }
    }
    }
    ```
3. run server node:
        ```
        npm run s-node
        ```

Now you should see xOpat running. However, to open the viewer, you must tell it what data
is to be viewed in a what way, and possibly also other things (active plugins and their configuration, etc.).

## Accessing WSIs
The simples way of opening a slide is through URL parameters.

1. Go to image server deployment and inspect "cases" to the url: <http://localhost:8080/v3/cases>
2. Fetch desired case ID and use it to get its slides: <http://localhost:8080/v3/cases/slides?case_id=*CASE_ID>
3. Find desired slide ID and add it to the xOpat deployment url: <http://localhost:9000/?slides=*SLIDE_ID*>

Now you should have working xOpat instance. 
