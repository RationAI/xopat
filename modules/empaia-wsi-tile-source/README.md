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

You need to provide either an URL to the WSI server that uses empaia API, or configure the url as follows:

````json
{
    "url": "the data url",
    "type": "empaia-standalone"
}
````
The object specification _MUST BE USED_ if you use authentication to overcome OSD limitations.
OSD does not respect ajax headers of the TileSource child if a string is provided to the argument.
