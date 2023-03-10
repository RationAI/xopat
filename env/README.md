# xOpat Default Deployment Configuration

This README describes options for xOpat configurations and available core configuration details.
For details on modules and plugin configurations, see respective READMEs in given folders.

Default static configuration for plugins, modules and the viewer itself can be overridden
in ``env.json`` file. The full configuration is compiled for you (with comments) in `env.example.json`.
Only fields that are to be overridden can be present.

To compile the `env.example.json`, run

> grunt env

Then, you can simply override values you need to change, simply follow the `env.example.json` file.
````json
{
  "core": {
      //In particular, you will want to provide a path to redirect in case of errors
      "gateway": "../",
      "active_client": "localhost",
      "client": {
          "localhost": {
              // You have to also configure correct service URLs. This configuration
              // will work for you if your localhost is runnig both viewer and image server
              // that supports ExtendedDeepZoom protocol.
              "domain": "http://localhost/",
              "path": "",
              "metadata_server": "",
              "image_group_server": "/iipsrv.fcgi",
              "image_group_protocol": "`${path}?Deepzoom=${data}.dzi`",
              "image_group_preview": "`${path}?Deepzoom=${data}_files/0/0_0.jpg`",
              "data_group_server": "/iipsrv.fcgi",
              "data_group_protocol": "`${path}#DeepZoomExt=${data.join(\",\")}.dzi`",
              "headers": {}
          }
      }
  },
  "plugins": [
      //here goes plugins configuration as a list of objects
  ],
  "modules": [
      //here goes modules configuration as a list of objects
  ]
}
````