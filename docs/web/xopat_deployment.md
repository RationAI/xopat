- # xOpat Deployment
after deploying the image server in previous chapter, we can now deploy xOpat.

1. clone repository
2. npm install
3. npm run s-node
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