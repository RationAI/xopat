# Annotations

This is a GUI interface for the Annotations module. Adds cloud-sharing options.
For customization, adjust the `include.json` file.

````json
  "server": "/iipsrv.fcgi",
  "factories": ["polygon", "rect", "ellipse", "ruler"]
````
Server defines URL (relative means on this server) to the annotations cloud service.
Factories is a list of annotation objects identifiers recognized by this plugin. Annotations module
can be used by multiple plugins and annotations GUI will work only with objects of this list.

By default, the server expects the annotations data in the module native format, e.g. a 
javascript objects with pre-defined properties. In case your annotations have different
structure, you have to translate it in the `dataLoader.js` file. The purpose of this file
is to translate the response data --- that's why the default implementation does practically
nothing.
