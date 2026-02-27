# Standalone WSI Service

Implementation of OpenSeadragon Tile Source access to the standalone WSI service.

Modified by RationAI, the WSI service can read proprietary WSI file formats
in the standalone mode, accessing WSIs by their IDs (dependent on the mapper usage).

Also supports multifile access on the API extension `/files`.

### Usage
Configure the default viewer ENV
````json
   "image_group_server": "http://localhost:8080",
   "image_group_protocol": "{url: `$${path}/v3/files/info?paths=$${data}`, type: 'empaia-standalone'}",
   "data_group_server": "http://localhost:8080",
   "data_group_protocol": "{url:`$${path}/v3/files/info?paths=$${data.join(\",\")}`, type: 'empaia-standalone'}",
````
or provide particular strings in the ``protocol`` for sessions.

You can also just set an URL to the WSI server, for example:
````json
   "image_group_server": "http://localhost:8080",
   "image_group_protocol": "`${path}/v3/batch/info?slides=${data}`",
   "data_group_server": "http://localhost:8080",
   "data_group_protocol": "`${path}/v3/batch/info?slides=${data.join(\",\")}`",
````
But this approach has its limitations.

### Options

Options include:
``format`` - one of `jpeg, png, tiff, bmp, gif`.
``quality`` - for e.g. jpeg the image quality to request.
``channels`` - if format is `tiff`, the channels to request (array of indexes) or `all` literal.

You can set these optiosn