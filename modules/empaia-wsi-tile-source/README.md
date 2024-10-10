# Standalone WSI Service

Implementation of OpenSeadragon Tile Source access to the standalone WSI service.

> [!CAUTION]
> This module collides with different empaia slide service access (e.g. `EmpationAPI`) - the protocols used
> are the same and only one will be used (without user control over which one).

Modified by RationAI, the WSI service can read proprietary WSI file formats
in the standalone mode, accessing WSIs by their standalone IDs (generated via the service local path mapper),
or accessing the files directly by a file path (must replace `/` chars with `>` for `/slides` endpoint).

Also supports multifile access on the API extension `/files`.

### Usage

You need to provide an URL to the WSI server that uses empaia API, for example:
````json
   "image_group_server": "http://localhost:8080",
   "image_group_protocol": "`${path}/v3/batch/info?slides=${data}`",
   "image_group_preview": "`${path}/v3/batch/thumbnail/max_size/250/250?slides=${data}`",
   "data_group_server": "http://localhost:8080",
   "data_group_protocol": "`${path}/v3/batch/info?slides=${data.join(\",\")}`",
````
