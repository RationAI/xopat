## How to deploy xOpat?
To deploy xOpat please follow these steps:

1. clone repository
        ```
        git clone https://github.com/RationAI/xopat.git
        ```
2. create env.json in env directory

    !!! note
        this env.json file is suitable for WSI-Server. If you have your own image server you need to create your own.

    ``` json title="env.json"
    {
    "core": {
        "gateway": "/",
        "active_client": "localhost",
        "client": {
        "localhost": {
            "domain": "http://localhost:8000",
            "path": "/",
            "image_group_server": "http://localhost:8080",
            "image_group_protocol": "`${path}/v3/batch/info?slides=${data}`",
            "image_group_preview": "`${path}/v3/batch/thumbnail/max_size/250/250?slides=${data}`",
            "data_group_server": "http://localhost:8080",
            "data_group_protocol": "`${path}/v3/batch/info?slides=${data.join(\",\")}`",
            "headers": {},
            "js_cookie_expire": 365,
            "js_cookie_path": "/",
            "js_cookie_same_site": "",
            "js_cookie_secure": "",
            "secureMode": false
        }
        },
        "setup": {
        "locale": "en",
        "theme": "auto"
        },
        "openSeadragonPrefix": "https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/",
        "openSeadragon": "openseadragon.min.js"
    },
    "plugins": {},
    "modules": {
        "empaia-wsi-tile-source": {
        "permaLoad": true
        }
    }
    }
    ```
3. run install
        ```
        npm install
        ```
4. run server node:
        ```
        npm run s-node
        ```

Now you should see xOpat running on addres <http://localhost:9000>

## Accessing WSIs
1. go to image server deployment and add "/cases" to the url: <http://localhost:8080/cases>
2. find slide id and add it to the xOpat deployment url: <http://localhost:9000/?slides=*SLIDE_ID*>

Now you should have working xOpat instance.