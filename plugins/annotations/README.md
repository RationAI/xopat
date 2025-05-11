# Annotations
todo docs
This is a GUI interface for the Annotations module. Adds cloud-sharing options.
For customization, adjust the `include.json` file.

For annotations plugin to allow server write operations in the HTTP API, the following metadata
must be present in the configuration:
 - todo make the meta parse-able by the core API instead of data loader

````json
  "server": "/iipsrv.fcgi",
  "factories": ["polygon", "rect", "ellipse", "ruler"],
  "serverAutoLoadIds": true,
  "focusWithZoom": true,
  "modalHistoryWindow": true,
  "enablePresetModify": true,
  "convertors": {
    "format": "native", //existing formats available in the underlying module, default format and also format used to upload to the server
    //arguments passed to the IO format convertors, see the annotation module
  }
````

Server defines URL (relative means on this server) to the annotations cloud service.
Factories is a list of annotation objects identifiers recognized by this plugin. Annotations module
can be used by multiple plugins and annotations GUI will work only with objects of this list.

By default, the server expects the annotations data in the module native format, e.g. a 
javascript objects with pre-defined properties. In case your annotations have different
structure, you have to translate it in the `dataLoader.js` file. The purpose of this file
is to translate the response data --- that's why the default implementation does practically
nothing.

For more internal workings of the underlying module, check ``modules/annotations/README.md``.

### Parameters
The plugin supports optional parameters:
 - ``focusWithZoom`` whether to zoom automatically on annotation with focus action, default true
 - ``factories`` a list of enabled annotation factory IDs
 - ``serverAutoLoadIds`` array of server annotation-stored IDs to load automatically
 - ``convertors`` only subset of attributes is allowed:
   - ``imageCoordinatesOffset`` offset to add to annotations when loaded
 - ``modalHistoryWindow`` whether to show annotation list window in a separate browser window
 - ``enablePresetModify`` allow users to modify presets
 - ``staticPresets`` a list of presets to load upon starting, replaces possible presets stored in cache

## HTTP API
The xOpat Annotations use by default a simple API that you either
 - have to conform to and everything works out of the box
 - have to pretend to fulfill on the client side by reimplementing ``dataLoader.js``

Everything is built upon simple object representing the **data** object:
todo docs
- (required) id: id for the current annotation data
- (optional) data: serialized, format-compatible export
- (read-optional) metadata: metadata 
  - default implementation re-uses ``UTILTIES.fetchJSON`` that adds meta automatically via the viewer metadata
+ (optional) any other custom data not recognized by default by the plugin
todo docs
Furthermore, ``metadata`` must either contain several properties, or implement
`get*()` methods in ``dataLoader.js`` for correct reading.


Requests can go both through GET and POST; value is anything command requires, at most one:
 - GET: Url with a style ``Protocol=command/value``
 - POST: a JSON object with (some of) properties: 
   - `protocol` protocol to conform to
   - `command` command to perform
   - `id` unique annotation export identifier, an integer, (shared accross history)
   - `tissuePath` unique tissue identifier
   - `data` the **data** object structure

The response should always contain the **data** object or array of this objects in a JSON. 
Failures shall return HTTP error codes. Error messages may be arbitrary, ``dataLoader.js`` defines
their parsing.

## Protocol 'Annotation'
The following command list shall be supported. Some are both POST and GET, some only POST.

### "remove":
Requires `id`. Returns 202 and data object upon success.

### "update"
Requires `id` and `data` to update. Returns 202 and data object upon success. POST only.

### "load":
Requires `id`. Returns 200 and data object upon success.

### "list":
Requires `tissuePath`. Returns 200 and \[data objects\] array upon success.

### "history":
Requires `id`. Returns 200 and \[data objects\] array upon success. Lists all exports within the history.

### "save":
Requires `tissuePath` and new `data` to upload/store. Returns 201 and data object upon success. POST only.
