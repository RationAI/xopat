# Annotations

The complex functionality will be described later. This plugin allows to create, edit and export annotations.


### Formats
The native format used comes from the underlying library and available features. To support multiple formats, 
you can either use supported formats implemented as a build-in convertors, or provide a new convertor. 
Supported formats are `ASAP XML` annotations from the ASAP Viewer, and `GeoJSON` annotations. 
Note that although supported, these are possibly lossy formats.
More information can be found in `convert/README.md`.