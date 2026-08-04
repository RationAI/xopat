# Standalone WSI Service

Deprecated. Use [`rationai-wsi-tile-source`](../rationai-wsi-tile-source/README.md) instead.

> **Do not load both modules.** `EmpaiaStandaloneV3TileSource.supports()` matches
> the same `/v3/{files,slides}/info` URLs as `RationaiStandaloneV3TileSource`, and
> OpenSeadragon's autodetection takes the first match in namespace insertion
> order — so which class opens the slide depends on script load order. This class
> supports only the options the *original* EMPAIA service understands — `format`,
> `quality` and `channels`, applied as tile-request query parameters. `plugin`
> (slide-reader selection) is **dropped**, because the original service has no
> such parameter, and neither slide mappers nor authenticated access exist there:
> the slide id lives in the URL path and no option ever reaches `/info`.
>
> A `format: "tiff"` request sets `_dataFormat = "rawTiff"`, so tiles decode
> through the `geotiff` module's converter chain and keep their native bit depth.
>
> Migrate by switching the deployment to `rationai-wsi-tile-source` and naming it
> explicitly in the protocol entry:
> ```json
> "slide_protocols": {
>   "rationai_wsi": {
>     "url": "`http://localhost:8080/v3/slides/info?slide_id=${data}`",
>     "tileSourceClass": "RationaiStandaloneV3TileSource"
>   }
> }
> ```
> which bypasses autodetection entirely and makes the collision moot.
